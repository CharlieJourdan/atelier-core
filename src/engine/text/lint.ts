// Deterministic checks and clean-up of a narration script (docs/ENGINE-SPEC.md §17.4 steps 1 and 2), plus the speaking
// rate per language (R17.1) and a tiny offline language detector (R17.5: "language line first" is checked, not trusted).
import { countWords, normWord, parseScript } from './script'

/** Words per minute of a calm documentary narrator, by language (R17.1). */
export function wpmFor(lang: string): number {
  const code = lang.toLowerCase().split(/[-_]/)[0] ?? ''
  if (['fr', 'en', 'es'].includes(code)) return 150
  if (['it', 'pt'].includes(code)) return 145
  if (code === 'nl') return 140
  if (code === 'de') return 125
  if (['pl', 'cs', 'sk', 'ru', 'uk', 'hu'].includes(code)) return 120
  return 140
}

/**
 * Words per minute measured on dense avatar narration (docs/specs/pipeline-avatar.md §2.2: the 18 reference channels and
 * Headcast, median per language rounded to 5; Spanish is our estimate). The default of `script.write@2` until the channel's
 * own rate is measured; other languages fall back on `wpmFor`.
 */
export function wpmMeasured(lang: string): number {
  const code = lang.toLowerCase().split(/[-_]/)[0] ?? ''
  const table: Record<string, number> = { fr: 180, en: 180, de: 155, it: 145, pt: 145, pl: 130, es: 160 }
  return table[code] ?? wpmFor(lang)
}

/** Reply lines that only introduce the script ("Here is the script:", « Voici le script : »). */
const PREAMBLE = /^(?:sure|certainly|of course|okay|ok|here(?:'s| is| are)|below is|voici|voilà|bien sûr|d['’]accord|absolument|avec plaisir)\b/iu
/** Closing offers and remarks after the script. */
const TRAILER =
  /^(?:let me know|would you like|i can (?:also|further)|feel free|hope this|n['’]hésite|souhaites?-tu|souhaitez-vous|veux-tu que|voulez-vous|dis-moi si|dites-moi si|j['’]espère que)/iu
