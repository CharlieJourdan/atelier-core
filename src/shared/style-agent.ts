// Types shared by main and the renderer for « Reproduire un style » (production-15, docs/specs/production-model.md §10.3):
// the owner pastes 1 to 5 YouTube links, the eyes measure them, the agent proposes the closest pipelines (price per minute
// and a free likeness estimate), then a short priced sample (« Voir un exemple ») is made and measured, and the likeness
// score lists its three biggest gaps, each with the edit that closes it (Δ cost, Δ score). Numbers are credits; the
// renderer never imports the engine.
import type { EstimateRange } from './estimates'
import type { EditOpView, PipelineChangeView, QuestionView, VariantKindId } from './pipeline-agent'
import type { RecipeDocument } from './recipes'
import type { FeasibilityView } from './style-feasibility'

export const STYLE_MAX_LINKS = 5

/**
 * The ways into « Créer une pipeline » (parcours-utilisateur): clone a channel, import my own, translate one, mix two, create from
 * scratch with an inspiration per axis, a little different from a channel, or rework one of my pipelines.
 */
export const STUDY_PATHS = ['clone', 'own', 'translate', 'mix', 'inspire', 'different', 'rework'] as const
export type StudyPath = (typeof STUDY_PATHS)[number]
/** The axes a pipeline can take from its own reference (engine/technologies/inspirations.ts). */
export const INSPIRATION_AXES = ['content', 'editing', 'motion', 'script'] as const
export type InspirationAxisId = (typeof INSPIRATION_AXES)[number]
export type ChannelFormatId = 'short' | 'medium' | 'long'
/** What a pasted video link stands for: its own style, or its channel's. */
export type StudyScope = 'video' | 'channel'

/** What a reference channel's public numbers say (style-agent/insight.ts): its formats, the best-viewed one, its reach. */
export interface ChannelInsightView {
  title: string
  videos: number
  formats: { id: ChannelFormatId; count: number; medianViews: number | null }[]
  /** It publishes two formats or more (or its most viewed videos have different styles). */
  heterogeneous: boolean
  /** The format measured: the best-viewed one, or the owner's choice. */
  best: ChannelFormatId | null
  medianViews: number | null
  subscribers: number | null
  /** `weak`: its videos do not take off (said plainly, and a better pipeline is proposed). */
  verdict: 'weak' | 'ok' | 'strong' | 'unknown'
  /** In French, for the owner. */
  lines: string[]
}

/** One axis of « Créer de zéro avec des inspirations »: the link it comes from and what was taken. */
export interface InspirationView {
  axis: InspirationAxisId
  url: string
  title: string
  /** In French: what the pipeline took from it, or why not. */
  said: string
  taken: boolean
  problem: string | null
}

/** A pipeline's look in a few numbers, to draw a proposal's « avant / après » (predicted from its settings). */
export interface SketchView {
  /** Shares of the pictures: `archive`, `motion`, `imageAi`, `clipAi`, `stock`, `userFootage`… */
  kinds: Record<string, number>
  presenter: number
  shotS: number | null
  wordsPerMinute: number | null
  /** The captions burnt in (a preset: `classic`, `highlight`, `word`…), or null. */
  captions: string | null
}

/** Where an ingredient comes from (engine/technologies/ingredients.ts). */
export type IngredientSourceId = 'import' | 'find' | 'generate' | 'clone' | 'none'

/** One way to get an ingredient, with its effect on the price of a minute, the render time and the likeness. */
export interface IngredientOptionView {
  id: string
  source: IngredientSourceId
  title: string
  detail: string
  /** What the owner brings for it, in French (null: nothing). */
  needs: string | null
  /** The references measured something else. */
  far: boolean
  /** How it reads as a price lever (else its title). */
  lever: string | null
  perMinute: { before: EstimateRange; after: EstimateRange } | null
  /** The change of the average price of a minute, in % (null: prices not known). */
  deltaPct: number | null
  renderSeconds: { before: number; after: number } | null
}

/** One ingredient of the pipeline (pictures, script, voice, presenter, branding, music, motion, editing) and its options. */
export interface IngredientView {
  id: string
  title: string
  reference: string | null
  /** The option the proposed pipeline holds, and the one the owner chose (the same when untouched). */
  current: string
  chosen: string
  options: IngredientOptionView[]
}

