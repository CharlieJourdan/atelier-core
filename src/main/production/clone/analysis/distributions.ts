// How each screen element is DISTRIBUTED along a video (chantier reverse-pipeline): the presenter, every picture origin, stills vs
// moving pictures, motion design and on-screen text, as screen-time shares overall, per part and per tenth of the video; with the
// cadence (mean shot length), the pace (words per minute) and the illustration share part by part. Every share is computed by the
// overlap of each shot's [start, end) with the part or the window — a shot straddling a boundary counts on both sides, never « in the
// part where it starts ». Then the corpus pooling (median per part / per window, windows normalised by each video's length). Pure.
import type { AnalysedShot, DistributionRow, ElementDistribution, Evidence, VideoAnalysis, VideoPart } from '../../../../shared/clone'
import { DISTRIBUTION_WINDOWS, VIDEO_PARTS } from '../../../../shared/clone'
import { quantile, SILENCE_S, type Word } from './measures'

const r2 = (n: number): number => Math.round(n * 100) / 100
const r3 = (n: number): number => Math.round(n * 1000) / 1000
const overlap = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

type Shot = Pick<AnalysedShot, 'n' | 'startS' | 'lengthS' | 'kind' | 'origin' | 'layout' | 'camera' | 'onScreenText' | 'words' | 'illustrates' | 'frames'>
type Span = { part: VideoPart; fromS: number; toS: number }

/** Shot kinds that are still pictures whatever the camera does over them (a slow move on a photo is still a photo). */
const STILL_KINDS = new Set<Shot['kind']>(['archive-photo', 'document', 'title-card', 'illustration'])
/** A made picture (generated, drawn, 3D) moves when the camera reading saw it move by itself, not only a move over it. */
const MOVING_CAMERA = new Set<Shot['camera']>(['tracking', 'handheld', 'animated'])

/** A picture (not the presenter shot, not motion design) that does not move. */
export function isStillPicture(s: Pick<Shot, 'kind' | 'origin' | 'camera'>): boolean {
  if (s.origin === 'presenter' || s.origin === 'motion') return false
  if (STILL_KINDS.has(s.kind)) return true
  return (s.origin === 'generated' || s.origin === 'drawn' || s.origin === '3d') && !MOVING_CAMERA.has(s.camera)
}
const isPicture = (s: Pick<Shot, 'origin'>): boolean => s.origin !== 'presenter' && s.origin !== 'motion'

/** The elements a video's distributions name, each with which shots it covers. `motion` = the shots a motion element was seen on. */
export function elementsOf(shots: readonly Shot[], motion: ReadonlySet<number>): { element: string; on: (s: Shot) => boolean }[] {
  const out: { element: string; on: (s: Shot) => boolean }[] = [{ element: 'presenter', on: (s) => s.layout !== 'off' }]
  for (const o of [...new Set(shots.map((s) => s.origin))].sort()) out.push({ element: `origin:${o}`, on: (s) => s.origin === o })
  out.push({ element: 'still', on: (s) => isPicture(s) && isStillPicture(s) }, { element: 'moving', on: (s) => isPicture(s) && !isStillPicture(s) })
  if (shots.some((s) => s.origin === 'generated')) {
    out.push({ element: 'generated:still', on: (s) => s.origin === 'generated' && isStillPicture(s) }, { element: 'generated:moving', on: (s) => s.origin === 'generated' && !isStillPicture(s) })
  }
  out.push({ element: 'motion-design', on: (s) => motion.has(s.n) || s.origin === 'motion' }, { element: 'text', on: (s) => s.onScreenText.trim().length > 0 })
  return out
}

/** The share of the shot time inside the ranges that `on` covers (0 when no shot is there). */
function shareIn(shots: readonly Shot[], ranges: readonly { fromS: number; toS: number }[], on: (s: Shot) => boolean): number {
  let total = 0
  let mine = 0
  for (const s of shots) for (const r of ranges) {
    const d = overlap(s.startS, s.startS + s.lengthS, r.fromS, r.toS)
    if (d <= 0) continue
    total += d
    if (on(s)) mine += d
  }
  return total > 0 ? r3(mine / total) : 0
}

