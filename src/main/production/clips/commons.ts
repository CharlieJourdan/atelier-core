// Free videos of Wikimedia Commons for a channel's clip library (clone-reddit-shorts): no key, no Cloud, a licence per file. The
// MediaWiki Action API is asked for videos (`filetype:video`) matching the words, with their size, length, licence and the
// transcoded derivatives; only files at least 720 px high, 5 s to 10 min long, in the public domain, CC0, CC BY or CC BY-SA are
// kept (the credit line goes in the library's `credits.json`, for the video's description). Most are landscape: the library
// crops their centre to 9:16. The file itself is never downloaded whole: ffmpeg reads the stretch it needs from the derivative.
import { licenceFromName } from '../../../engine/archive/licence'

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
/** Wikimedia's servers refuse a client without a descriptive user agent (ffmpeg's own is refused with an empty answer). */
export const COMMONS_USER_AGENT = 'Atelier/1.0 (https://github.com/CharlieJourdan/atelier-core; clip library)'
const FREE = /^(public domain|pd|cc0|cc by(-sa)? [0-9.]+|cc-by(-sa)?-[0-9.]+)/i

export interface CommonsClip {
  id: string
  title: string
  /** The derivative ffmpeg reads (the 1080p or 720p transcode, else the original). */
  url: string
  width: number
  height: number
  durationS: number
  pageUrl: string
  licence: string
  creator: string
}

interface Derivative {
  src?: string
  width?: number
  height?: number
  type?: string
}

const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()

/** The best transcode to read: the tallest WebM up to 1080 px, else the original file. */
export function pickDerivative(original: string, derivatives: readonly Derivative[]): string {
  const webm = derivatives
    .filter((d) => typeof d.src === 'string' && (d.type ?? '').startsWith('video/webm') && (d.height ?? 0) <= 1080)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
  return webm[0]?.src ?? original
}

/** One search: up to `count` usable videos for the words, best first. */
export async function searchCommonsVideos(query: string, count: number, fetchImpl: typeof fetch = fetch): Promise<CommonsClip[]> {
  const url = new URL(COMMONS_API)
  const params: Record<string, string> = {
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `${query} filetype:video`,
    gsrnamespace: '6',
    gsrlimit: String(Math.min(50, count * 4)),
    prop: 'videoinfo',
    viprop: 'url|size|mime|extmetadata|derivatives',
    viextmetadatafilter: 'LicenseShortName|Artist|DateTimeOriginal'
  }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetchImpl(url, { headers: { 'user-agent': COMMONS_USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Wikimedia Commons a répondu ${res.status}.`)
  const json = (await res.json()) as { query?: { pages?: { title?: string; index?: number; pageid?: number; videoinfo?: Record<string, unknown>[] }[] } }
  const out: (CommonsClip & { rank: number })[] = []
  for (const page of json.query?.pages ?? []) {
    const v = page.videoinfo?.[0] as
      | { url?: string; width?: number; height?: number; duration?: number; descriptionurl?: string; extmetadata?: Record<string, { value?: string }>; derivatives?: Derivative[] }
      | undefined
    if (!v?.url || !page.title) continue
    const licence = stripHtml(v.extmetadata?.LicenseShortName?.value ?? '')
    const height = v.height ?? 0
    const durationS = v.duration ?? 0
    if (!FREE.test(licence) || !licenceFromName(licence)) continue
    if (height < 720 || durationS < 5 || durationS > 600) continue
    out.push({
      id: `commons-${page.pageid ?? page.title}`,
      title: page.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
      url: pickDerivative(v.url, v.derivatives ?? []),
      width: v.width ?? 0,
      height,
      durationS,
      pageUrl: v.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      licence,
      creator: stripHtml(v.extmetadata?.Artist?.value ?? '') || 'Wikimedia Commons',
      rank: page.index ?? 999
    })
  }
  return out
    .sort((a, b) => a.rank - b.rank)
    .slice(0, count)
    .map(({ rank: _rank, ...c }) => c)
}
