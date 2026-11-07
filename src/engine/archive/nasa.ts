// NASA Image and Video Library: GET https://images-api.nasa.gov/search?q=<words>&media_type=image&page_size=N
//   → collection.items[]: { data: [{ nasa_id, title, description, photographer?, secondary_creator?, date_created, keywords }],
//     links: [{ href, rel, render: 'image', width, height, size }] } (the links list is often only the huge « orig » file).
// NASA media is generally not copyrighted (https://www.nasa.gov/nasa-brand-center/images-and-media/), so the licence is
// « Public domain (NASA) ». Items whose text points at a third-party copyright are skipped. When only a huge original is listed,
// the `~large.jpg` rendition (about 1920 px) that every image of the library has next to its original is used.
import { getJson, type HttpDeps } from './http.ts'
import { guessKind } from './kind.ts'
import { MAX_DOWNLOAD_BYTES, MAX_LONG_SIDE, WANTED_LONG_SIDE, type ArchiveHit, type SourceQuery } from './types.ts'
import { arr, attributionLine, clip, num, rec, str, stripHtml } from './util.ts'

export const NASA_SEARCH = 'https://images-api.nasa.gov/search'
export const NASA_LICENCE = 'Public domain (NASA)'
export const NASA_LICENCE_URL = 'https://www.nasa.gov/nasa-brand-center/images-and-media/'

/** « © », « copyright », « used with permission », « courtesy of <someone but NASA> »: the picture is a third party's. */
const THIRD_PARTY = /©|\(c\)\s|\bcopyright(?:ed)?\b(?!\s*(?:free|-free))|all rights reserved|with permission|courtesy\s+(?:of\s+)?(?!nasa|jpl|esa)/i

export const isThirdPartyText = (s: string): boolean => THIRD_PARTY.test(s)

interface Link {
  href: string
  width: number
  height: number
  size: number
}

const imageLinks = (links: unknown[]): Link[] =>
  links
    .map(rec)
    .filter((l) => str(l.render) === 'image' && /\.(jpe?g|png)(\?|$)/i.test(str(l.href)))
    .map((l) => ({ href: str(l.href).replace(/^http:/, 'https:'), width: num(l.width), height: num(l.height), size: num(l.size) }))

/** The rendition to use: the biggest listed one inside the window, else a derived `~large.jpg`. */
export function pickNasaLink(links: Link[], minLongSide: number): { url: string; width: number; height: number } | undefined {
  const fits = links
    .filter((l) => l.width && l.height && Math.max(l.width, l.height) >= minLongSide && Math.max(l.width, l.height) <= MAX_LONG_SIDE && (!l.size || l.size <= MAX_DOWNLOAD_BYTES))
    .sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height))
  // the largest one is wanted but a ~2000 px one is plenty: prefer the smallest that reaches the wanted size, else the biggest
  const wanted = fits.filter((l) => Math.max(l.width, l.height) >= WANTED_LONG_SIDE * 0.8).pop() ?? fits[0]
  if (wanted) return { url: wanted.href, width: wanted.width, height: wanted.height }
  const orig = links.find((l) => /~orig\.(jpe?g|png)/i.test(l.href) && l.width && l.height)
  if (!orig || minLongSide > 1920) return undefined
  const k = 1920 / Math.max(orig.width, orig.height)
  return { url: orig.href.replace(/~orig\.(jpe?g|png)/i, '~large.jpg'), width: Math.round(orig.width * k), height: Math.round(orig.height * k) }
}

export async function searchNasa(q: SourceQuery, d: HttpDeps): Promise<ArchiveHit[]> {
  const url = new URL(NASA_SEARCH)
  url.searchParams.set('q', [q.query, q.hints.era ?? ''].join(' ').trim())
  url.searchParams.set('media_type', 'image')
  url.searchParams.set('page_size', String(Math.min(30, Math.max(8, q.want * 4))))
  const answer = await getJson(url.toString(), d)
  const items = arr(rec(answer.collection).items).map(rec)
  const hits: ArchiveHit[] = []
  items.forEach((item, i) => {
    const data = rec(arr(item.data)[0])
    const id = str(data.nasa_id)
    if (!id || str(data.media_type) !== 'image') return
    const description = stripHtml(str(data.description))
    const photographer = str(data.photographer)
    const secondary = str(data.secondary_creator)
    if (isThirdPartyText(`${description} ${photographer} ${secondary}`)) return
    const picked = pickNasaLink(imageLinks(arr(item.links)), q.minLongSide)
    if (!picked) return
    // the search answer cuts long titles with « ... »: the first words of the description are a better name then
    const rawTitle = stripHtml(str(data.title))
    const title = clip(rawTitle.endsWith('...') && description ? description.split(/(?<=[.!?])\s/)[0]! : rawTitle || id, 140)
    const creator = clip(photographer || secondary || 'NASA', 160)
    const keywords = arr(data.keywords).map(str).filter(Boolean).slice(0, 15)
    const year = /^\d{4}/.exec(str(data.date_created))?.[0]
    // NASA media is photographs unless the words say otherwise (a map, an illustration)
    const guessed = guessKind(keywords.join(' '), title, description.slice(0, 200))
    const kind = guessed === 'other' ? 'photo' : guessed
    hits.push({
      source: 'nasa',
      id,
      title,
      creator,
      ...(year ? { date: year } : {}),
      pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(id)}`,
      fileUrl: picked.url,
      width: picked.width,
      height: picked.height,
      mime: /\.png$/i.test(picked.url) ? 'image/png' : 'image/jpeg',
      licence: NASA_LICENCE,
      licenceUrl: NASA_LICENCE_URL,
      attribution: attributionLine('nasa', title, creator, NASA_LICENCE),
      attributionRequired: false,
      kind,
      ...(keywords.length ? { tags: keywords } : {}),
      score: 20 * (1 - i / Math.max(items.length, 1))
    })
  })
  return hits
}
