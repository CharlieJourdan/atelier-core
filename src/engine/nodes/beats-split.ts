// `beats.split@1` (docs/ENGINE-SPEC.md §20): the script cut into timed beats of ~2–10 s that cover [0, D] with no gap
// and no overlap (a silence belongs to the beat before it). Sentences are the base unit; short ones merge with a
// neighbour of the same paragraph, long ones split at clause marks. The outline's tags and chapters are carried onto
// the beats (by anchor), with key terms for the director and the allowed cut points inside each beat. Deterministic:
// its fake is itself.
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { EngineError } from '../errors'
import { Outline } from '../formats/outline'
import { WordsMeta, WordsValue, framesFor, type Beat, type BeatsMeta, type Tag, type Word } from '../formats/timing'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { findAnchor, keyTerms, parseScript } from '../text/script'
import type { Json } from '../types'
import { readText, readValue } from './common'

export const BeatsParams = z.object({
  minBeatS: z.number().min(0.5).max(5).default(2),
  maxBeatS: z.number().min(4).max(20).default(10),
  leadMs: z.number().int().min(0).max(300).default(80)
})
type Params = z.infer<typeof BeatsParams>

/** A run of consecutive words [a, z] (inclusive) that will become one beat. */
interface Span {
  a: number
  z: number
}

