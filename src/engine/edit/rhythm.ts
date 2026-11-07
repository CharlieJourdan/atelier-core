// The editing rhythm (motion-montage, docs/ENGINE-SPEC.md §21.11): how long shots last, measured on a real film and reproduced in ours.
// A rhythm is a shot-length distribution (median, 10th and 90th percentiles); it is fitted as a split log-normal (one spread below the
// median, one above, so both percentiles hold exactly) and sampled with the run's seed. `planCuts` turns it into cuts on the words of a
// voice (a cut lands on a word's start, a sentence start preferred); `measureRhythm` gives the same numbers for any list of cuts, ours or
// a reference's (`detectCuts` finds them in a video file with ffmpeg's scene score, free and local).
import type { RhythmProfile } from '../formats/edit-kit'
import type { Word } from '../formats/timing'
import type { MediaService } from '../services'

/** z of the 90th percentile of a normal law. */
const Z90 = 1.2815515655446004

export interface RhythmMeasure {
  shots: number
  cutsPerMin: number
  medianS: number
  meanS: number
  p10S: number
  p90S: number
  minS: number
  maxS: number
}

/** The q-quantile of sorted values (linear between neighbours). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  const a = sorted[lo] as number
  return a + ((sorted[hi] as number) - a) * (i - lo)
}

/** The rhythm of shot lengths (seconds). */
export function measureLengths(lengths: readonly number[]): RhythmMeasure {
  const s = [...lengths].filter((x) => x > 0).sort((a, b) => a - b)
  const total = s.reduce((a, b) => a + b, 0)
  return {
    shots: s.length,
    cutsPerMin: total > 0 ? ((s.length - 1) / total) * 60 : 0,
    medianS: quantile(s, 0.5),
    meanS: s.length ? total / s.length : 0,
    p10S: quantile(s, 0.1),
    p90S: quantile(s, 0.9),
    minS: s[0] ?? 0,
    maxS: s[s.length - 1] ?? 0
  }
}

/** The rhythm of a film from its cut times (seconds) and its length. */
export function measureRhythm(cutsS: readonly number[], durationS: number): RhythmMeasure {
  const edges = [0, ...[...cutsS].filter((c) => c > 0 && c < durationS).sort((a, b) => a - b), durationS]
  return measureLengths(edges.slice(1).map((e, i) => e - (edges[i] as number)))
}

/** The split log-normal of a profile: ln(median), and the spreads below and above it. */
export function fitRhythm(r: RhythmProfile): { mu: number; sigmaLo: number; sigmaHi: number } {
  const mu = Math.log(r.medianS)
  return { mu, sigmaLo: Math.max(0.01, (mu - Math.log(r.p10S)) / Z90), sigmaHi: Math.max(0.01, (Math.log(r.p90S) - mu) / Z90) }
}

/** A standard normal draw from a uniform source (Box–Muller). */
function normal(rand: () => number): number {
  const u = Math.max(1e-12, rand())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** One shot length from a profile. */
export function sampleLength(r: RhythmProfile, rand: () => number): number {
  const f = fitRhythm(r)
  const z = normal(rand)
  return Math.exp(f.mu + z * (z < 0 ? f.sigmaLo : f.sigmaHi))
}

/** A seeded uniform source (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Cuts on the words of a voice following a rhythm: each next cut is drawn from the profile (the hook's before `hookS`, the body's after),
 * then moved to the best word start within ±35 % of it — a sentence's first word first, then a word after a comma or a pause, then any
 * word. No shot is shorter than `minS`; the last one is not left shorter than half the median (it joins the one before).
 */
export function planCuts(o: { words: readonly Word[]; durationS: number; rhythm: { hook: RhythmProfile; body: RhythmProfile; hookS: number }; seed: number; minS?: number }): number[] {
  const rand = seededRandom(o.seed)
  const minS = o.minS ?? 0.8
  const starts = o.words.map((w, i) => {
    const prev = o.words[i - 1]
    const score = !prev ? 0 : w.sentence !== prev.sentence ? 3 : /[,;:—–]$/.test(prev.w) || w.start - prev.end >= 0.25 ? 2 : 1
    return { t: w.start, score }
  })
  const cuts: number[] = []
  let at = 0
  for (;;) {
    const profile = at < o.rhythm.hookS ? o.rhythm.hook : o.rhythm.body
    const target = at + Math.max(minS, sampleLength(profile, rand))
    if (target >= o.durationS - profile.medianS / 2) break
    const span = (target - at) * 0.35
    const near = starts.filter((s) => s.t >= Math.max(at + minS, target - span) && s.t <= target + span)
    // the best boundary near the target: the highest score, then the nearest
    const best = near.sort((a, b) => b.score - a.score || Math.abs(a.t - target) - Math.abs(b.t - target))[0]
    const cut = best ? best.t : target
    if (cut <= at + minS - 1e-6) break
    cuts.push(cut)
    at = cut
  }
  return cuts
}

/**
 * The cuts of a video file, seconds: ffmpeg's scene score on a small copy (`threshold` 0.3 by default), neighbours closer than `mergeS` merged
 * (a soft transition gives a run of scores: it is one change). Free and local; fast cuts in footage give a few extra (± 10 %).
 */
export async function detectCuts(media: MediaService, file: string, signal: AbortSignal, o: { threshold?: number; mergeS?: number; startS?: number; durationS?: number } = {}): Promise<number[]> {
  const times: number[] = []
  const window = [...(o.startS !== undefined ? ['-ss', o.startS.toFixed(3)] : []), ...(o.durationS !== undefined ? ['-t', o.durationS.toFixed(3)] : [])]
  await media.run('ffmpeg', ['-hide_banner', ...window, '-i', file, '-an', '-vf', `scale=480:-2,select='gt(scene\\,${o.threshold ?? 0.3})',showinfo`, '-f', 'null', '-'], {
    signal,
    onStderrLine: (line) => {
      const m = /pts_time:([0-9.]+)/.exec(line)
      if (m && line.includes('showinfo')) times.push(Number(m[1]))
    }
  })
  const merged: number[] = []
  for (const t of times.sort((a, b) => a - b)) if (merged.length === 0 || t - (merged[merged.length - 1] as number) > (o.mergeS ?? 0.5)) merged.push(t)
  return merged
}
