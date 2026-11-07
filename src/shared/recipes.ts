// Types shared by main and the renderer for technologies, recipes (« pipelines » in the UI) and projects (decisions 0010,
// 0011, 0021, 0022). The lists mirror the engine's (src/engine/technologies/types.ts, recipe.ts, mix.ts, options.ts);
// tests/unit/recipes.test.ts keeps them equal. The renderer never imports the engine: it sees technologies as
// `TechnologyInfo` and base pipelines as `BasePipelineInfo`, built in main from the code registry.
import type { EngineFamily } from './cloud-engines'
import type { StyleFamily } from './brick-styles'

export const RECIPE_STAGES = ['idee', 'script', 'voix', 'realisateur', 'elements', 'montage', 'controle'] as const
export type RecipeStage = (typeof RECIPE_STAGES)[number]

export const RECIPE_CHECKPOINTS = ['topic', 'script', 'voice', 'director', 'visuals', 'avatar', 'final', 'thumbnail'] as const
export type RecipeCheckpoint = (typeof RECIPE_CHECKPOINTS)[number]
export const DEFAULT_RECIPE_CHECKPOINTS: readonly RecipeCheckpoint[] = ['topic', 'thumbnail']

export const RECIPE_VIDEO_TYPES = ['avatar-long', 'documentaire', 'short', 'autre'] as const
export type RecipeVideoType = (typeof RECIPE_VIDEO_TYPES)[number]

/** Long format (a 16:9 video) or short (a vertical 9:16 short): shown on every pipeline card and chosen at creation. */
export const PIPELINE_FORMS = ['long', 'short'] as const
export type PipelineForm = (typeof PIPELINE_FORMS)[number]

/** A pipeline's form, read from its document: a vertical video or the short video type is a short. */
export function pipelineForm(doc: { videoType: RecipeVideoType; format: { aspect: '16:9' | '9:16' } }): PipelineForm {
  return doc.format.aspect === '9:16' || doc.videoType === 'short' ? 'short' : 'long'
}

export const MIX_KINDS =['presenter', 'clipAi', 'imageAi', 'stock', 'archive', 'userFootage', 'motion'] as const
export type MixKindName = (typeof MIX_KINDS)[number]

/** Screen-time shares per picture kind (they add to 1) and how they move along the video. */
export type RecipeMix = Partial<Record<MixKindName, number>> & {
  curve: 'flat' | 'hook-heavy' | { fromS: number; shares: Partial<Record<MixKindName, number>> }[]
  shotLengthS?: { presenter?: number; clipAi?: number; imageAi?: number }
}

export type RecipeOptionValue = string | number | boolean
export type RecipeInputSource = 'project' | 'channel' | { fixed: string }

export interface RecipeBrickEntry {
  tech: string
  settings: Record<string, unknown>
  /** null: the option or the Cloud's default decides. */
  engine: string | null
  fallbacks: string[]
  /** `name` or `name@version`; null: the channel's or the base pipeline's. */
  style: string | null
}

/** The `.atelier-recette.json` document (`atelier.recette/2`; a `/1` file still imports, upgraded). */
export interface RecipeDocument {
  $schema: 'atelier.recette/2'
  name: string
  /** The base pipeline it came from (`avatar@1`), or null. */
  base: string | null
  videoType: RecipeVideoType
  format: { aspect: '16:9' | '9:16'; minutes: number }
  language: string | null
  mix: RecipeMix | null
  options: Record<string, RecipeOptionValue>
  inputs: Record<string, RecipeInputSource>
  capCredits: number | null
  /** null: the channel's checkpoints. */
  checkpoints: RecipeCheckpoint[] | null
  bricks: RecipeBrickEntry[]
}

/** One choice of an option, as the editor shows it. */
export interface OptionChoiceInfo {
  value: string | boolean
  labelKey: string
  /** Not built yet: the chantier that brings it. */
  soon: string | null
}

/** An option a base pipeline declares (switch, choice or slider), as the editor shows it. */
export interface OptionInfo {
  id: string
  labelKey: string
  subject: string
  kind: 'switch' | 'choice' | 'slider'
  default: RecipeOptionValue
  choices: OptionChoiceInfo[]
  slider: { min: number; max: number; step: number } | null
  /** The whole option is not built yet: the chantier that brings it. */
  soon: string | null
}

/** A base pipeline (« pipeline de base »): its document, tied to no channel, and its options. */
export interface BasePipelineInfo {
  /** `avatar@1`. */
  id: string
  labelKey: string
  doc: RecipeDocument
  options: OptionInfo[]
  /** The team's pipelines made from it. */
  copies: number
  /** Long format or short. */
  form: PipelineForm
  /** Its pipeline code (`7K2Q-9XPM`, production-lab): the fingerprint of its document. */
  code: string
}

/** A brick's engine, fallbacks and style as a project pins them (exact style version). */
export interface BrickPinView {
  tech: string
  engine: string | null
  fallbacks: string[]
  fallbackScope: 'video' | 'item' | null
  /** `name@version`, or null. */
  style: string | null
}

/** One setting of a technology, as the editor shows it. */
export interface TechField {
  key: string
  type: 'number' | 'integer' | 'string' | 'boolean' | 'enum' | 'list'
  options?: string[]
  min?: number
  max?: number
  /** The default (absent: unset means « the channel style decides »). */
  default?: unknown
  /** A recipe may set it. */
  recipe: boolean
  /** A channel may set it. */
  channel: boolean
}