const CLAUSE = /[,;:—–]["»”’)]*$/u
const CONJUNCTIONS = new Set(['et', 'mais', 'donc', 'car', 'puis', 'alors', 'and', 'but', 'so', 'because', 'then', 'while', 'qui', 'que', 'which'])

const lengthOf = (words: readonly Word[], s: Span): number => (words[s.z] as Word).end - (words[s.a] as Word).start

/** Splits a long span at clause marks (or a conjunction after ≥ 4 words) into parts of ~5–10 s, none under 3 s. */
function splitLong(words: readonly Word[], s: Span, maxS: number): Span[] {
  if (lengthOf(words, s) <= maxS) return [s]
  const cuts: number[] = []
  for (let k = s.a + 3; k < s.z; k++) {
    const w = (words[k] as Word).w
    const next = (words[k + 1] as Word).w.toLowerCase()
    if (CLAUSE.test(w) || CONJUNCTIONS.has(next)) cuts.push(k)
  }
  // choose the cut closest to the middle that leaves both sides ≥ 3 s, then recurse
  const mid = ((words[s.a] as Word).start + (words[s.z] as Word).end) / 2
  let best: number | null = null
  for (const k of cuts) {
    const left = (words[k] as Word).end - (words[s.a] as Word).start
    const right = (words[s.z] as Word).end - (words[k + 1] as Word).start
    if (left < 3 || right < 3) continue
    if (best === null || Math.abs((words[k] as Word).end - mid) < Math.abs((words[best] as Word).end - mid)) best = k
  }
  if (best === null) return [s]
  return [...splitLong(words, { a: s.a, z: best }, maxS), ...splitLong(words, { a: best + 1, z: s.z }, maxS)]
}

/** Spans of words for the beats: sentences, short ones merged, long ones split. */
export function beatSpans(words: readonly Word[], p: Params): Span[] {
  const sentences: Span[] = []
  words.forEach((w, i) => {
    const last = sentences.at(-1)
    if (last && (words[last.z] as Word).sentence === w.sentence) last.z = i
    else sentences.push({ a: i, z: i })
  })
  const merged: Span[] = []
  for (const s of sentences) {
    const prev = merged.at(-1)
    const samePara = prev && (words[prev.a] as Word).paragraph === (words[s.a] as Word).paragraph
    const short = (x: Span): boolean => lengthOf(words, x) < p.minBeatS
    if (prev && samePara && (short(prev) || short(s)) && (words[s.z] as Word).end - (words[prev.a] as Word).start <= p.maxBeatS) prev.z = s.z
    else merged.push({ ...s })
  }
  return merged.flatMap((s) => splitLong(words, s, p.maxBeatS))
}

export function splitBeats(script: string, words: readonly Word[], outline: Outline | null, durationS: number, p: Params): Beat[] {
  const parsed = parseScript(script)
  if (parsed.tokens.length !== words.length) {
    throw new EngineError('bad_input', `the word times (${words.length}) do not match the script (${parsed.tokens.length} words)`)
  }
  for (let k = 1; k < words.length; k++) {
    if ((words[k] as Word).start < (words[k - 1] as Word).start) throw new EngineError('bad_input', `word times go backwards at word ${k}`)
  }
  const spans = beatSpans(words, p)
  const lead = p.leadMs / 1000
  // tags by sentence, from the outline (by anchor, never by index)
  const tagsBySentence = new Map<number, Set<Tag>>()
  const chapterBySentence = new Map<number, string>()
  const addTag = (s: number | null, t: Tag): void => {
    if (s === null) return
    const set = tagsBySentence.get(s) ?? new Set<Tag>()
    set.add(t)
    tagsBySentence.set(s, set)
  }
  if (outline) {
    const starts = outline.beats.map((b) => (b.anchor ? findAnchor(parsed, b.anchor) : null))
    outline.beats.forEach((b, k) => {
      const first = starts[k] ?? null
      for (const t of b.tags) {
        if (t === 'hook') {
          // the hook covers the whole first outline beat
          const end = starts.slice(k + 1).find((x) => x !== null) ?? parsed.sentences.length
          for (let s = first ?? 0; s < end; s++) addTag(s, 'hook')
        } else addTag(first, t)
      }
      for (const m of b.marks) addTag(findAnchor(parsed, m.anchor), m.tag)
    })
    for (const c of outline.chapters) {
      const s = c.anchor ? findAnchor(parsed, c.anchor) : null
      if (s !== null) chapterBySentence.set(s, c.title)
    }
  }
  return spans.map((s, i): Beat => {
    const ws = words.slice(s.a, s.z + 1)
    const sentenceIdx = [...new Set(ws.map((w) => w.sentence))]
    const tags = new Set<Tag>()
    let chapter: string | undefined
    for (const si of sentenceIdx) {
      for (const t of tagsBySentence.get(si) ?? []) tags.add(t)
      // a chapter starts on the beat holding the first word of its sentence
      const title = chapterBySentence.get(si)
      if (title && (words[(parsed.sentences[si] as { first: number }).first] as Word) === words[s.a]) chapter = title
    }
    if (chapter) tags.add('chapter')
    const next = spans[i + 1]
    const start = i === 0 ? 0 : Math.max(0, (words[s.a] as Word).start - lead)
    const end = next ? Math.max(start, (words[next.a] as Word).start - lead) : durationS
    // cut points: after a clause mark or a sentence end, or before a word that follows a pause ≥ 0.25 s
    const cutPoints: number[] = []
    for (let k = s.a; k < s.z; k++) {
      const w = words[k] as Word
      const n = words[k + 1] as Word
      if (CLAUSE.test(w.w) || /[.!?…]["»”’)]*$/u.test(w.w) || n.start - w.end >= 0.25) cutPoints.push(n.start)
    }
    return {
      i,
      text: ws.map((w) => w.w).join(' '),
      start: round3(start),
      end: round3(end),
      firstWord: s.a,
      lastWord: s.z,
      sentenceIdx,
      paragraph: (words[s.a] as Word).paragraph,
      ...(chapter ? { chapter } : {}),
      tags: [...tags],
      keyTerms: keyTerms(ws.map((w) => w.w)),
      cutPoints: cutPoints.map(round3)
    }
  })
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000

async function beatsRun(_ctx: RunCtx, inputs: ResolvedInputs, p: Params): Promise<NodeOutputs> {
  const script = readText(inputs.script, 'the script')
  const words = readValue(inputs.words, WordsValue, 'the word times')
  const meta = WordsMeta.safeParse(inputs.words?.meta)
  if (!meta.success) throw new EngineError('bad_input', 'the word times have no duration')
  const outline = inputs.outline ? readValue(inputs.outline, Outline, 'the outline') : null
  const beats = splitBeats(script, words, outline, meta.data.durationS, p)
  const bm: BeatsMeta = { durationS: meta.data.durationS, frames: framesFor(meta.data.durationS), weak: meta.data.alignment === 'weak' }
  return { beats: { value: beats as unknown as Json, meta: { ...bm, count: beats.length } } }
}

export const beatsSplit = defineNode({
  type: 'beats.split@1',
  inputs: {
    script: { type: 'text.script', required: true },
    words: { type: 'json.words', required: true },
    outline: { type: 'json.outline', required: true }
  },
  outputs: { beats: 'json.beats' },
  params: BeatsParams,
  executors: ['local'],
  estimate: () => ({ units: [], durationS: 1 }),
  run: beatsRun,
  fake: beatsRun
})
