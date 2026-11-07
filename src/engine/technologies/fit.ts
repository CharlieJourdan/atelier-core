// Fit % (decision 0023, docs/specs/production-model.md §12): how well a pipeline matches a channel's own videos. The
// channel's measured profile (the eyes, one measure per video) is compared with the pipeline's predicted profile (what the
// pipeline would make, from its mix, options, styles and settings) on seven weighted dimensions. A measure scores 1 when
// the pipeline's value is within the channel's own spread across its videos and falls to 0 one spread (or a floor) away;
// a dimension is the mean of its measures; fit % is the weighted mean of the dimensions both sides measure (R12.2). Under
// three measured videos there is no fit (« pas assez de vidéos pour mesurer », R12.3). Pure: no I/O.
import { wpmMeasured } from '../text/lint'
import { basePipeline } from './bases'
import { applyOptions } from './compile'
import { COST_DEFAULTS, estimateShares } from './cost'
import { MIX_KINDS, type MixKind, type Shares } from './mix'
import { optionValues } from './options'
import type { RecipeDoc } from './recipe'
import type { TechnologyRegistry } from './registry'
import { techName } from './types'
import type { CurvePoint } from './reference-profile'

export const FIT_DIMENSIONS = ['presenter', 'kinds', 'rhythm', 'script', 'look', 'text', 'sponsor'] as const
export type FitDimension = (typeof FIT_DIMENSIONS)[number]

/** Default weights (R12.1); ours, to tune with Charlie on real channels. */
export const FIT_WEIGHTS: Readonly<Record<FitDimension, number>> = { presenter: 20, kinds: 20, rhythm: 15, script: 15, look: 10, text: 10, sponsor: 10 }

/** Fewer measured videos than this: no fit (R12.3). */
export const FIT_MIN_VIDEOS = 3

export type PictureKind = Exclude<MixKind, 'presenter'>
const PICTURE_KINDS = MIX_KINDS.filter((k): k is PictureKind => k !== 'presenter')
/** Picture kinds the eyes cannot tell apart yet: made (AI clips, AI stills, motion) or found (stock, archive, own footage). */
const COARSE: Record<PictureKind, 'made' | 'found'> = { clipAi: 'made', imageAi: 'made', motion: 'made', stock: 'found', archive: 'found', userFootage: 'found' }

/**
 * One video's profile, measured (the eyes) or predicted (a pipeline). Every field is optional: a field one side does not
 * know is left out of the comparison.
 */
export interface VideoMeasure {
  minutes?: number | null
  /** Share of screen time of the presenter, and the layouts it appears in (`full`, `half`, `inset`…). */
  presenterShare?: number | null
  layouts?: string[] | null
  /** Screen-time shares of the pictures (presenter excluded), adding to 1. `coarse`: only made vs found is known. */
  kinds?: Partial<Record<PictureKind, number>> | null
  kindsCoarse?: boolean
  /** Mean shot length in seconds (60 ÷ cuts per minute). */
  shotS?: number | null
  wordsPerMinute?: number | null
  chapters?: boolean | null
  cta?: boolean | null
  /** The look: a style name (`phone-real`) or the eyes' word for it. */
  look?: string | null
  /** The look's family (`photoreal`, `illustrated`, `stock`…: likeness.ts); the likeness score compares it, the fit % does not. */
  lookFamily?: string | null
  /** How the shares move along the video (the likeness score compares it, the fit % does not). */
  curve?: 'flat' | 'hook-heavy' | null
  captions?: boolean | null
  labelsPerMinute?: number | null
  sponsor?: boolean | null
  sponsorAtS?: number | null
  sponsorS?: number | null
  /** The editing measures of record 0055 (`reference-profile.ts`): the presenter's longest run, the cut's lead on the named word,
   *  the share of literal pictures. Unmeasured: absent. */
  presenterRunMaxS?: number | null
  cutLeadS?: number | null
  /** The presenter's share in each measured window (any layout, avatar-qualite part 5): the channel's own curve. */
  presenterCurve?: CurvePoint[] | null
  literalShare?: number | null
  /** Share of the pictures in which the presenter acts the scene (style-japanese), and the pictures' light and camera. */
  presenterActs?: number | null
  light?: 'overcast' | 'warm' | 'studio' | 'mixed' | null
  camera?: 'steady' | 'handheld' | 'moving' | null
  /** A vertical Short (its link is a `/shorts/` one): the eyes' own reading of a Short's pace and sources may be off. */
  vertical?: boolean | null
}

