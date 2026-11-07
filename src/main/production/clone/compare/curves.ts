// P7 — the measured curves compared (spec §2 P7): shot lengths, layout shares per part, presenter presence, motion
// density, palette, pace, loudness, on the reference PASSAGE and on our render, each with a distance in 0..1 (0 = same).
// Pure: the reference side comes from the P2 analysis restricted to the passage (and from the same instruments as ours
// when the service measured the reference file too); our side from the render's measures and the run's timeline.
import { LAYOUTS, VIDEO_PARTS, type CompareAxis, type Layout, type OurShot, type Production, type VideoAnalysis, type VideoPart } from '../../../../shared/clone'

export interface Curve { axis: CompareAxis; name: string; reference: number[]; ours: number[]; distance: number; note?: string; labels?: string[] }

/** What an instrument measured on one video file (both sides measured the same way when possible). */
export interface FileMeasures {
  /** Cut times (seconds from the start of the measured span). */
  cutsS: number[]
  durationS: number
  loudnessLufs: number | null
  /** Dominant colours (`#rrggbb`) with their share of the pixels. */
  palette: { hex: string; share: number }[]
  wordsPerMinute: number | null
}

/** A shot of either side, on a common clock (seconds from the start of the passage / render). */
export interface SpanShot { startS: number; lengthS: number; layout: Layout; motion: boolean; part: VideoPart }

/** Shot-length bins (seconds): the distribution compared, not only the mean. */
export const SHOT_BINS = [0, 1, 2, 3, 5, 8, Infinity] as const

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 1)
const round3 = (x: number): number => Math.round(x * 1000) / 1000

/** Shares of shot lengths per bin (sums to 1; empty → all zero). */
export function shotHistogram(lengths: readonly number[]): number[] {
  const bins = new Array<number>(SHOT_BINS.length - 1).fill(0)
  for (const l of lengths) {
    const i = SHOT_BINS.findIndex((b, k) => k < SHOT_BINS.length - 1 && l >= b && l < SHOT_BINS[k + 1]!)
    if (i >= 0) bins[i]!++
  }
  const n = lengths.length || 1
  return bins.map((b) => round3(b / n))
}

/** Total variation distance of two distributions (0..1). */
export function tvDistance(a: readonly number[], b: readonly number[]): number {
  let d = 0
  for (let i = 0; i < Math.max(a.length, b.length); i++) d += Math.abs((a[i] ?? 0) - (b[i] ?? 0))
  return clamp01(d / 2)
}

/** Relative gap of two positive numbers (0..1). */
export function relGap(a: number, b: number): number {
  const m = Math.max(Math.abs(a), Math.abs(b))
  return m === 0 ? 0 : clamp01(Math.abs(a - b) / m)
}

/** Shot lengths from cut times over a span. */
export function lengthsFromCuts(cutsS: readonly number[], durationS: number): number[] {
  const edges = [0, ...cutsS.filter((c) => c > 0 && c < durationS).sort((x, y) => x - y), durationS]
  const out: number[] = []
  for (let i = 1; i < edges.length; i++) if (edges[i]! - edges[i - 1]! > 0.05) out.push(edges[i]! - edges[i - 1]!)
  return out
}

/** The reference's shots inside the passage, on the passage clock, with their part. */
export function referenceSpan(a: VideoAnalysis, passage: Production['passage']): SpanShot[] {
  const partAt = (t: number): VideoPart => a.parts.find((p) => t >= p.fromS && t < p.toS)?.part ?? 'body'
  const out: SpanShot[] = []
  for (const s of a.shots) {
    const from = Math.max(s.startS, passage.fromS)
    const to = Math.min(s.startS + s.lengthS, passage.toS)
    if (to - from <= 0.05) continue
    out.push({ startS: from - passage.fromS, lengthS: to - from, layout: s.layout, motion: s.origin === 'motion' || s.kind === 'motion-graphic' || s.kind === 'map' || s.kind === 'chart' || s.kind === 'title-card', part: partAt(from) })
  }
  return out
}

/** Our shots on the render clock, with the part they stand for (the passage's parts mapped proportionally). */
export function oursSpan(timeline: readonly OurShot[], a: VideoAnalysis, passage: Production['passage'], renderS: number): SpanShot[] {
  const scale = (passage.toS - passage.fromS) / (renderS || 1)
  const partAt = (t: number): VideoPart => a.parts.find((p) => t >= p.fromS && t < p.toS)?.part ?? 'body'
  return timeline.map((s) => ({ startS: s.startS, lengthS: s.lengthS, layout: s.layout, motion: s.motion, part: partAt(passage.fromS + s.startS * scale) }))
}

