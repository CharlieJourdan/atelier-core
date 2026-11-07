// The `atelier.pipeline/1` document format (docs/ENGINE-SPEC.md §5): a zod schema for the app, and the same schema
// published as JSON Schema for the Builder (`resources/schemas/atelier.pipeline-1.json`, kept equal to this file by
// tests/unit/engine-schema.test.ts; regenerate it with `npm run schemas`). The schema checks the document's shape
// only; graph rules (references, types, cycles…) are checked by `validatePipeline` (validate.ts).
import { z } from 'zod'
import { ASPECTS } from './formats/timing'
import { BUDGET_MODES, EXECUTORS, GATES, INPUT_KINDS, PIPELINE_SCHEMA } from './types'

/** Node and pipeline-input ids: a letter first, then letters, digits, `_` or `-` (never a `.`, which splits refs). */
export const ID_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
/** `name@version`, e.g. `voice.tts@1` (spec R2.1). */
export const NODE_TYPE_PATTERN = '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*@[1-9][0-9]*$'
/** `node.output`, `$inputs.x` or `$style.x` (spec R5.1). */
export const REF_PATTERN = '^(?:\\$inputs|\\$style|[A-Za-z][A-Za-z0-9_-]{0,63})\\.[A-Za-z][A-Za-z0-9_]{0,63}$'
/** A param value that is a reference: only `$style.x` and `$inputs.x` (decision, P2; outputs are wired via `in`). */
export const PARAM_REF_PATTERN = '^\\$(?:inputs|style)\\.[A-Za-z][A-Za-z0-9_]{0,63}$'
const PORT_PATTERN = '^[A-Za-z][A-Za-z0-9_]{0,63}$'

const id = z.string().regex(new RegExp(ID_PATTERN))
const ref = z.string().regex(new RegExp(REF_PATTERN))
const params = z.record(z.string().regex(new RegExp(PORT_PATTERN)), z.unknown())

export const PipelineInputSchema = z.strictObject({
  id,
  kind: z.enum(INPUT_KINDS),
  required: z.boolean().optional(),
  suggested: z.boolean().optional(),
  label: z.string().min(1).max(200),
  help: z.string().max(2000).optional()
})

export const PipelineNodeSchema = z.strictObject({
  id,
  type: z.string().regex(new RegExp(NODE_TYPE_PATTERN)),
  in: z.record(z.string().regex(new RegExp(PORT_PATTERN)), ref).optional(),
  params: params.optional(),
  gate: z.enum(GATES).optional(),
  where: z.enum([...EXECUTORS, 'auto']).optional(),
  modes: z
    .strictObject({ qualite_max: params.optional(), usage_max: params.optional() })
    .optional()
})

export const PipelineSchema = z
  .strictObject({
    $schema: z.literal(PIPELINE_SCHEMA),
    id,
    version: z.number().int().min(1),
    name: z.string().min(1).max(200),
    format: z.strictObject({
      kind: z.enum(['youtube_long', 'youtube_short']),
      /** The picture's shape: 1920×1080 (16:9, default) or 1080×1920 (9:16, a short). Nodes that draw it carry the same `aspect` param. */
      aspect: z.enum(ASPECTS).default('16:9'),
      minutes: z.strictObject({
        default: z.number().positive().max(600),
        min: z.number().positive().max(600),
        max: z.number().positive().max(600)
      })
    }),
    style: z
      .string()
      .regex(/^style:[A-Za-z0-9_-]+@[1-9][0-9]*$/)
      .optional(),
    inputs: z.array(PipelineInputSchema),
    budget: z.strictObject({
      default: z.enum(BUDGET_MODES),
      capCredits: z.number().nonnegative().optional()
    }),
    nodes: z.array(PipelineNodeSchema).min(1)
  })
  .superRefine((p, ctx) => {
    const m = p.format.minutes
    if (!(m.min <= m.default && m.default <= m.max)) {
      ctx.addIssue({ code: 'custom', path: ['format', 'minutes'], message: 'min <= default <= max' })
    }
    if (p.format.kind === 'youtube_short' && p.format.aspect !== '9:16') {
      ctx.addIssue({ code: 'custom', path: ['format', 'aspect'], message: 'a youtube_short is 9:16' })
    }
  })

export type Pipeline = z.infer<typeof PipelineSchema>
export type PipelineNode = z.infer<typeof PipelineNodeSchema>
export type PipelineInput = z.infer<typeof PipelineInputSchema>

/** The published JSON Schema of `atelier.pipeline/1` (draft 2020-12), generated from the zod schema above. */
export function pipelineJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(PipelineSchema, { target: 'draft-2020-12' }) as Record<string, unknown>
  return {
    ...schema,
    $id: 'urn:atelier:schema:atelier.pipeline-1',
    title: 'atelier.pipeline/1',
    description:
      'An Atelier production pipeline: typed nodes wired into a graph without cycles. Shape only; references, ' +
      'types, cycles and node params are checked by the app (docs/ENGINE-SPEC.md §5).'
  }
}
