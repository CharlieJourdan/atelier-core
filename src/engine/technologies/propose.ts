// The agent's pipeline proposal (decision 0024, docs/specs/production-model.md §10.1): from a measured profile (a channel's
// own videos, or the reference channels of a channel to launch; none for a bare concept) it builds two or three variants
// of a base pipeline — « fidèle » (the profile on standard pictures), « économique » (eco engines, half the AI clips),
// « premium » (the best engines) — each as the list of edit operations that turns the base into it, priced with the
// estimator and scored with the fit %. It also lists the questions the references leave open (who writes the scripts,
// whether there is a product, captions, the presenter's screen time), each answer being edit operations too. The variant
// documents are always the base plus their operations, so the user sees exactly what the agent changed. Pure: no I/O.
import { basePipeline, fromBase } from './bases'
import { estimateCost, type CostEstimate, type CostInput } from './cost'
import { applyOps, type EditOp } from './edit-ops'
import { fitOf, medianOf, predictProfile, type FitContext, type FitDimension, type VideoMeasure } from './fit'
import { pipelineForProfile } from './fit-gaps'
import { optionProblem } from './options'
import type { RecipeDoc } from './recipe'
import type { TechnologyRegistry } from './registry'
import { techName } from './types'

export const VARIANT_KINDS = ['faithful', 'cheap', 'premium'] as const
export type VariantKind = (typeof VARIANT_KINDS)[number]

/** A question the references do not answer; each choice is a batch of edit operations (labels: `pagent.q.<id>…`). */
export interface ProposalQuestion {
  id: 'script' | 'sponsor' | 'captions' | 'presenter' | 'promoPlace' | 'promoMode'
  choices: { value: string; ops: EditOp[] }[]
  default: string
  /** The answer given (it is in every variant's operations). */
  answer: string | null
}

export interface ProposalVariant {
  kind: VariantKind
  /** The base plus `ops` (and the length the profile asks for). */
  doc: RecipeDoc
  /** What the agent changed on the base, in order: the variant's own, then the answers. */
  ops: EditOp[]
  estimate: CostEstimate | null
  /** Fit % to the measured videos (null: under three of them). */
  fit: number | null
}

export interface Proposal {
  base: string
  /** Measured videos the proposal reads (0: a concept only). */
  measured: number
  variants: ProposalVariant[]
  recommended: VariantKind
  questions: ProposalQuestion[]
}

export interface ProposeInput {
  baseId?: string
  videos: readonly VideoMeasure[]
  ctx?: FitContext
  /** The price book; without it the variants carry no estimate. */
  cost?: CostInput
  name?: string
  /** Answers to the questions, by question id. */
  answers?: Readonly<Record<string, string>>
  /** The video length; default: the references' median, else the base's. */
  minutes?: number
}

const known = <T>(xs: readonly (T | null | undefined)[]): T[] => xs.filter((x): x is T => x !== null && x !== undefined)
const brickOf = (doc: RecipeDoc, name: string) => doc.bricks.find((b) => techName(b.tech) === name)
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * The operations that turn `from` into `to` on the fields the profile changes: the mix, the options, the pictures' style and
 * the voice speed (the length is the format, set on the variant itself: no operation sets it).
 */
export function profileOps(from: RecipeDoc, to: RecipeDoc): EditOp[] {
  const ops: EditOp[] = []
  if (!same(from.mix, to.mix) && to.mix) ops.push({ op: 'setMix', mix: to.mix })
  for (const [option, value] of Object.entries(to.options)) if (!same(from.options[option], value)) ops.push({ op: 'setOption', option, value })
  for (const b of to.bricks) {
    const a = brickOf(from, techName(b.tech))
    if (!a) continue
    if (a.style !== b.style) ops.push({ op: 'setStyle', brick: techName(b.tech), style: b.style })
    for (const key of new Set([...Object.keys(a.settings), ...Object.keys(b.settings)]))
      if (!same(a.settings[key], b.settings[key])) ops.push({ op: 'setSetting', brick: techName(b.tech), key, value: b.settings[key] ?? null })
  }
  return ops
}