/** Lines addressed to an editor or to the user, not to the viewer. */
const EDITOR_LINE =
  /^\(?\s*(?:note|nb|n\.b\.|editor|éditeur|monteur|to the editor|for the editor|pour le monteur|à l['’]éditeur|word count|nombre de mots)\b/iu

/**
 * Cleans a model reply into narration only (§17.4 step 1): preamble, trailing offers, code fences, Markdown headings, rules,
 * list markers and emphasis, bracketed stage directions and lines addressed to an editor. Paragraphs stay separated by a
 * blank line.
 */
export function cleanScript(text: string): string {
  let lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
  // code fences: keep what is inside, drop the fence lines
  lines = lines.filter((l) => !/^(?:```|~~~)/.test(l))
  // preamble: leading short lines that introduce the script
  const firstReal = (): number => lines.findIndex((l) => l !== '')
  for (;;) {
    const i = firstReal()
    const l = i >= 0 ? (lines[i] ?? '') : ''
    if (i >= 0 && l.length <= 200 && (PREAMBLE.test(l) || (/:$/.test(l) && /^(?:script|narration|texte|voix off)\b/iu.test(l)))) lines.splice(i, 1)
    else break
  }
  // trailing offers: from the first trailer line on, when it sits in the last part of the text
  const trailAt = lines.findIndex((l, k) => TRAILER.test(l) && k >= Math.floor(lines.length * 0.5))
  if (trailAt >= 0) lines = lines.slice(0, trailAt)
  const out: string[] = []
  for (let l of lines) {
    if (/^#{1,6}\s/.test(l) || /^(?:[-*_]\s*){3,}$/.test(l) || EDITOR_LINE.test(l)) {
      out.push('')
      continue
    }
    l = l.replace(/^>\s?/, '').replace(/^(?:[-*•]|\d+[.)])\s+/u, '')
    l = l.replace(/\[[^\]\n]*\]/g, ' ')
    l = l.replace(/`([^`]*)`/g, '$1')
    l = l.replace(/(\*\*|__)(.+?)\1/g, '$2')
    l = l.replace(/(?<![\p{L}\p{N}*])\*(?!\s)(.+?)(?<!\s)\*(?![\p{L}\p{N}*])/gu, '$1')
    l = l.replace(/(?<![\p{L}\p{N}_])_(?!\s)(.+?)(?<!\s)_(?![\p{L}\p{N}_])/gu, '$1')
    out.push(l.replace(/\s+/g, ' ').trim())
  }
  return out
    .join('\n')
    .replace(/\n{2,}/g, '\n\n')
    .trim()
}

/** Quantities the lint measures and the thresholds it applies (§17.4 step 2). */
export const LINT_LIMITS = {
  avgSentenceMax: 16.5,
  avgSentenceMin: 6,
  longSentenceWords: 25,
  longShareMax: 0.1,
  questionShareMax: 0.15,
  exclamationShareMax: 0.05,
  numbersPer100Max: 2.5,
  bandLow: 0.9,
  bandHigh: 1.12
} as const

export interface LintResult {
  words: number
  /** Target words W, when known. */
  targetWords: number | null
  lengthRatio: number | null
  sentences: number
  avgSentenceWords: number
  /** Share of sentences longer than 25 words (0..1). */
  longShare: number
  forbiddenHits: { stem: string; count: number }[]
  /** Shares of sentences that are questions / exclamations (0..1). */
  questionDensity: number
  exclamationDensity: number
  /** Openings (first word) used by three or more sentences in a row. */
  repeatedOpenings: string[]
  numbersPer100: number
  /** Short English codes of the checks that failed (the gate card words them in French). */
  failures: string[]
}

const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d

/** Sentences (by index) that contain a word starting with one of the forbidden stems. */
export function forbiddenSentences(text: string, stems: readonly string[]): { index: number; text: string; stems: string[] }[] {
  const wanted = stems.map((s) => normWord(s)).filter(Boolean)
  const parsed = parseScript(text)
  const out: { index: number; text: string; stems: string[] }[] = []
  for (const s of parsed.sentences) {
    const norm = parsed.tokens.slice(s.first, s.last + 1).map((t) => normWord(t.w))
    const hit = wanted.filter((w) => norm.some((n) => n.startsWith(w)))
    if (hit.length > 0) out.push({ index: s.index, text: s.text, stems: hit })
  }
  return out
}

/** The deterministic lint of a script. `targetWords` enables the length ratio; `forbidden` is a list of stems. */
export function lintScript(text: string, o: { targetWords?: number; forbidden?: readonly string[] } = {}): LintResult {
  const parsed = parseScript(text)
  const words = countWords(text)
  const sentences = parsed.sentences.length
  const lens = parsed.sentences.map((s) => countWords(s.text))
  const avg = sentences > 0 ? lens.reduce((a, b) => a + b, 0) / sentences : 0
  const longShare = sentences > 0 ? lens.filter((n) => n > LINT_LIMITS.longSentenceWords).length / sentences : 0
  const stems = (o.forbidden ?? []).map((s) => normWord(s)).filter(Boolean)
  const norm = parsed.tokens.map((t) => normWord(t.w))
  const forbiddenHits = stems
    .map((stem) => ({ stem, count: norm.filter((n) => n.startsWith(stem)).length }))
    .filter((h) => h.count > 0)
  const q = parsed.sentences.filter((s) => /\?[»"”’)\]]*$/u.test(s.text)).length
  const e = parsed.sentences.filter((s) => /![»"”’)\]]*$/u.test(s.text)).length
  const repeated: string[] = []
  let run = 1
  for (let i = 1; i < sentences; i++) {
    const a = normWord(parsed.sentences[i - 1]?.text.split(' ')[0] ?? '')
    const b = normWord(parsed.sentences[i]?.text.split(' ')[0] ?? '')
    run = a !== '' && a === b ? run + 1 : 1
    if (run === 3 && !repeated.includes(b)) repeated.push(b)
  }
  const numbers = parsed.tokens.filter((t) => /\d/.test(t.w)).length
  const numbersPer100 = words > 0 ? (numbers / words) * 100 : 0
  const target = o.targetWords && o.targetWords > 0 ? o.targetWords : null
  const ratio = target ? words / target : null
  const failures: string[] = []
  if (ratio !== null && (ratio < LINT_LIMITS.bandLow || ratio > LINT_LIMITS.bandHigh)) failures.push('length')
  if (sentences > 0 && (avg > LINT_LIMITS.avgSentenceMax || avg < LINT_LIMITS.avgSentenceMin)) failures.push('sentence_length')
  if (longShare >= LINT_LIMITS.longShareMax) failures.push('long_sentences')
  if (forbiddenHits.length > 0) failures.push('forbidden')
  if (sentences > 0 && q / sentences > LINT_LIMITS.questionShareMax) failures.push('questions')
  if (sentences > 0 && e / sentences > LINT_LIMITS.exclamationShareMax) failures.push('exclamations')
  if (repeated.length > 0) failures.push('repeated_openings')
  if (numbersPer100 > LINT_LIMITS.numbersPer100Max) failures.push('numbers')
  return {
    words,
    targetWords: target,
    lengthRatio: ratio === null ? null : round(ratio, 3),
    sentences,
    avgSentenceWords: round(avg),
    longShare: round(longShare, 3),
    forbiddenHits,
    questionDensity: sentences > 0 ? round(q / sentences, 3) : 0,
    exclamationDensity: sentences > 0 ? round(e / sentences, 3) : 0,
    repeatedOpenings: repeated,
    numbersPer100: round(numbersPer100),
    failures
  }
}

const SW: Record<'fr' | 'en' | 'es' | 'de', Set<string>> = {
  fr: new Set(
    'le la les des une du de et est sont dans pour qui que ce cette ces il elle ils elles nous vous au aux avec sans sur pas mais ou où ont être été plus son sa ses leur leurs mon ma comme tout très aussi par en je tu se ne'.split(' ')
  ),
  en: new Set(
    'the and of to in is was that it for with as by he she they his her this are were be at from not had have which but or an their its you we i what when who will would there been has one all'.split(' ')
  ),
  es: new Set('el los las del y es una por con para su se lo como más pero que de la en un al fue son sus este esta muy ya o'.split(' ')),
  de: new Set('der die das und ist nicht ein eine mit den von zu dem des auf für im sich auch es war sind wie aber oder wir sie er'.split(' '))
}

/** Rough language of a text from stop-word frequencies: `fr`, `en`, or `other` (also when the text is too short to tell). */
export function detectLanguage(text: string): 'fr' | 'en' | 'other' {
  const toks = text.split(/\s+/).map(normWord).filter(Boolean)
  if (toks.length < 5) return 'other'
  const score = (lang: keyof typeof SW): number => toks.filter((t) => SW[lang].has(t)).length / toks.length
  const ranked = (Object.keys(SW) as (keyof typeof SW)[]).map((l) => ({ l, s: score(l) })).sort((a, b) => b.s - a.s)
  const [best, second] = ranked
  if (!best || best.s < 0.15 || (second && best.s < second.s * 1.25)) return 'other'
  return best.l === 'fr' || best.l === 'en' ? best.l : 'other'
}
