// What the "eyes" (Gemini through Atelier Cloud, usage `analyseVideo`) return for one video: hook, structure, pacing, shot
// types, on-screen text, music, calls to action. The Cloud validates the model's answer against this schema; the app reads the
// job's `result` with it to build the channel style profile (src/shared/style-profile.ts).
import { z } from 'zod'

export const SEGMENT_KINDS = ['hook', 'intro', 'body', 'transition', 'cta', 'outro'] as const
export const TEMPOS = ['slow', 'medium', 'fast'] as const

const Timed = z.object({ atS: z.number(), text: z.string() })

/** The pictures' look as the eyes name it (production-15; the likeness score compares families, src/engine/technologies/likeness.ts). */
export const PICTURE_LOOKS = ['photoreal', 'illustrated', 'stock', '3d', 'archive'] as const
export const CAPTION_KINDS = ['none', 'sentences', 'words', 'keywords'] as const
/** The pictures' light (grey overcast daylight, warm sunny daylight, studio light, a mix) and camera (held still, hand-held, moving). */
export const PICTURE_LIGHTS = ['overcast', 'warm', 'studio', 'mixed'] as const
export const PICTURE_CAMERAS = ['steady', 'handheld', 'moving'] as const
/** How the presenter is on screen: full frame, half of a split screen, a small inset over a picture. */
export const PRESENTER_LAYOUTS = ['full', 'split', 'inset'] as const

const share = z.number().min(0).max(1)

/**
 * The editing measures that reproduce a style (production-15): who is on screen and how long, the shot length, the look,
 * the text on screen, the narration's pace and where the offer sits. Optional: an older analysis (or a provider that does
 * not return them) is read with the heuristics of src/main/production/estimates/measure.ts.
 */
export const StyleMeasures = z.object({
  /** Share of screen time of a presenter (0: none), over the whole video and over the first 30 s. */
  presenterShare: share,
  hookPresenterShare: share.nullable().optional(),
  /** Layouts the presenter appears in: `full`, `split`, `inset`. */
  layouts: z.array(z.string()).max(6),
  /** Screen-time shares of the pictures (presenter excluded), adding to about 1. */
  pictures: z.object({ aiImage: share, aiClip: share, stock: share, archive: share, motion: share }),
  /** Mean shot length in seconds. */
  shotS: z.number().positive(),
  look: z.enum(PICTURE_LOOKS),
  captions: z.enum(CAPTION_KINDS),
  /** On-screen labels (item marks, key phrases) per minute, captions aside. */
  labelsPerMinute: z.number().min(0),
  wordsPerMinute: z.number().positive().nullable(),
  /** The first product or sponsor mention: second, length, and whether a card (or QR code) is shown. */
  offer: z.object({ atS: z.number().min(0), durationS: z.number().min(0), card: z.boolean() }).nullable(),
  /** Share of the pictures (the presenter's talk aside) in which the presenter acts the scene (style-japanese: a channel whose
   *  presenter talks 5 % of the time and acts in a third of its pictures is a presenter channel). */
  presenterActs: share.optional(),
  /** The presenter's longest run to camera, seconds. */
  presenterRunMaxS: z.number().min(0).optional(),
  /** The pictures' light and camera (record 0055's profile: what a pipeline built from these references must show). */
  light: z.enum(PICTURE_LIGHTS).optional(),
  camera: z.enum(PICTURE_CAMERAS).optional()
})
export type StyleMeasures = z.infer<typeof StyleMeasures>

export const AnalysisResult = z.object({
  summary: z.string(),
  hook: z.object({ text: z.string(), endsAtS: z.number(), technique: z.string() }),
  structure: z.array(z.object({ fromS: z.number(), toS: z.number(), kind: z.enum(SEGMENT_KINDS), summary: z.string() })),
  pacing: z.object({ cutsPerMinute: z.number(), tempo: z.enum(TEMPOS), notes: z.string() }),
  shotTypes: z.array(z.string()),
  onScreenText: z.array(Timed),
  music: z.object({ present: z.boolean(), mood: z.string(), notes: z.string() }),
  callsToAction: z.array(Timed),
  /**
   * Every span of the watched minutes where the presenter is on screen, with its layout (record 0058): the app measures the
   * channel's presenter curve and runs from them (`measureEditing`). Absent: not read (an older analysis); empty: no presenter.
   */
  presenter: z.array(z.object({ fromS: z.number().min(0), toS: z.number().min(0), layout: z.enum(PRESENTER_LAYOUTS) })).max(600).optional(),
  measures: StyleMeasures.optional()
})
export type AnalysisResult = z.infer<typeof AnalysisResult>
