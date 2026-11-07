// The serverless providers that start the render worker image (vps-rendu, decision 0084), each behind `RenderStarter`
// (src/shared/render-job.ts): the job's link goes in, the provider's run handle comes out, its state and billed seconds are
// read back. WRITTEN FROM THE PROVIDERS' PUBLIC DOCS (read 2026-11-03), NEVER CALLED WITHOUT ITS KEYS: each starter takes its
// secrets as functions the vault answers (`npm run cloud -- vault set NAME`), and `render status` lists which are present.
//   - Scaleway Serverless Jobs (v1alpha2; sdk-go api/jobs/v1alpha2 + docs-content serverless-jobs): `X-Auth-Token`; start a
//     job definition with per-run `environment_variables`; GET the job run (`state`, `run_duration`, `started_at`,
//     `terminated_at`, `error_message`); `POST …/stop` to cancel. The definition (image, 6000 mvCPU, 12288 MiB, timeout) is made
//     once by hand (deploy/render-worker/README.md).
//   - Modal: our own app (deploy/render-worker/modal_app.py), one ASGI endpoint behind proxy auth (`Modal-Key`,
//     `Modal-Secret`): POST /submit spawns the function, GET /result?call_id= answers 202 while it runs, POST /cancel.
//   - RunPod serverless (api.runpod.ai/v2): /run with `policy.executionTimeout` (ms), /status (`executionTime` ms), /cancel;
//     the image's handler (deploy/render-worker/runpod_handler.py) runs the worker with the job's link.
import type { RenderRunState, RenderRunStatus, RenderStarter } from '../../../src/shared/render-job.ts'
import { RunpodClient } from '../runpod/client.ts'

const API = 'https://api.scaleway.com/serverless-jobs/v1alpha2'

async function answer(res: Response, what: string): Promise<unknown> {
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200)
    throw new Error(`${what}: HTTP ${res.status}${text ? ` ${text}` : ''}`)
  }
  return res.status === 204 ? {} : res.json()
}

/** "123.456s" (a protobuf Duration as JSON) → seconds. */
export function durationS(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return undefined
  const m = /^(\d+(?:\.\d+)?)s$/.exec(v.trim())
  return m ? Number(m[1]) : undefined
}

const SCALEWAY_STATE: Record<string, RenderRunState> = {
  unknown_state: 'queued',
  initialized: 'queued',
  validated: 'queued',
  queued: 'queued',
  scheduled: 'queued',
  retrying: 'queued',
  running: 'running',
  interrupting: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  internal_error: 'failed',
  interrupted: 'cancelled',
  canceled: 'cancelled'
}

export interface ScalewayOptions {
  secretKey: () => string
  jobDefinitionId: () => string
  region?: string
  fetchImpl?: typeof fetch
  baseUrl?: string
}

export function scalewayStarter(o: ScalewayOptions): RenderStarter {
  const f = o.fetchImpl ?? fetch
  const base = `${(o.baseUrl ?? API).replace(/\/+$/, '')}/regions/${o.region ?? 'fr-par'}`
  const headers = (): Record<string, string> => ({ 'X-Auth-Token': o.secretKey(), 'content-type': 'application/json' })
  return {
    id: 'scaleway',
    async start(jobUrl, s) {
      const res = await f(`${base}/job-definitions/${encodeURIComponent(o.jobDefinitionId())}/start`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ environment_variables: { ATELIER_JOB_URL: jobUrl, ATELIER_JOB_ID: s.jobId } }),
        signal: AbortSignal.any([s.signal, AbortSignal.timeout(30_000)])
      })
      const body = (await answer(res, 'Scaleway start')) as { job_runs?: { id?: string }[] }
      const id = body.job_runs?.[0]?.id
      if (!id) throw new Error('Scaleway start: no job run in the answer')
      return id
    },
    async status(ref, signal) {
      const res = await f(`${base}/job-runs/${encodeURIComponent(ref)}`, { headers: headers(), signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
      const run = (await answer(res, 'Scaleway job run')) as { state?: string; run_duration?: unknown; started_at?: string | null; terminated_at?: string | null; error_message?: string | null; reason?: string | null; exit_code?: number | null }
      const state = SCALEWAY_STATE[run.state ?? ''] ?? 'queued'
      const ended = state === 'succeeded' || state === 'failed' || state === 'cancelled'
      const span = run.started_at && run.terminated_at ? (Date.parse(run.terminated_at) - Date.parse(run.started_at)) / 1000 : undefined
      const billedS = durationS(run.run_duration) ?? span
      const error = run.error_message || run.reason || (run.exit_code ? `exit ${run.exit_code}` : undefined)
      return { state, ...(ended && billedS !== undefined ? { billedS } : {}), ...(state === 'failed' && error ? { error } : {}) }
    },
    async cancel(ref) {
      const res = await f(`${base}/job-runs/${encodeURIComponent(ref)}/stop`, { method: 'POST', headers: headers(), body: '{}', signal: AbortSignal.timeout(30_000) })
      await res.body?.cancel()
    }
  }
}