/** Parts present in a span, in order. */
const partsOf = (span: readonly SpanShot[]): VideoPart[] => VIDEO_PARTS.filter((p) => span.some((s) => s.part === p))

/** Share of screen time per layout, per part (flattened part × layout). */
export function layoutVector(span: readonly SpanShot[], parts: readonly VideoPart[]): number[] {
  const out: number[] = []
  for (const part of parts) {
    const shots = span.filter((s) => s.part === part)
    const total = shots.reduce((t, s) => t + s.lengthS, 0) || 1
    for (const l of LAYOUTS) out.push(round3(shots.filter((s) => s.layout === l).reduce((t, s) => t + s.lengthS, 0) / total))
  }
  return out
}

/** Presenter on-screen share per part. */
export function presenceVector(span: readonly SpanShot[], parts: readonly VideoPart[]): number[] {
  return parts.map((part) => {
    const shots = span.filter((s) => s.part === part)
    const total = shots.reduce((t, s) => t + s.lengthS, 0) || 1
    return round3(shots.filter((s) => s.layout !== 'off').reduce((t, s) => t + s.lengthS, 0) / total)
  })
}

/** Motion-design shots per minute, per part. */
export function motionVector(span: readonly SpanShot[], parts: readonly VideoPart[]): number[] {
  return parts.map((part) => {
    const shots = span.filter((s) => s.part === part)
    const minutes = shots.reduce((t, s) => t + s.lengthS, 0) / 60 || 1
    return round3(shots.filter((s) => s.motion).length / minutes)
  })
}

/** RGB of `#rrggbb`. */
export function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Palette distance (0..1): each colour's share-weighted distance to the nearest colour of the other side, both ways. */
export function paletteDistance(a: readonly { hex: string; share: number }[], b: readonly { hex: string; share: number }[]): number {
  const one = (x: readonly { hex: string; share: number }[], y: readonly { hex: string; share: number }[]): number => {
    const ys = y.map((c) => rgb(c.hex)).filter((c): c is [number, number, number] => c !== null)
    let total = 0
    let weight = 0
    for (const c of x) {
      const p = rgb(c.hex)
      if (!p || ys.length === 0) continue
      const near = Math.min(...ys.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])))
      total += c.share * (near / 441.7)
      weight += c.share
    }
    return weight === 0 ? 1 : total / weight
  }
  if (a.length === 0 || b.length === 0) return 1
  return clamp01((one(a, b) + one(b, a)) / 2)
}

/** Palette as a number vector for the saved curve (r, g, b, share per colour). */
const paletteNumbers = (p: readonly { hex: string; share: number }[]): number[] => p.flatMap((c) => [...(rgb(c.hex) ?? [0, 0, 0]), round3(c.share)])

export interface CurveInputs {
  analysis: VideoAnalysis
  production: Production
  /** Our render measured. */
  ours: FileMeasures
  /** The reference passage measured with the same instruments (null: use the P2 analysis numbers). */
  reference: FileMeasures | null
}

