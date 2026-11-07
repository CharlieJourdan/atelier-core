// Internet Archive moving images and audio (keyless). Same two steps as the picture search: advancedsearch (licence clause keeps
// public domain / Creative Commons candidates; the real filter is `iaLicence`), then /metadata/<id> for the playable file.
// Film: the h.264 / MPEG4 derivative (a few MB per minute), the length in seconds and a poster at /services/img/<id>.
// Audio: the smallest MP3 / Ogg file. The Prelinger Archives collection (ephemeral films 1927–1987) is public domain by the
// archive's own statement but usually carries no licence field: those items are kept and flagged for human review.
import { getJson } from '../../archive/http.ts'
import { iaLicence } from '../../archive/licence.ts'
import { fromArchiveLicence } from '../legal.ts'
import type { MediaCandidate, MediaKind, ProviderCtx, SourceQuery, SourcingProvider } from '../types.ts'
import { arr, candidate, clip, num, plain, rec, str, stripHtml, withEra } from './common.ts'

const IA_SEARCH = 'https://archive.org/advancedsearch.php'
const IA_METADATA = 'https://archive.org/metadata/'
const CLAUSE =
  '(licenseurl:(*publicdomain* OR *creativecommons*) OR possible-copyright-status:(NOT_IN_COPYRIGHT OR "No known copyright restrictions") OR rights:("public domain"))' +
  ' AND -licenseurl:(*-nc* OR *-nd*)'
const PRELINGER = 'collection:prelinger'
const MAX_BYTES = 300 * 1024 * 1024

const joined = (v: unknown): string => (Array.isArray(v) ? arr(v).map(str).filter(Boolean).join(', ') : str(v))
const fileUrl = (id: string, name: string): string => `https://archive.org/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`
const seconds = (v: unknown): number => {
  const s = str(v)
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  const m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(s) // « 00:03:14.5 »
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
}

function pickFile(files: unknown[], kind: 'video' | 'audio'): { name: string; mime: string; length: number; width: number; height: number } | undefined {
  const list = files.map(rec).filter((f) => !num(f.size) || num(f.size) <= MAX_BYTES)
  if (kind === 'video') {
    const mp4 = list.filter((f) => /\.mp4$/i.test(str(f.name)) && /h\.?264|mpeg-?4/i.test(str(f.format)))
    // the derivative the archive made for playing (« .mp4 » h.264) is smaller than the original and always decodes
    const f = mp4.find((x) => /h\.?264/i.test(str(x.format)) && !/_512kb|_ia/i.test(str(x.name))) ?? mp4[0]
    return f ? { name: str(f.name), mime: 'video/mp4', length: seconds(f.length), width: num(f.width), height: num(f.height) } : undefined
  }
  const f = list.filter((x) => /\.(mp3|ogg|oga)$/i.test(str(x.name)) && /mp3|ogg|vorbis/i.test(str(x.format))).sort((a, b) => num(a.size) - num(b.size))[0]
  return f ? { name: str(f.name), mime: /\.mp3$/i.test(str(f.name)) ? 'audio/mpeg' : 'audio/ogg', length: seconds(f.length), width: 0, height: 0 } : undefined
}

function iaMedia(id: string, kind: Extract<MediaKind, 'video' | 'sfx' | 'music'>): SourcingProvider {
  const mediatype = kind === 'video' ? 'movies' : 'audio'
  return {
    id,
    label: 'Internet Archive',
    kinds: [kind],
    async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
      const words = plain(withEra(q.query, q.era))
      const licenceClause = kind === 'video' ? `(${CLAUSE.replace(/ AND -licenseurl.*$/, '')} OR ${PRELINGER}) AND -licenseurl:(*-nc* OR *-nd*)` : CLAUSE
      const url = new URL(IA_SEARCH)
      url.searchParams.set('q', `(${words}) AND mediatype:${mediatype} AND ${licenceClause}`)
      for (const f of ['identifier', 'title', 'creator', 'date', 'description', 'licenseurl', 'rights', 'possible-copyright-status', 'collection', 'subject']) url.searchParams.append('fl[]', f)
      url.searchParams.set('rows', String(Math.min(20, Math.max(6, q.want * 3))))
      url.searchParams.set('output', 'json')
      const answer = await getJson(url.toString(), ctx)
      if (answer.error) throw new Error(`Internet Archive refused the search (${clip(str(answer.error), 120)})`)
      const docs = arr(rec(answer.response).docs).map(rec)
      const out: MediaCandidate[] = []
      let looked = 0
      let failure: unknown
      for (const [i, doc] of docs.entries()) {
        if (out.length >= q.want || looked >= q.want + 3) break
        const ident = str(doc.identifier)
        if (!ident || ident.startsWith('youtube-')) continue // YouTube mirrors carry the uploader's licence claim, not a clearance
        let licence = iaLicence(doc.licenseurl, doc.rights, doc['possible-copyright-status'])
        let review = false
        if (!licence && arr(doc.collection).map(str).includes('prelinger')) {
          licence = { short: 'Public domain', attributionRequired: false }
          review = true
        }
        if (!licence) continue
        looked++
        let picked: ReturnType<typeof pickFile>
        try {
          picked = pickFile(arr((await getJson(IA_METADATA + encodeURIComponent(ident), ctx)).files), mediatype === 'movies' ? 'video' : 'audio')
        } catch (e) {
          if (ctx.signal?.aborted) throw e
          failure ??= e
          continue
        }
        if (!picked) continue
        if (q.maxDurationS !== undefined && picked.length > q.maxDurationS) continue
        if (q.minDurationS !== undefined && picked.length < q.minDurationS) continue
        out.push(
          candidate({
            provider: id,
            label: 'Internet Archive',
            id: ident,
            kind,
            title: stripHtml(str(doc.title)) || ident,
            description: stripHtml(joined(doc.description)),
            creator: stripHtml(joined(doc.creator)) || undefined,
            date: /^\d{4}/.exec(str(doc.date))?.[0],
            tags: arr(doc.subject).map(str).filter(Boolean),
            pageUrl: `https://archive.org/details/${encodeURIComponent(ident)}`,
            previewUrl: `https://archive.org/services/img/${encodeURIComponent(ident)}`,
            fileUrl: fileUrl(ident, picked.name),
            mime: picked.mime,
            width: picked.width,
            height: picked.height,
            durationS: picked.length,
            licence: fromArchiveLicence(licence),
            review: review ? 'human-review' : 'clear',
            ...(review ? { reviewReason: 'Prelinger Archives: public domain by the archive’s statement, no licence field on the item' } : {}),
            rank: i,
            total: docs.length
          })
        )
      }
      if (out.length === 0 && failure) throw failure
      return out
    }
  }
}

export const internetArchiveVideo = iaMedia('internet-archive-video', 'video')
export const internetArchiveSfx = iaMedia('internet-archive-sfx', 'sfx')
export const internetArchiveMusic = iaMedia('internet-archive-music', 'music')
