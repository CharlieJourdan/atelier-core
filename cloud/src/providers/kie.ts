// Kie.ai (production-10 fallbacks), one vault entry KIE_API_KEY, three engines, one adapter each whose id IS the engine id:
//   presenter:kling-avatar-kie  (talkingAvatar)   Kling AI Avatar standard
//   clip:veo31-lite-kie         (generateVideo)   Veo 3.1 Lite, 720p
//   image:gpt-image-25-kie      (generateImage)   GPT Image 2.5, 1K
// Written from the public docs read on 2026-11-01 (https://docs.kie.ai , the model pages kie.ai/kling-ai-avatar, kie.ai/veo-3-1,
// kie.ai/gpt-image-2-5), NEVER called: every name below is unconfirmed until the first real call (docs/PROVIDERS.md §6).
//   Auth     `Authorization: Bearer <KIE_API_KEY>` on api.kie.ai only; never sent to a file host (results are downloaded bare).
//   Create   POST https://api.kie.ai/api/v1/jobs/createTask { model, input: {...} } → { code, msg, data: { taskId } }. The HTTP
//            status is 200 even on an error: `code` says (200 ok; 401 key refused; 402 no credits left; 404; 422 bad input;
//            429 rate limited; 455 service unavailable; 500 server error; 501 generation failed; 505 feature disabled).
//   Poll     GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId=… → { code, msg, data: { taskId, state waiting | queuing |
//            generating | success | fail, resultJson (a JSON STRING holding { resultUrls: [] }), failCode, failMsg,
//            creditsConsumed } }. The credits are kept in `data.credits` for reconciliation (1 credit ≈ 0.005 USD).
//   Models   presenter  `kling/ai-avatar-standard` { image_url, audio_url, prompt }: our short signed links (decision 0025). The
//                       page contradicts itself on whether `prompt` is required: the motion line is sent, else a short default.
//                       720p, at most 300 s (the engine table keeps 180 until measured).
//            clip       `veo-3-1` { prompt, model "veo3_lite", image_urls [start still], generation_type
//                       "FIRST_AND_LAST_FRAMES_2_VIDEO" (one image = the start frame), aspect_ratio 16:9 | 9:16, resolution 720p,
//                       duration 4 | 6 | 8 }. No negative field: « Avoid: … » ends the prompt, as veo.ts does on unifically.
//                       Without a still, image_urls and generation_type are left out (text to video: TO CONFIRM).
//            image      `gpt-image-2-5-flare-text-to-image` { prompt, aspect_ratio, resolution "1K" }, or with reference images
//                       `gpt-image-2-5-sunburst-image-to-image` plus `input_urls` (≤ 16; we send at most the engine's
//                       `references`). The page read lists no aspect ratios: the nearest of 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9
//                       is sent. One picture per task: `count` pictures are `count` tasks, one after the other.
//   Price    the engine's line: presenter 0.04 USD a second (8 credits), clip 0.15 USD (30 credits), image 0.03 USD (6 credits).
//   Refusal  no content-policy code is documented: a failed task or a refused creation whose text speaks of policy, safety,
//            moderation, sensitive or prohibited content is a `refused:` error, any other failure a plain one.
// Resuming: every task id is stored with the job (`setProviderRef`) as soon as it exists, so a retry polls the SAME task and never
// pays for a second one; cleared when the files are in hand or a task failed for good. A creation whose answer was lost (timeout,
// 5xx) is NOT retried (it may have been accepted and billed); an answer that carries an error code is clear: no task was made.
// Kie documents no cancel route: a job cancelled while polling stops waiting.
import { z } from 'zod'
import type { UsageInput } from '../../../src/shared/cloud-api.ts'
import { clipLengthFor, referencesOf } from '../../../src/shared/visual-engines.ts'
import type { NewFile } from '../storage.ts'
import { call, clean, readJson, throwIfAborted } from './http.ts'
import { checkCall, engineCostUsd, errorDetail, remoteLink, resolutionOf, startOnce, type AvatarInput } from './presenter-common.ts'
import { downloadFile, downloadVideo, undownloadable } from './stock-common.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'
import { engineUsd, pollUntil, readRef, refusal, withAvoid, type PollOptions } from './visual-common.ts'

export const KIE_BASE = 'https://api.kie.ai'
/** USD per Kie credit (the pricing page: credits are sold at about 0.005 USD each). */
export const KIE_USD_PER_CREDIT = 0.005
export const KIE_AVATAR_MODEL = 'kling/ai-avatar-standard'
export const KIE_VEO_MODEL = 'veo-3-1'
export const KIE_VEO_VARIANT = 'veo3_lite'
export const KIE_IMAGE_MODEL = 'gpt-image-2-5-flare-text-to-image'
export const KIE_IMAGE_EDIT_MODEL = 'gpt-image-2-5-sunburst-image-to-image'
export const KIE_ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] as const
/** Sent when the job carries no motion line (the field may be required). */
export const KIE_AVATAR_DEFAULT_PROMPT = 'The person speaks naturally to the camera, calm and friendly.'

