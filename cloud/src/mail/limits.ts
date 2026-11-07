// Sliding-window counters for the e-mail routes (in memory: a restart forgets them, like the sign-in lockout). A key is
// whatever the caller chooses, so the reset route counts the address it was given whether or not an account uses it.
import type { Clock } from '../clock.ts'
import { CloudError } from '../errors.ts'

export class HitLimiter {
  private readonly clock: Clock
  private readonly windowMs: number
  private readonly max: number
  private readonly hits = new Map<string, number[]>()
  constructor(clock: Clock, windowMs: number, max: number) {
    this.clock = clock
    this.windowMs = windowMs
    this.max = max
  }

  /** Counts one hit; the (max+1)th inside the window is refused with `rate_limited`. A refused hit is not counted. */
  hit(key: string, message = 'too many requests: try again later'): void {
    const now = this.clock.now()
    if (this.hits.size > 10_000) for (const [k, ts] of this.hits) if (ts.every((t) => now - t >= this.windowMs)) this.hits.delete(k)
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      throw new CloudError('rate_limited', message)
    }
    this.hits.set(key, [...recent, now])
  }
}
