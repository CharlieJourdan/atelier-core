// Gemini images, "Nano Banana" (usage `generateImage`), same adapter id (`gemini`) and same vault entry (GEMINI_API_KEY) as the
// "eyes" (gemini.ts): picking `"generateImage": "gemini"` in config.json is enough.
//   Models  https://ai.google.dev/gemini-api/docs/image-generation (read 2026-10-24): gemini-nano-banana-2.1 (recommended
//           workhorse), gemini-3.1-flash-image (Nano Banana 2), gemini-3-pro-image (Nano Banana Pro, text in the picture),
//           gemini-2.5-flash-image (legacy, shut down on 2026-10-02: never the default).
//   Call    the same stable endpoint as the analysis, POST /v1beta/models/{model}:generateContent, key in `x-goog-api-key`;
//           generationConfig { responseModalities: ["IMAGE"], imageConfig { aspectRatio, imageSize: "1K" } };
//           answer candidates[0].content.parts[].inlineData { mimeType, data (base64) }. One picture per call, so `count`
//           pictures are `count` calls, one after the other.
//   Price   USD per picture at 1K (research note BUSINESS-INFRA (old repository) §3.3, read 2026-10-24): 0.0336 for Nano Banana 2.1, 0.067 for
//           2, 0.134 for Pro. The size is not chosen by us: the model answers in its 1K size for the aspect ratio nearest to
//           width × height; the engine crops and scales to the final size. A model not in the table is priced at the highest
//           rate known, so a P&L never under-reports.
// TO VERIFY with the first real key: that `gemini-nano-banana-2.1` is accepted by generateContent (the page now presents the
// newer Interactions API first, `response_format { type: "image", aspect_ratio, image_size }`; generateContent is still
// the endpoint the analysis uses) and that `imageConfig` is the field name there. A refused field is a 400 that names it.
import { z } from 'zod'
import type { UsageInput } from '../../../src/shared/cloud-api.ts'
import { call, clean, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { fetchArtefactImage, withAvoid } from './visual-common.ts'
import { RetryableProviderError, type ProviderAdapter } from './types.ts'

export const GEMINI_IMAGE_DEFAULT_MODEL = 'gemini-nano-banana-2.1'
/** USD per picture at 1K. */
export const GEMINI_IMAGE_PRICES: Record<string, number> = {
  'gemini-nano-banana-2.1': 0.0336,
  'gemini-3.1-flash-image': 0.067,
  'gemini-3-pro-image': 0.134,
  'gemini-2.5-flash-image': 0.039
}
export function geminiImagePrice(model: string): number {
  return GEMINI_IMAGE_PRICES[model] ?? Math.max(...Object.values(GEMINI_IMAGE_PRICES))
}

/** The aspect ratios the model accepts. */
const RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const
export function nearestRatio(width: number, height: number): (typeof RATIOS)[number] {
  const want = Math.log(width / height)
  let best: (typeof RATIOS)[number] = '16:9'
  let gap = Infinity
  for (const r of RATIOS) {
    const [w, h] = r.split(':').map(Number) as [number, number]
    const d = Math.abs(Math.log(w / h) - want)
    if (d < gap) {
      gap = d
      best = r
    }
  }
  return best
}

const Answer = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z
                  .array(z.object({ text: z.string().optional(), inlineData: z.object({ mimeType: z.string().optional(), data: z.string() }).partial({ mimeType: true }).optional() }).passthrough())
                  .default([])
              })
              .partial()
              .nullish(),
            finishReason: z.string().optional()
          })
          .passthrough()
      )
      .default([]),
    promptFeedback: z.object({ blockReason: z.string().optional() }).passthrough().nullish()
  })
  .passthrough()

const errorDetail = (body: string): string | undefined => {
  try {
    const e = (JSON.parse(body) as { error?: { status?: unknown } }).error
    return typeof e?.status === 'string' ? e.status : undefined
  } catch {
    return undefined
  }
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export function geminiImageMethod(base: string, model: string, o: HttpOptions): NonNullable<ProviderAdapter['generateImage']> {
  const label = 'Gemini image'
  return async function generateImage(input: UsageInput<'generateImage'>, ctx) {
    const secret = ctx.secret()
    const ratio = nearestRatio(input.width, input.height)
    const files: { name: string; mime: string; bytes: Buffer }[] = []
    // the team's reference pictures (production-8) go in the same request as inline image parts, after the text; no negative field
    // exists, so « Avoid: … » ends the prompt
    const parts: unknown[] = [{ text: withAvoid(input.prompt, input.negative) }]
    for (const refId of input.referenceArtefactIds ?? []) {
      throwIfAborted(ctx.signal)
      const ref = await fetchArtefactImage(ctx, refId, label, o)
      parts.push({ inlineData: { mimeType: ref.mime, data: ref.bytes.toString('base64') } })
    }
    for (let i = 0; i < input.count; i++) {
      throwIfAborted(ctx.signal)
      const res = await call(
        {
          label,
          url: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          secret,
          signal: ctx.signal,
          detail: errorDetail,
          init: {
            method: 'POST',
            headers: { 'x-goog-api-key': secret, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts }],
              generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio, imageSize: '1K' } }
            })
          }
        },
        o
      )
      const parsed = Answer.safeParse(await readJson(res, label, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
      const { candidates, promptFeedback } = parsed.data
      if (promptFeedback?.blockReason) throw new Error(`${label}: the prompt was refused (${clean(promptFeedback.blockReason, secret, 40)})`)
      const first = candidates[0]
      const part = first?.content?.parts?.find((p) => p.inlineData?.data)
      if (!part?.inlineData) {
        // a safety stop is the same on every try; an empty answer may not be
        const reason = first?.finishReason
        if (reason && /SAFETY|PROHIBITED|BLOCK|RECITATION/i.test(reason)) throw new Error(`${label}: no picture (${clean(reason, secret, 40)})`)
        throw new RetryableProviderError(`${label}: the answer carries no picture${reason ? ` (${clean(reason, secret, 40)})` : ''}`)
      }
      const bytes = Buffer.from(part.inlineData.data, 'base64')
      if (bytes.length === 0) throw new RetryableProviderError(`${label}: the picture is empty`)
      const mime = part.inlineData.mimeType ?? 'image/png'
      files.push({ name: `image-${i + 1}.${EXT[mime] ?? 'png'}`, mime, bytes })
      ctx.progress((i + 1) / input.count)
    }
    return {
      files,
      data: { model, aspectRatio: ratio, imageSize: '1K', requested: { width: input.width, height: input.height }, count: files.length, references: parts.length - 1 },
      costUsd: files.length * geminiImagePrice(model)
    }
  }
}