export interface KieOptions extends PollOptions {
  baseUrl?: string
}

const POLICY = /polic|safety|moderat|sensitive|prohibited|nsfw|not allowed|violat|inappropriate/i

const Created = z.object({ code: z.number(), msg: z.string().nullish(), data: z.object({ taskId: z.string().min(1) }).passthrough().nullish() }).passthrough()
const Record_ = z
  .object({
    code: z.number(),
    msg: z.string().nullish(),
    data: z
      .object({
        state: z.string().nullish(),
        resultJson: z.string().nullish(),
        failCode: z.union([z.string(), z.number()]).nullish(),
        failMsg: z.string().nullish(),
        creditsConsumed: z.number().nullish()
      })
      .passthrough()
      .nullish()
  })
  .passthrough()
const Result = z.object({ resultUrls: z.array(z.string()).default([]) }).passthrough()
const Ref = z.object({ ts: z.array(z.string().min(1)).min(1) })

/** The error an answer's `code` stands for (Kie answers HTTP 200 with the code in the body). */
export function kieCodeError(label: string, code: number, msg: string | null | undefined, secret: string): Error {
  const text = msg ? clean(msg, secret, 80) : ''
  if (POLICY.test(msg ?? '')) return refusal(label, text)
  const suffix = text ? ` (${text})` : ''
  if (code === 429 || code === 455 || (code >= 500 && code !== 501 && code !== 505)) return new RetryableProviderError(`${label}: code ${code}${suffix}`)
  if (code === 401 || code === 403) return new Error(`${label}: code ${code}, the key is refused${suffix}`)
  if (code === 402) return new Error(`${label}: code ${code}, the provider account has no credits left${suffix}`)
  return new Error(`${label}: code ${code}${suffix}`)
}

/** The nearest aspect ratio Kie is asked for a width × height. */
export function kieAspect(width: number, height: number): (typeof KIE_ASPECTS)[number] {
  const want = Math.log(width / height)
  let best: (typeof KIE_ASPECTS)[number] = '1:1'
  let gap = Infinity
  for (const a of KIE_ASPECTS) {
    const [w, h] = a.split(':').map(Number) as [number, number]
    const d = Math.abs(Math.log(w / h) - want)
    if (d < gap) [best, gap] = [a, d]
  }
  return best
}

interface Done {
  urls: string[]
  credits: number | null
}

