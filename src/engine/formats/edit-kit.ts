// The editing kit of a style (motion-montage, docs/ENGINE-SPEC.md §21.11, decision 0073): how a film is cut, moved and sounded, as SETTINGS a
// style picks (never a rule of the engine). The rhythm is a measured shot-length distribution (hook and body); transitions are weights per
// kind of boundary (inside a sentence, a sentence end, a paragraph, a chapter); stills get a camera move from weights (classic push / pull /
// drift, 2.5D parallax); punch-ins land on the voice's accents; sound effects follow transitions, cards and reveals. Three kits measured on
// real references are given (EDIT_KITS); a style may start from one and change any field.
import { z } from 'zod'
import { NUMBER_KINDS } from '../edit/numbers'
import { TRANSITIONS, type Transition } from './editplan'
import { KINETIC_STYLES } from './motion'

/** A distribution of shot lengths, seconds: median and the 10th / 90th percentiles (a log-normal is fitted on them). */
export const RhythmProfile = z
  .object({ medianS: z.number().min(0.4).max(60), p10S: z.number().min(0.2).max(60), p90S: z.number().min(0.5).max(120) })
  .refine((r) => r.p10S <= r.medianS && r.medianS <= r.p90S, { message: 'p10S ≤ medianS ≤ p90S' })
export type RhythmProfile = z.infer<typeof RhythmProfile>

const Weights = z.partialRecord(z.enum(TRANSITIONS), z.number().min(0))
export type TransitionWeights = z.infer<typeof Weights>

export const BOUNDARIES = ['phrase', 'sentence', 'paragraph', 'chapter'] as const
export type Boundary = (typeof BOUNDARIES)[number]

/** `still`: no move at all (the references hold most of their stills and boards still: Markets of the Past 17 of 37 shots, Le Monde en POV mostly locked). */
export const STILL_MOVES = ['still', 'push', 'pull', 'left', 'right', 'parallax'] as const

/** Sound-effect kinds (media/sfx.ts) by event; `null` = silent. */
const Sfx = z.string().nullable()

