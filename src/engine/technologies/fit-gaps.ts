// What closes the gaps between a pipeline and a channel (docs/specs/production-model.md §12, R12.2): the pipeline the
// channel's own measured profile asks for (`pipelineForProfile`: its mix, rhythm, length, pace, look and captions on a
// base pipeline), and the three biggest gaps of a pipeline, each with the one change (an option, the mix, the rhythm,
// the look, the pace or the length) that closes it best and what that change costs per minute. Pure: no I/O.
import { basePipeline } from './bases'
import { estimateCost, estimateShares, type CostInput } from './cost'
import { dimensionScores, fitOf, medianOf, pictureShares, predictProfile, wordsPerMinuteOf, type FitContext, type FitDimension, type PictureKind, type VideoMeasure } from './fit'
import { CURVE_FIT_S, curveRows, MIX_KINDS, type Mix, type MixKind } from './mix'
import { withinSlider } from './options'
import type { OptionValue, RecipeDoc } from './recipe'
import type { TechnologyRegistry } from './registry'
import { techName } from './types'
import { localeOf } from '../text/locale'
import { CURVE_WINDOWS_S, curveFromProfile, settingsFromProfile, type CurvePoint } from './reference-profile'

/** A change that closes a gap. */
export type FitCloser =
  | { kind: 'option'; option: string; value: OptionValue }
  | { kind: 'mix'; shares: Partial<Record<MixKind, number>> }
  | { kind: 'rhythm'; shotLengthS: NonNullable<Mix['shotLengthS']> }
  | { kind: 'look'; style: string }
  | { kind: 'speed'; speed: number }
  | { kind: 'minutes'; minutes: number }

export interface FitGap {
  dimension: FitDimension
  score: number
  /** The dimension's score once the closer is applied. */
  scoreAfter: number | null
  closer: FitCloser | null
  /** Change of the average cost per finished minute the closer makes (the book's currency), null without a book. */
  costDelta: number | null
}

const known = <T>(xs: readonly (T | null | undefined)[]): T[] => xs.filter((x): x is T => x !== null && x !== undefined)
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000
const STYLE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** The median share of each picture kind over the videos that measure them (made ones split as the pipeline splits them). */
function targetKinds(videos: readonly VideoMeasure[], current: Partial<Record<PictureKind, number>> | null): Partial<Record<PictureKind, number>> | null {
  const measured = videos.filter((v) => v.kinds)
  if (measured.length === 0) return null
  const kinds = MIX_KINDS.filter((k): k is PictureKind => k !== 'presenter')
  const med = Object.fromEntries(kinds.map((k) => [k, medianOf(measured.map((v) => v.kinds?.[k] ?? 0)) ?? 0])) as Record<PictureKind, number>
  if (measured.some((v) => v.kindsCoarse)) {
    // the eyes only tell made from found: made is split like the pipeline's own made kinds, found goes to stock
    const made = med.clipAi + med.imageAi + med.motion
    const found = med.stock + med.archive + med.userFootage
    const mine = { clipAi: current?.clipAi ?? 0, imageAi: current?.imageAi ?? 0, motion: current?.motion ?? 0 }
    const mineMade = mine.clipAi + mine.imageAi + mine.motion
    const split = mineMade > 0 ? mine : { clipAi: 0.3, imageAi: 0.7, motion: 0 }
    const splitTotal = split.clipAi + split.imageAi + split.motion
    return { clipAi: (made * split.clipAi) / splitTotal, imageAi: (made * split.imageAi) / splitTotal, motion: (made * split.motion) / splitTotal, stock: found }
  }
  return med
}

