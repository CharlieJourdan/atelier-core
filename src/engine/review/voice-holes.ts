// The voice's holes, checked on every take the provider sends (controles-bloquants, decision 0102): a voice that breaks inside a word
// (Le Monde en POV: 6 breaks of 0.13–0.53 s; the Japanese example: 13 of 0.12–0.31 s) cannot be repaired by the render — the sound is
// missing — so `voice.tts` measures each chunk as it arrives, with the provider's own word times, and asks for that chunk again before
// anything is built on it. The measure is the edit review's (`voiceDefects`), so the render's last check and this one agree.
import type { Word } from '../formats/timing'
import { energyEnvelope } from '../media/probe'
import type { MediaService, TimedWord } from '../services'
import { voiceDefects } from './media'
import type { Defect } from './types'

/** The provider's times as the review's words. */
export const asWords = (words: readonly TimedWord[]): Word[] =>
  words.filter((w) => w.word.trim() && w.end > w.start).map((w) => ({ w: w.word, start: w.start, end: w.end, sentence: 0, paragraph: 0 }))

/** The breaks inside words of one take (none when the provider gave no word times). */
export async function holesInTake(media: MediaService, file: string, words: readonly TimedWord[], signal: AbortSignal): Promise<Defect[]> {
  const w = asWords(words)
  if (w.length === 0) return []
  return voiceDefects(await energyEnvelope(media, file, signal), w).filter((d) => d.kind === 'audio_dropout')
}
