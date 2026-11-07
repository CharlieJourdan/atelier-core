// From spoken words to search needs. One `Need` per beat (a sentence of the script): what kind of picture the words call for (a
// `literal` one that shows the very thing named, an `illustrative` one that stands for an idea with a real, concrete thing, or
// none), its subject, era and person, and 2 to 4 search queries aimed at where such images really live (a newsreel archive, a
// national archive, an agency, an official channel), never generic stock wording. Claude (the user's subscription) writes them,
// 24 beats per call; an answer we cannot read falls back to the beat's own words, so a run is never blocked by a bad reply.
import type { AskClaude } from './rank.ts'

export interface Beat {
  /** Unique inside the script (« b12 »). */
  id: string
  text: string
  startS?: number
  endS?: number
}

export type NeedMode = 'literal' | 'illustrative' | 'none'

export interface Need {
  beat: string
  mode: NeedMode
  /** What the words are about, with its year or era when there is one. */
  subject: string
  /** A named person, only when the words name them. */
  person?: string
  era?: string
  /** The picture wanted, at most 15 words. */
  need: string
  /** 2 to 4 English queries of 3 to 9 words. */
  queries: string[]
  /** Source families worth asking first. */
  kinds: Array<'image' | 'video'>
}

export const NEEDS_BATCH = 24
const MAX_QUERIES = 4

const SYSTEM =
  'You are the media researcher of a documentary team. You receive numbered beats (one per spoken sentence) and, for each, you decide what real picture should be on screen and how to find it in public archives and footage libraries.\n' +
  'Per beat answer: mode = "literal" (the words name a thing, place, person or event: show that very thing), "illustrative" (an idea or abstraction: show a concrete real thing that stands for it, say which), or "none" (nothing to show: a greeting, a transition).\n' +
  'Also: subject (what it is about, with year or era), person (only if the words name one), era, need (the picture wanted, 15 words at most), kinds (["video"], ["image"] or both: footage for movement, a still for documents, portraits, maps), queries (2 to 4 English queries of 3 to 9 words).\n' +
  'Rules: a beat that says « he », « it » or « that year » must be given the subject of the beats around it. Beats about the same subject share the same queries. Aim the queries at where such images live (a newsreel archive, a national archive, a press agency, an official channel, a museum), with the place and the year; never write a generic stock-footage query such as « people walking ». ' +
  'When the subject belongs to a non-English country, give one of the queries in that country’s language. Never invent a person, a date or a place that the words do not support.\n' +
  'Answer ONLY with JSON: {"needs":[{"b":"<beat id>","mode":"literal|illustrative|none","subject":"","person":"","era":"","need":"","kinds":["video","image"],"queries":["",""]}]}'

const clean = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** What a beat becomes when Claude could not be read: its own words as the query, illustrative, both kinds. */
export function fallbackNeed(b: Beat): Need {
  const words = b.text.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 9).join(' ')
  return { beat: b.id, mode: 'illustrative', subject: words, need: words.split(' ').slice(0, 15).join(' '), queries: words ? [words] : [], kinds: ['video', 'image'] }
}

export function parseNeeds(text: string, beats: readonly Beat[], onFallback: (beat: string) => void = () => undefined): Need[] {
  let rows: unknown[]
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { needs?: unknown }
    rows = Array.isArray(parsed.needs) ? parsed.needs : []
  } catch {
    rows = []
  }
  const byBeat = new Map<string, Record<string, unknown>>()
  for (const r of rows) if (r && typeof r === 'object' && typeof (r as { b?: unknown }).b === 'string') byBeat.set((r as { b: string }).b, r as Record<string, unknown>)
  return beats.map((b): Need => {
    const r = byBeat.get(b.id)
    if (!r) return (onFallback(b.id), fallbackNeed(b))
    const mode: NeedMode = r.mode === 'literal' || r.mode === 'none' ? r.mode : 'illustrative'
    const queries = (Array.isArray(r.queries) ? r.queries : []).map((q) => clean(q, 120)).filter((q) => q.length >= 3).slice(0, MAX_QUERIES)
    const kinds = (Array.isArray(r.kinds) ? r.kinds : []).filter((k): k is 'image' | 'video' => k === 'image' || k === 'video')
    if (mode !== 'none' && queries.length === 0) return (onFallback(b.id), fallbackNeed(b))
    const person = clean(r.person, 80)
    const era = clean(r.era, 40)
    return { beat: b.id, mode, subject: clean(r.subject, 120), ...(person ? { person } : {}), ...(era ? { era } : {}), need: clean(r.need, 140), queries, kinds: kinds.length ? kinds : ['video', 'image'] }
  })
}

export interface PlanNeedsOptions {
  tier?: 'best' | 'balanced' | 'fast'
  batch?: number
  signal?: AbortSignal
  /** What the whole video is about, so a beat with a pronoun has an anchor. */
  topic?: string
}

export async function planNeeds(beats: readonly Beat[], claude: AskClaude, o: PlanNeedsOptions = {}): Promise<{ needs: Need[]; calls: number; failed: number }> {
  const size = Math.max(1, o.batch ?? NEEDS_BATCH)
  const needs: Need[] = []
  let calls = 0
  let failed = 0
  for (let i = 0; i < beats.length; i += size) {
    const slice = beats.slice(i, i + size)
    // the beat before and after the slice are context for pronouns; they are not asked for again
    const before = beats[i - 1]
    const lines = slice.map((b) => `${b.id}: ${b.text}`)
    let text = ''
    try {
      calls++
      text = (
        await claude.ask({
          role: 'media-needs',
          tier: o.tier ?? 'balanced',
          system: SYSTEM,
          prompt: `${o.topic ? `The video is about: ${o.topic}\n` : ''}${before ? `(The beat just before this batch: ${before.text})\n` : ''}Beats:\n${lines.join('\n')}`,
          json: true,
          signal: o.signal ?? new AbortController().signal
        })
      ).text
    } catch (e) {
      if (o.signal?.aborted) throw e
      failed += slice.length
    }
    const got = text === '' ? slice.map(fallbackNeed) : parseNeeds(text, slice, () => (failed += 1))
    needs.push(...got)
  }
  return { needs, calls, failed }
}
