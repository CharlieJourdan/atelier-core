// The edit review (qualite-montage, Charlie's second review of the Markets clone): what a defect is, how it is fixed, and the report a
// render carries. A defect is one thing a viewer would notice, with its time; a fix is one edit-plan operation the render itself can
// apply (no new picture, no new card): drop a shot (a neighbour takes its time), move a boundary, give a held picture a camera move,
// take a text off. Defects with no such fix are reported for the director's next pass (and the package card).

export type DefectKind =
  /** The picture does not show what the words under it say (vision). */
  | 'off_subject'
  /** The same picture (or one that looks the same) shown again within a minute. */
  | 'duplicate'
  /** A picture held ~5 s with nothing moving (a still board, a still without a camera). */
  | 'held'
  /** Nothing changes on screen for seconds (measured on the film: a map that stops, a film whose motion freezes). */
  | 'frozen'
  /** An archive film shorter than its shot: its last frame stays on screen. */
  | 'film_short'
  /** The hook waits: a long first shot, a first text that comes late. */
  | 'hook_slow'
  /** A text on screen whose date or figure the words never say (near it). */
  | 'text_unsaid'
  /** A text on screen far from the word it belongs to. */
  | 'text_late'
  /** A text written badly (« the spring of 1940 », « By the end of 1942 »: a date is « Spring 1940 », « End of 1942 »). */
  | 'text_form'
  /** A text on screen in another language than the video's. */
  | 'text_language'
  /** A map that shades lands without saying whose they are. */
  | 'map_legend'
  /** The voice breaks inside a word (a cut, a hole). */
  | 'audio_dropout'
  /** A click: one short burst much louder than what is around it. */
  | 'audio_click'
  /** The music is too loud under the voice. */
  | 'music_loud'
  /** A word the film cuts off: it ends after the film's sound does (controles-bloquants). */
  | 'word_cut'
  /** A hole in the film's sound: nothing heard for longer than the style's longest pause (controles-bloquants). */
  | 'sound_hole'
  /** The word times drift from the voice: the captions and every shot timed on them are off (controles-bloquants). */
  | 'timing_drift'
  /** A black picture in the film (controles-bloquants). */
  | 'black'
  /** The film's frame is not the reference's measured format (a vertical Short rendered wide), measured by ffprobe (moteur-pov-2). */
  | 'wrong_aspect'

export type Severity = 'fail' | 'warn'

export type Patch =
  /** The base shot goes; its neighbour (`into`) takes its frames, or shares them with the other neighbour (`and`: the second half). */
  | { op: 'drop'; shotId: string; into: string; and?: string }
  /** The boundary after `shotId` moves to `toFrame` (the next shot starts there). */
  | { op: 'shift'; shotId: string; toFrame: number }
  /** A held picture or card gets a slow camera move. */
  | { op: 'move'; shotId: string; zoom: number }
  /** An overlay text comes off. */
  | { op: 'drop_overlay'; shotId: string }

export interface Defect {
  kind: DefectKind
  severity: Severity
  /** Seconds in the film. */
  atS: number
  endS: number
  shotId?: string
  /** One French sentence for the person reading the report. */
  detail: string
  /** The words under it (for the reader and the vision check). */
  said?: string
  fix?: Patch
}

export interface ReviewRound {
  round: number
  defects: Defect[]
  applied: Patch[]
}

export interface ReviewReport {
  schema: 'atelier.review/1'
  /** Each review, the first on the director's plan, the last on the film delivered. */
  rounds: ReviewRound[]
  /** What the film delivered still has. */
  left: Defect[]
  /** The vision check ran (Claude looked at every shot). */
  looked: boolean
  notes: string[]
  /** The real errors left (controles-bloquants, decision 0102): a film with any of them is never delivered. */
  blocked?: Defect[]
  /** The music's extra gain the review chose (dB, negative: quieter) to keep it under the voice. */
  musicDb?: number
}

export const fmtS = (s: number): string => {
  const t = Math.round(s * 10) / 10
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`
}
