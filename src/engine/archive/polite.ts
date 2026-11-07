// Politeness towards the free public archives (issue #106). Several productions of one team, and several searches inside each,
// reach the same hosts (Wikimedia, archive.org…) from one process; the hosts throttle with 429 / 503 and a `Retry-After`.
//   - `hostGate`: at most HOST_AT_ONCE requests in flight per host, shared by every search of this process;
//   - `retryWait`: how long a throttled answer waits before it is asked again (its `Retry-After`, else a backoff with jitter).
// A request still refused after its retries throws `HttpStatusError`: « throttled » is an error, never « nothing found ».
import { AbortError } from '../errors.ts'

/** Requests in flight at once to one host from this process. */
export const HOST_AT_ONCE = 3
/** Attempts after the first one for a throttled (429) or briefly down (502 / 503 / 504) answer. */
export const DEFAULT_RETRIES = 3
/** Longest wait for one retry, even when the host asks for more. */
export const MAX_RETRY_WAIT_MS = 15_000

export const isThrottled = (status: number): boolean => status === 429 || status === 502 || status === 503 || status === 504

/** The wait before attempt `attempt` (0 = the first retry): `Retry-After` (seconds or a date), else 0.4, 0.8, 1.6 s… with ±40 % jitter. */
export function retryWait(res: Pick<Response, 'headers'> | null, attempt: number, random = Math.random, now = Date.now()): number {
  const header = res?.headers.get('retry-after')?.trim()
  if (header) {
    const s = Number(header)
    if (Number.isFinite(s) && s >= 0) return Math.min(MAX_RETRY_WAIT_MS, Math.round(s * 1000 * (1 + random() * 0.2)))
    const at = Date.parse(header)
    if (Number.isFinite(at)) return Math.min(MAX_RETRY_WAIT_MS, Math.max(0, at - now))
  }
  return Math.min(MAX_RETRY_WAIT_MS, Math.round(400 * 2 ** attempt * (0.6 + random() * 0.8)))
}

export const sleepMs = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', stop)
      resolve()
    }, ms)
    function stop(): void {
      clearTimeout(t)
      reject(new AbortError())
    }
    signal?.addEventListener('abort', stop, { once: true })
  })

class Gate {
  private used = 0
  private readonly waiting: (() => void)[] = []
  async take(signal?: AbortSignal): Promise<() => void> {
    while (this.used >= HOST_AT_ONCE) {
      if (signal?.aborted) throw new AbortError()
      await new Promise<void>((resolve) => {
        const wake = (): void => {
          signal?.removeEventListener('abort', wake)
          resolve()
        }
        this.waiting.push(wake)
        signal?.addEventListener('abort', wake, { once: true })
      })
    }
    if (signal?.aborted) throw new AbortError()
    this.used++
    let done = false
    return () => {
      if (done) return
      done = true
      this.used--
      this.waiting.shift()?.()
    }
  }
}

const gates = new Map<string, Gate>()

/** A slot to send one request to `host` (shared by every search of this process); call the returned function when it ends. */
export function hostGate(host: string, signal?: AbortSignal): Promise<() => void> {
  let g = gates.get(host)
  if (!g) gates.set(host, (g = new Gate()))
  return g.take(signal)
}
