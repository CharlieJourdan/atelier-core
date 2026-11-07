// A timed film from any script, for the motion tests: every word lasts `wordS` seconds, a pause of 0.5 s ends a sentence and of 1 s a paragraph;
// the beats are the real ones (`splitBeats`), the outline a minimal one with the given title. Times are what a voice would give, deterministic.
import { Outline } from '../../src/engine/formats/outline'
import { FPS, type Word } from '../../src/engine/formats/timing'
import { BeatsParams, splitBeats } from '../../src/engine/nodes/beats-split'
import { anchorOf, parseScript, type ParsedScript } from '../../src/engine/text/script'
import type { Film } from './film-fixture'

export interface MotionFilm extends Film {
  parsed: ParsedScript
}

export function filmOf(script: string, o: { title?: string; wordS?: number } = {}): MotionFilm {
  const parsed = parseScript(script)
  const wordS = o.wordS ?? 0.33
  const lastOfPara = new Set(parsed.sentences.filter((s, k) => parsed.sentences[k + 1]?.paragraph !== s.paragraph).map((s) => s.last))
  const lastOfSentence = new Set(parsed.sentences.map((s) => s.last))
  let t = 0.3
  const words: Word[] = parsed.tokens.map((tok, i) => {
    const start = t
    t += wordS
    const w: Word = { w: tok.w, start: Math.round(start * 1000) / 1000, end: Math.round(t * 1000) / 1000, sentence: tok.sentence, paragraph: tok.paragraph }
    t += lastOfPara.has(i) ? 1 : lastOfSentence.has(i) ? 0.5 : 0.02
    return w
  })
  const durationS = Math.ceil(((words.at(-1) as Word).end + 0.4) * FPS) / FPS
  const outline = Outline.parse({
    language: 'fr',
    title: o.title ?? 'Le phare d’Ouessant',
    shape: 'chronicle',
    kind: 'story',
    promise: 'Comprendre.',
    hook: parsed.sentences[0]?.text ?? 'Début',
    beats: [{ index: 0, purpose: 'hook', summary: 'début', wordBudget: 100, tags: ['hook'], anchor: anchorOf(parsed.sentences[0]?.text ?? '') }],
    chapters: []
  })
  const beats = splitBeats(parsed.paragraphs.join('\n\n'), words, outline, durationS, BeatsParams.parse({}))
  return { script, words, durationS, outline, beats, parsed }
}
