// `json.soundplan` (docs/ENGINE-SPEC.md §26): the proposal of the music bed. In lot P4 it holds the cue sheet and the
// ducking lifts; effects and designed silences arrive later. All times in seconds.
import { z } from 'zod'

export const REGISTERS = ['sparse', 'driven', 'dense'] as const
export const Register = z.enum(REGISTERS)
export type Register = z.infer<typeof Register>

export const SoundCue = z.object({
  trackId: z.string().min(1),
  mood: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
  /** Crossfade into this cue (0 for the first one: the global fade-in applies). */
  fadeIn: z.number().min(0),
  /** Crossfade out of this cue (0 for the last one: the global fade-out applies). */
  fadeOut: z.number().min(0)
})
export type SoundCue = z.infer<typeof SoundCue>

export const SoundPlan = z.object({
  register: Register,
  /** Bed level relative to the voice while it speaks, dB. */
  bedDb: z.number(),
  /** Lift of the bed in long voice gaps, dB. */
  liftDb: z.number().min(0),
  cues: z.array(SoundCue),
  ducking: z.object({
    attackS: z.number().min(0),
    releaseS: z.number().min(0),
    /** Voice gaps (≥ 1.5 s) where the bed lifts, already shortened by the look-ahead. */
    lifts: z.array(z.object({ start: z.number().min(0), end: z.number().min(0) }))
  }),
  fadeInS: z.number().min(0),
  fadeOutS: z.number().min(0),
  durationS: z.number().positive(),
  warnings: z.array(z.string())
})
export type SoundPlan = z.infer<typeof SoundPlan>
