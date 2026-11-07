// P2 (end) — the cross-video synthesis (spec §2 P2): what is constant across the corpus (the style) vs what varies (per
// topic), with frequencies. A constant names the Style Definition field it feeds (`field`, a dotted path of
// style-definition.ts): that link is how P4 is refused when it marks a measured field `default`.
import { z } from 'zod'
import { Evidence, head } from './common'

/** A trait seen in at least this share of the corpus is a constant of the style. */
export const CONSTANT_MIN_FREQUENCY = 0.6

export const SynthesisConstant = z.object({
  /** The Style Definition field it measures (`script.wordsPerMinute`, `presenter.angleCount`…). */
  field: z.string().min(1),
  value: z.unknown(),
  frequency: z.number().min(CONSTANT_MIN_FREQUENCY).max(1),
  videos: z.array(z.string()).min(1),
  evidence: z.array(Evidence).min(1)
})
export type SynthesisConstant = z.infer<typeof SynthesisConstant>

export const SynthesisVariation = z.object({
  field: z.string().nullable(),
  description: z.string().min(1),
  values: z.array(z.object({ value: z.unknown(), frequency: z.number().min(0).max(1), videos: z.array(z.string()) })).min(1)
})

export const Synthesis = z.object({
  ...head('synthesis'),
  videoCount: z.number().int().min(1),
  /** Distinct styles found in the corpus; several → the brief must name the one to clone. */
  styles: z.array(z.object({ id: z.string(), description: z.string(), videos: z.array(z.string()).min(1) })).min(1),
  chosenStyle: z.string().nullable(),
  constants: z.array(SynthesisConstant),
  variations: z.array(SynthesisVariation)
})
export type Synthesis = z.infer<typeof Synthesis>
