// ElevenLabs voice making (production-5): voice design and instant voice cloning, written from the official API pages read
// on 2026-11-01, NEVER called (docs/PROVIDERS.md §6 lists what to confirm on the first real call):
//   Design https://elevenlabs.io/docs/api-reference/text-to-voice/design
//          POST /v1/text-to-voice/design { voice_description, model_id, text? , auto_generate_text } → { previews: [{
//          generated_voice_id, audio_base_64 (MP3), duration_secs }], text }. Three previews per request. Billed by the
//          characters of the preview text (help center « how much does voice design cost »); rate per character not
//          written: the TTS rate (USD 0.08 / 1 000) is assumed.
//   Keep   https://elevenlabs.io/docs/api-reference/text-to-voice/create
//          POST /v1/text-to-voice { voice_name, voice_description, generated_voice_id } → { voice_id }. No price written.
//   Clone  https://elevenlabs.io/docs/api-reference/voices/ivc/create
//          POST /v1/voices/add multipart { name, files, remove_background_noise, description } → { voice_id,
//          requires_verification }. A plan feature (Starter and above per the help center): no per-clone price written.
// The key is the vault entry ELEVENLABS_API_KEY, sent only to api.elevenlabs.io.
import { z } from 'zod'
import { USAGE_ITEM } from '../pricing.ts'
import { ELEVENLABS_BASE, elevenlabsCostUsd } from './elevenlabs.ts'
import { call, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { RetryableProviderError, type ProviderAdapter } from './types.ts'
import { fetchClip } from './voice-clip.ts'

export const ELEVENLABS_DESIGN_MODEL = 'eleven_multilingual_ttv_v2'
/** IVC samples: the docs recommend 1–2 minutes of clean speech, MP3; no file size limit is written (we keep 20 MB). */
export const ELEVENLABS_CLONE_EXTENSIONS = ['mp3', 'm4a', 'wav', 'flac'] as const

const Design = z
  .object({
    previews: z.array(z.object({ generated_voice_id: z.string().min(1), audio_base_64: z.string().min(1), duration_secs: z.number().optional() }).passthrough()).min(1),
    text: z.string().optional()
  })
  .passthrough()
const VoiceAnswer = z.object({ voice_id: z.string().min(1) }).passthrough()

const json = (secret: string, body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'xi-api-key': secret, 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(body)
})

/** Voice design and cloning on ElevenLabs, as the methods of an engine adapter (`voice:elevenlabs-v2`). */
export function elevenlabsVoiceMaking(o: HttpOptions & { baseUrl?: string } = {}): Pick<ProviderAdapter, 'designVoice' | 'cloneVoice'> {
  const base = (o.baseUrl ?? ELEVENLABS_BASE).replace(/\/+$/, '')
  return {
    async designVoice(input, ctx) {
      const secret = ctx.secret()
      if (input.keep) {
        const label = 'ElevenLabs voice keep'
        const res = await call(
          {
            label,
            url: `${base}/v1/text-to-voice`,
            secret,
            signal: ctx.signal,
            init: json(secret, { voice_name: input.keep.name, voice_description: input.description, generated_voice_id: input.keep.generatedVoiceId })
          },
          o
        )
        const parsed = VoiceAnswer.safeParse(await readJson(res, label, ctx.signal))
        if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
        return { files: [], data: { voiceId: parsed.data.voice_id, name: input.keep.name }, costUsd: 0, measure: [{ item: USAGE_ITEM.designVoice, quantity: 0 }] }
      }
      const label = 'ElevenLabs voice design'
      const body = { voice_description: input.description, model_id: ELEVENLABS_DESIGN_MODEL, ...(input.text ? { text: input.text } : { auto_generate_text: true }) }
      const res = await call({ label, url: `${base}/v1/text-to-voice/design`, secret, signal: ctx.signal, init: json(secret, body) }, { timeoutMs: 120_000, ...o })
      const parsed = Design.safeParse(await readJson(res, label, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
      throwIfAborted(ctx.signal)
      const previews = parsed.data.previews.map((p, i) => ({ generatedVoiceId: p.generated_voice_id, file: `preview-${i + 1}.mp3`, durationS: p.duration_secs ?? null }))
      const spoken = input.text ?? parsed.data.text ?? ''
      return {
        files: parsed.data.previews.map((p, i) => ({ name: `preview-${i + 1}.mp3`, mime: 'audio/mpeg', bytes: Buffer.from(p.audio_base_64, 'base64') })),
        data: { previews, text: spoken },
        costUsd: elevenlabsCostUsd('eleven_multilingual_v2', spoken.length || 1000),
        measure: [{ item: USAGE_ITEM.designVoice, quantity: 1 }]
      }
    },
    async cloneVoice(input, ctx) {
      const secret = ctx.secret()
      const label = 'ElevenLabs voice clone'
      const clip = await fetchClip(ctx, input.audioArtefactId, { label, extensions: ELEVENLABS_CLONE_EXTENSIONS, maxBytes: 20 * 1024 * 1024 }, secret, o)
      ctx.progress(0.4)
      const form = new FormData()
      form.set('name', input.name)
      form.set('files', clip.blob, clip.name)
      // the sample is already clean speech (the app isolates it): background removal can hurt a clean file (docs)
      form.set('remove_background_noise', 'false')
      form.set('description', `Atelier channel voice (${input.language})`)
      const res = await call(
        { label, url: `${base}/v1/voices/add`, secret, signal: ctx.signal, init: { method: 'POST', headers: { 'xi-api-key': secret, accept: 'application/json' }, body: form } },
        { timeoutMs: 120_000, ...o }
      )
      const parsed = VoiceAnswer.safeParse(await readJson(res, label, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
      ctx.progress(1)
      return {
        files: [],
        data: { voiceId: parsed.data.voice_id, name: input.name, language: input.language },
        costUsd: 0,
        measure: [{ item: USAGE_ITEM.cloneVoice, quantity: 1 }]
      }
    }
  }
}
