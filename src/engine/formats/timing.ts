// Timed formats shared by the voice, beats, director, captions, sound and render stages (docs/ENGINE-SPEC.md §19–§21):
// `json.words` (every script word with its time), `json.beats` (2–10 s timed beats) and the film's frame grid.
import { z } from 'zod'

/** Every timeline length is on a 30 fps frame grid (ENGINE-SPEC §15.3). */
export const FPS = 30
/**
 * The picture's shape is a property of the run: `16:9` (1920×1080, long-form, the default) or `9:16` (1080×1920, a short).
 * Everything that draws or checks the picture reads its size from the edit plan (`plan.size`) or from an `aspect` param.
 */
export const ASPECTS = ['16:9', '9:16'] as const
export type Aspect = (typeof ASPECTS)[number]
export const FRAME_SIZES: Record<Aspect, readonly [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920] }
/** The default (long-form) frame, kept for what has no aspect to read. */
export const FRAME_SIZE: readonly [number, number] = FRAME_SIZES['16:9']
export const frameSizeOf = (aspect: Aspect): readonly [number, number] => FRAME_SIZES[aspect]
/** The aspect of a frame size, or `null` when it is neither of ours. */
export const aspectOfSize = (size: readonly number[]): Aspect | null => ASPECTS.find((a) => FRAME_SIZES[a][0] === size[0] && FRAME_SIZES[a][1] === size[1]) ?? null

/** `F = round(D × 30)`: the film length in frames for a voice of `D` seconds. */
export const framesFor = (seconds: number): number => Math.round(seconds * FPS)
export const toFrame = (seconds: number): number => Math.round(seconds * FPS)
export const toSeconds = (frame: number): number => frame / FPS

/** One script word, in the script's own spelling and punctuation (R19 outputs). Times in seconds. */
export const Word = z.object({
  w: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
  /** Index of its sentence in the whole script, and of its paragraph. */
  sentence: z.number().int().min(0),
  paragraph: z.number().int().min(0)
})
export type Word = z.infer<typeof Word>

/** How the word times were obtained (R19.8, R19.9). `weak`: under the quality bar, downstream widens tolerances. */
export const ALIGNMENTS = ['provider', 'marks', 'asr', 'aligned', 'estimated', 'weak'] as const
export type Alignment = (typeof ALIGNMENTS)[number]

export const WordsValue = z.array(Word).min(1)

/** `json.words` meta: the voice length `D` and how good the times are. */
export const WordsMeta = z.object({
  durationS: z.number().positive(),
  alignment: z.enum(ALIGNMENTS),
  /** Share of script words matched to something heard (1 for provider or mark timing). */
  matched: z.number().min(0).max(1),
  language: z.string().min(2)
})
export type WordsMeta = z.infer<typeof WordsMeta>

/** Story tags of the outline and the beats (R17.10). */
export const TAGS = ['hook', 'promise', 'question', 'payoff', 'pivot', 'disclosure', 'figure', 'citation', 'echo', 'chapter', 'cta'] as const
export const Tag = z.enum(TAGS)
export type Tag = z.infer<typeof Tag>

/** One timed beat (§20). Beats cover [0, D] with no gap and no overlap. */
export const Beat = z.object({
  i: z.number().int().min(0),
  text: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
  /** First and last index (inclusive) of its words in `json.words`. */
  firstWord: z.number().int().min(0),
  lastWord: z.number().int().min(0),
  sentenceIdx: z.array(z.number().int().min(0)).min(1),
  paragraph: z.number().int().min(0),
  /** Title of the chapter this beat opens, if it opens one. */
  chapter: z.string().optional(),
  tags: z.array(Tag),
  /** Names, places, dates, figures and concrete nouns (director and visual search). */
  keyTerms: z.array(z.string()),
  /** Allowed cut points inside the beat, in seconds (comma, sentence end, pause ≥ 0.25 s). */
  cutPoints: z.array(z.number().min(0))
})
export type Beat = z.infer<typeof Beat>

export const BeatsValue = z.array(Beat).min(1)

export const BeatsMeta = z.object({ durationS: z.number().positive(), frames: z.number().int().positive(), weak: z.boolean() })
export type BeatsMeta = z.infer<typeof BeatsMeta>
