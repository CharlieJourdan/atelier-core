// One polite HTTP layer for every archive: the descriptive User-Agent, a timeout per request, the caller's abort signal,
// an injectable `fetch`. Sources call it one request at a time.
import type { ArchiveDeps } from './types.ts'
import { DEFAULT_RETRIES, hostGate, isThrottled, retryWait, sleepMs } from './polite.ts'
import { rec, type Json } from './util.ts'

export const ARCHIVE_USER_AGENT = 'Atelier/1.0 (https://github.com/CharlieJourdan/atelier-core; documentary archive search)'
export const DEFAULT_TIMEOUT_MS = 8000

export interface HttpDeps {
  fetch: typeof fetch
  signal?: AbortSignal
  timeoutMs: number
  /** Retries after a throttled answer (default DEFAULT_RETRIES); tests may pass 0. */
  retries?: number
  /** The pause between two attempts (default: a real timer); tests pass an instant one. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export function resolveDeps(d: ArchiveDeps = {}): HttpDeps {
  return { fetch: d.fetch ?? globalThis.fetch, signal: d.signal, timeoutMs: d.timeoutMs ?? DEFAULT_TIMEOUT_MS, ...(d.retries !== undefined ? { retries: d.retries } : {}), ...(d.sleep ? { sleep: d.sleep } : {}) }
}

/** The signal of one request: the caller's, plus the timeout. */
export function requestSignal(d: HttpDeps, timeoutMs = d.timeoutMs): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return d.signal ? AbortSignal.any([d.signal, timeout]) : timeout
}

export class HttpStatusError extends Error {
  readonly status: number
  constructor(status: number, url: string) {
    super(`HTTP ${status} from ${new URL(url).host}`)
    this.name = 'HttpStatusError'
    this.status = status
  }
}

/**
 * GET (or a ranged GET) with the User-Agent; throws `HttpStatusError` on a non-2xx answer. At most a few requests per host at
 * once (shared by the whole process); a throttled answer (429 / 502 / 503 / 504) is asked again after its `Retry-After`, else a
 * jittered backoff, before it is reported (`init.retries` overrides, 0 = never).
 */
export async function get(url: string, d: HttpDeps, init: { headers?: Record<string, string>; timeoutMs?: number; retries?: number } = {}): Promise<Response> {
  const retries = init.retries ?? d.retries ?? DEFAULT_RETRIES
  const sleep = d.sleep ?? sleepMs
  const host = new URL(url).host
  for (let attempt = 0; ; attempt++) {
    const release = await hostGate(host, d.signal)
    let res: Response
    try {
      res = await d.fetch(url, {
        method: 'GET',
        headers: { 'user-agent': ARCHIVE_USER_AGENT, accept: '*/*', ...init.headers },
        signal: requestSignal(d, init.timeoutMs),
        redirect: 'follow'
      })
    } finally {
      release()
    }
    if (res.ok) return res
    await res.body?.cancel().catch(() => undefined)
    if (!isThrottled(res.status) || attempt >= retries) throw new HttpStatusError(res.status, url)
    await sleep(retryWait(res, attempt), d.signal)
  }
}

export async function getJson(url: string, d: HttpDeps): Promise<Json> {
  const res = await get(url, d, { headers: { accept: 'application/json' } })
  try {
    return rec(await res.json())
  } catch {
    throw new Error(`unreadable JSON from ${new URL(url).host}`)
  }
}

/** The first `n` bytes of a response body, then the stream is cancelled (a server that ignores `Range` still costs little). */
export async function readHead(res: Response, n: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < n) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const out = new Uint8Array(Math.min(total, n))
  let at = 0
  for (const c of chunks) {
    const take = Math.min(c.byteLength, out.length - at)
    if (take <= 0) break
    out.set(c.subarray(0, take), at)
    at += take
  }
  return out
}