/** Shares rounded to 4 decimals, the drift on the largest, zeros dropped (a mix must add to 1). */
function cleanShares(s: Partial<Record<MixKind, number>>): Partial<Record<MixKind, number>> {
  const total = MIX_KINDS.reduce((a, k) => a + (s[k] ?? 0), 0)
  const out: Partial<Record<MixKind, number>> = {}
  for (const k of MIX_KINDS) if ((s[k] ?? 0) > 1e-4) out[k] = round4((s[k] as number) / total)
  const largest = MIX_KINDS.filter((k) => out[k] !== undefined).sort((a, b) => (out[b] as number) - (out[a] as number))[0]
  if (largest) out[largest] = round4((out[largest] as number) + 1 - MIX_KINDS.reduce((a, k) => a + (out[k] ?? 0), 0))
  return out
}

const SETTABLE = ['presenter', 'clipAi', 'imageAi', 'stock', 'archive'] as const
/** Shot lengths (presenter, clips, stills, found footage and archives) scaled together so the mean shot of `shares` is `shotS`. */
function lengthsFor(shares: Partial<Record<MixKind, number>>, base: Required<NonNullable<Mix['shotLengthS']>>, shotS: number): NonNullable<Mix['shotLengthS']> | null {
  const settable = SETTABLE.reduce((a, k) => a + (shares[k] ?? 0) / base[k], 0)
  const other = MIX_KINDS.filter((k) => !(SETTABLE as readonly string[]).includes(k)).reduce((a, k) => a + (shares[k] ?? 0) / 3.5, 0)
  const room = 1 / shotS - other
  if (!(settable > 0) || !(room > 0)) return null
  const f = settable / room
  const clamp = (x: number): number => Math.round(Math.min(60, Math.max(0.5, x * f)) * 100) / 100
  // stock and archive lengths only when the mix shows them (a mix without them keeps the shape it always had)
  return {
    presenter: clamp(base.presenter),
    clipAi: clamp(base.clipAi),
    imageAi: clamp(base.imageAi),
    ...((shares.stock ?? 0) > 0 ? { stock: clamp(base.stock) } : {}),
    ...((shares.archive ?? 0) > 0 ? { archive: clamp(base.archive) } : {})
  }
}

/** The document with one closer applied. */
export function withCloser(doc: RecipeDoc, c: FitCloser): RecipeDoc {
  const next = structuredClone(doc)
  switch (c.kind) {
    case 'option':
      next.options[c.option] = c.value
      break
    case 'mix': {
      next.mix = { ...cleanShares(c.shares), curve: doc.mix?.curve ?? 'flat', ...(doc.mix?.shotLengthS ? { shotLengthS: doc.mix.shotLengthS } : {}) } as Mix
      // the clip-share slider always sets the clip share (decision 0027): it follows the mix
      // (within the slider's bounds: a channel of clips only reaches the slider's top)
      const decls = basePipeline(doc.base)?.options ?? []
      if (decls.some((o) => o.id === 'clipShare')) next.options.clipShare = withinSlider(decls, 'clipShare', next.mix.clipAi ?? 0)
      break
    }
    case 'rhythm':
      if (next.mix) next.mix = { ...next.mix, shotLengthS: c.shotLengthS }
      break
    case 'look': {
      const pictures = next.bricks.find((b) => techName(b.tech) === 'visuals.fulfil')
      if (pictures) pictures.style = c.style
      break
    }
    case 'speed': {
      const voice = next.bricks.find((b) => techName(b.tech) === 'voice.tts')
      if (voice) voice.settings = { ...voice.settings, speed: c.speed }
      break
    }
    case 'minutes':
      next.format = { ...next.format, minutes: c.minutes }
      break
  }
  return next
}

