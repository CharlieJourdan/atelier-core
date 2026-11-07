// The fake of `designVoice` (production-5): three short previews, each a soft tone at its own pitch (a demo stand-in, never a
// voice), with stable generated ids; « keep » returns a voice id made from the generated one. Nothing is called, nothing paid.
import { createHash } from 'node:crypto'
import type { ProviderAdapter, ProviderContext } from './types.ts'

const RATE = 16_000

/** A mono 16-bit WAV of `seconds` of a soft tone at `hz` (fades in and out). */
export function toneWav(hz: number, seconds: number): Buffer {
  const n = Math.round(seconds * RATE)
  const data = Buffer.alloc(n * 2)
  for (let k = 0; k < n; k++) {
    const env = Math.min(1, k / (0.05 * RATE), (n - k) / (0.05 * RATE))
    data.writeInt16LE(Math.round(0.2 * env * Math.sin((2 * Math.PI * hz * k) / RATE) * 32767), k * 2)
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(RATE, 24)
  head.writeUInt32LE(RATE * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

const hex = (s: string, n: number): string => createHash('sha256').update(s).digest('hex').slice(0, n)

const step = async (ctx: ProviderContext): Promise<void> => {
  if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted')
  await new Promise<void>((r) => setImmediate(r))
}

export const fakeDesignVoice: ProviderAdapter = {
  id: 'fake-design-voice',
  kind: 'fake',
  async designVoice(input, ctx) {
    await step(ctx)
    if (input.keep) {
      ctx.progress(1)
      return { files: [], data: { voiceId: `designed-${hex(input.keep.generatedVoiceId, 12)}`, name: input.keep.name }, costUsd: 0 }
    }
    const previews = [0, 1, 2].map((i) => ({ generatedVoiceId: `gen-${hex(`${input.description}\n${i}`, 16)}`, file: `preview-${i + 1}.wav`, durationS: 3 }))
    ctx.progress(1)
    return {
      files: previews.map((p, i) => ({ name: p.file, mime: 'audio/wav', bytes: toneWav(196 + 60 * i, 3) })),
      data: { previews, text: input.text ?? '' },
      // the worst case of the grid's voice.design item (ElevenLabs bills the preview text's characters)
      costUsd: 0.08
    }
  }
}
