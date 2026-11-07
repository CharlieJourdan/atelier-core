// The samples a channel voice is cloned from (production-5). `isolateSpeech`: on channel import, the best 30–60 s of
// speech of one of the channel's own videos (the window with the most speech, from the energy envelope), as a mono WAV.
// Music under the voice is not removed here: a provider's isolation (ElevenLabs Audio Isolation, docs/PROVIDERS.md §8) may
// be added before the clone once its price is confirmed. `excerpt`: a sample cut to the longest an engine takes.
import path from 'node:path'
import { energyEnvelope, probe, speechRegions, type SpeechRegion } from '../../../engine/media/probe'
import type { MediaService } from '../../../engine/services'

export const ISOLATE_MIN_S = 30
export const ISOLATE_MAX_S = 60

/** The window of at most `maxS` seconds holding the most speech (it starts at a speech region). Pure. */
export function bestWindow(regions: readonly SpeechRegion[], maxS: number): { start: number; end: number; speechS: number } | null {
  let best: { start: number; end: number; speechS: number } | null = null
  for (const [i, r] of regions.entries()) {
    const end = r.start + maxS
    let speech = 0
    let last = r.start
    for (const x of regions.slice(i)) {
      if (x.start >= end) break
      speech += Math.min(x.end, end) - x.start
      last = Math.min(x.end, end)
    }
    if (!best || speech > best.speechS + 1e-9) best = { start: Math.max(0, r.start - 0.2), end: last + 0.2, speechS: speech }
  }
  return best
}

/** Cuts the speechiest 30–60 s of `video` into `dir/sample.wav`; refuses a file with under 30 s of speech. */
export async function isolateSpeech(media: MediaService, video: string, dir: string, signal: AbortSignal): Promise<{ file: string; speechS: number }> {
  const regions = speechRegions(await energyEnvelope(media, video, signal))
  const w = bestWindow(regions, ISOLATE_MAX_S)
  if (!w || w.speechS < ISOLATE_MIN_S) throw new Error(`Cette vidéo n’a pas assez de parole pour cloner la voix (${Math.round(w?.speechS ?? 0)} s, il en faut ${ISOLATE_MIN_S}).`)
  const file = path.join(dir, 'sample.wav')
  await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', w.start.toFixed(2), '-to', w.end.toFixed(2), '-i', video, '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', file], { signal })
  return { file, speechS: +w.speechS.toFixed(2) }
}

/** `sample` cut to at most `maxS` seconds (a WAV next to `out`); the sample itself when it is short enough. */
export async function excerpt(media: MediaService, sample: string, out: string, maxS: number, signal: AbortSignal): Promise<string> {
  const d = (await probe(media, sample, signal)).durationS
  if (d <= maxS) return sample
  await media.run('ffmpeg', ['-v', 'error', '-y', '-i', sample, '-t', String(maxS - 0.5), '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', out], { signal })
  return out
}
