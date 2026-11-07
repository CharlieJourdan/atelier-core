// What the still and clip engine adapters (production-8) share: the « Avoid: … » negative for an engine without a field of its
// own, the reading of a reference image or a start still from the team's artefacts (the Cloud's own signed link, the provider
// key is never sent to it), the refusal error a content-policy stop turns into, the polling loop of a long job, and the
// price line of an engine from the registry.
import { FAKE_ENGINES } from './engines.ts'
import { throwIfAborted, type HttpOptions } from './http.ts'
import { downloadFile } from './stock-common.ts'
import { RetryableProviderError, type ProviderContext } from './types.ts'

/** An engine without a negative-prompt field gets it as the last sentence of the prompt. */
export const withAvoid = (prompt: string, negative: string | undefined): string => (negative ? `${prompt}\n\nAvoid: ${negative}` : prompt)

/** The registry's price of one unit of an engine (image, clip or second): the line `costUsd` is reported from. */
export function engineUsd(engineId: string): number {
  const e = FAKE_ENGINES.find((x) => x.id === engineId)
  if (!e) throw new Error(`${engineId} is not in the engines registry`)
  return e.costUsdPerUnit
}

/** A content-policy stop: never retried, and the job's reason starts with `refused:` so the person reads why. */
export function refusal(label: string, why: string): Error {
  return new Error(`refused: ${label}: ${why}`)
}

/** Runs `p`; a non-retryable failure whose message matches `re` becomes a `refused:` error (a retryable one is left as it is). */
export async function refusedWhen<T>(p: Promise<T>, re: RegExp, label: string): Promise<T> {
  try {
    return await p
  } catch (err) {
    if (err instanceof Error && !(err instanceof RetryableProviderError) && re.test(err.message)) {
      throw refusal(label, err.message.replace(/^[^:]*:\s*/, ''))
    }
    throw err
  }
}

export const REFERENCE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** One team artefact (an image) read through its signed link. */
export async function fetchArtefactImage(ctx: ProviderContext, artefactId: string, label: string, o: HttpOptions): Promise<{ bytes: Buffer; mime: string }> {
  const got = await downloadFile(`${label} reference download`, ctx.artefactUrl(artefactId), REFERENCE_MIMES, ctx.signal, o)
  if (!got) throw new Error(`${label}: a reference image could not be read (not a PNG, JPEG or WebP picture, empty, or over 40 MB)`)
  return { bytes: Buffer.from(got.bytes), mime: got.mime }
}

export const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error('aborted'))
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(signal.reason ?? new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

export interface PollOptions extends HttpOptions {
  /** Between two polls (default 5 s; tests use 0). */
  pollMs?: number
  /** Give up with a retryable error that a retry resumes (default 15 minutes). */
  maxWaitMs?: number
}

export type PollStep<T> = { done: true; value: T } | { done: false; progress?: number }

/** Calls `step` until it is done; a job still running at the deadline is a retryable error (the providerRef resumes it). */
export async function pollUntil<T>(label: string, o: PollOptions, ctx: ProviderContext, step: () => Promise<PollStep<T>>): Promise<T> {
  const deadline = Date.now() + (o.maxWaitMs ?? 15 * 60_000)
  for (;;) {
    throwIfAborted(ctx.signal)
    const r = await step()
    if (r.done) return r.value
    if (r.progress !== undefined) ctx.progress(r.progress)
    if (Date.now() > deadline) throw new RetryableProviderError(`${label}: still not finished, will resume`)
    await sleep(o.pollMs ?? 5000, ctx.signal)
  }
}

/** A provider handle stored with the job as JSON; null when absent or not of the expected shape. */
export function readRef<T>(saved: string | null, parse: (v: unknown) => T | null): T | null {
  if (!saved) return null
  try {
    return parse(JSON.parse(saved))
  } catch {
    return null
  }
}
