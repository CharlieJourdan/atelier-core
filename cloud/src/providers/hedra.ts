// Hedra (usage `talkingAvatar`, audio-driven: our voice audio in, a talking-head video out), one adapter `hedra`, one vault
// entry HEDRA_API_KEY. Written from Hedra's public API as documented at https://docs.hedra.com (Character-3), NOT run against
// the real service (no key, no network in this lot): every name below is checked by the first real call (docs/PROVIDERS.md
// §6 lists what to look at).
//   Auth     header `x-api-key: <HEDRA_API_KEY>` on every call to api.hedra.com; the key is never sent to a file host.
//   Assets   POST /assets { name, type: "audio" } → { id }; POST /assets/{id}/upload (multipart, field `file`) puts the bytes.
//            The avatar is a portrait image asset that already lives in the user's Hedra account: its id is `avatarId`.
//   Start    POST /generations { type: "video", ai_model_id, start_keyframe_id: <avatar>, audio_id: <audio asset>,
//            generated_video_inputs { text_prompt, resolution, aspect_ratio } } → { id, ... } (the generation id).
//   Status   GET /generations/{id}/status → { status: queued | processing | complete | error, url | download_url, error_message }.
//   Price    "from 2.5 cents per second" (https://www.hedra.com/pricing, research note BUSINESS-INFRA (old repository) §3.2): a floor, the exact
//            Character-3 rate is not published. The seconds billed are the seconds of the clip (the audio's length).
// Presenter engine (production-7, decision 0034): the same adapter also serves `presenter:hedra-c3` (option `engine`): then the
// portrait (`portraitArtefactId`, our storage) is put in the account as an image asset (POST /assets { type: "image" }) and is the
// first frame, `resolution` (540p / 720p / 1080p) and `prompt` are honoured, a call is at most PRESENTER_ENGINE_CAN maxCallS, and
// the price is the engine's per resolution. Without `engine` (the plain `hedra` adapter) nothing changes. To confirm on the first
// real call: that `1080p` is accepted in generated_video_inputs.resolution and the per-resolution rates (PROVIDERS.md §6).
// Resuming: the generation id is stored with the job (`setProviderRef`) right after the start, so a retry after a timeout, a
// restart or a retryable error polls the SAME generation instead of paying for a second one; cleared when the clip is in hand
// or the generation failed for good. Hedra documents no cancel: a job cancelled while polling stops waiting (the generation
// may still be billed).
import { z } from 'zod'
import type { UsageInput } from '../../../src/shared/cloud-api.ts'
import { defaultResolution, PRESENTER_ENGINE_CAN, type PresenterEngine, type PresenterResolution } from '../../../src/shared/presenter-engines.ts'
import { engineCostUsd } from './presenter-common.ts'
import { downloadVideo, undownloadable } from './stock-common.ts'
import { call, clean, readBytes, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'

export const HEDRA_BASE = 'https://api.hedra.com/web-app/public'
/** Character-3, the audio-driven talking-head model (docs.hedra.com: listed by GET /models; configurable in config.json). */
export const HEDRA_DEFAULT_MODEL = 'd1dd37a3-e39a-4854-a298-6510289f9cf2'
export const HEDRA_RESOLUTIONS = ['540p', '720p'] as const
export type HedraResolution = (typeof HEDRA_RESOLUTIONS)[number]
/** USD per second of clip: the floor price of Hedra's page (research note BUSINESS-INFRA (old repository) §3.2). */
export const HEDRA_USD_PER_SECOND = 0.025
/** The longest clip asked in one generation (a talking-head shot is 4 to 20 seconds; a longer one is cut up by the engine). */
export const HEDRA_MAX_SECONDS = 120

export const hedraCostUsd = (seconds: number): number => seconds * HEDRA_USD_PER_SECOND

export interface HedraOptions extends HttpOptions {
  /** The adapter id (default `hedra`; `presenter:hedra-c3` for the presenter engine). */
  id?: string
  /** Set: this adapter serves that presenter engine (limits, resolutions and prices from PRESENTER_ENGINE_CAN). */
  engine?: PresenterEngine
  /** The model id (default Character-3). */
  model?: string
  resolution?: HedraResolution
  baseUrl?: string
  /** Between two polls (default 4 s; tests use 0). */
  pollMs?: number
  /** Give up polling after this long with a retryable error that a retry resumes (default 20 minutes). */
  maxWaitMs?: number
}

const Created = z.object({ id: z.string().min(1) }).passthrough()
const Status = z
  .object({
    status: z.string(),
    url: z.string().nullish(),
    download_url: z.string().nullish(),
    error_message: z.string().nullish(),
    duration_ms: z.number().nullish()
  })
  .passthrough()
const Ref = z.object({ g: z.string().min(1) })

const DONE = new Set(['complete', 'completed', 'succeeded', 'done'])
const FAILED = new Set(['error', 'failed', 'cancelled', 'canceled'])

const errorDetail = (body: string): string | undefined => {
  try {
    const j = JSON.parse(body) as { detail?: unknown; message?: unknown; error?: unknown }
    const d = [j.detail, j.message, j.error].find((x) => typeof x === 'string')
    return typeof d === 'string' ? d : undefined
  } catch {
    return undefined
  }
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
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

const fileMime = (name: string): string =>
  /\.wav$/i.test(name) ? 'audio/wav' : /\.m4a$/i.test(name) ? 'audio/mp4' : /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.webp$/i.test(name) ? 'image/webp' : 'audio/mpeg'

export function hedraAdapter(o: HedraOptions = {}): ProviderAdapter {
  const base = (o.baseUrl ?? HEDRA_BASE).replace(/\/+$/, '')
  const model = o.model ?? HEDRA_DEFAULT_MODEL
  const defaultRes: PresenterResolution = o.resolution ?? (o.engine ? defaultResolution(o.engine) : '720p')
  const pollMs = o.pollMs ?? 4000
  const maxWaitMs = o.maxWaitMs ?? 20 * 60_000
  const label = 'Hedra avatar'
  const auth = (secret: string): Record<string, string> => ({ 'x-api-key': secret, accept: 'application/json' })
  const json = (secret: string): Record<string, string> => ({ ...auth(secret), 'content-type': 'application/json' })

  /** A stored file as bytes: from the Cloud's own signed link for the artefact (never sent the Hedra key). */
  async function fetchStored(artefactId: string, what: string, ctx: ProviderContext): Promise<{ name: string; bytes: Uint8Array }> {
    const a = ctx.artefact(artefactId)
    const res = await call({ label: `${label} ${what}`, url: a.url, secret: '', signal: ctx.signal, init: { method: 'GET' } }, o)
    return { name: a.name, bytes: await readBytes(res, `${label} ${what}`, ctx.signal) }
  }

  /** Puts a file in the user's Hedra account and returns its asset id. */
  async function uploadAsset(secret: string, type: 'audio' | 'image', audio: { name: string; bytes: Uint8Array }, ctx: ProviderContext): Promise<string> {
    const made = Created.safeParse(
      await readJson(
        await call({ label: `${label} upload`, url: `${base}/assets`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'POST', headers: json(secret), body: JSON.stringify({ name: audio.name, type }) } }, o),
        label,
        ctx.signal
      )
    )
    if (!made.success) throw new RetryableProviderError(`${label}: unexpected answer to the ${type} asset`)
    throwIfAborted(ctx.signal)
    const form = new FormData()
    form.append('file', new Blob([Buffer.from(audio.bytes)], { type: fileMime(audio.name) }), audio.name)
    await call({ label: `${label} upload`, url: `${base}/assets/${encodeURIComponent(made.data.id)}/upload`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'POST', headers: auth(secret), body: form } }, o)
    return made.data.id
  }

  async function talkingAvatar(input: UsageInput<'talkingAvatar'>, ctx: ProviderContext) {
    const secret = ctx.secret()
    const maxSeconds = o.engine ? PRESENTER_ENGINE_CAN[o.engine].maxCallS : HEDRA_MAX_SECONDS
    if (input.seconds > maxSeconds) throw new Error(`${label}: a clip is at most ${maxSeconds} seconds`)
    const resolution = input.resolution ?? defaultRes
    if (o.engine && !PRESENTER_ENGINE_CAN[o.engine].resolutions.includes(resolution)) throw new Error(`${label}: ${resolution} is not a resolution of ${o.engine}`)
    let generation: string | null = null
    const saved = ctx.providerRef()
    if (saved) {
      try {
        const r = Ref.safeParse(JSON.parse(saved))
        if (r.success) generation = r.data.g
      } catch {
        generation = null
      }
    }
    if (!generation) {
      if (!input.audioArtefactId) throw new Error(`${label}: the voice audio is missing (audioArtefactId)`)
      ctx.progress(0.05)
      const audioId = await uploadAsset(secret, 'audio', await fetchStored(input.audioArtefactId, 'audio', ctx), ctx)
      throwIfAborted(ctx.signal)
      // the presenter's portrait, when the job gives one, is the first frame (else `avatarId`, an image already in the account)
      const portraitId = input.portraitArtefactId ? await uploadAsset(secret, 'image', await fetchStored(input.portraitArtefactId, 'portrait', ctx), ctx) : null
      throwIfAborted(ctx.signal)
      ctx.progress(0.15)
      const started = Created.safeParse(
        await readJson(
          await call(
            {
              label,
              url: `${base}/generations`,
              secret,
              signal: ctx.signal,
              detail: errorDetail,
              init: {
                method: 'POST',
                headers: json(secret),
                body: JSON.stringify({
                  type: 'video',
                  ai_model_id: model,
                  start_keyframe_id: portraitId ?? input.avatarId,
                  audio_id: audioId,
                  generated_video_inputs: { text_prompt: input.prompt ?? 'A person talking to the camera, natural and calm', resolution, aspect_ratio: input.aspect === '9:16' ? '9:16' : '16:9' }
                })
              }
            },
            o
          ),
          label,
          ctx.signal
        )
      )
      if (!started.success) throw new RetryableProviderError(`${label}: unexpected answer to the start`)
      generation = started.data.id
      // before anything else can fail: a retry resumes this generation
      ctx.setProviderRef(JSON.stringify({ g: generation }))
    }
    const failed = (message: string): never => {
      ctx.setProviderRef(null)
      throw new Error(message)
    }
    const deadline = Date.now() + maxWaitMs
    let finished: z.infer<typeof Status> | null = null
    while (!finished) {
      throwIfAborted(ctx.signal)
      const res = await call({ label, url: `${base}/generations/${encodeURIComponent(generation)}/status`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'GET', headers: auth(secret) } }, o).catch((err: unknown) => {
        // a generation Hedra no longer knows will never finish: a new try must start a new one
        if (err instanceof Error && /HTTP 404/.test(err.message)) return failed(`${label}: Hedra no longer knows this generation`)
        throw err
      })
      const st = Status.safeParse(await readJson(res, label, ctx.signal))
      if (!st.success) throw new RetryableProviderError(`${label}: unexpected status answer`)
      const state = st.data.status.toLowerCase()
      if (DONE.has(state)) finished = st.data
      else if (FAILED.has(state)) failed(`${label}: the generation failed${st.data.error_message ? ` (${clean(st.data.error_message, secret, 80)})` : ''}`)
      else {
        ctx.progress(state === 'queued' || state === 'pending' ? 0.25 : 0.55)
        if (Date.now() > deadline) throw new RetryableProviderError(`${label}: still not finished, will resume`)
        await sleep(pollMs, ctx.signal)
      }
    }
    const url = finished.url ?? finished.download_url
    if (!url) {
      ctx.setProviderRef(null)
      throw new Error(`${label}: the finished generation carries no video link`)
    }
    ctx.progress(0.9)
    const got = await downloadVideo(`${label} download`, url, ['video/mp4', 'video/webm', 'application/octet-stream', 'binary/octet-stream'], ctx.signal, o)
    if (!got) throw undownloadable(label)
    ctx.setProviderRef(null)
    const webm = got.mime === 'video/webm'
    const seconds = Math.min(input.seconds, finished.duration_ms ? Math.max(1, Math.ceil(finished.duration_ms / 1000)) : input.seconds)
    ctx.progress(1)
    return {
      files: [{ name: webm ? 'avatar.webm' : 'avatar.mp4', mime: webm ? 'video/webm' : 'video/mp4', bytes: Buffer.from(got.bytes) }],
      data: { model, resolution, seconds, requestedSeconds: input.seconds, avatarId: input.avatarId, ...(o.engine ? { engine: o.engine } : {}) },
      costUsd: o.engine ? engineCostUsd(o.engine, resolution, seconds) : hedraCostUsd(seconds)
    }
  }

  return { id: o.id ?? 'hedra', kind: 'real', secretName: 'HEDRA_API_KEY', talkingAvatar }
}
