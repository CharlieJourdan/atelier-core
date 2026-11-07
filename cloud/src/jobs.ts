// Jobs (§4.1, §4.2): a job runs one quoted usage on its provider. Creating it holds the quote's credits in the same
// transaction (no credits, no job); success captures them, failure or cancellation releases them. One idempotency key
// per job (a replayed POST answers the same job), retries for retryable provider errors, cancellation through an
// AbortSignal, and an ordered event log per job, served as a stream.
import { TERMINAL_JOB_STATES, USAGE_INPUTS, type Job, type JobEvent, type JobState, type Usage } from '../../src/shared/cloud-api.ts'
import { iso, type Clock } from './clock.ts'
import { tx, type CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { bounded, jobDeadlineMs } from './job-deadline.ts'
import { noteJobHealth } from './key-health.ts'
import { newId } from './ids.ts'
import { realVoiceInput } from './voices.ts'
import { fxRate, jobCostEur } from './finance-settings.ts'
import { JobQueue } from './job-queue.ts'
import { takeCarry, type Measure, type Pricing } from './pricing.ts'
import { fakeContextSecret } from './providers/fakes.ts'
import type { ProviderRegistry } from './providers/registry.ts'
import { QuotaLedger } from './quota.ts'
import { isMinimaxAdapter, minimaxRefusal } from '../../src/shared/voice-exception.ts'
import { RetryableProviderError, runUsage, type ProviderAdapter, type ProviderContext } from './providers/types.ts'
import type { Storage } from './storage.ts'
import type { Vault } from './vault.ts'
import type { ProviderAlerts } from './provider-alerts.ts'
import { ORPHAN_HOLD_MS, type Wallet } from './wallet.ts'

export interface JobsOptions {
  db: CloudDb
  clock: Clock
  wallet: Wallet
  pricing: Pricing
  storage: Storage
  registry: ProviderRegistry
  vault: Vault
  /** The founder console's provider alerts (an adapter raises one when only the founder can fix it). */
  alerts?: ProviderAlerts
  /** Jobs running at once, all teams and providers together (default DEFAULT_MAX_JOBS). */
  maxConcurrent?: number
  /** Jobs running at once on one provider (an adapter id), so a provider with a low limit is not flooded (default
   *  DEFAULT_MAX_JOBS_PER_PROVIDER). A job whose provider is full waits; the next job of another provider starts. */
  maxPerProvider?: number
  /** Own limits per provider id, over maxPerProvider (default DEFAULT_PROVIDER_CAPS). */
  providerCaps?: Record<string, number>
  maxAttempts?: number
  retryDelayMs?: number
  /** The longest one provider call may take before the job fails « deadline » (solidite; default jobDeadlineMs). */
  maxJobMs?: (usage: Usage) => number
  maxCreditsPerJob?: number
  /** Jobs one team may have queued or running at once (default DEFAULT_MAX_OPEN_JOBS_PER_TEAM): one team never fills the queue. */
  maxOpenPerTeam?: number
  /** The Cloud's public base URL (signed links and callbacks given to remote executors). */
  publicUrl?: () => string
  /** The signed callback path of a job (`/v1/runpod/webhook/<jobId>?sig=…`). */
  callbackPath?: (jobId: string) => string
  /** Credits were spent by a team (after the transaction: the automatic top-up may charge a card). */
  onSpent?: (teamId: string) => void
}

export const DEFAULT_PUBLIC_URL = 'http://127.0.0.1:8787'
/** Jobs at once: a 13-minute video is about 190 pictures, 55 clips and 5 presenter calls; at 2 at a time it took 1.5 hours. */
export const DEFAULT_MAX_JOBS = 8
/** Jobs at once on one provider. */
export const DEFAULT_MAX_JOBS_PER_PROVIDER = 4
/** Providers that take fewer: HeyGen's MCP plan renders one video after another on the founder's plan. */
export const DEFAULT_PROVIDER_CAPS: Readonly<Record<string, number>> = { 'presenter:heygen-mcp': 3 }
/** Jobs one team may have open at once (a 13-minute video is about 250; past it `rate_limited`, which the app waits on: 0076). */
export const DEFAULT_MAX_OPEN_JOBS_PER_TEAM = 400
/** Links handed to a remote executor outlive the usual 15 minutes: a pod may wait in RunPod's queue first. */
export const REMOTE_LINK_TTL_S = 6 * 3600
/** A file link given to a provider (a bucket's presigned link, or the Cloud's own job-bound link): long enough for the relaxed Veo
 *  queue (15 minutes), no longer. RunPod jobs keep REMOTE_LINK_TTL_S: a pod may wait long in its queue. */
export const PROVIDER_LINK_TTL_S = 30 * 60

interface JobRow {
  id: string
  team_id: string
  account_id: string
  usage: Usage
  quote_id: string
  idem_key: string
  state: JobState
  credits: number
  hold_id: string | null
  provider: string
  demo: number
  attempts: number
  error: string | null
  result_json: string | null
  provider_ref: string | null
  created_at: string
  updated_at: string
}

type Listener = (e: JobEvent) => void

const EXPIRED_ERROR = 'the job was still unfinished 24 h after its credits were held; they went back'
const DEADLINE_ERROR = 'no result from the provider before the job deadline; nothing was charged'

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done(): void {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export { jobDeadlineMs }

export class Jobs {
  private readonly o: Required<Omit<JobsOptions, 'maxCreditsPerJob' | 'maxOpenPerTeam' | 'callbackPath' | 'onSpent' | 'alerts' | 'providerCaps'>> & Pick<JobsOptions, 'onSpent' | 'alerts'> & {
    providerCaps: Record<string, number>
    maxCreditsPerJob: number
    maxOpenPerTeam: number
    callbackPath: ((jobId: string) => string) | null
  }
  /** The jobs waiting to start, with the running counts per provider and per team (fair between teams: 0076). */
  private readonly queue = new JobQueue()
  private readonly running = new Map<string, AbortController>()
  private readonly listeners = new Map<string, Set<Listener>>()
  private idleWaiters: (() => void)[] = []
  private stopped = false
  /** Jobs the 24 h sweep is stopping: their abort ends as failed, not cancelled. */
  private readonly expired = new Set<string>()
  /** Jobs past their deadline (solidite): their abort ends as failed, with the reason. */
  private readonly overdue = new Set<string>()
  /** Best-effort stops of provider work (`ProviderAdapter.abandon`) still under way. */
  private readonly abandoning = new Set<Promise<void>>()

  private readonly quotas: QuotaLedger

  constructor(opts: JobsOptions) {
    this.quotas = new QuotaLedger(opts.db, opts.clock)
    this.o = {
      ...opts,
      maxConcurrent: Math.max(1, opts.maxConcurrent ?? DEFAULT_MAX_JOBS),
      maxPerProvider: Math.max(1, opts.maxPerProvider ?? DEFAULT_MAX_JOBS_PER_PROVIDER),
      providerCaps: { ...DEFAULT_PROVIDER_CAPS, ...(opts.providerCaps ?? {}) },
      maxAttempts: opts.maxAttempts ?? 3,
      maxJobMs: opts.maxJobMs ?? jobDeadlineMs,
      retryDelayMs: opts.retryDelayMs ?? 1000,
      maxCreditsPerJob: opts.maxCreditsPerJob ?? 100_000,
      maxOpenPerTeam: Math.max(1, opts.maxOpenPerTeam ?? DEFAULT_MAX_OPEN_JOBS_PER_TEAM),
      publicUrl: opts.publicUrl ?? (() => DEFAULT_PUBLIC_URL),
      callbackPath: opts.callbackPath ?? null
    }
  }

  /** `real`: the job serves a real run (production-17). While paid calls are on, a demo answer to it is free: nothing held,
   *  nothing charged (paid calls off, the whole Cloud is a demo and its test credits pay for it, as before). */
  create(p: { teamId: string; accountId: string; quoteId: string; idempotencyKey: string; real?: boolean }): Job {
    const created = tx(this.o.db, () => {
      const prior = this.o.db.prepare('SELECT * FROM jobs WHERE team_id = ? AND idem_key = ?').get(p.teamId, p.idempotencyKey) as
        | JobRow
        | undefined
      if (prior) {
        if (prior.quote_id !== p.quoteId) throw new CloudError('conflict', 'idempotency key already used for another quote')
        return { row: prior, fresh: false }
      }
      const quote = this.o.pricing.getQuote(p.quoteId)
      if (!quote || quote.teamId !== p.teamId) throw new CloudError('not_found', 'no such quote')
      if (this.o.clock.now() >= Date.parse(quote.expiresAt)) throw new CloudError('gone', 'this quote has expired; ask a new one')
      if (this.o.db.prepare('SELECT 1 FROM jobs WHERE quote_id = ?').get(quote.id)) throw new CloudError('conflict', 'this quote is already used')
      const open = (this.o.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE team_id = ? AND state IN ('queued', 'running')`).get(p.teamId) as { n: number }).n
      if (open >= this.o.maxOpenPerTeam) throw new CloudError('rate_limited', `a team may have at most ${this.o.maxOpenPerTeam} jobs waiting or running`, 30)
      if (quote.totalCredits > this.o.maxCreditsPerJob) {
        throw new CloudError('cap_exceeded', `a job may cost at most ${this.o.maxCreditsPerJob} credits`)
      }
      const resolved = this.o.registry.resolveFor(quote.usage, quote.input)
      const refusal = resolved.status === 'real' && isMinimaxAdapter(resolved.adapter.id) ? minimaxRefusal(quote.usage, quote.input) : null
      if (refusal !== null) throw new CloudError('forbidden', refusal)
      const demo = resolved.status === 'demo'
      const credits = p.real === true && demo && this.o.registry.paidCalls ? 0 : quote.totalCredits
      const id = newId('job')
      const now = iso(this.o.clock.now())
      this.o.db
        .prepare(
          `INSERT INTO jobs (id, team_id, account_id, usage, quote_id, idem_key, state, credits, provider, demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`
        )
        .run(id, p.teamId, p.accountId, quote.usage, quote.id, p.idempotencyKey, credits, resolved.adapter.id, demo ? 1 : 0, now, now)
      if (credits > 0) {
        const hold = this.o.wallet.hold({ teamId: p.teamId, accountId: p.accountId, credits, idemKey: `job:${id}:hold`, jobId: id })
        this.o.db.prepare('UPDATE jobs SET hold_id = ? WHERE id = ?').run(hold.holdId, id)
      }
      return { row: this.row(id), fresh: true }
    })
    if (created.fresh) {
      this.event(created.row.id, 'queued', { credits: created.row.credits, provider: created.row.provider, demo: created.row.demo === 1 })
      this.enqueue(created.row.id)
    }
    return this.toJob(created.row)
  }

  get(teamId: string, id: string): Job {
    return this.toJob(this.ownRow(teamId, id))
  }

  state(id: string): JobState {
    return this.row(id).state
  }

  cancel(teamId: string, id: string): Job {
    const row = this.ownRow(teamId, id)
    if (TERMINAL_JOB_STATES.includes(row.state)) return this.toJob(row)
    const controller = this.running.get(id)
    if (controller) {
      controller.abort(new CloudError('conflict', 'cancelled'))
      return this.toJob(this.row(id))
    }
    this.dequeue(id)
    this.finish(id, 'cancelled', { reason: 'cancelled before it started' })
    this.pump()
    return this.toJob(this.row(id))
  }

  events(jobId: string, afterSeq = 0): JobEvent[] {
    const rows = this.o.db
      .prepare('SELECT seq, type, at, data_json FROM job_events WHERE job_id = ? AND seq > ? ORDER BY seq')
      .all(jobId, afterSeq) as { seq: number; type: JobEvent['type']; at: string; data_json: string }[]
    return rows.map((r) => ({ seq: r.seq, type: r.type, at: r.at, data: JSON.parse(r.data_json) as Record<string, unknown> }))
  }

  subscribe(jobId: string, fn: Listener): () => void {
    let set = this.listeners.get(jobId)
    if (!set) this.listeners.set(jobId, (set = new Set()))
    set.add(fn)
    return () => {
      set.delete(fn)
      if (set.size === 0) this.listeners.delete(jobId)
    }
  }

  /** Resolves once nothing is queued or running (tests, smoke, shutdown). */
  whenIdle(): Promise<void> {
    if (this.queue.size === 0 && this.running.size === 0) return Promise.resolve()
    return new Promise((r) => this.idleWaiters.push(r))
  }

  /** At start-up: queued jobs of a previous process run again; running ones were cut off and fail (credits released),
   *  and the provider work they had started is cancelled (best effort; the returned promise waits for those cancels). */
  recover(): Promise<void> {
    const rows = this.o.db.prepare(`SELECT id, state FROM jobs WHERE state IN ('queued', 'running') ORDER BY created_at`).all() as {
      id: string
      state: JobState
    }[]
    for (const r of rows) {
      if (r.state === 'running') this.finish(r.id, 'failed', { error: 'interrupted by a Cloud restart' })
      else this.enqueue(r.id)
    }
    return this.settled()
  }

  /** Resolves once every best-effort stop of provider work started so far has ended (tests, shutdown). */
  async settled(): Promise<void> {
    await Promise.all([...this.abandoning])
  }

  /** The 24 h sweep. A job still queued or running on a hold older than ORPHAN_HOLD_MS is stopped first and fails
   *  (it can no longer be paid for), then every orphan hold goes back. Returns the hold ids released. */
  sweep(): string[] {
    const cutoff = iso(this.o.clock.now() - ORPHAN_HOLD_MS)
    const stale = this.o.db
      .prepare(
        `SELECT j.id FROM jobs j JOIN holds h ON h.id = j.hold_id
         WHERE j.state IN ('queued', 'running') AND h.state = 'open' AND h.created_at <= ?`
      )
      .all(cutoff) as { id: string }[]
    // a job holding nothing (a demo answer in a real run is free) is swept on its own age (solidite)
    const freeStale = this.o.db
      .prepare(`SELECT id FROM jobs WHERE state IN ('queued', 'running') AND hold_id IS NULL AND updated_at <= ?`)
      .all(cutoff) as { id: string }[]
    for (const { id } of [...stale, ...freeStale]) {
      this.expired.add(id)
      const controller = this.running.get(id)
      if (controller) controller.abort(new CloudError('gone', 'expired'))
      else {
        this.dequeue(id)
        this.finish(id, 'failed', { error: EXPIRED_ERROR })
      }
    }
    return this.o.wallet.releaseOrphans()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.queue.clear()
    for (const c of this.running.values()) c.abort(new Error('the Cloud is stopping'))
    this.pump()
    await this.whenIdle()
    await this.settled()
  }

  /** The limits in force (settings, tests). */
  limits(): { maxConcurrent: number; perProvider: number; providerCaps: Record<string, number> } {
    return { maxConcurrent: this.o.maxConcurrent, perProvider: this.o.maxPerProvider, providerCaps: { ...this.o.providerCaps } }
  }

  private enqueue(id: string): void {
    if (this.stopped) return
    const row = this.row(id)
    this.queue.push({ id, provider: row.provider, team: row.team_id })
    queueMicrotask(() => this.pump())
  }

  private dequeue(id: string): void {
    this.queue.remove(id)
  }

  private providerCap(provider: string): number {
    return this.o.providerCaps[provider] ?? this.o.maxPerProvider
  }

  private pump(): void {
    while (!this.stopped && this.running.size < this.o.maxConcurrent) {
      const next = this.queue.take((provider) => this.providerCap(provider))
      if (next === undefined) break
      const id = next.id
      if (this.row(id).state !== 'queued') continue
      const controller = new AbortController()
      this.running.set(id, controller)
      this.queue.started(next)
      void this.run(id, controller)
        .catch((err: unknown) => {
          // Never an unhandled rejection: the job fails, its credits go back.
          try {
            this.finish(id, 'failed', { error: this.o.vault.mask(err instanceof Error ? err.message : String(err)) })
          } catch {
            // The database itself failed; recover() settles the job at the next start.
          }
        })
        .finally(() => {
          this.running.delete(id)
          this.queue.ended(next)
          this.pump()
        })
    }
    if (this.queue.size === 0 && this.running.size === 0) {
      const waiters = this.idleWaiters
      this.idleWaiters = []
      for (const w of waiters) w()
    }
  }

  private async run(id: string, controller: AbortController): Promise<void> {
    const job = this.row(id)
    const quote = this.o.pricing.getQuote(job.quote_id)
    if (!quote) return this.finish(id, 'failed', { error: 'quote missing' })
    const parsed = USAGE_INPUTS[job.usage].parse(quote.input)
    const adapter = this.adapterFor(job)
    // a demonstration voice is never sent to a real provider (issue #95: ai33 answered 400 to `demo-claire`): it is swapped for the
    // default real voice of its language, and the job says so
    const swapped = adapter.kind === 'real' && job.usage === 'synthesize' ? realVoiceInput(parsed as { voiceId?: unknown }) : null
    if (swapped) this.event(id, 'progress', { fraction: 0, note: swapped.note })
    const input = swapped ? ({ ...parsed, voiceId: swapped.voiceId } as typeof parsed) : parsed
    for (let attempt = job.attempts + 1; ; attempt++) {
      const now = iso(this.o.clock.now())
      this.o.db.prepare(`UPDATE jobs SET state = 'running', attempts = ?, updated_at = ? WHERE id = ?`).run(attempt, now, id)
      this.event(id, 'started', { attempt, provider: adapter.id })
      try {
        this.o.registry.assertCallable(adapter)
        if (controller.signal.aborted) throw controller.signal.reason
        const output = await bounded(runUsage(adapter, job.usage, input, {
          signal: controller.signal,
          progress: (fraction, note) => this.event(id, 'progress', { fraction: Math.max(0, Math.min(1, fraction)), ...(note ? { note } : {}) }),
          secret:
            adapter.kind === 'real' && adapter.secretName
              ? () => this.o.vault.readForAdapter(adapter.secretName as string, adapter.id)
              : adapter.kind === 'real' && adapter.keyless
                ? () => ''
                : fakeContextSecret,
          quota: this.quotas.meter(adapter.id),
          ...(adapter.kind === 'real' && adapter.secretName ? { saveSecret: (value: string) => this.o.vault.set(adapter.secretName as string, value, `adapter:${adapter.id}`) } : {}),
          ...(this.o.alerts ? { alert: (message: string | null) => this.o.alerts?.set(adapter.id, message) } : {}),
          ...this.links(job, adapter.id)
        }), controller, this.o.maxJobMs(job.usage), () => this.overdue.add(id))
        if (controller.signal.aborted) throw controller.signal.reason
        const demo = adapter.kind === 'fake'
        for (const f of output.files) {
          const a = await this.o.storage.put(job.team_id, id, f, demo)
          this.event(id, 'artefact', { artefactId: a.id, name: a.name, mime: a.mime, size: a.size })
        }
        if (adapter.kind === 'real') noteJobHealth(this.o.alerts, adapter.id, job.usage, true, null)
        return this.finish(id, 'succeeded', { data: output.data, costUsd: output.costUsd, ...(output.costUnknown ? { costUnknown: true } : {}), measure: output.measure })
      } catch (err) {
        if (controller.signal.aborted && this.expired.has(id)) return this.finish(id, 'failed', { error: EXPIRED_ERROR })
        if (controller.signal.aborted && this.overdue.delete(id)) return this.finish(id, 'failed', { error: DEADLINE_ERROR })
        if (controller.signal.aborted) return this.finish(id, 'cancelled', { reason: 'cancelled while running' })
        const message = this.o.vault.mask(err instanceof Error ? err.message : String(err))
        if (adapter.kind === 'real') noteJobHealth(this.o.alerts, adapter.id, job.usage, false, message)
        if (err instanceof RetryableProviderError && attempt < this.o.maxAttempts) {
          this.event(id, 'retry', { attempt, error: message })
          await abortableDelay(this.o.retryDelayMs * attempt, controller.signal)
          if (controller.signal.aborted && this.expired.has(id)) return this.finish(id, 'failed', { error: EXPIRED_ERROR })
          if (controller.signal.aborted) return this.finish(id, 'cancelled', { reason: 'cancelled while waiting to retry' })
          continue
        }
        return this.finish(id, 'failed', { error: message })
      }
    }
  }

  /** A job keeps the provider it was created with (demo stays demo); only the fake of the same usage may stand in. */
  private adapterFor(job: JobRow): ProviderAdapter {
    const resolved = this.o.registry.resolveFor(job.usage, this.o.pricing.getQuote(job.quote_id)?.input)
    return resolved.adapter.id === job.provider ? resolved.adapter : this.o.registry.fake(job.usage)
  }

  /** A job that ended without success stops the provider work it had started (an adapter that already did clears its
   *  ref). Never awaited by the job itself; failures are ignored. */
  private abandon(job: JobRow): void {
    const ref = job.provider_ref
    if (!ref) return
    const adapter = this.adapterFor(job)
    if (!adapter.abandon) return
    const p: Promise<void> = adapter
      .abandon(ref)
      .catch(() => undefined)
      .finally(() => this.abandoning.delete(p))
    this.abandoning.add(p)
  }

  /** The terminal step: the money move and the state change in one transaction, then the event. */
  private finish(
    id: string,
    state: 'succeeded' | 'failed' | 'cancelled',
    p: { data?: Record<string, unknown>; costUsd?: number; costUnknown?: boolean; error?: string; reason?: string; measure?: Measure }
  ): void {
    let error = p.error ?? null
    const outcome = tx(this.o.db, (): { final: JobState; credits: number; held: number } | null => {
      const job = this.row(id)
      if (TERMINAL_JOB_STATES.includes(job.state)) return null
      let final: JobState = state
      let charged = job.credits
      if (job.hold_id) {
        const holdOpen = this.o.wallet.holdState(job.hold_id) === 'open'
        if (state === 'succeeded' && holdOpen) {
          const atCost = this.costCredits(job, p)
          if (atCost !== null) charged = atCost
          else if (p.measure) charged = this.measuredCredits(job, p.measure)
          this.o.wallet.capture({ holdId: job.hold_id, idemKey: `job:${id}:capture`, credits: charged })
          const spent = this.o.onSpent
          if (spent) setImmediate(() => spent(job.team_id))
        } else if (state === 'succeeded') {
          final = 'failed'
          error = 'the credit hold was released before the job finished'
        } else if (holdOpen) {
          this.o.wallet.release({ holdId: job.hold_id, idemKey: `job:${id}:release`, note: state })
        }
      }
      // Files of a job that did not succeed are never served (they were not paid for).
      if (final !== 'succeeded') this.o.db.prepare('DELETE FROM artefacts WHERE job_id = ?').run(id)
      // `credits` becomes what was charged: the hold for a quoted job, the measured price for a measured one.
      const credits = final === 'succeeded' ? charged : job.credits
      this.o.db
        .prepare('UPDATE jobs SET state = ?, error = ?, result_json = ?, cost_usd = ?, credits = ?, updated_at = ? WHERE id = ?')
        .run(final, error, final === 'succeeded' ? JSON.stringify(p.data ?? {}) : null, p.costUsd ?? null, credits, iso(this.o.clock.now()), id)
      return { final, credits, held: job.credits }
    })
    this.expired.delete(id)
    if (!outcome) return
    if (outcome.final !== 'succeeded') this.abandon(this.row(id))
    if (outcome.final === 'succeeded') this.event(id, 'succeeded', { credits: outcome.credits, held: outcome.held })
    else if (outcome.final === 'failed') this.event(id, 'failed', { error })
    else this.event(id, 'cancelled', { reason: p.reason ?? 'cancelled' })
  }

  /** A real job's price at cost (decision 0040, production-17): what the provider billed, converted at the dated $ → € rate
   *  with the quote's grid overhead (jobCostEur, the P&L's own formula), times the quote's multiplier (1 for an internal team),
   *  to the fraction of a credit: the whole credits of the team's carry + this job are charged (0 is possible), the rest is
   *  carried to its next job (takeCarry), never more than the hold. A job the provider billed exactly nothing for (a stock search,
   *  a voice clone: our own glue, priced by the grid) keeps the one-credit minimum, as before. Null when that rule does not
   *  apply: a demo job (its fake's figure is only what a real one would bill), a quote priced on the grid's own margins (no
   *  multiplier), or a provider that did not say what it billed. */
  private costCredits(job: JobRow, p: { costUsd?: number; costUnknown?: boolean }): number | null {
    if (job.demo === 1 || p.costUnknown || p.costUsd === undefined || !(p.costUsd >= 0) || !Number.isFinite(p.costUsd)) return null
    const quote = this.o.pricing.getQuote(job.quote_id)
    if (!quote || quote.priceMultiplier == null) return null
    const team = this.o.db.prepare('SELECT internal FROM teams WHERE id = ?').get(job.team_id) as { internal: number } | undefined
    const factor = team?.internal === 1 ? 1 : quote.priceMultiplier
    if (p.costUsd === 0) return Math.min(job.credits, 1)
    const rate = fxRate(this.o.db, () => iso(this.o.clock.now())).eurPerUsd
    const eur = jobCostEur(p.costUsd, rate, this.o.pricing.grid(quote.gridVersion).overheadPct) * factor
    const taken = takeCarry(this.o.wallet.carry(job.team_id), eur / quote.creditValueEur, job.credits)
    this.o.wallet.setCarry(job.team_id, taken.carry)
    return taken.charged
  }

  /** A measured job's price on its quote's grid version, capped at the hold. The team's internal flag is read when the
   *  job ends (a flag change between quote and end applies; the hold, priced with the flag of the quote, still caps
   *  it). A measure the grid cannot price charges the whole hold, as an unmeasured job would. */
  private measuredCredits(job: JobRow, measure: Measure): number {
    try {
      const quote = this.o.pricing.getQuote(job.quote_id)
      if (!quote || measure.length === 0) return job.credits
      const team = this.o.db.prepare('SELECT internal FROM teams WHERE id = ?').get(job.team_id) as { internal: number } | undefined
      const credits = this.o.pricing.priceMeasure({
        gridVersion: quote.gridVersion,
        usage: job.usage,
        measure,
        internal: team?.internal === 1,
        priceMultiplier: quote.priceMultiplier
      })
      return Math.min(job.credits, credits)
    } catch {
      return job.credits
    }
  }

  /** The ProviderContext parts that reach outside the process: signed file links and the job's callback URL. */
  private links(job: JobRow, adapterId: string): Pick<ProviderContext, 'jobId' | 'artefact' | 'artefactUrl' | 'callbackUrl' | 'providerRef' | 'setProviderRef'> {
    const base = (): string => this.o.publicUrl().replace(/\/+$/, '')
    // a RunPod pod may wait in its queue for hours; every other provider fetches within minutes
    const ttl = job.usage === 'submitGpuJob' || adapterId === 'presenter:infinitetalk-gpu' ? REMOTE_LINK_TTL_S : PROVIDER_LINK_TTL_S
    const artefact = (artefactId: string): { name: string; url: string } => {
      const a = this.o.storage.forTeam(job.team_id, artefactId)
      // in a bucket (Cloudflare R2, later): a presigned link straight to the bucket; a local folder (the beta, production-10): the
      // Cloud's own link bound to THIS job and file, served under its public https address only while the job runs
      const direct = this.o.storage.presign(a, ttl)
      if (direct) return { name: a.name, url: direct }
      // a RunPod pod may fetch after its job's state moved (a resume replays it): its links stay the plain signed ones
      if (ttl === REMOTE_LINK_TTL_S) return { name: a.name, url: base() + this.o.storage.signedPath(a.id, ttl).path }
      return { name: a.name, url: base() + this.o.storage.signedJobPath(job.id, a.id, ttl) }
    }
    return {
      jobId: job.id,
      artefact,
      artefactUrl: (artefactId) => artefact(artefactId).url,
      callbackUrl: () => {
        if (!this.o.callbackPath) throw new Error('this Cloud has no callback route')
        return base() + this.o.callbackPath(job.id)
      },
      providerRef: () => this.row(job.id).provider_ref,
      setProviderRef: (ref) => {
        this.o.db.prepare('UPDATE jobs SET provider_ref = ? WHERE id = ?').run(ref, job.id)
      }
    }
  }

  private event(jobId: string, type: JobEvent['type'], data: Record<string, unknown>): void {
    // Nothing after the end: an adapter that ignores its abort signal may still report progress.
    const terminal = type === 'succeeded' || type === 'failed' || type === 'cancelled'
    if (!terminal && TERMINAL_JOB_STATES.includes(this.row(jobId).state)) return
    const seq = (this.o.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM job_events WHERE job_id = ?').get(jobId) as { n: number }).n
    const e: JobEvent = { seq, type, at: iso(this.o.clock.now()), data }
    this.o.db.prepare('INSERT INTO job_events (job_id, seq, type, data_json, at) VALUES (?, ?, ?, ?, ?)').run(jobId, seq, type, JSON.stringify(data), e.at)
    // Always called outside a transaction, so what listeners hear is committed. A failing listener (a closed stream)
    // never reaches the job.
    for (const fn of this.listeners.get(jobId) ?? []) {
      try {
        fn(e)
      } catch {
        // ignored
      }
    }
  }

  private row(id: string): JobRow {
    const r = this.o.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
    if (!r) throw new CloudError('not_found', 'no such job')
    return r
  }

  private ownRow(teamId: string, id: string): JobRow {
    const r = this.row(id)
    if (r.team_id !== teamId) throw new CloudError('not_found', 'no such job')
    return r
  }

  private toJob(r: JobRow): Job {
    return {
      id: r.id,
      usage: r.usage,
      state: r.state,
      quoteId: r.quote_id,
      credits: r.credits,
      attempts: r.attempts,
      error: r.error,
      result: r.result_json === null ? null : (JSON.parse(r.result_json) as Record<string, unknown>),
      artefacts: this.o.storage.forJob(r.id).map(({ id, name, mime, size, sha256, demo }) => ({ id, name, mime, size, sha256, demo })),
      demo: r.demo === 1,
      provider: r.provider,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }
  }
}
