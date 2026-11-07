// InfiniteTalk, the open avatar model, on a rented GPU (usage `talkingAvatar`, engine `presenter:infinitetalk-gpu`): a RunPod
// SERVERLESS job on its own endpoint (config.json `infinitetalk.endpointId`; the worker is deploy/runpod/infinitetalk/). One adapter
// whose id IS the engine id; the vault entry is the RunPod key already used by the GPU jobs, RUNPOD_API_KEY. Written from RunPod's
// serverless docs read on 2026-11-01 (docs.runpod.io/serverless/endpoints/send-requests and /operation-reference):
//   Start   POST {base}/{endpointId}/run { input, policy: { executionTimeout (ms), ttl (ms) } } → { id, status }. The input is ours:
//           { image_url, audio_url, resolution, steps, seed, prompt? }: signed links of OUR storage (decision 0025).
//   Status  GET {base}/{endpointId}/status/{id} → { status, output, executionTime (ms), delayTime (ms) }; POST …/cancel/{id}.
//   Output  the worker answers { video_url } (a short link; needs the pod's bucket) or { video_base64 } (small clips), and may add
//           { gpu_seconds }. The link is fetched without any key.
//   Price   GPU seconds really used (RunPod's executionTime) × the GPU's serverless price per second (research note MEDIA-PROVIDERS
//           §4: 4090 1,34 USD/h, L40S 1,75, A100 2,72, 5090 1,79, H100 5,39). The cold start (delayTime) is billed by RunPod too but
//           is not in `costUsd`; it is reported in `data.coldStartS` and counted by the benchmark's budget.
// THE COST CEILING (decision 0015, the 20 USD benchmark): every job carries `executionTimeout` (the most GPU seconds it may run)
// and `ttl` (execution + a cold-start reserve), so one job costs at most (timeout + reserve) × price, whatever the model does.
// Resuming: the RunPod job id is stored with the Cloud job right after the start; a retry polls the SAME job. A start whose answer
// was lost is not retried (it may be running and billed). A job cancelled on our side is cancelled on RunPod.
import { z } from 'zod'
import { RunpodClient, RUNPOD_TERMINAL, type RunpodStatus } from '../runpod/client.ts'
import { checkCall, remoteLink, resolutionOf, savedRef, sleep, startOnce, type AvatarInput } from './presenter-common.ts'
import { downloadVideo } from './stock-common.ts'
import { resolveFetch, throwIfAborted, type HttpOptions } from './http.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'

export const INFINITETALK_ENGINE = 'presenter:infinitetalk-gpu'
export const RUNPOD_API_BASE = 'https://api.runpod.ai/v2'

/** RunPod SERVERLESS prices, US$ per hour (research note MEDIA-PROVIDERS-2026-10 (old repository) §4, read 2026-10-30; recheck on runpod.io/pricing). */
export const RUNPOD_SERVERLESS_USD_PER_HOUR = { '4090': 1.34, '5090': 1.79, l40s: 1.75, a100: 2.72, h100: 5.39 } as const
export const INFINITETALK_GPUS = Object.keys(RUNPOD_SERVERLESS_USD_PER_HOUR) as [keyof typeof RUNPOD_SERVERLESS_USD_PER_HOUR, ...(keyof typeof RUNPOD_SERVERLESS_USD_PER_HOUR)[]]
export type InfinitetalkGpu = (typeof INFINITETALK_GPUS)[number]

export const gpuUsdPerSecond = (gpu: InfinitetalkGpu): number => RUNPOD_SERVERLESS_USD_PER_HOUR[gpu] / 3600

/** The largest bill of one job: the longest it may run plus the cold-start reserve, at the GPU's price. */
export const maxJobCostUsd = (gpu: InfinitetalkGpu, timeoutS: number, coldReserveS: number): number => (timeoutS + coldReserveS) * gpuUsdPerSecond(gpu)

