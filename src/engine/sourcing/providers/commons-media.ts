// Wikimedia Commons video and audio (keyless): the same MediaWiki search as the picture archive with `filetype:video` or
// `filetype:audio`. Video comes back with a poster (`thumburl`), a size and a duration; audio carries sound effects and CC music.
// Also the way to Bundesarchiv, NARA and Library of Congress footage and photos that Commons mirrors (the `Bundesarchiv` and
// `NARA` words in a query match their file pages), with the licence Commons records.
import { WIKIMEDIA_API } from '../../archive/wikimedia.ts'
import { licenceFromText } from '../legal.ts'
import type { MediaCandidate, MediaKind, ProviderCtx, SourceQuery, SourcingProvider } from '../types.ts'
import { arr, candidate, getJson, num, plain, rec, str, stripHtml, withEra } from './common.ts'

const META = 'LicenseShortName|LicenseUrl|Artist|ObjectName|DateTimeOriginal|ImageDescription|UsageTerms|Categories'
const MIMES: Record<'video' | 'audio', string[]> = { video: ['video/webm', 'video/ogg', 'video/mp4'], audio: ['audio/ogg', 'application/ogg', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/webm'] }
const meta = (m: Record<string, unknown>, k: string): string => {
  const v = rec(m[k]).value
  return v === undefined || v === null ? '' : stripHtml(String(v))
}

function commonsMedia(id: string, kind: Extract<MediaKind, 'video' | 'sfx' | 'music'>): SourcingProvider {
  const type = kind === 'video' ? 'video' : 'audio'
  return {
    id,
    label: 'Wikimedia Commons',
    kinds: [kind],
    async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
      const url = new URL(WIKIMEDIA_API)
      const p = url.searchParams
      p.set('action', 'query')
      p.set('format', 'json')
      p.set('formatversion', '2')
      p.set('generator', 'search')
      // a sound effect is searched with « sound » words too: Commons audio titles are plain (« Applause », « Crowd cheering »)
      p.set('gsrsearch', `${plain(withEra(q.query, q.era))} filetype:${type}`)
      p.set('gsrnamespace', '6')
      p.set('gsrlimit', String(Math.min(30, Math.max(8, q.want * 4))))
      p.set('prop', 'imageinfo')
      p.set('iiprop', 'url|size|mime|extmetadata')
      p.set('iiurlwidth', '640')
      p.set('iiextmetadatafilter', META)
      const answer = await getJson(url.toString(), ctx)
      if (rec(answer.error).code) throw new Error(`Wikimedia refused the search (${str(rec(answer.error).code)})`)
      const pages = arr(rec(answer.query).pages).map(rec).sort((a, b) => num(a.index) - num(b.index))
      const out: MediaCandidate[] = []
      pages.forEach((page, i) => {
        const info = rec(arr(page.imageinfo)[0])
        const m = rec(info.extmetadata)
        const licence = licenceFromText(meta(m, 'LicenseShortName') || meta(m, 'UsageTerms'), meta(m, 'LicenseUrl') || undefined)
        const fileUrl = str(info.url).split('?')[0]!
        const mime = str(info.mime)
        if (!licence || !fileUrl.startsWith('https://upload.wikimedia.org/') || !MIMES[type].includes(mime)) return
        const durationS = num(info.duration)
        if (q.maxDurationS !== undefined && durationS > q.maxDurationS) return
        if (q.minDurationS !== undefined && durationS < q.minDurationS) return
        if (num(info.size) > 400 * 1024 * 1024) return
        const fileTitle = str(page.title).replace(/^File:/i, '')
        const title = meta(m, 'ObjectName') || fileTitle.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/_/g, ' ')
        out.push(
          candidate({
            provider: id,
            label: 'Wikimedia Commons',
            id: fileTitle,
            kind,
            title,
            description: meta(m, 'ImageDescription'),
            creator: meta(m, 'Artist') || undefined,
            date: meta(m, 'DateTimeOriginal') || undefined,
            tags: meta(m, 'Categories').split('|').map((t) => t.trim()).filter(Boolean),
            pageUrl: str(info.descriptionurl),
            previewUrl: str(info.thumburl) || fileUrl,
            fileUrl,
            mime,
            width: num(info.width),
            height: num(info.height),
            durationS,
            licence,
            rank: i,
            total: pages.length
          })
        )
      })
      return out
    }
  }
}

export const commonsVideo = commonsMedia('wikimedia-video', 'video')
export const commonsSfx = commonsMedia('wikimedia-sfx', 'sfx')
export const commonsMusic = commonsMedia('wikimedia-music', 'music')
