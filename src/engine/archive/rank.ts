// Ranking and duplicate removal of the hits of every source. Each source gives a base score of 0..20 from the position in
// its own answer (the archive's relevance); this adds what the caller cares about:
//   query words found in the title / categories (0..40), picture size (0..15), aspect against the wanted orientation (-15..+12),
//   kind match (+12, or -8 for a different known kind), licence (public domain / CC0 +8, CC BY -1, CC BY-SA -4).
import type { ArchiveHit, ArchiveKindHint } from './types.ts'

const STOP = new Set(['the', 'and', 'of', 'for', 'with', 'from', 'in', 'on', 'at', 'to', 'a', 'an', 'is', 'photo', 'photograph', 'image', 'picture'])

export function queryWords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w))
  return [...new Set(words)]
}

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '')

export interface RankContext {
  query: string
  orientation: 'landscape' | 'portrait' | 'any'
  kind?: ArchiveKindHint
}

export function scoreHit(h: ArchiveHit, c: RankContext, words = queryWords(c.query)): number {
  let score = h.score
  score += 40 * wordMatch(h, words)
  score += (Math.min(Math.max(h.width, h.height), 3000) / 3000) * 15
  const ratio = h.width / Math.max(h.height, 1)
  if (c.orientation === 'landscape') score += ratio >= 1.15 ? 12 : ratio > 0.87 ? -3 : -15
  else if (c.orientation === 'portrait') score += ratio <= 0.87 ? 12 : ratio < 1.15 ? -3 : -15
  if (c.kind) {
    if (h.kind === c.kind) score += 12
    else if (h.kind && h.kind !== 'other') score -= 8
  }
  if (/^(Public domain|CC0)/i.test(h.licence)) score += 8
  else if (/^CC BY-SA/i.test(h.licence)) score -= 4
  else if (/^CC BY/i.test(h.licence)) score -= 1
  return Math.round(score * 100) / 100
}

/** The same picture twice (same file, or the same title: Commons also holds many Met and NASA files) keeps the better hit. */
export function dedupe(hits: ArchiveHit[]): ArchiveHit[] {
  const seen = new Map<string, ArchiveHit>()
  const keyOf = (h: ArchiveHit): string[] => {
    const title = norm(h.title).replace(/[^a-z0-9]+/g, '')
    return [`${h.source}:${h.id}`, `url:${h.fileUrl.split('?')[0]}`, ...(title.length >= 12 ? [`title:${title}`] : [])]
  }
  const kept: ArchiveHit[] = []
  for (const h of hits) {
    const keys = keyOf(h)
    // a title alone only makes a twin across two sources (NASA cuts long titles: two files of one source may share one)
    const twin = keys
      .map((k) => seen.get(k))
      .find((x): x is ArchiveHit => x !== undefined && (x.source !== h.source || x.id === h.id || x.fileUrl.split('?')[0] === h.fileUrl.split('?')[0]))
    if (twin) {
      if (h.score > twin.score) {
        kept[kept.indexOf(twin)] = h
        for (const k of keys) seen.set(k, h)
        for (const k of keyOf(twin)) seen.set(k, h)
      }
      continue
    }
    kept.push(h)
    for (const k of keys) seen.set(k, h)
  }
  return kept
}

/** Share of the query words found in the title and categories of a hit (0..1). */
export function wordMatch(h: ArchiveHit, words: string[]): number {
  if (!words.length) return 1
  const text = norm(`${h.title} ${(h.tags ?? []).join(' ')}`)
  return words.filter((w) => text.includes(norm(w)) || (w.endsWith('s') && text.includes(norm(w.slice(0, -1))))).length / words.length
}

export function rankHits(hits: ArchiveHit[], c: RankContext): ArchiveHit[] {
  const words = queryWords(c.query)
  // Commons full-text search is exact (every word must be in the file page, maybe only in its description); the Internet
  // Archive, NASA and the Met are fuzzy: one of their hits that shares fewer than half of the query words is noise, not an answer.
  const relevant = hits.filter((h) => h.source === 'wikimedia' || wordMatch(h, words) >= 0.5)
  const scored = relevant.map((h) => ({ ...h, score: scoreHit(h, c, words) }))
  return dedupe(scored).sort((a, b) => b.score - a.score)
}
