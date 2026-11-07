// P4 — the Style Definition (spec §1, §2 P4): the complete, versioned description of THIS channel's style, as rich as a
// hand-written definition but produced from the analysis. Every leaf is a Sourced field: `measured` (with evidence from
// the corpus), `user` (he said so) or `default` (nothing was measured; the default is the definition's own, never a base
// pipeline's option default). P5 builds the pipeline only from these fields (plan-rules.ts).
import { z } from 'zod'
import { LayoutSchema, MediaOriginSchema, VideoPartSchema, head, sourced } from './common'
import { MOTION_ELEMENT_TYPES, PRESENTER_KINDS } from './video-analysis'

const S = sourced
const num = (min = 0) => S(z.number().min(min))
const str = () => S(z.string())
const bool = () => S(z.boolean())
const strs = () => S(z.array(z.string()))
/** An ADDED field (after the contract): optional in older artefacts, filled with the definition's own default on parse. */
const added = <F extends z.ZodType>(schema: F, value: unknown) => schema.default({ value, source: 'default', evidence: [] } as z.util.NoUndefined<z.output<F>>)

export const ScriptGrammar = z.object({
  /** Outline: parts and their share of the runtime. */
  partCount: num(1),
  parts: S(z.array(z.object({ name: z.string(), share: z.number().min(0).max(1), intent: z.string() }))),
  frame: S(z.enum(['story', 'teaching', 'news', 'essay', 'list', 'other'])),
  hookWindowS: num(),
  hookPattern: str(),
  /** Hook levers used (open question, stakes, contradiction, specifics…). */
  hookLevers: strs(),
  promise: str(),
  /** Where the promise is repeated, as fractions of the runtime. */
  promiseRepeatAt: S(z.array(z.number().min(0).max(1))),
  payoff: str(),
  maxNoConcreteS: num(),
  wordsPerMinute: num(1),
  sentenceWordsMean: num(1),
  tone: str(),
  addressMode: S(z.enum(['you', 'we', 'i', 'neutral'])),
  devices: strs(),
  chapters: bool(),
  cta: str(),
  bannedOpenings: strs(),
  numbersAsWords: bool(),
  /** How each corpus video's outline is built (the structure items in order), the most frequent one. */
  outline: added(strs(), []),
  /** Share of the hook / body time with something concrete on screen for each sentence (illustrated shots). */
  illustratedShare: added(S(z.number().min(0).max(1)), 0.9),
  /** The same share part by part (hook, body, promo, end): how well the pictures illustrate their words along the video. */
  illustratesByPart: added(S(z.array(z.object({ part: VideoPartSchema, share: z.number().min(0).max(1) }))), [])
})

export const VoiceGrammar = z.object({
  /** `user-clone` = the user's own voice clone (own channel); `same-kind` = a voice of the same kind as the reference. */
  mode: S(z.enum(['user-clone', 'same-kind', 'none'])),
  kind: S(z.enum(['real', 'synthetic', 'none'])),
  timbre: str(),
  /** Gender/age/accent the chosen voice must have. */
  descriptors: strs(),
  wordsPerMinute: num(1),
  pausesPerMinute: num(),
  meanPauseS: num(),
  energy: S(z.enum(['low', 'medium', 'high'])),
  /** The chosen voice (an id in the user's voices or the catalogue), null until picked. */
  voiceRef: S(z.string().nullable()),
  /** Language the voice speaks (BCP-47): the brief's target language (a translation speaks the target, not the source). */
  language: added(str(), ''),
  /** Words per minute part by part (the hook often runs faster than the body). */
  wpmByPart: added(S(z.array(z.object({ part: VideoPartSchema, wpm: z.number().positive() }))), [])
})

export const PresenterConfiguration = z.object({
  id: z.string(),
  framing: z.enum(['close', 'medium', 'wide']),
  layout: LayoutSchema,
  angle: z.number().int().min(0),
  description: z.string()
})

/** A provisional presenter of the SAME TYPE as the reference (age, gender, wardrobe, set, framing): never the third party's
 *  own face. Built from words only (no reference frame of the third party is ever sent to an image model). */
