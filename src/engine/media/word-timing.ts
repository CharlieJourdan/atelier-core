// Word timing for a voice (docs/ENGINE-SPEC.md §19.3): the time of every script word, in the script's spelling.
// Order of preference: the provider's own word times (when they line up with what was asked), then a speech recogniser
// matched word by word (sequence alignment), then the deterministic aligner on the audio's pauses (text/align.ts).
import type { Alignment, Word } from '../formats/timing'
import type { AsrService, MediaService, TimedWord } from '../services'
import { alignTokens, boundaryOf, type AlignToken } from '../text/align'
import { normWord, parseScript, type ParsedScript } from '../text/script'
import { spokenForms } from '../text/spoken'
import { energyEnvelope, speechRegions } from './probe'

/** The text sent to the voice: each paragraph's spoken forms, paragraphs separated by a blank line. */
export function spokenText(parsed: ParsedScript, lang: string): { text: string; forms: string[] } {
  const forms = spokenForms(parsed.tokens.map((t) => t.w), lang)
  const paras: string[][] = parsed.paragraphs.map(() => [])
  parsed.tokens.forEach((t, i) => {
    const f = forms[i] as string
    if (f) (paras[t.paragraph] as string[]).push(f)
  })
  return { text: paras.map((p) => p.join(' ')).join('\n\n'), forms }
}

/** Spoken words in order, each with the script token it belongs to. */
function spokenWords(forms: readonly string[]): { word: string; token: number }[] {
  const out: { word: string; token: number }[] = []
  forms.forEach((f, token) => {
    for (const w of f.split(/[\s]+/)) if (normWord(w)) out.push({ word: normWord(w), token })
  })
  return out
}

/**
 * Longest-common-subsequence match of two word lists (normalised): pairs of indexes. O(a × b) memory as bytes, fine for
 * a chunk-sized comparison and for a 10-minute script (~1 500 × 1 500).
 */
export function matchSequences(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length
  const m = b.length
  const L = new Uint16Array((n + 1) * (m + 1))
  const at = (i: number, j: number): number => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[at(i, j)] = a[i] === b[j] ? (L[at(i + 1, j + 1)] as number) + 1 : Math.max(L[at(i + 1, j)] as number, L[at(i, j + 1)] as number)
    }
  }
  const pairs: [number, number][] = []
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if ((L[at(i + 1, j)] as number) >= (L[at(i, j + 1)] as number)) i++
    else j++
  }
  return pairs
}

/** Token times from timed spoken words matched to the expected spoken words; unmatched tokens interpolated. */
function fromTimedWords(forms: readonly string[], heard: readonly TimedWord[], durationS: number): { times: ({ start: number; end: number } | null)[]; matched: number } {
  const expected = spokenWords(forms)
  const pairs = matchSequences(expected.map((e) => e.word), heard.map((h) => normWord(h.word)))
  const times: ({ start: number; end: number } | null)[] = forms.map(() => null)
  for (const [e, h] of pairs) {
    const tok = (expected[e] as { token: number }).token
    const hw = heard[h] as TimedWord
    const cur = times[tok]
    times[tok] = cur ? { start: Math.min(cur.start, hw.start), end: Math.max(cur.end, hw.end) } : { start: hw.start, end: Math.min(hw.end, durationS) }
  }
  return { times, matched: expected.length ? pairs.length / expected.length : 1 }
}

/**
 * Fills the tokens with no time between their timed neighbours, in proportion to their length, never across a pause
 * (R19.8): a gap longer than the words need keeps its silence after them.
 */
export function interpolate(times: ({ start: number; end: number } | null)[], forms: readonly string[], durationS: number): { start: number; end: number }[] {
  const out = times.slice()
  let i = 0
  while (i < out.length) {
    if (out[i]) {
      i++
      continue
    }
    let j = i
    while (j < out.length && !out[j]) j++
    const prevEnd = i > 0 ? (out[i - 1] as { end: number }).end : 0
    const nextStart = j < out.length ? (out[j] as { start: number }).start : durationS
    const lens = forms.slice(i, j).map((f) => Math.max(1, f.length))
    const total = lens.reduce((a, b) => a + b, 0)
    // the words need about 65 ms per character (≈ 150 words per minute); a longer gap holds a pause, which they do not
    // stretch across: they sit right after the previous word
    const from = prevEnd
    const to = Math.min(nextStart, prevEnd + Math.max(0.3, total * 0.065))
    let c = 0
    for (let k = i; k < j; k++) {
      const s = from + ((to - from) * c) / total
      c += lens[k - i] as number
      out[k] = { start: s, end: from + ((to - from) * c) / total }
    }
    i = j
  }
  return out as { start: number; end: number }[]
}

