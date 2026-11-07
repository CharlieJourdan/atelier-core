// P3 — the feasibility map (spec §2 P3): for each element of the style, the brick that makes it, or a human input (an
// import slot), or « impossible » (missing technology, with the cost to build or import it). The reproducible share is
// computed from the MEASURED screen time of each element. Not reproducible → a visible alert and alternatives that stay
// faithful to THAT channel (topic, tone, structure, palette), never another channel's template.
import { z } from 'zod'
import { Evidence, MeasuredNumber, MediaOriginSchema, head } from './common'

export const FEASIBILITY_HOWS = ['brick', 'human-input', 'impossible'] as const
export const FEASIBILITY_VERDICTS = ['reproducible', 'reproducible-with-human-inputs', 'partly', 'not-reproducible'] as const
export type FeasibilityVerdict = (typeof FEASIBILITY_VERDICTS)[number]
export const SLOT_KINDS = ['presenter-footage', 'presenter-avatar', 'voice', 'footage', 'other'] as const

/** Shares (of measured screen time) at or above which each verdict is given. */
export const VERDICT_THRESHOLDS = { reproducible: 0.9, withHumanInputs: 0.9, partly: 0.5 } as const

export const FeasibilityElement = z.object({
  id: z.string().min(1),
  axis: z.string().min(1),
  description: z.string().min(1),
  /** Share (0..1) of the reference's screen time this element fills, measured. */
  screenShare: MeasuredNumber,
  how: z.enum(FEASIBILITY_HOWS),
  /** The engine node that makes it (how = brick). */
  brick: z.string().nullable(),
  /** The import slot (how = human-input). `userSupplies`: the brief says the user can supply it now (else a placeholder). */
  slot: z.object({ kind: z.enum(SLOT_KINDS), what: z.string().min(1), userSupplies: z.boolean().optional() }).nullable(),
  /** The missing technology (how = impossible). */
  missing: z.object({ technology: z.string().min(1), buildCostUsd: z.number().min(0).nullable(), importCostUsd: z.number().min(0).nullable(), note: z.string() }).nullable(),
  /** The media origin of the shots it covers (the cross-check against the analyses' origin shares uses it). */
  origin: MediaOriginSchema.optional(),
  /** The shot kinds it covers (archive-film, map, presenter…). */
  kinds: z.array(z.string()).optional()
})
export type FeasibilityElement = z.infer<typeof FeasibilityElement>

/** One line of the recipe (chantier rea-video, decision 0110): a production method (how the picture, a layer or the sound was
 *  made), its measured share, how Atelier remakes it and its route (brick, human input or impossible, as P3's elements). */
export const HowMadeRow = z.object({
  method: z.string().min(1),
  share: z.number().min(0).max(1),
  evidence: z.array(Evidence).min(1),
  remake: z.string().min(1),
  settings: z.array(z.string()),
  route: FeasibilityElement.pick({ how: true, brick: true, slot: true, missing: true })
})
export type HowMadeRow = z.infer<typeof HowMadeRow>

/** The channel's own universe, MEASURED on its analyses: what an alternative must keep. */
export const ChannelUniverse = z.object({
  /** The corpus titles (the channel's topics). */
  topics: z.array(z.string()),
  tone: z.string(),
  /** The most frequent outline (structure items in order). */
  structure: z.array(z.string()),
  palette: z.array(z.string()),
  fonts: z.array(z.string())
})
export type ChannelUniverse = z.infer<typeof ChannelUniverse>

/** An alternative when the clone cannot be fully done: keeps the reference's own universe, replaces only the impossible. */
export const FeasibilityAlternative = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  keeps: z.object({ topic: z.boolean(), tone: z.boolean(), structure: z.boolean(), palette: z.boolean() }),
  /** Element ids it replaces (only `impossible` ones). */
  replaces: z.array(z.string()).min(1),
  /** Another channel or base template it borrows its look from: must stay null. */
  borrowsLookFrom: z.string().nullable(),
  /** The colours it uses: must be the channel's own measured palette (checked against `Feasibility.universe`). */
  palette: z.array(z.string()).optional(),
  /** The bricks (engine nodes) that make the replacement, or a human input. */
  uses: z.array(z.string()).optional()
})
export type FeasibilityAlternative = z.infer<typeof FeasibilityAlternative>

export const Feasibility = z.object({
  ...head('feasibility'),
  elements: z.array(FeasibilityElement).min(1),
  /** Share made by bricks alone, and by bricks + human inputs (computed from screenShare). */
  brickShare: z.number().min(0).max(1),
  reproducibleShare: z.number().min(0).max(1),
  verdict: z.enum(FEASIBILITY_VERDICTS),
  /** The visible alert (required unless reproducible). */
  alert: z.string().nullable(),
  /** What can still be done (required when not reproducible or partly). */
  stillPossible: z.array(z.string()),
  alternatives: z.array(FeasibilityAlternative),
  /** The channel's measured universe (P3 writes it from the analyses). */
  universe: ChannelUniverse.optional(),
  /** Where an element's screen share disagrees with the analyses' origin shares or presenter presence (must be empty). */
  crossCheck: z.array(z.string()).optional(),
  /** The recipe: every production method measured on the corpus and how Atelier remakes it (absent on older artefacts). */
  howMade: z.array(HowMadeRow).optional()
})
export type Feasibility = z.infer<typeof Feasibility>

/** The shares and verdict the elements imply (pure; P3's exit check compares the artefact with it). */
export function feasibilityShares(elements: readonly FeasibilityElement[]): { brickShare: number; reproducibleShare: number; verdict: FeasibilityVerdict } {
  const total = elements.reduce((s, e) => s + e.screenShare.value, 0)
  const sum = (pred: (e: FeasibilityElement) => boolean): number => elements.filter(pred).reduce((s, e) => s + e.screenShare.value, 0)
  const brickShare = total > 0 ? sum((e) => e.how === 'brick') / total : 0
  const reproducibleShare = total > 0 ? sum((e) => e.how !== 'impossible') / total : 0
  const verdict: FeasibilityVerdict =
    brickShare >= VERDICT_THRESHOLDS.reproducible ? 'reproducible'
      : reproducibleShare >= VERDICT_THRESHOLDS.withHumanInputs ? 'reproducible-with-human-inputs'
        : reproducibleShare >= VERDICT_THRESHOLDS.partly ? 'partly' : 'not-reproducible'
  return { brickShare: round3(brickShare), reproducibleShare: round3(reproducibleShare), verdict }
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000
