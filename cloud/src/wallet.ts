// The credit wallet (§4.4), source of truth for every team. Each movement is one `wallet_entries` row:
//   grant   +n balance            capture  −m balance, −n held (closes a hold of n, m ≤ n)
//   adjust  ±n balance            release  −n held (closes a hold)
//   hold    +n held
// so balance = Σ delta and held = Σ heldDelta, and `wallets` caches both (checked by a CHECK and by the tests).
// Rules: available = balance − held never goes below zero; every movement carries an idempotency key unique per team
// (a replay returns the first result, a different movement under the same key is a conflict); the check and the
// write happen in one BEGIN IMMEDIATE transaction; holds left open for 24 h are released by `releaseOrphans`.
// Every grant and adjustment says who paid it in (`funding`, decision 0040): « offered » by an admin (the default: the
// console, `admin grant`) or « paid » (billing: a plan, a pack, a top-up). The founder console reads it.
import type { WalletEntry, WalletKind } from '../../src/shared/cloud-api.ts'
import type { Audit } from './audit.ts'
import { DAY_MS, iso, type Clock } from './clock.ts'
import { tx, type CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { newId } from './ids.ts'

export const ORPHAN_HOLD_MS = DAY_MS

/** Who paid credits in: an admin's gift or correction, or a payment. */
export type Funding = 'offered' | 'paid'

export interface WalletState {
  teamId: string
  balance: number
  held: number
  available: number
}

export interface MoveResult {
  entry: WalletEntry
  replayed: boolean
  state: WalletState
}

export interface HoldResult extends MoveResult {
  holdId: string
}

interface EntryRow {
  id: string
  team_id: string
  kind: WalletKind
  delta: number
  held_delta: number
  hold_id: string | null
  job_id: string | null
  account_id: string | null
  note: string | null
  created_at: string
}

interface HoldRow {
  id: string
  team_id: string
  account_id: string | null
  amount: number
  captured_amount: number | null
  state: 'open' | 'captured' | 'released'
  job_id: string | null
  created_at: string
}

const toEntry = (r: EntryRow): WalletEntry => ({
  id: r.id,
  kind: r.kind,
  delta: r.delta,
  heldDelta: r.held_delta,
  holdId: r.hold_id,
  jobId: r.job_id,
  accountId: r.account_id,
  note: r.note,
  createdAt: r.created_at
})

const positiveInt = (n: number, what: string): void => {
  if (!Number.isSafeInteger(n) || n <= 0) throw new CloudError('bad_request', `${what} must be a positive whole number of credits`)
}

/** Start of the UTC day and month of `ms` (caps are counted in UTC; hypothesis for v2, see STATUS). */
export function capWindows(ms: number): { dayStart: string; monthStart: string } {
  const d = new Date(ms)
  return {
    dayStart: iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
    monthStart: iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  }
}

export class Wallet {
  private readonly db: CloudDb
  private readonly clock: Clock
  private readonly audit: Audit
  constructor(db: CloudDb, clock: Clock, audit: Audit) {
    this.db = db
    this.clock = clock
    this.audit = audit
  }

  state(teamId: string): WalletState {
    const row = this.db.prepare('SELECT balance, held FROM wallets WHERE team_id = ?').get(teamId) as
      | { balance: number; held: number }
      | undefined
    const balance = row?.balance ?? 0
    const held = row?.held ?? 0
    return { teamId, balance, held, available: balance - held }
  }

  /** The fraction of a credit this team has already paid for (0 ≤ carry < 1), carried to its next job (pricing.ts, takeCarry). */
  carry(teamId: string): number {
    const row = this.db.prepare('SELECT carry FROM wallets WHERE team_id = ?').get(teamId) as { carry: number } | undefined
    return row?.carry ?? 0
  }

  setCarry(teamId: string, carry: number): void {
    this.db.prepare('INSERT OR IGNORE INTO wallets (team_id, balance, held) VALUES (?, 0, 0)').run(teamId)
    this.db.prepare('UPDATE wallets SET carry = ? WHERE team_id = ?').run(Math.min(Math.max(carry, 0), 1 - 1e-9), teamId)
  }

  /** The proof's other side: the same figures summed from the entries themselves. */
  sumOfEntries(teamId: string): { balance: number; held: number } {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(delta), 0) AS b, COALESCE(SUM(held_delta), 0) AS h FROM wallet_entries WHERE team_id = ?')
      .get(teamId) as { b: number; h: number }
    return { balance: row.b, held: row.h }
  }

  grant(p: { teamId: string; credits: number; idemKey: string; note?: string | null; actor: string; funding?: Funding }): MoveResult {
    positiveInt(p.credits, 'a grant')
    const result = tx(this.db, () => {
      const prior = this.replay(p.teamId, p.idemKey, 'grant', p.credits, 0)
      if (prior) return prior
      return this.write({ teamId: p.teamId, kind: 'grant', delta: p.credits, heldDelta: 0, idemKey: p.idemKey, note: p.note ?? null, funding: p.funding ?? 'offered' })
    })
    if (!result.replayed) this.audit.record(p.actor, 'wallet.grant', p.teamId, { credits: p.credits, entry: result.entry.id })
    return result
  }

  /** A correction, positive or negative (counted with the offered credits); a negative one may not take the balance under the open holds. */
  adjust(p: { teamId: string; credits: number; idemKey: string; note?: string | null; actor: string }): MoveResult {
    if (!Number.isSafeInteger(p.credits) || p.credits === 0) throw new CloudError('bad_request', 'an adjustment is a non-zero whole number')
    const result = tx(this.db, () => {
      const prior = this.replay(p.teamId, p.idemKey, 'adjust', p.credits, 0)
      if (prior) return prior
      const s = this.state(p.teamId)
      if (s.balance + p.credits < s.held) {
        throw new CloudError('insufficient_credits', `adjustment of ${p.credits} would leave ${s.available + p.credits} available`)
      }
      return this.write({ teamId: p.teamId, kind: 'adjust', delta: p.credits, heldDelta: 0, idemKey: p.idemKey, note: p.note ?? null, funding: 'offered' })
    })
    if (!result.replayed) this.audit.record(p.actor, 'wallet.adjust', p.teamId, { credits: p.credits, entry: result.entry.id })
    return result
  }

  /** Reserves credits. Refused when the available credits (balance − open holds) are short, or a member cap is hit. */
  hold(p: { teamId: string; accountId: string | null; credits: number; idemKey: string; jobId?: string | null }): HoldResult {
    positiveInt(p.credits, 'a hold')
    return tx(this.db, () => {
      const prior = this.replay(p.teamId, p.idemKey, 'hold', 0, p.credits)
      if (prior) return { ...prior, holdId: prior.entry.holdId as string }
      const s = this.state(p.teamId)
      if (s.available < p.credits) {
        throw new CloudError('insufficient_credits', `${p.credits} credits needed, ${s.available} available`)
      }
      if (p.accountId) this.checkCaps(p.teamId, p.accountId, p.credits)
      const holdId = newId('hold')
      this.db
        .prepare(`INSERT INTO holds (id, team_id, account_id, amount, state, job_id, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?)`)
        .run(holdId, p.teamId, p.accountId, p.credits, p.jobId ?? null, iso(this.clock.now()))
      const moved = this.write({
        teamId: p.teamId,
        kind: 'hold',
        delta: 0,
        heldDelta: p.credits,
        idemKey: p.idemKey,
        holdId,
        jobId: p.jobId ?? null,
        accountId: p.accountId
      })
      return { ...moved, holdId }
    })
  }

  /** Settles an open hold for `credits` (default: the whole hold, never more); the rest goes back. Replays count once. */
  capture(p: { holdId: string; idemKey: string; credits?: number; note?: string | null }): MoveResult {
    return tx(this.db, () => {
      const hold = this.getHold(p.holdId)
      // A replay without `credits` of a partial capture means "the same capture": compare with what was captured.
      const credits = p.credits ?? (hold.state === 'captured' && hold.captured_amount !== null ? hold.captured_amount : hold.amount)
      if (!Number.isSafeInteger(credits) || credits < 0) throw new CloudError('bad_request', 'a capture is a whole number ≥ 0')
      if (credits > hold.amount) throw new CloudError('bad_request', `capture of ${credits} exceeds the hold of ${hold.amount}`)
      const prior = this.replay(hold.team_id, p.idemKey, 'capture', -credits, -hold.amount, hold.id)
      if (prior) return prior
      if (hold.state !== 'open') throw new CloudError('conflict', `hold ${hold.id} is already ${hold.state}`)
      this.db
        .prepare(`UPDATE holds SET state = 'captured', captured_amount = ?, closed_at = ? WHERE id = ?`)
        .run(credits, iso(this.clock.now()), hold.id)
      return this.write({
        teamId: hold.team_id,
        kind: 'capture',
        delta: credits === 0 ? 0 : -credits,
        heldDelta: -hold.amount,
        idemKey: p.idemKey,
        holdId: hold.id,
        jobId: hold.job_id,
        accountId: hold.account_id,
        note: p.note ?? null
      })
    })
  }

  release(p: { holdId: string; idemKey: string; note?: string | null }): MoveResult {
    return tx(this.db, () => {
      const hold = this.getHold(p.holdId)
      const prior = this.replay(hold.team_id, p.idemKey, 'release', 0, -hold.amount, hold.id)
      if (prior) return prior
      if (hold.state !== 'open') throw new CloudError('conflict', `hold ${hold.id} is already ${hold.state}`)
      this.db.prepare(`UPDATE holds SET state = 'released', closed_at = ? WHERE id = ?`).run(iso(this.clock.now()), hold.id)
      return this.write({
        teamId: hold.team_id,
        kind: 'release',
        delta: 0,
        heldDelta: -hold.amount,
        idemKey: p.idemKey,
        holdId: hold.id,
        jobId: hold.job_id,
        accountId: hold.account_id,
        note: p.note ?? null
      })
    })
  }

  /** Releases every hold still open after `maxAgeMs` (24 h by default). Returns the hold ids released. */
  releaseOrphans(maxAgeMs = ORPHAN_HOLD_MS): string[] {
    const cutoff = iso(this.clock.now() - maxAgeMs)
    const ids = this.db
      .prepare(`SELECT id FROM holds WHERE state = 'open' AND created_at <= ? ORDER BY created_at`)
      .all(cutoff) as { id: string }[]
    const released: string[] = []
    for (const { id } of ids) {
      try {
        this.release({ holdId: id, idemKey: `orphan:${id}`, note: 'orphan hold released after 24 h' })
        released.push(id)
      } catch (err) {
        if (!(err instanceof CloudError && err.code === 'conflict')) throw err
      }
    }
    return released
  }

  holdState(holdId: string): HoldRow['state'] {
    return this.getHold(holdId).state
  }

  /** Credits a member has committed in the window (open holds + what captures settled). */
  spentSince(teamId: string, accountId: string, sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE state WHEN 'open' THEN amount WHEN 'captured' THEN captured_amount ELSE 0 END), 0) AS s
         FROM holds WHERE team_id = ? AND account_id = ? AND created_at >= ?`
      )
      .get(teamId, accountId, sinceIso) as { s: number }
    return row.s
  }

  entries(teamId: string, opts: { limit?: number; cursor?: string } = {}): { entries: WalletEntry[]; nextCursor: string | null } {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
    const before = opts.cursor && /^\d+$/.test(opts.cursor) ? Number(opts.cursor) : Number.MAX_SAFE_INTEGER
    const rows = this.db
      .prepare(
        `SELECT id, seq, team_id, kind, delta, held_delta, hold_id, job_id, account_id, note, created_at
         FROM wallet_entries WHERE team_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`
      )
      .all(teamId, before, limit + 1) as unknown as (EntryRow & { seq: number })[]
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    return { entries: page.map(toEntry), nextCursor: rows.length > limit && last ? String(last.seq) : null }
  }

  private checkCaps(teamId: string, accountId: string, credits: number): void {
    const m = this.db.prepare('SELECT daily_cap, monthly_cap FROM members WHERE team_id = ? AND account_id = ?').get(teamId, accountId) as
      | { daily_cap: number | null; monthly_cap: number | null }
      | undefined
    if (!m) throw new CloudError('forbidden', 'not a member of this team')
    const { dayStart, monthStart } = capWindows(this.clock.now())
    if (m.daily_cap !== null) {
      const spent = this.spentSince(teamId, accountId, dayStart)
      if (spent + credits > m.daily_cap) throw new CloudError('cap_exceeded', `daily cap ${m.daily_cap}: ${spent} already committed today`)
    }
    if (m.monthly_cap !== null) {
      const spent = this.spentSince(teamId, accountId, monthStart)
      if (spent + credits > m.monthly_cap) throw new CloudError('cap_exceeded', `monthly cap ${m.monthly_cap}: ${spent} already committed`)
    }
  }

  private getHold(holdId: string): HoldRow {
    const hold = this.db.prepare('SELECT * FROM holds WHERE id = ?').get(holdId) as HoldRow | undefined
    if (!hold) throw new CloudError('not_found', `no hold ${holdId}`)
    return hold
  }

  /** An entry already written under this key: the same movement is a replay, anything else is a conflict. */
  private replay(teamId: string, idemKey: string, kind: WalletKind, delta: number, heldDelta: number, holdId?: string): MoveResult | null {
    if (!idemKey || idemKey.length > 200) throw new CloudError('bad_request', 'an idempotency key is required (≤ 200 chars)')
    const row = this.db
      .prepare(
        `SELECT id, team_id, kind, delta, held_delta, hold_id, job_id, account_id, note, created_at
         FROM wallet_entries WHERE team_id = ? AND idem_key = ?`
      )
      .get(teamId, idemKey) as EntryRow | undefined
    if (!row) return null
    if (row.kind !== kind || row.delta !== delta || row.held_delta !== heldDelta || (holdId !== undefined && row.hold_id !== holdId)) {
      throw new CloudError('conflict', `idempotency key already used for a different ${row.kind}`)
    }
    return { entry: toEntry(row), replayed: true, state: this.state(teamId) }
  }

  private write(e: {
    teamId: string
    kind: WalletKind
    delta: number
    heldDelta: number
    idemKey: string
    holdId?: string | null
    jobId?: string | null
    accountId?: string | null
    note?: string | null
    funding?: Funding | null
  }): MoveResult {
    const id = newId('we')
    const at = iso(this.clock.now())
    const seq = (this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM wallet_entries').get() as { n: number }).n
    this.db
      .prepare(
        `INSERT INTO wallet_entries (id, seq, team_id, kind, delta, held_delta, hold_id, job_id, account_id, idem_key, note, funding, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, seq, e.teamId, e.kind, e.delta, e.heldDelta, e.holdId ?? null, e.jobId ?? null, e.accountId ?? null, e.idemKey, e.note ?? null, e.funding ?? null, at)
    // Two statements, not an upsert: SQLite checks the CHECK on the candidate row before it sees the conflict.
    this.db.prepare('INSERT OR IGNORE INTO wallets (team_id, balance, held) VALUES (?, 0, 0)').run(e.teamId)
    this.db.prepare('UPDATE wallets SET balance = balance + ?, held = held + ? WHERE team_id = ?').run(e.delta, e.heldDelta, e.teamId)
    const entry = toEntry({
      id,
      team_id: e.teamId,
      kind: e.kind,
      delta: e.delta,
      held_delta: e.heldDelta,
      hold_id: e.holdId ?? null,
      job_id: e.jobId ?? null,
      account_id: e.accountId ?? null,
      note: e.note ?? null,
      created_at: at
    })
    return { entry, replayed: false, state: this.state(e.teamId) }
  }
}
