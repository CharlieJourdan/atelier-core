// P2 — the full analysis of ONE corpus video (spec §2 P2): shot log, presenter, voice, motion design, editing, sound,
// script, packaging. Whole video, never « the first minutes »; what could not be read is said in `coverage`. Every number
// carries its evidence (MeasuredNumber).
import { z } from 'zod'
import { CAMERA_MOVES, LOG_SHOT_KINDS } from '../shot-log'
import { Evidence, LayoutSchema, MeasuredNumber, MediaOriginSchema, VideoPartSchema, head } from './common'

export const PRESENTER_KINDS = ['real', 'avatar', 'none'] as const
export type PresenterKind = (typeof PRESENTER_KINDS)[number]

export const MOTION_ELEMENT_TYPES = ['map', 'chart', 'kinetic-type', 'document', 'card', 'lower-third', 'number', 'timeline', 'diagram', 'icon', 'other'] as const
export const CUT_TYPES = ['hard', 'dissolve', 'wipe', 'whip', 'match', 'zoom', 'flash', 'other'] as const

/** The parts of the video with their bounds (hook, body, promo, end). */
export const PartSpan = z.object({ part: VideoPartSchema, fromS: z.number().min(0), toS: z.number().min(0) })

export const AnalysedShot = z.object({
  n: z.number().int().min(1),
  startS: z.number().min(0),
  lengthS: z.number().positive(),
  kind: z.enum(LOG_SHOT_KINDS),
  shows: z.string(),
  onScreenText: z.string(),
  words: z.string(),
  illustrates: z.enum(['yes', 'partly', 'no']).nullable(),
  camera: z.enum(CAMERA_MOVES),
  origin: MediaOriginSchema,
  /** Presenter layout in this shot (`off` when he is not on screen). */
  layout: LayoutSchema,
  /** Which presenter angle (index into presenter.angles), null when off. */
  angle: z.number().int().min(0).nullable(),
  frames: z.array(z.string().min(1)).min(1),
  /** Seen in the first person: the viewer's own hand or arm holds something in the foreground (moteur-briques). */
  pov: z.boolean().optional(),
  /** A sharp subject over a visibly defocused background (`deep`) or everything equally sharp (`flat`); null when not read. */
  depth: z.enum(['deep', 'flat']).nullable().optional()
})
export type AnalysedShot = z.infer<typeof AnalysedShot>

/** Share (0..1) per layout, per part: the presenter's layout curve. */
export const LayoutShares = z.partialRecord(LayoutSchema, z.number().min(0).max(1))

export const PresenterAnalysis = z.object({
  kind: z.enum(PRESENTER_KINDS),
  identity: z.object({
    age: z.string(), gender: z.string(), face: z.string(), hair: z.string(),
    wardrobe: z.string(), setting: z.string(), lighting: z.string(),
    evidence: z.array(Evidence).min(1)
  }).nullable(),
  angles: z.array(z.object({ id: z.string(), framing: z.enum(['close', 'medium', 'wide']), description: z.string(), frames: z.array(z.string()).min(1) })),
  layoutByPart: z.array(z.object({ part: VideoPartSchema, shares: LayoutShares, evidence: z.array(Evidence).min(1) })),
  presenceByPart: z.array(z.object({ part: VideoPartSchema, share: MeasuredNumber })),
  entries: z.array(z.object({ atS: z.number().min(0), how: z.string() })),
  exits: z.array(z.object({ atS: z.number().min(0), how: z.string() }))
})

export const VoiceAnalysis = z.object({
  kind: z.enum(['real', 'synthetic', 'none']),
  timbre: z.string(),
  wordsPerMinute: MeasuredNumber,
  pausesPerMinute: MeasuredNumber,
  meanPauseS: MeasuredNumber,
  energy: z.enum(['low', 'medium', 'high']),
  /** Words per minute of speech in each part (word timings; a part with too few words to measure is left out). */
  wpmByPart: z.array(z.object({ part: VideoPartSchema, wpm: z.number().positive() })).optional()
})

export const MotionElement = z.object({
  type: z.enum(MOTION_ELEMENT_TYPES),
  count: z.number().int().min(0),
  meanDurationS: MeasuredNumber,
  easing: z.string(),
  palette: z.array(z.string()),
  fonts: z.array(z.string()),
  texture: z.string(),
  /** Mean offset between the element landing and its word (negative = before the word). */
  landingOffsetS: MeasuredNumber,
  perMinuteByPart: z.array(z.object({ part: VideoPartSchema, perMinute: z.number().min(0) }))
})

export const EditingAnalysis = z.object({
  cutTypes: z.partialRecord(z.enum(CUT_TYPES), z.number().int().min(0)),
  meanShotS: MeasuredNumber,
  medianShotS: MeasuredNumber,
  p90ShotS: MeasuredNumber,
  /** Mean shot length over the video, window by window. */
  shotCurve: z.array(z.object({ fromS: z.number().min(0), toS: z.number().min(0), meanShotS: z.number().positive() })).min(1),
  holdsOver5S: z.number().int().min(0),
  transitions: z.array(z.string()),
  /** Screen-time share per media origin (sums to ~1). */
  originShares: z.partialRecord(MediaOriginSchema, z.number().min(0).max(1)),
  colour: z.string(),
  /** The longest shot (the measure behind the definition's `editing.holdMaxS`). */
  longestShotS: MeasuredNumber.optional(),
  /** Share of cuts landing within 0.25 s of a pause between words (cut snapped to the phrase). */
  cutOnPhraseShare: MeasuredNumber.optional(),
  /** Share of spoken shots whose picture shows (yes) or partly shows what is said: illustration on its words. */
  illustratesShare: MeasuredNumber.optional(),
  /** Screen-time share of stills (photos, documents, title cards) vs moving footage among found/filmed/generated media. */
  stillShare: MeasuredNumber.optional(),
  /** Mean shot length in each part, shots counted by the share of them inside the part (a straddling shot counts in both). */
  shotByPart: z.array(z.object({ part: VideoPartSchema, meanShotS: z.number().positive() })).optional(),
  /** Per part, the screen-time share of the spoken shots whose picture shows what is said (yes 1, partly 0.5, no 0), over the
   *  shots whose illustration was read; null when no shot of the part was read. */
  illustratesByPart: z.array(z.object({ part: VideoPartSchema, share: z.number().min(0).max(1).nullable() })).optional()
})

