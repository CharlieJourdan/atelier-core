// P2 measures (chantier moteur-analyse): the pure arithmetic that turns a whole video's shots, word timings and per-shot
// looks into the numbers of a VideoAnalysis. Every number is computed here from times, never guessed; the callers attach
// the frames that show it. No I/O.
import type { MediaOrigin, VideoPart } from '../../../../shared/clone'

/** A spoken word with its start and end (whisper). */
export interface Word { word: string; start: number; end: number }

/** The minimum shape of a shot the measures need. */
export interface TimedShot { n: number; startS: number; lengthS: number }

/** A gap between two words at least this long counts as a pause (seconds). */
export const PAUSE_MIN_S = 0.3
/** A gap longer than this is not a pause of the speaker but a passage without speech (excluded from the pace). */
export const SILENCE_S = 2
/** A shot held longer than this is a hold. */
export const HOLD_S = 5
/** Windows of the shot-length curve. */
export const CURVE_WINDOWS = 10
/** A cut within this distance of a word boundary gap counts as landing on a phrase. */
export const SNAP_S = 0.25

const r2 = (n: number): number => Math.round(n * 100) / 100
const r3 = (n: number): number => Math.round(n * 1000) / 1000

export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo)
}
export const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export interface ShotStats {
  meanS: number
  medianS: number
  p90S: number
  /** The longest shot (its number and length): the measure behind `editing.holdMaxS`. */
  longest: { n: number; lengthS: number }
  holdsOver5S: number
  curve: { fromS: number; toS: number; meanShotS: number }[]
}

/** Shot-length distribution and its curve over the video (CURVE_WINDOWS equal windows, by shot start). */
export function shotStats(shots: readonly TimedShot[], durationS: number): ShotStats {
  const lengths = shots.map((s) => s.lengthS)
  const longest = shots.reduce((a, b) => (b.lengthS > a.lengthS ? b : a), shots[0]!)
  const curve: ShotStats['curve'] = []
  const w = durationS / CURVE_WINDOWS
  for (let i = 0; i < CURVE_WINDOWS; i++) {
    const fromS = i * w
    const toS = i === CURVE_WINDOWS - 1 ? durationS : (i + 1) * w
    const inside = shots.filter((s) => s.startS >= fromS && s.startS < toS)
    if (inside.length === 0) continue
    curve.push({ fromS: r2(fromS), toS: r2(toS), meanShotS: r2(Math.max(0.01, mean(inside.map((s) => s.lengthS)))) })
  }
  return {
    meanS: r2(mean(lengths)),
    medianS: r2(quantile(lengths, 0.5)),
    p90S: r2(quantile(lengths, 0.9)),
    longest: { n: longest.n, lengthS: r2(longest.lengthS) },
    holdsOver5S: shots.filter((s) => s.lengthS > HOLD_S).length,
    curve
  }
}

export interface SpeechStats {
  words: number
  /** Time the voice speaks (first word to last, minus silences longer than SILENCE_S). */
  speakingS: number
  wordsPerMinute: number
  pausesPerMinute: number
  meanPauseS: number
  /** The longest pause inside speech, with where it is. */
  longestPause: { atS: number; lengthS: number } | null
}

/** Pace and pauses from word timings. Null when there are too few words to measure (said by the caller). */
export function speechStats(words: readonly Word[]): SpeechStats | null {
  const w = words.filter((x) => x.word.trim() && Number.isFinite(x.start) && Number.isFinite(x.end)).sort((a, b) => a.start - b.start)
  if (w.length < 20) return null
  let speaking = w[w.length - 1]!.end - w[0]!.start
  const pauses: { atS: number; lengthS: number }[] = []
  for (let i = 1; i < w.length; i++) {
    const gap = w[i]!.start - w[i - 1]!.end
    if (gap > SILENCE_S) speaking -= gap
    else if (gap >= PAUSE_MIN_S) pauses.push({ atS: r2(w[i - 1]!.end), lengthS: r2(gap) })
  }
  if (!(speaking > 5)) return null
  const minutes = speaking / 60
  const longestPause = pauses.reduce<SpeechStats['longestPause']>((a, b) => (!a || b.lengthS > a.lengthS ? b : a), null)
  return {
    words: w.length,
    speakingS: r2(speaking),
    wordsPerMinute: Math.round(w.length / minutes),
    pausesPerMinute: r2(pauses.length / minutes),
    meanPauseS: r3(mean(pauses.map((p) => p.lengthS))),
    longestPause
  }
}

/** Mean words per sentence of a transcript (sentences end with . ! ? …). */
export function sentenceWordsMean(text: string): number {
  const sentences = text.split(/[.!?…]+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 2)
  if (sentences.length === 0) return 0
  return r2(mean(sentences.map((s) => s.split(/\s+/).filter(Boolean).length)))
}

