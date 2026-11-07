// The cost estimator (decision 0023, docs/specs/production-model.md §8–§9): what a pipeline costs per finished minute, per
// video and per brick, as min / avg / max, from its mix, shot lengths, options and engines, priced with ONE price book:
// the Cloud's grid in credits (what the user pays) or the providers' real cost in dollars (founder console, tests). It
// never holds a price itself, so a price change in the book moves every estimate (R8.3). Pure: no I/O, no LLM, no
// network, so the agent can compare dozens of variants for free (R8.5). Per finished minute (T = 60 s):
//   presenter seconds = T·presenter·(1 + (2·handleS + gapS) ÷ presenter shot length)   (one generation, then cut, avatar §2.5)
//                     = T·presenter·continuous ratio      (« continuous »: also generated under the short cutaways, production-10)
//   clip generations  = T·clipAi ÷ clip shot length × (1 − paired share ÷ 2); billed per call, or per second (≥ 4 s)
//   stills            = T·imageAi ÷ still shot length + clip generations (each clip starts from a still)
//   voice             = characters per minute × speed ÷ 1 000 × price per 1 000 characters
//   LLM               = token volumes of the tasks × model prices: 0 on « mon abonnement », priced on « crédits Atelier »
// avg = the engines as chosen + the regeneration rate (5 % until measured) on generated items (presenter, clips, stills);
// min = no regeneration; max = the dearest engine of each brick's list + 15 % regeneration (R8.2). Per minute counts what
// grows with the length; per video adds the one-offs (thumbnails). Found footage, library music and the render cost no
// credits (the render is in the plan, decision 0015). A provider's monthly plan (HeyGen's web plan behind its MCP engine) is a
// fixed cost: listed apart (`fixedMonthly`), never inside the price per minute.
import { DEFAULT_ENGINES, type EngineFamily, type EngineInfo } from '../../shared/cloud-engines'
import { basePipeline } from './bases'
import { applyOptions } from './compile'
import { COST_DEFAULTS, estimateShares, measuredFactor } from './cost-defaults'
import type { MixKind, Shares } from './mix'
import { optionValues } from './options'
import type { RecipeDoc } from './recipe'
import type { TechnologyRegistry } from './registry'
import { techName } from './types'

export { COST_DEFAULTS, estimateShares }

export type EngineUnit = EngineInfo['unit']

/** One engine's price in the book's currency, per its unit. */
export interface EnginePrice {
  unit: EngineUnit
  perUnit: number
  /** For an engine billed per call: the longest generation one call makes (a longer one takes several calls). */
  maxSecondsPerCall?: number | null
  /** The provider plan this engine spends (US $ a month), a fixed cost shown apart from the price per minute. */
  planMonthlyUsd?: number | null
}

/** A model's token prices, US dollars per million tokens. */
export interface LlmPrice {
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
}

export interface PriceBook {
  /** `credits`: the Cloud's grid, what the user pays; `usd`: the providers' real cost. */
  currency: 'credits' | 'usd'
  engines: Readonly<Record<string, EnginePrice>>
  /** Token prices by model id, and what one dollar of tokens costs in the book's currency on « crédits Atelier ». */
  llm: { models: Readonly<Record<string, LlmPrice>>; perUsd: number } | null
}

/** Where the team's LLM work runs (decisions 0013, 0026): the user's Claude Code, Atelier's credits, the user's API key. */
export const LLM_BACKENDS = ['subscription', 'credits', 'api-key'] as const
export type LlmBackend = (typeof LLM_BACKENDS)[number]

export interface Range {
  min: number
  avg: number
  max: number
}

/** Settings the pipeline cannot hold yet, or overrides for a what-if (the clip brick holds its shots per generation since production-8). */
export interface CostAssumptions {
  /** The measured regeneration rate of the team (default 5 %). */
  regenRate?: number
  clipShotsPerGeneration?: number
  /** The share of the clip shots served two by two (0: none, 0.5: half, 1: all); wins over `clipShotsPerGeneration`. */
  clipPairShare?: number
  /** Length of one clip generation (default: its shots end to end). */
  clipSecondsPerGeneration?: number
  /** The clip engine and its fallbacks, while no brick of the clip family exists (default: the family's). */
  clipEngine?: { engine: string; fallbacks: readonly string[] }
  voiceCharsPerMinute?: number
}

export interface CostInput {
  book: PriceBook
  backend: LlmBackend
  /** The video's length (default: the pipeline's format). */
  minutes?: number
  assumptions?: CostAssumptions
}

