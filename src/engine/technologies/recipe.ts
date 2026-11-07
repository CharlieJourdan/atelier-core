// The recipe document (« pipeline » in the UI, decisions 0011 and 0022). Version 2, `atelier.recette/2`, is what is saved:
// for ONE video type, the ordered bricks (technology `id@version` + settings, plus the engine, its fallbacks and the style
// of each), the base pipeline it came from, the language, the mix and its curve, the chosen options, the inputs with their
// source, the format, a per-video credit cap and the checkpoints. Version 1 documents (production-2) load as version 2
// with defaults (`upgradeRecipe`). A saved version is immutable; the same document is the `.atelier-recette.json` file a
// pipeline is shared as. The schema checks the shape; `checkRecipe` (compile.ts) checks it against the registry.
import { z } from 'zod'
import { STYLE_REF } from '../../shared/brick-styles'
import { ENGINE_ID } from '../../shared/cloud-engines'
import { MixSchema, type Mix } from './mix'

export const RECIPE_SCHEMA = 'atelier.recette/2'
export const RECIPE_SCHEMA_V1 = 'atelier.recette/1'

/** Where a run may stop for the owner (decision 0011). Default: the topic and the thumbnail. */
export const CHECKPOINTS = ['topic', 'script', 'voice', 'director', 'visuals', 'avatar', 'final', 'thumbnail'] as const
export type Checkpoint = (typeof CHECKPOINTS)[number]
export const DEFAULT_CHECKPOINTS: readonly Checkpoint[] = ['topic', 'thumbnail']

/** The common video types a recipe serves (a channel picks one recipe per type it makes). */
export const VIDEO_TYPES = ['avatar-long', 'documentaire', 'short', 'autre'] as const
export type VideoType = (typeof VIDEO_TYPES)[number]

/** Where a pipeline input comes from (R6.8): asked per video, read from the channel's assets, or fixed in the pipeline. */
export const INPUT_SOURCES = ['project', 'channel'] as const

export const TECH_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*@[1-9][0-9]*$/
const SETTING_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const OPTION_ID = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/
const INPUT_ID = /^[a-z][A-Za-z0-9_]{0,39}$/

export const CheckpointsSchema = z.array(z.enum(CHECKPOINTS)).max(CHECKPOINTS.length).refine((a) => new Set(a).size === a.length, 'a checkpoint is listed twice')

const settings = z.record(z.string().regex(SETTING_KEY), z.unknown()).default({})
const format = z.strictObject({
  aspect: z.enum(['16:9', '9:16']).default('16:9'),
  /** Same bounds as a run (0.5 to 30 minutes). */
  minutes: z.number().min(0.5).max(30)
})
const capCredits = z.number().int().min(0).max(1_000_000).nullable().default(null)

// ------------------------------------------------------------------------------------------------ version 1 (load only)

export const RecipeBrickSchemaV1 = z.strictObject({ tech: z.string().regex(TECH_ID), settings })

export const RecipeSchemaV1 = z.strictObject({
  $schema: z.literal(RECIPE_SCHEMA_V1),
  name: z.string().trim().min(1).max(120),
  videoType: z.enum(VIDEO_TYPES),
  format,
  capCredits,
  checkpoints: CheckpointsSchema.nullable().default(null),
  bricks: z.array(RecipeBrickSchemaV1).min(1).max(40)
})
export type RecipeDocV1 = z.infer<typeof RecipeSchemaV1>

// ------------------------------------------------------------------------------------------------ version 2

export const RecipeBrickSchema = z.strictObject({
  tech: z.string().regex(TECH_ID),
  settings,
  /** The engine of the brick's family (`presenter:hedra-c3`); null: the option or the Cloud's default decides. */
  engine: z.string().regex(ENGINE_ID).nullable().default(null),
  /** Compatible engines tried in order (R3.3); for a voice or a presenter, for the whole video (R3.4). */
  fallbacks: z.array(z.string().regex(ENGINE_ID)).max(6).default([]),
  /** A style of the brick's style family, `name` or `name@version`; null: the channel's or the base pipeline's. */
  style: z.string().regex(STYLE_REF).nullable().default(null)
})

export const InputSourceSchema = z.union([z.enum(INPUT_SOURCES), z.strictObject({ fixed: z.string().trim().min(1).max(500) })])
export type InputSource = z.infer<typeof InputSourceSchema>

export const OptionValueSchema = z.union([z.string().min(1).max(60), z.number(), z.boolean()])
export type OptionValue = z.infer<typeof OptionValueSchema>

