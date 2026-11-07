// solidite: word captions stay on the voice at any speech rate. A narration with KNOWN word times (tones, one per word,
// lengths by syllables, 0.06 s between words, 0.2 s between sentences — what voice.trim leaves) is finished at 150, 230,
// 310 and 400 words a minute (the voice slowed down or sped up, pitch kept), then cut into one-word captions. Each
// sentence's first caption starts within SENTENCE_TOLERANCE_S of its word in the final audio at every rate, so the
// captions never drift; any caption within WORD_TOLERANCE_S. Before the fix, at 310 wpm (story-short@1) the sped-up
// 0.12 s pauses were inaudible to the aligner and the captions drifted further each sentence.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { writeWav } from '../../src/engine/media/wav'
import { finishVoice } from '../../src/engine/nodes/voice-common'
import { wordCues } from '../../src/engine/text/captions'
import { syllables } from '../../src/engine/text/align'
import { parseScript } from '../../src/engine/text/script'
import { NO_FFMPEG, hasFfmpeg, makeCtx, testServices } from './engine-node-helpers'

/** How far a sentence's first caption may start from its word (a frame and a half at 30 fps). */
const SENTENCE_TOLERANCE_S = 0.05
/** How far any caption may start from its word: inside a sentence, without a recogniser, about one word. */
const WORD_TOLERANCE_S = 0.4

const SCRIPT = [
  'Mon voisin a garé sa voiture devant mon garage pendant trois semaines.',
  'Chaque matin, je devais attendre une heure avant de partir travailler.',
  'Un jour, j’ai décidé de laisser un petit mot très poli sur son pare-brise.',
  'Le lendemain, la voiture avait disparu, mais une lettre m’attendait.',
  'Il me demandait pardon et m’invitait à dîner le samedi suivant.',
  'Nous sommes devenus amis, et il gare maintenant sa voiture chez lui.'
].join(' ')

const RATE = 48_000
const dir = mkdtempSync(path.join(tmpdir(), 'caption-sync-'))
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

/** The natural-speed narration and its true word starts (seconds). */
function narration(): { samples: Float32Array; starts: number[] } {
  const tokens = parseScript(SCRIPT).tokens
  const parts: number[] = []
  const starts: number[] = []
  const silence = (s: number): void => void parts.push(...new Array<number>(Math.round(s * RATE)).fill(0))
  silence(0.2)
  tokens.forEach((tok, i) => {
    starts.push(parts.length / RATE)
    // real speech is not the aligner's model: each word 0.6× to 1.5× its syllable length (fixed, so the test is stable)
    const n = Math.round(0.11 * (syllables(tok.w) + 0.3) * (0.6 + ((i * 7919) % 10) / 11) * RATE)
    for (let k = 0; k < n; k++) parts.push(0.3 * Math.min(1, k / 240, (n - k) / 240) * Math.sin((2 * Math.PI * (180 + 40 * (i % 3)) * k) / RATE))
    const sentenceEnd = /[.!?]$/.test(tok.w) || tokens[i + 1]?.sentence !== tok.sentence
    if (i < tokens.length - 1) silence(sentenceEnd ? 0.2 : 0.06)
  })
  silence(0.2)
  return { samples: Float32Array.from(parts), starts }
}

describe.skipIf(!hasFfmpeg)('word captions stay on the voice at any speech rate', () => {
  for (const wpm of [150, 230, 310, 400]) {
    it(`${wpm} words a minute`, { timeout: 120_000 }, async () => {
      if (!hasFfmpeg) throw new Error(NO_FFMPEG)
      const work = path.join(dir, String(wpm))
      const raw = path.join(work, 'raw.wav')
      const { samples, starts } = narration()
      const { mkdir } = await import('node:fs/promises')
      await mkdir(work, { recursive: true })
      await writeWav(raw, samples, RATE)
      const out = await finishVoice(makeCtx(testServices(work)), { raw, script: SCRIPT, language: 'fr', dir: work, trim: true, pace: 'natural', targetS: 0, minMatch: 0.6, maxPauseS: 0.2, wpm, meta: {} })
      const factor = (out.audio as { meta: { fit: number } }).meta.fit
      const words = out.words.value as unknown as { w: string; start: number; end: number }[]
      expect(words).toHaveLength(starts.length)
      // the true starts in the final audio: the leading silence trimmed to 0.15 s, then the stretch
      const lead = 0.2 - 0.15
      const truth = starts.map((s) => (s - lead) / factor)
      const cues = wordCues(words as never, 0) // one caption per word
      const errors = cues.map((c, k) => Math.abs(c.start - (truth[k] as number)))
      // every sentence's first caption on its word: the anchors never drift along the narration (before the fix, at 310 wpm
      // they went 0.02 → 0.24 s off from the first sentence to the fourth)
      const firsts = parseScript(SCRIPT).tokens.map((tok, k, all) => (k === 0 || all[k - 1]?.sentence !== tok.sentence ? k : -1)).filter((k) => k >= 0)
      for (const k of firsts) expect(errors[k], `sentence starting at word ${k}, ×${factor.toFixed(2)}`).toBeLessThanOrEqual(SENTENCE_TOLERANCE_S)
      // inside a sentence the energy aligner spreads the words by syllables (words.align's recogniser narrows it): about a word
      expect(Math.max(...errors), `worst word at ×${factor.toFixed(2)}`).toBeLessThanOrEqual(WORD_TOLERANCE_S)
    })
  }
})