export const COST_LINES = ['presenter', 'clips', 'images', 'voice', 'music', 'thumbnails', 'llm'] as const
export type CostLineId = (typeof COST_LINES)[number]

/** One line of « où va l'argent ». */
export interface CostLine {
  id: CostLineId
  /** The brick that spends it (technology name), null for the LLM line (several bricks). */
  brick: string | null
  /** The engine priced for min and avg, then its fallbacks. */
  engines: string[]
  perMinute: Range
  perVideo: Range
  /** An engine of the line has no price in the book (counted 0). */
  unpriced: string[]
}

export interface CostEstimate {
  currency: PriceBook['currency']
  minutes: number
  /** The screen-time shares the estimate used (the mix after the curve). */
  shares: Shares
  /** The pipeline has no mix: the director's defaults were assumed. */
  assumedMix: boolean
  perMinute: Range
  perVideo: Range
  lines: CostLine[]
  llm: {
    backend: LlmBackend
    tasks: string[]
    /** Per minute on « crédits Atelier », in the book's currency (what connecting Claude Code saves). */
    onCreditsPerMinute: Range
    /** Per minute in US dollars of tokens (on the user's API key). */
    usdPerMinute: Range
    /** Whether the LLM line is in the totals (only on « crédits Atelier »). */
    included: boolean
  }
  /** Provider plans the chosen engines spend (US $ a month): fixed, never in the price per minute. */
  fixedMonthly: { engine: string; usd: number }[]
}

const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const span = (n: number): [number, number, number] => [n, n, n]

/** Token volumes of the LLM tasks for a 10-minute video, thousands (production-model §9, our estimates to measure). */
const LLM_TASKS: readonly { id: string; model: string; inK: [number, number, number]; outK: [number, number, number]; cached: number; when: (b: Set<string>, o: Record<string, unknown>) => boolean }[] = [
  { id: 'script', model: SONNET, inK: span(40), outK: span(12), cached: 0, when: (b) => b.has('script.write') },
  { id: 'factcheck', model: SONNET, inK: span(120), outK: span(4), cached: 0, when: (b, o) => b.has('script.factcheck') || o.factcheck === true },
  { id: 'director', model: SONNET, inK: span(60), outK: span(20), cached: 0, when: (b) => b.has('director.plan') },
  { id: 'metadata', model: HAIKU, inK: span(20), outK: span(4), cached: 0, when: (b) => b.has('package.youtube') || b.has('thumbnail.make') },
  { id: 'editing', model: SONNET, inK: [300, 450, 600], outK: [40, 60, 80], cached: 0.5, when: (_b, o) => o.editing === 'advanced' }
]

const ZERO: Range = { min: 0, avg: 0, max: 0 }
const add = (a: Range, b: Range): Range => ({ min: a.min + b.min, avg: a.avg + b.avg, max: a.max + b.max })
const times = (a: Range, k: number): Range => ({ min: a.min * k, avg: a.avg * k, max: a.max * k })

/** What one piece of work is made of, for any unit an engine bills in. */
interface Work {
  seconds?: number
  generations?: { count: number; secondsEach: number }
  /** The shortest a per-second generation is billed (the Veo default: 4 s; a per-second engine at its exact length: 1). */
  minBilledS?: number
  images?: number
  chars?: number
}

function quantity(work: Work, price: EnginePrice): number {
  const g = work.generations
  switch (price.unit) {
    case 'second':
      return g ? g.count * Math.max(work.minBilledS ?? COST_DEFAULTS.clipMinBilledS, Math.ceil(g.secondsEach - 1e-9)) : (work.seconds ?? 0)
    case 'minute':
      return g ? (g.count * g.secondsEach) / 60 : (work.seconds ?? (work.chars !== undefined ? 60 : 0)) / 60
    case 'clip':
    case 'call': {
      const per = price.maxSecondsPerCall ?? Infinity
      return g ? g.count * Math.max(1, Math.ceil(g.secondsEach / per - 1e-9)) : 0
    }
    case 'image':
      return work.images ?? 0
    case 'kchars':
      return (work.chars ?? 0) / 1000
    case 'mtokens':
      return 0
  }
}

interface Engines {
  list: string[]
  brick: string | null
}

/**
 * min / avg / max of one line of work on an engine list (`generated`: regenerations apply). `measured`: what a real run bills over
 * what is counted (COST_DEFAULTS.measured, #108); `min` stays the table's made-once count, avg and max carry it.
 */
