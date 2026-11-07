// Concurrency limits of the scheduler (docs/ENGINE-SPEC.md R6.2) and the bounded wait for a cancelled node (R10.4).
import { AbortError, EngineError, type Clock } from './errors'
import type { Executor } from './types'
import type { ResolvedNode } from './validate'

/** Concurrency limits (R6.2), configurable. `local` caps other local nodes (decision: 4). */
export interface Limits {
  claude: number
  cloud: number
  render: number
  local: number
}
export const DEFAULT_LIMITS: Limits = { claude: 2, cloud: 4, render: 1, local: 4 }
export type Pool = keyof Limits

/** Claude nodes count as Claude; cloud and gpu jobs both go through Atelier Cloud; local renders count as renders. */
export function poolOf(rn: ResolvedNode, where: Executor): Pool {
  if (rn.def.claudeRole) return 'claude'
  if (where !== 'local') return 'cloud'
  return rn.def.render ? 'render' : 'local'
}

interface Waiter {
  index: number
  grant: () => void
  fail: (e: Error) => void
}

/**
 * Slots per pool. A freed slot goes to the waiting node declared first (R6.2, decision); a node that finds a free
 * slot takes it at once, so declaration order decides among nodes waiting at the same time.
 */
export class Slots {
  private readonly used: Record<Pool, number> = { claude: 0, cloud: 0, render: 0, local: 0 }
  private readonly waiting: Record<Pool, Waiter[]> = { claude: [], cloud: [], render: [], local: [] }
  private closed = false

  private readonly limits: Limits

  constructor(limits: Limits) {
    this.limits = limits
  }

  acquire(pool: Pool, index: number): Promise<void> {
    if (this.closed) return Promise.reject(new AbortError())
    if (this.used[pool] < this.limits[pool]) {
      this.used[pool]++
      return Promise.resolve()
    }
    return new Promise((grant, fail) => {
      this.waiting[pool].push({ index, grant, fail })
      this.waiting[pool].sort((a, b) => a.index - b.index)
    })
  }

  release(pool: Pool): void {
    const next = this.waiting[pool].shift()
    if (next) next.grant()
    else this.used[pool]--
  }

  /** On cancel: every waiting node is refused, and no slot is given any more. */
  close(): void {
    this.closed = true
    for (const pool of Object.keys(this.waiting) as Pool[]) {
      for (const w of this.waiting[pool].splice(0)) w.fail(new AbortError())
    }
  }
}

/**
 * Follows a node's promise, but once `signal` aborts waits at most `graceMs` more: a node that ignores its signal is
 * not waited for forever (the host kills its process tree). Works whether the abort came before or after the call.
 */
export function withGrace<T>(p: Promise<T>, signal: AbortSignal, clock: Clock, graceMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const onAbort = (): void => {
      clock.sleep(graceMs).then(
        () => {
          if (!settled) reject(new AbortError('did not stop in time'))
        },
        () => undefined
      )
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => {
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e: unknown) => {
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    )
  })
}

/** The node watchdog's limits (solidite): an attempt quiet (no progress, no log) for `quietMs`, or running longer than
 *  `maxMs`, is stopped and retried like a transient error; both grow to `factor` × the node's estimated duration. */
export interface WatchLimits {
  quietMs: number
  maxMs: number
  factor: number
  /** How often the watchdog looks (real time). */
  checkMs: number
}
export const DEFAULT_WATCH: WatchLimits = { quietMs: 30 * 60_000, maxMs: 3 * 3600_000, factor: 4, checkMs: 15_000 }

const min = (ms: number): string => String(Math.round((ms / 60_000) * 10) / 10)

/**
 * One attempt of a node under its watchdog. Real time on purpose (not the run's injectable clock): a node that hangs
 * hangs in real time, and tests with instant clocks must never trip it. `signal` is the attempt's own (aborted with
 * the run, or by the watchdog: a local worker then kills its process tree); every sign of life calls `touch`.
 */
export class AttemptWatch {
  readonly signal: AbortSignal
  private readonly ctl = new AbortController()
  private readonly began = Date.now()
  private last = Date.now()
  private readonly limits: WatchLimits & { graceMs: number; label: string }

  constructor(runSignal: AbortSignal, limits: WatchLimits & { graceMs: number; label: string }) {
    this.limits = limits
    this.signal = this.ctl.signal
    if (runSignal.aborted) this.ctl.abort()
    else runSignal.addEventListener('abort', () => this.ctl.abort(), { once: true })
  }

  touch(): void {
    this.last = Date.now()
  }

  /** Follows the attempt's work; a stall aborts it, waits `graceMs` at most for it to stop, then rejects `stalled`. */
  follow<T>(work: Promise<T>): Promise<T> {
    const o = this.limits
    return new Promise<T>((resolve, reject) => {
      let over = false
      const timer = setInterval(() => {
        const now = Date.now()
        const quiet = now - this.last > o.quietMs
        const long = now - this.began > o.maxMs
        if (over || (!quiet && !long)) return
        over = true
        clearInterval(timer)
        const err = new EngineError('stalled', `${o.label} : ${quiet ? `aucun signe de vie depuis ${min(o.quietMs)} min` : `pas fini après ${min(o.maxMs)} min`}`, false)
        this.ctl.abort()
        const stop = setTimeout(() => reject(err), o.graceMs)
        void work.then(
          () => undefined,
          () => undefined
        ).finally(() => {
          clearTimeout(stop)
          reject(err)
        })
      }, Math.max(5, Math.min(o.checkMs, o.quietMs / 4)))
      timer.unref?.()
      work.then(
        (v) => {
          if (over) return
          over = true
          clearInterval(timer)
          resolve(v)
        },
        (e: unknown) => {
          if (over) return
          over = true
          clearInterval(timer)
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      )
    })
  }
}
