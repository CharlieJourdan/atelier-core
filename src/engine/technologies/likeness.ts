// The likeness score (« score de ressemblance », production-15, docs/specs/production-model.md §10.3): how close a sample
// made with a pipeline is to the reference videos whose style it reproduces, measured on what both sides show — the mix
// and its curve, the shot length, the presenter's time and layouts, the pictures' look, the text on screen and the pace of
// the narration. One score out of 100 (the weighted mean of the dimensions both sides measure), the three biggest gaps and,
// for each, the edit operations that close it best, with what they do to the score and to the price per minute. A gap's
// effect is predicted, not rendered: the sample's measures move by what the edit changes in the pipeline's predicted
// profile (`shiftMeasure`); « Refaire l'exemple » measures it for real. The config-only score (`predictStyle` against the
// references) is the free first estimate; works from one reference video (the fit % needs three). Pure: no I/O.
import { basePipeline } from './bases'
import { applyOptions } from './compile'
import { estimateCost, type CostInput } from './cost'
import { applyOps, type ApplyOptions, type EditOp } from './edit-ops'
import { withinSlider } from './options'
import { dimensionScores, medianOf, numberScore, predictProfile, type FitContext, type PictureKind, type VideoMeasure } from './fit'
import { profileClosers, type FitCloser } from './fit-gaps'
import type { RecipeDoc } from './recipe'
import type { TechnologyRegistry } from './registry'
import { techName } from './types'
import { ACTING_SHARE, settingsFromProfile, type ReferenceProfile } from './reference-profile'

export const LIKENESS_DIMENSIONS = ['mix', 'rhythm', 'presenter', 'look', 'text', 'pace'] as const
export type LikenessDimension = (typeof LIKENESS_DIMENSIONS)[number]

/** Our weights, to tune with Charlie on real channels (the fit's, with the look raised: it is what a viewer sees first). */
export const LIKENESS_WEIGHTS: Readonly<Record<LikenessDimension, number>> = { mix: 25, rhythm: 15, presenter: 20, look: 15, text: 10, pace: 15 }

/** The pictures' look families the eyes name and the styles map to. */
export const LOOK_FAMILIES = ['photoreal', 'illustrated', 'stock', '3d', 'archive'] as const
export type LookFamily = (typeof LOOK_FAMILIES)[number]

/** The look of the base styles (src/main/production/styles/seeds.ts); a style not listed has no known look. */
export const STYLE_LOOKS: Readonly<Record<string, LookFamily>> = { 'phone-real': 'photoreal', 'clean-stock': 'stock', 'archive-real': 'archive' }

/** The look family of a style reference (`phone-real@3` → photoreal), or null. */
export function lookOfStyle(style: string | null | undefined): LookFamily | null {
  return style ? (STYLE_LOOKS[style.replace(/@\d+$/, '')] ?? null) : null
}

/** A base style that has this look, or null (no illustrated or 3D style ships yet). */
export function styleForLook(look: string): string | null {
  return Object.entries(STYLE_LOOKS).find(([, l]) => l === look)?.[0] ?? null
}

export interface LikenessDimensionScore {
  id: LikenessDimension
  weight: number
  /** 0–1, null when one side does not measure it. */
  score: number | null
}

export interface Likeness {
  /** 0–100, null when no dimension is measured on both sides. */
  score: number | null
  dimensions: LikenessDimensionScore[]
}