export const LookAlikeSpec = z.object({
  placeholder: z.literal(true),
  /** What it stands in for (the import slot the user fills later). */
  standsInFor: z.string().min(1),
  type: z.object({ age: z.string(), gender: z.string(), hair: z.string(), wardrobe: z.string(), setting: z.string(), lighting: z.string(), framing: z.string() }),
  /** The portrait prompt (words only) and one prompt per measured angle. */
  portraitPrompt: z.string().min(1),
  angles: z.array(z.object({ angle: z.number().int().min(0), framing: z.enum(['close', 'medium', 'wide']), prompt: z.string().min(1) })),
  /** Visible mark on every frame it appears in until the user supplies the real input. */
  label: z.string().min(1)
})
export type LookAlikeSpec = z.infer<typeof LookAlikeSpec>

export const PresenterGrammar = z.object({
  kind: S(z.enum(PRESENTER_KINDS)),
  /** `own` = the user's existing presenter (his channel); `look-alike-placeholder` = a provisional presenter of the same
   *  type in an import slot (never a third party's own face); `none`. */
  mode: S(z.enum(['own', 'look-alike-placeholder', 'none'])),
  identity: S(z.object({ age: z.string(), gender: z.string(), face: z.string(), hair: z.string(), wardrobe: z.string(), setting: z.string(), lighting: z.string() }).nullable()),
  /** Measured number of distinct angles (portrait + others). */
  angleCount: num(),
  configurations: S(z.array(PresenterConfiguration)),
  /** The per-part layout curve: share of each layout in each part. */
  layoutCurve: S(z.array(z.object({ part: VideoPartSchema, shares: z.partialRecord(LayoutSchema, z.number().min(0).max(1)) }))),
  presenceByPart: S(z.array(z.object({ part: VideoPartSchema, share: z.number().min(0).max(1) }))),
  entries: strs(),
  exits: strs(),
  noSameConfigTwice: bool(),
  /** The presenter reference used (own avatar id, placeholder id), null until picked. */
  presenterRef: S(z.string().nullable()),
  /** Seconds of presenter on screen per minute of video (layout other than off). */
  talkSecondsPerMinute: added(num(), 0),
  /** Mean length of one continuous presenter window, seconds. */
  windowMeanS: added(num(), 0),
  /** The look-alike placeholder (not his channel): who stands in, of the same type, clearly marked. Null otherwise. */
  placeholder: added(S(LookAlikeSpec.nullable()), null)
})

export const MotionGrammar = z.object({
  elements: S(z.array(z.object({
    type: z.enum(MOTION_ELEMENT_TYPES),
    durationS: z.number().positive(),
    easing: z.string(),
    perMinute: z.number().min(0),
    landingOffsetS: z.number(),
    texture: z.string()
  }))),
  palette: strs(),
  fonts: strs(),
  densityByPart: S(z.array(z.object({ part: VideoPartSchema, perMinute: z.number().min(0) }))),
  /** Motion explains when no found media fits (legends, map annotations) — within the style. */
  explainWhenNoMedia: bool(),
  neverSameTypeTwice: bool(),
  /** Share of screen time covered by motion design, in the hook and in the body. */
  coverageByPart: added(S(z.array(z.object({ part: VideoPartSchema, share: z.number().min(0).max(1) }))), [])
})

