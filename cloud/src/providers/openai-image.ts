// OpenAI image engines (usage `generateImage`): `image:gpt-image-25-low`, `-medium` and `-high` (production-10), one adapter each
// (its id IS the engine id), one vault entry OPENAI_API_KEY. Written from the OpenAI image generation guide read on 2026-11-01
// (https://developers.openai.com/api/docs/guides/image-generation; platform.openai.com/docs/... redirects there), never called:
//   Auth     `Authorization: Bearer <OPENAI_API_KEY>`.
//   Without references   POST https://api.openai.com/v1/images/generations (JSON) { model, prompt, n, size, quality, output_format,
//            moderation } → { data [{ b64_json }], usage { input_tokens, output_tokens, … } }. Always base64, no response_format.
//   With references      POST https://api.openai.com/v1/images/edits (multipart) model, prompt, n, size, quality, output_format and
//            one `image[]` part per reference (PNG, JPEG or WebP, read from the team's artefacts). Same answer.
//   Size     « WIDTHxHEIGHT », both multiples of 16, ratio at most 3:1, edges at most 3840, 655 360 to 8 294 400 pixels in all.
//   Quality  low | medium | high | …; the engine id names it.
//   Refusal  HTTP 400 { error { type: "image_generation_user_error", code: "moderation_blocked", moderation_details } } → a
//            `refused:` error (never retried: the same prompt is refused the same way).
//   Negative no field: « Avoid: … » is written at the end of the prompt.
//   Price    per token (USD 30 per million output tokens, the page above), not per picture: the job's cost is the answer's
//            `usage.output_tokens` at that rate (production-17: a job is charged its real cost). The prompt's input tokens are not
//            priced (the page gives no input rate for this model; a text prompt is a few hundred tokens). An answer without
//            `usage` falls back to the registry line per picture (engines.ts: 0.0059 low, 0.0132 medium, 0.0527 high). The tokens
//            are kept in `data.usage` so the bills can be reconciled.
// TO CONFIRM on the first call: the model ids (the guide names `gpt-image-2.5-sunburst`, « for editing precision », and
// `gpt-image-2.5-flare`, « fast, everyday generation »; it says both use the same token rates; a plain `gpt-image-2.5` is not
// mentioned), that custom sizes such as 1280×720 are accepted, how many input images an edit takes (the page does not say; the
// engine sends at most 4), and the real price per picture at the size asked.
import { z } from 'zod'
import type { UsageInput } from '../../../src/shared/cloud-api.ts'
import { call, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'
import { engineUsd, fetchArtefactImage, refusedWhen, withAvoid } from './visual-common.ts'

export const OPENAI_BASE = 'https://api.openai.com'
/** TO CONFIRM on the first call (see the header). Generations use the fast model, edits (references) the precise one. */
export const OPENAI_GENERATE_MODEL = 'gpt-image-2.5-flare'
export const OPENAI_EDIT_MODEL = 'gpt-image-2.5-sunburst'
export const OPENAI_IMAGE_ENGINES = { 'image:gpt-image-25-low': 'low', 'image:gpt-image-25-medium': 'medium', 'image:gpt-image-25-high': 'high' } as const
export type OpenAiImageEngine = keyof typeof OPENAI_IMAGE_ENGINES

/** USD per output token (USD 30 per million). */
export const OPENAI_IMAGE_USD_PER_OUTPUT_TOKEN = 30 / 1_000_000

const MIN_PIXELS = 655_360
const MAX_PIXELS = 8_294_400
const MAX_EDGE = 3840

/** The size to ask for: the requested one, multiples of 16, ratio ≤ 3:1, inside the pixel budget (the engine scales to the final size). */
export function openaiSize(width: number, height: number): string {
  let w = Math.min(MAX_EDGE, width)
  let h = Math.min(MAX_EDGE, height)
  if (w / h > 3) w = h * 3
  if (h / w > 3) h = w * 3
  const px = w * h
  const k = px < MIN_PIXELS ? Math.sqrt(MIN_PIXELS / px) : px > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / px) : 1
  const to16 = (n: number): number => Math.max(16, (k > 1 ? Math.ceil((n * k) / 16) : k < 1 ? Math.floor((n * k) / 16) : Math.round(n / 16)) * 16)
  return `${to16(w)}x${to16(h)}`
}

