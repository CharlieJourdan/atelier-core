// A timed film for the director tests: a script of sentences of about 4.5 s (with commas), its word times, its outline and its beats.
import { Outline } from '../../src/engine/formats/outline'
import { FPS, type Beat, type Word } from '../../src/engine/formats/timing'
import { BeatsParams, splitBeats } from '../../src/engine/nodes/beats-split'
import { anchorOf, parseScript } from '../../src/engine/text/script'

const PLACES = ['Valmont', 'Brest', 'Lyon', 'Verdun', 'Marseille', 'Rouen', 'Nantes', 'Reims']

export interface Film {
  script: string
  words: Word[]
  durationS: number
  outline: Outline
  beats: Beat[]
}

/** Sentences of ~4.5 s (with commas), every third one very short, a paragraph every 4 sentences. */
export function makeFilm(targetS: number): Film {
  const sentences: string[] = []
  let estimate = 0
  for (let i = 0; estimate < targetS - 2; i++) {
    const s =
      i % 3 === 2
        ? 'Rien ne bougeait.'
        : `Au matin ${i + 1}, ${PLACES[i % PLACES.length] as string} voyait partir ${100 + i * 7} hommes vers ${PLACES[(i + 3) % PLACES.length] as string}, sans un bruit.`
    sentences.push(s)
    estimate += s.split(' ').length * 0.35 + (i % 4 === 3 ? 1 : 0.5)
  }
  const paras: string[] = []
  for (let i = 0; i < sentences.length; i += 4) paras.push(sentences.slice(i, i + 4).join(' '))
  const script = paras.join('\n\n')
  const parsed = parseScript(script)
  const lastOfPara = new Set(parsed.sentences.filter((s, k) => parsed.sentences[k + 1]?.paragraph !== s.paragraph).map((s) => s.last))
  const lastOfSentence = new Set(parsed.sentences.map((s) => s.last))
  let t = 0.4
  const words: Word[] = parsed.tokens.map((tok, i) => {
    const start = t
    t += 0.33
    const w: Word = { w: tok.w, start: Math.round(start * 1000) / 1000, end: Math.round(t * 1000) / 1000, sentence: tok.sentence, paragraph: tok.paragraph }
    t += lastOfPara.has(i) ? 1 : lastOfSentence.has(i) ? 0.5 : 0.02
    return w
  })
  const durationS = Math.ceil(((words.at(-1) as Word).end + 0.4) * FPS) / FPS
  const long = parsed.sentences.filter((s) => s.last - s.first >= 8)
  const outline = Outline.parse({
    language: 'fr',
    title: 'La marche des hommes',
    shape: 'chronicle',
    kind: 'story',
    promise: 'Comprendre pourquoi ils partirent.',
    hook: 'Au matin, ils partent.',
    beats: [
      { index: 0, purpose: 'hook', summary: 'départ', wordBudget: 100, tags: ['hook'], anchor: anchorOf(parsed.sentences[0]?.text ?? '') },
      { index: 1, purpose: 'body', summary: 'marche', wordBudget: 100, tags: ['pivot'], anchor: anchorOf((long[3] ?? long[0])?.text ?? '') }
    ],
    chapters: [
      { title: 'Le départ', firstBeat: 0, anchor: anchorOf((long[0] as { text: string }).text) },
      { title: 'La marche', firstBeat: 1, anchor: anchorOf((long[4] as { text: string }).text) },
      { title: 'Larrivée', firstBeat: 1, anchor: anchorOf((long[8] ?? long.at(-1) as { text: string }).text) }
    ]
  })
  const beats = splitBeats(script, words, outline, durationS, BeatsParams.parse({}))
  return { script, words, durationS, outline, beats }
}