/** What the pipeline alone cannot say: the channel's language and whether it has a sponsor. */
export interface FitContext {
  language?: string | null
  channelHasSponsor?: boolean | null
  /** What the channel's own promo does not say yet (promo-motion): its placement, its reuse mode. The agent asks. */
  channelPromo?: ('place' | 'mode')[]
}

export interface DimensionScore {
  id: FitDimension
  weight: number
  /** 0–1, null when one side does not measure it. */
  score: number | null
}

export type FitResult = { ok: true; percent: number; dimensions: DimensionScore[]; videos: number } | { ok: false; reason: 'not-enough-videos' | 'nothing-measured'; videos: number }

/** Words per minute of a narration at speed 1: the rate the script is written to (record 0028, `wpmMeasured`). */
export const wordsPerMinuteOf = (language: string | null | undefined): number => wpmMeasured(language ?? 'fr')

/** Shot length assumed for the kinds a pipeline does not set one for. */
const OTHER_SHOT_S = 3.5

// ------------------------------------------------------------------------------------------------ prediction

/** What a pipeline would make, as a profile (its options applied first); null when it does not compile. */
export function predictProfile(source: RecipeDoc, reg: TechnologyRegistry, ctx: FitContext = {}): VideoMeasure | null {
  const applied = applyOptions(source, reg)
  if (!applied.ok) return null
  const doc = applied.doc
  const brick = (name: string) => doc.bricks.find((b) => techName(b.tech) === name)
  const hasPresenter = doc.bricks.some((b) => reg.get(b.tech)?.engineFamily === 'presenter')
  const { shares } = estimateShares(doc.mix, hasPresenter, doc.format.minutes)
  const len: Record<string, number> = { ...COST_DEFAULTS.shotLengthS, ...(doc.mix?.shotLengthS ?? {}) }
  const cutsPerS = MIX_KINDS.reduce((s, k) => s + (shares[k] ?? 0) / (len[k] ?? OTHER_SHOT_S), 0)
  const base = basePipeline(doc.base)
  const options = base ? optionValues(doc, base.options) : doc.options
  const speed = brick('voice.tts')?.settings.speed
  // the channel's own rate, when the script brick is given one, wins (record 0028)
  const scriptWpm = brick('script.write')?.settings.wpm
  const pictures = doc.bricks.find((b) => reg.get(b.tech)?.engineFamily === 'image' && techName(b.tech) !== 'thumbnail.make')
  const sponsor = ctx.channelHasSponsor === undefined || ctx.channelHasSponsor === null ? null : ctx.channelHasSponsor && options.sponsor !== 'off'
  return {
    minutes: doc.format.minutes,
    presenterShare: hasPresenter ? (shares.presenter ?? 0) : 0,
    kinds: pictureShares(shares),
    shotS: cutsPerS > 0 ? 1 / cutsPerS : null,
    wordsPerMinute: (typeof scriptWpm === 'number' ? scriptWpm : wordsPerMinuteOf(doc.language ?? ctx.language)) * (typeof speed === 'number' ? speed : 1),
    chapters: options.chapters === true,
    cta: brick('script.write') !== undefined ? true : null,
    look: pictures?.style ? pictures.style.replace(/@\d+$/, '') : null,
    captions: brick('captions.make')?.settings.burn === true,
    sponsor
  }
}

/** The shares of the pictures alone (the presenter's time taken out), adding to 1; null when there are none. */
export function pictureShares(shares: Shares): Partial<Record<PictureKind, number>> | null {
  const total = PICTURE_KINDS.reduce((s, k) => s + (shares[k] ?? 0), 0)
  if (total <= 0) return null
  const out: Partial<Record<PictureKind, number>> = {}
  for (const k of PICTURE_KINDS) if ((shares[k] ?? 0) > 0) out[k] = (shares[k] as number) / total
  return out
}

// ------------------------------------------------------------------------------------------------ scoring

/** Floors of the tolerance: a channel that never varies still allows this much (our values). */
const FLOOR = { share: 0.08, kind: 0.1, shotS: 1, wordsPerMinute: 20, minutes: 3, labelsPerMinute: 1.5, sponsorAtS: 30, sponsorS: 10 } as const

/** 1 within the channel's spread [lo, hi], falling to 0 one tolerance (the spread, or the floor) away. */
export function numberScore(values: readonly number[], p: number, floor: number): number | null {
  if (values.length === 0) return null
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const d = Math.max(0, lo - p, p - hi)
  return Math.max(0, 1 - d / Math.max(hi - lo, floor))
}

