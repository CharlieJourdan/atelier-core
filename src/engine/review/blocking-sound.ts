// The blocking checks on the sound (controles-bloquants, decision 0102), pure functions over energy envelopes (dB per 10 ms frame,
// `energyEnvelope`) and word times, so each is tested on a made-up envelope with the defect and one without:
// - music too loud: measured on the STEMS (the voice file and the music bed the render mixes), under the words only — the bed lifts in
//   the voice's pauses by design, so the mix's pauses say nothing about it (Le Monde en POV: the bed 7 dB under the voice, 14 wanted);
// - a hole in the sound: the film's mix silent longer than the style's longest pause;
// - a word cut: a word that ends after the film's sound does;
// - word times that drift from the voice: words timed where nothing is said, or speech starting far from any word's time.
import type { Word } from '../formats/timing'
import { ENERGY_FRAME_S, speechRegions } from '../media/probe'
import { fmtS, type Defect } from './types'

export interface SoundLimits {
  /** The music bed under the voice, at least this many dB below it while words are said. */
  musicUnderVoiceDb: number
  /** Nothing heard in the film for longer than this is a hole (seconds; a style with long silences sets it higher). */
  holeMaxS: number
  /** Below this level (dBFS) the film is silent. */
  silenceDb: number
  /** Share of words timed over silence from which the times drift. */
  silentWordsShare: number
  /** Median gap between a phrase's start in the voice and the nearest word time from which the times drift (seconds). */
  onsetDriftS: number
}

export const SOUND_LIMITS: SoundLimits = {
  // Charlie's level, measured on Le Monde en POV's reference (15 dB) and kept in qualite-montage's music check (14)
  musicUnderVoiceDb: 14,
  holeMaxS: 1.5,
  silenceDb: -55,
  silentWordsShare: 0.15,
  onsetDriftS: 0.35
}

const F = ENERGY_FRAME_S
const r2 = (x: number): number => Math.round(x * 100) / 100
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? NaN : (s[Math.floor(s.length / 2)] as number)
}
const level = (env: Float32Array, t: number): number => env[Math.max(0, Math.min(env.length - 1, Math.round(t / F)))] ?? -90
const quantile = (env: Float32Array, q: number): number => Float32Array.from(env).sort()[Math.floor(env.length * q)] ?? -90

/** How far the music bed sits under the voice while words are said (median dB over the voiced frames), or null when too few words. */
export function musicGapDb(voice: Float32Array, music: Float32Array, words: readonly Word[]): number | null {
  const voiceTop = quantile(voice, 0.95)
  const gaps: number[] = []
  for (const w of words) {
    for (let t = w.start + 0.03; t < w.end - 0.03; t += F) {
      const v = level(voice, t)
      // only the frames where the voice really speaks (a word's own quiet edges would make the bed look loud)
      if (v < voiceTop - 20) continue
      gaps.push(v - Math.max(level(music, t), -90))
    }
  }
  return gaps.length < 100 ? null : median(gaps)
}

/** The music too loud under the voice, with how much quieter it must go (`needDb`), or null. */
export function musicLoudDefect(voice: Float32Array, music: Float32Array, words: readonly Word[], L: SoundLimits = SOUND_LIMITS): (Defect & { needDb: number }) | null {
  const gap = musicGapDb(voice, music, words)
  if (gap === null || gap >= L.musicUnderVoiceDb) return null
  return {
    kind: 'music_loud',
    severity: 'fail',
    atS: 0,
    endS: r2(words.at(-1)?.end ?? 0),
    detail: `La musique n’est que ${gap.toFixed(1)} dB sous la voix pendant qu’elle parle (au moins ${L.musicUnderVoiceDb} dB).`,
    needDb: r2(L.musicUnderVoiceDb - gap)
  }
}

/** Holes in the film's sound: the mix under `silenceDb` longer than `holeMaxS`, away from the film's first and last half second. */
export function soundHoles(mix: Float32Array, durationS: number, L: SoundLimits = SOUND_LIMITS): Defect[] {
  const out: Defect[] = []
  let open = -1
  for (let i = 0; i <= mix.length; i++) {
    const silent = i < mix.length && (mix[i] as number) < L.silenceDb
    if (silent && open < 0) open = i
    if (!silent && open >= 0) {
      const a = open * F
      const b = Math.min(i * F, durationS)
      open = -1
      if (b - a < L.holeMaxS || a < 0.5 || b > durationS - 0.5) continue
      out.push({ kind: 'sound_hole', severity: 'fail', atS: r2(a), endS: r2(b), detail: `Aucun son de ${fmtS(a)} à ${fmtS(b)} (${(b - a).toFixed(1)} s de trou).` })
    }
  }
  return out
}

/** The words the film cuts off: ending after its sound does (one defect for all of them). */
export function wordsCut(words: readonly Word[], filmS: number): Defect | null {
  const cut = words.filter((w) => w.end > filmS + 0.02)
  if (cut.length === 0) return null
  const first = cut[0] as Word
  return {
    kind: 'word_cut',
    severity: 'fail',
    atS: r2(Math.min(first.start, filmS)),
    endS: r2(filmS),
    said: cut.map((w) => w.w).join(' '),
    detail: `La vidéo s’arrête à ${fmtS(filmS)} pendant « ${cut.slice(0, 5).map((w) => w.w).join(' ')} » : ${cut.length} mot(s) coupé(s).`
  }
}

/** Word times that drift from the voice: many words timed over silence, or phrases starting far from any word's time. */
export function timingDrift(voice: Float32Array, words: readonly Word[], L: SoundLimits = SOUND_LIMITS): Defect | null {
  if (words.length < 20 || voice.length === 0) return null
  const floor = quantile(voice, 0.05)
  const top = quantile(voice, 0.95)
  const speaking = Math.min(floor + 15, floor + (top - floor) / 3)
  const long = words.filter((w) => w.end - w.start >= 0.15)
  const silent = long.filter((w) => {
    let max = -Infinity
    for (let t = w.start; t <= w.end; t += F) max = Math.max(max, level(voice, t))
    return max < speaking
  })
  const share = long.length ? silent.length / long.length : 0
  // phrases: a word the times put after a pause should start where the voice starts again after a pause (aligned times often join
  // words over the voice's short pauses, so it is the times' pauses that are looked for in the voice, never the other way round)
  const regions = speechRegions(voice, { bridgeS: 0.2, minS: 0.15 })
  const onsets = regions.filter((r, i) => i === 0 || r.start - (regions[i - 1] as { end: number }).end >= 0.2).map((r) => r.start)
  const offsets: number[] = []
  for (const [i, w] of words.entries()) {
    if (i === 0 || w.start - (words[i - 1] as Word).end < 0.25 || onsets.length === 0) continue
    offsets.push(Math.min(...onsets.map((t) => Math.abs(t - w.start))))
  }
  const drift = offsets.length >= 8 ? median(offsets) : 0
  if (share < L.silentWordsShare && drift <= L.onsetDriftS) return null
  const first = silent[0]
  return {
    kind: 'timing_drift',
    severity: 'fail',
    atS: r2(first?.start ?? 0),
    endS: r2(words.at(-1)?.end ?? 0),
    detail:
      share >= L.silentWordsShare
        ? `${Math.round(share * 100)} % des mots sont placés là où la voix ne dit rien : sous-titres et images sont décalés.`
        : `Les phrases commencent en moyenne ${drift.toFixed(2)} s loin du temps de leur premier mot : sous-titres et images sont décalés.`
  }
}
