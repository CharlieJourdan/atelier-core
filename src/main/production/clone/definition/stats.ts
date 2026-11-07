// Small pure measures over whole-video analyses (chantier B, decision 0095): pooled screen time, medians, the values most
// of the corpus agrees on, and evidence pointing at real shots. Used by the feasibility map (P3) and the definition (P4).
import { isDeepStrictEqual } from 'node:util'
import { CONSTANT_MIN_FREQUENCY, type AnalysedShot, type Evidence, type VideoAnalysis, type VideoPart } from '../../../../shared/clone'

export const round2 = (n: number): number => Math.round(n * 100) / 100
export const round3 = (n: number): number => Math.round(n * 1000) / 1000

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  if (s.length === 0) return 0
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** The q-quantile (0..1) of a list, nearest rank. */
export function quantile(xs: readonly number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b)
  if (s.length === 0) return 0
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!
}

/** The value most videos agree on, when at least CONSTANT_MIN_FREQUENCY of them do (a constant of the style), else null. */
export function agreed<T>(values: readonly T[]): { value: T; frequency: number } | null {
  if (values.length === 0) return null
  let best: { value: T; n: number } | null = null
  for (const v of values) {
    const n = values.filter((x) => isDeepStrictEqual(x, v)).length
    if (!best || n > best.n) best = { value: v, n }
  }
  const frequency = best!.n / values.length
  return frequency >= CONSTANT_MIN_FREQUENCY ? { value: best!.value, frequency } : null
}

/** Items present in at least CONSTANT_MIN_FREQUENCY of the videos (each video's list counted once). */
export function frequentItems(lists: readonly (readonly string[])[]): string[] {
  if (lists.length === 0) return []
  const all = [...new Set(lists.flat())]
  return all.filter((x) => lists.filter((l) => l.includes(x)).length / lists.length >= CONSTANT_MIN_FREQUENCY).sort()
}

/** Evidence for a set of shots: the first few, with their times and frames. */
export function shotEvidence(videoId: string, shots: readonly AnalysedShot[], max = 2): Evidence[] {
  return shots.slice(0, max).map((s) => ({ video: videoId, fromS: s.startS, toS: s.startS + s.lengthS, frames: s.frames }))
}

/** Evidence from every video (a few shots each) matching a predicate. */
export function corpusEvidence(analyses: readonly VideoAnalysis[], pick: (s: AnalysedShot) => boolean = () => true, perVideo = 1): Evidence[] {
  return analyses.flatMap((a) => shotEvidence(a.videoId, a.shots.filter(pick), perVideo)).slice(0, 6)
}

/** Total read seconds of the corpus (sum of shot lengths: the measured screen time). */
export function screenSeconds(analyses: readonly VideoAnalysis[]): number {
  return analyses.reduce((t, a) => t + a.shots.reduce((s, x) => s + x.lengthS, 0), 0)
}

/** The part a time falls in (the analysis's own part bounds). */
export function partAt(a: VideoAnalysis, atS: number): VideoPart | null {
  return a.parts.find((p) => atS >= p.fromS && atS < p.toS)?.part ?? null
}

/** The shots whose start falls in a part. */
export function shotsIn(a: VideoAnalysis, part: VideoPart): AnalysedShot[] {
  return a.shots.filter((s) => partAt(a, s.startS) === part)
}

export const videoMinutes = (a: VideoAnalysis): number => Math.max(a.coverage.durationS, 1) / 60

/** Words of a text, lower case, letters and digits only. */
export const tokens = (text: string): string[] => text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
