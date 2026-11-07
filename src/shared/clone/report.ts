// P9–P10 — the full example and the report to the user (spec §2 P9–P10): the verdict; the example (only when the blind
// judge said « same channel »); side-by-side frames; what he must supply and what stands in meanwhile; measured cost per
// minute and making time; proposals. A not-reproducible clone reports the alert and alternatives instead.
import { z } from 'zod'
import { head } from './common'
import { FEASIBILITY_VERDICTS, FeasibilityAlternative } from './feasibility'
import { AxisScore, BlindKey, BlindVerdict, Defect, FramePair, MIN_FRAME_PAIRS } from './round'

export const Example = z.object({
  ...head('example'),
  definitionVersion: z.number().int().min(1),
  videoPath: z.string().min(1),
  durationS: z.number().positive(),
  costUsd: z.number().min(0),
  makeSeconds: z.number().min(0),
  review: z.array(Defect),
  pairs: z.array(FramePair).min(MIN_FRAME_PAIRS),
  blindKey: BlindKey,
  verdict: BlindVerdict,
  /** The side-by-side film of the example, when it could be made. */
  sideBySideVideo: z.string().optional()
})
export type Example = z.infer<typeof Example>

/** How an ingredient the user must supply can be provided (Charlie's rule: import mine / the agent finds / generated / clone mine). */
export const INGREDIENT_OPTIONS = ['import', 'find', 'generate', 'clone'] as const
export type IngredientOption = (typeof INGREDIENT_OPTIONS)[number]

export const REPORT_OUTCOMES = ['cloned', 'not-reproducible', 'stopped-budget', 'example-refused'] as const

export const Report = z.object({
  ...head('report'),
  outcome: z.enum(REPORT_OUTCOMES),
  verdict: z.enum(FEASIBILITY_VERDICTS),
  reproducibleShare: z.number().min(0).max(1),
  alert: z.string().nullable(),
  alternatives: z.array(FeasibilityAlternative),
  /** The example shown (null when none passed the blind judge). */
  example: z.object({ videoPath: z.string().min(1), durationS: z.number().positive() }).nullable(),
  sideBySide: z.array(FramePair),
  humanInputs: z.array(z.object({ slot: z.string(), what: z.string(), placeholder: z.string().nullable() })),
  usdPerMinute: z.number().min(0).nullable(),
  makeMinutesPerMinute: z.number().min(0).nullable(),
  rounds: z.number().int().min(0),
  spentUsd: z.number().min(0),
  /** Title and look are copy keys (`clone.proposal.*`) or the channel-faithful text of an alternative; a null cost or time = not measured yet. */
  proposals: z.array(z.object({ title: z.string().min(1), previewPath: z.string().nullable(), usdPerMinute: z.number().min(0).nullable(), makeMinutesPerMinute: z.number().min(0).nullable(), look: z.string() })),
  /** Per ingredient: the realistic ways to provide it for this genre, and the one in use now. Fewer for his own channel. */
  ingredients: z.array(z.object({ slot: z.string(), what: z.string(), options: z.array(z.enum(INGREDIENT_OPTIONS)).min(1), current: z.enum(INGREDIENT_OPTIONS) })).default([]),
  /** The technologies (engine bricks) that make the clone, with the role each plays. */
  technologies: z.array(z.object({ node: z.string(), role: z.string() })).default([]),
  /** What Atelier cannot reproduce, each with its measured share of the screen time and what it would take. */
  cannot: z.array(z.object({ what: z.string(), share: z.number().min(0).max(1), technology: z.string(), buildCostUsd: z.number().min(0).nullable(), importCostUsd: z.number().min(0).nullable() })).default([]),
  /** The blind judge's score per axis for the example shown (empty when none), so the screen draws bars, not a bare %. */
  axisScores: z.array(AxisScore).default([]),
  /** Where the frames of `sideBySide` come from: the passed example, or the last round when the example was not shown. */
  framesFrom: z.enum(['example', 'last-round', 'none']).default('none'),
  /** The user-facing summary: a French copy key (`clone.report.*`, chantier E adds the strings) and its values. */
  summaryKey: z.enum(['clone.report.cloned', 'clone.report.not-reproducible', 'clone.report.stopped-budget', 'clone.report.example-refused']),
  summaryVars: z.record(z.string(), z.union([z.string(), z.number()]))
})
export type Report = z.infer<typeof Report>
