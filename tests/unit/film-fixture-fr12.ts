// A 12-minute French narration for the mix director (production-6): sentences of 5 to 25 words with commas, figures in
// digits and in words, objects that come back (le levain, la boîte en bois), a paragraph every 4 sentences, ~180 words a
// minute; its word times, outline (hook, chapters) and beats.
import { seededRandom } from '../../src/engine/errors'
import { Outline } from '../../src/engine/formats/outline'
import { FPS, type Word } from '../../src/engine/formats/timing'
import { BeatsParams, splitBeats } from '../../src/engine/nodes/beats-split'
import { anchorOf, parseScript } from '../../src/engine/text/script'
import type { Film } from './film-fixture'

const SUBJECTS = [
  'Le levain', 'La boîte en bois', 'Le torchon en lin', 'Une vieille astuce de boulanger', 'Le congélateur', 'La croûte',
  'La mie', 'Une tranche grillée', 'La farine de seigle', 'Le four de Marseille', 'Le sac en papier', 'La cuisine en été'
]
const VERBS = ['change tout', 'garde l’humidité', 'protège la croûte', 'évite la moisissure', 'sauve le petit déjeuner', 'tient trois jours de plus', 'coûte moins de 2 euros', 'surprend tout le monde']
const TAILS = [
  'quand la cuisine est chaude', 'si on le coupe au bon moment', 'à condition de le retourner chaque soir', 'comme le faisaient nos grands-parents',
  'même en plein mois d’août', 'avec un simple geste', 'sans rien acheter de plus', 'pendant 48 heures', 'dans 9 maisons sur 10', 'grâce à une astuce oubliée'
]
const SHORT = ['Et ça marche.', 'Voilà le secret.', 'Regardez bien.', 'C’est tout.']

/** About `targetS` seconds of narration (12 minutes by default). */
export function makeFrenchFilm(targetS = 720, seed = 11): Film {
  const rnd = seededRandom(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T
  const sentences: string[] = []
  let words = 0
  while (words * 0.36 < targetS - 4) {
    const r = rnd()
    const s =
      r < 0.12
        ? pick(SHORT)
        : r < 0.55
          ? `${pick(SUBJECTS)} ${pick(VERBS)}, ${pick(TAILS)}.`
          : `${pick(SUBJECTS)} ${pick(VERBS)} ${pick(TAILS)}, et ${pick(SUBJECTS).toLowerCase()} ${pick(VERBS)}, ${pick(TAILS)}.`
    sentences.push(s)
    words += s.split(' ').length
  }
  const paras: string[] = []
  for (let i = 0; i < sentences.length; i += 4) paras.push(sentences.slice(i, i + 4).join(' '))
  const script = paras.join('\n\n')
  const parsed = parseScript(script)
  const lastOfPara = new Set(parsed.sentences.filter((s, k) => parsed.sentences[k + 1]?.paragraph !== s.paragraph).map((s) => s.last))
  const lastOfSentence = new Set(parsed.sentences.map((s) => s.last))
  let t = 0.3
  const timed: Word[] = parsed.tokens.map((tok, i) => {
    const start = t
    t += 0.3
    const w: Word = { w: tok.w, start: Math.round(start * 1000) / 1000, end: Math.round(t * 1000) / 1000, sentence: tok.sentence, paragraph: tok.paragraph }
    t += lastOfPara.has(i) ? 0.8 : lastOfSentence.has(i) ? 0.4 : /,$/.test(tok.w) ? 0.15 : 0.03
    return w
  })
  const durationS = Math.ceil(((timed.at(-1) as Word).end + 0.4) * FPS) / FPS
  const long = parsed.sentences.filter((s) => s.last - s.first >= 8)
  const outline = Outline.parse({
    language: 'fr',
    title: 'Garder son pain frais une semaine',
    shape: 'howto',
    kind: 'lesson',
    promise: 'Trois gestes pour ne plus jeter de pain.',
    hook: 'Le pain rassis, c’est fini.',
    beats: [
      { index: 0, purpose: 'hook', summary: 'accroche', wordBudget: 120, tags: ['hook'], anchor: anchorOf(parsed.sentences[0]?.text ?? '') },
      { index: 1, purpose: 'body', summary: 'méthode', wordBudget: 1800, tags: ['pivot'], anchor: anchorOf(((long[6] ?? long.at(-1)) as { text: string }).text) }
    ],
    chapters: [
      { title: 'Pourquoi il rassit', firstBeat: 0, anchor: anchorOf(((long[1] ?? long.at(-1)) as { text: string }).text) },
      { title: 'Les gestes', firstBeat: 1, anchor: anchorOf(((long[20] ?? long.at(-1)) as { text: string }).text) },
      { title: 'Le congélateur', firstBeat: 1, anchor: anchorOf((long[60] ?? (long.at(-1) as { text: string })).text) }
    ]
  })
  const beats = splitBeats(script, timed, outline, durationS, BeatsParams.parse({}))
  return { script, words: timed, durationS, outline, beats }
}
