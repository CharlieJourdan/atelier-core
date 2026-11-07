// A small client of RunPod's serverless API, written from its public documentation:
//   POST {base}/{endpointId}/run          body { input, webhook?, policy? }  → { id, status }
//   GET  {base}/{endpointId}/status/{id}                            → { id, status, output?, error?, executionTime?, delayTime? }
//   POST {base}/{endpointId}/cancel/{id}                            → { id, status }
// with `Authorization: Bearer <key>`. Network failures, 5xx and 429 are retryable; 401/403/404 and other refusals are
// not. The key is read at call time and never appears in an error message.
import { z } from 'zod'
import { RetryableProviderError } from '../providers/types.ts'

export const RUNPOD_STATUSES = ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'] as const
export type RunpodState = (typeof RUNPOD_STATUSES)[number]
export const RUNPOD_TERMINAL: readonly RunpodState[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT']

export const RunpodStatus = z
  .object({
    id: z.string().min(1).max(200),
    status: z.enum(RUNPOD_STATUSES),
    output: z.unknown().optional(),
    error: z.unknown().optional(),
    executionTime: z.number().optional(),
    delayTime: z.number().optional()
  })
  .passthrough()
export type RunpodStatus = z.infer<typeof RunpodStatus>

export interface RunpodClientOptions {
  /** e.g. https://api.runpod.ai/v2, or the fake RunPod's http://127.0.0.1:<port>. */
  baseUrl: string
  apiKey: () => string
  fetchImpl?: typeof fetch
  /** Per request (default 30 s). */
  timeoutMs?: number
}

export interface RunpodPolicy {
  executionTimeout?: number
  ttl?: number
  lowPriority?: boolean
}

export class RunpodClient {
  private readonly o: RunpodClientOptions
  constructor(o: RunpodClientOptions) {
    this.o = o
  }

  /** `policy` is RunPod's execution policy: `executionTimeout` and `ttl` in milliseconds (the cost ceiling of a job). */
  run(endpointId: string, input: unknown, webhook?: string, signal?: AbortSignal, policy?: RunpodPolicy): Promise<RunpodStatus> {
    return this.call('run', 'POST', `${seg(endpointId)}/run`, { input, ...(webhook ? { webhook } : {}), ...(policy ? { policy } : {}) }, signal)
  }

  status(endpointId: string, id: string, signal?: AbortSignal): Promise<RunpodStatus> {
    return this.call('status', 'GET', `${seg(endpointId)}/status/${seg(id)}`, undefined, signal)
  }

  cancel(endpointId: string, id: string, signal?: AbortSignal): Promise<RunpodStatus> {
    return this.call('cancel', 'POST', `${seg(endpointId)}/cancel/${seg(id)}`, undefined, signal)
  }

  private async call(label: string, method: 'GET' | 'POST', path: string, body: unknown, signal?: AbortSignal): Promise<RunpodStatus> {
    const timeout = AbortSignal.timeout(this.o.timeoutMs ?? 30_000)
    const url = `${this.o.baseUrl.replace(/\/+$/, '')}/${path}`
    const what = `RunPod ${label}`
    let res: Response
    try {
      res = await (this.o.fetchImpl ?? fetch)(url, {
        method,
        headers: { authorization: `Bearer ${this.o.apiKey()}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      })
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err
      // The cause may quote the request; only its kind is kept.
      throw new RetryableProviderError(`${what}: unreachable (${err instanceof Error ? err.name : 'error'})`)
    }
    if (res.status >= 500 || res.status === 429) {
      await res.body?.cancel()
      throw new RetryableProviderError(`${what}: HTTP ${res.status}`)
    }
    if (!res.ok) {
      await res.body?.cancel()
      throw new Error(`${what}: HTTP ${res.status}`)
    }
    let json: unknown
    try {
      json = await res.json()
    } catch {
      throw new RetryableProviderError(`${what}: the answer is not JSON`)
    }
    const parsed = RunpodStatus.safeParse(json)
    if (!parsed.success) throw new Error(`${what}: unexpected answer (${parsed.error.issues[0]?.path.join('.') || 'shape'})`)
    return parsed.data
  }
}

const seg = (s: string): string => encodeURIComponent(s)
