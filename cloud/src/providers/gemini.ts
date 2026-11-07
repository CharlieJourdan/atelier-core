// Gemini "eyes" (usage `analyseVideo`), written from the official documentation read on 2026-10-24:
//   Video input   https://ai.google.dev/gemini-api/docs/video-understanding : a public YouTube link is handed to the model
//                 as `fileData.fileUri` (preview feature; public videos only, no download on our side).
//   REST          https://ai.google.dev/api/generate-content : POST https://generativelanguage.googleapis.com/v1beta/
//                 models/{model}:generateContent, key in the `x-goog-api-key` header (never in the URL, so it cannot reach a
//                 log); contents[].parts[] { fileData{fileUri}, videoMetadata{endOffset}, text }; generationConfig
//                 { responseMimeType: application/json, responseJsonSchema, mediaResolution, maxOutputTokens, temperature };
//                 answer candidates[].content.parts[].text, candidates[].finishReason, promptFeedback.blockReason,
//                 usageMetadata { promptTokenCount, candidatesTokenCount, thoughtsTokenCount, promptTokensDetails[] }.
//   Prices        https://ai.google.dev/gemini-api/docs/pricing (paid tier, USD per 1M tokens, read 2026-10-24).
//   Default model gemini-3.1-flash-lite: the Flash-Lite that research note BUSINESS-INFRA (old repository) §4.7 names for tier 1
//                 (about USD 0.023 per 10-minute video). gemini-2.5-flash-lite is cheaper on paper (0.10 / 0.40) but older;
//                 the model is a config value (config.json "gemini": {"model": …}).
// The docs now present the newer Interactions API (/v1beta/interactions) first; generateContent is still served and is the
// stable endpoint, so it is used here. TO VERIFY with the first real key: that `generationConfig.mediaResolution` accepts
// MEDIA_RESOLUTION_LOW (the page's Part also has a per-part `mediaResolution {level}`; the field to change is MEDIA below)
// and that a YouTube `fileData` needs no `mimeType`.
// Cost safety: the quote is for `minutes` of video, so the analysis is cut at that length (`videoMetadata.endOffset`) and
// the output is capped (`maxOutputTokens`); a longer video is analysed for its first `minutes` only.
import { z } from 'zod'
import { geminiImageMethod, GEMINI_IMAGE_DEFAULT_MODEL } from './gemini-image.ts'
import { call, clean, readJson, type HttpOptions } from './http.ts'
import { ANALYSIS_JSON_SCHEMA, ANALYSIS_PROMPT, AnalysisResult } from './gemini-schema.ts'
import { RetryableProviderError, type ProviderAdapter } from './types.ts'

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com'
export const GEMINI_DEFAULT_MODEL = 'gemini-3.1-flash-lite'
export const GEMINI_MAX_OUTPUT_TOKENS = 4096
/** The one place the media resolution is set (see TO VERIFY above). */
const MEDIA = { mediaResolution: 'MEDIA_RESOLUTION_LOW' } as const

/** USD per 1M tokens: text/image/video input, audio input, output (thinking included). */
export interface GeminiPrice {
  input: number
  audio: number
  output: number
}
export const GEMINI_PRICES: Record<string, GeminiPrice> = {
  'gemini-3.1-flash-lite': { input: 0.25, audio: 0.5, output: 1.5 },
  'gemini-3.5-flash-lite': { input: 0.3, audio: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, audio: 0.3, output: 0.4 },
  'gemini-3.8-flash': { input: 0.75, audio: 0.75, output: 3.75 }
}
/** A model not in the table is priced at the highest rate known, so a P&L never under-reports. */
export function geminiPrice(model: string): GeminiPrice {
  const exact = GEMINI_PRICES[model] ?? Object.entries(GEMINI_PRICES).find(([k]) => model.startsWith(k))?.[1]
  if (exact) return exact
  const all = Object.values(GEMINI_PRICES)
  return { input: Math.max(...all.map((p) => p.input)), audio: Math.max(...all.map((p) => p.audio)), output: Math.max(...all.map((p) => p.output)) }
}

const Usage = z
  .object({
    promptTokenCount: z.number().default(0),
    candidatesTokenCount: z.number().default(0),
    thoughtsTokenCount: z.number().default(0),
    promptTokensDetails: z.array(z.object({ modality: z.string(), tokenCount: z.number() })).default([])
  })
  .passthrough()

