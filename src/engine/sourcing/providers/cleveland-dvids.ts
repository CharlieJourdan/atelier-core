// Two more archives (2026-11-02 evaluation, research note technos-medias-2026-11 (old repository) §18).
//   Cleveland Museum of Art Open Access  (keyless, verified live)  GET https://openaccess-api.clevelandart.org/api/artworks/?q=&has_image=1&cc0=1&limit=N
//       → data[]: { id, title, creation_date, creators[{ description }], type, culture[], url, share_license_status (« CC0 »),
//         images { web { url, width, height } (900 px), print { url, width, height } (3400 px, ≈ 2 MB), full (a TIFF) } }.
//       ≈ 60 000 CC0 artworks with pictures: paintings, prints, drawings, manuscripts, photographs. The 3400-px « print » JPEG is the file.
//   DVIDS, the US Department of Defense's public media  (free key, NOT VERIFIED LIVE)  GET https://api.dvidshub.net/search?api_key=&q=&type[]=image|video&max_results=
//       → results[]: { id (« image:123 »), type, title, short_description, date, thumbnail, url, unit_name, credit, width, height, duration }
//       then GET /asset?id=<id>&api_key= → image: `image` (full-resolution URL); video: `files[]` MP4 renditions { src, type, width, height, size }.
//       From the documentation read on 2026-11-02 (no key was available). Content is public domain « unless other copyright status is
//       indicated » and must not be used to suggest DoD endorsement of a product; the producing journalists are credited by request. The
//       key is tied to an origin by DVIDS: it is used server-side from the Cloud. Every DVIDS candidate is flagged for review until a run
//       with the real key confirms the shapes. Vault name DVIDS_API_KEY.
import type { MediaCandidate, MediaKind, ProviderCtx, SourceQuery, SourcingProvider } from '../types.ts'
import { arr, candidate, getJson, num, rec, str, withEra } from './common.ts'

export const CLEVELAND_API = 'https://openaccess-api.clevelandart.org/api/artworks/'
export const DVIDS_API = 'https://api.dvidshub.net'

export const clevelandImages: SourcingProvider = {
  id: 'cleveland',
  label: 'Cleveland Museum of Art',
  kinds: ['image'],
  async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
    const url = new URL(CLEVELAND_API)
    url.searchParams.set('q', withEra(q.query, q.era))
    url.searchParams.set('has_image', '1')
    url.searchParams.set('cc0', '1')
    url.searchParams.set('limit', String(Math.min(30, Math.max(8, q.want * 3))))
    const answer = await getJson(url.toString(), ctx)
    const data = arr(answer.data).map(rec)
    const out: MediaCandidate[] = []
    data.forEach((a, i) => {
      if (str(a.share_license_status).toUpperCase() !== 'CC0') return
      const images = rec(a.images)
      const web = rec(images.web)
      const print = rec(images.print)
      const printOk = str(print.url).startsWith('https://') && Math.max(num(print.width), num(print.height)) <= 4096
      const pick = printOk ? print : web
      if (!str(pick.url).startsWith('https://')) return
      if (Math.max(num(pick.width), num(pick.height)) < (q.minLongSide ?? 0)) return
      out.push(
        candidate({
          provider: 'cleveland', label: 'Cleveland Museum of Art', id: String(num(a.id)), kind: 'image', title: str(a.title), creator: str(rec(arr(a.creators)[0]).description) || undefined,
          date: str(a.creation_date) || undefined, tags: [str(a.type), ...arr(a.culture).map(str)].filter(Boolean), pageUrl: str(a.url), previewUrl: str(web.url) || str(pick.url),
          fileUrl: str(pick.url), mime: 'image/jpeg', width: num(pick.width) || undefined, height: num(pick.height) || undefined,
          licence: { short: 'CC0', status: 'cc0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', attributionRequired: false }, rank: i, total: data.length
        })
      )
    })
    return out
  }
}

const DVIDS_LICENCE = { short: 'Public domain (US DoD, DVIDS)', status: 'public-domain' as const, url: 'https://www.dvidshub.net/about/copyright', attributionRequired: false }

function dvids(id: string, kind: Extract<MediaKind, 'image' | 'video'>): SourcingProvider {
  return {
    id,
    label: 'DVIDS',
    kinds: [kind],
    secret: 'DVIDS_API_KEY',
    async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
      const url = new URL(`${DVIDS_API}/search`)
      const p = url.searchParams
      p.set('api_key', ctx.key ?? '')
      p.set('q', withEra(q.query, q.era))
      p.append('type[]', kind)
      p.set('max_results', String(Math.min(50, Math.max(6, q.want * 2))))
      p.set('sort', 'score')
      const answer = await getJson(url.toString(), ctx)
      const results = arr(answer.results).map(rec)
      const out: MediaCandidate[] = []
      let looked = 0
      for (const [i, r] of results.entries()) {
        if (out.length >= q.want || looked >= q.want + 2) break
        const assetId = str(r.id)
        if (!assetId) continue
        looked++
        let file: string
        let width = num(r.width)
        let height = num(r.height)
        let mime = kind === 'image' ? 'image/jpeg' : 'video/mp4'
        try {
          const resp = await getJson(`${DVIDS_API}/asset?id=${encodeURIComponent(assetId)}&api_key=${encodeURIComponent(ctx.key ?? '')}`, ctx)
          const asset = rec(resp.results && !Array.isArray(resp.results) ? resp.results : resp)
          if (kind === 'image') {
            file = str(asset.image)
            const dim = rec(asset.dimensions)
            width = num(dim.width) || width
            height = num(dim.height) || height
          } else {
            const files = arr(asset.files).map(rec).filter((f) => /^video\/mp4/i.test(str(f.type)) && str(f.src).startsWith('https://') && (!num(f.size) || num(f.size) <= 300 * 1024 * 1024))
            files.sort((a, b) => Math.max(num(a.width), num(a.height)) - Math.max(num(b.width), num(b.height)))
            const best = files.find((f) => Math.max(num(f.width), num(f.height)) >= 1280) ?? files.at(-1)
            file = str(best?.src)
            width = num(best?.width) || width
            height = num(best?.height) || height
            mime = str(best?.type) || mime
          }
        } catch (e) {
          if (ctx.signal?.aborted) throw e
          continue
        }
        if (!file.startsWith('https://')) continue
        const credit = Array.isArray(r.credit) ? str(rec(arr(r.credit)[0]).name) : str(r.credit)
        out.push(
          candidate({
            provider: id, label: 'DVIDS', id: assetId, kind, title: str(r.title), description: str(r.short_description), creator: credit || str(r.unit_name) || undefined,
            date: str(r.date).slice(0, 10) || undefined, tags: str(r.keywords).split(',').map((t) => t.trim()).filter(Boolean), pageUrl: str(r.url), previewUrl: str(rec(r.thumbnail).url) || str(r.thumbnail),
            fileUrl: file, mime, width: width || undefined, height: height || undefined, durationS: num(r.duration) || undefined, licence: DVIDS_LICENCE,
            review: 'human-review', reviewReason: 'DVIDS answer shapes not yet verified with a live key; items may carry another copyright status; never imply DoD endorsement',
            rank: i, total: results.length
          })
        )
      }
      return out
    }
  }
}

export const dvidsImages = dvids('dvids', 'image')
export const dvidsVideo = dvids('dvids-video', 'video')
