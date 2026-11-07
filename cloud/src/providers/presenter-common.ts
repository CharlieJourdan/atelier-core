// What the presenter engines' adapters share (production-7, decision 0034): the checks made before any call (length, resolution),
// the price of a clip, the files read from our own storage (short signed links, decision 0025: the provider key is never sent to
// them), the resume handle kept with the job, and the polling pause.
import type { z } from 'zod'
import type { UsageInput } from '../../../src/shared/cloud-api.ts'
import { defaultResolution, PRESENTER_ENGINE_CAN, type PresenterEngine, type PresenterResolution } from '../../../src/shared/presenter-engines.ts'
import { call, readBytes } from './http.ts'
import type { HttpOptions } from './http.ts'
import { RetryableProviderError, type ProviderContext } from './types.ts'

export type AvatarInput = UsageInput<'talkingAvatar'>

/** USD for `seconds` of clip on an engine at a resolution (the engine's table, PRESENTER_ENGINE_CAN). */
export function engineCostUsd(engine: PresenterEngine, resolution: PresenterResolution, seconds: number): number {
  const rate = PRESENTER_ENGINE_CAN[engine].usdPerS[resolution]
  if (rate === undefined) throw new Error(`${engine} has no price for ${resolution}`)
  return seconds * rate
}

/** The resolution of a call (the job's, else the engine's default); refuses one the engine does not make. */
export function resolutionOf(engine: PresenterEngine, input: AvatarInput, label: string): PresenterResolution {
  const resolution = input.resolution ?? defaultResolution(engine)
  if (!PRESENTER_ENGINE_CAN[engine].resolutions.includes(resolution)) throw new Error(`${label}: ${resolution} is not a resolution of ${engine}`)
  return resolution
}

/** Refuses, before any call, a clip longer than the engine takes in one call or a job without its voice audio. */
export function checkCall(engine: PresenterEngine, input: AvatarInput, label: string): void {
  const max = PRESENTER_ENGINE_CAN[engine].maxCallS
  if (input.seconds > max) throw new Error(`${label}: a call is at most ${max} seconds (${engine}), cut the audio`)
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i

/**
 * A file of the job's team as a link a provider can fetch: https and a public host. A Cloud that only listens on the loopback
 * (no `publicUrl` in config.json) gives links nobody else can reach: refused here with the way out, instead of a provider error.
 */
export function remoteLink(ctx: ProviderContext, artefactId: string, label: string): { name: string; url: string } {
  const a = ctx.artefact(artefactId)
  let u: URL
  try {
    u = new URL(a.url)
  } catch {
    throw new Error(`${label}: the file link is malformed`)
  }
  if (u.protocol !== 'https:' || PRIVATE_HOST.test(u.hostname)) {
    throw new Error(`${label}: the signed file link (${u.protocol}//${u.hostname}) cannot be reached by the provider: set a public https "publicUrl" in config.json`)
  }
  return a
}

/** A file of the job's team as bytes, read from our own signed link (no provider key is sent). */
export async function fetchStored(ctx: ProviderContext, artefactId: string, label: string, what: string, o: HttpOptions): Promise<{ name: string; bytes: Uint8Array }> {
  const a = ctx.artefact(artefactId)
  const res = await call({ label: `${label} ${what}`, url: a.url, secret: '', signal: ctx.signal, init: { method: 'GET' } }, o)
  return { name: a.name, bytes: await readBytes(res, `${label} ${what}`, ctx.signal) }
}

/** The handle stored with the job by an earlier attempt, if it parses as `schema`. */
export function savedRef<S extends z.ZodType>(ctx: ProviderContext, schema: S): z.infer<S> | null {
  const saved = ctx.providerRef()
  if (!saved) return null
  try {
    const r = schema.safeParse(JSON.parse(saved))
    return r.success ? (r.data as z.infer<S>) : null
  } catch {
    return null
  }
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

/** A short provider error text from a failed answer's body (`detail`, `message` or `error`), never the whole body. */
export const errorDetail = (body: string): string | undefined => {
  try {
    const j = JSON.parse(body) as { detail?: unknown; message?: unknown; error?: unknown }
    const pick = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'object' && v !== null && typeof (v as { message?: unknown }).message === 'string' ? (v as { message: string }).message : undefined)
    return pick(j.detail) ?? pick(j.message) ?? pick(j.error)
  } catch {
    return undefined
  }
}

/** Seconds billed: the length the provider reports when it is a number, rounded up, else the requested length. */
export const billedSeconds = (reported: number | null | undefined, requested: number): number =>
  typeof reported === 'number' && Number.isFinite(reported) && reported > 0 ? Math.max(1, Math.ceil(reported - 1e-9)) : requested

/**
 * Runs the call that STARTS paid work. If its answer was lost (timeout, 5xx) the provider may have accepted and billed it, so the
 * failure is not retryable (a retry would pay twice); a 429 means it was refused before starting, which a retry may repeat.
 */
export async function startOnce<T>(start: () => Promise<T>): Promise<T> {
  try {
    return await start()
  } catch (err) {
    if (err instanceof RetryableProviderError && !/HTTP 429/.test(err.message)) throw new Error(`${err.message}; the start was not confirmed, so it is not retried`, { cause: err })
    throw err
  }
}
