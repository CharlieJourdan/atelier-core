// When the team computer backs itself up (docs/BRAIN-HEADLESS.md §10): every night at a fixed local time (03:30 by
// default), and once soon after a start when the last good backup is older than a day and a bit (the machine was off at
// night, or it is the first start). A failed backup is tried again an hour later. One backup at a time.
import type { BackupState } from './backup'

export interface BackupAt {
  hour: number
  minute: number
}

export const DEFAULT_BACKUP_AT: BackupAt = { hour: 3, minute: 30 }
/** A start catches up when the last good backup is older than this. */
export const CATCH_UP_AFTER_MS = 26 * 3_600_000
/** The catch-up waits this long after a start (the brain settles, the network comes up). */
export const START_DELAY_MS = 2 * 60_000
export const RETRY_MS = 3_600_000

/** `HH:MM`, 24 h. */
export function parseBackupAt(raw: string): BackupAt | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw.trim())
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null
}

/** The next nightly time strictly after `now`, local time. */
export function nextNightly(now: number, at: BackupAt): number {
  const d = new Date(now)
  d.setHours(at.hour, at.minute, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

/** When the first backup after a start runs: a catch-up soon when the last good one is too old, else the nightly. */
export function firstBackupAt(now: number, at: BackupAt, last: BackupState | null): number {
  const lastOk = last?.ok ? Date.parse(last.at) : NaN
  if (!Number.isFinite(lastOk) || now - lastOk > CATCH_UP_AFTER_MS) return Math.min(now + START_DELAY_MS, nextNightly(now, at))
  return nextNightly(now, at)
}

export interface BackupSchedulerOptions {
  at: BackupAt
  run: () => Promise<BackupState>
  last: () => BackupState | null
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

export class BackupScheduler {
  private readonly o: BackupSchedulerOptions
  private timer: unknown = null
  private running: Promise<BackupState> | null = null
  private closed = false
  /** When the next backup is due (ms), null before start or after close. */
  nextAt: number | null = null

  constructor(o: BackupSchedulerOptions) {
    this.o = o
  }

  private now(): number {
    return (this.o.now ?? Date.now)()
  }

  start(): void {
    if (this.closed || this.nextAt !== null) return
    this.plan(firstBackupAt(this.now(), this.o.at, this.o.last()))
  }

  private plan(at: number): void {
    if (this.closed) return
    this.clear()
    this.nextAt = at
    // long delays are cut in steps of at most 6 h (timers drift on a machine that slept; a step re-reads the clock)
    const wait = Math.max(0, Math.min(at - this.now(), 6 * 3_600_000))
    const set = this.o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms).unref())
    this.timer = set(() => {
      this.timer = null
      if (this.now() + 1000 < at) this.plan(at)
      else void this.runNow()
    }, wait)
  }

  /** A backup now (the timer, or by hand); a second call while one runs shares it. Plans the next one. */
  runNow(): Promise<BackupState> {
    if (this.running) return this.running
    this.running = this.o
      .run()
      .then(
        (s) => {
          const next = nextNightly(this.now(), this.o.at)
          this.plan(s.ok && s.cloud !== 'failed' ? next : Math.min(this.now() + RETRY_MS, next))
          return s
        },
        (err: unknown) => {
          this.plan(Math.min(this.now() + RETRY_MS, nextNightly(this.now(), this.o.at)))
          throw err
        }
      )
      .finally(() => {
        this.running = null
      })
    return this.running
  }

  private clear(): void {
    if (this.timer !== null) (this.o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)))(this.timer)
    this.timer = null
  }

  close(): void {
    this.closed = true
    this.nextAt = null
    this.clear()
  }
}
