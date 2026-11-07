// The Metropolitan Museum of Art, Open Access (CC0). Checked on 2026-11-01:
//   • search:  GET https://collectionapi.metmuseum.org/public/collection/v1.1/search?q=<words>&hasImages=true&isPublicDomain=true&limit=N
//              → { total, objectIDs[] }. The v1 search was retired on 2026-10-01 (it answers a JSON message saying so).
//   • object:  GET https://collectionapi.metmuseum.org/public/collection/v1/objects/<id> (v1.1 has no object route yet, it
//              answers 404: v1.1 is tried when v1 stops answering 404/410). → { isPublicDomain, primaryImage, title, artistDisplayName,
//              objectDate, classification, objectName, department, tags[{term}], objectURL }. No image size: it is measured from the
//              first bytes of `primaryImage`.
// Only objects with `isPublicDomain` and a `primaryImage` are kept (the filters of the search are not trusted). One request at a time.
import { get, getJson, HttpStatusError, readHead, type HttpDeps } from './http.ts'
import { imageSize } from './image-size.ts'
import { guessKind } from './kind.ts'
import { MAX_LONG_SIDE, type ArchiveHit, type ArchiveKind, type SourceQuery } from './types.ts'
import { arr, attributionLine, clip, rec, str } from './util.ts'

export const MET_BASE = 'https://collectionapi.metmuseum.org/public/collection'
export const MET_LICENCE = 'CC0'
export const MET_LICENCE_URL = 'https://creativecommons.org/publicdomain/zero/1.0/'
const PROBE_BYTES = 128 * 1024

/** The Met's own classification beats word guessing. */
function metKind(o: Record<string, unknown>): ArchiveKind {
  const classification = `${str(o.classification)} ${str(o.objectName)} ${str(o.department)}`
  if (/paintings?/i.test(classification)) return 'painting'
  if (/\b(prints?|drawings?)\b/i.test(classification)) return 'painting'
  if (/photograph/i.test(classification)) return 'photo'
  return guessKind(classification, str(o.title), arr(o.tags).map((t) => str(rec(t).term)).join(' '))
}

export async function searchMet(q: SourceQuery, d: HttpDeps): Promise<ArchiveHit[]> {
  const url = new URL(`${MET_BASE}/v1.1/search`)
  url.searchParams.set('q', [q.query, q.hints.era ?? ''].join(' ').trim())
  url.searchParams.set('hasImages', 'true')
  url.searchParams.set('isPublicDomain', 'true')
  url.searchParams.set('limit', String(Math.min(20, Math.max(6, q.want * 3))))
  url.searchParams.set('offset', '0')
  const answer = await getJson(url.toString(), d)
  if (typeof answer.message === 'string' && !Array.isArray(answer.objectIDs)) throw new Error(`The Met search answered: ${clip(answer.message, 160)}`)
  const ids = arr(answer.objectIDs).filter((n): n is number => typeof n === 'number')
  const hits: ArchiveHit[] = []
  let objectBase = `${MET_BASE}/v1/objects/`
  let looked = 0
  for (const [i, id] of ids.entries()) {
    if (hits.length >= q.want || looked >= q.want + 3) break
    looked++
    let o: Record<string, unknown>
    try {
      o = await getJson(objectBase + id, d)
    } catch (e) {
      if (e instanceof HttpStatusError && (e.status === 404 || e.status === 410) && objectBase.includes('/v1/')) {
        objectBase = `${MET_BASE}/v1.1/objects/`
        try {
          o = await getJson(objectBase + id, d)
        } catch {
          continue
        }
      } else if (d.signal?.aborted) throw e
      else continue
    }
    const image = str(o.primaryImage)
    if (o.isPublicDomain !== true || !image) continue
    let size: ReturnType<typeof imageSize>
    try {
      const res = await get(image, d, { headers: { range: `bytes=0-${PROBE_BYTES - 1}` } })
      size = imageSize(await readHead(res, PROBE_BYTES))
    } catch (e) {
      if (d.signal?.aborted) throw e
      continue
    }
    if (!size) continue
    const long = Math.max(size.width, size.height)
    if (long < q.minLongSide || long > MAX_LONG_SIDE) continue
    const title = clip(str(o.title) || `Object ${id}`, 200)
    const creator = clip(str(o.artistDisplayName), 160) || undefined
    const date = clip(str(o.objectDate), 80) || undefined
    const tags = arr(o.tags).map((t) => str(rec(t).term)).filter(Boolean)
    hits.push({
      source: 'met',
      id: String(id),
      title,
      ...(creator ? { creator } : {}),
      ...(date ? { date } : {}),
      pageUrl: str(o.objectURL) || `https://www.metmuseum.org/art/collection/search/${id}`,
      fileUrl: image,
      width: size.width,
      height: size.height,
      mime: size.mime,
      licence: MET_LICENCE,
      licenceUrl: MET_LICENCE_URL,
      attribution: attributionLine('met', title, creator, MET_LICENCE),
      attributionRequired: false,
      kind: metKind(o),
      ...(tags.length ? { tags } : {}),
      score: 20 * (1 - i / Math.max(ids.length, 1))
    })
  }
  return hits
}