/** What config.json `infinitetalk` holds (the endpoint is the one Charlie deploys, see deploy/runpod/infinitetalk/README.md). */
export interface InfinitetalkSettings {
  /** The RunPod serverless endpoint id; without it the engine cannot run. */
  endpointId?: string | undefined
  gpu: InfinitetalkGpu
  /** Fewer steps = faster and cheaper (4 or 8 with the LightX2V / FusionX LoRA, 40 without). */
  steps: number
  /** The most GPU seconds ONE job may run (the executionTimeout). */
  maxGpuSeconds: number
  /** GPU seconds of cold start (loading the 14B weights) added to the time-to-live and to the cost ceiling. */
  coldStartReserveS: number
  baseUrl?: string | undefined
}

export const INFINITETALK_DEFAULTS: InfinitetalkSettings = { gpu: '4090', steps: 8, maxGpuSeconds: 1800, coldStartReserveS: 180 }

export interface InfinitetalkOptions extends HttpOptions, Partial<InfinitetalkSettings> {
  seed?: number
  /** Between two polls (default 5 s; tests use 0). */
  pollMs?: number
  /** Give up polling after this long with a retryable error that a retry resumes (default 40 minutes). */
  maxWaitMs?: number
}

const Output = z
  .object({
    video_url: z.string().optional(),
    video_base64: z.string().optional(),
    gpu_seconds: z.number().min(0).optional()
  })
  .passthrough()
const Ref = z.object({ e: z.string().min(1), j: z.string().min(1) })