const partNames = (parts: readonly Span[]): VideoPart[] => VIDEO_PARTS.filter((p) => parts.some((x) => x.part === p))
const spansOf = (parts: readonly Span[], part: VideoPart): Span[] => parts.filter((p) => p.part === part)
/** The k-th tenth of the video. */
export const windowOf = (durationS: number, k: number): { fromS: number; toS: number } => ({ fromS: (durationS * k) / DISTRIBUTION_WINDOWS, toS: (durationS * (k + 1)) / DISTRIBUTION_WINDOWS })

export interface DistributionInput {
  videoId: string
  shots: readonly Shot[]
  parts: readonly Span[]
  durationS: number
  /** Shots on which the look saw a motion-design element (an overlay over a picture counts). */
  motion?: ReadonlySet<number>
}

/** Every element's distribution over one video; an element with no screen time is left out. */
export function distributionsOf(i: DistributionInput): ElementDistribution[] {
  const names = partNames(i.parts)
  const all = [{ fromS: 0, toS: i.durationS }]
  const ev = (s: Shot): Evidence => ({ video: i.videoId, fromS: r2(s.startS), toS: r2(s.startS + s.lengthS), frames: s.frames.slice(0, 1) })
  return elementsOf(i.shots, i.motion ?? new Set()).flatMap(({ element, on }) => {
    const overall = shareIn(i.shots, all, on)
    if (overall <= 0) return []
    const mine = i.shots.filter(on)
    // a few of its shots spread over the video, and the window where it holds the most screen time
    const step = Math.max(1, Math.floor(mine.length / 3))
    const curve = Array.from({ length: DISTRIBUTION_WINDOWS }, (_, k) => shareIn(i.shots, [windowOf(i.durationS, k)], on))
    const peak = curve.indexOf(Math.max(...curve))
    const w = windowOf(i.durationS, peak)
    const evidence: Evidence[] = [
      ...mine.filter((_, j) => j % step === 0).slice(0, 3).map(ev),
      { video: i.videoId, fromS: r2(w.fromS), toS: r2(w.toS), frames: [], note: `${element}: ${Math.round((curve[peak] ?? 0) * 100)} % of the screen time in tenth ${peak + 1}` }
    ]
    return [{ element, overall, byPart: names.map((part) => ({ part, share: shareIn(i.shots, spansOf(i.parts, part), on) })), curve, evidence }]
  })
}

/** Mean shot length per part, every shot counted by the share of its length inside the part. */
export function shotByPartOf(shots: readonly Pick<Shot, 'startS' | 'lengthS'>[], parts: readonly Span[]): { part: VideoPart; meanShotS: number }[] {
  return partNames(parts).flatMap((part) => {
    let time = 0
    let count = 0
    for (const s of shots) for (const p of spansOf(parts, part)) {
      const d = overlap(s.startS, s.startS + s.lengthS, p.fromS, p.toS)
      if (d <= 0) continue
      time += d
      count += d / Math.max(s.lengthS, 1e-6)
    }
    return count > 0 && time > 0 ? [{ part, meanShotS: r2(Math.max(0.01, time / count)) }] : []
  })
}

/** Fewest words, and seconds of speech, for a part's pace to be measured. */
export const PART_WPM_MIN_WORDS = 10
export const PART_WPM_MIN_S = 3

/** Words per minute of speech per part: the words that start in it over their speaking time (silences over SILENCE_S left out). */
export function wpmByPartOf(words: readonly Word[], parts: readonly Span[]): { part: VideoPart; wpm: number }[] {
  const w = words.filter((x) => x.word.trim() && Number.isFinite(x.start) && Number.isFinite(x.end)).sort((a, b) => a.start - b.start)
  return partNames(parts).flatMap((part) => {
    const spans = spansOf(parts, part)
    let n = 0
    let speaking = 0
    for (const span of spans) {
      const inside = w.filter((x) => x.start >= span.fromS && x.start < span.toS)
      n += inside.length
      inside.forEach((x, k) => {
        speaking += Math.max(0, x.end - x.start)
        const prev = inside[k - 1]
        if (prev) { const gap = x.start - prev.end; if (gap > 0 && gap <= SILENCE_S) speaking += gap }
      })
    }
    return n >= PART_WPM_MIN_WORDS && speaking >= PART_WPM_MIN_S ? [{ part, wpm: Math.round(n / (speaking / 60)) }] : []
  })
}

