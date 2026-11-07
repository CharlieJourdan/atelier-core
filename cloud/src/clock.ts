// Injectable time: every expiry (tokens, quotes, holds, signed links) reads this, so tests move time by hand.
export interface Clock {
  now(): number
}

export const systemClock: Clock = { now: () => Date.now() }

export class ManualClock implements Clock {
  private t: number
  constructor(start = Date.UTC(2026, 9, 19, 9, 0, 0)) {
    this.t = start
  }
  now(): number {
    return this.t
  }
  advance(ms: number): void {
    this.t += ms
  }
  set(ms: number): void {
    this.t = ms
  }
}

export const iso = (ms: number): string => new Date(ms).toISOString()
export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS
