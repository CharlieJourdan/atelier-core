// HeyGen (usage `talkingAvatar`, engine `presenter:heygen-avatar4`: Avatar IV, a photo made to speak OUR voice audio), one adapter
// whose id IS the engine id, one vault entry HEYGEN_API_KEY. Rewritten for HeyGen's API v3 (production-10) from
// developers.heygen.com read on 2026-11-01 (the v2 talking-photo routes of production-7 were never confirmed). NEVER called: every
// name below is unconfirmed until the first real call (docs/PROVIDERS.md §6):
//   Auth     header `x-api-key: <HEYGEN_API_KEY>` on api.heygen.com only; never sent to our file links nor to HeyGen's CDN.
//   Create   POST https://api.heygen.com/v3/videos { type: "image", image: { type: "url", url }, audio_url, resolution "720p" |
//            "1080p", aspect_ratio "16:9" | "9:16", motion_prompt? } → { data: { video_id, status } }. The portrait and the
//            audio are short signed links of OUR storage (decision 0025): nothing is uploaded, no talking photo is registered
//            any more (the old inputs stay accepted: `avatarId` is only echoed). The optional `Idempotency-Key` header is sent
//            with the Cloud job id; as its replay behaviour is not described, a start whose answer was lost is still NOT retried.
//   Status   GET https://api.heygen.com/v3/videos/{video_id} → { data: { status pending | processing | completed | failed,
//            video_url, duration, failure_code, failure_message } }. A 429 carries Retry-After: the poll waits that long (at most
//            two minutes) and goes on.
//   Price    0.05 USD a second (the Enterprise API page: 0.1 credit a second at 0.50 USD a credit), the engine's line in
//            PRESENTER_ENGINE_CAN. A self-serve figure of 0.0385 USD a second appears on a price index, unverified.
//   Refusal  a failed video whose failure code or message speaks of moderation, policy or safety is a `refused:` error (TO CONFIRM:
//            HeyGen's failure codes are not listed on the page read).
// Resuming: the video id is stored with the job (`setProviderRef`) as soon as it exists, so a retry never pays for a second video;
// cleared when the clip is in hand or the video failed for good. A ref of production-7 (`{ t, v }`) still resumes its video.
// HeyGen documents no cancel here: a job cancelled while polling stops waiting.
import { z } from 'zod'
import { call, clean, readJson, resolveFetch, throwIfAborted, type HttpOptions } from './http.ts'
import { billedSeconds, checkCall, engineCostUsd, errorDetail, remoteLink, resolutionOf, savedRef, sleep, startOnce, type AvatarInput } from './presenter-common.ts'
import { downloadVideo, undownloadable } from './stock-common.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'
import { refusal } from './visual-common.ts'

export const HEYGEN_ENGINE = 'presenter:heygen-avatar4'
export const HEYGEN_API_BASE = 'https://api.heygen.com'
/** The longest pause a Retry-After may impose on one poll. */
export const HEYGEN_MAX_RETRY_AFTER_MS = 120_000

export interface HeygenOptions extends HttpOptions {
  apiBase?: string
  /** Between two polls (default 5 s; tests use 0). */
  pollMs?: number
  /** Give up polling after this long with a retryable error that a retry resumes (default 30 minutes). */
  maxWaitMs?: number
}

const Started = z.object({ data: z.object({ video_id: z.string().min(1), status: z.string().optional() }).passthrough() }).passthrough()
const Status = z
  .object({
    data: z
      .object({
        status: z.string(),
        video_url: z.string().nullish(),
        duration: z.number().nullish(),
        failure_code: z.union([z.string(), z.number()]).nullish(),
        failure_message: z.string().nullish()
      })
      .passthrough()
  })
  .passthrough()
/** `v`: the video; `t` (a production-7 registration) is read and ignored. */
const Ref = z.object({ v: z.string().min(1).optional(), t: z.string().optional() })

const DONE = new Set(['completed', 'complete', 'succeeded'])
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled'])
const POLICY = /moderat|polic|safety|nsfw|inappropriate|prohibited|violat/i

/** Retry-After in milliseconds (seconds or an HTTP date); null when absent or unreadable. */
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const s = Number(value)
  if (Number.isFinite(s)) return Math.max(0, s * 1000)
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - now) : null
}

export function heygenAdapter(o: HeygenOptions = {}): ProviderAdapter {
  const api = (o.apiBase ?? HEYGEN_API_BASE).replace(/\/+$/, '')
  const pollMs = o.pollMs ?? 5000
  const maxWaitMs = o.maxWaitMs ?? 30 * 60_000
  const label = 'HeyGen avatar'
  const keyHeaders = (secret: string): Record<string, string> => ({ 'x-api-key': secret, accept: 'application/json' })

  async function talkingAvatar(input: AvatarInput, ctx: ProviderContext) {
    const secret = ctx.secret()
    checkCall(HEYGEN_ENGINE, input, label)
    const resolution = resolutionOf(HEYGEN_ENGINE, input, label)
    let video: string | null = savedRef(ctx, Ref)?.v ?? null

    if (!video) {
      if (!input.audioArtefactId) throw new Error(`${label}: the voice audio is missing (audioArtefactId)`)
      if (!input.portraitArtefactId) throw new Error(`${label}: the presenter's portrait is missing (portraitArtefactId): API v3 takes the picture itself, not a registered id`)
      const image = remoteLink(ctx, input.portraitArtefactId, label)
      const audio = remoteLink(ctx, input.audioArtefactId, label)
      ctx.progress(0.05)
      const started = await startOnce(async () => {
        const res = await call(
          {
            label,
            url: `${api}/v3/videos`,
            secret,
            signal: ctx.signal,
            detail: errorDetail,
            init: {
              method: 'POST',
              headers: { ...keyHeaders(secret), 'content-type': 'application/json', 'idempotency-key': ctx.jobId },
              body: JSON.stringify({
                type: 'image',
                image: { type: 'url', url: image.url },
                audio_url: audio.url,
                resolution,
                aspect_ratio: input.aspect,
                ...(input.prompt ? { motion_prompt: input.prompt } : {})
              })
            }
          },
          o
        )
        return Started.safeParse(await readJson(res, label, ctx.signal))
      })
      if (!started.success) throw new Error(`${label}: unexpected answer to the start, not retried`)
      video = started.data.data.video_id
      // before anything else can fail: a retry polls this video
      ctx.setProviderRef(JSON.stringify({ v: video }))
    }

    const failed = (err: Error): never => {
      ctx.setProviderRef(null)
      throw err
    }
    // the poll's own fetch notes a 429's Retry-After, which `call` does not hand on
    const limited: { waitMs: number | null } = { waitMs: null }
    const fetchImpl = resolveFetch(o)
    const pollHttp: HttpOptions = {
      ...o,
      fetchImpl: (async (url, init) => {
        const res = await fetchImpl(url, init)
        if (res.status === 429) limited.waitMs = retryAfterMs(res.headers.get('retry-after'))
        return res
      }) as typeof fetch
    }
    const deadline = Date.now() + maxWaitMs
    let finished: z.infer<typeof Status>['data'] | null = null
    while (!finished) {
      throwIfAborted(ctx.signal)
      limited.waitMs = null
      const res = await call({ label, url: `${api}/v3/videos/${encodeURIComponent(video)}`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'GET', headers: keyHeaders(secret) } }, pollHttp).catch((err: unknown) => {
        if (err instanceof Error && /HTTP 404/.test(err.message)) return failed(new Error(`${label}: HeyGen no longer knows this video`))
        // rate limited while polling: wait as asked and go on (the video goes on being made meanwhile)
        if (err instanceof RetryableProviderError && /HTTP 429/.test(err.message) && Date.now() < deadline) return null
        throw err
      })
      if (res === null) {
        await sleep(Math.min(HEYGEN_MAX_RETRY_AFTER_MS, limited.waitMs ?? Math.max(pollMs, 10_000)), ctx.signal)
        continue
      }
      const st = Status.safeParse(await readJson(res, label, ctx.signal))
      if (!st.success) throw new RetryableProviderError(`${label}: unexpected status answer`)
      const state = st.data.data.status.toLowerCase()
      if (DONE.has(state)) finished = st.data.data
      else if (FAILED.has(state)) {
        const code = st.data.data.failure_code ?? ''
        const why = [String(code), st.data.data.failure_message ?? ''].filter(Boolean).join(': ')
        if (POLICY.test(why)) failed(refusal(label, `the video was refused (${clean(why, secret, 100)})`))
        failed(new Error(`${label}: the video failed${why ? ` (${clean(why, secret, 100)})` : ''}`))
      } else {
        ctx.progress(state === 'processing' ? 0.55 : 0.35)
        if (Date.now() > deadline) throw new RetryableProviderError(`${label}: still not finished, will resume`)
        await sleep(pollMs, ctx.signal)
      }
    }
    if (!finished.video_url) failed(new Error(`${label}: the finished video carries no link`))
    ctx.progress(0.9)
    // the link is HeyGen's CDN: the key is not sent
    const got = await downloadVideo(`${label} download`, finished.video_url as string, ['video/mp4', 'application/octet-stream', 'binary/octet-stream'], ctx.signal, o)
    if (!got) throw undownloadable(label)
    ctx.setProviderRef(null)
    const seconds = Math.min(input.seconds, billedSeconds(finished.duration, input.seconds))
    ctx.progress(1)
    return {
      files: [{ name: 'avatar.mp4', mime: 'video/mp4', bytes: Buffer.from(got.bytes) }],
      data: { engine: HEYGEN_ENGINE, api: 'v3', resolution, seconds, requestedSeconds: input.seconds, avatarId: input.avatarId, videoId: video },
      costUsd: engineCostUsd(HEYGEN_ENGINE, resolution, seconds)
    }
  }

  return { id: HEYGEN_ENGINE, kind: 'real', secretName: 'HEYGEN_API_KEY', talkingAvatar }
}