/** The changes the channel's measured profile asks of this pipeline (each one alone; together they make its pipeline). */
export function profileClosers(doc: RecipeDoc, videos: readonly VideoMeasure[], reg: TechnologyRegistry, ctx: FitContext = {}): FitCloser[] {
  const out: FitCloser[] = []
  const med = (f: 'presenterShare' | 'shotS' | 'wordsPerMinute' | 'minutes'): number | null => medianOf(known(videos.map((v) => v[f])))
  const hasPresenter = doc.bricks.some((b) => reg.get(b.tech)?.engineFamily === 'presenter')
  const now = estimateShares(doc.mix, hasPresenter, doc.format.minutes).shares
  const presenter = hasPresenter ? (med('presenterShare') ?? now.presenter ?? 0) : 0
  const kinds = targetKinds(videos, pictureShares(now))
  const shares: Partial<Record<MixKind, number>> = kinds ? { presenter, ...Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, (1 - presenter) * v])) } : { ...now }
  // more AI clips than the clip slider allows (a channel of clips only): the rest is shown as stills, never as presenter time
  const decls = basePipeline(doc.base)?.options ?? []
  const clipMax = withinSlider(decls, 'clipShare', shares.clipAi ?? 0)
  if ((shares.clipAi ?? 0) > clipMax + 1e-9) {
    shares.imageAi = (shares.imageAi ?? 0) + (shares.clipAi as number) - clipMax
    shares.clipAi = clipMax
  }
  if (kinds || presenter !== (now.presenter ?? 0)) out.push({ kind: 'mix', shares: cleanShares(shares) })
  const shotS = med('shotS')
  const base = { presenter: 4, clipAi: 3.7, imageAi: 3.4, stock: 3.4, archive: 3.4, ...(doc.mix?.shotLengthS ?? {}) }
  const lengths = shotS ? lengthsFor(cleanShares(shares), base, shotS) : null
  if (lengths) out.push({ kind: 'rhythm', shotLengthS: lengths })
  const looks = known(videos.map((v) => v.look)).filter((l) => STYLE_NAME.test(l))
  const look = looks.sort((a, b) => looks.filter((x) => x === b).length - looks.filter((x) => x === a).length)[0]
  if (look) out.push({ kind: 'look', style: look })
  const wpm = med('wordsPerMinute')
  if (wpm) out.push({ kind: 'speed', speed: Math.round(Math.min(1.2, Math.max(0.7, wpm / wordsPerMinuteOf(doc.language ?? ctx.language))) * 100) / 100 })
  const minutes = med('minutes')
  if (minutes) out.push({ kind: 'minutes', minutes: Math.round(Math.min(30, Math.max(0.5, minutes)) * 10) / 10 })
  const captions = known(videos.map((v) => v.captions))
  if (captions.length > 0 && basePipeline(doc.base)?.options.some((o) => o.id === 'captions')) {
    out.push({ kind: 'option', option: 'captions', value: captions.filter(Boolean).length * 2 > captions.length })
  }
  return out
}

/** The pipeline the channel's own measured profile asks for, made from `doc` (a base pipeline or the team's own). */
export function pipelineForProfile(doc: RecipeDoc, videos: readonly VideoMeasure[], reg: TechnologyRegistry, ctx: FitContext = {}): RecipeDoc {
  const closers = profileClosers(doc, videos, reg, ctx)
  // the mix first: the rhythm's lengths are computed for the new shares; the presenter's curve and runs on the new mix
  return withLocale(withMeasuredPresenter(closers.reduce((d, c) => withCloser(d, c), doc), videos, reg), ctx.language ?? doc.language)
}

/** The channel's world (avatar-efficience): a pipeline cloned for a French channel shows French homes and equipment. */
export function withLocale(doc: RecipeDoc, language: string | null | undefined): RecipeDoc {
  const locale = localeOf(language)
  if (!locale) return doc
  const next = structuredClone(doc)
  for (const b of next.bricks) {
    const name = techName(b.tech)
    if ((name === 'director.plan' || name === 'visuals.fulfil') && b.settings.locale === undefined) b.settings = { ...b.settings, locale }
  }
  return next
}