const known = <T>(xs: readonly (T | null | undefined)[]): T[] => xs.filter((x): x is T => x !== null && x !== undefined)
const mean = (xs: readonly (number | null)[]): number | null => {
  const k = known(xs)
  return k.length === 0 ? null : k.reduce((a, b) => a + b, 0) / k.length
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** The likeness of one measured (or predicted) video to the references. */
export function likeness(refs: readonly VideoMeasure[], sample: VideoMeasure): Likeness {
  const fit = Object.fromEntries(dimensionScores(refs, sample).map((d) => [d.id, d.score])) as Record<string, number | null>
  const curves = known(refs.map((r) => r.curve))
  const curve = curves.length === 0 || !sample.curve ? null : curves.includes(sample.curve) ? 1 : 0
  const looks = known(refs.map((r) => r.lookFamily))
  const look = looks.length === 0 || !sample.lookFamily ? null : looks.includes(sample.lookFamily) ? 1 : 0
  const wpm = typeof sample.wordsPerMinute === 'number' ? numberScore(known(refs.map((r) => r.wordsPerMinute)), sample.wordsPerMinute, 20) : null
  const scores: Record<LikenessDimension, number | null> = {
    mix: mean([fit.kinds ?? null, curve]),
    rhythm: fit.rhythm ?? null,
    presenter: fit.presenter ?? null,
    look,
    text: fit.text ?? null,
    pace: wpm
  }
  const dimensions = LIKENESS_DIMENSIONS.map((id) => ({ id, weight: LIKENESS_WEIGHTS[id], score: scores[id] }))
  const scored = dimensions.filter((d) => d.score !== null)
  const weight = scored.reduce((s, d) => s + d.weight, 0)
  return { score: weight === 0 ? null : Math.round((100 * scored.reduce((s, d) => s + d.weight * (d.score as number), 0)) / weight), dimensions }
}

/** The curve a mix follows, as the eyes would see it. */
function curveOf(doc: RecipeDoc): 'flat' | 'hook-heavy' | null {
  const c = doc.mix?.curve
  if (!c) return null
  if (c === 'flat' || c === 'hook-heavy') return c
  // explicit rows: hook-heavy when the opening shows no stills
  return (c[0]?.shares.imageAi ?? 0) + (c[0]?.shares.stock ?? 0) < 0.1 ? 'hook-heavy' : 'flat'
}

/** What a pipeline would make, on every likeness dimension (the fit's profile plus layouts, curve and look family). */
export function predictStyle(doc: RecipeDoc, reg: TechnologyRegistry, ctx: FitContext = {}): VideoMeasure | null {
  const p = predictProfile(doc, reg, ctx)
  const applied = applyOptions(doc, reg)
  if (!p || !applied.ok) return null
  const director = applied.doc.bricks.find((b) => techName(b.tech) === 'director.plan')
  const layouts = director?.settings.layouts
  const presenter = (p.presenterShare ?? 0) > 0
  return {
    ...p,
    layouts: presenter ? (Array.isArray(layouts) ? layouts.filter((l): l is string => typeof l === 'string') : ['full']) : [],
    curve: curveOf(applied.doc),
    lookFamily: lookOfStyle(p.look)
  }
}

const SHARES: readonly (keyof VideoMeasure)[] = ['presenterShare']
const NUMBERS: readonly (keyof VideoMeasure)[] = ['presenterShare', 'shotS', 'wordsPerMinute', 'labelsPerMinute']
const VALUES: readonly (keyof VideoMeasure)[] = ['layouts', 'curve', 'lookFamily', 'look', 'captions', 'chapters', 'sponsor']

/**
 * The sample's measures once a change moves the pipeline from `before` to `after` (both predicted): numbers move by the
 * predicted difference, picture shares too (then add to 1 again), and a value the change sets (layouts, look, captions…)
 * becomes the predicted one.
 */
export function shiftMeasure(sample: VideoMeasure, before: VideoMeasure, after: VideoMeasure): VideoMeasure {
  const out: VideoMeasure = { ...sample }
  for (const f of NUMBERS) {
    const a = before[f]
    const b = after[f]
    if (typeof a !== 'number' || typeof b !== 'number' || Math.abs(b - a) < 1e-9) continue
    const s = sample[f]
    const v = typeof s === 'number' ? s + (b - a) : b
    ;(out as Record<string, unknown>)[f] = SHARES.includes(f) ? Math.min(1, Math.max(0, v)) : Math.max(0, v)
  }
  if (before.kinds && after.kinds && !same(before.kinds, after.kinds)) {
    const kinds = new Set([...Object.keys(before.kinds), ...Object.keys(after.kinds), ...Object.keys(sample.kinds ?? {})]) as Set<PictureKind>
    const moved: Partial<Record<PictureKind, number>> = {}
    for (const k of kinds) moved[k] = Math.max(0, (sample.kinds?.[k] ?? before.kinds[k] ?? 0) + (after.kinds[k] ?? 0) - (before.kinds[k] ?? 0))
    const total = Object.values(moved).reduce((a, b) => a + (b ?? 0), 0)
    if (total > 0) out.kinds = Object.fromEntries(Object.entries(moved).filter(([, v]) => (v ?? 0) > 1e-6).map(([k, v]) => [k, (v as number) / total]))
  }
  for (const f of VALUES) if (!same(before[f], after[f])) (out as Record<string, unknown>)[f] = after[f]
  return out
}

/** One change that closes a likeness gap, as edit operations (the minutes are the sample's: never a closer). */
export function closerOps(doc: RecipeDoc, c: FitCloser): EditOp[] {
  const decls = basePipeline(doc.base)?.options ?? []
  const declared = (id: string): boolean => decls.some((o) => o.id === id)
  switch (c.kind) {
    case 'option':
      return [{ op: 'setOption', option: c.option, value: c.value }]
    case 'mix': {
      const mix = { ...c.shares, curve: doc.mix?.curve ?? 'flat', ...(doc.mix?.shotLengthS ? { shotLengthS: doc.mix.shotLengthS } : {}) }
      // the clip-share slider always sets the clip share (decision 0027): it follows the mix
      return [{ op: 'setMix', mix } as EditOp, ...(declared('clipShare') ? [{ op: 'setOption', option: 'clipShare', value: withinSlider(decls, 'clipShare', c.shares.clipAi ?? 0) } as EditOp] : [])]
    }
    case 'rhythm':
      return doc.mix ? [{ op: 'setMix', mix: { ...doc.mix, shotLengthS: c.shotLengthS } } as EditOp] : []
    case 'look':
      return [{ op: 'setStyle', brick: 'visuals.fulfil', style: c.style }]
    case 'speed':
      return [{ op: 'setSetting', brick: 'voice.tts', key: 'speed', value: c.speed }]
    case 'minutes':
      return []
  }
}

/** Layout words of the eyes → the director's layouts. */
const LAYOUT_OF: Readonly<Record<string, 'full' | 'split' | 'pip'>> = { full: 'full', split: 'split', pip: 'pip', inset: 'pip' }

/**
 * The changes that make up for what the render did not follow: when the pipeline already asks for the references' value
 * and the sample came out elsewhere (less presenter than asked, longer shots, a slower voice), ask for more by the gap.
 */
function compensations(doc: RecipeDoc, refs: readonly VideoMeasure[], sample: VideoMeasure, predicted: VideoMeasure, hasPresenter: boolean): EditOp[][] {
  const out: EditOp[][] = []
  const med = (f: 'presenterShare' | 'shotS' | 'wordsPerMinute'): number | null => medianOf(known(refs.map((r) => r[f])))
  const r2 = (x: number): number => Math.round(x * 100) / 100
  const presenter = med('presenterShare')
  if (hasPresenter && doc.mix && presenter !== null && typeof sample.presenterShare === 'number' && typeof predicted.presenterShare === 'number') {
    const want = r2(Math.min(0.9, Math.max(0.02, predicted.presenterShare + presenter - sample.presenterShare)))
    if (Math.abs(want - (doc.mix.presenter ?? 0)) >= 0.01) out.push([{ op: 'setMix', kind: 'presenter', share: want }])
  }
  const shot = med('shotS')
  if (doc.mix && shot !== null && typeof sample.shotS === 'number' && typeof predicted.shotS === 'number' && predicted.shotS > 0) {
    const f = Math.max(0.3, (predicted.shotS + shot - sample.shotS) / predicted.shotS)
    const lengths = { presenter: 4, clipAi: 3.7, imageAi: 3.4, ...(doc.mix.shotLengthS ?? {}) }
    const scaled = Object.fromEntries(Object.entries(lengths).map(([k, v]) => [k, r2(Math.min(60, Math.max(0.5, (v as number) * f)))]))
    if (Math.abs(f - 1) >= 0.03) out.push([{ op: 'setMix', mix: { ...doc.mix, shotLengthS: scaled } } as EditOp])
  }
  // the clips' share among the pictures (the presenter's time kept)
  const clips = medianOf(known(refs.map((r) => (r.kinds ? (r.kinds.clipAi ?? 0) : null))))
  const sampleClips = sample.kinds ? (sample.kinds.clipAi ?? 0) : null
  if (doc.mix && clips !== null && sampleClips !== null && predicted.kinds) {
    const pictures = 1 - (doc.mix.presenter ?? 0)
    const want = withinSlider(basePipeline(doc.base)?.options ?? [], 'clipShare', r2(Math.min(1, Math.max(0, (doc.mix.clipAi ?? 0) + (clips - sampleClips) * pictures))))
    if (Math.abs(want - (doc.mix.clipAi ?? 0)) >= 0.01) out.push([{ op: 'setMix', kind: 'clipAi', share: want }, { op: 'setOption', option: 'clipShare', value: want }])
  }
  const wpm = med('wordsPerMinute')
  const voice = doc.bricks.find((b) => techName(b.tech) === 'voice.tts')
  if (voice && wpm !== null && typeof sample.wordsPerMinute === 'number' && sample.wordsPerMinute > 0) {
    const now = typeof voice.settings.speed === 'number' ? voice.settings.speed : 1
    const speed = r2(Math.min(1.2, Math.max(0.7, (now * wpm) / sample.wordsPerMinute)))
    if (Math.abs(speed - now) >= 0.02) out.push([{ op: 'setSetting', brick: 'voice.tts', key: 'speed', value: speed }])
  }
  return out
}

/** What the references show that the fit's profile does not set: their curve (when they agree) and the presenter's layouts. */
export function styleOps(doc: RecipeDoc, refs: readonly VideoMeasure[], reg: TechnologyRegistry): EditOp[] {
  const ops: EditOp[] = []
  const hasPresenter = doc.bricks.some((b) => reg.get(b.tech)?.engineFamily === 'presenter')
  const curves = known(refs.map((r) => r.curve))
  const curve = curves.length > 0 && curves.every((c) => c === curves[0]) ? curves[0] : null
  // a curve the references measure window by window is already the mix's (`withMeasuredPresenter`, record 0058)
  const measuredCurve = hasPresenter && refs.some((r) => (r.presenterCurve?.length ?? 0) > 0)
  if (doc.mix && curve && !measuredCurve && doc.mix.curve !== curve && (curve === 'flat' || hasPresenter)) ops.push({ op: 'setCurve', curve })
  const layouts = refLayouts(refs)
  if (hasPresenter && layouts.length > 0) ops.push({ op: 'setSetting', brick: 'director.plan', key: 'layouts', value: layouts })
  // the references' editing profile becomes the pipeline's own requirements (record 0055): measured, else left unset
  const med = (k: 'presenterRunMaxS' | 'cutLeadS' | 'literalShare' | 'presenterActs' | 'labelsPerMinute'): number | undefined => medianOf(known(refs.map((r) => r[k]))) ?? undefined
  const light = modeOf(known(refs.map((r) => r.light)))
  const camera = modeOf(known(refs.map((r) => r.camera)))
  const acts = hasPresenter ? med('presenterActs') : undefined
  const measured: ReferenceProfile = {
    ...(hasPresenter && med('presenterRunMaxS') !== undefined ? { presenterRunMaxS: med('presenterRunMaxS') as number } : {}),
    ...(med('cutLeadS') !== undefined ? { cutLeadS: med('cutLeadS') as number } : {}),
    ...(med('literalShare') !== undefined ? { literalShare: med('literalShare') as number } : {}),
    ...(med('labelsPerMinute') !== undefined ? { labelsPerMinute: med('labelsPerMinute') as number } : {}),
    ...(acts !== undefined ? { presenterActs: acts } : {}),
    ...(light ? { light } : {}),
    ...(camera ? { camera } : {})
  }
  const profile = settingsFromProfile(measured)
  // the base's own references (avatar@1: Headcast, grey light, steady camera) are not these: when the light or the camera
  // measured differ, the base's grammar and clip motion go, replaced by what these references ask, or left unset (style-japanese)
  const own = basePipeline(doc.base)?.profile
  const other = own !== undefined && ((light !== undefined && own.light !== undefined && light !== own.light) || (camera !== undefined && own.camera !== undefined && camera !== own.camera))
  if (other) {
    const director = profile['director.plan']
    const clips = profile['clip.make']
    for (const key of ['illustration', 'presenterOnTalk'] as const) if (!(key in director)) director[key] = null
    if (!('clipMotion' in clips)) clips.clipMotion = null
  }
  const hasBrick = (name: string): boolean => doc.bricks.some((b) => b.tech.startsWith(`${name}@`))
  for (const [brick, settings] of Object.entries(profile)) {
    if (!hasBrick(brick)) continue
    for (const [key, value] of Object.entries(settings)) {
      if (key === 'presenterOnTalk' && !hasPresenter) continue
      ops.push({ op: 'setSetting', brick, key, value })
    }
  }
  // a presenter who acts the scenes in the references acts them in the pipeline (avatar@1's « Le présentateur joue l'action »)
  if (acts !== undefined && acts >= ACTING_SHARE && basePipeline(doc.base)?.options.some((o) => o.id === 'presenterInBroll')) {
    ops.push({ op: 'setOption', option: 'presenterInBroll', value: 'presenter-as-actor' })
  }
  return ops
}

/** The most frequent value (the first one on a tie), or undefined. */
function modeOf<T>(xs: readonly T[]): T | undefined {
  let best: T | undefined
  let n = 0
  for (const x of xs) {
    const c = xs.filter((y) => y === x).length
    if (c > n) [best, n] = [x, c]
  }
  return best
}

const refLayouts = (refs: readonly VideoMeasure[]): ('full' | 'split' | 'pip')[] =>
  [...new Set(refs.flatMap((r) => r.layouts ?? []).map((l) => LAYOUT_OF[l.toLowerCase()]).filter((l): l is 'full' | 'split' | 'pip' => l !== undefined))]

/** Every single change worth trying: the references' own profile, their layouts, curve and look, every option choice. */
function candidates(doc: RecipeDoc, refs: readonly VideoMeasure[], sample: VideoMeasure, predicted: VideoMeasure, reg: TechnologyRegistry, ctx: FitContext): EditOp[][] {
  const hasPresenter = doc.bricks.some((b) => reg.get(b.tech)?.engineFamily === 'presenter')
  const out: EditOp[][] = [
    ...profileClosers(doc, refs, reg, ctx).map((c) => closerOps(doc, c)).filter((ops) => ops.length > 0),
    ...compensations(doc, refs, sample, predicted, hasPresenter)
  ]
  const layouts = refLayouts(refs)
  if (hasPresenter && layouts.length > 0) out.push([{ op: 'setSetting', brick: 'director.plan', key: 'layouts', value: layouts }])
  for (const curve of ['flat', 'hook-heavy'] as const) {
    if (curve === 'hook-heavy' && !hasPresenter) continue
    if (refs.some((r) => r.curve === curve) && doc.mix && doc.mix.curve !== curve) out.push([{ op: 'setCurve', curve }])
  }
  const looks = known(refs.map((r) => r.lookFamily))
  for (const look of new Set(looks)) {
    const style = styleForLook(look)
    if (style) out.push([{ op: 'setStyle', brick: 'visuals.fulfil', style }])
  }
  for (const o of basePipeline(doc.base)?.options ?? []) {
    if (o.kind === 'slider' || o.soon) continue
    for (const c of o.choices) if (!c.soon && doc.options[o.id] !== c.value) out.push([{ op: 'setOption', option: o.id, value: c.value }])
  }
  return out
}

export interface LikenessGap {
  dimension: LikenessDimension
  /** The dimension's score now (0–1). */
  score: number
  /** The operations that close it best (empty: nothing the pipeline can change closes it). */
  ops: EditOp[]
  /** The dimension's score and the whole score, predicted, once `ops` are applied. */
  dimensionAfter: number | null
  scoreAfter: number | null
  /** Change of the average cost per finished minute (the book's currency); null without a book. */
  costDelta: number | null
}

export interface GapOptions {
  ctx?: FitContext
  cost?: CostInput
  apply?: ApplyOptions
}

/** The three biggest gaps of a sample (weight × what the dimension misses), each with the change that closes it best. */
export function likenessGaps(doc: RecipeDoc, refs: readonly VideoMeasure[], sample: VideoMeasure, reg: TechnologyRegistry, o: GapOptions = {}): LikenessGap[] {
  const ctx = o.ctx ?? {}
  const now = likeness(refs, sample)
  const before = predictStyle(doc, reg, ctx)
  if (now.score === null || !before) return []
  const gaps = now.dimensions
    .filter((d) => d.score !== null && d.score < 0.995)
    .sort((a, b) => b.weight * (1 - (b.score as number)) - a.weight * (1 - (a.score as number)))
    .slice(0, 3)
  const avg = (d: RecipeDoc): number | null => {
    if (!o.cost) return null
    const r = estimateCost(d, reg, o.cost)
    return r.ok ? r.estimate.perMinute.avg : null
  }
  const tries = candidates(doc, refs, sample, before, reg, ctx).flatMap((ops) => {
    const r = applyOps(doc, ops, reg, o.apply ?? {})
    const after = r.ok ? predictStyle(r.doc, reg, ctx) : null
    return r.ok && after ? [{ ops, doc: r.doc, likeness: likeness(refs, shiftMeasure(sample, before, after)) }] : []
  })
  const base = avg(doc)
  return gaps.map((g) => {
    const dim = (l: Likeness): number | null => l.dimensions.find((d) => d.id === g.id)?.score ?? null
    let best: (typeof tries)[number] | null = null
    for (const t of tries) {
      const d = dim(t.likeness)
      if (d === null || d <= (g.score as number) + 1e-9) continue
      if (!best || (t.likeness.score ?? 0) > (best.likeness.score ?? 0) || ((t.likeness.score ?? 0) === (best.likeness.score ?? 0) && d > (dim(best.likeness) ?? 0))) best = t
    }
    const after = best ? avg(best.doc) : null
    return {
      dimension: g.id,
      score: g.score as number,
      ops: best?.ops ?? [],
      dimensionAfter: best ? dim(best.likeness) : null,
      scoreAfter: best ? best.likeness.score : null,
      costDelta: base !== null && after !== null ? after - base : null
    }
  })
}
