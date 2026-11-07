// A fetch that never leaves the process: it records every request and answers from a handler. Used to test the real
// adapters (providers/minimax.ts, elevenlabs.ts, gemini.ts) without any network and without any real key.
import type { ProviderContext } from '../src/providers/types.ts'

export interface Recorded {
  url: string
  method: string
  headers: Record<string, string>
  body: string
  /** A multipart body (FormData): text fields as strings, files as their name, type and size. */
  form?: Record<string, string | { name: string; type: string; size: number }>
}

export type Handler = (req: Recorded, n: number) => Response | Promise<Response>

export function fakeFetch(handler: Handler): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = []
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal
    if (signal?.aborted) throw signal.reason
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v
    const req: Recorded = { url: String(input), method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : '' }
    if (init?.body instanceof FormData) {
      req.form = {}
      for (const [k, v] of init.body.entries()) req.form[k] = typeof v === 'string' ? v : { name: v.name, type: v.type, size: v.size }
    }
    calls.push(req)
    const answer = Promise.resolve(handler(req, calls.length))
    if (!signal) return answer
    // Like the real fetch: an abort while the answer is pending rejects with the signal's reason.
    return Promise.race([
      answer,
      new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    ])
  }
  return { fetch: impl as typeof fetch, calls }
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export function ctxFor(secret: string, signal: AbortSignal = new AbortController().signal, quota?: ProviderContext['quota']): ProviderContext {
  const refuse = (): never => {
    throw new Error('not used')
  }
  return {
    signal,
    progress: () => undefined,
    secret: () => secret,
    jobId: 'job_test',
    artefact: refuse,
    artefactUrl: refuse,
    callbackUrl: refuse,
    providerRef: () => null,
    setProviderRef: () => undefined,
    ...(quota ? { quota } : {})
  }
}
