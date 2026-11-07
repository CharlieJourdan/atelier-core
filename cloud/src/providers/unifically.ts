// More still and clip engines on unifically.com (chantier vrais-tests, 2026-11-01): the cheap models of the model benchmark
// (research note model-benchmark-2026-11 (old repository)), one adapter per engine whose id IS the engine id, all through the same « Unified
// Tasks API » and Charlie's UNIFICALLY_API_KEY. The Veo 3.1 engines keep their own adapter (veo.ts).
//
// Read on 2026-11-01: https://docs.unifically.com/api-reference/v1-tasks.md and each model page under /models/ (named below).
//   Create  POST https://api.unifically.com/v1/tasks { model, input { … the model's own fields … } } → data { task_id }
//           « Unknown request fields are rejected rather than ignored »: each model below sends only the fields its page lists.
//   Price   the same body with `dry_run: true` → data { cost } in USD, « without creating a task or deducting from your balance ».
//           The adapter asks it before every real call and reports THAT figure as the job's cost; the registry line
//           (engines.ts) is only the fallback when the dry run does not answer, and the estimate the app shows before.
//   Poll    GET /v1/tasks/{task_id} → data { status processing | completed | failed, output { video_url | image_url }, error_message }
//   « Failed generations are never charged. »
// Pictures (start still, references) are uploaded to unifically's own storage first (unifically-common.ts says why).
// Every clip is asked silent (the film drops a clip's sound anyway, and sound costs more on the models that bill it).
import { z } from 'zod'
import type { UsageInput } from '../../../src/shared/cloud-api.ts'
import { clipLengthFor, type ClipEngine, type ImageEngine } from '../../../src/shared/visual-engines.ts'
import { clean, readJson } from './http.ts'
import { downloadFile, downloadVideo, undownloadable } from './stock-common.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'
import { UNIFICALLY_BASE, unificallyCall, uploadToUnifically, type UnificallyHttp } from './unifically-common.ts'
import { engineUsd, pollUntil, readRef, refusal, refusedWhen, withAvoid, type PollOptions } from './visual-common.ts'

const POLICY = /polic|safety|moderat|sensitive|blocked|prohibited|nsfw|not allowed|violat/i

/** What a model is given: the prompt (with its « Avoid: … » already written), the shape, and the signed links of the pictures. */
interface Ask {
  prompt: string
  aspect: string
  seconds: number
  startUrl?: string
  refUrls: string[]
}

interface UniModel {
  model: string
  input: (a: Ask) => Record<string, unknown>
}

/** The aspect ratio closest to a width and a height among those a model takes. */
export function nearestAspect(width: number, height: number, allowed: readonly string[]): string {
  const want = width / height
  let best = allowed[0] as string
  let gap = Infinity
  for (const a of allowed) {
    const [w, h] = a.split(':').map(Number) as [number, number]
    const g = Math.abs(Math.log(w / h / want))
    if (g < gap) [best, gap] = [a, g]
  }
  return best
}

const refs = (a: Ask, max: number): Record<string, unknown> => (a.refUrls.length ? { image_urls: a.refUrls.slice(0, max) } : {})

