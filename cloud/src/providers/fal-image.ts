// GPT Image 2.5 on fal.ai (usage `generateImage`, production-10 fallback of the OpenAI engines): `image:gpt-image-25-fal-low` and
// `image:gpt-image-25-fal-medium`, one adapter each whose id IS the engine id, one vault entry FAL_KEY (the same as fal.ts).
// Written from the model pages read on 2026-11-01 (https://fal.ai/models/openai/gpt-image-2.5/flare/text-to-image/api ,
// https://fal.ai/models/openai/gpt-image-2.5/sunburst/edit/api , fal.ai/gpt-image-2.5), NEVER called: every field below is
// unconfirmed until the first real call (docs/PROVIDERS.md §6).
//   Auth     `Authorization: Key <FAL_KEY>` on fal.run only; the pictures are downloaded from fal's CDN without it.
//   Without references   POST https://fal.run/openai/gpt-image-2.5/flare/text-to-image (synchronous, like the FLUX pictures of
//            fal.ts) { prompt, image_size { width, height }, quality low | medium, num_images, output_format png }
//            → { images [{ url, content_type, width, height }] }.
//   With references      POST https://fal.run/openai/gpt-image-2.5/sunburst/edit, the same fields plus `image_urls` (≤ 16; we
//            send at most the engine's `references`): the short signed links of OUR storage (decision 0025).
//   Size     CHOSEN: the custom `image_size { width, height }` object fal's image models take (fal.ts sends it to FLUX), computed
//            as for OpenAI (openaiSize: multiples of 16, ratio ≤ 3:1, inside OpenAI's pixel budget), so 1280×720 is asked as it
//            is. TO CONFIRM: that this endpoint takes a custom size (fal's older GPT Image endpoints took only the presets
//            1024×1024, 1536×1024, 1024×1536; if it answers 422, send the nearest preset instead).
//   Quality  low | medium, from the engine id.
//   Negative no field: « Avoid: … » is written at the end of the prompt.
//   Refusal  fal's validation error is 422 { detail: [{ loc, msg, type }] }; a `type` (or text) speaking of content policy,
//            moderation or safety is a `refused:` error, never retried. TO CONFIRM: the exact type of a GPT Image refusal.
//   Price    the registry line per picture (engines.ts: 0.006 low, 0.0133 medium for 1024², the same token price as OpenAI).
// The call is synchronous: a timeout or a 5xx is retried like the other picture engines (openai-image.ts, fal.ts): a lost answer
// may cost one picture again (at most 0.0133 USD), the price of not leaving a job stuck. The answer is awaited up to 3 minutes.
import { z } from 'zod'
import type { UsageInput } from '../../../src/shared/cloud-api.ts'
import { referencesOf } from '../../../src/shared/visual-engines.ts'
import { FAL_RUN_BASE } from './fal.ts'
import { call, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { openaiSize } from './openai-image.ts'
import { downloadFile } from './stock-common.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'
import { engineUsd, refusedWhen, withAvoid } from './visual-common.ts'

export const FAL_GPT_IMAGE_ENDPOINT = 'openai/gpt-image-2.5/flare/text-to-image'
export const FAL_GPT_IMAGE_EDIT_ENDPOINT = 'openai/gpt-image-2.5/sunburst/edit'
export const FAL_GPT_IMAGE_ENGINES = { 'image:gpt-image-25-fal-low': 'low', 'image:gpt-image-25-fal-medium': 'medium' } as const
export type FalGptImageEngine = keyof typeof FAL_GPT_IMAGE_ENGINES

export interface FalGptImageOptions extends HttpOptions {
  /** The engine id (also the adapter id). */
  id: FalGptImageEngine
  runBase?: string
}

const Answer = z.object({ images: z.array(z.object({ url: z.string(), content_type: z.string().optional() }).passthrough()).default([]) }).passthrough()

/** fal's error detail: a string, or the type (else the message) of the first validation error. */
export const falDetail = (body: string): string | undefined => {
  try {
    const d = (JSON.parse(body) as { detail?: unknown }).detail
    if (typeof d === 'string') return d
    const first = Array.isArray(d) ? (d[0] as { type?: unknown; msg?: unknown } | undefined) : undefined
    return typeof first?.type === 'string' ? first.type : typeof first?.msg === 'string' ? first.msg : undefined
  } catch {
    return undefined
  }
}

const REFUSED = /content_policy|moderation|safety|nsfw/i

export function falGptImageAdapter(o: FalGptImageOptions): ProviderAdapter {
  const label = 'GPT Image (fal)'
  const runBase = (o.runBase ?? FAL_RUN_BASE).replace(/\/+$/, '')
  const quality = FAL_GPT_IMAGE_ENGINES[o.id]
  // a picture takes a while: more than the default minute
  const http: HttpOptions = { ...o, timeoutMs: o.timeoutMs ?? 180_000 }

  async function generateImage(input: UsageInput<'generateImage'>, ctx: ProviderContext) {
    const secret = ctx.secret()
    const refs = (input.referenceArtefactIds ?? []).slice(0, referencesOf(o.id))
    const endpoint = refs.length > 0 ? FAL_GPT_IMAGE_EDIT_ENDPOINT : FAL_GPT_IMAGE_ENDPOINT
    const [width, height] = openaiSize(input.width, input.height).split('x').map(Number) as [number, number]
    ctx.progress(0.1)
    const res = await refusedWhen(
      call(
        {
          label,
          url: `${runBase}/${endpoint}`,
          secret,
          signal: ctx.signal,
          detail: falDetail,
          init: {
            method: 'POST',
            headers: { authorization: `Key ${secret}`, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              prompt: withAvoid(input.prompt, input.negative),
              image_size: { width, height },
              quality,
              num_images: input.count,
              output_format: 'png',
              ...(refs.length > 0 ? { image_urls: refs.map((id) => ctx.artefactUrl(id)) } : {})
            })
          }
        },
        http
      ),
      REFUSED,
      label
    )
    const parsed = Answer.safeParse(await readJson(res, label, ctx.signal))
    if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
    if (parsed.data.images.length === 0) throw new RetryableProviderError(`${label}: the answer carries no picture`)
    const files: { name: string; mime: string; bytes: Buffer }[] = []
    for (const [i, img] of parsed.data.images.entries()) {
      throwIfAborted(ctx.signal)
      // fal's CDN: the key is not sent to it
      const got = await downloadFile(`${label} download`, img.url, ['image/png', 'image/jpeg', 'image/webp'], ctx.signal, http)
      if (!got) throw new Error(`${label}: a picture could not be downloaded`)
      files.push({ name: `image-${i + 1}.${got.mime === 'image/jpeg' ? 'jpg' : got.mime === 'image/webp' ? 'webp' : 'png'}`, mime: got.mime, bytes: Buffer.from(got.bytes) })
      ctx.progress(0.1 + (0.9 * (i + 1)) / parsed.data.images.length)
    }
    return {
      files,
      data: { engine: o.id, model: endpoint, quality, size: `${width}x${height}`, requested: { width: input.width, height: input.height }, count: files.length, references: refs.length },
      costUsd: files.length * engineUsd(o.id)
    }
  }

  return { id: o.id, kind: 'real', secretName: 'FAL_KEY', generateImage }
}
