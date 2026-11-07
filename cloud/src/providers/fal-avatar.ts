// Kling AI Avatar v2 standard on fal.ai (usage `talkingAvatar`, engine `presenter:kling-avatar2-std`), one adapter whose id IS the
// engine id, one vault entry FAL_KEY (the same as fal.ts). Written from the model page read on 2026-11-01:
//   https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard/api and the queue docs fal.ts cites.
//   Input    POST https://queue.fal.run/fal-ai/kling-video/ai-avatar/v2/standard { image_url, audio_url, prompt? }: both URLs are
//            short signed links of OUR storage (decision 0025); the answer carries { request_id, status_url, response_url, cancel_url }.
//   Status   GET status_url → { status: IN_QUEUE | IN_PROGRESS | COMPLETED }; GET response_url → { video: { url }, duration }.
//   Price    the page lists none; docs/specs/pipeline-avatar.md §9 has 0,0562 USD a second (provisional), billed on the audio's length.
//   To confirm on the first real call: the price per second, that the output is 720p whatever the picture, the longest audio.
// The key goes only to queue.fal.run (the status / result / cancel links of the answer are checked), never to the file hosts.
// Resuming and cancel work as in fal.ts. A lost answer to the submission is not retried (the request may be billed).
import { z } from 'zod'
import { FAL_QUEUE_BASE } from './fal.ts'
import { call, clean, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { checkCall, engineCostUsd, errorDetail, remoteLink, resolutionOf, savedRef, sleep, startOnce, type AvatarInput } from './presenter-common.ts'
import { downloadVideo, undownloadable } from './stock-common.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'

export const KLING_ENGINE = 'presenter:kling-avatar2-std'
export const KLING_ENDPOINT = 'fal-ai/kling-video/ai-avatar/v2/standard'

export interface FalAvatarOptions extends HttpOptions {
  queueBase?: string
  /** Between two polls of the queue (default 3 s; tests use 0). */
  pollMs?: number
  /** Give up polling after this long with a retryable error that a retry resumes (default 20 minutes). */
  maxWaitMs?: number
}

const Submitted = z.object({ request_id: z.string(), status_url: z.string(), response_url: z.string(), cancel_url: z.string() }).passthrough()
const Status = z.object({ status: z.string(), error: z.unknown().optional(), error_type: z.unknown().optional() }).passthrough()
const Answer = z.object({ video: z.object({ url: z.string() }).passthrough(), duration: z.number().optional() }).passthrough()
const Ref = z.object({ id: z.string(), s: z.string(), r: z.string(), c: z.string() })
type Ref = z.infer<typeof Ref>

export function falAvatarAdapter(o: FalAvatarOptions = {}): ProviderAdapter {
  const queueBase = (o.queueBase ?? FAL_QUEUE_BASE).replace(/\/+$/, '')
  const pollMs = o.pollMs ?? 3000
  const maxWaitMs = o.maxWaitMs ?? 20 * 60_000
  const label = 'fal avatar'
  const headers = (secret: string): Record<string, string> => ({ authorization: `Key ${secret}`, 'content-type': 'application/json', accept: 'application/json' })
  /** The key goes only to the queue host: a link from an answer that points elsewhere is refused. */
  const queueUrl = (u: string): string => {
    if (!u.startsWith(`${queueBase}/`)) throw new Error(`${label}: the queue answered with a link to another host`)
    return u
  }

  async function talkingAvatar(input: AvatarInput, ctx: ProviderContext) {
    const secret = ctx.secret()
    checkCall(KLING_ENGINE, input, label)
    const resolution = resolutionOf(KLING_ENGINE, input, label)
    let ref: Ref | null = savedRef(ctx, Ref)
    if (!ref) {
      if (!input.audioArtefactId) throw new Error(`${label}: the voice audio is missing (audioArtefactId)`)
      if (!input.portraitArtefactId) throw new Error(`${label}: the presenter's portrait is missing (portraitArtefactId)`)
      const image = remoteLink(ctx, input.portraitArtefactId, label)
      const audio = remoteLink(ctx, input.audioArtefactId, label)
      ctx.progress(0.05)
      const sub = await startOnce(async () => {
        const res = await call(
          {
            label,
            url: `${queueBase}/${KLING_ENDPOINT}`,
            secret,
            signal: ctx.signal,
            detail: errorDetail,
            init: { method: 'POST', headers: headers(secret), body: JSON.stringify({ image_url: image.url, audio_url: audio.url, ...(input.prompt ? { prompt: input.prompt } : {}) }) }
          },
          o
        )
        return Submitted.safeParse(await readJson(res, label, ctx.signal))
      })
      if (!sub.success) throw new Error(`${label}: unexpected answer to the submission, not retried`)
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
      const result = await call({ label, url: queueUrl(request.r), secret, signal: ctx.signal, detail: errorDetail, init: { method: 'GET', headers: headers(secret) } }, o).catch((err: unknown) => {
        // a request that completed but failed answers an HTTP error here (a content refusal, for one): it will not change
        if (err instanceof Error && !(err instanceof RetryableProviderError)) return failed(err.message)
        throw err
      })
      const answer = Answer.safeParse(await readJson(result, label, ctx.signal))
      if (!answer.success) throw new RetryableProviderError(`${label}: the result carries no video`)
      ctx.progress(0.9)
      // the video link is fal's CDN: the key is not sent
      const got = await downloadVideo(`${label} download`, answer.data.video.url, ['video/mp4', 'video/webm'], ctx.signal, o)
      if (!got) throw undownloadable(label)
      ctx.setProviderRef(null)
      const seconds = typeof answer.data.duration === 'number' && answer.data.duration > 0 ? answer.data.duration : input.seconds
      ctx.progress(1)
      return {
        files: [{ name: got.mime === 'video/webm' ? 'avatar.webm' : 'avatar.mp4', mime: got.mime, bytes: Buffer.from(got.bytes) }],
        data: { engine: KLING_ENGINE, model: KLING_ENDPOINT, resolution, seconds, requestedSeconds: input.seconds, avatarId: input.avatarId },
        costUsd: engineCostUsd(KLING_ENGINE, resolution, seconds)
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

  return { id: KLING_ENGINE, kind: 'real', secretName: 'FAL_KEY', talkingAvatar }
}
