// Spend ledger: every model call is reserved before it runs (estimate from prices × tokens), then settled with
// the real usage or released. Caps (global and per channel, per UTC calendar month) are checked at reserve time.
// A month's spend = settled amounts + still-open reservations' estimates, attributed to the month the entry was
// created in. No Electron import: unit tests run it on ':memory:'.
import type { ClaudeUsage, ClaudeUsageScope, SpendEntry, SpendGroup, SpendOverview, SpendSummaryRow } from '../../shared/api'
import type { Db } from '../db'
import { claudeUsage } from './claude-usage'
import { costOf, type PricesStore, type Usage } from '../llm'
import type { SettingsStore } from '../settings'

export const GLOBAL_CAP_KEY = 'budget.globalMonthlyUsd'

export type LedgerErrorCode = 'BUDGET_EXCEEDED' | 'UNKNOWN_MODEL' | 'BAD_HANDLE' | 'BAD_INPUT'

export class LedgerError extends Error {
  constructor(
    message: string,
    readonly code: LedgerErrorCode
  ) {
    super(message)
    this.name = 'LedgerError'
  }
}

/** Thrown at reserve time when the call would cross a cap. */
export class BudgetExceededError extends LedgerError {
  constructor(
    message: string,
    readonly scope: 'global' | 'channel',
    readonly capUsd: number,
    readonly spentUsd: number,
    readonly requestedUsd: number
  ) {
    super(message, 'BUDGET_EXCEEDED')
    this.name = 'BudgetExceededError'
  }
}

export interface ReserveRequest {
  providerId: string
  model: string
  channelId?: number | null
  videoId?: number | null
  taskId?: number | null
  /** Provider account that runs the call (agent runtime, migration 019). */
  accountId?: number | null
  /** Agent-runtime task the call belongs to (migration 019). */
  orchTaskId?: number | null
  /** Expected usage, priced from the prices table; or a ready-made USD estimate. */
  estimate: Usage | { usd: number }
}

export interface LedgerHandle {
  readonly id: number
  readonly estimateUsd: number
}

export interface SettleOptions {
  /** Cost reported by the provider (Claude Code); wins over the price table. */
  costUsd?: number | null
  /** How long the call took, in milliseconds (kept for the Claude usage report). */
  durationMs?: number | null
}

export type Clock = () => Date

const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

export function monthOf(d: Date): string {
  return d.toISOString().slice(0, 7)
}

/** [start, end) ISO bounds of a `YYYY-MM` UTC month. */
export function monthBounds(month: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  const y = m ? Number(m[1]) : 0
  const mo = m ? Number(m[2]) : 0
  if (!m || mo < 1 || mo > 12) throw new LedgerError(`Invalid month: ${month}`, 'BAD_INPUT')
  return {
    start: new Date(Date.UTC(y, mo - 1, 1)).toISOString(),
    end: new Date(Date.UTC(y, mo, 1)).toISOString()
  }
}

// An adjustment (migration 008) corrects a settled entry by the difference the engine measured; it may be negative.
const SPENT = `CASE status WHEN 'settled' THEN amount_usd WHEN 'adjustment' THEN amount_usd ELSE 0 END`
const RESERVED = `CASE status WHEN 'reserved' THEN estimate_usd ELSE 0 END`

export class Ledger {
  private closed = false

  constructor(
    private readonly db: Db,
    private readonly prices: PricesStore,
    private readonly settings: SettingsStore,
    private readonly now: Clock = () => new Date(),
    private readonly onChange: () => void = () => undefined
  ) {}

  /** Estimated USD for a usage on a model (throws for a model without a price). */
  estimate(model: string, usage: Usage): number {
    const price = this.prices.get(model)
    if (!price) throw new LedgerError(`No price for model ${model}`, 'UNKNOWN_MODEL')
    return costOf(price, usage)
  }

  /** The database is about to close (quit): later settles and releases are skipped (the next start settles them). */
  close(): void {
    this.closed = true
  }

  get isClosed(): boolean {
    return this.closed
  }

