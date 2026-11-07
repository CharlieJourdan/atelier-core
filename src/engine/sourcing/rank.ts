// Relevance ranking of candidates from every provider. Two stages, the second optional:
//   1. `heuristicRank` (free, offline): the provider's own order, the share of query words found in the title / description /
//      tags, the fit of size or duration, and the licence (public domain and CC0 first, fair-use excerpts last). A candidate that
//      shares too few query words is noise and is dropped.
//   2. a `Reranker`: Claude (on the subscription) reads the titles and descriptions of the best ones and scores them 0..10.
//      A CLIP-style local scorer was weighed and not built (research note technos-medias-2026-11 (old repository) §7): it needs a ~600 MB model
//      and sees only pictures, while the text of an archive record is what tells a 1940 border post from a 2010 one.
import { queryWords } from '../archive/rank.ts'
import type { MediaCandidate, MediaKind } from './types.ts'

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '')

export function wordMatch(c: MediaCandidate, words: string[]): number {
  if (!words.length) return 1
  const text = norm(`${c.title} ${c.description ?? ''} ${(c.tags ?? []).join(' ')}`)
  return words.filter((w) => text.includes(norm(w)) || (w.endsWith('s') && text.includes(norm(w.slice(0, -1))))).length / words.length
}

function fit(c: MediaCandidate, kind: MediaKind, o: { orientation: 'landscape' | 'portrait' | 'any' }): number {
  let s = 0
  if (kind === 'image' || kind === 'video') {
    if (c.width && c.height) {
      s += (Math.min(Math.max(c.width, c.height), 2500) / 2500) * (kind === 'image' ? 12 : 8)
      const ratio = c.width / c.height
      if (o.orientation === 'landscape') s += ratio >= 1.15 ? 8 : ratio > 0.87 ? -2 : -10
      else if (o.orientation === 'portrait') s += ratio <= 0.87 ? 8 : ratio < 1.15 ? -2 : -10
    }
  }
  if (kind === 'video' && c.durationS) s += c.durationS >= 4 && c.durationS <= 180 ? 6 : c.durationS > 900 ? -6 : 0
  if (kind === 'sfx' && c.durationS) s += c.durationS <= 8 ? 6 : c.durationS <= 20 ? 2 : -6
  return s
}

const LICENCE_BONUS: Record<MediaCandidate['licence']['status'], number> = {
  'public-domain': 8,
  cc0: 8,
  'free-licence': 4,
  'cc-by': -1,
  'cc-by-sa': -4,
  'fair-use-excerpt': -12,
  forbidden: -100
}

export interface HeuristicOptions {
  orientation?: 'landscape' | 'portrait' | 'any'
  /** Candidates sharing a smaller part of the query words are dropped. Default 0.34. */
  minMatch?: number
}

/** The best share of words found among the asked queries (the original and its variants). */
const bestMatch = (c: MediaCandidate, wordSets: string[][]): number => Math.max(...wordSets.map((w) => wordMatch(c, w)))

export function heuristicScore(c: MediaCandidate, query: string | string[], o: HeuristicOptions = {}, wordSets = [query].flat().map(queryWords)): number {
  let s = c.score // the provider's own relevance, 0..20
  s += 40 * bestMatch(c, wordSets)
  s += fit(c, c.kind, { orientation: o.orientation ?? 'any' })
  s += LICENCE_BONUS[c.licence.status]
  if (c.review === 'human-review') s -= 3
  return Math.round(s * 100) / 100
}

/** The same file twice (same URL, or the same title across two providers) keeps the better one. */
export function dedupeCandidates(cs: MediaCandidate[]): MediaCandidate[] {
  const seen = new Map<string, MediaCandidate>()
  const kept: MediaCandidate[] = []
  for (const c of cs) {
    const title = norm(c.title).replace(/[^a-z0-9]+/g, '')
    const keys = [`${c.provider}:${c.id}`, `url:${c.fileUrl}`, ...(title.length >= 14 ? [`title:${c.kind}:${title}`] : [])]
    const twin = keys.map((k) => seen.get(k)).find((x): x is MediaCandidate => x !== undefined)
    if (twin) {
      if (c.score > twin.score) {
        kept[kept.indexOf(twin)] = c
        for (const k of keys) seen.set(k, c)
      }
      continue
    }
    kept.push(c)
    for (const k of keys) seen.set(k, c)
  }
  return kept
}