export interface ModalOptions {
  /** The app's ASGI endpoint, e.g. https://<workspace>--atelier-render-web.modal.run */
  url: () => string
  key: () => string
  secret: () => string
  fetchImpl?: typeof fetch
}

export function modalStarter(o: ModalOptions): RenderStarter {
  const f = o.fetchImpl ?? fetch
  const at = (p: string): string => `${o.url().replace(/\/+$/, '')}${p}`
  const headers = (): Record<string, string> => ({ 'Modal-Key': o.key(), 'Modal-Secret': o.secret(), 'content-type': 'application/json' })
  return {
    id: 'modal',
    async start(jobUrl, s) {
      const res = await f(at('/submit'), { method: 'POST', headers: headers(), body: JSON.stringify({ jobUrl, timeoutS: s.timeoutS }), signal: AbortSignal.any([s.signal, AbortSignal.timeout(60_000)]) })
      const body = (await answer(res, 'Modal submit')) as { callId?: string }
      if (!body.callId) throw new Error('Modal submit: no call id in the answer')
      return body.callId
    },
    async status(ref, signal): Promise<RenderRunStatus> {
      const res = await f(at(`/result?call_id=${encodeURIComponent(ref)}`), { headers: headers(), signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
      if (res.status === 202) {
        await res.body?.cancel()
        return { state: 'running' }
      }
      const body = (await answer(res, 'Modal result')) as { state?: string; billedS?: number; error?: string }
      const state: RenderRunState = body.state === 'succeeded' ? 'succeeded' : body.state === 'cancelled' ? 'cancelled' : 'failed'
      return { state, ...(typeof body.billedS === 'number' ? { billedS: body.billedS } : {}), ...(body.error ? { error: body.error } : {}) }
    },
    async cancel(ref) {
      const res = await f(at('/cancel'), { method: 'POST', headers: headers(), body: JSON.stringify({ callId: ref }), signal: AbortSignal.timeout(30_000) })
      await res.body?.cancel()
    }
  }
}

export interface RunpodRenderOptions {
  apiKey: () => string
  endpointId: () => string
  baseUrl?: string
  fetchImpl?: typeof fetch
}

const RUNPOD_STATE: Record<string, RenderRunState> = { IN_QUEUE: 'queued', IN_PROGRESS: 'running', COMPLETED: 'succeeded', FAILED: 'failed', TIMED_OUT: 'failed', CANCELLED: 'cancelled' }

export function runpodRenderStarter(o: RunpodRenderOptions): RenderStarter {
  const client = new RunpodClient({ baseUrl: o.baseUrl ?? 'https://api.runpod.ai/v2', apiKey: o.apiKey, ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) })
  return {
    id: 'runpod',
    async start(jobUrl, s) {
      const st = await client.run(o.endpointId(), { jobUrl }, undefined, s.signal, { executionTimeout: s.timeoutS * 1000 })
      return st.id
    },
    async status(ref, signal) {
      const st = await client.status(o.endpointId(), ref, signal)
      const state = RUNPOD_STATE[st.status] ?? 'queued'
      const out = st.output as { ok?: boolean; error?: string } | undefined
      // the handler answers what the worker printed: a worker that could not write its result fails the run
      const failedInside = state === 'succeeded' && out && out.ok === false && typeof out.error === 'string' && out.error.startsWith('worker:')
      return {
        state: failedInside ? 'failed' : state,
        ...(typeof st.executionTime === 'number' && state !== 'queued' && state !== 'running' ? { billedS: st.executionTime / 1000 } : {}),
        ...(st.status === 'TIMED_OUT' ? { error: 'timed out on RunPod' } : st.error !== undefined ? { error: String(typeof st.error === 'string' ? st.error : JSON.stringify(st.error)).slice(0, 300) } : failedInside ? { error: out?.error } : {})
      }
    },
    async cancel(ref) {
      await client.cancel(o.endpointId(), ref).catch(() => undefined)
    }
  }
}
