// Wikimedia Commons (the main source), through the MediaWiki Action API:
//   GET https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search
//       &gsrsearch=<words> filetype:bitmap &gsrnamespace=6 &gsrlimit=N &prop=imageinfo
//       &iiprop=url|size|mime|extmetadata &iiurlwidth=2000 &iiextmetadatafilter=…
//   → query.pages[]: { title, index (relevance rank), imageinfo[0]: { url, width, height, thumburl, mime, descriptionurl,
//     extmetadata { LicenseShortName, LicenseUrl, Artist (HTML), AttributionRequired, ObjectName, DateTimeOriginal, Categories } } }
// Surprise recorded in tests/fixtures/archive/: when the original is narrower than `iiurlwidth`, `thumbwidth/thumbheight` still
// say 2000 (the « thumbnail_unscaled » URL is the original file): the real size is then `width/height`.
import { licenceFromName } from './licence.ts'
import { guessKind } from './kind.ts'
import { getJson, type HttpDeps } from './http.ts'
import { MAX_DOWNLOAD_BYTES, MAX_LONG_SIDE, WANTED_LONG_SIDE, type ArchiveHit, type ArchiveHints, type SourceQuery } from './types.ts'
import { arr, attributionLine, cleanCreator, clip, num, rec, str, stripHtml } from './util.ts'

export const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php'
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']
const META_FIELDS = 'LicenseShortName|LicenseUrl|Artist|AttributionRequired|ObjectName|DateTimeOriginal|Categories|Credit|UsageTerms'

const KIND_WORDS: Record<NonNullable<ArchiveHints['kind']>, string> = {
  painting: '(painting OR engraving)',
  photo: '(photograph OR photo)',
  document: '(document OR newspaper OR letter)',
  map: '(map OR chart)'
}

/**
 * The search string: the query words, the era words, the kind alternatives, and the bitmap filter. The kind group must follow an
 * explicit AND: CirrusSearch reads « a b (c OR d) » as « a OR b OR c OR d » in practice (recorded: « Potosi silver mine (painting OR
 * engraving) » answers unrelated engravings), while « a b AND (c OR d) » keeps every word of the query.
 */
export function wikimediaSearchString(query: string, hints: ArchiveHints): string {
  const words = [query.trim(), hints.era?.trim() ?? ''].filter(Boolean).join(' ')
  return `${words}${hints.kind ? ` AND ${KIND_WORDS[hints.kind]}` : ''} filetype:bitmap`
}

function searchUrl(search: string, limit: number): string {
  const url = new URL(WIKIMEDIA_API)
  const q = url.searchParams
  q.set('action', 'query')
  q.set('format', 'json')
  q.set('formatversion', '2')
  q.set('generator', 'search')
  q.set('gsrsearch', search)
  q.set('gsrnamespace', '6')
  q.set('gsrlimit', String(limit))
  q.set('prop', 'imageinfo')
  q.set('iiprop', 'url|size|mime|extmetadata')
  q.set('iiurlwidth', String(WANTED_LONG_SIDE))
  q.set('iiextmetadatafilter', META_FIELDS)
  return url.toString()
}

const meta = (m: Record<string, unknown>, key: string): string => {
  const v = rec(m[key]).value
  return v === undefined || v === null ? '' : stripHtml(String(v))
}

