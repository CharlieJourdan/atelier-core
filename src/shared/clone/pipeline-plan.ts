// P5 — the pipeline plan (spec §2 P5): the bricks composed to execute a Style Definition, the import slots and the
// placeholders that fill them now so it runs end to end. Bricks may come from base pipelines; SETTINGS come only from the
// definition: each cites the field it was read from (`field`), checked by src/main/production/clone/plan-rules.ts.
import { z } from 'zod'
import { head } from './common'
import { SLOT_KINDS } from './feasibility'

export const PlanBrick = z.object({
  /** Engine node type (`voice.tts`, `director.plan`…) or a brick built for this clone. */
  node: z.string().min(1),
  /** The engine technology it compiles to, versioned (`script.write@2`); absent: the engine's latest version of `node`. */
  tech: z.string().min(1).optional(),
  /** The base pipeline it was taken from (only the brick, never its options), or null. */
  fromBase: z.string().nullable(),
  role: z.string().min(1)
})

export const PlanSetting = z.object({
  /** Option or setting key (`music`, `presenterLayouts`, `director.plan.layouts`…). */
  key: z.string().min(1),
  value: z.unknown(),
  /** Dotted paths of the Style Definition fields it is computed from. */
  fields: z.array(z.string().min(1)).min(1)
})
export type PlanSetting = z.infer<typeof PlanSetting>

export const PlanSlot = z.object({
  id: z.string().min(1),
  kind: z.enum(SLOT_KINDS),
  what: z.string().min(1),
  filledBy: z.enum(['placeholder', 'user', 'own-clone']),
  /** The provisional stand-in (a look-alike of the same type), clearly marked. */
  placeholder: z.object({ ref: z.string().min(1), description: z.string().min(1) }).nullable(),
  field: z.string().min(1)
})

export const MissingBrick = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  /** `to-build`: the plan cannot run until it exists; `built`: made in the engine for this kind of clone (reusable, decision 0099);
   *  `stand-in`: an impossible element (P3) stood in by an existing brick of the channel's own universe, said in the report. */
  status: z.enum(['to-build', 'built', 'stand-in']),
  /** The engine brick (and setting) that makes it now. */
  by: z.string().min(1).optional()
})

export const PipelinePlan = z.object({
  ...head('pipeline-plan'),
  definitionVersion: z.number().int().min(1),
  bricks: z.array(PlanBrick).min(1),
  settings: z.array(PlanSetting),
  slots: z.array(PlanSlot),
  missingBricks: z.array(MissingBrick),
  /** The compiled recipe document, when the assembler wires it to the engine. */
  recipe: z.unknown().nullable(),
  /** The ready base P4 started from (decision 0112) and what became of its pipeline's bricks: kept (the measurement needs
   *  them), added (the measurement needs them, the base lacks them), dropped (the base has them, nothing measured asks for
   *  them). Null when built from zero. */
  startedFrom: z.object({
    baseId: z.string().min(1),
    pipelineId: z.string().min(1),
    keptBricks: z.array(z.string()),
    addedBricks: z.array(z.string()),
    droppedBricks: z.array(z.string())
  }).nullable().optional(),
  /** Bricks a measured element (P3) names that the plan leaves out, each with why (never dropped silently). */
  leftOut: z.array(z.object({ brick: z.string().min(1), element: z.string().min(1), why: z.string().min(1) })).optional()
})
export type PipelinePlan = z.infer<typeof PipelinePlan>