function priceLine(book: PriceBook, e: Engines, work: Work, generated: boolean, regen: number, measured = 1): { range: Range; unpriced: string[] } {
  const unpriced = e.list.filter((id) => !book.engines[id])
  const cost = (id: string): number | null => {
    const p = book.engines[id]
    return p ? quantity(work, p) * p.perUnit : null
  }
  const first = e.list[0] !== undefined ? (cost(e.list[0]) ?? 0) : 0
  const dearest = Math.max(first, ...e.list.map((id) => cost(id) ?? 0))
  return {
    range: {
      min: first,
      avg: first * (generated ? (1 + regen) * measured : 1),
      max: dearest * (generated ? (1 + COST_DEFAULTS.maxRegenRate) * measured : 1)
    },
    unpriced
  }
}

/** The bricks of each engine family in the document, with the engine list each runs on (its own, else the default). */
function familyEngines(doc: RecipeDoc, reg: TechnologyRegistry): Map<EngineFamily, Engines[]> {
  const out = new Map<EngineFamily, Engines[]>()
  for (const b of doc.bricks) {
    const family = reg.get(b.tech)?.engineFamily
    if (!family) continue
    const def = DEFAULT_ENGINES[family]
    const list = b.engine ? [b.engine, ...b.fallbacks] : [def.engine, ...(b.fallbacks.length > 0 ? b.fallbacks : def.fallbacks)]
    out.set(family, [...(out.get(family) ?? []), { list, brick: techName(b.tech) }])
  }
  return out
}

/**
 * Average credits per finished minute of each LLM task (`director`, `script`…) on « crédits Atelier »: what a run's quote
 * shows on the line of the node that runs it (decision 0026). 0 for a task whose model has no price.
 */
export function llmTaskCreditsPerMinute(llm: PriceBook['llm']): Record<string, number> {
  const out: Record<string, number> = {}
  for (const x of LLM_TASKS) {
    const p = llm?.models[x.model]
    if (!p || !llm) continue
    const inTok = x.inK[1] * 1000
    const usd = (inTok * (1 - x.cached) * p.inputPerMTok + inTok * x.cached * p.cacheReadPerMTok + x.outK[1] * 1000 * p.outputPerMTok) / 1e6 / 10
    out[x.id] = usd * llm.perUsd
  }
  return out
}

function llmLine(doc: RecipeDoc, input: CostInput): CostEstimate['llm'] {
  const bricks = new Set(doc.bricks.map((b) => techName(b.tech)))
  const base = basePipeline(doc.base)
  const options = base ? optionValues(doc, base.options) : doc.options
  const tasks = LLM_TASKS.filter((x) => x.when(bricks, options))
  const models = input.book.llm?.models ?? {}
  const usd = (i: 0 | 1 | 2): number =>
    tasks.reduce((s, x) => {
      const p = models[x.model]
      if (!p) return s
      const inTok = x.inK[i] * 1000
      return s + (inTok * (1 - x.cached) * p.inputPerMTok + inTok * x.cached * p.cacheReadPerMTok + x.outK[i] * 1000 * p.outputPerMTok) / 1e6
    }, 0) / 10
  const usdPerMinute = { min: usd(0), avg: usd(1), max: usd(2) }
  return {
    backend: input.backend,
    tasks: tasks.map((x) => x.id),
    onCreditsPerMinute: times(usdPerMinute, input.book.llm?.perUsd ?? 0),
    usdPerMinute,
    included: input.backend === 'credits'
  }
}

