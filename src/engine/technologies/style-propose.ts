// Reproducing a style (production-15, docs/specs/production-model.md §10.3): from the measures of 1 to 5 reference
// channels or videos, the base that fits them (`avatar@1` when they show a presenter, `voiceover@1` « sans présentateur »
// when they do not, `documentary@2` when they show archives and motion-design cards without one), then the agent's usual two or three variants of it (propose.ts: « fidèle », « économique »,
// « premium », each the base plus edit operations), each with its free likeness estimate: the config-only score of what
// the pipeline would make against the references (likeness.ts). Pure: no I/O.
import { basePipeline } from './bases'
import { estimateCost } from './cost'
import { applyOps, type EditOp } from './edit-ops'
import { medianOf, type FitContext, type VideoMeasure } from './fit'
import { likeness, predictStyle, styleOps } from './likeness'
import { optionProblem } from './options'
import { ACTING_SHARE } from './reference-profile'
import type { Budget } from './mix'
import { fitPercent, proposePipelines, type Proposal, type ProposalVariant, type ProposeInput } from './propose'
import type { TechnologyRegistry } from './registry'
import type { RecipeDoc } from './recipe'

/** Under this median screen share the references have no presenter (a few seconds of a face in a 10-minute video). */
export const NO_PRESENTER_SHARE = 0.03

/** Over this median share of archives and motion-design cards (no presenter), the references are a documentary (style-markets: ≈ 90 %). */
export const DOCUMENTARY_SHARE = 0.35

/**
 * A story short (clone-reddit-shorts): a voice read at this many words a minute or more (a natural narrator reads ≈ 170, the story
 * shorts ≈ 310), or a vertical video of 3 minutes at most with captions over found footage only.
 */
export const STORY_WPM = 240
export const STORY_MAX_MINUTES = 3

export type BaseReason = 'presenter' | 'no-presenter' | 'documentary' | 'story' | 'animation' | 'unknown' | 'chosen'
export type BaseOfReferences = 'avatar@1' | 'voiceover@1' | 'documentary@2' | 'story-short@1' | 'pov@1'

/**
 * The references read like story shorts: a voice far faster than a narrator's; vertical Shorts with captions (no presenter: the caller
 * checked); or short captioned films of found footage only. Measured on Reddit Chroniques (clone-reddit-shorts): the eyes read its
 * Shorts at 142 words a minute (305 in fact) and half « AI clips » (real reposted footage), so the Shorts' shape decides.
 */
export function isStoryShort(refs: readonly VideoMeasure[]): boolean {
  const wpm = medianOf(refs.map((r) => r.wordsPerMinute).filter((x): x is number => typeof x === 'number'))
  if (wpm !== null && wpm >= STORY_WPM) return true
  const most = (f: (r: VideoMeasure) => boolean): boolean => refs.filter(f).length * 2 > refs.length
  if (most((r) => r.vertical === true) && most((r) => r.captions === true)) return true
  const minutes = medianOf(refs.map((r) => r.minutes).filter((x): x is number => typeof x === 'number'))
  const captioned = refs.filter((r) => r.captions === true).length * 2 > refs.length
  const found = medianOf(refs.map((r) => (r.kinds ? (r.kinds.stock ?? 0) + (r.kinds.userFootage ?? 0) : null)).filter((x): x is number => x !== null))
  return minutes !== null && minutes <= STORY_MAX_MINUTES && captioned && found !== null && found >= 0.8
}

/**
 * The base pipeline the references ask for, and why: a story short (fast voice, short captioned films over found clips) →
 * `story-short@1`; a presenter → `avatar@1`; drawn 2D animation → `pov@1`; none, over archives and motion-design cards (or an
 * archive look on most of them) → `documentary@2`; none otherwise → `voiceover@1`.
 */
export function baseForReferences(refs: readonly VideoMeasure[]): { baseId: BaseOfReferences; reason: BaseReason } {
  const shares = refs.map((r) => r.presenterShare).filter((s): s is number => typeof s === 'number')
  const median = medianOf(shares)
  if (median === null) return { baseId: 'avatar@1', reason: 'unknown' }
  // a presenter who talks to camera a few seconds but acts in the pictures is still the channel's presenter (style-japanese:
  // 2 % of talk, acting in a third of the pictures)
  const acts = medianOf(refs.map((r) => r.presenterActs).filter((s): s is number => typeof s === 'number'))
  if (median >= NO_PRESENTER_SHARE) return { baseId: 'avatar@1', reason: 'presenter' }
  // drawn 2D animation without a presenter (clone-monde-pov: the eyes see an illustrated look; its cards count as « motion », which
  // would otherwise read as a documentary's, and its cartoon hero « acts » in half the pictures without being a presenter: measured
  // live on Le Monde en POV, presenterActs 0.5)
  if (refs.filter((r) => r.lookFamily === 'illustrated').length * 2 > refs.length) return { baseId: 'pov@1', reason: 'animation' }
  if (acts !== null && acts >= ACTING_SHARE) return { baseId: 'avatar@1', reason: 'presenter' }
  if (isStoryShort(refs)) return { baseId: 'story-short@1', reason: 'story' }
  const documentary = medianOf(refs.map((r) => (r.kinds ? (r.kinds.archive ?? 0) + (r.kinds.motion ?? 0) : null)).filter((x): x is number => x !== null))
  const archiveLook = refs.filter((r) => r.lookFamily === 'archive').length * 2 > refs.length
  return (documentary !== null && documentary >= DOCUMENTARY_SHARE) || archiveLook ? { baseId: 'documentary@2', reason: 'documentary' } : { baseId: 'voiceover@1', reason: 'no-presenter' }
}

