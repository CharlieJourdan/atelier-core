// One way to read a narration script, shared by every stage that times it (docs/ENGINE-SPEC.md §17, §19, §20, §27):
// paragraphs are separated by a blank line, sentences end on . ! ? … (not inside a number or a short abbreviation), and
// a word is a whitespace-separated token kept in the script's own spelling and punctuation. The voice's `json.words`
// has exactly one entry per token, in this order, so captions and beats can always go back to the written form.

export interface ScriptToken {
  /** The token as written (`l'été,`). */
  w: string
  /** Global index of its sentence and of its paragraph. */
  sentence: number
  paragraph: number
  /** Several-voices scripts only (§19.5): the character who says it (upper case); absent = the narrator. */
  speaker?: string
}

export interface ScriptSentence {
  index: number
  paragraph: number
  text: string
  /** Index of its first and last token (inclusive). */
  first: number
  last: number
}

export interface ParsedScript {
  paragraphs: string[]
  sentences: ScriptSentence[]
  tokens: ScriptToken[]
  /** Several-voices scripts only: the characters in order of first appearance (the narrator is not listed). */
  speakers?: string[]
}

// ---- several voices (docs/ENGINE-SPEC.md §19.5) ------------------------------------------------------------------
// A line that starts with an UPPER-CASE name and a colon (`ALICE: Salut !`) gives the floor to that character until the next
// tag. The tag is never a word of the script: tokens, captions and beats see only what is said. A script is read this way
// only when it carries at least two different names, so a lone « NOTE: » or « ATTENTION: » in a narration stays text.

