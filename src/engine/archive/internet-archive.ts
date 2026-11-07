// Internet Archive (images). Two steps, polite and sequential:
//   1. GET https://archive.org/advancedsearch.php?q=<words> AND mediatype:image AND <licence clause>&fl[]=…&rows=N&output=json
//      → response.docs[]: { identifier, title, creator, date, licenseurl, rights, possible-copyright-status, subject }
//      The licence clause only keeps candidates; the real filter is ./licence.ts `iaLicence` (a CC BY-NC-ND item that slips in is refused).
//   2. GET https://archive.org/metadata/<identifier> → files[]: { name, format, size, width?, height?, source }
//      Most files carry no width/height and many originals are huge scans (70 MB): the biggest JPEG/PNG under 25 MB is
//      measured from its first bytes (a ranged GET), and the item is skipped if nothing fits 1200..4096 px.
import { getJson, get, readHead, type HttpDeps } from './http.ts'
import { imageSize } from './image-size.ts'
import { iaLicence } from './licence.ts'
import { guessKind } from './kind.ts'
import { MAX_DOWNLOAD_BYTES, MAX_LONG_SIDE, type ArchiveHit, type SourceQuery } from './types.ts'
import { arr, attributionLine, clip, num, rec, str, stripHtml } from './util.ts'

export const IA_SEARCH = 'https://archive.org/advancedsearch.php'
export const IA_METADATA = 'https://archive.org/metadata/'
const PROBE_BYTES = 128 * 1024
const MAX_PROBES_PER_ITEM = 2

const LICENCE_CLAUSE =
  '(licenseurl:(*publicdomain* OR *creativecommons*) OR possible-copyright-status:(NOT_IN_COPYRIGHT OR "No known copyright restrictions") OR rights:("public domain")) AND -licenseurl:(*-nc* OR *-nd*)'

/** Words only: the Lucene syntax characters of a free query are removed. */
const plainWords = (s: string): string => s.replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim()

export function iaSearchUrl(q: SourceQuery): string {
  const words = plainWords([q.query, q.hints.era ?? ''].join(' '))
  const url = new URL(IA_SEARCH)
  url.searchParams.set('q', `(${words}) AND mediatype:image AND ${LICENCE_CLAUSE}`)
  for (const f of ['identifier', 'title', 'creator', 'date', 'licenseurl', 'rights', 'possible-copyright-status', 'subject']) url.searchParams.append('fl[]', f)
  url.searchParams.set('rows', String(Math.min(30, Math.max(8, q.want * 4))))
  url.searchParams.set('output', 'json')
  return url.toString()
}

const joined = (v: unknown): string => (Array.isArray(v) ? arr(v).map(str).filter(Boolean).join(', ') : str(v))
const fileUrlOf = (id: string, name: string): string => `https://archive.org/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`

interface Picked {
  name: string
  width: number
  height: number
  mime: string
}

/** The best image file of an item: the biggest one that fits 25 MB and the long-side window. */
export async function pickIaFile(id: string, files: unknown[], minLongSide: number, d: HttpDeps): Promise<Picked | undefined> {
  const candidates = files
    .map(rec)
    .filter((f) => /^(JPEG|PNG)$/i.test(str(f.format)) && /\.(jpe?g|png)$/i.test(str(f.name)) && !/^__ia_thumb/i.test(str(f.name)))
    .filter((f) => !num(f.size) || num(f.size) <= MAX_DOWNLOAD_BYTES)
    .sort((a, b) => num(b.size) - num(a.size))
  let probes = 0
  for (const f of candidates) {
    const name = str(f.name)
    let width = num(f.width)
    let height = num(f.height)
    let mime = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg'
    if (!width || !height) {
      if (probes >= MAX_PROBES_PER_ITEM) break
      probes++
      let size: ReturnType<typeof imageSize>
      try {
        const res = await get(fileUrlOf(id, name), d, { headers: { range: `bytes=0-${PROBE_BYTES - 1}` } })
        size = imageSize(await readHead(res, PROBE_BYTES))
      } catch (e) {
        if (d.signal?.aborted) throw e
        continue // that file cannot be measured: try the next one
      }
      if (!size) continue
      ;({ width, height, mime } = size)
    }
    const long = Math.max(width, height)
    if (long > MAX_LONG_SIDE || long < minLongSide) continue
    return { name, width, height, mime }
  }
  return undefined
}

export async function searchInternetArchive(q: SourceQuery, d: HttpDeps): Promise<ArchiveHit[]> {
  const answer = await getJson(iaSearchUrl(q), d)
  if (answer.error) throw new Error(`Internet Archive refused the search (${clip(str(answer.error), 120)})`)
  const docs = arr(rec(answer.response).docs).map(rec)
  const hits: ArchiveHit[] = []
  let failure: unknown
  let looked = 0
  for (const [i, doc] of docs.entries()) {
    if (hits.length >= q.want || looked >= q.want + 3) break
    const licence = iaLicence(doc.licenseurl, doc.rights, doc['possible-copyright-status'])
    const id = str(doc.identifier)
    if (!licence || !id) continue
    looked++
    let picked: Picked | undefined
    try {
      const meta = await getJson(IA_METADATA + encodeURIComponent(id), d)
      picked = await pickIaFile(id, arr(meta.files), q.minLongSide, d)
    } catch (e) {
      if (d.signal?.aborted) throw e
      failure ??= e // one item failing does not lose the others
      continue
    }
    if (!picked) continue
    const title = clip(stripHtml(str(doc.title)) || id, 200)
    const creator = clip(stripHtml(joined(doc.creator)), 160) || undefined
    const year = /^\d{4}/.exec(str(doc.date))?.[0]
    const subjects = arr(doc.subject).map(str).filter(Boolean).slice(0, 12)
    hits.push({
      source: 'internet-archive',
      id,
      title,
      ...(creator ? { creator } : {}),
      ...(year ? { date: year } : {}),
      pageUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
      fileUrl: fileUrlOf(id, picked.name),
      width: picked.width,
      height: picked.height,
      mime: picked.mime,
      licence: licence.short,
      ...(licence.url ? { licenceUrl: licence.url } : {}),
      attribution: attributionLine('internet-archive', title, creator, licence.short),
      attributionRequired: licence.attributionRequired,
      kind: guessKind(subjects.join(' '), title),
      ...(subjects.length ? { tags: subjects } : {}),
      score: 20 * (1 - i / Math.max(docs.length, 1))
    })
  }
  if (hits.length === 0 && failure) throw failure
  return hits
}
