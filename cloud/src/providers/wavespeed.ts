// WaveSpeed AI (usage `talkingAvatar`), one factory for three presenter engines, one adapter per engine whose id IS the engine id,
// one vault entry WAVESPEED_API_KEY. Written from the model pages read on 2026-11-01, never called: every field below is
// unconfirmed until the first real call (docs/PROVIDERS.md §6):
//   https://wavespeed.ai/docs/docs-api/wavespeed-ai/infinitetalk-fast , .../wavespeed-ai/infinitetalk , .../pruna-ai/p-video-avatar
//   Auth     header `Authorization: Bearer <WAVESPEED_API_KEY>` on api.wavespeed.ai; never sent to a file host.
//   Start    POST https://api.wavespeed.ai/api/v3/<model path> → { code, message, data: { id, status, outputs, urls, timings: {
//            inference } } }. Image and audio are short signed links of OUR storage (decision 0025). The pages say: do NOT retry
//            the start after an unclear failure (a second billed task).
//              presenter:infinitetalk-fast  /wavespeed-ai/infinitetalk-fast  { image, audio, prompt?, seed, resolution? }
//              presenter:infinitetalk-std   /wavespeed-ai/infinitetalk       { image, audio, prompt?, seed, resolution 480p | 720p }
//              presenter:pruna-avatar       /pruna-ai/p-video/avatar         { image, audio, video_prompt?, resolution 720p | 1080p, seed }
//   Result   GET https://api.wavespeed.ai/api/v3/predictions/{id}/result → data.status: completed | failed | cancelled | timeout |
//            deleted (terminal), anything else (created, processing…) is waiting; data.outputs[0] = the video link once completed.
//   Price    per second of INPUT audio, the engine's line of PRESENTER_ENGINE_CAN (src/shared/presenter-engines.ts):
//              fast   0,015 USD at 480p (the 0,03 of 720p comes from docs/specs/pipeline-avatar.md §9, provisional), whole
//                     seconds, minimum 3 s, maximum 600 s per run;
//              std    0,03 / 0,06 USD at 480p / 720p, the same rounding (3 s minimum, 600 s maximum);
//              pruna  0,025 / 0,045 USD at 720p / 1080p, billed on the audio length, audio up to 3 minutes; no minimum is
//                     published (whole seconds, at least 1, are assumed).
//   To confirm on the first real call: whether `resolution` is a parameter of the fast model (its page lists none: it is sent anyway
//   and ignored if unknown), Pruna's field names (`video_prompt`, `seed`) and its real rounding, the longest audio that keeps the
//   colours of InfiniteTalk (about one minute).
// Resuming: the task id is stored with the job right after the start, so a retry polls the SAME task. WaveSpeed documents no cancel
// route on these pages: a job cancelled while polling stops waiting (the task may still be billed).
import { z } from 'zod'
import { call, clean, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { checkCall, engineCostUsd, errorDetail, remoteLink, resolutionOf, savedRef, sleep, startOnce, type AvatarInput } from './presenter-common.ts'
import { downloadVideo, undownloadable } from './stock-common.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'

export const WAVESPEED_ENGINE = 'presenter:infinitetalk-fast'
export const WAVESPEED_BASE = 'https://api.wavespeed.ai'
export const WAVESPEED_MODEL_PATH = '/api/v3/wavespeed-ai/infinitetalk-fast'
/** The shortest and longest duration WaveSpeed bills for one InfiniteTalk run (seconds). */
export const WAVESPEED_MIN_BILLED_S = 3
export const WAVESPEED_MAX_BILLED_S = 600

interface WavespeedModel {
  path: string
  /** The body field of the motion line. */
  promptField: 'prompt' | 'video_prompt'
  minBilledS: number
  maxBilledS: number
}

/** The WaveSpeed model behind each engine (see the header). */
export const WAVESPEED_MODELS = {
  'presenter:infinitetalk-fast': { path: WAVESPEED_MODEL_PATH, promptField: 'prompt', minBilledS: WAVESPEED_MIN_BILLED_S, maxBilledS: WAVESPEED_MAX_BILLED_S },
  'presenter:infinitetalk-std': { path: '/api/v3/wavespeed-ai/infinitetalk', promptField: 'prompt', minBilledS: WAVESPEED_MIN_BILLED_S, maxBilledS: WAVESPEED_MAX_BILLED_S },
  'presenter:pruna-avatar': { path: '/api/v3/pruna-ai/p-video/avatar', promptField: 'video_prompt', minBilledS: 1, maxBilledS: 180 }
} as const satisfies Record<string, WavespeedModel>
export type WavespeedEngine = keyof typeof WAVESPEED_MODELS

export interface WavespeedOptions extends HttpOptions {
  /** The engine (also the adapter id); default the InfiniteTalk « fast » of production-7. */
  engine?: WavespeedEngine
  baseUrl?: string
  /** Between two polls (default 3 s; tests use 0). */
  pollMs?: number
  /** Give up polling after this long with a retryable error that a retry resumes (default 20 minutes). */
  maxWaitMs?: number
}

const Task = z
  .object({
    data: z
      .object({
        id: z.string().min(1),
        status: z.string().optional(),
        outputs: z.array(z.string()).nullish(),
        error: z.unknown().optional(),
        timings: z.object({ inference: z.number().optional() }).passthrough().nullish()
      })
      .passthrough()
  })
  .passthrough()
const Ref = z.object({ id: z.string().min(1) })

const FAILED = new Set(['failed', 'cancelled', 'canceled', 'timeout', 'deleted'])

/** The seconds WaveSpeed bills for a clip of an engine: whole seconds, within the model's minimum and maximum. */
export const wavespeedBilledSecondsFor = (engine: WavespeedEngine, seconds: number): number => {
  const m = WAVESPEED_MODELS[engine]
  return Math.min(m.maxBilledS, Math.max(m.minBilledS, Math.ceil(seconds - 1e-9)))
}

/** The seconds WaveSpeed bills for an InfiniteTalk clip: whole seconds, at least 3, at most 600. */
export const wavespeedBilledSeconds = (seconds: number): number => wavespeedBilledSecondsFor(WAVESPEED_ENGINE, seconds)

export function wavespeedAdapter(o: WavespeedOptions = {}): ProviderAdapter {
  const engine: WavespeedEngine = o.engine ?? WAVESPEED_ENGINE
  const model: WavespeedModel = WAVESPEED_MODELS[engine]
  const base = (o.baseUrl ?? WAVESPEED_BASE).replace(/\/+$/, '')
  const pollMs = o.pollMs ?? 3000
  const maxWaitMs = o.maxWaitMs ?? 20 * 60_000
  const label = 'WaveSpeed avatar'
  const headers = (secret: string): Record<string, string> => ({ authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json' })

  async function talkingAvatar(input: AvatarInput, ctx: ProviderContext) {
    const secret = ctx.secret()
    checkCall(engine, input, label)
    const resolution = resolutionOf(engine, input, label)
    let task: string | null = savedRef(ctx, Ref)?.id ?? null
    if (!task) {
      if (!input.audioArtefactId) throw new Error(`${label}: the voice audio is missing (audioArtefactId)`)
      if (!input.portraitArtefactId) throw new Error(`${label}: the presenter's portrait is missing (portraitArtefactId)`)
      const image = remoteLink(ctx, input.portraitArtefactId, label)
      const audio = remoteLink(ctx, input.audioArtefactId, label)
      ctx.progress(0.05)
      const started = await startOnce(async () => {
        const res = await call(
          {
            label,
            url: `${base}${model.path}`,
            secret,
            signal: ctx.signal,
            detail: errorDetail,
            init: {
              method: 'POST',
              headers: headers(secret),
              body: JSON.stringify({ image: image.url, audio: audio.url, resolution, seed: -1, ...(input.prompt ? { [model.promptField]: input.prompt } : {}) })
            }
          },
          o
        )
        return Task.safeParse(await readJson(res, label, ctx.signal))
      })
      if (!started.success) throw new Error(`${label}: unexpected answer to the start, not retried`)
      task = started.data.data.id
      // before anything else can fail: a retry resumes this task
      ctx.setProviderRef(JSON.stringify({ id: task }))
    }
    const failed = (message: string): never => {
      ctx.setProviderRef(null)
      throw new Error(message)
    }
    const deadline = Date.now() + maxWaitMs
    let output: string | null = null
    let inferenceMs: number | null = null
    while (output === null) {
      throwIfAborted(ctx.signal)
      const res = await call({ label, url: `${base}/api/v3/predictions/${encodeURIComponent(task)}/result`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'GET', headers: headers(secret) } }, o).catch((err: unknown) => {
        if (err instanceof Error && /HTTP 404/.test(err.message)) return failed(`${label}: WaveSpeed no longer knows this task`)
        throw err
      })
      const st = Task.safeParse(await readJson(res, label, ctx.signal))
      if (!st.success) throw new RetryableProviderError(`${label}: unexpected status answer`)
      const state = (st.data.data.status ?? '').toLowerCase()
      if (state === 'completed') {
        const url = st.data.data.outputs?.[0]
        if (!url) failed(`${label}: the finished task carries no video link`)
        output = url as string
        inferenceMs = st.data.data.timings?.inference ?? null
      } else if (FAILED.has(state)) {
        const e = st.data.data.error
        failed(`${label}: the task ${state}${typeof e === 'string' && e ? ` (${clean(e, secret, 80)})` : ''}`)
      } else {
        ctx.progress(state === 'processing' ? 0.55 : 0.25)
        if (Date.now() > deadline) throw new RetryableProviderError(`${label}: still not finished, will resume`)
        await sleep(pollMs, ctx.signal)
      }
    }
    ctx.progress(0.9)
    // the link is WaveSpeed's CDN: the key is not sent
    const got = await downloadVideo(`${label} download`, output, ['video/mp4', 'video/webm', 'application/octet-stream'], ctx.signal, o)
    if (!got) throw undownloadable(label)
    ctx.setProviderRef(null)
    const seconds = wavespeedBilledSecondsFor(engine, input.seconds)
    ctx.progress(1)
    return {
      files: [{ name: got.mime === 'video/webm' ? 'avatar.webm' : 'avatar.mp4', mime: got.mime === 'video/webm' ? 'video/webm' : 'video/mp4', bytes: Buffer.from(got.bytes) }],
      data: { engine, model: model.path, resolution, seconds, requestedSeconds: input.seconds, avatarId: input.avatarId, ...(inferenceMs !== null ? { inferenceMs } : {}) },
      costUsd: engineCostUsd(engine, resolution, seconds)
    }
  }

  return { id: engine, kind: 'real', secretName: 'WAVESPEED_API_KEY', talkingAvatar }
}