/** Windows of an element's curve over the video (equal tenths of its length). */
export const DISTRIBUTION_WINDOWS = 10

/**
 * How one screen element (the presenter, a picture origin, stills, moving pictures, motion design, on-screen text) is distributed
 * along the video: its screen-time share overall, in each part and in each tenth of the video. Shares are computed by the overlap
 * of each shot's [start, end) with the part or window (a shot straddling a boundary counts on both sides), over the shot time there.
 */
export const ElementDistribution = z.object({
  element: z.string().min(1),
  overall: z.number().min(0).max(1),
  byPart: z.array(z.object({ part: VideoPartSchema, share: z.number().min(0).max(1) })),
  curve: z.array(z.number().min(0).max(1)).max(DISTRIBUTION_WINDOWS),
  /** Time ranges and frames of a few of its shots. */
  evidence: z.array(Evidence).min(1)
})
export type ElementDistribution = z.infer<typeof ElementDistribution>

export const SoundAnalysis = z.object({
  music: z.object({ present: z.boolean(), genre: z.string(), levelUnderVoiceDb: MeasuredNumber.nullable(), changesAtS: z.array(z.number().min(0)) }),
  sfx: z.array(z.object({ kind: z.string(), on: z.string(), count: z.number().int().min(0) })),
  loudnessLufs: MeasuredNumber
})

export const ScriptAnalysis = z.object({
  structure: z.array(z.string()).min(1),
  hookPattern: z.string(),
  promise: z.string(),
  payoff: z.string(),
  chapters: z.array(z.object({ atS: z.number().min(0), title: z.string() })),
  cta: z.string(),
  sentenceWordsMean: MeasuredNumber,
  tone: z.string(),
  devices: z.array(z.string())
})

export const PackagingAnalysis = z.object({
  title: z.string(),
  titlePattern: z.string(),
  thumbnail: z.object({ path: z.string().nullable(), pattern: z.string() })
})

export const AnalysisCoverage = z.object({
  durationS: z.number().positive(),
  readS: z.number().min(0),
  complete: z.boolean(),
  gaps: z.array(z.object({ fromS: z.number().min(0), toS: z.number().min(0), why: z.string().min(1) })),
  /** Axes that could not be read (e.g. `sound` when the audio was missing). */
  unreadAxes: z.array(z.string()),
  /** The plain sentence that says what was not read (required when not complete). */
  said: z.string().nullable()
})

export const VideoAnalysis = z.object({
  ...head('video-analysis'),
  videoId: z.string().min(1),
  url: z.string().min(1),
  /** Which brief reference the video comes from (corpus `reference`; 0 when there is one). */
  reference: z.number().int().min(0).optional(),
  title: z.string(),
  coverage: AnalysisCoverage,
  parts: z.array(PartSpan).min(1),
  shots: z.array(AnalysedShot).min(1),
  /** Dense frames (every 0.5 s) on the hook and around each part change. */
  denseFrames: z.array(z.object({ atS: z.number().min(0), path: z.string().min(1) })),
  presenter: PresenterAnalysis,
  voice: VoiceAnalysis,
  motion: z.object({ elements: z.array(MotionElement), palette: z.array(z.string()), fonts: z.array(z.string()) }),
  editing: EditingAnalysis,
  sound: SoundAnalysis,
  script: ScriptAnalysis,
  packaging: PackagingAnalysis,
  /** Burnt-in captions: share of spoken shots whose on-screen text repeats what is said (caption sync). */
  captions: z.object({ burnedInShare: MeasuredNumber }).optional(),
  /** The look of the pictures this video generates, as an image-prompt line (moteur-briques, the global look pass). */
  generatedLook: z.string().optional(),
  /** Black bars the frames keep (moteur-briques, analysis/letterbox.ts): null when the picture fills the frame. */
  framing: z.object({
    letterbox: z.object({ aspect: z.number().positive(), barShare: z.number().min(0).max(0.5), frameShare: z.number().min(0).max(1), frames: z.number().int().min(1) }).nullable()
  }).optional(),
  /** How the video draws its characters (moteur-pov-2, the global look); absent when not read, null when it draws none. */
  figures: z.object({ body: z.enum(['silhouette', 'clothed']), rim: z.boolean(), faces: z.enum(['expressive', 'eyes']), colour: z.enum(['hero', 'all']) }).nullable().optional(),
  /** The video's own frame (moteur-pov-2): its display size, read on the file (ffprobe) or said by a Shorts link when no file was
   *  served. Drives the render format (a vertical Short renders 9:16). */
  frame: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), from: z.enum(['file', 'link']) }).optional(),
  /** Every screen element's distribution over time (analysis/distributions.ts); absent in analyses written before. */
  distributions: z.array(ElementDistribution).optional(),
  /** Numbers that could not be measured on this video, each with why (`sound.music.genre: no listening model`). */
  unmeasured: z.array(z.string()).optional(),
  costUsd: z.number().min(0)
})
export type VideoAnalysis = z.infer<typeof VideoAnalysis>

