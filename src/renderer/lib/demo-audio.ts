// A short generated tone as a WAV blob, so the gallery can show the audio components with no file and no network.

/** 16-bit mono PCM WAV bytes of a soft two-tone chirp. */
export function makeToneWav(seconds = 3, sampleRate = 8000): Uint8Array {
  const samples = Math.floor(seconds * sampleRate)
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate
    const envelope = Math.min(1, t * 8, (seconds - t) * 8) * 0.25
    const freq = 330 + 110 * Math.sin(t * 2)
    view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * freq * t) * envelope * 32767), true)
  }
  return bytes
}

let cached: string | null = null
/** One shared blob URL for the whole session (the gallery is the only user). */
export function makeToneUrl(seconds = 3): string {
  cached ??= URL.createObjectURL(new Blob([makeToneWav(seconds) as BlobPart], { type: 'audio/wav' }))
  return cached
}

/** Deterministic bar heights (0..1) for a Waveform. */
export function demoWaveform(bars = 48, seed = 7): number[] {
  return Array.from({ length: bars }, (_, i) => 0.18 + 0.72 * Math.abs(Math.sin((i + seed) * 0.55) * Math.cos(i * 0.21)))
}