/** A technology of the code registry, as the panel and the editor show it. */
export interface TechnologyInfo {
  /** `name@version`. */
  id: string
  name: string
  version: number
  /** `tech.<name>`; `<key>.blurb` is its one-line description. */
  labelKey: string
  stage: RecipeStage
  kind: string
  /** Engine node types it runs. */
  nodeTypes: string[]
  fields: TechField[]
  /** Pipeline inputs it asks for. */
  inputs: { id: string; label: string; required: boolean }[]
  cloudUsages: string[]
  agentTools: string[]
  access: 'everyone' | 'plan' | 'admin' | 'beta'
  status: 'draft' | 'validated'
  /** The engine family it runs on (null: local code, no engine to choose). */
  engineFamily: EngineFamily | null
  /** The style family it wears (null: none). */
  styleFamily: StyleFamily | null
  /** A newer version of the same technology exists. */
  superseded: boolean
}

export interface RecipeIssueView {
  code: string
  path: (string | number)[]
  message: string
}

export interface RecipeSummary {
  id: number
  name: string
  videoType: RecipeVideoType
  /** Latest version number. */
  version: number
  bricks: number
  /** Channels that use it, with the video type. */
  channels: { channelId: number; videoType: RecipeVideoType }[]
  archived: boolean
  updatedAt: string
  /** The base pipeline it came from (`avatar@1`), or null. */
  base: string | null
  /** Long format or short. */
  form: PipelineForm
  /** The length of its videos, minutes. */
  minutes: number
  /** The stages its bricks cover, in order (the small progress graph of its card). */
  stages: RecipeStage[]
  /** The pipeline code of its latest version (`7K2Q-9XPM`, production-lab). */
  code: string
}

export interface RecipeDetail extends RecipeSummary {
  /** The document of the version asked for (default: the latest). */
  doc: RecipeDocument
  docVersion: number
  versions: { number: number; note: string; createdAt: string }[]
}

/** A recipe compiled for a channel (or none): what the run would execute, or why it cannot. */
export interface RecipeCompiled {
  ok: boolean
  errors: RecipeIssueView[]
  /** Node ids and types, in pipeline order, with their gate. */
  nodes: { id: string; type: string; gate: string; params: Record<string, unknown> }[]
  checkpoints: RecipeCheckpoint[]
  /** Per brick: engine, fallbacks and style (after the options). */
  pins: Record<string, BrickPinView>
  /** Values the recipe set itself that a moved option replaced (solidite: shown, never silent). */
  overrides: RecipeOverrideView[]
}

/** An option that replaced a value of the recipe, e.g. « clipShare » turned `mix.clipAi` 0.4 into 0.21. */
export interface RecipeOverrideView {
  option: string
  path: string
  from: number
  to: number
}

export interface RecipeSaveInput {
  /** Absent: a new recipe. Present: a new version of it. */
  id?: number
  doc: RecipeDocument
  note?: string
}

export interface ChannelProductionView {
  channelId: number
  /** Settings per technology name (`voice.tts` → `{ voice: … }`). */
  technologies: Record<string, Record<string, unknown>>
  /** What runs stop for. */
  checkpoints: RecipeCheckpoint[]
  /** The checkpoints are the default ones (topic + thumbnail), not set by the channel. */
  defaultCheckpoints: boolean
  /** The recipe used per video type. */
  recipes: Partial<Record<RecipeVideoType, number>>
}

export interface ChannelProductionInput {
  technologies?: Record<string, Record<string, unknown>>
  /** null: back to the default. */
  checkpoints?: RecipeCheckpoint[] | null
}

/** Per-video adjustments: settings per technology name, and the length. */
export interface ProjectAdjustmentsView {
  technologies?: Record<string, Record<string, unknown>>
  minutes?: number
}

export interface ProjectSummary {
  id: number
  title: string
  recipeId: number
  recipeName: string
  recipeVersion: number
  channelId: number | null
  /** The run that made it (null: not launched). */
  runId: number | null
  runStatus: string | null
  videoId: number | null
  createdAt: string
  updatedAt: string
}

export interface ProjectDetail extends ProjectSummary {
  idea: string
  inputs: Record<string, string>
  adjustments: ProjectAdjustmentsView
  /** The engines and exact style versions pinned when the project was created (R5.7). */
  pins: Record<string, BrickPinView>
}

export interface ProjectCreateInput {
  recipeId: number
  /** Absent: the latest version (it is pinned from then on). */
  recipeVersion?: number
  channelId: number | null
  title: string
  /** The idea: the topic or brief the research starts from (may be empty with a `script` input: the title stands for it). */
  idea: string
  /** Pipeline inputs; `script` = the owner's script (« J'ai mon script »), for a pipeline whose Script option is « import ». */
  inputs?: Record<string, string>
  adjustments?: ProjectAdjustmentsView
  /** The video it fills (a planner's slot of the same channel); absent: launching it makes a new video. */
  videoId?: number
}

export interface ProjectUpdateInput {
  title?: string
  idea?: string
  inputs?: Record<string, string>
  adjustments?: ProjectAdjustmentsView
}