/** The calls every Kie engine shares: create one task, wait for it, read its result links. */
function kieClient(o: KieOptions, label: string) {
  const base = (o.baseUrl ?? KIE_BASE).replace(/\/+$/, '')
  const headers = (secret: string): Record<string, string> => ({ authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json' })

  async function create(ctx: ProviderContext, secret: string, model: string, input: Record<string, unknown>): Promise<string> {
    const answer = await startOnce(async () => {
      const res = await call({ label, url: `${base}/api/v1/jobs/createTask`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'POST', headers: headers(secret), body: JSON.stringify({ model, input }) } }, o)
      return Created.safeParse(await readJson(res, label, ctx.signal))
    })
    if (!answer.success) throw new Error(`${label}: unexpected answer to the creation, not retried`)
    // an answer that says an error: no task was made, so a retry is safe when the code says so
    if (answer.data.code !== 200) throw kieCodeError(label, answer.data.code, answer.data.msg, secret)
    const id = answer.data.data?.taskId
    if (!id) throw new Error(`${label}: the creation carries no task id, not retried`)
    return id
  }

  /** Polls a task until it ends; a failure clears the job's handle (the task will not change). */
  async function wait(ctx: ProviderContext, secret: string, taskId: string, progress: [number, number]): Promise<Done> {
    const failed = (err: Error): never => {
      ctx.setProviderRef(null)
      throw err
    }
    return pollUntil(label, o, ctx, async () => {
      const res = await call({ label, url: `${base}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'GET', headers: headers(secret) } }, o).catch((err: unknown) => {
        if (err instanceof Error && /HTTP 404/.test(err.message)) return failed(new Error(`${label}: Kie no longer knows this task`))
        throw err
      })
      const r = Record_.safeParse(await readJson(res, label, ctx.signal))
      if (!r.success) throw new RetryableProviderError(`${label}: unexpected status answer`)
      if (r.data.code === 404) failed(new Error(`${label}: Kie no longer knows this task`))
      if (r.data.code !== 200) throw kieCodeError(label, r.data.code, r.data.msg, secret)
      const d = r.data.data
      const state = (d?.state ?? '').toLowerCase()
      if (state === 'success') {
        const urls = resultUrls(d?.resultJson)
        if (urls.length === 0) failed(new Error(`${label}: the finished task carries no result link`))
        return { done: true as const, value: { urls, credits: typeof d?.creditsConsumed === 'number' ? d.creditsConsumed : null } }
      }
      if (state === 'fail') {
        const why = d?.failMsg ?? ''
        if (POLICY.test(why)) failed(refusal(label, clean(why, secret, 100)))
        failed(new Error(`${label}: the task failed${why ? ` (${clean(why, secret, 100)})` : d?.failCode ? ` (code ${clean(String(d.failCode), secret, 20)})` : ''}`))
      }
      return { done: false as const, progress: state === 'generating' ? progress[1] : progress[0] }
    })
  }

  return { create, wait }
}

/** The https links of a finished task's `resultJson` (a JSON string); none when it does not parse. */
function resultUrls(resultJson: string | null | undefined): string[] {
  try {
    const parsed = Result.safeParse(JSON.parse(resultJson ?? ''))
    return parsed.success ? parsed.data.resultUrls.filter((u) => /^https:\/\//i.test(u)) : []
  } catch {
    return []
  }
}

/** The tasks stored with the job by an earlier attempt. */
const savedTasks = (ctx: ProviderContext): string[] => readRef(ctx.providerRef(), (v) => Ref.parse(v).ts) ?? []
const keepTasks = (ctx: ProviderContext, ts: string[]): void => ctx.setProviderRef(JSON.stringify({ ts }))
const creditsOf = (all: (number | null)[]): { credits: number | null; creditsUsd: number | null } => {
  if (all.some((c) => c === null)) return { credits: null, creditsUsd: null }
  const credits = (all as number[]).reduce((a, b) => a + b, 0)
  return { credits, creditsUsd: +(credits * KIE_USD_PER_CREDIT).toFixed(4) }
}

// ---- presenter:kling-avatar-kie --------------------------------------------------------------------------------------------

export const KIE_AVATAR_ENGINE = 'presenter:kling-avatar-kie'

export function kieAvatarAdapter(o: KieOptions = {}): ProviderAdapter {
  const label = 'Kie avatar'
  const kie = kieClient({ ...o, pollMs: o.pollMs ?? 5000, maxWaitMs: o.maxWaitMs ?? 30 * 60_000 }, label)

  async function talkingAvatar(input: AvatarInput, ctx: ProviderContext) {
    const secret = ctx.secret()
    checkCall(KIE_AVATAR_ENGINE, input, label)
    const resolution = resolutionOf(KIE_AVATAR_ENGINE, input, label)
    let task = savedTasks(ctx)[0] ?? null
    if (!task) {
      if (!input.audioArtefactId) throw new Error(`${label}: the voice audio is missing (audioArtefactId)`)
      if (!input.portraitArtefactId) throw new Error(`${label}: the presenter's portrait is missing (portraitArtefactId)`)
      const image = remoteLink(ctx, input.portraitArtefactId, label)
      const audio = remoteLink(ctx, input.audioArtefactId, label)
      ctx.progress(0.05)
      task = await kie.create(ctx, secret, KIE_AVATAR_MODEL, { image_url: image.url, audio_url: audio.url, prompt: input.prompt || KIE_AVATAR_DEFAULT_PROMPT })
      // before anything else can fail: a retry resumes this task
      keepTasks(ctx, [task])
    }
    const done = await kie.wait(ctx, secret, task, [0.25, 0.55])
    ctx.progress(0.9)
    const got = await downloadVideo(`${label} download`, done.urls[0] as string, ['video/mp4', 'video/webm', 'application/octet-stream'], ctx.signal, o)
    if (!got) throw undownloadable(label)
    ctx.setProviderRef(null)
    ctx.progress(1)
    return {
      files: [{ name: got.mime === 'video/webm' ? 'avatar.webm' : 'avatar.mp4', mime: got.mime === 'video/webm' ? 'video/webm' : 'video/mp4', bytes: Buffer.from(got.bytes) }],
      data: { engine: KIE_AVATAR_ENGINE, model: KIE_AVATAR_MODEL, resolution, seconds: input.seconds, requestedSeconds: input.seconds, avatarId: input.avatarId, ...creditsOf([done.credits]) },
      costUsd: engineCostUsd(KIE_AVATAR_ENGINE, resolution, input.seconds)
    }
  }

  return { id: KIE_AVATAR_ENGINE, kind: 'real', secretName: 'KIE_API_KEY', talkingAvatar }
}

// ---- clip:veo31-lite-kie ---------------------------------------------------------------------------------------------------

export const KIE_VEO_ENGINE = 'clip:veo31-lite-kie'

export function kieVeoAdapter(o: KieOptions = {}): ProviderAdapter {
  const label = 'Veo (Kie)'
  const kie = kieClient({ ...o, maxWaitMs: o.maxWaitMs ?? 20 * 60_000 }, label)

  async function generateVideo(input: UsageInput<'generateVideo'>, ctx: ProviderContext) {
    const secret = ctx.secret()
    const seconds = clipLengthFor(KIE_VEO_ENGINE, input.seconds)
    let task = savedTasks(ctx)[0] ?? null
    if (!task) {
      task = await kie.create(ctx, secret, KIE_VEO_MODEL, {
        prompt: withAvoid(input.prompt, input.negative),
        model: KIE_VEO_VARIANT,
        ...(input.imageArtefactId ? { image_urls: [ctx.artefactUrl(input.imageArtefactId)], generation_type: 'FIRST_AND_LAST_FRAMES_2_VIDEO' } : {}),
        aspect_ratio: input.aspect,
        resolution: '720p',
        duration: seconds
      })
      keepTasks(ctx, [task])
    }
    ctx.progress(0.1)
    const done = await kie.wait(ctx, secret, task, [0.2, 0.5])
    ctx.progress(0.9)
    // a CDN link: the key is not sent to it
    const got = await downloadVideo(`${label} download`, done.urls[0] as string, ['video/mp4', 'video/webm'], ctx.signal, o)
    if (!got) throw undownloadable(label)
    ctx.setProviderRef(null)
    ctx.progress(1)
    return {
      files: [{ name: got.mime === 'video/webm' ? 'clip.webm' : 'clip.mp4', mime: got.mime, bytes: Buffer.from(got.bytes) }],
      data: { engine: KIE_VEO_ENGINE, model: `${KIE_VEO_MODEL}/${KIE_VEO_VARIANT}`, seconds, requestedSeconds: input.seconds, resolution: '720p', fromImage: Boolean(input.imageArtefactId), ...creditsOf([done.credits]) },
      costUsd: engineUsd(KIE_VEO_ENGINE)
    }
  }

  return { id: KIE_VEO_ENGINE, kind: 'real', secretName: 'KIE_API_KEY', generateVideo }
}

// ---- image:gpt-image-25-kie ------------------------------------------------------------------------------------------------

export const KIE_IMAGE_ENGINE = 'image:gpt-image-25-kie'
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const

export function kieImageAdapter(o: KieOptions = {}): ProviderAdapter {
  const label = 'GPT Image (Kie)'
  const kie = kieClient({ ...o, maxWaitMs: o.maxWaitMs ?? 10 * 60_000, pollMs: o.pollMs ?? 3000 }, label)

  async function generateImage(input: UsageInput<'generateImage'>, ctx: ProviderContext) {
    const secret = ctx.secret()
    const refs = (input.referenceArtefactIds ?? []).slice(0, referencesOf(KIE_IMAGE_ENGINE))
    const model = refs.length > 0 ? KIE_IMAGE_EDIT_MODEL : KIE_IMAGE_MODEL
    const aspect = kieAspect(input.width, input.height)
    const body = { prompt: withAvoid(input.prompt, input.negative), aspect_ratio: aspect, resolution: '1K', ...(refs.length > 0 ? { input_urls: refs.map((id) => ctx.artefactUrl(id)) } : {}) }
    const tasks = savedTasks(ctx)
    const files: NewFile[] = []
    const credits: (number | null)[] = []
    for (let i = 0; i < input.count; i++) {
      throwIfAborted(ctx.signal)
      let task = tasks[i]
      if (!task) {
        task = await kie.create(ctx, secret, model, body)
        tasks.push(task)
        keepTasks(ctx, tasks)
      }
      const done = await kie.wait(ctx, secret, task, [0.1 + (0.8 * i) / input.count, 0.1 + (0.8 * (i + 0.5)) / input.count])
      credits.push(done.credits)
      // a CDN link: the key is not sent to it
      const got = await downloadFile(`${label} download`, done.urls[0] as string, IMAGE_MIMES, ctx.signal, o)
      if (!got) throw new Error(`${label}: a picture could not be downloaded`)
      files.push({ name: `image-${i + 1}.${got.mime === 'image/jpeg' ? 'jpg' : got.mime === 'image/webp' ? 'webp' : 'png'}`, mime: got.mime, bytes: Buffer.from(got.bytes) })
    }
    ctx.setProviderRef(null)
    ctx.progress(1)
    return {
      files,
      data: { engine: KIE_IMAGE_ENGINE, model, aspect, resolution: '1K', requested: { width: input.width, height: input.height }, count: files.length, references: refs.length, ...creditsOf(credits) },
      costUsd: files.length * engineUsd(KIE_IMAGE_ENGINE)
    }
  }

  return { id: KIE_IMAGE_ENGINE, kind: 'real', secretName: 'KIE_API_KEY', generateImage }
}