export interface StyleVariant extends ProposalVariant {
  /** The free first estimate: what the pipeline would make, scored against the references (0–100). */
  likeness: number | null
}

export interface StyleProposal extends Omit<Proposal, 'variants'> {
  reason: BaseReason
  variants: StyleVariant[]
}

export interface StyleProposeInput extends Omit<ProposeInput, 'baseId' | 'videos'> {
  refs: readonly VideoMeasure[]
  /** Force a base (the user switched it); default: the one the references ask for. */
  baseId?: string
  /**
   * What the owner said a video may cost (« 30-minute videos, far more stills towards the end », « 2 hours under 20 $ »), as a
   * budget of the mix (technologies/mix.ts): every variant carries it, so each is quoted for the video's length and the curve is
   * made for it (nodes/director-budget.ts); the variants still differ by their qualities, the budget by where the savings go.
   */
  budget?: Budget
}

/** The operation that gives a pipeline a budget (its mix, written with the budget; nothing else changes). */
export function budgetOps(doc: RecipeDoc, budget: Budget | undefined): EditOp[] {
  if (!budget || !doc.mix) return []
  return [{ op: 'setMix', mix: { ...doc.mix, budget } }]
}

/**
 * « Économique » halves the clips and the mix gives the freed time to every other kind, the presenter included (style-test-2:
 * 29 % of presenter became 44 %). In a style the presenter's screen time is part of the look: it stays the faithful one and
 * the freed time becomes stills (the clip-only-where-it-moves rule of record 0045).
 */
export function keepPresenterOps(variant: ProposalVariant, faithful: ProposalVariant | undefined): EditOp[] {
  const mix = variant.doc.mix
  const kept = faithful?.doc.mix?.presenter
  if (variant.kind !== 'cheap' || !mix || typeof kept !== 'number' || typeof mix.presenter !== 'number' || mix.presenter <= kept + 0.005) return []
  const imageAi = Math.round(((mix.imageAi ?? 0) + mix.presenter - kept) * 10_000) / 10_000
  return [{ op: 'setMix', mix: { ...mix, presenter: kept, imageAi } }]
}

/** The pipelines closest to the references, from the bricks, priced and scored. */
export function proposeForStyle(input: StyleProposeInput, reg: TechnologyRegistry): StyleProposal {
  const chosen = baseForReferences(input.refs)
  const baseId = input.baseId && basePipeline(input.baseId) ? input.baseId : chosen.baseId
  const ctx: FitContext = input.ctx ?? {}
  const p = proposePipelines({ ...input, baseId, videos: input.refs, ctx }, reg)
  const decls = basePipeline(baseId)?.options ?? []
  const faithfulVariant = p.variants.find((v) => v.kind === 'faithful')
  const variants = p.variants.map((v) => {
    // the presenter's time of the faithful variant, then the references' curve and layouts, on top of the variant
    const keep = keepPresenterOps(v, faithfulVariant)
    const styled = [...keep, ...styleOps(keep.length > 0 ? { ...v.doc, mix: (keep[0] as Extract<EditOp, { op: 'setMix' }>).mix ?? v.doc.mix } : v.doc, input.refs, reg)]
    // the budget goes on last, so it sees the mix and the curve the style made
    const stagedMix = applyOps(v.doc, styled, reg, { checkOption: (o, val) => optionProblem(decls, o, val) })
    const extra = [...styled, ...budgetOps(stagedMix.ok ? stagedMix.doc : v.doc, input.budget)]
    const r = extra.length > 0 ? applyOps(v.doc, extra, reg, { checkOption: (o, val) => optionProblem(decls, o, val) }) : null
    const doc = r?.ok ? r.doc : v.doc
    const est = r?.ok && input.cost ? estimateCost(doc, reg, input.cost) : null
    const predicted = predictStyle(doc, reg, ctx)
    return {
      ...v,
      doc,
      ops: r?.ok ? [...v.ops, ...extra] : v.ops,
      ...(r?.ok ? { estimate: est?.ok ? est.estimate : v.estimate, fit: fitPercent(doc, input.refs, reg, ctx) } : {}),
      likeness: predicted ? likeness(input.refs, predicted).score : null
    }
  })
  // a base given (the owner's words, or a switch) when the references do not say it is « chosen »
  return { ...p, reason: baseId === chosen.baseId && chosen.reason !== 'unknown' ? chosen.reason : input.baseId && basePipeline(input.baseId) ? 'chosen' : chosen.reason, variants }
}