/** The part a time falls in. */
export function partAt(parts: readonly { part: VideoPart; fromS: number; toS: number }[], t: number): VideoPart {
  return parts.find((p) => t >= p.fromS && t < p.toS)?.part ?? parts[parts.length - 1]!.part
}

/** Seconds of each part a shot covers (a shot can straddle a part change). */
function overlap(a0: number, a1: number, b0: number, b1: number): number { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) }

/** Screen-time share of each value of `key` over the given shots (sums to 1). */
export function timeShares<K extends string>(shots: readonly (TimedShot & Record<string, unknown>)[], key: (s: TimedShot) => K, fromS = 0, toS = Infinity): Partial<Record<K, number>> {
  const t = new Map<K, number>()
  let total = 0
  for (const s of shots) {
    const d = overlap(s.startS, s.startS + s.lengthS, fromS, toS)
    if (d <= 0) continue
    total += d
    t.set(key(s), (t.get(key(s)) ?? 0) + d)
  }
  const out: Partial<Record<K, number>> = {}
  if (total <= 0) return out
  for (const [k, v] of t) out[k] = r3(v / total)
  return out
}

/** Screen-time share per media origin (whole video). */
export function originShares(shots: readonly (TimedShot & { origin: MediaOrigin })[]): Partial<Record<MediaOrigin, number>> {
  return timeShares(shots as (TimedShot & { origin: MediaOrigin } & Record<string, unknown>)[], (s) => (s as TimedShot & { origin: MediaOrigin }).origin)
}

/** Share of cuts that land within SNAP_S of a pause between words (cut snapped to the phrase). Null without words. */
export function cutSnapShare(shots: readonly TimedShot[], words: readonly Word[]): number | null {
  if (words.length < 20 || shots.length < 2) return null
  const gaps: [number, number][] = []
  for (let i = 1; i < words.length; i++) if (words[i]!.start - words[i - 1]!.end >= 0.12) gaps.push([words[i - 1]!.end, words[i]!.start])
  const cuts = shots.slice(1).map((s) => s.startS)
  const snapped = cuts.filter((c) => gaps.some(([a, b]) => c >= a - SNAP_S && c <= b + SNAP_S))
  return r3(snapped.length / cuts.length)
}

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%$€]+/g, ' ').trim()

/**
 * When a piece of on-screen text lands against the word that says it: for each shot whose burnt-in text holds a token that
 * is also spoken within ±4 s, the offset shot start − word start (negative = the picture comes first). Returns the offsets
 * with the shot numbers (the evidence). Tokens: numbers, or words of 5+ letters.
 */
export function landingOffsets(shots: readonly (TimedShot & { onScreenText: string })[], words: readonly Word[]): { n: number; offsetS: number }[] {
  const out: { n: number; offsetS: number }[] = []
  const spoken = words.map((w) => ({ t: w.start, k: norm(w.word) }))
  for (const s of shots) {
    const tokens = norm(s.onScreenText).split(' ').filter((x) => /^\d+$/.test(x) || x.length >= 5)
    if (tokens.length === 0) continue
    let best: number | null = null
    for (const tok of new Set(tokens)) {
      for (const w of spoken) {
        if (Math.abs(w.t - s.startS) > 4 || w.k !== tok) continue
        const off = s.startS - w.t
        if (best === null || Math.abs(off) < Math.abs(best)) best = off
      }
    }
    if (best !== null) out.push({ n: s.n, offsetS: r2(best) })
  }
  return out
}

/** Burnt-in captions: share of speaking shots whose on-screen text repeats at least half of its words (subtitles). */
export function captionShare(shots: readonly (TimedShot & { onScreenText: string; words: string })[]): number {
  const speaking = shots.filter((s) => norm(s.words).split(' ').filter(Boolean).length >= 2)
  if (speaking.length === 0) return 0
  const cap = speaking.filter((s) => {
    const said = new Set(norm(s.words).split(' '))
    const shown = norm(s.onScreenText).split(' ').filter(Boolean)
    return shown.length >= 2 && shown.filter((x) => said.has(x)).length / shown.length >= 0.5
  })
  return r3(cap.length / speaking.length)
}

/** Frame times (0.5 s apart) for the dense windows: the hook, and ±`aroundS` of each part change. */
export function denseTimes(hookEndS: number, changes: readonly number[], durationS: number, aroundS = 2): number[] {
  const set = new Set<number>()
  const add = (a: number, b: number): void => { for (let t = Math.max(0, Math.ceil(a * 2) / 2); t <= Math.min(durationS - 0.1, b); t += 0.5) set.add(r2(t)) }
  add(0, Math.max(hookEndS, 1))
  for (const c of changes) add(c - aroundS, c + aroundS)
  return [...set].sort((a, b) => a - b)
}