export function infinitetalkGpuAdapter(o: InfinitetalkOptions = {}): ProviderAdapter {
  const s: InfinitetalkSettings = {
    endpointId: o.endpointId,
    gpu: o.gpu ?? INFINITETALK_DEFAULTS.gpu,
    steps: o.steps ?? INFINITETALK_DEFAULTS.steps,
    maxGpuSeconds: o.maxGpuSeconds ?? INFINITETALK_DEFAULTS.maxGpuSeconds,
    coldStartReserveS: o.coldStartReserveS ?? INFINITETALK_DEFAULTS.coldStartReserveS,
    baseUrl: o.baseUrl
  }
  const pollMs = o.pollMs ?? 5000
  const maxWaitMs = o.maxWaitMs ?? 40 * 60_000
  const seed = o.seed ?? 42
  const label = 'InfiniteTalk GPU'

  async function talkingAvatar(input: AvatarInput, ctx: ProviderContext) {
    const secret = ctx.secret()
    checkCall(INFINITETALK_ENGINE, input, label)
    const resolution = resolutionOf(INFINITETALK_ENGINE, input, label)
    const timeoutS = Math.max(5, Math.floor(s.maxGpuSeconds))
    const client = new RunpodClient({ baseUrl: s.baseUrl ?? RUNPOD_API_BASE, apiKey: () => secret, fetchImpl: resolveFetch(o), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) })
    const prior = savedRef(ctx, Ref)
    let endpoint = s.endpointId
    let jobId: string | null = null
    if (prior) {
      endpoint = prior.e
      jobId = prior.j
    }
    if (!endpoint) throw new Error(`${label}: no RunPod endpoint is configured (config.json "infinitetalk": { "endpointId": … })`)
    let st: RunpodStatus
    try {
      if (jobId === null) {
        if (!input.audioArtefactId) throw new Error(`${label}: the voice audio is missing (audioArtefactId)`)
        if (!input.portraitArtefactId) throw new Error(`${label}: the presenter's portrait is missing (portraitArtefactId)`)
        const image = remoteLink(ctx, input.portraitArtefactId, label)
        const audio = remoteLink(ctx, input.audioArtefactId, label)
        ctx.progress(0.05)
        const job = { image_url: image.url, audio_url: audio.url, resolution, steps: s.steps, seed, ...(input.prompt ? { prompt: input.prompt } : {}) }
        const policy = { executionTimeout: timeoutS * 1000, ttl: (timeoutS + s.coldStartReserveS) * 1000 }
        st = await startOnce(() => client.run(endpoint as string, job, undefined, ctx.signal, policy))
        jobId = st.id
        // before anything else can fail: a retry resumes this job
        ctx.setProviderRef(JSON.stringify({ e: endpoint, j: jobId }))
      } else {
        st = await client.status(endpoint, jobId, ctx.signal)
      }
      const deadline = Date.now() + maxWaitMs
      while (!RUNPOD_TERMINAL.includes(st.status)) {
        throwIfAborted(ctx.signal)
        ctx.progress(st.status === 'IN_PROGRESS' ? 0.5 : 0.15)
        if (Date.now() > deadline) throw new RetryableProviderError(`${label}: still not finished, will resume`)
        await sleep(pollMs, ctx.signal)
        st = await client.status(endpoint, jobId, ctx.signal)
      }
    } catch (err) {
      if (jobId !== null && endpoint && ctx.signal.aborted) {
        // the job was cancelled on our side: stop the GPU (best effort)
        ctx.setProviderRef(null)
        await client.cancel(endpoint, jobId).catch(() => undefined)
      }
      throw ctx.signal.aborted ? (ctx.signal.reason ?? err) : err
    }
    const seconds = st.executionTime !== undefined ? st.executionTime / 1000 : undefined
    const failed = (message: string): never => {
      ctx.setProviderRef(null)
      throw new Error(message)
    }
    if (st.status === 'TIMED_OUT') return failed(`${label}: the GPU job hit its ${timeoutS} s limit${seconds !== undefined ? ` after ${seconds.toFixed(0)} s` : ''}; raise infinitetalk.maxGpuSeconds or cut the audio`)
    if (st.status === 'CANCELLED') return failed(`${label}: the GPU job was cancelled on RunPod`)
    if (st.status === 'FAILED') {
      const e = st.error
      return failed(`${label}: the GPU job failed (${(typeof e === 'string' ? e : e === undefined ? 'no detail' : JSON.stringify(e)).slice(0, 120)})`)
    }
    const out = Output.safeParse(st.output)
    if (!out.success || (!out.data.video_url && !out.data.video_base64)) return failed(`${label}: the worker's answer carries no video`)
    ctx.progress(0.9)
    let bytes: Uint8Array
    if (out.data.video_base64) {
      bytes = Buffer.from(out.data.video_base64, 'base64')
    } else {
      // the worker's link is a presigned bucket link: no key is sent
      const got = await downloadVideo(`${label} download`, out.data.video_url as string, ['video/mp4', 'application/octet-stream', 'binary/octet-stream'], ctx.signal, o)
      if (!got) return failed(`${label}: the clip could not be downloaded`)
      bytes = got.bytes
    }
    if (bytes.length === 0) return failed(`${label}: the clip is empty`)
    ctx.setProviderRef(null)
    const gpuSeconds = seconds ?? out.data.gpu_seconds ?? 0
    const coldStartS = st.delayTime !== undefined ? st.delayTime / 1000 : null
    ctx.progress(1)
    return {
      files: [{ name: 'avatar.mp4', mime: 'video/mp4', bytes: Buffer.from(bytes) }],
      data: {
        engine: INFINITETALK_ENGINE,
        resolution,
        steps: s.steps,
        gpu: s.gpu,
        seconds: input.seconds,
        requestedSeconds: input.seconds,
        avatarId: input.avatarId,
        gpuSeconds,
        gpuSecondsPerVideoSecond: input.seconds > 0 ? gpuSeconds / input.seconds : null,
        coldStartS
      },
      costUsd: gpuSeconds * gpuUsdPerSecond(s.gpu)
    }
  }

  return { id: INFINITETALK_ENGINE, kind: 'real', secretName: 'RUNPOD_API_KEY', talkingAvatar }
}