const Answer = z
  .object({
    candidates: z
      .array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() }).passthrough()).default([]) }).partial().nullish(), finishReason: z.string().optional() }).passthrough())
      .default([]),
    promptFeedback: z.object({ blockReason: z.string().optional() }).passthrough().nullish(),
    usageMetadata: Usage.nullish()
  })
  .passthrough()

export function geminiCostUsd(model: string, usage: z.infer<typeof Usage> | null | undefined): number {
  if (!usage) return 0
  const p = geminiPrice(model)
  const audio = usage.promptTokensDetails.filter((d) => d.modality.toUpperCase() === 'AUDIO').reduce((s, d) => s + d.tokenCount, 0)
  const rest = Math.max(0, usage.promptTokenCount - audio)
  return (rest * p.input + audio * p.audio + (usage.candidatesTokenCount + usage.thoughtsTokenCount) * p.output) / 1_000_000
}

export interface GeminiOptions extends HttpOptions {
  model?: string
  /** The picture model of `generateImage` (default gemini-nano-banana-2.1, see gemini-image.ts). */
  imageModel?: string
  baseUrl?: string
}

const errorDetail = (body: string): string | undefined => {
  try {
    const e = (JSON.parse(body) as { error?: { status?: unknown } }).error
    return typeof e?.status === 'string' ? e.status : undefined
  } catch {
    return undefined
  }
}

export function geminiAdapter(o: GeminiOptions = {}): ProviderAdapter {
  const model = o.model ?? GEMINI_DEFAULT_MODEL
  const base = (o.baseUrl ?? GEMINI_BASE).replace(/\/+$/, '')
  const label = 'Gemini analysis'
  return {
    id: 'gemini',
    kind: 'real',
    secretName: 'GEMINI_API_KEY',
    generateImage: geminiImageMethod(base, o.imageModel ?? GEMINI_IMAGE_DEFAULT_MODEL, o),
    async analyseVideo(input, ctx) {
      const secret = ctx.secret()
      const seconds = Math.ceil(input.minutes * 60)
      ctx.progress(0.1)
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
              contents: [
                {
                  role: 'user',
                  parts: [{ fileData: { fileUri: input.url }, videoMetadata: { endOffset: `${seconds}s` } }, { text: ANALYSIS_PROMPT }]
                }
              ],
              generationConfig: {
                responseMimeType: 'application/json',
                responseJsonSchema: ANALYSIS_JSON_SCHEMA,
                maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
                temperature: 0.2,
                ...MEDIA
              }
            })
          }
        },
        o
      )
      const parsed = Answer.safeParse(await readJson(res, label, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
      const { candidates, promptFeedback, usageMetadata } = parsed.data
      if (promptFeedback?.blockReason) throw new Error(`${label}: the video was refused (${clean(promptFeedback.blockReason, secret, 40)})`)
      const first = candidates[0]
      const text = first?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
      if (first?.finishReason === 'MAX_TOKENS') throw new Error(`${label}: the answer was cut at ${GEMINI_MAX_OUTPUT_TOKENS} tokens`)
      if (!text.trim()) throw new RetryableProviderError(`${label}: empty answer${first?.finishReason ? ` (${clean(first.finishReason, secret, 40)})` : ''}`)
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        throw new RetryableProviderError(`${label}: the answer is not JSON`)
      }
      // the editing measures are a bonus: a measure out of range drops them, never the analysis
      let analysis = AnalysisResult.safeParse(json)
      if (!analysis.success && analysis.error.issues.every((i) => i.path[0] === 'measures') && typeof json === 'object' && json !== null) {
        analysis = AnalysisResult.safeParse({ ...(json as Record<string, unknown>), measures: undefined })
      }
      if (!analysis.success) throw new RetryableProviderError(`${label}: the answer does not match the schema (${analysis.error.issues[0]?.path.join('.') || 'shape'})`)
      const a = analysis.data
      ctx.progress(1)
      return {
        files: [],
        data: {
          url: input.url,
          model,
          analysedSeconds: seconds,
          summary: a.summary,
          cutsPerMinute: a.pacing.cutsPerMinute,
          segments: a.structure.map((s) => ({ from: s.fromS, to: s.toS, kind: s.kind })),
          analysis: a
        },
        costUsd: geminiCostUsd(model, usageMetadata)
      }
    }
  }
}