export const EditKit = z.object({
  /** Shot lengths: in the hook (the first `hookS` seconds) and after. Used by `planCuts` (a pipeline that cuts from words) and reported. */
  rhythm: z.object({ hook: RhythmProfile, body: RhythmProfile, hookS: z.number().min(0).max(600).default(60) }),
  transitions: z.object({
    /** Weights per boundary kind (a cut inside a sentence is a `phrase` boundary). Missing kinds: a cut. */
    phrase: Weights.default({ cut: 1 }),
    sentence: Weights.default({ cut: 1 }),
    paragraph: Weights.default({ dissolve: 1 }),
    chapter: Weights.default({ dip: 1 }),
    /** Side of whips and pushes: always one side, or alternating. */
    dir: z.enum(['left', 'right', 'alternate']).default('alternate'),
    /** false: the director's own soft transitions (into a card…) are kept; true: the kit decides every boundary. */
    override: z.boolean().default(false),
    /**
     * true: a drawn transition is kept only where it means something, else it becomes a cut (a dissolve at a paragraph or a chapter):
     * a match between two shots of the same picture, a whip or a push inside a run of quick stills (an enumeration), a zoom into a card or
     * into a detail of the same picture, a flash at a chapter or a paragraph (a disclosure). Cuts, dissolves and dips need no reason.
     */
    purposeful: z.boolean().default(true),
    /** Transitions other than cuts a minute at most (dissolves and dips included); the rest become cuts. */
    perMinute: z.number().min(0).max(60).default(8)
  }).prefault({}),
  camera: z.object({
    /** A still's move, by weight (a still that already has a move from the director keeps it unless `override`). */
    stills: z.partialRecord(z.enum(STILL_MOVES), z.number().min(0)).default({ still: 1, push: 1, pull: 0.4, left: 0.3, right: 0.3 }),
    /** Zoom a classic move travels per second (the measured documentary push: ≈ 3 % a second). */
    speedPerS: z.number().min(0).max(0.2).default(0.03),
    /** Parallax only on stills at least this long. */
    parallaxMinS: z.number().min(1).default(3),
    /** `glide`: the kit's moves keep an even speed with short eased ends (editplan `Motion.ease`); `whole`: eased over the whole shot. */
    ease: z.enum(['glide', 'whole']).default('glide'),
    /**
     * A still held longer than this (seconds) is cut in two on a word: the same picture, then a closer framing on its subject (a cut-in),
     * so nothing sits still on screen with nothing happening. null: no limit.
     */
    maxHoldS: z.number().min(2).max(60).nullable().default(null),
    /** Zoom of the cut-in's closer framing. */
    cutInZoom: z.number().min(1.1).max(1.8).default(1.3),
    override: z.boolean().default(false)
  }).prefault({}),
  punches: z.object({
    /** Punch-ins a minute at most (0 = none), on the voice's accents. */
    perMinute: z.number().min(0).max(30).default(0),
    zoom: z.number().min(1.02).max(1.5).default(1.12),
    /**
     * A punch-in never comes back out (no in-and-out ping-pong): it holds to the cut, so it only lands on a still that ends at most this
     * long after it (seconds).
     */
    maxAfterS: z.number().min(0.5).max(6).default(2.5),
    /** Two punches at least this far apart. */
    minGapS: z.number().min(0.5).default(3)
  }).prefault({}),
  numbers: z.object({
    /** Set the numbers the voice says on their word as kinetic type (« multiplié par vingt » → « ×20 »), over stills only. */
    show: z.boolean().default(false),
    /** Which: a factor, a share, an amount of something, a year, a count of 1 000 or more (edit/numbers.ts). */
    kinds: z.array(z.enum(NUMBER_KINDS)).default(['times', 'percent', 'amount', 'year', 'count']),
    /** Cards (by template) a number may also be set over, when the card does not show that figure itself (e.g. a factor over a line chart). */
    overCards: z.array(z.string()).default([]),
    style: z.enum(KINETIC_STYLES).default('pop'),
    position: z.enum(['center', 'lower', 'upper']).default('lower'),
    /** What the number sits on: nothing (a label of the look's paper in a paper look), a scrim over the whole picture, a solid sheet. */
    background: z.enum(['none', 'scrim', 'solid']).default('none'),
    /** How long the number stays after its phrase is said (seconds). */
    holdS: z.number().min(0.5).max(6).default(1.6),
    perMinute: z.number().min(0).max(20).default(4),
    minGapS: z.number().min(1).default(5),
    /** The language the voice speaks (the numbers are read in it). */
    language: z.enum(['fr', 'en']).default('fr')
  }).prefault({}),
  sfx: z.object({
    /** Effects a minute at most (the register's cap, §26). 0 by default: no effect unless the style measured some on its references. */
    perMinute: z.number().min(0).max(60).default(0),
    /** Level of an effect's peak, dBFS (≈ −18 to −20 dB under the voice). */
    levelDb: z.number().min(-40).max(-6).default(-20),
    /** An effect on a transition, by its kind. */
    transitions: z.partialRecord(z.enum(TRANSITIONS), Sfx).default({ whip: 'whoosh', push: 'whoosh-soft', zoom: 'whoosh', flash: 'impact' }),
    /** An effect when a card or an overlay comes in, by template (the documentary cards, the kit's templates). */
    cards: z.record(z.string(), Sfx).default({ map: 'whoosh-soft', document: 'paper', archive: null, bars: null, chart: null, timeline: 'whoosh-soft', kinetic: null }),
    /** An effect on a reveal inside a card: a word punch, a counted row, a pin, a highlighted phrase, a kinetic word stressed. */
    reveals: z.object({ punch: Sfx.default('stamp'), row: Sfx.default('tick'), pin: Sfx.default('pop'), mark: Sfx.default(null), word: Sfx.default('pop') }).prefault({}),
    /** An effect on each punch-in, and on a chapter's first frame. */
    punch: Sfx.default(null),
    chapter: Sfx.default('impact')
  }).prefault({})
})
export type EditKit = z.infer<typeof EditKit>
export type EditKitInput = z.input<typeof EditKit>

/**
 * Kits measured on real references (research note editing-rhythm-2026-11 (old repository)):
 * - `documentary`: Markets of the Past (4 videos): a cut every 3.6–4.2 s in the hook, 5.2–7.6 s after; hard cuts and ≈ 0.4 s cross-fades on
 *   ≈ 40 % of the changes; slow pushes ≈ 3 %/s; sparse effects (paper, ticks).
 * - `avatar`: The Japanese Method, two videos: median 3.3 s (10 % under 2.1 s, 10 % over 5.1–5.6 s), hard cuts.
 * - `pov2d`: Le Monde en POV (2D animation), two passages: median 2.5–3.0 s (p10 1.0–1.6, p90 4.0), 93–96 % hard cuts, one cross-fade or whip
 *   a minute, drifts of 1–3.5 %/s with a near layer 2–3× faster, pops and stamps on reveals.
 */
