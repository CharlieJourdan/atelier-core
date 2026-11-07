// Where the sponsor shows (docs/specs/pipeline-avatar.md §2.13): each mention of `json.outline.sponsor`, found in the voice's words by
// its sentences' anchors, from a few frames before its first word to the start of the sentence after its last one. The director puts
// these windows on the timeline (`overlays` of kind `sponsor`), and `edit.sponsor` lays the card or the clip on exactly them.
import { findAnchorWord } from '../formats/directives'
import type { Outline } from '../formats/outline'
import type { Word } from '../formats/timing'
import { cutBefore, sentencesOf, type Sentence } from './director-mix'

export interface SponsorWindow {
  kind: 'mention' | 'reminder'
  startS: number
  endS: number
  /** The anchor of its first sentence. */
  anchor: string
  /** Its first and last words (indices in the voice's words). */
  firstWord: number
  lastWord: number
}

/** The mentions as windows of the film, in the order of the outline (a mention whose words are not found is left out). */
export function sponsorWindows(outline: Outline, words: readonly Word[], D: number, sentences: readonly Sentence[] = sentencesOf(words, D)): SponsorWindow[] {
  const out: SponsorWindow[] = []
  for (const m of outline.sponsor ?? []) {
    const found = m.anchors
      .map((a) => {
        for (const s of sentences) {
          const k = findAnchorWord(words, (words[s.first] as Word).sentence, a, s.first)
          if (k !== null) return { k, s }
        }
        return null
      })
      .filter((x): x is { k: number; s: Sentence } => x !== null)
    const first = found[0]
    const last = found.at(-1)
    if (!first || !last) continue
    const startS = cutBefore(words, first.k)
    out.push({ kind: m.kind, startS, endS: Math.max(startS + 1, last.s.end), anchor: m.anchors[0] as string, firstWord: first.k, lastWord: last.s.last })
  }
  return out
}