/** What each variant asks on top of the profile (decision 0032): quality per subject and, for « économique », half the AI clips. */
function variantOps(kind: VariantKind, doc: RecipeDoc, declared: (id: string) => boolean): EditOp[] {
  const ops: EditOp[] = []
  const set = (option: string, value: string | number): void => {
    if (declared(option)) ops.push({ op: 'setOption', option, value })
  }
  if (kind === 'faithful') set('quality.images', 'standard')
  if (kind === 'cheap') {
    set('quality.images', 'eco')
    set('quality.presenter', 'eco')
    const clip = doc.mix?.clipAi ?? 0
    if (clip > 0 && declared('clipShare')) {
      const half = Math.round(clip * 50) / 100
      ops.push({ op: 'setMix', kind: 'clipAi', share: half })
      set('clipShare', half)
    }
  }
  if (kind === 'premium') {
    set('quality.images', 'premium')
    set('quality.presenter', 'premium')
  }
  return ops
}

/** The questions the measured videos leave open (R10.1 step 5); the script question is always asked (R6.12). */
export function openQuestions(
  videos: readonly VideoMeasure[],
  ctx: FitContext,
  declared: (id: string) => boolean,
  /** The base has a presenter to give a share of the screen to (no question about it otherwise). */
  presenter = true
): Omit<ProposalQuestion, 'answer'>[] {
  const out: Omit<ProposalQuestion, 'answer'>[] = []
  const option = (option: string, value: string | boolean): EditOp => ({ op: 'setOption', option, value })
  if (declared('script')) {
    out.push({ id: 'script', default: 'agent', choices: ['agent', 'agent-review', 'import'].map((v) => ({ value: v, ops: [option('script', v)] })) })
  }
  if (declared('sponsor') && (ctx.channelHasSponsor === null || ctx.channelHasSponsor === undefined)) {
    out.push({ id: 'sponsor', default: 'yes', choices: [{ value: 'yes', ops: [option('sponsor', 'auto')] }, { value: 'no', ops: [option('sponsor', 'off')] }] })
  }
  // the channel's own promo (promo-motion): one short question for each setting it does not say; the answer is kept on the channel
  if (declared('sponsor') && ctx.channelPromo?.includes('place')) {
    out.push({ id: 'promoPlace', default: 'after_hook', choices: ['after_hook', 'end', 'mention', 'none'].map((v) => ({ value: v, ops: [] })) })
  }
  if (declared('sponsor') && ctx.channelPromo?.includes('mode')) {
    out.push({ id: 'promoMode', default: 'same', choices: ['same', 'adapt', 'per_video'].map((v) => ({ value: v, ops: [] })) })
  }
  if (declared('captions') && known(videos.map((v) => v.captions)).length === 0) {
    out.push({ id: 'captions', default: 'no', choices: [{ value: 'no', ops: [option('captions', false)] }, { value: 'yes', ops: [option('captions', true)] }] })
  }
  if (presenter && known(videos.map((v) => v.presenterShare)).length === 0) {
    const share = (s: number): EditOp => ({ op: 'setMix', kind: 'presenter', share: s })
    out.push({ id: 'presenter', default: 'medium', choices: [{ value: 'low', ops: [share(0.12)] }, { value: 'medium', ops: [share(0.26)] }, { value: 'high', ops: [share(0.45)] }] })
  }
  return out
}

/** The fit % of a document to measured videos (null: not enough of them, or nothing comparable). */
export function fitPercent(doc: RecipeDoc, videos: readonly VideoMeasure[], reg: TechnologyRegistry, ctx: FitContext = {}): number | null {
  const predicted = predictProfile(doc, reg, ctx)
  if (!predicted) return null
  const r = fitOf(videos, predicted)
  return r.ok ? r.percent : null
}

