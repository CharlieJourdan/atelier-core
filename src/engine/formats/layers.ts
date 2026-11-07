// Timed layers over the film (production-9): what the editing bricks `edit.chapters` and `edit.sponsor` hand to the render, as the
// value of their `media.graphic[]` artefact. A layer is one of the artefact's files (a still with transparency, or a video), the
// seconds it stays, and where it goes: the whole frame (cover-cropped) or a box in pixels of the frame. `render.assemble` lays
// them in the order given, over the pictures-in-picture and under the captions (docs/ENGINE-SPEC.md §28.2 step 3).
import { z } from 'zod'

export const LAYER_ENTRIES = ['fade', 'pop', 'cut'] as const

export const Layer = z.object({
  /** Index of its file in the artefact. */
  file: z.number().int().min(0),
  /** What it is (for the logs and QC): `chapter`, `sponsor-card`, `sponsor-media`, `qr`, `promo`. */
  role: z.string().min(1).max(40),
  startS: z.number().min(0),
  endS: z.number().positive(),
  /** Absent: the whole frame, cover-cropped. Present: drawn at this size and place, unscaled when the file has that size. */
  box: z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int().positive(), h: z.number().int().positive() }).optional(),
  /** A video: it plays from `startS`; shorter than its slot, its last frame holds (never looped). */
  video: z.boolean().default(false),
  /** Seconds of the video file (a video layer). */
  durationS: z.number().positive().optional(),
  /** How it comes in: a fade, a « pop » (it grows from 60 % with a quick fade), or a plain cut. It always leaves with a fade. */
  enter: z.enum(LAYER_ENTRIES).default('fade'),
  fadeS: z.number().min(0).max(1).default(0.25)
})
export type Layer = z.infer<typeof Layer>

export const Layers = z.array(Layer)
