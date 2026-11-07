// A tiny WAV writer (PCM 16-bit, or IEEE float 32-bit for data that must not be clipped or rounded), for audio the engine
// synthesises itself (the tone voice of last resort, test media, room impulse responses).
import { writeFile } from 'node:fs/promises'

/**
 * Writes mono or interleaved samples as a WAV. 16-bit PCM (default) clips to [-1, 1]; `bits: 32` writes IEEE float, kept as is
 * (an impulse response whose gain matters).
 */
export async function writeWav(file: string, samples: Float32Array, sampleRate: number, channels: 1 | 2 = 1, bits: 16 | 32 = 16): Promise<void> {
  const bytes = bits / 8
  const data = Buffer.alloc(samples.length * bytes)
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] as number
    if (bits === 32) data.writeFloatLE(s, i * 4)
    else data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(bits === 32 ? 3 : 1, 20)
  h.writeUInt16LE(channels, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * channels * bytes, 28)
  h.writeUInt16LE(channels * bytes, 32)
  h.writeUInt16LE(bits, 34)
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(data.length, 40)
  await writeFile(file, Buffer.concat([h, data]))
}