/** « File:Phare de Créac'h 2008.jpg » → « Phare de Créac'h 2008 ». */
/** An ObjectName may carry the Wikidata labels its template expands to (« Portrait of X title QS:P1476,en:"…" label QS:Len,… »): cut them. */
export const cleanTitle = (t: string): string => t.replace(/\s+(?:title|label)\s+QS:[\s\S]*$/i, '').trim()
const titleOf = (fileTitle: string): string => fileTitle.replace(/^File:/i, '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/_/g, ' ').trim()

/** The URL and real size of the rendition we hand out: the 2000-px thumbnail, or the original when it is smaller. */
function rendition(info: Record<string, unknown>): { url: string; width: number; height: number } | undefined {
  const width = num(info.width)
  const height = num(info.height)
  const url = str(info.url)
  const thumb = str(info.thumburl)
  if (!width || !height || !url) return undefined
  if (width <= WANTED_LONG_SIDE || !thumb) {
    // the original itself (a thumbnail request is never upscaled)
    if (Math.max(width, height) > MAX_LONG_SIDE) return undefined
    if (num(info.size) > MAX_DOWNLOAD_BYTES) return undefined
    return { url, width, height }
  }
  const tw = num(info.thumbwidth) || WANTED_LONG_SIDE
  const th = num(info.thumbheight) || Math.round((height * tw) / width)
  if (Math.max(tw, th) <= MAX_LONG_SIDE) return { url: thumb, width: tw, height: th }
  // a very tall picture: the 2000-px-wide thumbnail is too big; the original is only usable if small enough
  if (Math.max(width, height) <= MAX_LONG_SIDE && num(info.size) <= MAX_DOWNLOAD_BYTES) return { url, width, height }
  return undefined
}

/** Turns one `query.pages[]` entry into a hit, or undefined (no usable licence, not an image, too small, odd URL). */
export function wikimediaHit(page: unknown, minLongSide: number, rank: number, total: number): ArchiveHit | undefined {
  const p = rec(page)
  const fileTitle = str(p.title)
  const info = rec(arr(p.imageinfo)[0])
  const m = rec(info.extmetadata)
  const licenceName = meta(m, 'LicenseShortName') || meta(m, 'UsageTerms')
  const licence = licenceFromName(licenceName, meta(m, 'LicenseUrl') || undefined)
  if (!licence) return undefined
  const mime = str(info.mime)
  if (!IMAGE_MIMES.includes(mime)) return undefined
  const r = rendition(info)
  if (!r || Math.max(r.width, r.height) < minLongSide) return undefined
  try {
    const host = new URL(r.url).hostname
    if (host !== 'upload.wikimedia.org') return undefined
  } catch {
    return undefined
  }
  const title = clip(cleanTitle(meta(m, 'ObjectName')) || titleOf(fileTitle), 200)
  const creatorRaw = cleanCreator(meta(m, 'Artist'))
  const creator = creatorRaw ? clip(creatorRaw, 120) : undefined
  const date = meta(m, 'DateTimeOriginal') || undefined
  const categories = meta(m, 'Categories')
  const tags = categories ? categories.split('|').map((c) => c.trim()).filter(Boolean) : undefined
  const attributionRequired = licence.attributionRequired || /^true$/i.test(meta(m, 'AttributionRequired'))
  return {
    source: 'wikimedia',
    id: fileTitle.replace(/^File:/i, ''),
    title,
    ...(creator ? { creator } : {}),
    ...(date ? { date: clip(date, 80) } : {}),
    pageUrl: str(info.descriptionurl) || `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle.replace(/ /g, '_'))}`,
    fileUrl: r.url,
    width: r.width,
    height: r.height,
    mime,
    licence: licence.short,
    ...(licence.url ? { licenceUrl: licence.url } : {}),
    attribution: attributionLine('wikimedia', title, creator, licence.short),
    attributionRequired,
    kind: guessKind(categories, title),
    ...(tags ? { tags } : {}),
    // relevance by position in the search answer (the rest of the ranking is added in rank.ts)
    score: 20 * (1 - rank / Math.max(total, 1))
  }
}

export async function searchWikimedia(q: SourceQuery, d: HttpDeps): Promise<ArchiveHit[]> {
  // many are dropped afterwards (licence, size, type)
  const limit = Math.min(40, Math.max(10, q.want * 5))
  const run = async (hints: ArchiveHints): Promise<{ pages: unknown[] }> => {
    const answer = await getJson(searchUrl(wikimediaSearchString(q.query, hints), limit), d)
    // the API reports its own failures inside a 200 answer
    const error = rec(answer.error)
    if (error.code) throw new Error(`Wikimedia refused the search (${str(error.code)})`)
    const pages = arr(rec(answer.query).pages).slice().sort((a, b) => num(rec(a).index) - num(rec(b).index))
    return { pages }
  }
  let { pages } = await run(q.hints)
  // the hints are ANDed with the query words: if they leave nothing, one more request without them
  if (pages.length === 0 && (q.hints.era || q.hints.kind)) ({ pages } = await run({}))
  const hits: ArchiveHit[] = []
  pages.forEach((page, i) => {
    const hit = wikimediaHit(page, q.minLongSide, i, pages.length)
    if (hit) hits.push(hit)
  })
  return hits
}
