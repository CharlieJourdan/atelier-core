// The sample of a proposed pipeline (production-15, « Voir un exemple »): the same pipeline, cut down to a short video on
// a sentence or two of the references' subject (the narration imported as the script, so its length is the sample's), with
// what a sample does not need switched off (support videos, sponsor, chapters, check, thumbnails, package) and no owner
// gate (the user's click on the quote is the approval). Its mix is the whole video's average on a flat curve: 15–20 s of
// a hook-heavy curve would show only the opening, so the sample shows the shares a full video has, and the curve itself is
// read from the pipeline. Then the sample's measures, read from its edit plan exactly (the director's shots, their kinds,
// lengths and layouts, the labels track, the narration's words). Pure: no I/O.
import type { EditPlan } from '../formats/editplan'
import { estimateCost, estimateShares, type CostInput, type Range } from './cost'
import { applyOps, type ApplyOptions, type EditOp } from './edit-ops'
import type { PictureKind, VideoMeasure } from './fit'
import { basePipeline } from './bases'
import { predictStyle } from './likeness'
import type { RecipeDoc } from './recipe'
import type { TechnologyRegistry } from './registry'
import { techName } from './types'

/** The sample's target length (Charlie: « 15–20 s »), and the words of narration that fill it at ≈ 160 words a minute. */
export const SAMPLE_SECONDS = 18
export const SAMPLE_WORDS = 48

/** Bricks a sample never needs (removed when the pipeline has them). */
const NOT_IN_SAMPLE = ['idea.support', 'qc.check', 'thumbnail.make', 'package.youtube'] as const

/** The pipeline of a sample: the operations on top of `doc`, and the document they make. */
export function sampleDoc(doc: RecipeDoc, reg: TechnologyRegistry, apply: ApplyOptions = {}): { ok: true; doc: RecipeDoc; ops: EditOp[] } | { ok: false; errors: string[] } {
  const declared = (id: string): boolean => basePipeline(doc.base)?.options.some((o) => o.id === id && !o.soon) === true
  const ops: EditOp[] = []
  if (declared('script')) ops.push({ op: 'setOption', option: 'script', value: 'import' })
  if (declared('sponsor')) ops.push({ op: 'setOption', option: 'sponsor', value: 'off' })
  if (declared('chapters')) ops.push({ op: 'setOption', option: 'chapters', value: false })
  const present = new Set(doc.bricks.map((b) => techName(b.tech)))
  for (const b of NOT_IN_SAMPLE) if (present.has(b)) ops.push({ op: 'removeBrick', brick: b })
  ops.push({ op: 'setGate', checkpoints: [] })
  if (doc.mix) {
    const hasPresenter = doc.bricks.some((b) => reg.get(b.tech)?.engineFamily === 'presenter')
    const { shares } = estimateShares(doc.mix, hasPresenter, doc.format.minutes)
    const r = (x: number): number => Math.round(x * 10_000) / 10_000
    const flat: Record<string, number> = Object.fromEntries(Object.entries(shares).filter(([, v]) => (v ?? 0) > 1e-4).map(([k, v]) => [k, r(v as number)]))
    const largest = Object.keys(flat).sort((a, b) => (flat[b] as number) - (flat[a] as number))[0]
    if (largest) flat[largest] = r((flat[largest] as number) + 1 - Object.values(flat).reduce((a, b) => a + b, 0))
    ops.push({ op: 'setMix', mix: { ...flat, curve: 'flat', ...(doc.mix.shotLengthS ? { shotLengthS: doc.mix.shotLengthS } : {}) } } as EditOp)
  }
  const res = applyOps(doc, ops, reg, apply)
  if (!res.ok) return { ok: false, errors: res.errors.map((e) => `${e.code}: ${e.message}`) }
  return { ok: true, doc: { ...res.doc, name: `${doc.name} — exemple` }, ops }
}

