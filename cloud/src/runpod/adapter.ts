// The `submitGpuJob` adapter on RunPod serverless (lot P5). The app sends one engine node (GpuNodePayload) whose input
// files are this team's artefacts; the adapter turns it into a WorkerJob for the pod (signed links instead of paths),
// starts it with our signed callback URL, then waits for the callback OR polls the status, whichever comes first.
// Cancelling the Cloud job cancels the pod job. A completed pod answers PodOutput: its files are fetched into the job's
// artefacts, the result is a GpuJobResult, and the job is charged the GPU seconds really used (the measure).
import { realpathSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { MAX_UPLOAD_BYTES } from '../../../src/shared/cloud-api.ts'
import { GpuJobResult, GpuNodePayload, WireCost, WORKER_PROTOCOL_VERSION, type WireArtefact, type WorkerJob } from '../../../src/shared/worker-protocol.ts'
import { isInside } from '../keysource.ts'
import { USAGE_ITEM } from '../pricing.ts'
import { FAKE_COST_USD } from '../providers/fakes.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext, type ProviderOutput } from '../providers/types.ts'
import { mimeFor, SAFE_NAME, type NewFile } from '../storage.ts'
import { RUNPOD_TERMINAL, type RunpodClient, type RunpodStatus } from './client.ts'
import type { Waiters } from './webhooks.ts'

/** What a completed pod job answers as its `output`. Files are links the Cloud downloads (file:// only for the fake). */
export const PodOutput = z.object({
  outputs: z.record(
    z.string().max(100),
    z.object({
      files: z.array(z.object({ name: z.string().min(1).max(300), url: z.string().min(1).max(4000) })).max(500).optional(),
      value: z.unknown().optional(),
      meta: z.record(z.string(), z.unknown()).optional()
    })
  ),
  cost: WireCost.optional(),
  gpuSeconds: z.number().min(0).max(10_000_000)
})
export type PodOutput = z.infer<typeof PodOutput>

/** What the pod input is: the job without its folder (the pod chooses it). */
export type PodJob = Omit<WorkerJob, 'outDir'>

/** GPU seconds a pod may run past its quoted `estimatedGpuSeconds` before RunPod stops it (decision 0076): the quote is the
 *  ceiling of what the Cloud pays, so an estimate sent too low ends the job instead of running on at the Cloud's cost. */
export const GPU_TIMEOUT_SLACK_S = 60

/** Optional progress a pod may report while IN_PROGRESS. */
const PodProgress = z.object({ progress: z.number().min(0).max(1), text: z.string().max(200).optional() })

/** How the Cloud reaches RunPod (CloudOptions.runpod). */
export interface RunpodSettings {
  baseUrl: string
  apiKey: () => string
  endpoints: { render: string; 'gpu-video': string }
  fileRoot?: string
  pollMs?: number
  /** Tests: stands in for fetch in the RunPod client. */
  fetchImpl?: typeof fetch
}

export interface RunpodAdapterOptions {
  client: RunpodClient
  /** RunPod endpoint id per worker kind. */
  endpoints: { render: string; 'gpu-video': string }
  kind: 'fake' | 'real'
  /** The only folder `file://` outputs may come from (the fake RunPod's work folder); unset = file:// refused. */
  fileRoot?: string
  pollMs?: number
  waiters: Waiters
  fetchImpl?: typeof fetch
}

const clean = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, '_')

/** `o-<output>-<i>-<basename>`, made safe for storage (SAFE_NAME, at most 100 characters, extension kept). */
export function podFileName(output: string, i: number, name: string): string {
  const prefix = `o-${clean(output).slice(0, 40)}-${i}-`
  let base = clean(name.split(/[\\/]/).pop() ?? '') || 'file'
  const room = 100 - prefix.length
  if (base.length > room) {
    const dot = base.lastIndexOf('.')
    const ext = dot > 0 && base.length - dot <= 12 ? base.slice(dot) : ''
    base = base.slice(0, room - ext.length) + ext
  }
  const full = prefix + base
  if (!SAFE_NAME.test(full)) throw new Error('an output file name cannot be made safe')
  return full
}

