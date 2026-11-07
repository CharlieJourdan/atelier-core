// Fish Audio voice (engine `voice:fish-s2`, production-5), written from the official docs read on 2026-11-01, NEVER called
// (docs/PROVIDERS.md §6 lists what to confirm on the first real call):
//   TTS    https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
//          POST https://api.fish.audio/v1/tts, `Authorization: Bearer <key>`, header `model: s2-pro`, JSON { text,
//          reference_id, format: "mp3", mp3_bitrate, latency, prosody { speed }, language } → the audio bytes (chunked).
//          Errors: JSON { status, message }; 401, 402 (no balance), 429 (concurrency), 503 (overloaded).
//          Word timings exist only on the streamed route /v1/tts/stream/with-timestamp (server-sent events, segment level):
//          not used here; the engine aligns the script itself (`wordTimings: "unavailable"`, ENGINE-SPEC §19.3).
//   Clone  https://docs.fish.audio/api-reference/endpoint/model/create-model
//          POST https://api.fish.audio/model multipart { type: "tts", title, train_mode: "fast", visibility: "private",
//          voices } → 201 { _id, state, … }; the `_id` is the `reference_id` of later calls. No clone price is listed.
//   Price  https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits : USD 15 per million UTF-8 bytes
//          of text for s2-pro and s2.1-pro (an accented French letter is 2 bytes).
// The key is the vault entry FISH_API_KEY, sent only to api.fish.audio. Max text per request is not written: 2 000 chars.
import { z } from 'zod'
import { USAGE_ITEM } from '../pricing.ts'
import { call, readBytes, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { splitText } from './text-chunks.ts'
import { RetryableProviderError, type ProviderAdapter } from './types.ts'
import { fetchClip } from './voice-clip.ts'

export const FISH_BASE = 'https://api.fish.audio'
export const FISH_MODEL = 's2-pro'
export const FISH_CHUNK_CHARS = 2000
export const FISH_USD_PER_MBYTE = 15
const MP3_BYTES_PER_SECOND = 128_000 / 8

export const fishCostUsd = (text: string): number => (Buffer.byteLength(text, 'utf8') / 1_000_000) * FISH_USD_PER_MBYTE

const errorDetail = (body: string): string | undefined => {
  try {
    const d = JSON.parse(body) as { message?: unknown }
    return typeof d.message === 'string' ? d.message : undefined
  } catch {
    return undefined
  }
}
const Model = z.object({ _id: z.string().min(1) }).passthrough()

export interface FishOptions extends HttpOptions {
  id?: string
  model?: string
  baseUrl?: string
}

export function fishAdapter(o: FishOptions = {}): ProviderAdapter {
  const base = (o.baseUrl ?? FISH_BASE).replace(/\/+$/, '')
  const model = o.model ?? FISH_MODEL
  return {
    id: o.id ?? 'fish',
    kind: 'real',
    secretName: 'FISH_API_KEY',
    async synthesize(input, ctx) {
      const secret = ctx.secret()
      const label = 'Fish Audio synthesis'
      const pieces = splitText(input.text, FISH_CHUNK_CHARS)
      if (pieces.length === 0) throw new Error(`${label}: the text is empty`)
      const audio: Buffer[] = []
      for (const [i, piece] of pieces.entries()) {
        throwIfAborted(ctx.signal)
        const res = await call(
          {
            label,
            url: `${base}/v1/tts`,
            secret,
            signal: ctx.signal,
            detail: errorDetail,
            init: {
              method: 'POST',
              headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', model, accept: 'audio/mpeg' },
              body: JSON.stringify({ text: piece, reference_id: input.voiceId, format: 'mp3', mp3_bitrate: 128, latency: 'normal' })
            }
          },
          { timeoutMs: 120_000, ...o }
        )
        const bytes = await readBytes(res, label, ctx.signal)
        if (bytes.length === 0) throw new RetryableProviderError(`${label}: the answer carries no audio`)
        audio.push(Buffer.from(bytes))
        ctx.progress((i + 1) / pieces.length)
      }
      const all = Buffer.concat(audio)
      const chars = pieces.reduce((n, p) => n + p.length, 0)
      return {
        files: [{ name: 'voice.mp3', mime: 'audio/mpeg', bytes: all }],
        data: { voiceId: input.voiceId, model, durationS: +(all.length / MP3_BYTES_PER_SECOND).toFixed(3), words: [], wordTimings: 'unavailable', calls: pieces.length },
        costUsd: fishCostUsd(pieces.join(' ')),
        measure: [{ item: USAGE_ITEM.synthesize, quantity: chars }]
      }
    },
    async cloneVoice(input, ctx) {
      const secret = ctx.secret()
      const label = 'Fish Audio voice clone'
      const clip = await fetchClip(ctx, input.audioArtefactId, { label, extensions: ['mp3', 'm4a', 'wav', 'flac'], maxBytes: 20 * 1024 * 1024 }, secret, o)
      ctx.progress(0.4)
      const form = new FormData()
      form.set('type', 'tts')
      form.set('title', input.name)
      form.set('train_mode', 'fast')
      form.set('visibility', 'private')
      form.set('voices', clip.blob, clip.name)
      const res = await call(
        { label, url: `${base}/model`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'POST', headers: { authorization: `Bearer ${secret}`, accept: 'application/json' }, body: form } },
        { timeoutMs: 120_000, ...o }
      )
      const parsed = Model.safeParse(await readJson(res, label, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
      ctx.progress(1)
      return { files: [], data: { voiceId: parsed.data._id, name: input.name, language: input.language, model }, costUsd: 0, measure: [{ item: USAGE_ITEM.cloneVoice, quantity: 1 }] }
    }
  }
}