/** The estimate of a pipeline document (its options are applied first), or why it cannot be estimated. */
export function estimateCost(source: RecipeDoc, reg: TechnologyRegistry, input: CostInput): { ok: true; estimate: CostEstimate } | { ok: false; errors: string[] } {
  const applied = applyOptions(source, reg)
  if (!applied.ok) return { ok: false, errors: applied.errors.map((e) => e.message) }
  const doc = applied.doc
  const a = input.assumptions ?? {}
  const minutes = input.minutes ?? doc.format.minutes
  const regen = a.regenRate ?? COST_DEFAULTS.regenRate
  const fam = familyEngines(doc, reg)
  const presenterBrick = fam.get('presenter')?.[0]
  const { shares, assumed } = estimateShares(doc.mix, presenterBrick !== undefined, minutes)
  const director = doc.bricks.find((b) => techName(b.tech) === 'director.plan')?.settings ?? {}
  // the editing's pace shortens every shot (« Montage dynamique »): more pictures a minute
  const pace = typeof director.pace === 'number' ? director.pace : 1
  const len = Object.fromEntries(Object.entries({ ...COST_DEFAULTS.shotLengthS, ...(doc.mix?.shotLengthS ?? {}) }).map(([k, v]) => [k, (v as number) * pace])) as typeof COST_DEFAULTS.shotLengthS
  // a presenter in half-screen or inset shows a picture beside him: those shots need a still (reference 1: 80 % of the
  // presenter's time with both, 60 % with half-screen only; full frame only: none)
  // unset: the director's own default (director-screen.ts: full frame and half-screen)
  const layouts = Array.isArray(director.layouts) ? (director.layouts as string[]) : ['full', 'split']
  const beside = layouts.includes('split') ? (layouts.includes('pip') ? COST_DEFAULTS.besideShare.all : COST_DEFAULTS.besideShare.split) : layouts.includes('pip') ? COST_DEFAULTS.besideShare.pip : 0
  const share = (k: MixKind): number => shares[k] ?? 0
  const lines: CostLine[] = []
  const push = (id: CostLineId, e: Engines | undefined, perMinute: { range: Range; unpriced: string[] } | null, oneOff: Range = ZERO): void => {
    if (!e) return
    const pm = perMinute?.range ?? ZERO
    lines.push({ id, brick: e.brick, engines: e.list, perMinute: pm, perVideo: add(times(pm, minutes), oneOff), unpriced: perMinute?.unpriced ?? [] })
  }

  // presenter: one generation of every stretch with its handles, then cut
  if (presenterBrick) {
    const continuous = doc.bricks.find((b) => techName(b.tech) === 'avatar.speak')?.settings.generation === 'continuous'
    const shown = 60 * share('presenter')
    const seconds = continuous ? shown * COST_DEFAULTS.continuousRatio : shown * (1 + (2 * COST_DEFAULTS.handleS + COST_DEFAULTS.gapS) / len.presenter)
    push('presenter', presenterBrick, priceLine(input.book, presenterBrick, { seconds }, true, regen))
  }
  // clips and stills: the pictures brick makes both; clips run on the clip family (its brick, else the default)
  const pictures = fam.get('image')?.find((e) => e.brick !== 'thumbnail.make')
  // the clip brick's own setting (production-8: 2 in eco; production-10: half the shots paired), unless the caller assumes another
  const clipSettings = doc.bricks.find((b) => reg.get(b.tech)?.engineFamily === 'clip')?.settings ?? {}
  const settingShots = typeof clipSettings.shotsPerGeneration === 'number' ? clipSettings.shotsPerGeneration : COST_DEFAULTS.clipShotsPerGeneration
  const perGen = a.clipShotsPerGeneration ?? settingShots
  const asked = a.clipPairShare ?? (a.clipShotsPerGeneration === undefined && typeof clipSettings.pairShare === 'number' ? clipSettings.pairShare : perGen >= 2 ? 1 : 0)
  // the cheap clip rules (vrais-tests): clips only where something moves, pairs only on one action, short shots per second
  const motionOnly = clipSettings.motionOnly === true
  const paired = clipSettings.pairSameAction === true ? Math.min(asked, COST_DEFAULTS.sameActionPairShare) : asked
  const shortEngine = typeof clipSettings.shortEngine === 'string' && clipSettings.shortEngine !== 'none' ? clipSettings.shortEngine : null
  const clipShare = motionOnly ? Math.min(share('clipAi'), COST_DEFAULTS.motionShare * (share('clipAi') + share('imageAi'))) : share('clipAi')
  const clipShots = (60 * clipShare) / len.clipAi
  const gens = pictures ? clipShots * (1 - paired / 2) : 0
  const shortGens = pictures && shortEngine ? clipShots * (1 - paired) * COST_DEFAULTS.shortShareOfSingles : 0
  if (pictures) {
    const clipBrick = fam.get('clip')?.[0]
    const clipList = clipBrick?.list ?? (a.clipEngine ? [a.clipEngine.engine, ...a.clipEngine.fallbacks] : [DEFAULT_ENGINES.clip.engine, ...DEFAULT_ENGINES.clip.fallbacks])
    const clips: Engines = { list: clipList, brick: clipBrick?.brick ?? pictures.brick }
    if (gens > 0) {
      const measuredClips = measuredFactor(COST_DEFAULTS.measured.clipSeconds, minutes)
      const main = gens - shortGens
      const secondsEach = a.clipSecondsPerGeneration ?? (main > 0 ? (len.clipAi * (clipShots - shortGens)) / main : len.clipAi)
      const long = priceLine(input.book, clips, { generations: { count: main, secondsEach } }, true, regen, measuredClips)
      const short = shortEngine
        ? priceLine(input.book, { list: [shortEngine, ...clipList.filter((e) => e !== shortEngine)], brick: clips.brick }, { generations: { count: shortGens, secondsEach: COST_DEFAULTS.shortBilledS }, minBilledS: 1 }, true, regen, measuredClips)
        : null
      push('clips', clips, short ? { range: add(long.range, short.range), unpriced: [...new Set([...long.unpriced, ...short.unpriced])] } : long)
    }
    // the clip shots the director turns into stills (nothing moves in them) are stills with a camera move
    const images = (60 * (share('imageAi') + share('clipAi') - clipShare)) / len.imageAi + gens + (presenterBrick ? (60 * share('presenter') * beside) / len.presenter : 0)
    if (images > 0) push('images', pictures, priceLine(input.book, pictures, { images }, true, regen, measuredFactor(COST_DEFAULTS.measured.images, minutes)))
  }
  // voice: the narration, never regenerated (its fallback serves the whole video)
  const voice = fam.get('voice')?.[0]
  if (voice) {
    const speed = doc.bricks.find((b) => techName(b.tech) === 'voice.tts')?.settings.speed
    const chars = (a.voiceCharsPerMinute ?? COST_DEFAULTS.voiceCharsPerMinute) * (typeof speed === 'number' ? speed : 1)
    push('voice', voice, priceLine(input.book, voice, { chars }, false, regen))
  }
  const music = fam.get('music')?.[0]
  if (music) push('music', music, priceLine(input.book, music, { seconds: 60 }, false, regen))
  // thumbnails: a one-off per video
  const thumbs = fam.get('image')?.find((e) => e.brick === 'thumbnail.make')
  if (thumbs) {
    const count = doc.bricks.find((b) => techName(b.tech) === 'thumbnail.make')?.settings.count
    const one = priceLine(input.book, thumbs, { images: typeof count === 'number' ? count : COST_DEFAULTS.thumbnails }, true, regen)
    push('thumbnails', thumbs, { range: ZERO, unpriced: one.unpriced }, one.range)
  }
  const llm = llmLine(doc, input)
  if (llm.tasks.length > 0) {
    const pm = llm.included ? llm.onCreditsPerMinute : ZERO
    lines.push({ id: 'llm', brick: null, engines: [], perMinute: pm, perVideo: times(pm, minutes), unpriced: [] })
  }
  const perMinute = lines.reduce((s, l) => add(s, l.perMinute), ZERO)
  const perVideo = lines.reduce((s, l) => add(s, l.perVideo), ZERO)
  // the plan of the engine each line runs on first (its fallbacks only spend when it fails)
  const fixedMonthly = [...new Set(lines.map((l) => l.engines[0]).filter((e): e is string => e !== undefined))]
    .map((engine) => ({ engine, usd: input.book.engines[engine]?.planMonthlyUsd ?? 0 }))
    .filter((f) => f.usd > 0)
  return { ok: true, estimate: { currency: input.book.currency, minutes, shares, assumedMix: assumed, perMinute, perVideo, lines, llm, fixedMonthly } }
}

