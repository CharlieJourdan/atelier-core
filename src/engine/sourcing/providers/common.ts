// What the providers share: the candidate builder (cost 0, clear, credit line), the loose JSON readers of the archive module,
// and the position score (a provider's own order is its relevance).
import { get, getJson } from '../../archive/http.ts'
import { arr, clip, num, rec, str, stripHtml } from '../../archive/util.ts'
import { creditLine } from '../legal.ts'
import type { MediaCandidate, MediaKind, MediaLicence, ProviderCtx, ReviewStatus } from '../types.ts'

export { arr, clip, getJson, num, rec, str, stripHtml }

/** 20 for the first answer down to ~0 for the last. */
export const position = (i: number, n: number): number => 20 * (1 - i / Math.max(n, 1))

export interface CandidateInit {
  provider: string
  label: string
  id: string
  kind: MediaKind
  title: string
  description?: string
  creator?: string
  date?: string
  tags?: string[]
  pageUrl: string
  previewUrl: string
  fileUrl: string
  mime?: string
  width?: number
  height?: number
  durationS?: number
  licence: MediaLicence
  review?: ReviewStatus
  reviewReason?: string
  costUsd?: number
  rank: number
  total: number
  excerpt?: { startS: number; endS: number }
}

export function candidate(i: CandidateInit): MediaCandidate {
  const title = clip(i.title.trim() || i.id, 200)
  const creator = i.creator ? clip(i.creator, 160) : undefined
  return {
    provider: i.provider,
    id: i.id,
    kind: i.kind,
    title,
    ...(i.description ? { description: clip(i.description, 400) } : {}),
    ...(creator ? { creator } : {}),
    ...(i.date ? { date: clip(i.date, 80) } : {}),
    ...(i.tags?.length ? { tags: i.tags.slice(0, 15) } : {}),
    pageUrl: i.pageUrl,
    previewUrl: i.previewUrl,
    fileUrl: i.fileUrl,
    ...(i.mime ? { mime: i.mime } : {}),
    ...(i.width ? { width: i.width } : {}),
    ...(i.height ? { height: i.height } : {}),
    ...(i.durationS ? { durationS: Math.round(i.durationS * 10) / 10 } : {}),
    licence: i.licence,
    credit: creditLine(title, creator, i.licence.short, i.label),
    review: i.review ?? 'clear',
    ...(i.reviewReason ? { reviewReason: i.reviewReason } : {}),
    costUsd: i.costUsd ?? 0,
    score: position(i.rank, i.total),
    ...(i.excerpt ? { excerpt: i.excerpt } : {})
  }
}

/** Query words as one plain search string (no Lucene or query-language characters). */
export const plain = (s: string): string => s.replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim()

export const withEra = (query: string, era?: string): string => [query, era ?? ''].join(' ').replace(/\s+/g, ' ').trim()

/** GET JSON with extra headers (an API key header). */
export async function getJsonWith(url: string, ctx: ProviderCtx, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await get(url, ctx, { headers: { accept: 'application/json', ...headers } })
  try {
    return rec(await res.json())
  } catch {
    throw new Error(`unreadable JSON from ${new URL(url).host}`)
  }
}