/** Two or three variants of a base pipeline for a measured profile, priced and scored, the « fidèle » one recommended. */
export function proposePipelines(input: ProposeInput, reg: TechnologyRegistry): Proposal {
  const baseId = input.baseId ?? 'avatar@1'
  const base = basePipeline(baseId)
  if (!base) throw new Error(`no base pipeline « ${baseId} »`)
  const ctx = input.ctx ?? {}
  const declared = (id: string): boolean => base.options.some((o) => o.id === id && !o.soon)
  const checkOption = (option: string, value: unknown): string | null => optionProblem(base.options, option, value)
  const start = fromBase(base, input.name)
  const minutes = input.minutes ?? medianOf(known(input.videos.map((v) => v.minutes)))
  if (minutes) start.format = { ...start.format, minutes: Math.round(Math.min(30, Math.max(0.5, minutes)) * 10) / 10 }
  if (ctx.language) start.language = ctx.language
  // the profile's own changes (its mix, rhythm, look, pace, captions), the length aside: it is the format above
  const shaped = pipelineForProfile(start, input.videos, reg, ctx)
  const profile = profileOps(start, { ...shaped, format: start.format })
  const presenter = base.doc.bricks.some((b) => b.tech.startsWith('avatar.speak@'))
  const questions: ProposalQuestion[] = openQuestions(input.videos, ctx, declared, presenter).map((q) => {
    const a = input.answers?.[q.id]
    // the script question starts on the base's own choice (a story short imports its stories)
    const own = q.id === 'script' ? base.options.find((o) => o.id === 'script')?.default : undefined
    return { ...q, ...(typeof own === 'string' ? { default: own } : {}), answer: a !== undefined && q.choices.some((c) => c.value === a) ? a : null }
  })
  const answerOps = questions.flatMap((q) => (q.answer === null ? [] : (q.choices.find((c) => c.value === q.answer)?.ops ?? [])))
  const run = (doc: RecipeDoc, ops: readonly EditOp[]): RecipeDoc => {
    const r = applyOps(doc, ops, reg, { checkOption })
    if (!r.ok) throw new Error(`a proposal operation is not valid: ${r.errors.map((e) => e.message).join('; ')}`)
    return r.doc
  }
  const profiled = run(start, profile)
  const variants: ProposalVariant[] = []
  for (const kind of VARIANT_KINDS) {
    const ops = [...profile, ...variantOps(kind, profiled, declared), ...answerOps]
    const doc = run(start, ops)
    const est = input.cost ? estimateCost(doc, reg, input.cost) : null
    variants.push({ kind, doc, ops, estimate: est?.ok ? est.estimate : null, fit: fitPercent(doc, input.videos, reg, ctx) })
  }
  // « économique » that saves nothing (no AI clips to halve, eco already) is not a variant
  const faithful = variants[0] as ProposalVariant
  const kept = variants.filter((v) => v.kind !== 'cheap' || !v.estimate || !faithful.estimate || v.estimate.perMinute.avg < faithful.estimate.perMinute.avg - 1e-9)
  return { base: baseId, measured: input.videos.length, variants: kept, recommended: 'faithful', questions }
}

/** The fit dimensions none of the measured videos says anything about (what the proposal could only guess). */
export function unmeasuredDimensions(videos: readonly VideoMeasure[]): FitDimension[] {
  const has = (f: keyof VideoMeasure): boolean => videos.some((v) => v[f] !== null && v[f] !== undefined)
  const out: FitDimension[] = []
  if (!has('presenterShare')) out.push('presenter')
  if (!has('kinds')) out.push('kinds')
  if (!has('shotS')) out.push('rhythm')
  if (!has('wordsPerMinute') && !has('minutes')) out.push('script')
  if (!has('look')) out.push('look')
  if (!has('captions') && !has('labelsPerMinute')) out.push('text')
  if (!has('sponsor')) out.push('sponsor')
  return out
}
