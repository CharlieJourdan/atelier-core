// Audio steps shared by the voice and render stages: loudness normalisation by ONE linear gain (never a pumping
// dynamic normaliser, R28.5), with a transparent limiter only when the gain would push the true peak over the ceiling.
import type { MediaService } from '../services'
import { measureLoudness, type Loudness } from './probe'

export interface NormaliseOptions {
  targetLufs: number
  /** True-peak ceiling, dBTP (−1 for the master, R28.5). */
  ceilingDbtp: number
  /** Output codec args (e.g. FLAC for the voice, AAC for a master). */
  codec: string[]
  sampleRate: number
  channels: 1 | 2
  /** Extra filters before the gain (e.g. a mix). */
  filterPrefix?: string
}

/** The gain (dB) that brings `l` to the target, and whether a limiter must hold the peak. */
export function gainFor(l: Loudness, targetLufs: number, ceilingDbtp: number): { gainDb: number; limit: boolean } {
  const gainDb = Math.max(-40, Math.min(40, targetLufs - l.integrated))
  return { gainDb, limit: l.truePeak + gainDb > ceilingDbtp }
}

/** Filter chain for one linear gain, plus a limiter at the ceiling when needed. */
export function gainFilter(gainDb: number, limit: boolean, ceilingDbtp: number): string {
  const vol = `volume=${gainDb.toFixed(2)}dB`
  if (!limit) return vol
  const ceilingLinear = Math.pow(10, (ceilingDbtp - 0.3) / 20) // a little headroom: the limiter works on samples
  return `${vol},alimiter=limit=${ceilingLinear.toFixed(4)}:attack=5:release=50:level=disabled`
}

/** Measures `input`, then writes it at the target loudness. Returns the measured loudness. */
export async function normaliseAudio(media: MediaService, input: string, out: string, o: NormaliseOptions, signal: AbortSignal): Promise<Loudness> {
  const measured = await measureLoudness(media, input, signal)
  const { gainDb, limit } = gainFor(measured, o.targetLufs, o.ceilingDbtp)
  const chain = [o.filterPrefix, gainFilter(gainDb, limit, o.ceilingDbtp)].filter(Boolean).join(',')
  await media.run(
    'ffmpeg',
    ['-v', 'error', '-y', '-i', input, '-af', chain, '-ar', String(o.sampleRate), '-ac', String(o.channels), ...o.codec, out],
    { signal }
  )
  return measured
}
