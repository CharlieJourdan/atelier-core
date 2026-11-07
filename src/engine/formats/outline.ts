// `json.outline` (docs/ENGINE-SPEC.md §17 outputs): the beat plan a script was written from. Links to sentences are by
// **anchor** (the first ~8 words of the sentence), never by index, so an edit elsewhere does not break them.
import { z } from 'zod'
import { PromoText } from './promo'
import { Tag } from './timing'

export const SHAPES = ['chronicle', 'investigation', 'profile', 'explainer', 'countdown', 'versus', 'howto', 'essay'] as const
export const Shape = z.enum(SHAPES)
export type Shape = z.infer<typeof Shape>

export const OutlineBeat = z.object({
  index: z.number().int().min(0),
  /** What this beat does for the story (one line). */
  purpose: z.string().min(1),
  summary: z.string().min(1),
  wordBudget: z.number().int().min(1),
  tags: z.array(Tag),
  /** Anchor of the beat's first sentence (filled once the text exists). */
  anchor: z.string().default(''),
  /** Tags carried by one sentence (figure, citation, pivot, disclosure), by anchor (R17.10). */
  marks: z.array(z.object({ tag: Tag, anchor: z.string().min(1) })).default([])
})
export type OutlineBeat = z.infer<typeof OutlineBeat>

export const Chapter = z.object({
  title: z.string().min(1).max(60),
  firstBeat: z.number().int().min(0),
  anchor: z.string().default('')
})
export type Chapter = z.infer<typeof Chapter>

export const Outline = z.object({
  language: z.string().min(2),
  title: z.string().min(1),
  shape: Shape,
  kind: z.enum(['story', 'lesson']),
  promise: z.string().min(1),
  hook: z.string().min(1),
  beats: z.array(OutlineBeat).min(1),
  chapters: z.array(Chapter),
  /** Details planted early and where they pay off (R17.9). */
  planted: z.array(z.object({ detail: z.string().min(1), plantedBeat: z.number().int(), payoffBeat: z.number().int() })).default([]),
  /**
   * The sponsor's sentences (`script.sponsor`, pipeline-avatar §2.13): each mention with the anchors of every sentence it
   * holds, so the screen can anchor the sponsor slot on them. Absent: the script has no mention.
   */
  sponsor: z
    .array(z.object({ kind: z.enum(['mention', 'reminder']), text: z.string().min(1), anchors: z.array(z.string().min(1)).min(1), seconds: z.number().min(0), /** A promo's text written for this video (adapt / per-video modes). */ promo: PromoText.optional() }))
    .optional(),
  /** Tags whose sentence disappeared after an edit (dropped, listed). */
  dropped: z.array(z.string()).default([])
})
export type Outline = z.infer<typeof Outline>