/** 1 when one of the channel's videos does the same, else 0 (a channel that varies accepts both). */
const boolScore = (values: readonly boolean[], p: boolean): number | null => (values.length === 0 ? null : values.includes(p) ? 1 : 0)

const known = <T>(xs: readonly (T | null | undefined)[]): T[] => xs.filter((x): x is T => x !== null && x !== undefined)

const mean = (xs: readonly (number | null)[]): number | null => {
  const k = known(xs)
  return k.length === 0 ? null : k.reduce((a, b) => a + b, 0) / k.length
}

function collapse(k: Partial<Record<PictureKind, number>>): Record<'made' | 'found', number> {
  const out = { made: 0, found: 0 }
  for (const kind of PICTURE_KINDS) out[COARSE[kind]] += k[kind] ?? 0
  return out
}

function kindsScore(videos: readonly VideoMeasure[], p: VideoMeasure): number | null {
  const measured = videos.filter((v) => v.kinds)
  if (measured.length === 0 || !p.kinds) return null
  if (measured.some((v) => v.kindsCoarse)) {
    const vs = measured.map((v) => collapse(v.kinds ?? {}))
    const pp = collapse(p.kinds)
    return mean((['made', 'found'] as const).map((g) => numberScore(vs.map((v) => v[g]), pp[g], FLOOR.kind)))
  }
  const kinds = PICTURE_KINDS.filter((k) => (p.kinds?.[k] ?? 0) > 0 || measured.some((v) => (v.kinds?.[k] ?? 0) > 0))
  return mean(kinds.map((k) => numberScore(measured.map((v) => v.kinds?.[k] ?? 0), p.kinds?.[k] ?? 0, FLOOR.kind)))
}

function layoutsScore(videos: readonly VideoMeasure[], p: VideoMeasure): number | null {
  const seen = new Set(videos.flatMap((v) => v.layouts ?? []))
  if (seen.size === 0 || !p.layouts || p.layouts.length === 0) return null
  return p.layouts.filter((l) => seen.has(l)).length / p.layouts.length
}

/** The score of each dimension of `p` against the channel's videos. */
export function dimensionScores(videos: readonly VideoMeasure[], p: VideoMeasure): DimensionScore[] {
  const num = (f: keyof VideoMeasure, floor: number): number | null => {
    const v = p[f]
    return typeof v === 'number' ? numberScore(known(videos.map((x) => x[f] as number | null | undefined)), v, floor) : null
  }
  const bool = (f: 'chapters' | 'cta' | 'captions' | 'sponsor'): number | null => {
    const v = p[f]
    return typeof v === 'boolean' ? boolScore(known(videos.map((x) => x[f])), v) : null
  }
  const looks = known(videos.map((v) => v.look?.toLowerCase()))
  const scores: Record<FitDimension, number | null> = {
    presenter: mean([num('presenterShare', FLOOR.share), layoutsScore(videos, p)]),
    kinds: kindsScore(videos, p),
    rhythm: num('shotS', FLOOR.shotS),
    script: mean([num('wordsPerMinute', FLOOR.wordsPerMinute), num('minutes', FLOOR.minutes), bool('chapters'), bool('cta')]),
    look: looks.length === 0 || !p.look ? null : looks.includes(p.look.toLowerCase()) ? 1 : 0,
    text: mean([bool('captions'), num('labelsPerMinute', FLOOR.labelsPerMinute), bool('chapters')]),
    // where and how long count only when both sides have a sponsor
    sponsor: mean([bool('sponsor'), ...(p.sponsor ? [num('sponsorAtS', FLOOR.sponsorAtS), num('sponsorS', FLOOR.sponsorS)] : [])])
  }
  return FIT_DIMENSIONS.map((id) => ({ id, weight: FIT_WEIGHTS[id], score: scores[id] }))
}

/** Fit % of a predicted profile against a channel's measured videos. */
export function fitOf(videos: readonly VideoMeasure[], predicted: VideoMeasure): FitResult {
  if (videos.length < FIT_MIN_VIDEOS) return { ok: false, reason: 'not-enough-videos', videos: videos.length }
  const dimensions = dimensionScores(videos, predicted)
  const scored = dimensions.filter((d) => d.score !== null)
  const weight = scored.reduce((s, d) => s + d.weight, 0)
  if (weight === 0) return { ok: false, reason: 'nothing-measured', videos: videos.length }
  const percent = Math.round((100 * scored.reduce((s, d) => s + d.weight * (d.score as number), 0)) / weight)
  return { ok: true, percent, dimensions, videos: videos.length }
}

/** The channel's typical value of a measure (the median of its videos), or null. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2
}
