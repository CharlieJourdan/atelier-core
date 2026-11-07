// Free stock photo and video libraries with a key: Pexels and Pixabay. Both licences allow commercial use without attribution
// (we still print a credit line). Neither is a clearance of the people or brands in a picture; stock is for generic b-roll.
//   Pexels   GET https://api.pexels.com/v1/search | /v1/videos/search?query=&orientation=&per_page=  header `Authorization: KEY`
//            200 requests an hour, 20 000 a month. NEW KEYS WERE PAUSED on 2026-11-02 (pexels.com/api): the slot is ready, the
//            Cloud's existing `pexels` adapter keeps working for a key already issued. Vault: PEXELS_API_KEY.
//   Pixabay  GET https://pixabay.com/api/ (photos) | /api/videos/?key=&q=&per_page=  100 requests a minute; results MUST be cached
//            24 hours (cache.ts); files must be downloaded, not hot-linked. Vault: PIXABAY_API_KEY.
import { freeStockLicence } from '../legal.ts'
import type { MediaCandidate, MediaKind, ProviderCtx, SourceQuery, SourcingProvider } from '../types.ts'
import { arr, candidate, getJson, getJsonWith, num, rec, str } from './common.ts'

const PEXELS = 'https://api.pexels.com'
const PIXABAY = 'https://pixabay.com/api/'
const pexelsLicence = freeStockLicence('Pexels License', 'https://www.pexels.com/license/')
const pixabayLicence = freeStockLicence('Pixabay Content License', 'https://pixabay.com/service/license-summary/')

function pexels(id: string, kind: Extract<MediaKind, 'image' | 'video'>): SourcingProvider {
  return {
    id,
    label: 'Pexels',
    kinds: [kind],
    secret: 'PEXELS_API_KEY',
    async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
      const url = new URL(`${PEXELS}${kind === 'video' ? '/v1/videos/search' : '/v1/search'}`)
      url.searchParams.set('query', q.query)
      if (q.orientation && q.orientation !== 'any') url.searchParams.set('orientation', q.orientation)
      url.searchParams.set('per_page', String(Math.min(40, q.want + 4)))
      const answer = await getJsonWith(url.toString(), ctx, { authorization: ctx.key ?? '' })
      if (kind === 'image') {
        const photos = arr(answer.photos).map(rec)
        return photos.map((p, i) => {
          const src = rec(p.src)
          const who = str(p.photographer)
          return candidate({
            provider: id, label: 'Pexels', id: `pexels-photo-${num(p.id)}`, kind, title: str(p.alt) || q.query, creator: who || undefined,
            pageUrl: str(p.url), previewUrl: str(src.medium) || str(src.large), fileUrl: str(src.large2x) || str(src.large) || str(src.original),
            width: num(p.width), height: num(p.height), licence: pexelsLicence, rank: i, total: photos.length
          })
        })
      }
      const videos = arr(answer.videos).map(rec)
      const out: MediaCandidate[] = []
      videos.forEach((v, i) => {
        const files = arr(v.video_files).map(rec).filter((f) => str(f.file_type || 'video/mp4') === 'video/mp4' && str(f.link))
        const size = (f: Record<string, unknown>): number => Math.max(num(f.width), num(f.height))
        const sorted = files.sort((a, b) => size(a) - size(b))
        const pick = sorted.find((f) => size(f) >= 1280) ?? sorted.at(-1)
        if (!pick) return
        out.push(
          candidate({
            provider: id, label: 'Pexels', id: `pexels-video-${num(v.id)}`, kind, title: q.query, creator: str(rec(v.user).name) || undefined,
            pageUrl: str(v.url), previewUrl: str(v.image), fileUrl: str(pick.link), mime: 'video/mp4', width: num(v.width), height: num(v.height),
            durationS: num(v.duration), licence: pexelsLicence, rank: i, total: videos.length
          })
        )
      })
      return out
    }
  }
}

function pixabay(id: string, kind: Extract<MediaKind, 'image' | 'video'>): SourcingProvider {
  return {
    id,
    label: 'Pixabay',
    kinds: [kind],
    secret: 'PIXABAY_API_KEY',
    async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
      const url = new URL(kind === 'video' ? `${PIXABAY}videos/` : PIXABAY)
      url.searchParams.set('key', ctx.key ?? '')
      url.searchParams.set('q', q.query.slice(0, 100))
      url.searchParams.set('safesearch', 'true')
      url.searchParams.set('per_page', String(Math.min(50, Math.max(3, q.want + 4))))
      if (kind === 'image' && q.orientation && q.orientation !== 'any') url.searchParams.set('orientation', q.orientation === 'landscape' ? 'horizontal' : 'vertical')
      const answer = await getJson(url.toString(), ctx)
      const hits = arr(answer.hits).map(rec)
      const out: MediaCandidate[] = []
      hits.forEach((h, i) => {
        const tags = str(h.tags).split(',').map((t) => t.trim()).filter(Boolean)
        const title = tags.slice(0, 4).join(', ') || q.query
        if (kind === 'image') {
          out.push(candidate({
            provider: id, label: 'Pixabay', id: `pixabay-photo-${num(h.id)}`, kind, title, tags, creator: str(h.user) || undefined, pageUrl: str(h.pageURL),
            previewUrl: str(h.webformatURL) || str(h.previewURL), fileUrl: str(h.largeImageURL) || str(h.webformatURL), width: num(h.imageWidth), height: num(h.imageHeight),
            licence: pixabayLicence, rank: i, total: hits.length
          }))
          return
        }
        const sizes = rec(h.videos)
        const pick = [rec(sizes.large), rec(sizes.medium), rec(sizes.small)].find((s) => str(s.url))
        if (!pick) return
        out.push(candidate({
          provider: id, label: 'Pixabay', id: `pixabay-video-${num(h.id)}`, kind, title, tags, creator: str(h.user) || undefined, pageUrl: str(h.pageURL),
          previewUrl: str(h.picture_id) ? `https://i.vimeocdn.com/video/${str(h.picture_id)}_640x360.jpg` : '', fileUrl: str(pick.url), mime: 'video/mp4',
          width: num(pick.width), height: num(pick.height), durationS: num(h.duration), licence: pixabayLicence, rank: i, total: hits.length
        }))
      })
      return out
    }
  }
}

export const pexelsPhotos = pexels('pexels', 'image')
export const pexelsVideos = pexels('pexels-video', 'video')
export const pixabayPhotos = pixabay('pixabay', 'image')
export const pixabayVideos = pixabay('pixabay-video', 'video')