/** The price shown up front: the recommended pipeline's minute and the few choices that move it most. */
export interface PriceView {
  perMinute: EstimateRange | null
  minutes: number
  /** Each with what it means and the price of a minute it gives (never a bare percentage that reads as « free video »). */
  levers: { ingredient: string; option: string; title: string; deltaPct: number; after: EstimateRange | null }[]
}

/** How long it takes, in seconds: the analysis just made, a sample, one video of the pipeline's length. */
export interface StudyTimingView {
  analysisS: number | null
  sampleS: number | null
  videoS: number | null
  minutes: number
}
export const LIKENESS_DIMENSION_IDS = ['mix', 'rhythm', 'presenter', 'look', 'text', 'pace'] as const
export type LikenessDimensionId = (typeof LIKENESS_DIMENSION_IDS)[number]

/** What one reference video (or a channel's typical video) shows, as the eyes measured it. */
export interface StyleMeasureView {
  minutes: number | null
  presenterShare: number | null
  layouts: string[]
  /** Shares of the pictures (presenter excluded): `imageAi`, `clipAi`, `stock`, `archive`, `motion`… */
  kinds: Record<string, number> | null
  shotS: number | null
  lookFamily: string | null
  captions: boolean | null
  labelsPerMinute: number | null
  wordsPerMinute: number | null
  curve: 'flat' | 'hook-heavy' | null
  /** Second of the first product or sponsor mention (null: none, or not measured). */
  offerAtS: number | null
  /** Share of the pictures in which the presenter acts the scene; the pictures' light and camera (absent: not measured). */
  presenterActs?: number | null
  light?: string | null
  camera?: string | null
}

export interface StyleReferenceView {
  url: string
  kind: 'video' | 'channel'
  title: string
  /** Videos the eyes measured for this link. */
  videos: number
  /** The eyes' demonstration (Atelier Cloud not connected): the measures are an example, not a reading. */
  demo: boolean
  /** Why this link gave nothing (null: measured). */
  problem: string | null
  /** Per video, plain French: read whole, or which part only and why (« watch a whole video »). */
  coverage?: string[]
}

export interface StyleVariantView {
  kind: VariantKindId
  doc: RecipeDocument
  /** What the agent changed on the base, then the gaps' edits the owner applied. */
  ops: EditOpView[]
  perMinute: EstimateRange | null
  /** The free first estimate (config only, 0–100). */
  likeness: number | null
  /** Fit % (three measured videos or more), null otherwise. */
  fit: number | null
  /** Gap edits applied on this variant since the proposal. */
  edits: number
}

export interface LikenessGapView {
  dimension: LikenessDimensionId
  /** The dimension's score now, 0–1. */
  score: number
  /** Empty: no setting of the pipeline closes it (said in plain words). */
  ops: EditOpView[]
  changes: PipelineChangeView[]
  /** The whole score once applied (predicted), and the price per minute before → after. */
  scoreAfter: number | null
  perMinute: { before: EstimateRange; after: EstimateRange } | null
}

export interface SampleQuoteView {
  /** The token the owner's click sends back: a sample runs only with the latest quote of the pipeline it was made for. */
  id: string
  variant: VariantKindId
  credits: EstimateRange
  /** The most the run holds from the wallet while it runs (its own worst-case quote), given back when not spent. */
  hold: number | null
  /** False on demo providers (Atelier Cloud not connected): nothing is held or debited. */
  debited: boolean
  seconds: number
  script: string
  channelId: number
}

export interface SampleView {
  variant: VariantKindId
  status: 'running' | 'done' | 'failed'
  runId: number
  /** The pipeline changed since this sample was made (« Refaire l'exemple »). */
  stale: boolean
  error: string | null
  measures: StyleMeasureView | null
  /** The measured score (0–100) and per dimension (0–1). */
  score: number | null
  dimensions: { id: LikenessDimensionId; weight: number; score: number | null }[]
  /** After the owner's edits on a stale sample: the score they should reach (predicted). */
  predicted: number | null
  gaps: LikenessGapView[]
  /** The look was read from the style (the eyes did not see the sample's frames). */
  lookFromStyle: boolean
  credits: number
}

