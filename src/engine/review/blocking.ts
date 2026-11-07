// The blocking checks (controles-bloquants, decision 0102): Charlie's rule of 2026-11-04 splits what the edit review finds in two.
// REAL ERRORS make a video unusable — a word or the voice cut, a hole in the sound, a frozen, black or repeated picture, a wrong text,
// a date or a figure the voice never says, a map that does not say whose lands it shades, music too loud, word times that drift from
// the voice. Each one is MEASURED BY CODE (ffmpeg, the voice's energy, word times, frame thumbnails, the texts against the words),
// never judged by a model; the render repairs what it can and renders again, and a film that still has one is NEVER delivered.
// « Not similar enough » is not an error: it stays with the clone's improvement loop (P7/P8). What a model judges (a picture off its
// subject) and what is a style (a slow hook, a text 1.5 s from its word, a click) are reported, never blocking.
import { EngineError } from '../errors'
import { fmtS, type Defect, type DefectKind } from './types'

/** The real errors, by kind; each is measured by code. */
export const BLOCKING_KINDS: ReadonlySet<DefectKind> = new Set<DefectKind>([
  'audio_dropout',
  'word_cut',
  'sound_hole',
  'timing_drift',
  'music_loud',
  'frozen',
  'held',
  'film_short',
  'black',
  'duplicate',
  'text_unsaid',
  'text_form',
  'text_language',
  'map_legend',
  'wrong_aspect'
])

/** A defect that forbids delivery: a real error, measured by code. */
export const isBlocking = (d: Pick<Defect, 'kind'>): boolean => BLOCKING_KINDS.has(d.kind)

/** The real errors among `defects`. */
export const blockingOf = (defects: readonly Defect[]): Defect[] => defects.filter(isBlocking)

/** The French sentence a refused film carries (the first errors, with their times). */
export function refusalText(blocked: readonly Defect[]): string {
  // the kind in brackets: a caller (the team's order runner) reads which step to remake from it
  const shown = blocked.slice(0, 6).map((d) => `${fmtS(d.atS)} ${d.detail} [${d.kind}]`)
  const more = blocked.length > shown.length ? ` (+${blocked.length - shown.length})` : ''
  return `Vidéo refusée : ${blocked.length} erreur(s) réelle(s) que le rendu n’a pas pu réparer — ${shown.join(' · ')}${more}`
}

/** The error a render throws instead of delivering a film with real errors left (permanent: the same inputs give the same film). */
export function refusal(blocked: readonly Defect[]): EngineError {
  return new EngineError('verify_failed', refusalText(blocked), true)
}
