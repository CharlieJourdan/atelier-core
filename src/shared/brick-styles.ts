// Brick styles (decision 0021, docs/specs/production-model.md §4): the « carrosserie » of a brick family, versioned DATA
// (never code). A style is attached to a brick family (image, clip, presenter, director, script, edit), never to an
// engine: the same `phone-real@3` drives any image engine, the adapter translates what its model understands. Every
// save is a new immutable version; a project pins the versions it ran with. Exported and imported as one JSON file.
// The document is `atelier.brickstyle/1`: `atelier.style/1` already names the channel style sheet (`$style.x`,
// src/shared/analysis.ts), a different object (decision 0027).
import { z } from 'zod'

export const BRICK_STYLE_SCHEMA = 'atelier.brickstyle/1'

/** The brick families a style may dress. A technology declares the family it reads (`styleFamily`). */
export const STYLE_FAMILIES = ['image', 'clip', 'presenter', 'director', 'script', 'edit'] as const
export type StyleFamily = (typeof STYLE_FAMILIES)[number]

/** A style's name: lower-case words joined by `-` (`phone-real`). */
export const STYLE_NAME_PATTERN = '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'
/** `name` (the latest version, pinned when a project is created) or `name@version`. */
export const STYLE_REF_PATTERN = '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:@[1-9][0-9]*)?$'
export const STYLE_REF = new RegExp(STYLE_REF_PATTERN)

/** `phone-real@3` → { name: 'phone-real', version: 3 }; `phone-real` → version null. */
export function parseStyleRef(ref: string): { name: string; version: number | null } | null {
  if (!STYLE_REF.test(ref)) return null
  const at = ref.indexOf('@')
  return at < 0 ? { name: ref, version: null } : { name: ref.slice(0, at), version: Number(ref.slice(at + 1)) }
}

/** Who may appear in the pictures (R4.2). */
export const STYLE_PEOPLE = ['anyone', 'not-presenter', 'presenter-as-actor', 'nobody'] as const
export const STYLE_BRANDS = ['real', 'none'] as const
/** The editing look (family `edit`, production-9): where the chapter mark sits and how it looks (pipeline-avatar §2.12). */
export const CHAPTER_POSITIONS = ['top-right', 'top-left', 'lower-third', 'bottom-band'] as const
export const CHAPTER_LOOKS = ['pill', 'slab'] as const
/** When a reference image is attached to a generation. */
export const REFERENCE_USES = ['always', 'presenter-shots', 'room-shots', 'palette'] as const

const text = (max: number) => z.string().trim().min(1).max(max)

export const BrickStyleSchema = z.strictObject({
  $schema: z.literal(BRICK_STYLE_SCHEMA),
  /** The style's name (`phone-real`); the version is the store's, never written in the file. */
  id: z.string().regex(new RegExp(STYLE_NAME_PATTERN)).max(48),
  family: z.enum(STYLE_FAMILIES),
  /** The number of this version (1 for a new style); an imported file's own number is kept only as information. */
  version: z.number().int().min(1),
  label: text(80).optional(),
  /** How the director or the writer must think for this look (plain English, shown in the editor). */
  rules: text(4000).optional(),
  /** Appended to every generation prompt (look, lens, light, era, « no readable text »). */
  promptSuffix: text(1000).optional(),
  /** What must never appear. */
  negative: z.array(text(200)).max(40).optional(),
  /** Reference images: a stored asset id or a channel asset key (`presenter.portrait`), and when it is attached. */
  references: z.array(z.strictObject({ asset: text(200), use: z.enum(REFERENCE_USES), note: text(200).optional() })).max(12).optional(),
  people: z.enum(STYLE_PEOPLE).optional(),
  brands: z.enum(STYLE_BRANDS).optional(),
  /** The kinds of pictures this look uses and how they alternate (shot sizes varied across neighbours). */
  shotGrammar: z.array(z.strictObject({ kind: text(60), share: z.number().min(0).max(1).optional(), note: text(300).optional() })).max(20).optional(),
  /** Optional grade or film texture (ENGINE-SPEC §28.1, §28.2). */
  postProcess: z.strictObject({ grade: text(60).optional(), texture: text(60).optional(), strength: z.number().min(0).max(1).optional() }).optional(),
  /** Validated prompt → result pairs (few-shot), added as the style is tuned. */
  examples: z.array(z.strictObject({ prompt: text(2000), result: text(500), note: text(300).optional() })).max(30).optional(),
  /** An editing style's chapter marks (family `edit`): position, look, a word before the number, the accent colour. */
  chapters: z
    .strictObject({
      position: z.enum(CHAPTER_POSITIONS).optional(),
      look: z.enum(CHAPTER_LOOKS).optional(),
      prefix: z.string().trim().max(20).optional(),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
    })
    .optional(),
  /** The channel's own strict rules, when the style is a channel's copy. */
  instructions: text(4000).optional()
})
export type BrickStyle = z.infer<typeof BrickStyleSchema>

/** One style as lists show it. */
export interface BrickStyleSummary {
  id: string
  family: StyleFamily
  label: string | null
  /** Latest version number. */
  version: number
  /** Shipped with the app (the founder's base styles). */
  builtin: boolean
  updatedAt: string
}

export interface BrickStyleDetail extends BrickStyleSummary {
  /** The document of the version asked for (default: the latest). */
  doc: BrickStyle
  docVersion: number
  versions: { number: number; note: string; createdAt: string }[]
}