export const EditingGrammar = z.object({
  meanShotS: num(),
  medianShotS: num(),
  p90ShotS: num(),
  shotCurve: S(z.array(z.object({ fromShare: z.number().min(0).max(1), toShare: z.number().min(0).max(1), meanShotS: z.number().positive() }))),
  hookMeanShotS: num(),
  cutTypes: S(z.record(z.string(), z.number().min(0).max(1))),
  transitions: strs(),
  holdMaxS: num(),
  cutSnapToPhrase: bool(),
  cameraMoves: strs(),
  colour: str(),
  /** When a picture lands relative to its word (seconds, negative = before the word): illustration timing. */
  illustrationLeadS: added(num(-10), 0),
  /** Black bars the reference keeps on its frames: the picture's aspect between them and each bar's share of the height (null =
   *  the picture fills the frame). Measured on the 0.5 s frames (analysis/letterbox.ts); drawn by render.assemble. */
  letterbox: added(S(z.object({ aspect: z.number().positive(), barShare: z.number().min(0).max(0.5) }).nullable()), null),
  /** The reference's frame format (moteur-pov-2): `9:16` when its videos are vertical (a Short), measured on their files. */
  aspect: added(S(z.enum(['16:9', '9:16'])), '16:9'),
  /** Mean shot length part by part (the cadence of the hook, the body, the end). */
  shotByPart: added(S(z.array(z.object({ part: VideoPartSchema, meanShotS: z.number().positive() }))), [])
})

/** The opening over which the first-person share is measured apart (moteur-pov-2): the passage a free demo shows. */
export const OPENING_S = 120

/** One screen element's distribution along the video (the corpus median of each video's, analysis/distributions.ts): its share
 *  of the screen time overall, per part, and per tenth of the video (`curve[k]` = the k-th tenth). Read by the director's mix curve
 *  (pipeline/values.ts mixCurveFrom) and by the reverse-engineered pipeline. */
export const DistributionRow = z.object({
  element: z.string(),
  overall: z.number().min(0).max(1),
  byPart: z.array(z.object({ part: VideoPartSchema, share: z.number().min(0).max(1) })),
  curve: z.array(z.number().min(0).max(1)).max(10)
})
export type DistributionRow = z.infer<typeof DistributionRow>

export const SourcingRules = z.object({
  /** Screen-time share per media origin. */
  originShares: S(z.partialRecord(MediaOriginSchema, z.number().min(0).max(1))),
  /** Found media must literally show what is said, verified on frames. */
  foundLiteral: bool(),
  /** Generated only where the reference generates. */
  generatedOnlyWhereReference: bool(),
  footageMinS: num(),
  footageMaxS: num(),
  /** Every still of a scene in the same place (a place reference). */
  placeContinuity: bool(),
  noRepeatWhileUnused: bool(),
  illustrationStyle: str(),
  grade: str(),
  /** Of the FOUND media screen time, the share that is stills (photos, documents) rather than moving footage. */
  foundStillsShare: added(S(z.number().min(0).max(1)), 0),
  /** Screen-time share per shot kind (archive-film, map, chart, presenter…): the finer grain of originShares. */
  kindShares: added(S(z.record(z.string(), z.number().min(0).max(1))), {}),
  /** Screen-time share of first-person shots (the viewer's own hand holds something in the foreground). */
  povShare: added(S(z.number().min(0).max(1)), 0),
  /** Of the pictures (not presenter, not plain cards), the share drawn or shot with depth of field (sharp subject, blurred back). */
  depthShare: added(S(z.number().min(0).max(1)), 0),
  /** The look of the pictures the reference generates, as an image-prompt line: every picture we generate carries it ('' = none). */
  generatedLook: added(str(), ''),
  /** moteur-pov-2: the things held up in first person, most frequent first, with what is drawn on them and their share of the
   *  first-person time (measured on the pov shots' descriptions and on-screen text). */
  heldObjects: added(S(z.array(z.object({ hold: z.enum(['ticket', 'phone', 'card', 'paper', 'note', 'bill']), detail: z.enum(['numbers', 'results', 'call', 'message', 'price', 'plain']), share: z.number().min(0).max(1) }))), []),
  /** The first-person share over the opening (`OPENING_S` seconds of each video), where a story handles its objects most. */
  povOpeningShare: added(S(z.number().min(0).max(1)), 0),
  /** How the drawn characters are drawn (silhouettes, a light rim, expressive faces, who wears a colour); null = not drawn. */
  figures: added(S(z.object({ body: z.enum(['silhouette', 'clothed']), rim: z.boolean(), faces: z.enum(['expressive', 'eyes']), colour: z.enum(['hero', 'all']) }).nullable()), null),
  /** How every screen element is distributed along the video (presenter, each picture origin, stills vs moving, motion design,
   *  on-screen text): « presenter 70 % in the hook, stills dominate the end ». */
  distributions: added(S(z.array(DistributionRow)), [])
})

