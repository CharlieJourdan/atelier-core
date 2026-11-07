// RunPod's completion callback (lot P5). The callback URL of a Cloud job carries `sig` = HMAC-SHA256 of
// "runpod-callback\n<jobId>" with the Cloud's signing key (base64url): the URL itself is the credential, so a callback
// for one job cannot be forged or replayed onto another. A verified callback only wakes the adapter waiting on that
// job; the adapter then asks RunPod for the job's status (the callback body is never trusted for the result).
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface Waiters {
  /** Resolves with the next callback body delivered for `jobId`; rejects when `signal` aborts. */
  wait(jobId: string, signal: AbortSignal): Promise<unknown>
  /** Hands a callback body to whoever waits on `jobId`; false when nobody does. */
  deliver(jobId: string, body: unknown): boolean
}

export class RunpodWebhooks implements Waiters {
  private readonly key: Buffer
  private readonly waiting = new Map<string, Set<(body: unknown) => void>>()

  constructor(signingKey: Buffer) {
    if (signingKey.length < 32) throw new Error('the signing key must be at least 32 bytes')
    this.key = signingKey
  }

  sign(jobId: string): string {
    return createHmac('sha256', this.key).update(`runpod-callback\n${jobId}`).digest('base64url')
  }

  /** Constant-time check of a callback signature; false for any defect. */
  verify(jobId: string, sig: string | undefined): boolean {
    if (typeof sig !== 'string' || sig.length === 0 || sig.length > 200) return false
    const expected = Buffer.from(this.sign(jobId))
    const given = Buffer.from(sig)
    return expected.length === given.length && timingSafeEqual(expected, given)
  }

  /** The signed callback path of a job (relative to the Cloud's public URL). */
  callbackPath(jobId: string): string {
    return `/v1/runpod/webhook/${encodeURIComponent(jobId)}?sig=${this.sign(jobId)}`
  }

  wait(jobId: string, signal: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason ?? new Error('aborted'))
      let set = this.waiting.get(jobId)
      if (!set) this.waiting.set(jobId, (set = new Set()))
      const done = (body: unknown): void => {
        cleanup()
        resolve(body)
      }
      const onAbort = (): void => {
        cleanup()
        reject(signal.reason ?? new Error('aborted'))
      }
      const cleanup = (): void => {
        signal.removeEventListener('abort', onAbort)
        set.delete(done)
        if (set.size === 0 && this.waiting.get(jobId) === set) this.waiting.delete(jobId)
      }
      set.add(done)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  deliver(jobId: string, body: unknown): boolean {
    const set = this.waiting.get(jobId)
    if (!set || set.size === 0) return false
    for (const fn of [...set]) fn(body)
    return true
  }

  /** Jobs with a waiter (tests). */
  pending(): string[] {
    return [...this.waiting.keys()]
  }
}
