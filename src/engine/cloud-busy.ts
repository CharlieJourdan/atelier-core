// A busy Atelier Cloud (production-17): a 429 is « occupé », never « injoignable ». The first real 60 s run sent the clips'
// start stills, the portrait and the voice for HeyGen at once; the Cloud takes a few uploads per team at a time and answered
// the next one 429 at once, the client gave up. Here:
//   - `busyRetry`: a request answered 429 is sent again after the Cloud's `Retry-After` (else 1, 2, 4… s, at most 15 s), for
//     up to BUSY_BUDGET_MS in all, with jitter, and the wait is SHARED: once one request of this process is told to wait, every
//     request to that Cloud waits with it (then leaves staggered), so N productions do not hammer a Cloud that asked for a pause;
//     past that the 429 is the caller's to report (« Atelier Cloud est occupé »);
//   - `uploadSlot`: every client of one Cloud in this process sends at most UPLOADS_AT_ONCE files at a time (a small queue),
//     under the Cloud's per-team budget (cloud/src/http/bodies.ts), leaving room for the team's other machine.
import { AbortError } from './errors.ts'

/** How long a busy Cloud is waited for before the request fails (a run's own time is much longer: a 429 is never its end). */
export const BUSY_BUDGET_MS = 300_000
/** Files sent at once to one Cloud from this process (the Cloud's per-team budget is 4). */
export const UPLOADS_AT_ONCE = 4

/** The wait a 429 asks for: its `Retry-After` (seconds, or an HTTP date), else the backoff of this attempt. */
export function busyWaitMs(res: Response | null, attempt: number, now = Date.now()): number {
  const header = res?.headers.get('retry-after')?.trim()
  if (header) {
    const s = Number(header)
    if (Number.isFinite(s) && s >= 0) return Math.min(60_000, s * 1000)
    const at = Date.parse(header)
    if (Number.isFinite(at)) return Math.min(60_000, Math.max(0, at - now))
  }
  return Math.min(15_000, 1000 * 2 ** attempt)
}

/** When each Cloud (by base URL) next accepts a request from this process, set by the last 429 it answered. */
const coolUntil = new Map<string, number>()
const jitter = (ms: number): number => Math.round(ms * (1 + Math.random() * 0.25))

const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortError())
    const t = setTimeout(done, ms)
    function done(): void {
      signal.removeEventListener('abort', stop)
      resolve()
    }
    function stop(): void {
      clearTimeout(t)
      reject(new AbortError())
    }
    signal.addEventListener('abort', stop, { once: true })
  })

/**
 * Sends `send()` again while it answers 429, waiting as the Cloud asks, until `budgetMs` is spent; answers the last response
 * (a 429 when the Cloud stayed busy). `onWait` is told each wait (logs, tests).
 */
export async function busyRetry(
  send: () => Promise<Response>,
  signal: AbortSignal,
  o: { budgetMs?: number; onWait?: (ms: number) => void; key?: string } = {}
): Promise<Response> {
  const deadline = Date.now() + (o.budgetMs ?? BUSY_BUDGET_MS)
  for (let attempt = 0; ; attempt++) {
    // a pause another request of this process was told to take is taken by this one too, then each leaves at its own moment
    const shared = o.key === undefined ? 0 : (coolUntil.get(o.key) ?? 0) - Date.now()
    if (shared > 0) await pause(shared + Math.round(Math.random() * 500), signal)
    const res = await send()
    if (res.status !== 429) return res
    const wait = jitter(busyWaitMs(res, attempt))
    if (Date.now() + wait > deadline) return res
    await res.arrayBuffer().catch(() => undefined)
    o.onWait?.(wait)
    if (o.key !== undefined) coolUntil.set(o.key, Math.max(coolUntil.get(o.key) ?? 0, Date.now() + wait))
    await pause(wait, signal)
  }
}

/** A counting semaphore: `take` resolves with its release once a slot is free. */
class Slots {
  private used = 0
  private readonly waiting: (() => void)[] = []
  private readonly size: number
  constructor(size: number) {
    this.size = size
  }
  async take(signal: AbortSignal): Promise<() => void> {
    while (this.used >= this.size) {
      if (signal.aborted) throw new AbortError()
      await new Promise<void>((resolve) => this.waiting.push(resolve))
      if (signal.aborted) {
        // a stopped waiter hands its turn on
        this.waiting.shift()?.()
        throw new AbortError()
      }
    }
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

const slots = new Map<string, Slots>()

/** A slot to send one file to the Cloud at `baseUrl` (shared by every client of that Cloud in this process). */
export function uploadSlot(baseUrl: string, signal: AbortSignal): Promise<() => void> {
  return slotFor(baseUrl, UPLOADS_AT_ONCE, signal)
}

/** Media searches sent at once to one Cloud from this process (each fans out to a dozen free APIs on the Cloud). */
export const SEARCHES_AT_ONCE = 4

/** A slot among `size` for the named queue (shared by every client of that queue in this process). */
export function slotFor(queue: string, size: number, signal: AbortSignal): Promise<() => void> {
  let s = slots.get(queue)
  if (!s) slots.set(queue, (s = new Slots(size)))
  return s.take(signal)
}