export const RecipeSchema = z.strictObject({
  $schema: z.literal(RECIPE_SCHEMA),
  name: z.string().trim().min(1).max(120),
  /** The base pipeline it was made from (`avatar@1`); null: built by hand, or a base pipeline itself. */
  base: z.string().regex(TECH_ID).nullable().default(null),
  videoType: z.enum(VIDEO_TYPES),
  format,
  /** null: the project's or the channel's language. */
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).nullable().default(null),
  /** Screen-time shares and their curve (R6.1, R6.2); null: the director and the channel's profile decide. */
  mix: MixSchema.nullable().default(null),
  /** The chosen value of each option the base pipeline declares (absent: its default). */
  options: z.record(z.string().regex(OPTION_ID).max(60), OptionValueSchema).default({}),
  /** What a run needs and where it comes from (R6.8). */
  inputs: z.record(z.string().regex(INPUT_ID), InputSourceSchema).default({}),
  /** Credits one video may spend at most (null: no cap of its own). */
  capCredits,
  /** null: the channel's checkpoints (decision 0011: set per channel, overridable per recipe). */
  checkpoints: CheckpointsSchema.nullable().default(null),
  bricks: z.array(RecipeBrickSchema).min(1).max(40)
})

export type RecipeDoc = z.infer<typeof RecipeSchema>
export type RecipeBrick = z.infer<typeof RecipeBrickSchema>

/**
 * The mix a version 1 recipe implied through its director's settings: the share of generated video and of stock among
 * the pictures (no presenter share was ever set, so the presenter is not in it). null unless the director set both: a
 * share it left open stays the channel profile's (the mix would otherwise force it to 0).
 */
export function mixFromV1(doc: RecipeDocV1): Mix | null {
  const director = doc.bricks.find((b) => b.tech.startsWith('director.plan@'))?.settings ?? {}
  const video = typeof director.videoShare === 'number' ? director.videoShare : undefined
  const stock = typeof director.stockShare === 'number' ? director.stockShare : undefined
  if (video === undefined || stock === undefined) return null
  const v = video
  const s = stock
  const r = (x: number): number => Math.round(x * 10_000) / 10_000
  const shares = { clipAi: r(v), stock: r((1 - v) * s), imageAi: r((1 - v) * (1 - s)) }
  const parsed = MixSchema.safeParse({ ...Object.fromEntries(Object.entries(shares).filter(([, x]) => x > 0)), curve: 'flat' })
  return parsed.success ? parsed.data : null
}

/** A version 1 document as version 2: no base, no options, inputs from the project, engines and styles left open. */
export function upgradeRecipe(doc: RecipeDocV1): RecipeDoc {
  return {
    $schema: RECIPE_SCHEMA,
    name: doc.name,
    base: null,
    videoType: doc.videoType,
    format: doc.format,
    language: null,
    mix: mixFromV1(doc),
    options: {},
    inputs: {},
    capCredits: doc.capCredits,
    checkpoints: doc.checkpoints,
    bricks: doc.bricks.map((b) => ({ tech: b.tech, settings: b.settings, engine: null, fallbacks: [], style: null }))
  }
}

/** What does not grow with the length of a video (reading the support videos, thumbnails, the writing): a cap never falls below it. */
export const CAP_FIXED_CREDITS = 150

/**
 * The cap of a project of `minutes` from its pipeline's cap, which is set for the pipeline's own length (`format.minutes`): a
 * longer or shorter video gets it pro rata, so a cap that fits a 12-minute video neither refuses a 3-minute one nor lets a
 * 30-minute one through unchecked. A cap below `CAP_FIXED_CREDITS` is kept as it is; no cap stays no cap (the caller's null).
 */
export function capForMinutes(cap: number, formatMinutes: number, minutes: number): number {
  if (!(formatMinutes > 0) || minutes === formatMinutes) return cap
  return Math.max(Math.round((cap * minutes) / formatMinutes), Math.min(cap, CAP_FIXED_CREDITS))
}

/** Parses a recipe document of any version into version 2 (what loading a stored version or a file does). */
export function parseRecipe(doc: unknown): { success: true; data: RecipeDoc } | { success: false; error: z.ZodError } {
  const isV1 = typeof doc === 'object' && doc !== null && (doc as { $schema?: unknown }).$schema === RECIPE_SCHEMA_V1
  if (isV1) {
    const v1 = RecipeSchemaV1.safeParse(doc)
    return v1.success ? { success: true, data: upgradeRecipe(v1.data) } : { success: false, error: v1.error }
  }
  const v2 = RecipeSchema.safeParse(doc)
  return v2.success ? { success: true, data: v2.data } : { success: false, error: v2.error }
}