  /**
   * Books an estimate, refusing when it would cross the global or the channel cap of the current month, or when
   * the cap is already used up (even a $0 estimate).
   */
  reserve(req: ReserveRequest): LedgerHandle {
    if (this.closed) throw new LedgerError('The ledger is closed', 'BAD_HANDLE')
    const estimateUsd = 'usd' in req.estimate ? req.estimate.usd : this.estimate(req.model, req.estimate)
    if (!isMoney(estimateUsd)) throw new LedgerError('Estimate must be a non-negative number', 'BAD_INPUT')
    const created = this.now()
    const { start, end } = monthBounds(monthOf(created))
    const channelId = req.channelId ?? null
    if (channelId !== null && !this.db.prepare('SELECT 1 FROM channels WHERE id = ?').get(channelId)) {
      throw new LedgerError(`Unknown channel: ${channelId}`, 'BAD_INPUT')
    }

    const handle = this.tx(() => {
      const globalCap = this.globalCap()
      if (globalCap !== null) {
        const used = this.committed(start, end, null)
        if (crosses(used, estimateUsd, globalCap)) {
          throw new BudgetExceededError(
            `Global monthly budget exceeded: ${fmt(used)} used + ${fmt(estimateUsd)} requested > ${fmt(globalCap)} cap`,
            'global',
            globalCap,
            used,
            estimateUsd
          )
        }
      }
      if (channelId !== null) {
        const cap = this.channelCap(channelId)
        if (cap !== null) {
          const used = this.committed(start, end, channelId)
          if (crosses(used, estimateUsd, cap)) {
            throw new BudgetExceededError(
              `Channel #${channelId} monthly budget exceeded: ${fmt(used)} used + ${fmt(estimateUsd)} requested > ${fmt(cap)} cap`,
              'channel',
              cap,
              used,
              estimateUsd
            )
          }
        }
      }
      const r = this.db
        .prepare(
          `INSERT INTO ledger (provider_id, model, channel_id, video_id, task_id, status, estimate_usd, created_at,
                               account_id, orch_task_id)
           VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?)`
        )
        .run(
          req.providerId,
          req.model,
          channelId,
          req.videoId ?? null,
          req.taskId ?? null,
          estimateUsd,
          created.toISOString(),
          req.accountId ?? null,
          req.orchTaskId ?? null
        )
      return { id: Number(r.lastInsertRowid), estimateUsd }
    })
    this.onChange()
    return handle
  }