/** How a pod job is remembered on its Cloud job (`jobs.provider_ref`). */
const makeRef = (endpoint: string, podId: string): string => `runpod:${encodeURIComponent(endpoint)}/${encodeURIComponent(podId)}`
function parseRef(ref: string | null): { endpoint: string; podId: string } | null {
  const m = ref ? /^runpod:([^/]+)\/([^/]+)$/.exec(ref) : null
  if (!m) return null
  try {
    return { endpoint: decodeURIComponent(m[1] as string), podId: decodeURIComponent(m[2] as string) }
  } catch {
    return null
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = (): void => {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const t = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

export function runpodAdapter(o: RunpodAdapterOptions): ProviderAdapter {
  const pollMs = o.pollMs ?? 2000

  async function fetchFile(url: string, signal: AbortSignal): Promise<Uint8Array> {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      throw new Error('an output file has a malformed link')
    }
    if (u.protocol === 'file:') {
      if (!o.fileRoot) throw new Error('file:// outputs are refused')
      let real: string
      try {
        real = realpathSync(fileURLToPath(u))
      } catch {
        throw new Error('an output file is missing')
      }
      if (!isInside(realpathSync(o.fileRoot), real, process.platform)) throw new Error('an output file is outside the pod folder')
      const info = statSync(real)
      if (!info.isFile()) throw new Error('an output file is not a file')
      if (info.size > MAX_UPLOAD_BYTES) throw new Error('an output file is too large')
      return readFileSync(real)
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`output links must be http(s), not ${u.protocol}`)
    let res: Response
    try {
      res = await (o.fetchImpl ?? fetch)(u, { signal })
    } catch (err) {
      if (signal.aborted) throw signal.reason ?? err
      throw new RetryableProviderError('an output file could not be downloaded')
    }
    if (!res.ok) {
      await res.body?.cancel()
      const msg = `an output file answered HTTP ${res.status}`
      throw res.status >= 500 || res.status === 429 ? new RetryableProviderError(msg) : new Error(msg)
    }
    if (Number(res.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES) throw new Error('an output file is too large')
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error('an output file is too large')
    return bytes
  }

  async function completed(st: RunpodStatus, ctx: ProviderContext): Promise<ProviderOutput> {
    const parsed = PodOutput.safeParse(st.output)
    if (!parsed.success) throw new Error(`the pod answered an unexpected output (${parsed.error.issues[0]?.path.join('.') || 'shape'})`)
    const pod = parsed.data
    const files: NewFile[] = []
    const taken = new Set<string>()
    const outputs: GpuJobResult['outputs'] = {}
    for (const [name, out] of Object.entries(pod.outputs)) {
      const names: string[] = []
      for (const [i, f] of (out.files ?? []).entries()) {
        const fileName = podFileName(name, i, f.name)
        if (taken.has(fileName)) throw new Error('two outputs give the same file name')
        taken.add(fileName)
        files.push({ name: fileName, mime: mimeFor(fileName), bytes: await fetchFile(f.url, ctx.signal) })
        names.push(fileName)
      }
      outputs[name] = {
        ...(out.files ? { files: names } : {}),
        ...(out.value !== undefined ? { value: out.value } : {}),
        ...(out.meta ? { meta: out.meta } : {})
      }
    }
    // Billed on what RunPod measured (executionTime, ms); the pod's own figure only when RunPod gives none.
    const gpuSeconds = typeof st.executionTime === 'number' && st.executionTime >= 0 ? st.executionTime / 1000 : pod.gpuSeconds
    const data = GpuJobResult.parse({ outputs, ...(pod.cost ? { cost: pod.cost } : {}), gpuSeconds })
    return {
      files,
      data: data as Record<string, unknown>,
      costUsd: gpuSeconds * FAKE_COST_USD.gpuS,
      measure: [{ item: USAGE_ITEM.submitGpuJob, quantity: Math.max(1, Math.ceil(gpuSeconds - 1e-9)) }]
    }
  }

  function settle(st: RunpodStatus, ctx: ProviderContext): Promise<ProviderOutput> {
    const text = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? 'no detail' : JSON.stringify(v)).slice(0, 300)
    switch (st.status) {
      case 'COMPLETED':
        return completed(st, ctx)
      case 'TIMED_OUT':
        // It ran out of its quoted GPU seconds (the policy below): a retry would pay for that time again, so it is final.
        ctx.setProviderRef(null)
        throw new Error('the pod job ran past the GPU seconds it was quoted for')
      case 'CANCELLED':
        throw new Error('the pod job was cancelled on RunPod')
      default:
        throw new Error(`the pod job failed: ${text(st.error)}`)
    }
  }

  return {
    id: o.kind === 'fake' ? 'fake-runpod' : 'runpod',
    kind: o.kind,
    ...(o.kind === 'real' ? { secretName: 'RUNPOD_API_KEY' } : {}),
    async abandon(ref) {
      const r = parseRef(ref)
      if (r) await o.client.cancel(r.endpoint, r.podId)
    },
    async submitGpuJob(input, ctx) {
      const payload = GpuNodePayload.safeParse(input.payload)
      if (!payload.success) throw new Error(`payload.${payload.error.issues[0]?.path.join('.') ?? ''}: ${payload.error.issues[0]?.message ?? 'invalid'}`)
      const p = payload.data
      const inputs: Record<string, WireArtefact> = {}
      for (const [name, { artefactIds, ...rest }] of Object.entries(p.inputs)) {
        inputs[name] = { ...rest, ...(artefactIds ? { remoteFiles: artefactIds.map((id) => ctx.artefact(id)) } : {}) }
      }
      const job: PodJob = {
        v: WORKER_PROTOCOL_VERSION,
        nodeType: p.nodeType,
        params: p.params,
        inputs,
        seed: p.seed,
        where: 'gpu',
        attempt: p.attempt,
        notes: p.notes,
        settings: p.settings,
        fake: p.fake
      }
      const endpoint = o.endpoints[input.worker]
      let webhook: string | undefined
      try {
        webhook = ctx.callbackUrl()
      } catch {
        webhook = undefined
      }
      // The waiter is armed before the run starts, so a callback that comes back at once is not missed.
      const stop = new AbortController()
      const onAbort = (): void => stop.abort()
      ctx.signal.addEventListener('abort', onAbort, { once: true })
      let woke = false
      const arm = (): Promise<void> => {
        woke = false
        return o.waiters.wait(ctx.jobId, stop.signal).then(
          () => void (woke = true),
          () => undefined
        )
      }
      // A retry of the same Cloud job resumes the pod an earlier attempt started (never a second pod).
      const prior = parseRef(ctx.providerRef())
      let podId: string | null = prior && prior.endpoint === endpoint ? prior.podId : null
      try {
        let wake = arm()
        let st: RunpodStatus
        if (podId === null) {
          try {
            // Not aborted midway: once RunPod has the job we must know its id, so a cancel can reach it.
            const timeoutS = input.estimatedGpuSeconds + GPU_TIMEOUT_SLACK_S
            st = await o.client.run(endpoint, { job }, webhook, undefined, { executionTimeout: timeoutS * 1000 })
          } catch (err) {
            // RunPod may have accepted a job whose answer was lost: retrying would pay for a second pod.
            if (err instanceof RetryableProviderError) throw new Error(`${err.message}; the start was not confirmed, so it is not retried`, { cause: err })
            throw err
          }
          podId = st.id
          ctx.setProviderRef(makeRef(endpoint, podId))
        } else {
          st = await o.client.status(endpoint, podId, ctx.signal)
        }
        let shown = ''
        while (!RUNPOD_TERMINAL.includes(st.status)) {
          if (ctx.signal.aborted) throw ctx.signal.reason
          const prog = st.status === 'IN_PROGRESS' ? PodProgress.safeParse(st.output) : null
          const [frac, note] = st.status === 'IN_QUEUE' ? [0, 'En file d’attente'] : prog?.success ? [prog.data.progress, prog.data.text ?? 'En cours'] : [0.05, 'En cours']
          if (`${frac}|${note}` !== shown) {
            shown = `${frac}|${note}`
            ctx.progress(frac, note)
          }
          await Promise.race([wake, delay(pollMs, stop.signal)])
          if (ctx.signal.aborted) throw ctx.signal.reason
          if (woke) wake = arm()
          st = await o.client.status(endpoint, podId, ctx.signal)
        }
        if (ctx.signal.aborted) throw ctx.signal.reason
        return await settle(st, ctx)
      } catch (err) {
        // A retryable error keeps the pod for the next attempt (Jobs abandons it if no attempt is left); anything else
        // stops it now.
        const kept = err instanceof RetryableProviderError && !ctx.signal.aborted
        if (podId !== null && !kept) {
          await o.client.cancel(endpoint, podId).catch(() => undefined)
          ctx.setProviderRef(null)
        }
        throw ctx.signal.aborted ? (ctx.signal.reason ?? err) : err
      } finally {
        ctx.signal.removeEventListener('abort', onAbort)
        stop.abort()
      }
    }
  }
}
