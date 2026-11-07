// Errors, retries and time (docs/ENGINE-SPEC.md §10). Time and randomness are injected so the engine behaves the same
// on every host and tests run instantly with a fake clock.

/** Stable codes of node errors; the user sees a French phrase per code, never a raw message (R8.5). */
export const ERROR_CODES = [
  'transient', // network, provider overloaded, machine reclaimed: retried (R10.1)
  'bad_params', // params invalid once resolved
  'unknown_ref', // a `$style` field missing at run start
  'missing_input', // a required input not provided
  'bad_output', // the node broke its contract (missing, undeclared or ill-typed output, R2.2)
  'refused', // content refused by a provider
  'budget', // the reservation would cross the video's credit cap (R12.5)
  // lot P4 (ENGINE-SPEC R15.5): stage failures with a clear cause
  'missing_tool', // a program the node needs (ffmpeg…) or an injected service is not available
  'bad_input', // an input artefact is unusable (empty script, unreadable audio…)
  'schema', // a structured answer or artefact fails its schema after the allowed repairs
  'verify_failed', // the render failed its own verification (R28.4)
  'internal', // anything else thrown by a node
  'stalled', // the node showed no sign of life for its watchdog's limit: stopped, then retried like a transient error
  'change_requested' // not a failure: the code of the `retry` event when the user asks for a change at a gate (R11.3)
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export class EngineError extends Error {
  override name = 'EngineError'
  readonly code: ErrorCode
  readonly permanent: boolean
  constructor(code: ErrorCode, message: string, permanent = code !== 'transient') {
    super(message)
    this.code = code
    this.permanent = permanent
  }
}

/** Thrown (or rejected) when work stops because of a cancel (R2.3). */
export class AbortError extends Error {
  override name = 'AbortError'
  constructor(message = 'cancelled') {
    super(message)
  }
}

export const isAbortError = (e: unknown): boolean =>
  e instanceof Error && (e.name === 'AbortError' || (e as { code?: unknown }).code === 'ABORT_ERR')

/** Anything a node throws that is not an `EngineError` is a permanent internal error (never retried blindly). */
export function toEngineError(e: unknown): EngineError {
  if (e instanceof EngineError) return e
  return new EngineError('internal', e instanceof Error ? e.message : String(e))
}

export interface Clock {
  now(): number
  /** Resolves after `ms`, or rejects with an `AbortError` as soon as `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AbortError())
        return
      }
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(new AbortError())
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
}

export interface RetryPolicy {
  /** Retries after the first attempt (R10.1: 3). */
  retries: number
  /** Base waits before retry 1, 2, 3… (the last one repeats); decision: 2 s, 8 s, 30 s. */
  delaysMs: readonly number[]
  /** ± fraction of each wait drawn at random (decision: 0.2), so many failing nodes do not retry in step. */
  jitter: number
}

export const DEFAULT_RETRY: RetryPolicy = { retries: 3, delaysMs: [2_000, 8_000, 30_000], jitter: 0.2 }

/** Wait before retry number `retry` (1-based). `random` returns [0,1). Never negative, always grows on average. */
export function backoffMs(policy: RetryPolicy, retry: number, random: () => number): number {
  const base = policy.delaysMs[Math.min(retry, policy.delaysMs.length) - 1] ?? 0
  const spread = base * policy.jitter
  return Math.max(0, Math.round(base - spread + 2 * spread * random()))
}

/** Small seeded generator (mulberry32) for jitter, so a run is reproducible when its seed is fixed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