export const UNIFICALLY_CLIPS = {
  // models/video/xai/grok-imagine-1.5-lite-video: 1–15 s, 480p/720p/1080p, `audio` false = silent, aspect ignored with a start frame
  'clip:grok-imagine-15-lite': {
    model: 'xai/grok-imagine-1.5-lite-video',
    input: (a) => ({ prompt: a.prompt, duration: a.seconds, resolution: '720p', audio: false, ...(a.startUrl ? { start_image_url: a.startUrl } : { aspect_ratio: a.aspect }) })
  },
  // models/video/bytedance/seedance-2.0-mini: 4–15 s, 480p or 720p, `first_frame_url`, `generate_audio`
  'clip:seedance-20-mini-480p': {
    model: 'bytedance/seedance-2.0-mini',
    input: (a) => ({ prompt: a.prompt, duration: a.seconds, resolution: '480p', generate_audio: false, ...(a.startUrl ? { first_frame_url: a.startUrl } : { aspect_ratio: a.aspect }) })
  },
  'clip:seedance-20-mini': {
    model: 'bytedance/seedance-2.0-mini',
    input: (a) => ({ prompt: a.prompt, duration: a.seconds, resolution: '720p', generate_audio: false, ...(a.startUrl ? { first_frame_url: a.startUrl } : { aspect_ratio: a.aspect }) })
  },
  // models/video/bytedance/seedance-1.5-pro: 4–12 s, 480p/720p/1080p
  'clip:seedance-15-pro': {
    model: 'bytedance/seedance-1.5-pro',
    input: (a) => ({ prompt: a.prompt, duration: a.seconds, resolution: '720p', generate_audio: false, ...(a.startUrl ? { first_frame_url: a.startUrl } : { aspect_ratio: a.aspect }) })
  },
  // models/video/minimax/hailuo: 2.3 Fast is start-frame only, 6 or 10 s, 768p or 1080p (no audio field: silent)
  'clip:hailuo-23-fast': {
    model: 'hailuo/minimax-2.3-fast',
    input: (a) => ({ prompt: a.prompt, duration: a.seconds, resolution: '768p', ...(a.startUrl ? { start_frame_url: a.startUrl } : {}) })
  },
  // models/video/kling/kling-2.5: `mode` std = 720p, 5 or 10 s; sound only when `sound_effects` is sent
  'clip:kling-25-turbo': {
    model: 'kuaishou/kling-2.5-turbo-video',
    input: (a) => ({ prompt: a.prompt, mode: 'std', duration: a.seconds, ...(a.startUrl ? { start_frame_url: a.startUrl } : { aspect_ratio: a.aspect }) })
  }
} as const satisfies Partial<Record<ClipEngine, UniModel>>

export const UNIFICALLY_IMAGES = {
  // models/image/flux/flux-3-image-klein: up to 4 references, 0.6–4 MP
  'image:flux3-klein': {
    model: 'black-forest-labs/flux-3-image-klein',
    input: (a) => ({ prompt: a.prompt, aspect_ratio: a.aspect, resolution: '1mp', ...refs(a, 4) })
  },
  // models/image/alibaba/z-image-turbo: text to image only, prompt at most 800 characters, `prompt_extend` off (it doubles the price)
  'image:z-image-turbo': {
    model: 'alibaba/z-image-turbo',
    input: (a) => ({ prompt: a.prompt.slice(0, 800), aspect_ratio: a.aspect })
  },
  // models/image/google/nano-banana-2-lite: 1K only
  'image:nano-banana-2-lite': {
    model: 'google/nano-banana-2-lite',
    input: (a) => ({ prompt: a.prompt, aspect_ratio: a.aspect, resolution: '1K', ...refs(a, 4) })
  },
  // models/image/google/nano-banana-2.1: up to 10 references
  'image:nano-banana-21': {
    model: 'google/nano-banana-2.1',
    input: (a) => ({ prompt: a.prompt, aspect_ratio: a.aspect, resolution: '1K', ...refs(a, 4) })
  },
  // models/image/bytedance/seedream-5.0-lite: no aspect field (the shape is asked in the prompt), 2K, web search off
  'image:seedream-50-lite': {
    model: 'bytedance/seedream-5.0-lite',
    input: (a) => ({ prompt: `${a.prompt}\n\nWide ${a.aspect} frame.`, resolution: '2K', output_format: 'jpeg', web_search: false, ...refs(a, 4) })
  }
} as const satisfies Partial<Record<ImageEngine, UniModel>>

export type UnificallyClipEngine = keyof typeof UNIFICALLY_CLIPS
export type UnificallyImageEngine = keyof typeof UNIFICALLY_IMAGES
export type UnificallyModelEngine = UnificallyClipEngine | UnificallyImageEngine

const IMAGE_ASPECTS: Record<UnificallyImageEngine, readonly string[]> = {
  'image:flux3-klein': ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'],
  'image:z-image-turbo': ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'],
  'image:nano-banana-2-lite': ['1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9'],
  'image:nano-banana-21': ['1:1', '16:9', '9:16', '4:3', '3:4'],
  'image:seedream-50-lite': ['1:1', '16:9', '9:16', '4:3', '3:4']
}