export const SoundGrammar = z.object({
  music: bool(),
  musicGenre: str(),
  musicLevelUnderVoiceDb: num(-60),
  musicChanges: S(z.enum(['none', 'per-part', 'per-scene'])),
  sfx: S(z.array(z.object({ kind: z.string(), on: z.string(), perMinute: z.number().min(0) }))),
  loudnessLufs: num(-40)
})

export const CaptionGrammar = z.object({
  burnIn: bool(),
  maxWordsPerCue: num(1),
  maxCueS: num(),
  style: str(),
  onScreenTextChecked: bool(),
  /** Caption cue offset from its spoken word, seconds (positive = late): the sync the reference keeps. */
  syncOffsetS: added(num(-5), 0)
})

export const PackagingGrammar = z.object({
  titlePattern: str(),
  thumbnailPattern: str(),
  thumbnailWords: num(),
  chapterBar: bool()
})

export const CostTargets = z.object({
  usdPerMinute: num(),
  makeMinutesPerMinute: num()
})

/** Where P4 started (base-start.ts): from a ready base that fits the channel, every one of its settings checked against the
 *  measurements (kept only when measured equal, else replaced), or from zero when no base fits. */
export const BaseStart = z.object({
  from: z.enum(['base', 'zero']),
  baseId: z.string().nullable(),
  /** The base pipeline whose bricks P5 starts from. */
  pipelineId: z.string().nullable(),
  /** Every ready base scored against this channel, best first, with why. */
  candidates: z.array(z.object({ id: z.string(), score: z.number().min(0).max(1), fits: z.boolean(), why: z.array(z.string()) })),
  /** Base settings measured equal here (within the field's measurement tolerance): `value` is what the definition holds (the
   *  base's when its renders proved it, else the measurement), `measured` this channel's measurement. */
  kept: z.array(z.object({ field: z.string(), value: z.unknown(), base: z.unknown(), measured: z.unknown(), proven: z.boolean() })),
  /** Base settings this channel measured differently: the measured value replaced them. */
  replaced: z.array(z.object({ field: z.string(), base: z.unknown(), measured: z.unknown() })),
  /** Improvements the base's own rounds earned, applied because this channel measures the same `before`. */
  earned: z.array(z.object({ field: z.string(), round: z.number().int(), before: z.unknown(), after: z.unknown(), why: z.string(), sheet: z.string() })),
  /** Base settings nothing measured here: never kept (the definition's own default stays). */
  dropped: z.array(z.string()),
  savings: z.object({ fieldsChecked: z.number().int().min(0), fieldsProven: z.number().int().min(0), roundsEarned: z.number().int().min(0) })
})
export type BaseStart = z.infer<typeof BaseStart>

export const StyleDefinition = z.object({
  ...head('style-definition'),
  /** Bumped by every improvement round (P8); the previous versions stay saved. */
  version: z.number().int().min(1),
  channel: z.object({ name: z.string(), url: z.string(), ownChannel: z.boolean(), language: z.string(), styleId: z.string().nullable() }),
  script: ScriptGrammar,
  voice: VoiceGrammar,
  presenter: PresenterGrammar,
  motion: MotionGrammar,
  editing: EditingGrammar,
  sourcing: SourcingRules,
  sound: SoundGrammar,
  captions: CaptionGrammar,
  packaging: PackagingGrammar,
  cost: CostTargets,
  /** Every field P4 measured on the whole-video analyses (beyond the synthesis) with its value: P4's check refuses a later
   *  definition that marks one of them `default` or changes it outside an improvement round (the orchestrator does not
   *  pass the analyses to the check). */
  analysisMeasures: z.array(z.object({ field: z.string().min(1), value: z.unknown() })).default([]),
  /** Where P4 started: a ready base (checked field by field) or zero. Null in definitions written before (decision 0112). */
  baseStart: BaseStart.nullable().optional()
})
export type StyleDefinition = z.infer<typeof StyleDefinition>