/** The sample's quote: the estimator's price for a video of the sample's length (credits, rounded up). */
export function sampleQuote(sample: RecipeDoc, reg: TechnologyRegistry, cost: CostInput, seconds: number = SAMPLE_SECONDS): Range | null {
  const r = estimateCost(sample, reg, { ...cost, minutes: seconds / 60 })
  if (!r.ok) return null
  const up = (x: number): number => Math.max(1, Math.ceil(x))
  return { min: up(r.estimate.perVideo.min), avg: up(r.estimate.perVideo.avg), max: up(r.estimate.perVideo.max) }
}

/** The narration of a sample: the subject's first sentences, cut at a sentence end near `SAMPLE_WORDS` words. */
export function sampleScript(subject: string, words: number = SAMPLE_WORDS): string {
  const all = subject.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (all.length <= words) return all.join(' ')
  const cut = all.slice(0, Math.round(words * 1.3))
  for (let i = cut.length - 1; i >= Math.round(words * 0.6); i--) if (/[.!?…]$/.test(cut[i] as string)) return cut.slice(0, i + 1).join(' ')
  return `${all.slice(0, words).join(' ')}…`
}

const KIND_OF: Readonly<Record<string, PictureKind>> = {
  'image.gen': 'imageAi',
  'video.gen': 'clipAi',
  'stock.photo': 'stock',
  'stock.video': 'stock',
  'user.footage': 'userFootage',
  motion: 'motion'
}

export interface SampleFacts {
  /** Words of the narration (the imported script). */
  words: number | null
  /** Captions burnt in (the captions brick's setting). */
  captions: boolean
  /** The pictures' look: the eyes' reading of the sample's frames, else the style's own (likeness.ts `lookOfStyle`). */
  lookFamily: string | null
  /** The pipeline's curve (a sample is too short to show one). */
  curve: 'flat' | 'hook-heavy' | null
  look?: string | null
}

/** The sample's measures, from its edit plan. */
export function measurePlan(plan: EditPlan, f: SampleFacts): VideoMeasure {
  const frames = Math.max(1, plan.frames)
  const seconds = frames / plan.fps
  const base = plan.shots.filter((s) => s.track === 'base')
  const len = (s: (typeof base)[number]): number => Math.max(0, s.endFrame - s.startFrame)
  const presenter = base.filter((s) => s.kind === 'avatar')
  const pictures: Partial<Record<PictureKind, number>> = {}
  for (const s of base) {
    const k = KIND_OF[s.kind]
    if (k) pictures[k] = (pictures[k] ?? 0) + len(s)
  }
  const total = Object.values(pictures).reduce((a, b) => a + (b ?? 0), 0)
  const shown = base.filter((s) => s.kind !== 'hold')
  const labels = plan.shots.filter((s) => s.track === 'labels').length
  return {
    minutes: seconds / 60,
    presenterShare: presenter.reduce((a, s) => a + len(s), 0) / frames,
    layouts: presenter.length === 0 ? [] : [...new Set(presenter.map((s) => s.layout ?? 'full'))],
    kinds: total > 0 ? Object.fromEntries(Object.entries(pictures).map(([k, v]) => [k, (v as number) / total])) : null,
    shotS: shown.length > 0 ? seconds / shown.length : null,
    wordsPerMinute: f.words && f.words > 0 ? f.words / (seconds / 60) : null,
    captions: f.captions,
    labelsPerMinute: labels / (seconds / 60),
    lookFamily: f.lookFamily,
    look: f.look ?? null,
    curve: f.curve
  }
}

/** What the run cannot show of a sample and the pipeline says: its curve, captions and look (`measurePlan`'s facts). */
export function sampleFacts(doc: RecipeDoc, reg: TechnologyRegistry, words: number | null, lookFamily: string | null = null): SampleFacts {
  const p = predictStyle(doc, reg)
  return { words, captions: p?.captions === true, lookFamily: lookFamily ?? p?.lookFamily ?? null, curve: p?.curve ?? null, look: p?.look ?? null }
}