/**
 * The change of the average cost per finished minute each option choice would make (the editor shows it beside the
 * choice): per option, per value (`String(value)`); a slider gives the change for 5 points more (`+0.05`). A choice that
 * cannot be picked yet (« bientôt ») is left out.
 */
export function optionCostDeltas(source: RecipeDoc, reg: TechnologyRegistry, input: CostInput): Record<string, Record<string, number>> {
  const base = basePipeline(source.base)
  const now = estimateCost(source, reg, input)
  if (!base || !now.ok) return {}
  const at = (id: string, value: string | number | boolean): number | null => {
    const r = estimateCost({ ...source, options: { ...source.options, [id]: value } }, reg, input)
    return r.ok ? r.estimate.perMinute.avg - now.estimate.perMinute.avg : null
  }
  const out: Record<string, Record<string, number>> = {}
  const values = optionValues(source, base.options)
  for (const o of base.options) {
    const row: Record<string, number> = {}
    if (o.kind === 'slider') {
      const v = Number(values[o.id])
      const next = Math.round(Math.min(o.max, v + 0.05) * 1000) / 1000
      const d = next > v ? at(o.id, next) : null
      if (d !== null) row['+0.05'] = d
    } else {
      for (const c of o.choices) {
        if ((o.soon ?? c.soon) && c.value !== o.default) continue
        const d = at(o.id, c.value)
        if (d !== null) row[String(c.value)] = d
      }
    }
    if (Object.keys(row).length > 0) out[o.id] = row
  }
  return out
}