/** Every required curve (REQUIRED_CURVES) plus the shot-length curve over time. Pure. */
export function compareCurves(i: CurveInputs): Curve[] {
  const { analysis: a, production: pr } = i
  const ref = referenceSpan(a, pr.passage)
  const refLengths = i.reference ? lengthsFromCuts(i.reference.cutsS, i.reference.durationS) : ref.map((s) => s.lengthS)
  const ourLengths = lengthsFromCuts(i.ours.cutsS, i.ours.durationS)
  const out: Curve[] = []
  const rh = shotHistogram(refLengths)
  const oh = shotHistogram(ourLengths)
  out.push({ axis: 'cadence', name: 'shot-length', reference: rh, ours: oh, distance: round3(tvDistance(rh, oh)), note: `bins ${SHOT_BINS.slice(0, -1).join('/')} s; mean ref ${mean(refLengths).toFixed(2)} s, ours ${mean(ourLengths).toFixed(2)} s` })
  const rc = windowMeans(refLengths, 4)
  const oc = windowMeans(ourLengths, 4)
  out.push({ axis: 'cadence', name: 'shot-curve', reference: rc, ours: oc, distance: round3(mean(rc.map((r, k) => relGap(r, oc[k] ?? 0)))), note: 'mean shot length per quarter of the passage' })

  const theirs = pr.timeline && pr.timeline.length > 0 ? oursSpan(pr.timeline, a, pr.passage, pr.durationS) : null
  const parts = partsOf(ref)
  const layoutLabels = parts.flatMap((p) => LAYOUTS.map((l) => `${p}:${l}`))
  const notOnOurs = 'not measured on ours: the run gave no timeline'
  if (theirs) {
    const rl = layoutVector(ref, parts)
    const ol = layoutVector(theirs, parts)
    out.push({ axis: 'layout', name: 'layout-share', reference: rl, ours: ol, distance: round3(mean(parts.map((_, k) => tvDistance(rl.slice(k * LAYOUTS.length, (k + 1) * LAYOUTS.length), ol.slice(k * LAYOUTS.length, (k + 1) * LAYOUTS.length))))), note: `parts ${parts.join(', ')} × ${LAYOUTS.join('/')}`, labels: layoutLabels })
    const rp = presenceVector(ref, parts)
    const op = presenceVector(theirs, parts)
    out.push({ axis: 'identity', name: 'presence', reference: rp, ours: op, distance: round3(mean(rp.map((r, k) => Math.abs(r - (op[k] ?? 0))))), note: `presenter share per part ${parts.join(', ')}`, labels: parts })
    const rm = motionVector(ref, parts)
    const om = motionVector(theirs, parts)
    out.push({ axis: 'motion', name: 'motion-density', reference: rm, ours: om, distance: round3(mean(rm.map((r, k) => relGap(r, om[k] ?? 0)))), note: `motion shots per minute per part ${parts.join(', ')}`, labels: parts })
  } else {
    out.push({ axis: 'layout', name: 'layout-share', reference: layoutVector(ref, parts), ours: [], distance: 1, note: notOnOurs, labels: layoutLabels })
    out.push({ axis: 'identity', name: 'presence', reference: presenceVector(ref, parts), ours: [], distance: 1, note: notOnOurs, labels: parts })
    out.push({ axis: 'motion', name: 'motion-density', reference: motionVector(ref, parts), ours: [], distance: 1, note: notOnOurs, labels: parts })
  }

  const refPalette = i.reference?.palette.length ? i.reference.palette : a.motion.palette.map((hex) => ({ hex, share: 1 / Math.max(1, a.motion.palette.length) }))
  out.push({ axis: 'palette', name: 'palette', reference: paletteNumbers(refPalette), ours: paletteNumbers(i.ours.palette), distance: round3(paletteDistance(refPalette, i.ours.palette)), note: `ref ${refPalette.map((c) => c.hex).join(' ')} | ours ${i.ours.palette.map((c) => c.hex).join(' ')}` })

  const refWpm = i.reference?.wordsPerMinute ?? a.voice.wordsPerMinute.value
  const ourWpm = i.ours.wordsPerMinute
  out.push(ourWpm === null
    ? { axis: 'voice', name: 'pace', reference: [refWpm], ours: [], distance: 1, note: 'our pace not measured' }
    : { axis: 'voice', name: 'pace', reference: [round3(refWpm)], ours: [round3(ourWpm)], distance: round3(relGap(refWpm, ourWpm)), note: 'words per minute' })

  const refLufs = i.reference?.loudnessLufs ?? a.sound.loudnessLufs.value
  const ourLufs = i.ours.loudnessLufs
  out.push(ourLufs === null
    ? { axis: 'sound', name: 'loudness', reference: [refLufs], ours: [], distance: 1, note: 'our loudness not measured' }
    : { axis: 'sound', name: 'loudness', reference: [round3(refLufs)], ours: [round3(ourLufs)], distance: round3(clamp01(Math.abs(refLufs - ourLufs) / 10)), note: 'integrated LUFS; 10 LU apart = distance 1' })
  return out
}

export function mean(xs: readonly number[]): number { return xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0 }

/** Mean of consecutive values in `n` windows of the sequence (shot order ≈ time order). */
export function windowMeans(lengths: readonly number[], n: number): number[] {
  if (lengths.length === 0) return new Array<number>(n).fill(0)
  const total = lengths.reduce((t, x) => t + x, 0)
  const out: number[] = []
  let acc = 0
  const buckets: number[][] = Array.from({ length: n }, () => [])
  for (const l of lengths) {
    const k = Math.min(n - 1, Math.floor((acc / total) * n))
    buckets[k]!.push(l)
    acc += l
  }
  for (const b of buckets) out.push(round3(mean(b)))
  return out
}
