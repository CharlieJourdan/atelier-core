// MiniMax voice (usage `synthesize`), written from the official documentation read on 2026-10-24:
//   API   https://platform.minimax.io/docs/api-reference/speech-t2a-http
//         POST https://api.minimax.io/v1/t2a_v2  (mainland China: https://api.minimaxi.com/v1/t2a_v2)
//         `Authorization: Bearer <key>`, `Content-Type: application/json`. The page mentions no GroupId: the key alone is
//         enough, so the vault holds ONE entry, MINIMAX_API_KEY. (Older docs asked for a `?GroupId=` query parameter;
//         if a real key is refused with "invalid group", add it then — see docs/PROVIDERS.md.)
//         Body: model, text (< 10 000 chars), stream:false, voice_setting {voice_id, speed 0.5–2, vol, pitch},
//         audio_setting {sample_rate, bitrate, format mp3, channel}, language_boost ("auto" or a language),
//         output_format "hex", subtitle_enable + subtitle_type "word".
//         Answer: { data: { audio (hex), status, subtitle_file }, extra_info: { audio_length (ms), usage_characters,
//         usage_voice_count }, base_resp: { status_code, status_msg } }; status_code 0 = success, 1000 unknown, 1001 timeout,
//         1002 rate limit, 1004 authentication failed, 1039 TPM rate limit, 1042 too many invalid characters, 2013 bad input.
//   Price https://platform.minimax.io/docs/guides/pricing-paygo : speech-2.8-hd USD 100 per 1M characters,
//         speech-2.8-turbo USD 60 per 1M; a cloned or designed voice costs a one-off fee at its first use (USD 1.50 / 3.00).
// A text longer than one request is voiced in several calls (text-chunks.ts) and the MP3 pieces are joined. The job is
// billed in characters (`measure` = usage_characters, as the provider counted them). Word timings come from the
// `subtitle_file` link when the answer carries one; if that file cannot be read the voice still succeeds with no words
// (the engine then aligns the script itself).
// Voice cloning (usage `cloneVoice`, https://platform.minimax.io/docs/guides/speech-voice-clone, read 2026-10-24):
//   1. POST {host}/v1/files/upload  multipart form: purpose=voice_clone, file=<audio>  -> { file: { file_id }, base_resp }
//   2. POST {host}/v1/voice_clone   JSON { file_id, voice_id, model }                  -> { base_resp, ... }
//   `Authorization: Bearer <key>` on both. The voice id is OURS (we choose it; the page gives no format rule, so it is
//   `clone-` + 16 hex digits of the Cloud job id: the same job always asks for the same voice). The clip: mp3, m4a or wav,
//   10 s to 5 min, at most 20 MB. No preview text is sent (a preview would be billed as speech). The page lists no error
//   codes and no response schema for the clone call: success is `base_resp.status_code === 0`, anything else fails the job.
//   The one-off fee of USD 1.50 is the cost of the clone job; the first speech with the voice reports the same fee in
//   `usage_voice_count`, which a synthesis does NOT add to its own cost again (it is already the clone job's).
// Voice design (usage `designVoice`, production-10; https://platform.minimax.io/docs/api-reference/voice-design and the pricing
// page, read 2026-11-01, NEVER called: every name is unconfirmed until the first real call):
//   POST {host}/v1/voice_design  `Authorization: Bearer <key>` { prompt (the description), preview_text (≤ 500 characters) }
//   → { voice_id, trial_audio (hex, MP3), base_resp { status_code 0 = ok, status_msg } }. One preview per request; the voice
//   exists at once under `voice_id` (it is the preview's `generatedVoiceId`; `keep` calls nothing, the id already works).
//   Price: the preview is billed as speech, 60 USD per million characters on the pricing page (the API reference says 30: the
//   higher figure is used); the designed voice costs 3 USD once, charged by MiniMax at its FIRST use in a synthesis. That fee is
//   reported as the cost of the `keep` job (as the clone fee is the clone job's), never again by a synthesis.
//   A designed voice that is never used is DELETED by MiniMax after 168 hours (7 days): a voice kept must be used within the week.
//   No content-refusal code is documented for this route: codes 1026 / 1027 (« sensitive content » on MiniMax's other routes) are
//   read as a refusal (TO CONFIRM).
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { USAGE_ITEM } from '../pricing.ts'
import { call, clean, readBytes, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { splitText } from './text-chunks.ts'
import { RetryableProviderError, type ProviderAdapter } from './types.ts'

export const MINIMAX_MODELS = ['speech-2.8-hd', 'speech-2.8-turbo'] as const
export type MinimaxModel = (typeof MINIMAX_MODELS)[number]
export const MINIMAX_REGIONS = { global: 'https://api.minimax.io', china: 'https://api.minimaxi.com' } as const

/** USD per 1M characters (pricing-paygo page, 2026-10-24). */
export const MINIMAX_USD_PER_MILLION_CHARS: Record<MinimaxModel, number> = { 'speech-2.8-hd': 100, 'speech-2.8-turbo': 60 }
/** The fee of a cloned voice at its first use. */
export const MINIMAX_VOICE_FEE_USD = 1.5
/** The fee of a designed voice at its first use (reported by the `keep` job). */
export const MINIMAX_DESIGN_FEE_USD = 3
/** A design preview is billed as speech: USD per million characters (pricing page; the API reference says 30). */
export const MINIMAX_DESIGN_PREVIEW_USD_PER_MILLION_CHARS = 60
export const MINIMAX_DESIGN_PREVIEW_MAX_CHARS = 500
/** A designed voice never used is deleted after this many hours. */
export const MINIMAX_DESIGN_UNUSED_TTL_H = 168
/** One request carries at most this many characters (the API allows under 10 000; the page advises streaming above 3 000). */
export const MINIMAX_CHUNK_CHARS = 3000

export interface MinimaxOptions extends HttpOptions {
  /** The adapter's id (default `minimax`; an engine adapter takes its engine id, decision 0029). */
  id?: string
  model?: MinimaxModel
  region?: keyof typeof MINIMAX_REGIONS
  speed?: number
  languageBoost?: string
  chunkChars?: number
}

export const minimaxCostUsd = (model: MinimaxModel, chars: number, voiceFees = 0): number =>
  (chars * MINIMAX_USD_PER_MILLION_CHARS[model]) / 1_000_000 + voiceFees * MINIMAX_VOICE_FEE_USD

const Answer = z
  .object({
    data: z.object({ audio: z.string().optional(), subtitle_file: z.string().optional() }).passthrough().nullish(),
    extra_info: z
      .object({ audio_length: z.number().optional(), usage_characters: z.number().optional(), usage_voice_count: z.number().optional() })
      .passthrough()
      .nullish(),
    base_resp: z.object({ status_code: z.number(), status_msg: z.string().optional() }).passthrough()
  })
  .passthrough()

/** base_resp.status_code values the page documents, with our own words (the provider's text is not repeated). */
const CODE_TEXT: Record<number, string> = {
  1000: 'unknown error',
  1001: 'timeout',
  1002: 'rate limit exceeded',
  1004: 'authentication failed, the key is refused',
  1039: 'tokens-per-minute rate limit exceeded',
  1042: 'too many invalid characters in the text',
  2013: 'invalid input parameters'
}
const RETRYABLE_CODES = new Set([1000, 1001, 1002, 1039])

export interface TimedWord {
  word: string
  start: number
  end: number
}

/** Word timings from a `subtitle_file` (milliseconds): entries with `timestamped_words`, or single-token entries. */
export function wordsFromSubtitle(json: unknown, offsetS: number): TimedWord[] {
  const out: TimedWord[] = []
  if (!Array.isArray(json)) return out
  const take = (it: unknown, requireSingleToken: boolean): boolean => {
    const x = (it ?? {}) as Record<string, unknown>
    const text = typeof x.word === 'string' ? x.word : typeof x.text === 'string' ? x.text : null
    if (text === null || typeof x.time_begin !== 'number' || typeof x.time_end !== 'number') return false
    const word = text.trim()
    if (!word || (requireSingleToken && /\s/.test(word))) return false
    out.push({ word, start: +(offsetS + x.time_begin / 1000).toFixed(3), end: +(offsetS + x.time_end / 1000).toFixed(3) })
    return true
  }
  for (const entry of json) {
    const inner = (entry as { timestamped_words?: unknown } | null)?.timestamped_words
    if (Array.isArray(inner) && inner.length > 0) for (const w of inner) take(w, false)
    else take(entry, true)
  }
  return out
}

/** The clip limits of the clone call (docs read 2026-10-24): formats and size; the duration is checked by the app before upload. */
export const MINIMAX_CLONE_EXTENSIONS = ['mp3', 'm4a', 'wav'] as const
export const MINIMAX_CLONE_MAX_BYTES = 20 * 1024 * 1024
const MIME: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav' }
const cloneLabel = 'MiniMax voice clone'

const UploadAnswer = z
  .object({
    file: z.object({ file_id: z.union([z.string().min(1), z.number()]) }).passthrough().nullish(),
    base_resp: z.object({ status_code: z.number(), status_msg: z.string().optional() }).passthrough().optional()
  })
  .passthrough()
const CloneAnswer = z.object({ base_resp: z.object({ status_code: z.number(), status_msg: z.string().optional() }).passthrough() }).passthrough()
const DesignAnswer = z
  .object({
    voice_id: z.string().nullish(),
    trial_audio: z.string().nullish(),
    base_resp: z.object({ status_code: z.number(), status_msg: z.string().optional() }).passthrough()
  })
  .passthrough()
const designLabel = 'MiniMax voice design'
/** The codes read as a content refusal (MiniMax's « sensitive content » codes of its other routes). */
const REFUSED_CODES = new Set([1026, 1027])

/** The sentence a preview says when the job brings none (a French or an English one). */
export const designPreviewText = (language: string, text: string | undefined): string => {
  const said =
    text ??
    (language.startsWith('fr')
      ? 'Bonjour et bienvenue. Aujourd’hui, je vais vous raconter une histoire vraie, étonnante et pleine de rebondissements. Installez-vous confortablement.'
      : 'Hello and welcome. Today I am going to tell you a true story, surprising and full of twists. Make yourself comfortable.')
  if (said.length <= MINIMAX_DESIGN_PREVIEW_MAX_CHARS) return said
  const cut = said.slice(0, MINIMAX_DESIGN_PREVIEW_MAX_CHARS)
  const space = cut.lastIndexOf(' ')
  return space > MINIMAX_DESIGN_PREVIEW_MAX_CHARS / 2 ? cut.slice(0, space) : cut
}

/** The voice id asked of MiniMax for a Cloud job: stable across the job's retries. */
export const cloneVoiceId = (jobId: string): string => `clone-${createHash('sha256').update(jobId).digest('hex').slice(0, 16)}`

function failIfCode(label: string, status: { status_code: number; status_msg?: string } | undefined, secret: string): void {
  if (!status || status.status_code === 0) return
  const text = CODE_TEXT[status.status_code] ?? `error (${clean(status.status_msg ?? '', secret, 80)})`
  const message = `${label}: code ${status.status_code}, ${text}`
  throw RETRYABLE_CODES.has(status.status_code) ? new RetryableProviderError(message) : new Error(message)
}

export function minimaxAdapter(o: MinimaxOptions = {}): ProviderAdapter {
  const model = o.model ?? 'speech-2.8-hd'
  const base = MINIMAX_REGIONS[o.region ?? 'global']
  const chunkChars = o.chunkChars ?? MINIMAX_CHUNK_CHARS
  const label = 'MiniMax synthesis'
  return {
    id: o.id ?? 'minimax',
    kind: 'real',
    secretName: 'MINIMAX_API_KEY',
    async synthesize(input, ctx) {
      const secret = ctx.secret()
      const pieces = splitText(input.text, chunkChars)
      if (pieces.length === 0) throw new Error(`${label}: the text is empty`)
      const audio: Buffer[] = []
      const words: TimedWord[] = []
      let chars = 0
      let seconds = 0
      let timingsMissing = false
      for (const [i, piece] of pieces.entries()) {
        throwIfAborted(ctx.signal)
        const res = await call(
          {
            label,
            url: `${base}/v1/t2a_v2`,
            secret,
            signal: ctx.signal,
            init: {
              method: 'POST',
              headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({
                model,
                text: piece,
                stream: false,
                voice_setting: { voice_id: input.voiceId, speed: o.speed ?? 1, vol: 1, pitch: 0 },
                audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
                language_boost: o.languageBoost ?? 'auto',
                output_format: 'hex',
                ...(input.wordTimings ? { subtitle_enable: true, subtitle_type: 'word' } : {})
              })
            }
          },
          o
        )
        const parsed = Answer.safeParse(await readJson(res, label, ctx.signal))
        if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
        const { base_resp: status, data, extra_info: info } = parsed.data
        if (status.status_code !== 0) {
          const text = CODE_TEXT[status.status_code] ?? `error (${clean(status.status_msg ?? '', secret, 80)})`
          const message = `${label}: code ${status.status_code}, ${text}`
          throw RETRYABLE_CODES.has(status.status_code) ? new RetryableProviderError(message) : new Error(message)
        }
        const hex = data?.audio
        if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) throw new RetryableProviderError(`${label}: the answer carries no audio`)
        audio.push(Buffer.from(hex, 'hex'))
        const pieceSeconds = (info?.audio_length ?? 0) / 1000
        if (input.wordTimings) {
          const got = data?.subtitle_file ? await fetchWords(data.subtitle_file, seconds, secret, ctx.signal, o) : []
          if (got.length === 0) timingsMissing = true
          words.push(...got)
        }
        chars += info?.usage_characters ?? piece.length
        seconds += pieceSeconds
        ctx.progress((i + 1) / pieces.length)
      }
      return {
        files: [{ name: 'voice.mp3', mime: 'audio/mpeg', bytes: Buffer.concat(audio) }],
        data: {
          voiceId: input.voiceId,
          model,
          durationS: +seconds.toFixed(3),
          words,
          ...(timingsMissing ? { wordTimings: 'unavailable' } : {}),
          calls: pieces.length
        },
        costUsd: minimaxCostUsd(model, chars),
        measure: [{ item: USAGE_ITEM.synthesize, quantity: chars }]
      }
    },
    async cloneVoice(input, ctx) {
      const secret = ctx.secret()
      const clip = ctx.artefact(input.audioArtefactId)
      const ext = clip.name.slice(clip.name.lastIndexOf('.') + 1).toLowerCase()
      if (!(MINIMAX_CLONE_EXTENSIONS as readonly string[]).includes(ext)) throw new Error(`${cloneLabel}: the clip must be an mp3, m4a or wav file`)
      // the clip comes from the Cloud's own signed link (the key is not sent to it)
      const download = await call({ label: 'MiniMax clip download', url: clip.url, secret, signal: ctx.signal, init: { method: 'GET' } }, o)
      const bytes = await readBytes(download, 'MiniMax clip download', ctx.signal)
      if (bytes.byteLength === 0) throw new Error(`${cloneLabel}: the clip is empty`)
      if (bytes.byteLength > MINIMAX_CLONE_MAX_BYTES) throw new Error(`${cloneLabel}: the clip is over 20 MB`)
      throwIfAborted(ctx.signal)
      ctx.progress(0.2)
      const form = new FormData()
      form.set('purpose', 'voice_clone')
      form.set('file', new Blob([bytes as Uint8Array<ArrayBuffer>], { type: MIME[ext] }), clip.name)
      const up = await call(
        { label: 'MiniMax clip upload', url: `${base}/v1/files/upload`, secret, signal: ctx.signal, init: { method: 'POST', headers: { authorization: `Bearer ${secret}`, accept: 'application/json' }, body: form } },
        o
      )
      const uploaded = UploadAnswer.safeParse(await readJson(up, 'MiniMax clip upload', ctx.signal))
      if (!uploaded.success) throw new RetryableProviderError('MiniMax clip upload: unexpected answer shape')
      failIfCode('MiniMax clip upload', uploaded.data.base_resp, secret)
      const fileId = uploaded.data.file?.file_id
      if (fileId === undefined) throw new RetryableProviderError('MiniMax clip upload: the answer carries no file id')
      ctx.progress(0.6)
      throwIfAborted(ctx.signal)
      const voiceId = cloneVoiceId(ctx.jobId)
      const res = await call(
        {
          label: cloneLabel,
          url: `${base}/v1/voice_clone`,
          secret,
          signal: ctx.signal,
          init: {
            method: 'POST',
            headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ file_id: fileId, voice_id: voiceId, model })
          }
        },
        o
      )
      const parsed = CloneAnswer.safeParse(await readJson(res, cloneLabel, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${cloneLabel}: unexpected answer shape`)
      failIfCode(cloneLabel, parsed.data.base_resp, secret)
      ctx.progress(1)
      return {
        files: [],
        data: { voiceId, name: input.name, language: input.language, model },
        costUsd: MINIMAX_VOICE_FEE_USD,
        measure: [{ item: USAGE_ITEM.cloneVoice, quantity: 1 }]
      }
    },
    async designVoice(input, ctx) {
      const secret = ctx.secret()
      if (input.keep) {
        // the designed voice already works under its id: nothing to call; its one-off fee is billed at its first synthesis
        return {
          files: [],
          data: { voiceId: input.keep.generatedVoiceId, name: input.keep.name, feeUsdOnFirstUse: MINIMAX_DESIGN_FEE_USD, deletedIfUnusedForH: MINIMAX_DESIGN_UNUSED_TTL_H },
          costUsd: MINIMAX_DESIGN_FEE_USD,
          measure: [{ item: USAGE_ITEM.designVoice, quantity: 0 }]
        }
      }
      const previewText = designPreviewText(input.language, input.text)
      const res = await call(
        {
          label: designLabel,
          url: `${base}/v1/voice_design`,
          secret,
          signal: ctx.signal,
          init: {
            method: 'POST',
            headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ prompt: input.description, preview_text: previewText })
          }
        },
        { timeoutMs: 120_000, ...o }
      )
      const parsed = DesignAnswer.safeParse(await readJson(res, designLabel, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${designLabel}: unexpected answer shape`)
      const status = parsed.data.base_resp
      if (REFUSED_CODES.has(status.status_code)) throw new Error(`refused: ${designLabel}: code ${status.status_code}, the description was refused (${clean(status.status_msg ?? '', secret, 80)})`)
      failIfCode(designLabel, status, secret)
      const voiceId = parsed.data.voice_id
      const hex = parsed.data.trial_audio
      if (!voiceId) throw new RetryableProviderError(`${designLabel}: the answer carries no voice id`)
      if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) throw new RetryableProviderError(`${designLabel}: the answer carries no preview audio`)
      ctx.progress(1)
      return {
        files: [{ name: 'preview-1.mp3', mime: 'audio/mpeg', bytes: Buffer.from(hex, 'hex') }],
        data: { previews: [{ generatedVoiceId: voiceId, file: 'preview-1.mp3', durationS: null }], text: previewText, deletedIfUnusedForH: MINIMAX_DESIGN_UNUSED_TTL_H },
        costUsd: (previewText.length * MINIMAX_DESIGN_PREVIEW_USD_PER_MILLION_CHARS) / 1_000_000,
        measure: [{ item: USAGE_ITEM.designVoice, quantity: 1 }]
      }
    }
  }
}

async function fetchWords(url: string, offsetS: number, secret: string, signal: AbortSignal, o: HttpOptions): Promise<TimedWord[]> {
  try {
    if (!/^https:\/\//i.test(url)) return []
    // A plain GET of a link the provider gave: the key is not sent to it.
    const res = await call({ label: 'MiniMax subtitles', url, secret, signal, init: { method: 'GET' } }, o)
    return wordsFromSubtitle(await readJson(res, 'MiniMax subtitles', signal), offsetS)
  } catch (err) {
    if (signal.aborted) throw signal.reason ?? err
    return []
  }
}