export function heuristicRank(cs: MediaCandidate[], query: string | string[], o: HeuristicOptions = {}): MediaCandidate[] {
  const wordSets = [query].flat().map(queryWords)
  const min = o.minMatch ?? 0.34
  const scored = cs.filter((c) => bestMatch(c, wordSets) >= min).map((c) => ({ ...c, score: heuristicScore(c, query, o, wordSets) }))
  return dedupeCandidates(scored).sort((a, b) => b.score - a.score)
}

/** Proposes other ways to ask for the same thing, in the archives' own words and languages. */
export type QueryExpander = (query: string, signal?: AbortSignal) => Promise<string[]>

export function claudeExpander(claude: AskClaude, o: { tier?: 'best' | 'balanced' | 'fast' } = {}): QueryExpander {
  return async (query, signal) => {
    const res = await claude.ask({
      role: 'media-query-expander',
      tier: o.tier ?? 'fast',
      system:
        'You help a video editor search public archives (Wikimedia Commons, Internet Archive, national and museum archives). Archives index in the wording and language of their own country and period. ' +
        'Given the editor’s request, give up to 3 short alternative search queries (2 to 5 words each): the same thing in the archive’s own words, including the native language when the subject belongs to a non-English country. ' +
        'Answer ONLY with JSON: {"queries":["...","..."]}.',
      prompt: query,
      json: true,
      signal: signal ?? new AbortController().signal
    })
    try {
      const parsed = JSON.parse(res.text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { queries?: unknown }
      return (Array.isArray(parsed.queries) ? parsed.queries : []).filter((q): q is string => typeof q === 'string').slice(0, 3)
    } catch {
      return []
    }
  }
}

/** Scores 0..10 by candidate index, or undefined for one it could not judge. */
export type Reranker = (query: string, candidates: readonly MediaCandidate[], signal?: AbortSignal) => Promise<Array<number | undefined>>

/** The slice of the engine's ClaudeService a reranker needs (kept structural: the sourcing bricks stay engine-light). */
export interface AskClaude {
  ask(req: { role: string; tier?: 'best' | 'balanced' | 'fast'; system: string; prompt: string; json: boolean; images?: string[]; signal: AbortSignal }): Promise<{ text: string }>
}

const SYSTEM =
  'You judge search results for a video editor. For each numbered candidate decide how well its title, description and tags match what the editor asked for ' +
  '(subject, place, period, mood). 10 = exactly what was asked, 5 = related but not the thing, 0 = unrelated or wrong period. ' +
  'Answer ONLY with JSON: {"scores":[{"i":<number>,"s":<0..10>}, ...]} covering every candidate.'

export function claudeReranker(claude: AskClaude, o: { tier?: 'best' | 'balanced' | 'fast'; max?: number } = {}): Reranker {
  return async (query, candidates, signal) => {
    const list = candidates.slice(0, o.max ?? 24)
    const lines = list.map((c, i) => `${i}. [${c.kind}] ${c.title.slice(0, 120)}${c.date ? ` (${c.date})` : ''}${c.description ? ` — ${c.description.slice(0, 160)}` : ''}${c.tags?.length ? ` {${c.tags.slice(0, 6).join(', ')}}` : ''}`)
    const res = await claude.ask({
      role: 'media-ranker',
      tier: o.tier ?? 'fast',
      system: SYSTEM,
      prompt: `The editor asked for: « ${query} »\n\nCandidates:\n${lines.join('\n')}`,
      json: true,
      signal: signal ?? new AbortController().signal
    })
    const out: Array<number | undefined> = candidates.map(() => undefined)
    try {
      const parsed = JSON.parse(res.text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { scores?: Array<{ i?: unknown; s?: unknown }> }
      for (const e of parsed.scores ?? []) {
        if (typeof e.i === 'number' && typeof e.s === 'number' && e.i >= 0 && e.i < list.length) out[e.i] = Math.min(10, Math.max(0, e.s))
      }
    } catch {
      // unreadable answer: no score, the heuristic order stays
    }
    return out
  }
}

/** Blends the model's score into the heuristic one: the model counts for more than half. Unscored candidates keep their heuristic score. */
export function applyRerank(cs: MediaCandidate[], scores: Array<number | undefined>): MediaCandidate[] {
  return cs
    .map((c, i) => {
      const s = scores[i]
      return s === undefined ? c : { ...c, score: Math.round((c.score * 0.5 + s * 8) * 100) / 100 }
    })
    .sort((a, b) => b.score - a.score)
}