  /** Replaces the reservation by the real cost. Never refused: the call already happened. */
  settle(handle: LedgerHandle, usage: Usage, opts: SettleOptions = {}): number {
    if (this.closed) return handle.estimateUsd
    const row = this.open(handle)
    let amount: number
    // The call already happened: never throw here. Bad numbers from a provider fall back to the price table,
    // then to the estimate.
    const tokens = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0)
    usage = {
      inputTokens: tokens(usage.inputTokens),
      outputTokens: tokens(usage.outputTokens),
      cacheReadTokens: tokens(usage.cacheReadTokens),
      cacheWriteTokens: tokens(usage.cacheWriteTokens)
    }
    const price = this.prices.get(row.model)
    amount = price ? costOf(price, usage) : row.estimate_usd
    if (isMoney(opts.costUsd)) amount = opts.costUsd
    if (!isMoney(amount)) amount = row.estimate_usd
    this.db
      .prepare(
        `UPDATE ledger SET status = 'settled', amount_usd = ?, input_tokens = ?, output_tokens = ?,
           cache_read_tokens = ?, cache_write_tokens = ?, settled_at = ?, duration_ms = ? WHERE id = ?`
      )
      .run(
        amount,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadTokens,
        usage.cacheWriteTokens,
        this.now().toISOString(),
        typeof opts.durationMs === 'number' && Number.isFinite(opts.durationMs) && opts.durationMs >= 0 ? Math.round(opts.durationMs) : null,
        handle.id
      )
    this.onChange()
    return amount
  }

  /** The call may have spent money but reported no usage (cancelled mid-run): book the estimate. */
  settleAtEstimate(handle: LedgerHandle): number {
    return this.settle(handle, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, { costUsd: handle.estimateUsd })
  }

  /**
   * Corrects a settled entry to what was really spent (an engine render booked at its estimate, measured once it
   * finished): writes an `adjustment` entry with the difference (negative when it cost less), attributed to the same
   * provider, model, channel, video and task, in the current month. Never refused: the money is already spent.
   * Earlier adjustments of the same entry count, so calling it again with the same figure writes nothing. Returns the
   * new entry's id, or null when there was nothing to correct.
   */
  adjust(entryId: number, actualUsd: number, note?: string): { id: number; deltaUsd: number } | null {
    if (this.closed) return null
    if (!isMoney(actualUsd)) throw new LedgerError('The measured cost must be a non-negative number', 'BAD_INPUT')
    const row = this.db
      .prepare('SELECT status, provider_id, model, channel_id, video_id, task_id, amount_usd FROM ledger WHERE id = ?')
      .get(entryId) as
      | { status: string; provider_id: string; model: string; channel_id: number | null; video_id: number | null; task_id: number | null; amount_usd: number }
      | undefined
    if (!row) throw new LedgerError(`Unknown ledger entry ${entryId}`, 'BAD_HANDLE')
    if (row.status !== 'settled') throw new LedgerError(`Ledger entry ${entryId} is ${row.status}, not settled`, 'BAD_HANDLE')
    const before = this.db
      .prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS s FROM ledger WHERE status = 'adjustment' AND ref_id = ?`)
      .get(entryId) as { s: number }
    const delta = Math.round((actualUsd - row.amount_usd - before.s) * 1e6) / 1e6
    if (Math.abs(delta) < 1e-6) return null
    const now = this.now().toISOString()
    const r = this.db
      .prepare(
        `INSERT INTO ledger (provider_id, model, channel_id, video_id, task_id, status, estimate_usd, amount_usd, ref_id,
                             note, created_at, settled_at)
         VALUES (?, ?, ?, ?, ?, 'adjustment', 0, ?, ?, ?, ?, ?)`
      )
      .run(row.provider_id, row.model, row.channel_id, row.video_id, row.task_id, delta, entryId, note?.slice(0, 300) ?? null, now, now)
    this.onChange()
    return { id: Number(r.lastInsertRowid), deltaUsd: delta }
  }

  /** The call failed before spending anything: refund the reservation. */
  release(handle: LedgerHandle): void {
    if (this.closed) return
    this.open(handle)
    this.db
      .prepare(`UPDATE ledger SET status = 'refunded', amount_usd = 0, settled_at = ? WHERE id = ?`)
      .run(this.now().toISOString(), handle.id)
    this.onChange()
  }

  /**
   * Settles reservations left open (a crash, a quit mid-call) for longer than `maxAgeMs` at their estimate: the
   * call may have run and spent, and nothing tells how much. Returns how many. Copies of Atelier Cloud jobs
   * (`cloud_job_id`, migration 009) are left alone: they are reconciled with the Cloud (src/main/cloud/mirror.ts).
   */
  settleStale(maxAgeMs: number): number {
    const cutoff = new Date(this.now().getTime() - maxAgeMs).toISOString()
    const r = this.db
      .prepare(
        `UPDATE ledger SET status = 'settled', amount_usd = estimate_usd, settled_at = ?
         WHERE status = 'reserved' AND created_at <= ? AND cloud_job_id IS NULL`
      )
      .run(this.now().toISOString(), cutoff)
    if (Number(r.changes) > 0) this.onChange()
    return Number(r.changes)
  }

  /**
   * The cap this month's settled spend has reached (global first, then the channel's), as the error a reservation
   * would get; null while both have room. Checked after a settle: a run may cost more than its reservation. Open
   * reservations do not count here (they are estimates of runs still going; the reserve check covers them).
   */
  capReached(channelId: number | null): BudgetExceededError | null {
    const { start, end } = monthBounds(monthOf(this.now()))
    const globalCap = this.globalCap()
    if (globalCap !== null) {
      const used = this.settled(start, end, null)
      if (used >= globalCap - 1e-9) {
        return new BudgetExceededError(`Global monthly budget reached: ${fmt(used)} used of ${fmt(globalCap)}`, 'global', globalCap, used, 0)
      }
    }
    if (channelId !== null) {
      const cap = this.channelCap(channelId)
      if (cap !== null) {
        const used = this.settled(start, end, channelId)
        if (used >= cap - 1e-9) {
          return new BudgetExceededError(`Channel #${channelId} monthly budget reached: ${fmt(used)} used of ${fmt(cap)}`, 'channel', cap, used, 0)
        }
      }
    }
    return null
  }

  globalCap(): number | null {
    const v = this.settings.get<number | null>(GLOBAL_CAP_KEY, null)
    return isMoney(v) ? v : null
  }

  setGlobalCap(usd: number | null): void {
    if (usd !== null && !isMoney(usd)) throw new LedgerError('Cap must be a non-negative number or null', 'BAD_INPUT')
    if (usd === null) this.settings.delete(GLOBAL_CAP_KEY)
    else this.settings.set(GLOBAL_CAP_KEY, usd)
    this.onChange()
  }

  channelCap(channelId: number): number | null {
    const row = this.db.prepare('SELECT monthly_budget_usd AS b FROM channels WHERE id = ?').get(channelId) as
      | { b: number | null }
      | undefined
    return row?.b ?? null
  }

  setChannelCap(channelId: number, usd: number | null): void {
    if (usd !== null && !isMoney(usd)) throw new LedgerError('Cap must be a non-negative number or null', 'BAD_INPUT')
    const r = this.db
      .prepare(
        `UPDATE channels SET monthly_budget_usd = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
      .run(usd, channelId)
    if (Number(r.changes) === 0) throw new LedgerError(`Unknown channel: ${channelId}`, 'BAD_INPUT')
    this.onChange()
  }

  /** Tokens, API-equivalent cost and time the Claude Code subscription served, for a video or the last 7 days. */
  claudeUsage(scope: ClaudeUsageScope): ClaudeUsage {
    return claudeUsage(this.db, scope, this.now())
  }

  overview(month: string = monthOf(this.now())): SpendOverview {
    const { start, end } = monthBounds(month)
    const tot = this.db
      .prepare(
        `SELECT COALESCE(SUM(${SPENT}),0) AS spent, COALESCE(SUM(${RESERVED}),0) AS reserved,
                COALESCE(SUM(status = 'settled'),0) AS calls
         FROM ledger WHERE created_at >= ? AND created_at < ?`
      )
      .get(start, end) as { spent: number; reserved: number; calls: number }
    const channels = this.db
      .prepare(
        `SELECT c.id AS channelId, c.name AS name, c.monthly_budget_usd AS budgetUsd,
                COALESCE(SUM(${SPENT}),0) AS spentUsd,
                COALESCE(SUM(${RESERVED}),0) AS reservedUsd
         FROM channels c
         LEFT JOIN ledger l ON l.channel_id = c.id AND l.created_at >= ? AND l.created_at < ?
         WHERE c.archived_at IS NULL OR l.id IS NOT NULL
         GROUP BY c.id ORDER BY spentUsd DESC, c.name`
      )
      .all(start, end) as unknown as SpendOverview['channels']
    return {
      month,
      spentUsd: tot.spent,
      reservedUsd: tot.reserved,
      calls: tot.calls,
      globalCapUsd: this.globalCap(),
      channels
    }
  }

  /** Settled spend of a month grouped by provider, model, channel, video or day. */
  summary(group: SpendGroup, month: string = monthOf(this.now())): SpendSummaryRow[] {
    const { start, end } = monthBounds(month)
    const spec: Record<SpendGroup, { key: string; label: string; join: string }> = {
      provider: { key: 'l.provider_id', label: 'l.provider_id', join: '' },
      model: { key: 'l.model', label: 'l.model', join: '' },
      channel: {
        key: `COALESCE(CAST(l.channel_id AS TEXT), '')`,
        label: `COALESCE(c.name, '(no channel)')`,
        join: 'LEFT JOIN channels c ON c.id = l.channel_id'
      },
      video: {
        key: `COALESCE(CAST(l.video_id AS TEXT), '')`,
        label: `COALESCE(v.title, '(no video)')`,
        join: 'LEFT JOIN videos v ON v.id = l.video_id'
      },
      day: { key: 'substr(l.created_at, 1, 10)', label: 'substr(l.created_at, 1, 10)', join: '' }
    }
    const g = spec[group]
    if (!g) throw new LedgerError(`Unknown grouping: ${String(group)}`, 'BAD_INPUT')
    const order = group === 'day' ? 'key' : 'spentUsd DESC, label'
    return this.db
      .prepare(
        `SELECT ${g.key} AS key, MAX(${g.label}) AS label,
                COALESCE(SUM(l.amount_usd),0) AS spentUsd, COALESCE(SUM(l.status = 'settled'),0) AS calls,
                COALESCE(SUM(l.input_tokens),0) AS inputTokens, COALESCE(SUM(l.output_tokens),0) AS outputTokens
         FROM ledger l ${g.join}
         WHERE l.created_at >= ? AND l.created_at < ? AND l.status IN ('settled','adjustment')
         GROUP BY ${g.key} ORDER BY ${order}`
      )
      .all(start, end) as unknown as SpendSummaryRow[]
  }

  entries(month: string = monthOf(this.now()), limit = 200): SpendEntry[] {
    const { start, end } = monthBounds(month)
    const n = Math.min(Math.max(Math.trunc(limit) || 200, 1), 1000)
    return this.db
      .prepare(
        `SELECT l.id, l.created_at AS createdAt, l.provider_id AS providerId, l.model, l.channel_id AS channelId,
                c.name AS channelName, l.video_id AS videoId, v.title AS videoTitle, l.status,
                l.estimate_usd AS estimateUsd, l.amount_usd AS amountUsd,
                l.input_tokens AS inputTokens, l.output_tokens AS outputTokens
         FROM ledger l LEFT JOIN channels c ON c.id = l.channel_id LEFT JOIN videos v ON v.id = l.video_id
         WHERE l.created_at >= ? AND l.created_at < ? ORDER BY l.created_at DESC, l.id DESC LIMIT ?`
      )
      .all(start, end, n) as unknown as SpendEntry[]
  }

  private settled(start: string, end: string, channelId: number | null): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(${SPENT}),0) AS used FROM ledger
         WHERE created_at >= ? AND created_at < ? ${channelId === null ? '' : 'AND channel_id = ?'}`
      )
      .get(...(channelId === null ? [start, end] : [start, end, channelId])) as { used: number }
    return row.used
  }

  private committed(start: string, end: string, channelId: number | null): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(${SPENT}),0) + COALESCE(SUM(${RESERVED}),0) AS used FROM ledger
         WHERE created_at >= ? AND created_at < ? ${channelId === null ? '' : 'AND channel_id = ?'}`
      )
      .get(...(channelId === null ? [start, end] : [start, end, channelId])) as { used: number }
    return row.used
  }

  private open(handle: LedgerHandle): { model: string; estimate_usd: number } {
    const row = this.db.prepare('SELECT status, model, estimate_usd FROM ledger WHERE id = ?').get(handle.id) as
      | { status: string; model: string; estimate_usd: number }
      | undefined
    if (!row) throw new LedgerError(`Unknown ledger entry ${handle.id}`, 'BAD_HANDLE')
    if (row.status !== 'reserved') {
      throw new LedgerError(`Ledger entry ${handle.id} is already ${row.status}`, 'BAD_HANDLE')
    }
    return row
  }

  /** Runs `fn` in a write transaction (the cap check and the insert must not interleave). */
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* keep the original error */
      }
      throw err
    }
  }
}

/** A reservation is refused when it would go over the cap, or when the cap is already used up. */
function crosses(used: number, estimateUsd: number, cap: number): boolean {
  return used + estimateUsd > cap + 1e-9 || used >= cap - 1e-9
}

function fmt(usd: number): string {
  return `$${usd.toFixed(4)}`
}
