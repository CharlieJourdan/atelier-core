// What every real adapter shares: one HTTP call with a timeout and the caller's abort signal, the mapping of HTTP failures
// to RetryableProviderError (the jobs module retries them) or a plain Error (the job fails at once), and the rule that
// no message ever carries the provider key.
//   408, 429, 5xx, network failure, timeout  → retryable
//   401, 403                                  → fatal: the key is wrong or has no right (fix it in the vault)
//   402                                       → fatal: the provider account is out of balance
//   other 4xx                                 → fatal
// A message holds only the label, the status and a short code of the provider's own; the secret value, if it somehow
// appears in a provider text, is replaced by •••. The jobs module masks every message again with the vault.
import { isTestRun, PaidCallBlocked } from './registry.ts'
import { RetryableProviderError } from './types.ts'

export interface HttpOptions {
  /** Tests inject a fake; production uses the global fetch. Without an injected one, a test run is refused. */
  fetchImpl?: typeof fetch
  /** Per request (default 60 s: a synthesis or an analysis can take a while). */
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

export function resolveFetch(o: HttpOptions): typeof fetch {
  if (o.fetchImpl) return o.fetchImpl
  const env = o.env ?? process.env
  return ((input, init) => {
    if (isTestRun(env)) throw new PaidCallBlocked('a test run never reaches the network: inject a fetch')
    return fetch(input, init)
  }) as typeof fetch
}

/** A provider's short text made safe for a message: no secret, no control characters, at most `max` characters. */
export function clean(text: string, secret: string, max = 120): string {
  let out = secret.length >= 4 ? text.split(secret).join('•••') : text
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  return out.length > max ? `${out.slice(0, max)}…` : out
}

export interface CallSpec {
  /** e.g. "MiniMax synthesis": the start of every message. */
  label: string
  url: string
  init: RequestInit
  /** The vault value, only used to keep it out of messages. */
  secret: string
  signal: AbortSignal
  /** From a failed answer's body to a short code of the provider's own (e.g. an error status); never the whole body. */
  detail?: (body: string) => string | undefined
}

/** Maps an HTTP status to the error a job should see. */
export function httpFailure(label: string, status: number, detail: string | undefined): Error {
  const suffix = detail ? ` (${detail})` : ''
  if (status === 408 || status === 429 || status >= 500) return new RetryableProviderError(`${label}: HTTP ${status}${suffix}`)
  if (status === 401 || status === 403) return new Error(`${label}: HTTP ${status}, the key is refused${suffix}`)
  if (status === 402) return new Error(`${label}: HTTP ${status}, the provider account has no balance left${suffix}`)
  return new Error(`${label}: HTTP ${status}${suffix}`)
}

export async function call(spec: CallSpec, o: HttpOptions): Promise<Response> {
  const timeout = AbortSignal.timeout(o.timeoutMs ?? 60_000)
  let res: Response
  try {
    res = await resolveFetch(o)(spec.url, { ...spec.init, signal: AbortSignal.any([spec.signal, timeout]) })
  } catch (err) {
    if (spec.signal.aborted) throw spec.signal.reason ?? err
    if (err instanceof PaidCallBlocked) throw err
    // The cause may quote the request (and so the key): only its kind is kept.
    throw new RetryableProviderError(`${spec.label}: unreachable (${timeout.aborted ? 'timeout' : err instanceof Error ? err.name : 'error'})`)
  }
  if (res.ok) return res
  let detail: string | undefined
  try {
    const body = (await res.text()).slice(0, 4000)
    const d = spec.detail?.(body)
    detail = d ? clean(d, spec.secret, 60) : undefined
  } catch {
    detail = undefined
  }
  throw httpFailure(spec.label, res.status, detail)
}

/** Reads a successful answer's body; a read cut short is retryable, unless the job itself was aborted. */
export async function readBytes(res: Response, label: string, signal: AbortSignal): Promise<Uint8Array> {
  try {
    return new Uint8Array(await res.arrayBuffer())
  } catch (err) {
    if (signal.aborted) throw signal.reason ?? err
    throw new RetryableProviderError(`${label}: the answer was cut short`)
  }
}

export async function readJson(res: Response, label: string, signal: AbortSignal): Promise<unknown> {
  const bytes = await readBytes(res, label, signal)
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
  } catch {
    throw new RetryableProviderError(`${label}: the answer is not JSON`)
  }
}

/** Throws the job's abort reason when the signal fired (between two calls of a multi-call adapter). */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('aborted')
}