const isClip = (id: UnificallyModelEngine): id is UnificallyClipEngine => id.startsWith('clip:')

const Created = z.object({ data: z.object({ task_id: z.string().min(1) }).passthrough() }).passthrough()
const Quoted = z.object({ data: z.object({ cost: z.number().nonnegative() }).passthrough() }).passthrough()
const Polled = z
  .object({
    data: z
      .object({
        status: z.string(),
        output: z
          .object({ video_url: z.string().optional(), image_url: z.string().optional(), image_urls: z.array(z.string()).optional() })
          .passthrough()
          .nullish(),
        error_message: z.string().nullish()
      })
      .passthrough()
  })
  .passthrough()
const Ref = z.object({ op: z.string(), cost: z.number().nullable().optional() })

const unificallyError = (body: string): string | undefined => {
  try {
    const j = JSON.parse(body) as { data?: { message?: unknown } }
    return typeof j.data?.message === 'string' ? j.data.message : undefined
  } catch {
    return undefined
  }
}

export interface UnificallyModelOptions extends PollOptions, UnificallyHttp {
  id: UnificallyModelEngine
  baseUrl?: string
}

export function unificallyModelAdapter(o: UnificallyModelOptions): ProviderAdapter {
  const id = o.id
  const spec: UniModel = isClip(id) ? UNIFICALLY_CLIPS[id] : UNIFICALLY_IMAGES[id]
  const label = `${spec.model} (unifically)`
  const base = (o.baseUrl ?? UNIFICALLY_BASE).replace(/\/+$/, '')
  const poll: PollOptions = { ...o, maxWaitMs: o.maxWaitMs ?? 20 * 60_000 }
  const headers = (secret: string): Record<string, string> => ({ authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json' })

  const post = (secret: string, ctx: ProviderContext, body: Record<string, unknown>): Promise<Response> =>
    refusedWhen(
      unificallyCall({ label, url: `${base}/v1/tasks`, secret, signal: ctx.signal, detail: unificallyError, init: { method: 'POST', headers: headers(secret), body: JSON.stringify(body) } }, o),
      POLICY,
      label
    )

  /** The provider's own price of this request (free); null when the dry run does not answer as documented. */
  async function quote(secret: string, ctx: ProviderContext, input: Record<string, unknown>): Promise<number | null> {
    try {
      const q = Quoted.safeParse(await readJson(await post(secret, ctx, { model: spec.model, input, dry_run: true }), label, ctx.signal))
      return q.success ? q.data.data.cost : null
    } catch (err) {
      // a refusal or a fatal error (bad key, bad field) would fail the real call the same way: say it now
      if (err instanceof RetryableProviderError) return null
      throw err
    }
  }

  /** Submits (or resumes) the task, waits for it, downloads its file: the bytes, their type and the price paid. */
  async function run(ask: Ask, units: number, ctx: ProviderContext, accept: readonly string[]): Promise<{ bytes: Buffer; mime: string; costUsd: number; quoted: boolean }> {
    const secret = ctx.secret()
    const input = spec.input(ask)
    let saved = readRef(ctx.providerRef(), (v) => Ref.parse(v))
    if (!saved) {
      const cost = await quote(secret, ctx, input)
      const sub = Created.safeParse(await readJson(await post(secret, ctx, { model: spec.model, input }), label, ctx.signal))
      if (!sub.success) throw new RetryableProviderError(`${label}: unexpected answer to the submission`)
      saved = { op: sub.data.data.task_id, cost }
      ctx.setProviderRef(JSON.stringify(saved))
    }
    const { op: task, cost } = saved
    ctx.progress(0.1)
    const url = await pollUntil(label, poll, ctx, async () => {
      const res = await unificallyCall({ label, url: `${base}/v1/tasks/${encodeURIComponent(task)}`, secret, signal: ctx.signal, detail: unificallyError, init: { method: 'GET', headers: headers(secret) } }, o).catch((err: unknown) => {
        if (err instanceof Error && /HTTP 404/.test(err.message)) {
          ctx.setProviderRef(null)
          throw new Error(`${label}: unifically no longer knows this task`)
        }
        throw err
      })
      const parsed = Polled.safeParse(await readJson(res, label, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected status answer`)
      const d = parsed.data.data
      if (d.status === 'completed') {
        const link = d.output?.video_url ?? d.output?.image_url ?? d.output?.image_urls?.[0]
        if (!link) throw new RetryableProviderError(`${label}: the finished task carries no file link`)
        return { done: true as const, value: link }
      }
      if (d.status === 'failed') {
        ctx.setProviderRef(null)
        const text = d.error_message ?? ''
        if (POLICY.test(text)) throw refusal(label, `refused (${clean(text, secret, 100)})`)
        throw new Error(`${label}: the task failed${text ? ` (${clean(text, secret, 100)})` : ''}`)
      }
      return { done: false as const, progress: 0.4 }
    })
    ctx.progress(0.9)
    // a CDN link: the key is not sent to it
    const isVideo = accept.some((m) => m.startsWith('video/'))
    const got = await (isVideo ? downloadVideo : downloadFile)('unifically download', url, accept, ctx.signal, o)
    // a finished clip is already paid for: keep the task, the retry downloads it again
    if (!got) throw isVideo ? undownloadable(label) : new Error(`${label}: the file could not be downloaded`)
    ctx.setProviderRef(null)
    ctx.progress(1)
    return { bytes: Buffer.from(got.bytes), mime: got.mime, costUsd: cost ?? units * engineUsd(id), quoted: cost !== null && cost !== undefined }
  }

  async function generateVideo(input: UsageInput<'generateVideo'>, ctx: ProviderContext) {
    const seconds = clipLengthFor(id, input.seconds)
    // a resumed task needs no picture: it is only uploaded for a new submission
    const fresh = !ctx.providerRef()
    const startUrl = input.imageArtefactId && fresh ? await uploadToUnifically(ctx, input.imageArtefactId, ctx.secret(), label, o) : undefined
    const got = await run({ prompt: withAvoid(input.prompt, input.negative), aspect: input.aspect, seconds, refUrls: [], ...(startUrl ? { startUrl } : {}) }, seconds, ctx, ['video/mp4', 'video/webm'])
    return {
      files: [{ name: got.mime === 'video/webm' ? 'clip.webm' : 'clip.mp4', mime: got.mime, bytes: got.bytes }],
      data: { engine: id, model: spec.model, seconds, requestedSeconds: input.seconds, fromImage: Boolean(input.imageArtefactId), quotedUsd: got.quoted ? got.costUsd : null },
      costUsd: got.costUsd
    }
  }

  async function generateImage(input: UsageInput<'generateImage'>, ctx: ProviderContext) {
    const aspect = nearestAspect(input.width, input.height, IMAGE_ASPECTS[id as UnificallyImageEngine])
    const refUrls = ctx.providerRef() ? [] : await Promise.all((input.referenceArtefactIds ?? []).map((r) => uploadToUnifically(ctx, r, ctx.secret(), label, o)))
    const files: { name: string; mime: string; bytes: Buffer }[] = []
    let costUsd = 0
    let quoted = true
    for (let i = 0; i < input.count; i++) {
      const got = await run({ prompt: withAvoid(input.prompt, input.negative), aspect, seconds: 0, refUrls }, 1, ctx, ['image/png', 'image/jpeg', 'image/webp'])
      files.push({ name: `image-${i + 1}.${got.mime === 'image/png' ? 'png' : got.mime === 'image/webp' ? 'webp' : 'jpg'}`, mime: got.mime, bytes: got.bytes })
      costUsd += got.costUsd
      quoted &&= got.quoted
    }
    return { files, data: { engine: id, model: spec.model, aspect, references: (input.referenceArtefactIds ?? []).length, quotedUsd: quoted ? costUsd : null }, costUsd }
  }

  return isClip(id)
    ? { id, kind: 'real', secretName: 'UNIFICALLY_API_KEY', generateVideo }
    : { id, kind: 'real', secretName: 'UNIFICALLY_API_KEY', generateImage }
}

export const UNIFICALLY_MODEL_ENGINES = [...Object.keys(UNIFICALLY_IMAGES), ...Object.keys(UNIFICALLY_CLIPS)] as UnificallyModelEngine[]