/** The median share of the presenter in each window the videos measure (their curve, record 0058). */
export function medianCurve(videos: readonly VideoMeasure[]): CurvePoint[] {
  const out: CurvePoint[] = []
  CURVE_WINDOWS_S.forEach((fromS, k) => {
    const share = medianOf(known(videos.map((v) => v.presenterCurve?.find((p) => p.fromS === fromS)?.share)))
    if (share !== null) out.push({ fromS, toS: CURVE_WINDOWS_S[k + 1] ?? null, share })
  })
  return out
}

/**
 * The presenter as the channel's own videos show it (avatar-qualite part 5, record 0058): its share in each measured window
 * becomes the mix's curve (the pipeline's own curve, fitted to its mix, with the measured presenter in it) and its longest run
 * the director's `presenterRunMaxS`. What the videos do not measure keeps the pipeline's default.
 */
export function withMeasuredPresenter(doc: RecipeDoc, videos: readonly VideoMeasure[], reg: TechnologyRegistry): RecipeDoc {
  if (!doc.mix || !doc.bricks.some((b) => reg.get(b.tech)?.engineFamily === 'presenter')) return doc
  const next = structuredClone(doc)
  const curve = curveFromProfile(medianCurve(videos), curveRows(doc.mix, CURVE_FIT_S))
  if (curve && next.mix) next.mix = { ...next.mix, curve }
  const run = medianOf(known(videos.map((v) => v.presenterRunMaxS)))
  const director = next.bricks.find((b) => techName(b.tech) === 'director.plan')
  if (run !== null && director) director.settings = { ...director.settings, ...settingsFromProfile({ presenterRunMaxS: run })['director.plan'] }
  return next
}

/** Every single change worth trying on a gap: the profile's own changes and every option choice that can be picked. */
function candidates(doc: RecipeDoc, videos: readonly VideoMeasure[], reg: TechnologyRegistry, ctx: FitContext): FitCloser[] {
  const out = profileClosers(doc, videos, reg, ctx)
  const base = basePipeline(doc.base)
  for (const o of base?.options ?? []) {
    if (o.kind === 'slider' || o.soon) continue
    for (const c of o.choices) if (!c.soon && doc.options[o.id] !== c.value) out.push({ kind: 'option', option: o.id, value: c.value })
  }
  return out
}

/** The three biggest gaps of a pipeline against a channel (weight × what the dimension misses), each with its closer. */
export function fitGaps(doc: RecipeDoc, videos: readonly VideoMeasure[], reg: TechnologyRegistry, ctx: FitContext = {}, cost?: CostInput): FitGap[] {
  const predicted = predictProfile(doc, reg, ctx)
  if (!predicted || !fitOf(videos, predicted).ok) return []
  const scores = dimensionScores(videos, predicted)
  const gaps = scores.filter((d) => d.score !== null && d.score < 0.995).sort((a, b) => b.weight * (1 - (b.score as number)) - a.weight * (1 - (a.score as number)))
  const tries = candidates(doc, videos, reg, ctx).flatMap((c) => {
    const next = withCloser(doc, c)
    const p = predictProfile(next, reg, ctx)
    return p ? [{ c, next, scores: dimensionScores(videos, p) }] : []
  })
  const avg = (d: RecipeDoc): number | null => {
    if (!cost) return null
    const r = estimateCost(d, reg, cost)
    return r.ok ? r.estimate.perMinute.avg : null
  }
  const now = avg(doc)
  return gaps.slice(0, 3).map((g) => {
    const before = g.score as number
    let best: (typeof tries)[number] | null = null
    let bestScore = before
    for (const t of tries) {
      const s = t.scores.find((x) => x.id === g.id)?.score ?? null
      if (s !== null && s > bestScore + 1e-9) {
        best = t
        bestScore = s
      }
    }
    const after = best ? avg(best.next) : null
    return { dimension: g.id, score: before, scoreAfter: best ? bestScore : null, closer: best?.c ?? null, costDelta: now !== null && after !== null ? after - now : null }
  })
}
