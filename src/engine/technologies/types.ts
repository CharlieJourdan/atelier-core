// The technology manifest (decision 0010): a technology is a brick written in code that wraps one or more engine nodes
// (docs/ENGINE-SPEC.md §2) for one stage of a recipe (decision 0011). Its manifest says what it is (`id@version`, a French
// label key, its stage and kind), which nodes it runs and how they are wired, its settings (zod, with defaults) and which
// of them a recipe or a channel may override, the Cloud usages it spends, the agent tools it exposes, who may use it and
// whether it is validated. The registry (registry.ts) is generated from these manifests; the compiler (compile.ts) turns a
// recipe of technologies into an `atelier.pipeline/1` document. Engine-pure: no electron, no I/O.
import type { z } from 'zod'
import type { BrickStyle, StyleFamily } from '../../shared/brick-styles'
import type { EngineFamily } from '../../shared/cloud-engines'
import type { PipelineInput } from '../pipeline-schema'
import type { NodeTypeId } from '../types'
import type { Mix } from './mix'

/** The stages every recipe follows, in order (decision 0011). Bricks of one stage are interchangeable. */
export const STAGES = ['idee', 'script', 'voix', 'realisateur', 'elements', 'montage', 'controle'] as const
export type Stage = (typeof STAGES)[number]

/** What a technology is, for the panel and the agents (one stage may hold several kinds). */
export const TECH_KINDS = [
  'research',
  'script',
  'translate',
  'voice',
  'director',
  'visuals',
  'avatar',
  'motion',
  'background',
  'card',
  'captions',
  'music',
  'render',
  'qc',
  'thumbnail',
  'package',
  'idea',
  'sponsor',
  'factcheck',
  'chapters',
  'timing',
  'editing'
] as const
export type TechKind = (typeof TECH_KINDS)[number]

/**
 * The named results one brick hands to the next ones. A technology's node reads a slot with `@slot` (required) or
 * `@slot?` (wired only when an earlier brick provides it) and declares the slots it provides; a later brick that provides
 * the same slot replaces it from then on (a translation replaces the script).
 */
export const SLOTS = [
  'brief',
  'support',
  'script',
  'outline',
  'voice',
  'words',
  'beats',
  'plan',
  'genlist',
  'images',
  'clips',
  'avatar',
  'motion',
  'background',
  'graphics',
  'music',
  'subs',
  'chapters',
  'sponsor',
  'video',
  'qc',
  'thumbnails',
  'package'
] as const
export type Slot = (typeof SLOTS)[number]

/** Who may use a technology. */
export const TECH_ACCESS = ['everyone', 'plan', 'admin', 'beta'] as const
export type TechAccess = (typeof TECH_ACCESS)[number]

export const TECH_STATUSES = ['draft', 'validated'] as const
export type TechStatus = (typeof TECH_STATUSES)[number]

/** `name@version` with an integer version, like node types (R2.1): `voice.tts@1`. */
export type TechnologyId = `${string}@${number}`

/** One engine node a technology runs. Its id becomes the pipeline node id (unique inside a recipe). */
export interface TechNode {
  id: string
  type: NodeTypeId
  /** Input port → `@slot`, `@slot?`, `$inputs.x`, `$style.x` or `<node of this technology>.<output>`. */
  in: Record<string, string>
}

/** What the compiler tells a technology about the video being made. */
export interface CompileCtx {
  /** The picture's shape (decision: a short is 9:16). */
  aspect: '16:9' | '9:16'
  short: boolean
  minutes: number
  /** The pipeline's mix (decision 0022), for the bricks that follow it beyond their settings (the director's curve). */
  mix?: Mix
}

/** A technology's settings: plain values (never references), validated by its zod schema. */
export type Settings = Record<string, unknown>

export interface TechnologyManifest<P extends Settings = Settings> {
  id: TechnologyId
  /** Key of its French label in `src/shared/fr-*.ts` (`tech.<name>`); `<key>.blurb` holds its one-line description. */
  labelKey: string
  stage: Stage
  kind: TechKind
  nodes: readonly TechNode[]
  /** Slot → `<node>.<output>` of this technology. */
  provides: Partial<Record<Slot, string>>
  /** Pipeline inputs it asks for (merged by id across the recipe). */
  inputs?: readonly PipelineInput[]
  /** Its settings, with every default applied by `parse` (`z.object`). */
  params: z.ZodType<P>
  /** The settings a recipe may set, and those a channel may set (a project may adjust either). */
  overridable: { recipe: readonly (keyof P & string)[]; channel: readonly (keyof P & string)[] }
  /** The settings mapped to its nodes' params (node id → params; values may be `$style.x` / `$inputs.x`). */
  nodeParams(p: P, ctx: CompileCtx): Record<string, Record<string, unknown>>
  /**
   * What it adds to the node that provides a slot of an EARLIER brick: params, and inputs wired like `TechNode.in`
   * (an avatar asks the director for presenter shots).
   */
  contributes?(p: P, ctx: CompileCtx): Partial<Record<Slot, { params?: Record<string, unknown>; in?: Record<string, string> }>>
  /**
   * The engine family it runs on (decision 0021): a recipe may pick an engine of that family for this brick, with
   * fallbacks of the same family. Absent: the brick runs local code only (no engine to choose).
   */
  engineFamily?: EngineFamily
  /** The style family it reads (decision 0021): a recipe may dress this brick with a style of that family. */
  styleFamily?: StyleFamily
  /**
   * The settings the pipeline's mix implies for this brick (decision 0022), applied as the recipe layer under the
   * brick's own recipe settings (an explicit setting wins). Only settings the recipe may set.
   */
  fromMix?(mix: Mix, ctx: CompileCtx): Partial<P>
  /**
   * What its nodes take from its pin (decision 0027 §4): the engine the pipeline picked and its fallbacks, as node params
   * (node id → params). Absent: the pin changes the quote only. Called only when the recipe names an engine.
   */
  pinParams?(pin: { engine: string; fallbacks: readonly string[] }): Record<string, Record<string, unknown>>
  /**
   * What its nodes take from its style (decision 0035): the look a generation reads (suffix, negatives, people, brands…), as
   * node params. Called only when the recipe dresses the brick and the compiler was given that style's document.
   */
  styleParams?(style: BrickStyle): Record<string, Record<string, unknown>>
  /**
   * True: the owner checks what this brick provides before the run goes on (an owner gate on the node of each slot it
   * provides), whatever the checkpoints say. The script brick sets it from its `review` setting (option « Script »).
   */
  ownerGate?(p: P): boolean
  /** Atelier Cloud usages it spends (`synthesize`, `talkingAvatar`…), hence its price lines (decision 0003). */
  cloudUsages: readonly string[]
  /** Agent tool ids it exposes (`src/main/orchestra/technologies.ts`). */
  agentTools: readonly string[]
  access: TechAccess
  status: TechStatus
}

/** A manifest with its settings type erased (the registry checks settings with the manifest's own schema). */
export type AnyTechnology = TechnologyManifest<Settings>

/** Keeps `P` checked while writing a manifest, then erases it for the registry (like `defineNode`). */
export const defineTechnology = <P extends Settings>(m: TechnologyManifest<P>): AnyTechnology => m as unknown as AnyTechnology

/** `voice.tts@1` → `voice.tts` (channel and project settings are keyed by name, so they survive a new version). */
export const techName = (id: string): string => id.replace(/@\d+$/, '')