/** A recogniser's word pieces joined back (Whisper hears « L » + « 'an », « grand » + « -chose »): one word per spoken word. */
export function joinElisions(heard: readonly TimedWord[]): TimedWord[] {
  const out: TimedWord[] = []
  for (const h of heard) {
    const prev = out.at(-1)
    if (prev && /^['’-]/.test(h.word.trim())) out[out.length - 1] = { word: prev.word + h.word.trim(), start: prev.start, end: h.end }
    else out.push({ word: h.word.trim(), start: h.start, end: h.end })
  }
  return out
}

/**
 * The script's words timed on what a recogniser heard in the audio (`words.align`, record 0059): matched word by word, the
 * words it missed placed between their heard neighbours. `matched`: the share of spoken words it heard.
 */
export function wordsFromHeard(script: string, language: string, heard: readonly TimedWord[], durationS: number): { words: Word[]; matched: number } {
  const parsed = parseScript(script)
  const { forms } = spokenText(parsed, language)
  const r = fromTimedWords(forms, joinElisions(heard), durationS)
  const times = interpolate(r.times, forms, durationS)
  const words: Word[] = parsed.tokens.map((t, i) => {
    const tm = times[i] as { start: number; end: number }
    const start = Math.max(0, Math.min(durationS, round3(tm.start)))
    return { w: t.w, start, end: Math.max(start, Math.min(durationS, round3(tm.end))), sentence: t.sentence, paragraph: t.paragraph }
  })
  return { words, matched: round3(r.matched) }
}

export interface TimingResult {
  words: Word[]
  alignment: Alignment
  matched: number
}

/**
 * Times the words of `script` in `audio` (D = `durationS`). `provider`: word times returned with the audio, trusted only
 * if they cover ≥ 90 % of the spoken words and end within the audio (R19.3 join check). `asr`: a recogniser, if the
 * host has one. Otherwise the deterministic aligner. `minMatch` is the quality bar (0.9 TTS, 0.75 own recording).
 */
export async function timeWords(o: {
  script: string
  language: string
  audio: string
  durationS: number
  media: MediaService
  signal: AbortSignal
  provider?: TimedWord[]
  asr?: AsrService
  minMatch: number
}): Promise<TimingResult> {
  const parsed = parseScript(o.script)
  const { forms } = spokenText(parsed, o.language)
  let times: { start: number; end: number }[] | null = null
  let alignment: Alignment = 'aligned'
  let matched = 0
  if (o.provider && o.provider.length > 0) {
    const last = o.provider.at(-1) as TimedWord
    const r = fromTimedWords(forms, o.provider, o.durationS)
    if (r.matched >= 0.9 && last.end <= o.durationS + 0.15) {
      times = interpolate(r.times, forms, o.durationS)
      alignment = 'provider'
      matched = r.matched
    }
  }
  if (!times && o.asr) {
    const { words } = await o.asr.transcribe({ audio: o.audio, language: o.language }, o.signal)
    const r = fromTimedWords(forms, joinElisions(words), o.durationS)
    if (r.matched > 0) {
      times = interpolate(r.times, forms, o.durationS)
      alignment = 'asr'
      matched = r.matched
    }
  }
  if (!times) {
    const env = await energyEnvelope(o.media, o.audio, o.signal)
    const regions = speechRegions(env)
    const lastOfPara = new Set(parsed.sentences.filter((s, k) => parsed.sentences[k + 1]?.paragraph !== s.paragraph).map((s) => s.last))
    const lastOfSentence = new Set(parsed.sentences.map((s) => s.last))
    const tokens: AlignToken[] = parsed.tokens.map((t, i) => ({
      spoken: forms[i] as string,
      boundary: boundaryOf(t.w, lastOfSentence.has(i), lastOfPara.has(i))
    }))
    const r = alignTokens(tokens, regions, o.durationS)
    times = r.times
    matched = r.matched
    alignment = regions.length === 0 ? 'estimated' : 'aligned'
  }
  if (matched < o.minMatch && alignment !== 'estimated') alignment = 'weak'
  const words: Word[] = parsed.tokens.map((t, i) => {
    const tm = (times as { start: number; end: number }[])[i] as { start: number; end: number }
    const start = Math.max(0, Math.min(o.durationS, round3(tm.start)))
    return { w: t.w, start, end: Math.max(start, Math.min(o.durationS, round3(tm.end))), sentence: t.sentence, paragraph: t.paragraph }
  })
  return { words, alignment, matched: round3(matched) }
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000
