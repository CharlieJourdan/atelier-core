// ElevenLabs voice (usage `synthesize`), written from the official documentation read on 2026-10-24:
//   API    https://elevenlabs.io/docs/api-reference/text-to-speech/convert
//          POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128 → the audio bytes
//          header `xi-api-key: <key>`; body { text, model_id, language_code?, voice_settings { speed } }
//          https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
//          POST …/{voice_id}/with-timestamps → { audio_base64, alignment { characters, character_start_times_seconds,
//          character_end_times_seconds } }: used when the job wants word timings (words are rebuilt from the characters).
//   Errors https://elevenlabs.io/docs/eleven-api/resources/errors.md : 401 authentication_error, 402 insufficient_credits,
//          422 validation error, 429 rate_limit_exceeded / concurrent_limit_exceeded / system_busy, 500/503 server side.
//   Models https://elevenlabs.io/docs/overview/models : eleven_v3 (5 000 chars per request), eleven_multilingual_v2 (10 000,
//          default), eleven_flash_v2_5 (40 000, half the price per character; eleven_turbo_v2_5 is deprecated, same price).
//   Price  https://elevenlabs.io/pricing/api (via research note BUSINESS-INFRA (old repository) §3.1): USD 0.08 per 1 000 characters for
//          v3 / multilingual, USD 0.04 for Flash / Turbo. The provider bills the characters of the text, so the job is
//          measured in `text.length`.
// A long script is voiced in several calls (text-chunks.ts) and the MP3 pieces are joined; with timings, each piece's words
// are shifted by the end of the previous piece (the last alignment time), which is exact to a few tens of milliseconds.
// Without timings the duration is estimated from the MP3 size (128 kbit/s). The key is the vault entry ELEVENLABS_API_KEY.
import { z } from 'zod'
import { USAGE_ITEM } from '../pricing.ts'
import { call, readBytes, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { splitText } from './text-chunks.ts'
import { RetryableProviderError, type ProviderAdapter } from './types.ts'

export const ELEVENLABS_BASE = 'https://api.elevenlabs.io'
export const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128'
export const ELEVENLABS_CHUNK_CHARS = 4500
const MP3_BYTES_PER_SECOND = 128_000 / 8

export interface ElevenLabsOptions extends HttpOptions {
  /** The adapter's id (default `elevenlabs`; an engine adapter takes its engine id, decision 0029). */
  id?: string
  model?: string
  speed?: number
  /** ISO 639-1; not accepted by the multilingual v2 models, so unset by default. */
  languageCode?: string
  chunkChars?: number
  baseUrl?: string
}

/** USD per character: Flash / Turbo models are half the price of the others. */
export const elevenlabsUsdPerChar = (model: string): number => (/flash|turbo/i.test(model) ? 0.04 : 0.08) / 1000
export const elevenlabsCostUsd = (model: string, chars: number): number => chars * elevenlabsUsdPerChar(model)

const Timestamped = z
  .object({
    audio_base64: z.string().min(1),
    alignment: z
      .object({
        characters: z.array(z.string()),
        character_start_times_seconds: z.array(z.number()),
        character_end_times_seconds: z.array(z.number())
      })
      .nullish()
  })
  .passthrough()

export interface TimedWord {
  word: string
  start: number
  end: number
}

/** Words from per-character timings: a word is a run of non-blank characters. */
export function wordsFromAlignment(a: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }, offsetS: number): TimedWord[] {
  const words: TimedWord[] = []
  let text = ''
  let start = 0
  let end = 0
  const close = (): void => {
    if (text) words.push({ word: text, start: +(offsetS + start).toFixed(3), end: +(offsetS + end).toFixed(3) })
    text = ''
  }
  a.characters.forEach((ch, i) => {
    const s = a.character_start_times_seconds[i]
    const e = a.character_end_times_seconds[i]
    if (/^\s*$/.test(ch) || s === undefined || e === undefined) return close()
    if (!text) start = s
    text += ch
    end = e
  })
  close()
  return words
}

const errorDetail = (body: string): string | undefined => {
  try {
    const d = (JSON.parse(body) as { detail?: { status?: unknown } }).detail
    return typeof d?.status === 'string' ? d.status : undefined
  } catch {
    return undefined
  }
}

export function elevenlabsAdapter(o: ElevenLabsOptions = {}): ProviderAdapter {
  const model = o.model ?? 'eleven_multilingual_v2'
  const base = (o.baseUrl ?? ELEVENLABS_BASE).replace(/\/+$/, '')
  const chunkChars = o.chunkChars ?? ELEVENLABS_CHUNK_CHARS
  const label = 'ElevenLabs synthesis'
  return {
    id: o.id ?? 'elevenlabs',
    kind: 'real',
    secretName: 'ELEVENLABS_API_KEY',
    async synthesize(input, ctx) {
      const secret = ctx.secret()
      const pieces = splitText(input.text, chunkChars)
      if (pieces.length === 0) throw new Error(`${label}: the text is empty`)
      const audio: Buffer[] = []
      const words: TimedWord[] = []
      let seconds = 0
      let chars = 0
      for (const [i, piece] of pieces.entries()) {
        throwIfAborted(ctx.signal)
        const timed = input.wordTimings
        const res = await call(
          {
            label,
            url: `${base}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}${timed ? '/with-timestamps' : ''}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`,
            secret,
            signal: ctx.signal,
            detail: errorDetail,
            init: {
              method: 'POST',
              headers: { 'xi-api-key': secret, 'content-type': 'application/json', accept: timed ? 'application/json' : 'audio/mpeg' },
              body: JSON.stringify({
                text: piece,
                model_id: model,
                ...(o.languageCode ? { language_code: o.languageCode } : {}),
                ...(o.speed !== undefined && o.speed !== 1 ? { voice_settings: { speed: o.speed } } : {})
              })
            }
          },
          o
        )
        if (timed) {
          const parsed = Timestamped.safeParse(await readJson(res, label, ctx.signal))
          if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
          audio.push(Buffer.from(parsed.data.audio_base64, 'base64'))
          const al = parsed.data.alignment
          if (al) {
            words.push(...wordsFromAlignment(al, seconds))
            seconds += al.character_end_times_seconds.reduce((m, t) => Math.max(m, t), 0)
          } else seconds += (audio.at(-1) as Buffer).length / MP3_BYTES_PER_SECOND
        } else {
          const bytes = await readBytes(res, label, ctx.signal)
          if (bytes.length === 0) throw new RetryableProviderError(`${label}: the answer carries no audio`)
          audio.push(Buffer.from(bytes))
          seconds += bytes.length / MP3_BYTES_PER_SECOND
        }
        chars += piece.length
        ctx.progress((i + 1) / pieces.length)
      }
      return {
        files: [{ name: 'voice.mp3', mime: 'audio/mpeg', bytes: Buffer.concat(audio) }],
        data: { voiceId: input.voiceId, model, durationS: +seconds.toFixed(3), words, calls: pieces.length },
        costUsd: elevenlabsCostUsd(model, chars),
        measure: [{ item: USAGE_ITEM.synthesize, quantity: chars }]
      }
    }
  }
}
