// fal.ai (usages `generateImage` with FLUX schnell and `generateVideo` with Wan 2.2), one adapter `fal`, one vault entry
// FAL_KEY. Written from fal's documentation read on 2026-10-24:
//   https://fal.ai/docs/model-apis/model-endpoints/queue , https://fal.ai/models/fal-ai/flux/schnell/api ,
//   https://fal.ai/models/fal-ai/wan/v2.2-a14b/text-to-video/api
//   Auth    `Authorization: Key <FAL_KEY>`.
//   Image   POST https://fal.run/fal-ai/flux/schnell (synchronous) { prompt, image_size { width, height }, num_inference_steps 4,
//           num_images, enable_safety_checker } → { images [{ url, width, height, content_type }], has_nsfw_concepts [] }.
//   Video   queue: POST https://queue.fal.run/fal-ai/wan/v2.2-a14b/text-to-video { prompt, num_frames 17–161, frames_per_second,
//           resolution 480p|580p|720p, aspect_ratio } → { request_id, status_url, response_url, cancel_url }; GET status_url →
//           { status IN_QUEUE | IN_PROGRESS | COMPLETED, error? }; GET response_url → { video { url } }; PUT cancel_url cancels.
//           The status / result / cancel URLs use only owner/app of the endpoint ("fal-ai/wan"), so the URLs the submit answer
//           gives are used as they are, never built; the key is only ever sent to queue.fal.run.
//   Prices  FLUX schnell USD 0.003 per megapixel, a picture rounded up to the next megapixel (1280×720 = 1 MP = USD 0.003);
//           Wan 2.2 A14B USD 0.04 / 0.06 / 0.08 per second of video at 480p / 580p / 720p (research note BUSINESS-INFRA (old repository) §3.3,
//           §3.4, read 2026-10-24). The video is billed for the seconds it holds (frames / fps), whatever the quote said.
// Image to video (production-8): when the job names a start still (`imageArtefactId`) the request goes to
//   https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/api (read 2026-11-01): the same queue, same fields plus `image_url`
//   (the team artefact's signed link; fal resizes and centre-crops it to the aspect asked), `negative_prompt`; frames 17–161,
//   fps 4–60, resolution 480p | 580p | 720p. A job without a still keeps the text-to-video endpoint. The engine adapter
//   `clip:wan22` is this adapter at 480p (the engine's price line, USD 0.04 per second); `image:flux-schnell` is it for pictures
//   (no negative field: « Avoid: … » ends the prompt). TO CONFIRM on the first call: that the image endpoint takes the same
//   `num_frames` / `frames_per_second` and bills the same per second as the text endpoint.
// Resuming: the handle of the queued request (id and the three URLs) is stored with the job (`setProviderRef`) before the first
// poll, so a retry after a timeout, a restart or a retryable error polls the SAME request instead of paying for a second one. It
// is cleared when the clip is in hand or the request failed for good. A job cancelled while polling asks fal to cancel (best
// effort: a request already running may still be billed). A clip is at most 10 seconds (161 frames at 16 fps).
import { z } from 'zod'
import type { UsageInput } from '../../../src/shared/cloud-api.ts'
import { downloadFile, downloadVideo, undownloadable } from './stock-common.ts'
import { call, clean, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { withAvoid } from './visual-common.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'

export const FAL_RUN_BASE = 'https://fal.run'
export const FAL_QUEUE_BASE = 'https://queue.fal.run'
export const FAL_IMAGE_ENDPOINT = 'fal-ai/flux/schnell'
export const FAL_VIDEO_ENDPOINT = 'fal-ai/wan/v2.2-a14b/text-to-video'
export const FAL_IMAGE_TO_VIDEO_ENDPOINT = 'fal-ai/wan/v2.2-a14b/image-to-video'
export const FAL_IMAGE_USD_PER_MEGAPIXEL = 0.003
export const FAL_VIDEO_RESOLUTIONS = ['480p', '580p', '720p'] as const
export type FalVideoResolution = (typeof FAL_VIDEO_RESOLUTIONS)[number]
/** USD per second of video. */
export const FAL_VIDEO_USD_PER_SECOND: Record<FalVideoResolution, number> = { '480p': 0.04, '580p': 0.06, '720p': 0.08 }
export const FAL_VIDEO_FPS = 16
export const FAL_VIDEO_MIN_FRAMES = 17
export const FAL_VIDEO_MAX_FRAMES = 161
export const FAL_VIDEO_MAX_SECONDS = Math.floor(FAL_VIDEO_MAX_FRAMES / FAL_VIDEO_FPS)

export const falImageCostUsd = (width: number, height: number, images: number): number => Math.max(1, Math.ceil((width * height) / 1_000_000)) * FAL_IMAGE_USD_PER_MEGAPIXEL * images
export const falVideoCostUsd = (resolution: FalVideoResolution, seconds: number): number => seconds * FAL_VIDEO_USD_PER_SECOND[resolution]

export interface FalOptions extends HttpOptions {
  /** The adapter's id (default `fal`; an engine adapter takes its engine id, production-8). */
  id?: string
  videoResolution?: FalVideoResolution
  runBase?: string
  queueBase?: string
  /** Between two polls of the queue (default 3 s; tests use 0). */
  pollMs?: number
  /** Give up polling after this long with a retryable error that a retry resumes (default 15 minutes). */
  maxWaitMs?: number
}

const ImageAnswer = z
  .object({
    images: z.array(z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional(), content_type: z.string().optional() }).passthrough()).default([]),
    has_nsfw_concepts: z.array(z.boolean()).default([])
  })
  .passthrough()
