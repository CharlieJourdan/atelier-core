// The « profil mesuré » of `documentary@1` (record 0055): what four videos of a history channel measure (style-markets,
// research note style-markets-of-the-past-2026-11 (old repository): 0:00–3:00 and 10:00–13:00 of each, frames every 0.5 s, cuts by pixel and
// histogram difference, every shot classed on contact sheets), and the settings of the pipeline's bricks derived from it. These are
// this pipeline's settings, never the engine's: the other bases keep their own.
import type { ReferenceProfile } from '../reference-profile'

/** A documentary's measures beyond the general profile. */
export interface DocumentaryProfile extends ReferenceProfile {
  /** Median shot length after the hook (seconds) and in the hook. */
  shotMedianS: number
  hookShotMedianS: number
  /** Share of the picture changes that are soft (a cross-fade of ≈ 0.4 s) rather than hard cuts. */
  dissolveShare: number
  /** Share of screen time of the motion-design cards (maps, data cards, timelines) and of the archives. */
  cardShare: number
  archiveShare: number
  /** Narration pace (words a minute) and music under the voice. */
  wordsPerMinute: number
  music: 'under-voice'
}

export const DOCUMENTARY_PROFILE: DocumentaryProfile = {
  source:
    'Four videos of the public channel Markets of the Past (Switzerland 1940, the 1987 crash, the 1929 crash, America and Latin America), ' +
    '0:00–3:00 and 10:00–13:00 of each, measured 2026-11-01 (style-markets)',
  // the hooks cut every 3.6–4.2 s, the middles every 5.2–7.6 s
  shotMedianS: 5.5,
  hookShotMedianS: 3.8,
  // ≈ 40 % of the changes are 0.4 s cross-fades, the rest hard cuts; they land on sentence starts
  dissolveShare: 0.4,
  cardShare: 0.2,
  archiveShare: 0.7,
  wordsPerMinute: 176,
  music: 'under-voice',
  // numbers and names land on their word (0.1–0.5 s after it); the picture shows what the sentence names
  cutLeadS: 0.1,
  literalShare: 0.9,
  // captions and labels are part of the cards, never burnt over the film
  labelsPerMinute: 0,
  repeatWindowS: 30
}