export const EDIT_KITS = {
  documentary: {
    rhythm: { hook: { medianS: 3.8, p10S: 1.6, p90S: 8 }, body: { medianS: 6, p10S: 2.5, p90S: 14 }, hookS: 150 },
    transitions: { phrase: { cut: 1 }, sentence: { cut: 0.55, dissolve: 0.45 }, paragraph: { dissolve: 0.8, cut: 0.2 }, chapter: { dissolve: 0.5, dip: 0.5 }, perMinute: 6 },
    // measured on the shot list: 17 of 37 shots without a move, 4 slow pushes / pans (≈ 1.5–3 %/s), maps ≈ 5 % over the shot
    camera: { stills: { still: 1.4, push: 0.8, pull: 0.2, left: 0.15, right: 0.15, parallax: 0.2 }, speedPerS: 0.02 },
    punches: { perMinute: 0 },
    numbers: { show: true, style: 'pop', position: 'lower' },
    // effects were not measured on the reference (a few paper and tick sounds were heard, not counted): none until they are
    sfx: { perMinute: 0, transitions: { flash: 'impact' }, reveals: { punch: 'stamp', row: 'tick', pin: null, mark: 'paper', word: null } }
  },
  avatar: {
    rhythm: { hook: { medianS: 3.3, p10S: 2.1, p90S: 5.1 }, body: { medianS: 3.3, p10S: 2.1, p90S: 5.6 }, hookS: 60 },
    transitions: { phrase: { cut: 1 }, sentence: { cut: 1 }, paragraph: { cut: 0.8, dissolve: 0.2 }, chapter: { dip: 1 } },
    camera: { stills: { push: 1, pull: 0.5, left: 0.3, right: 0.3 }, speedPerS: 0.04 },
    punches: { perMinute: 3, zoom: 1.1, minGapS: 6 },
    sfx: { perMinute: 0 }
  },
  pov2d: {
    rhythm: { hook: { medianS: 2.5, p10S: 1, p90S: 4 }, body: { medianS: 3, p10S: 1.6, p90S: 4 }, hookS: 80 },
    transitions: { phrase: { cut: 1 }, sentence: { cut: 0.95, whip: 0.05 }, paragraph: { cut: 0.8, dissolve: 0.1, whip: 0.1 }, chapter: { dip: 0.5, flash: 0.5 } },
    camera: { stills: { still: 2.5, push: 0.5, left: 0.2, right: 0.2, parallax: 0.6 }, speedPerS: 0.025, parallaxMinS: 2.5 },
    punches: { perMinute: 4, zoom: 1.15, minGapS: 5 },
    numbers: { show: true, style: 'slam', position: 'center' },
    // measured on the reference: pops and stamps on reveals, a whoosh on whips (≈ 25–45 events a minute, counted by ear on two passages)
    sfx: { perMinute: 30, transitions: { whip: 'whoosh', dissolve: null, flash: 'impact' }, reveals: { punch: 'stamp', row: 'tick', pin: 'pop', mark: 'pop', word: 'pop' }, punch: 'pop' }
  }
} satisfies Record<string, EditKitInput>
export type EditKitName = keyof typeof EDIT_KITS

/** The kit of a style: a measured kit by name, changed by the style's own fields (one level deep). */
export function editKitOf(base: EditKitName | EditKitInput, changes: Partial<Record<keyof EditKitInput, Record<string, unknown>>> = {}): EditKit {
  const start = (typeof base === 'string' ? EDIT_KITS[base] : base) as Record<string, Record<string, unknown>>
  const merged: Record<string, unknown> = { ...start }
  for (const [k, v] of Object.entries(changes)) merged[k] = { ...(start[k] ?? {}), ...v }
  return EditKit.parse(merged)
}

/** Is this transition drawn from the previous picture (everything but a cut and a dip)? */
export const blends = (t: Transition): boolean => t !== 'cut' && t !== 'dip'