const Submitted = z.object({ request_id: z.string(), status_url: z.string(), response_url: z.string(), cancel_url: z.string() }).passthrough()
const Status = z.object({ status: z.string(), error: z.unknown().optional(), error_type: z.unknown().optional() }).passthrough()
const VideoAnswer = z.object({ video: z.object({ url: z.string() }).passthrough() }).passthrough()
const Ref = z.object({ id: z.string(), s: z.string(), r: z.string(), c: z.string() })
type Ref = z.infer<typeof Ref>

const errorDetail = (body: string): string | undefined => {
  try {
    const j = JSON.parse(body) as { detail?: unknown; error?: unknown }
    const d = typeof j.detail === 'string' ? j.detail : typeof j.error === 'string' ? j.error : undefined
    return d
  } catch {
    return undefined
  }
}

const round16 = (n: number): number => Math.max(256, Math.min(2048, Math.round(n / 16) * 16))

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

export function falAdapter(o: FalOptions = {}): ProviderAdapter {
  const runBase = (o.runBase ?? FAL_RUN_BASE).replace(/\/+$/, '')
  const queueBase = (o.queueBase ?? FAL_QUEUE_BASE).replace(/\/+$/, '')
  const resolution = o.videoResolution ?? '720p'
  const pollMs = o.pollMs ?? 3000
  const maxWaitMs = o.maxWaitMs ?? 15 * 60_000
  const headers = (secret: string): Record<string, string> => ({ authorization: `Key ${secret}`, 'content-type': 'application/json', accept: 'application/json' })
  /** The key goes only to the queue host: a URL from an answer that points elsewhere is refused. */
  const queueUrl = (u: string): string => {
    if (!u.startsWith(`${queueBase}/`)) throw new Error('fal video: the queue answered with a link to another host')
    return u
  }

  // the key of the last call in this process: `abandon` runs after the job and has no context to ask for it
  let lastSecret: string | null = null

  async function generateImage(input: UsageInput<'generateImage'>, ctx: ProviderContext) {
    const label = 'fal image'
    const secret = ctx.secret()
    lastSecret = secret
    ctx.progress(0.1)
    const res = await call(
      {
        label,
        url: `${runBase}/${FAL_IMAGE_ENDPOINT}`,
        secret,
        signal: ctx.signal,
        detail: errorDetail,
        init: {
          method: 'POST',
          headers: headers(secret),
          body: JSON.stringify({
            prompt: withAvoid(input.prompt, input.negative),
            image_size: { width: round16(input.width), height: round16(input.height) },
            num_inference_steps: 4,
            num_images: input.count,
            enable_safety_checker: true,
            output_format: 'jpeg'
          })
        }
      },
      o
    )
    const parsed = ImageAnswer.safeParse(await readJson(res, label, ctx.signal))
    if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
    const { images, has_nsfw_concepts: flagged } = parsed.data
    if (images.length === 0) throw new RetryableProviderError(`${label}: the answer carries no picture`)
    // a picture the safety checker flagged is a black frame: never handed on
    const usable = images.filter((_, i) => flagged[i] !== true)
    if (usable.length === 0) throw new Error(`${label}: the safety checker refused the prompt`)
    const files: { name: string; mime: string; bytes: Buffer }[] = []
    let cost = 0
    for (const [i, img] of usable.entries()) {
      throwIfAborted(ctx.signal)
      const got = await downloadFile('fal image download', img.url, ['image/jpeg', 'image/png', 'image/webp'], ctx.signal, o)
      if (!got) throw new Error(`${label}: a picture could not be downloaded`)
      files.push({ name: `image-${i + 1}.${got.mime === 'image/png' ? 'png' : got.mime === 'image/webp' ? 'webp' : 'jpg'}`, mime: got.mime, bytes: Buffer.from(got.bytes) })
      cost += falImageCostUsd(img.width ?? input.width, img.height ?? input.height, 1)
      ctx.progress(0.1 + (0.9 * (i + 1)) / usable.length)
    }
    // fal bills every picture it made, flagged or not
    cost += (images.length - usable.length) * falImageCostUsd(input.width, input.height, 1)
    return { files, data: { model: FAL_IMAGE_ENDPOINT, requested: { width: input.width, height: input.height }, count: files.length, flagged: images.length - usable.length }, costUsd: cost }
  }

  async function generateVideo(input: UsageInput<'generateVideo'>, ctx: ProviderContext) {
    const label = 'fal video'
    const secret = ctx.secret()
    lastSecret = secret
    const endpoint = input.imageArtefactId ? FAL_IMAGE_TO_VIDEO_ENDPOINT : FAL_VIDEO_ENDPOINT
    if (input.seconds > FAL_VIDEO_MAX_SECONDS) throw new Error(`${label}: a clip is at most ${FAL_VIDEO_MAX_SECONDS} seconds`)
    const frames = Math.max(FAL_VIDEO_MIN_FRAMES, Math.min(FAL_VIDEO_MAX_FRAMES, Math.round(input.seconds * FAL_VIDEO_FPS)))
    let ref: Ref | null = null
    const saved = ctx.providerRef()
    if (saved) {
      try {
        const r = Ref.safeParse(JSON.parse(saved))
        if (r.success) ref = r.data
      } catch {
        ref = null
      }
    }
    if (!ref) {
      const res = await call(
        {
          label,
          url: `${queueBase}/${endpoint}`,
          secret,
          signal: ctx.signal,
          detail: errorDetail,
          init: {
            method: 'POST',
            headers: headers(secret),
            body: JSON.stringify({
              prompt: input.prompt,
              ...(input.imageArtefactId ? { image_url: ctx.artefactUrl(input.imageArtefactId) } : {}),
              ...(input.negative ? { negative_prompt: input.negative } : {}),
              num_frames: frames,
              frames_per_second: FAL_VIDEO_FPS,
              resolution,
              aspect_ratio: input.aspect === '9:16' ? '9:16' : '16:9',
              enable_safety_checker: true
            })
          }
        },
        o
      )
      const sub = Submitted.safeParse(await readJson(res, label, ctx.signal))
      if (!sub.success) throw new RetryableProviderError(`${label}: unexpected answer to the submission`)
      ref = { id: sub.data.request_id, s: queueUrl(sub.data.status_url), r: queueUrl(sub.data.response_url), c: queueUrl(sub.data.cancel_url) }
      // before anything else can fail: a retry resumes this request
      ctx.setProviderRef(JSON.stringify(ref))
    }
    const request = ref
    const failed = (message: string): never => {
      ctx.setProviderRef(null)
      throw new Error(message)
    }
    try {
      const deadline = Date.now() + maxWaitMs
      for (;;) {
        throwIfAborted(ctx.signal)
        const res = await call({ label, url: queueUrl(request.s), secret, signal: ctx.signal, detail: errorDetail, init: { method: 'GET', headers: headers(secret) } }, o).catch((err: unknown) => {
          // a request fal no longer knows will never finish: a new try must start a new one
          if (err instanceof Error && /HTTP 404/.test(err.message)) return failed(`${label}: fal no longer knows this request`)
          throw err
        })
        const status = Status.safeParse(await readJson(res, label, ctx.signal))
        if (!status.success) throw new RetryableProviderError(`${label}: unexpected status answer`)
        if (status.data.status === 'COMPLETED') {
          if (status.data.error) failed(`${label}: the request failed (${clean(String(status.data.error_type ?? status.data.error), secret, 60)})`)
          break
        }
        ctx.progress(status.data.status === 'IN_PROGRESS' ? 0.5 : 0.2)
        if (Date.now() > deadline) throw new RetryableProviderError(`${label}: still not finished, will resume`)
        await sleep(pollMs, ctx.signal)
      }
      const result = await call({ label, url: queueUrl(request.r), secret, signal: ctx.signal, detail: errorDetail, init: { method: 'GET', headers: headers(secret) } }, o)
      const answer = VideoAnswer.safeParse(await readJson(result, label, ctx.signal))
      if (!answer.success) throw new RetryableProviderError(`${label}: the result carries no video`)
      ctx.progress(0.9)
      const got = await downloadVideo('fal video download', answer.data.video.url, ['video/mp4', 'video/webm'], ctx.signal, o)
      if (!got) throw undownloadable(label)
      ctx.setProviderRef(null)
      const seconds = frames / FAL_VIDEO_FPS
      ctx.progress(1)
      return {
        files: [{ name: got.mime === 'video/webm' ? 'clip.webm' : 'clip.mp4', mime: got.mime, bytes: Buffer.from(got.bytes) }],
        data: { model: endpoint, fromImage: Boolean(input.imageArtefactId), resolution, seconds, requestedSeconds: input.seconds, frames, fps: FAL_VIDEO_FPS },
        costUsd: falVideoCostUsd(resolution, seconds)
      }
    } catch (err) {
      if (ctx.signal.aborted) {
        // the job was cancelled: ask fal to stop the request (best effort, nothing waits for it)
        ctx.setProviderRef(null)
        await call({ label, url: queueUrl(request.c), secret, signal: AbortSignal.timeout(10_000), init: { method: 'PUT', headers: headers(secret) } }, o).catch(() => undefined)
      }
      throw err
    }
  }

  return {
    id: o.id ?? 'fal',
    kind: 'real',
    secretName: 'FAL_KEY',
    generateImage,
    generateVideo,
    // best effort: fal cancels a request that has not started; the cancel link is the one the submission answered
    async abandon(ref) {
      let handle: Ref | null = null
      try {
        const r = Ref.safeParse(JSON.parse(ref))
        if (r.success) handle = r.data
      } catch {
        handle = null
      }
      if (!handle || !lastSecret || !handle.c.startsWith(`${queueBase}/`)) return
      await call({ label: 'fal video', url: handle.c, secret: lastSecret, signal: AbortSignal.timeout(10_000), init: { method: 'PUT', headers: headers(lastSecret) } }, o).catch(() => undefined)
    }
  }
}