export interface OpenAiImageOptions extends HttpOptions {
  /** The engine id (also the adapter id). */
  id: OpenAiImageEngine
  baseUrl?: string
  generateModel?: string
  editModel?: string
}

const Answer = z
  .object({
    data: z.array(z.object({ b64_json: z.string().optional() }).passthrough()).default([]),
    usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional(), total_tokens: z.number().optional() }).passthrough().nullish()
  })
  .passthrough()

const errorDetail = (body: string): string | undefined => {
  try {
    const e = (JSON.parse(body) as { error?: { code?: unknown; type?: unknown } }).error
    return typeof e?.code === 'string' ? e.code : typeof e?.type === 'string' ? e.type : undefined
  } catch {
    return undefined
  }
}

const REFUSED = /moderation_blocked|content_policy_violation|safety_violation/

export function openaiImageAdapter(o: OpenAiImageOptions): ProviderAdapter {
  const label = 'OpenAI image'
  const base = (o.baseUrl ?? OPENAI_BASE).replace(/\/+$/, '')
  const quality = OPENAI_IMAGE_ENGINES[o.id]
  // a picture takes a while: more than the default minute
  const http: HttpOptions = { ...o, timeoutMs: o.timeoutMs ?? 180_000 }

  async function generateImage(input: UsageInput<'generateImage'>, ctx: ProviderContext) {
    const secret = ctx.secret()
    const prompt = withAvoid(input.prompt, input.negative)
    const size = openaiSize(input.width, input.height)
    const refs = input.referenceArtefactIds ?? []
    const fields = { prompt, n: String(input.count), size, quality, output_format: 'png' }
    ctx.progress(0.1)
    let res: Response
    if (refs.length === 0) {
      const model = o.generateModel ?? OPENAI_GENERATE_MODEL
      res = await refusedWhen(
        call(
          {
            label,
            url: `${base}/v1/images/generations`,
            secret,
            signal: ctx.signal,
            detail: errorDetail,
            init: {
              method: 'POST',
              headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ model, ...fields, n: input.count, moderation: 'auto' })
            }
          },
          http
        ),
        REFUSED,
        label
      )
    } else {
      const model = o.editModel ?? OPENAI_EDIT_MODEL
      const form = new FormData()
      form.set('model', model)
      for (const [k, v] of Object.entries(fields)) form.set(k, v)
      for (const [i, id] of refs.entries()) {
        throwIfAborted(ctx.signal)
        const ref = await fetchArtefactImage(ctx, id, label, http)
        form.append('image[]', new Blob([ref.bytes as Uint8Array<ArrayBuffer>], { type: ref.mime }), `ref-${i + 1}.${ref.mime === 'image/jpeg' ? 'jpg' : ref.mime === 'image/webp' ? 'webp' : 'png'}`)
      }
      ctx.progress(0.2)
      res = await refusedWhen(
        call(
          { label, url: `${base}/v1/images/edits`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'POST', headers: { authorization: `Bearer ${secret}`, accept: 'application/json' }, body: form } },
          http
        ),
        REFUSED,
        label
      )
    }
    const parsed = Answer.safeParse(await readJson(res, label, ctx.signal))
    if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
    const pictures = parsed.data.data.filter((d) => d.b64_json)
    if (pictures.length === 0) throw new RetryableProviderError(`${label}: the answer carries no picture`)
    const files = pictures.map((d, i) => ({ name: `image-${i + 1}.png`, mime: 'image/png', bytes: Buffer.from(d.b64_json as string, 'base64') }))
    if (files.some((f) => f.bytes.length === 0)) throw new RetryableProviderError(`${label}: a picture is empty`)
    ctx.progress(1)
    const usage = parsed.data.usage
    return {
      files,
      data: {
        engine: o.id,
        model: refs.length === 0 ? (o.generateModel ?? OPENAI_GENERATE_MODEL) : (o.editModel ?? OPENAI_EDIT_MODEL),
        quality,
        size,
        requested: { width: input.width, height: input.height },
        count: files.length,
        references: refs.length,
        ...(usage ? { usage: { inputTokens: usage.input_tokens ?? null, outputTokens: usage.output_tokens ?? null } } : {})
      },
      costUsd: typeof usage?.output_tokens === 'number' ? usage.output_tokens * OPENAI_IMAGE_USD_PER_OUTPUT_TOKEN : files.length * engineUsd(o.id)
    }
  }

  return { id: o.id, kind: 'real', secretName: 'OPENAI_API_KEY', generateImage }
}
