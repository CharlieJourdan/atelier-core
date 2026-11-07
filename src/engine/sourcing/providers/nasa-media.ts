// NASA Image and Video Library, video and audio (keyless): search with media_type=video|audio, then the item's collection.json
// lists its files (`~orig.mp4`, `~large.mp4`, `~medium.mp4`, `~mobile.mp4`, `~thumb.jpg`; audio `.mp3` / `.m4a` / `.wav`).
// NASA media is generally not copyrighted; items whose text points at a third party are skipped (same test as the pictures).
import { get } from '../../archive/http.ts'
import { NASA_LICENCE, NASA_LICENCE_URL, NASA_SEARCH, isThirdPartyText } from '../../archive/nasa.ts'
import type { MediaCandidate, MediaKind, ProviderCtx, SourceQuery, SourcingProvider } from '../types.ts'
import { arr, candidate, getJson, rec, str, stripHtml, withEra } from './common.ts'

async function assets(href: string, ctx: ProviderCtx): Promise<string[]> {
  const res = await get(href.replace(/^http:/, 'https:'), ctx, { headers: { accept: 'application/json' } })
  return arr(await res.json()).map(str).map((u) => u.replace(/^http:/, 'https:'))
}

const pickVideo = (urls: string[]): string | undefined =>
  urls.find((u) => /~medium\.mp4$/i.test(u)) ?? urls.find((u) => /~mobile\.mp4$/i.test(u)) ?? urls.find((u) => /~large\.mp4$/i.test(u)) ?? urls.find((u) => /\.mp4$/i.test(u) && !/~orig/i.test(u))
const pickAudio = (urls: string[]): string | undefined => urls.find((u) => /\.mp3$/i.test(u)) ?? urls.find((u) => /\.(m4a|wav)$/i.test(u))

function nasaMedia(id: string, kind: Extract<MediaKind, 'video' | 'sfx'>): SourcingProvider {
  const mediaType = kind === 'video' ? 'video' : 'audio'
  return {
    id,
    label: 'NASA',
    kinds: [kind],
    async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
      const url = new URL(NASA_SEARCH)
      url.searchParams.set('q', withEra(q.query, q.era))
      url.searchParams.set('media_type', mediaType)
      url.searchParams.set('page_size', String(Math.min(20, Math.max(6, q.want * 3))))
      const items = arr(rec((await getJson(url.toString(), ctx)).collection).items).map(rec)
      const out: MediaCandidate[] = []
      let looked = 0
      for (const [i, item] of items.entries()) {
        if (out.length >= q.want || looked >= q.want + 2) break
        const data = rec(arr(item.data)[0])
        const nasaId = str(data.nasa_id)
        const description = stripHtml(str(data.description))
        if (!nasaId || isThirdPartyText(`${description} ${str(data.photographer)} ${str(data.secondary_creator)}`)) continue
        looked++
        let urls: string[]
        try {
          urls = await assets(str(item.href), ctx)
        } catch (e) {
          if (ctx.signal?.aborted) throw e
          continue
        }
        const file = kind === 'video' ? pickVideo(urls) : pickAudio(urls)
        if (!file) continue
        const thumb = urls.find((u) => /~thumb\.jpg$/i.test(u)) ?? arr(item.links).map(rec).map((l) => str(l.href)).find(Boolean) ?? ''
        out.push(
          candidate({
            provider: id,
            label: 'NASA',
            id: nasaId,
            kind,
            title: stripHtml(str(data.title)) || nasaId,
            description,
            creator: str(data.photographer) || str(data.secondary_creator) || 'NASA',
            date: /^\d{4}/.exec(str(data.date_created))?.[0],
            tags: arr(data.keywords).map(str).filter(Boolean),
            pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`,
            previewUrl: thumb,
            fileUrl: file,
            mime: /\.mp4$/i.test(file) ? 'video/mp4' : /\.mp3$/i.test(file) ? 'audio/mpeg' : 'audio/mp4',
            licence: { short: NASA_LICENCE, status: 'public-domain', url: NASA_LICENCE_URL, attributionRequired: false },
            rank: i,
            total: items.length
          })
        )
      }
      return out
    }
  }
}

export const nasaVideo = nasaMedia('nasa-video', 'video')
export const nasaSfx = nasaMedia('nasa-sfx', 'sfx')