/** `NAME:` at the start of a line: upper-case letters, digits, spaces, `_ ' -`, at most 24 characters, then a colon and a space or the line end. */
const SPEAKER_TAG = /^[ \t]*(\p{Lu}[\p{Lu}\p{N}_' -]{0,23}?)[ \t]*:(?=[ \t]|$)[ \t]*(.*)$/u
/** Tags that give the floor back to the narrator (the default voice). */
const NARRATOR_NAMES = new Set(['NARRATEUR', 'NARRATRICE', 'NARRATOR', 'NARRATION', 'VOIX OFF'])

/** The canonical form of a character name: trimmed, one space between parts, upper case. */
export const speakerKey = (name: string): string => name.replace(/\s+/g, ' ').trim().toUpperCase()

function tagOf(line: string): { name: string; rest: string } | null {
  const m = SPEAKER_TAG.exec(line)
  if (!m) return null
  // the pattern only lets upper case through: « Note: » never matches, « NOTE: » does
  return { name: speakerKey(m[1] as string), rest: (m[2] as string).trim() }
}

/** Splits a script into paragraphs tagged by speaker, or null when it is not a several-voices script. */
function readSpeakers(text: string): { paragraphs: string[]; speakers: (string | undefined)[]; names: string[] } | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const seen = new Set<string>()
  for (const l of lines) {
    const t = tagOf(l)
    if (t) seen.add(t.name)
  }
  if (seen.size < 2) return null
  const paragraphs: string[] = []
  const speakers: (string | undefined)[] = []
  const names: string[] = []
  let speaker: string | undefined
  let current: string[] | null = null
  const flush = (): void => {
    if (!current) return
    const para = current.join(' ').replace(/\s+/g, ' ').trim()
    if (para) {
      paragraphs.push(para)
      speakers.push(speaker)
    }
    current = null
  }
  for (const line of lines) {
    const t = tagOf(line)
    if (t) {
      flush()
      speaker = NARRATOR_NAMES.has(t.name) ? undefined : t.name
      if (speaker && !names.includes(speaker)) names.push(speaker)
      current = t.rest ? [t.rest] : []
    } else if (line.trim() === '') flush()
    else (current ??= []).push(line)
  }
  flush()
  return { paragraphs, speakers, names }
}

/** Short abbreviations a sentence does not end on (French and English narration). */
const ABBREVIATIONS = new Set(['m', 'mm', 'mme', 'mlle', 'dr', 'st', 'ste', 'mr', 'mrs', 'ms', 'vs', 'etc', 'cf', 'p', 'av', 'apr', 'j.-c', 'no', 'n°'])

/** True when `token` closes a sentence. */
export function endsSentence(token: string): boolean {
  const t = token.replace(/[»"”’)\]]+$/u, '')
  if (!/[.!?…]$/u.test(t)) return false
  if (/[!?…]$/u.test(t)) return true
  const core = t.slice(0, -1).toLowerCase().replace(/^[«"“(]+/u, '')
  if (ABBREVIATIONS.has(core)) return false
  // a single letter with a dot is an initial ("J. Verne")
  return !/^\p{L}$/u.test(core)
}

/** Splits a script into paragraphs, sentences and tokens. Empty lines and surrounding spaces never make tokens. */
export function parseScript(text: string): ParsedScript {
  const multi = readSpeakers(text)
  const paragraphs = multi
    ? multi.paragraphs
    : text
        .replace(/\r\n?/g, '\n')
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter((p) => p.length > 0)
  const sentences: ScriptSentence[] = []
  const tokens: ScriptToken[] = []
  paragraphs.forEach((para, pi) => {
    const words = para.split(' ')
    const speaker = multi?.speakers[pi]
    let start = tokens.length
    for (const [k, w] of words.entries()) {
      tokens.push({ w, sentence: sentences.length, paragraph: pi, ...(speaker ? { speaker } : {}) })
      if (endsSentence(w) || k === words.length - 1) {
        const last = tokens.length - 1
        const text = tokens.slice(start, last + 1).map((t) => t.w).join(' ')
        sentences.push({ index: sentences.length, paragraph: pi, text, first: start, last })
        start = tokens.length
      }
    }
  })
  return { paragraphs, sentences, tokens, ...(multi ? { speakers: multi.names } : {}) }
}

/** A run of paragraphs said by one voice (`speaker` absent = the narrator): the unit the voice is synthesised in. */
export interface SpeakerSegment {
  speaker?: string
  /** First and last paragraph (inclusive) and their tokens. */
  paragraphs: [number, number]
  first: number
  last: number
}

/** Maximal runs of consecutive paragraphs with the same speaker; empty for a single-voice script. */
export function speakerSegments(parsed: ParsedScript): SpeakerSegment[] {
  if (!parsed.speakers) return []
  const out: SpeakerSegment[] = []
  parsed.tokens.forEach((t, i) => {
    const cur = out.at(-1)
    if (cur && cur.speaker === t.speaker) {
      cur.last = i
      cur.paragraphs[1] = t.paragraph
    } else out.push({ ...(t.speaker ? { speaker: t.speaker } : {}), paragraphs: [t.paragraph, t.paragraph], first: i, last: i })
  })
  return out
}

/** Lower case, accents removed, punctuation dropped: the form two spellings of one word share (alignment, anchors). */
export function normWord(w: string): string {
  return w
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, '')
    .replace(/^'+|'+$/g, '')
}

/** The anchor of a sentence: its first ~8 words, as written (R17 outputs). */
export function anchorOf(sentence: string, words = 8): string {
  return sentence.split(/\s+/).filter(Boolean).slice(0, words).join(' ')
}

/** Index of the sentence an anchor points at (exact on normalised words, else the best prefix match ≥ 4 words). */
export function findAnchor(parsed: ParsedScript, anchor: string): number | null {
  const want = anchor.split(/\s+/).map(normWord).filter(Boolean)
  if (want.length === 0) return null
  let best: { index: number; score: number } | null = null
  for (const s of parsed.sentences) {
    const have = parsed.tokens.slice(s.first, s.last + 1).map((t) => normWord(t.w)).filter(Boolean)
    let k = 0
    while (k < want.length && k < have.length && want[k] === have[k]) k++
    if (k === want.length || (k === have.length && k > 0)) return s.index
    if (k >= Math.min(4, want.length) && (!best || k > best.score)) best = { index: s.index, score: k }
  }
  return best?.index ?? null
}

/** Words of a text (whitespace tokens with at least one letter or digit). */
export const countWords = (text: string): number => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/** A word without its elided article or pronoun: « l'île » → « île », « d’Elbe » → « Elbe ». */
export const bareWord = (w: string): string => w.replace(/^(?:[ldjmnstc]|qu|jusqu|lorsqu|puisqu)['’]/iu, '')

/** Function words a caption line must not end on, and that carry no meaning for search (fr + en). */
export const STOP_WORDS = new Set(
  (
    'le la les un une des du de d l au aux et ou mais donc or ni car que qui quoi dont où ce cet cette ces son sa ses leur leurs ' +
    'mon ma mes ton ta tes notre nos votre vos il elle ils elles on nous vous je tu se s y en ne pas plus très à a dans par pour sur ' +
    'avec sans sous entre vers chez est sont été être avoir ont fait comme si tout tous toute toutes même aussi puis alors ' +
    'the a an and or but of to in on at by for with from into as is are was were be been it its this that these those he she ' +
    'they we you i his her their our your not no so than then there here which who whom what when where how'
  ).split(' ')
)

/**
 * Key terms of a passage (§20 `keyTerms`): numbers and years, capitalised words that do not open a sentence (names,
 * places), and the longest content words. Deterministic, at most `max`.
 */
export function keyTerms(tokens: readonly string[], max = 6): string[] {
  const out: string[] = []
  const add = (t: string): void => {
    if (t && !out.some((o) => normWord(o) === normWord(t))) out.push(t)
  }
  const clean = (w: string): string => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  tokens.forEach((raw, i) => {
    const w = bareWord(clean(raw))
    if (/\p{N}/u.test(w)) add(w)
    else if (i > 0 && /^\p{Lu}/u.test(w) && !endsSentence(tokens[i - 1] ?? '') && w.length > 1 && !STOP_WORDS.has(normWord(w))) add(w)
  })
  // content words: long, not a function word, not an adverb (-ment, -ly), not a verb with a pronoun (« sait-on »)
  const content = tokens
    .map((t) => bareWord(clean(t)))
    .filter((w) => w.length >= 5 && !STOP_WORDS.has(normWord(w)) && !/^\p{Lu}/u.test(w) && !/(?:ment|ly)$/u.test(w) && !/-(?:on|il|elle|ils|elles|je|tu|nous|vous|t)$/u.test(w))
  const freq = new Map<string, number>()
  for (const w of content) freq.set(w.toLowerCase(), (freq.get(w.toLowerCase()) ?? 0) + 1)
  const ranked = [...freq.keys()].sort((a, b) => (freq.get(b) as number) - (freq.get(a) as number) || b.length - a.length || (a < b ? -1 : 1))
  for (const w of ranked) add(w)
  return out.slice(0, max)
}