/** A change that makes the channel the owner's own (clonage-traduction): logical for the genre, picked freely, none applied until picked. */
export interface DifferentiatorView {
  id: string
  family: 'motion' | 'pictures' | 'presenter' | 'rhythm' | 'text' | 'voice' | 'economy' | 'channel'
  /** `differ` makes the channel recognisable, `improve` makes the videos better, `cheaper` costs less. */
  effect: 'differ' | 'improve' | 'cheaper'
  /** In French. */
  title: string
  detail: string
  /** The saved « après » and « avant » previews (`option:<id>:<value>`), or null. */
  previewKey: string | null
  beforeKey: string | null
  /** Recommended to this owner: an improvement of a weak channel, or the agent matched it to the owner's words. */
  recommended: boolean
  /** What the pipeline makes before → after, drawn when no saved preview shows it (shots, pictures, voice, captions). */
  sketch: { before: SketchView; after: SketchView } | null
  /** Credits a finished minute, before → after (null: prices not known). */
  perMinute: { before: EstimateRange; after: EstimateRange } | null
  /** The average render time of one video of the pipeline's length, before → after (seconds). */
  renderSeconds: { before: number; after: number } | null
  /** The likeness estimate, before → after (null: no measured reference). */
  likeness: { before: number; after: number } | null
  picked: boolean
}

export interface StudyView {
  id: number
  /** The way in the owner chose. */
  path: StudyPath
  /** What the owner asked for, in their words. */
  text: string
  /** Extra instructions (« consignes en plus »), kept with the pipeline. */
  instructions: string
  links: string[]
  /** What each reference channel's numbers say (one per channel link read). */
  insights: ChannelInsightView[]
  /** « Créer de zéro » and « Mélanger » : each axis and its reference. */
  inspirations: InspirationView[]
  /** « Retravailler » : the pipeline being reworked. */
  rework: { id: number; name: string } | null
  /** The agent's question on how to differ, for this case (in French). */
  ask: string
  /** Whether Atelier can make this style, which parts, what it lacks, who must help, what instead (null: nothing to judge). */
  feasibility: FeasibilityView | null
  /** A video link was taken for its channel's style (« le style de sa chaîne »). */
  scope: StudyScope
  /** The ingredients and where each comes from (« importer les miens, l'agent les trouve, générer, cloner »). */
  ingredients: IngredientView[]
  price: PriceView
  timing: StudyTimingView
  references: StyleReferenceView[]
  /** The references' typical measures (medians). */
  profile: StyleMeasureView | null
  measured: number
  demo: boolean
  base: string
  /** Why this base: a presenter is seen, none is seen, or not measured. */
  reason: 'presenter' | 'no-presenter' | 'documentary' | 'story' | 'animation' | 'unknown' | 'chosen'
  variants: StyleVariantView[]
  recommended: VariantKindId
  /** « Comment veux-tu te différencier ? » (none for the owner's own channel). */
  differentiators: DifferentiatorView[]
  /** The source is the owner's own channel: an identical clone. */
  own: boolean
  /** The pipeline's language (translating the references), null: the channel's. */
  language: string | null
  questions: QuestionView[]
  /** The agent's words on the style (null: no agent, the code's proposal only). */
  summary: string | null
  agentNote: string | null
  /** The narration of the samples (two sentences on the references' subject). */
  script: string
  channelId: number | null
  quote: SampleQuoteView | null
  sample: SampleView | null
  /** Credits the eyes' measures cost (0: demonstration). */
  measureCredits: number
  creditEur: number
  createdAt: string
}

export interface StudySummary {
  id: number
  title: string
  base: string
  score: number | null
  createdAt: string
}

export interface StudyInput {
  /** What the owner wants, in a few words (needed when no link is given). */
  text?: string
  /** 1 to 5 example links (recommended: the agent measures them). */
  links?: string[]
  /** Ask the agent (one model call: the style in words and the sample's narration); false: the code alone. */
  agent?: boolean
  /** The links are the owner's own channel: clone it identically, two proposals at most (improvements and savings). */
  own?: boolean
  /** The language of the new channel (two letters): translating the references' channel; absent: the channel's own. */
  language?: string
  /** The way in (default `clone`, or `inspire` without links). */
  path?: StudyPath
  /** « Créer de zéro avec des inspirations » / « Mélanger deux chaînes »: one link per axis (the same link may serve several). */
  inspirations?: { axis: InspirationAxisId; link: string }[]
  /** Extra instructions for the agent (« consignes en plus »). */
  instructions?: string
  /** « Retravailler un style »: the team's pipeline to rework. */
  recipeId?: number
  /** Measure this format of the reference channels instead of their best-viewed one. */
  format?: ChannelFormatId
  /** A video link: copy this video's style (default) or its channel's (the channel is read from the video's page). */
  scope?: StudyScope
}