const ILLUSTRATES = { yes: 1, partly: 0.5, no: 0 } as const
/** A shot whose words were heard (at least two) and whose illustration was read. */
export const illustrationRead = (s: Pick<Shot, 'words' | 'illustrates'>): boolean => s.illustrates !== null && s.words.trim().split(/\s+/).filter(Boolean).length >= 2

/** Per part, the screen-time share of the read spoken shots whose picture shows what is said (null: none read there). */
export function illustratesByPartOf(shots: readonly Shot[], parts: readonly Span[]): { part: VideoPart; share: number | null }[] {
  const read = shots.filter(illustrationRead)
  return partNames(parts).map((part) => {
    let time = 0
    let good = 0
    for (const s of read) for (const p of spansOf(parts, part)) {
      const d = overlap(s.startS, s.startS + s.lengthS, p.fromS, p.toS)
      time += d
      good += d * ILLUSTRATES[s.illustrates!]
    }
    return { part, share: time > 0 ? r3(good / time) : null }
  })
}

// ---- the corpus ----------------------------------------------------------------------------------------------------------------------

const median = (xs: readonly number[]): number => (xs.length ? quantile(xs, 0.5) : 0)
/** True when the analysis could not measure an axis (its `unmeasured` note). */
const unmeasured = (a: VideoAnalysis, key: string): boolean => (a.unmeasured ?? []).some((u) => u.startsWith(`${key}:`))
/** The analyses whose distributions were measured. */
export const withDistributions = (analyses: readonly VideoAnalysis[]): VideoAnalysis[] => analyses.filter((a) => a.distributions !== undefined && !unmeasured(a, 'distributions'))

/**
 * The corpus's distribution of every element: the median over the measured videos of its share overall, in each part (over the videos
 * that have the part) and in each tenth (windows are tenths of each video's own length). A video without the element counts 0 for it.
 * Elements whose median share is 0 everywhere are left out.
 */
export function poolDistributions(analyses: readonly VideoAnalysis[]): DistributionRow[] {
  const measured = withDistributions(analyses)
  if (measured.length === 0) return []
  const elements = [...new Set(measured.flatMap((a) => a.distributions!.map((d) => d.element)))].sort()
  const of = (a: VideoAnalysis, el: string): ElementDistribution | undefined => a.distributions!.find((d) => d.element === el)
  return elements.flatMap((element) => {
    const overall = r3(median(measured.map((a) => of(a, element)?.overall ?? 0)))
    const byPart = VIDEO_PARTS.flatMap((part) => {
      const having = measured.filter((a) => a.parts.some((p) => p.part === part))
      return having.length ? [{ part, share: r3(median(having.map((a) => of(a, element)?.byPart.find((p) => p.part === part)?.share ?? 0))) }] : []
    })
    const curve = Array.from({ length: DISTRIBUTION_WINDOWS }, (_, k) => r3(median(measured.map((a) => of(a, element)?.curve[k] ?? 0))))
    if (overall <= 0 && byPart.every((p) => p.share <= 0) && curve.every((c) => c <= 0)) return []
    return [{ element, overall, byPart, curve }]
  })
}

/** The evidence of the pooled distributions: a few of each video's elements' shots and peak windows. */
export function distributionEvidence(analyses: readonly VideoAnalysis[], max = 8): Evidence[] {
  const measured = withDistributions(analyses)
  const per = Math.max(1, Math.ceil(max / Math.max(1, measured.length)))
  return measured.flatMap((a) => a.distributions!.flatMap((d) => d.evidence.slice(0, 1)).slice(0, per)).slice(0, max)
}

/** The corpus median of a per-part number (`pick` reads each video's rows), over the videos that measured that part. */
export function poolByPart<R extends { part: VideoPart }>(analyses: readonly VideoAnalysis[], rows: (a: VideoAnalysis) => readonly R[] | undefined, value: (r: R) => number | null, digits: (n: number) => number = r2): { part: VideoPart; value: number }[] {
  return VIDEO_PARTS.flatMap((part) => {
    const xs = analyses.flatMap((a) => (rows(a) ?? []).filter((r) => r.part === part).map(value)).filter((x): x is number => x !== null && Number.isFinite(x))
    return xs.length ? [{ part, value: digits(median(xs)) }] : []
  })
}
