// Two more big free libraries.
//   Wellcome Collection  (keyless, verified live 2026-11-02)  GET https://api.wellcomecollection.org/catalogue/v2/images?query=&pageSize=
//       → results[]: { id, locations[{ url (IIIF info.json), license { id, url }, locationType { id } }], source { id, title }, aspectRatio,
//         thumbnail { url } }. Historical prints, photographs and manuscripts (≈ 100 000+ open images). Licence ids: `pdm` (public domain
//         mark), `cc-0`, `cc-by`, `cc-by-sa` are kept; every other id (NC, ND, in copyright, OGL) is refused. The picture is the IIIF
//         rendition `…/full/!2000,2000/0/default.jpg` (best fit in 2000 px).
//   Openverse  (keyless, opt-in)  GET https://api.openverse.org/v1/images|audio/?q=&license_type=commercial&page_size=
//       → results[]: { id, title, url, thumbnail, creator, license, license_version, license_url, foreign_landing_url, width, height,
//         tags[{ name }], duration (ms, audio), source }. An index over Flickr, Wikimedia, museums, Freesound, Jamendo… filtered to
//         commercial-use licences. NOT VERIFIED LIVE: on 2026-11-02 every search from this PC hung for 60 s (the `rate_limit` route answered
//         « authentication credentials were not provided »), so it is opt-in (name it in `providers`) until a run succeeds. Anonymous
//         use is limited (a few requests an hour per third-party notes, UNVERIFIED); a registered client raises that.
import { licenceFromLink } from '../legal.ts'
import type { MediaCandidate, MediaKind, MediaLicence, ProviderCtx, SourceQuery, SourcingProvider } from '../types.ts'
import { arr, candidate, getJson, num, rec, str, withEra } from './common.ts'

export const WELLCOME_IMAGES = 'https://api.wellcomecollection.org/catalogue/v2/images'
export const OPENVERSE = 'https://api.openverse.org/v1'

const WELLCOME_LICENCES: Record<string, MediaLicence> = {
  pdm: { short: 'Public domain', status: 'public-domain', url: 'https://creativecommons.org/publicdomain/mark/1.0/', attributionRequired: false },
  'cc-0': { short: 'CC0', status: 'cc0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', attributionRequired: false },
  'cc-by': { short: 'CC BY', status: 'cc-by', url: 'https://creativecommons.org/licenses/by/4.0/', attributionRequired: true },
  'cc-by-sa': { short: 'CC BY-SA', status: 'cc-by-sa', url: 'https://creativecommons.org/licenses/by-sa/4.0/', attributionRequired: true }
}

export const wellcomeImages: SourcingProvider = {
  id: 'wellcome',
  label: 'Wellcome Collection',
  kinds: ['image'],
  async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
    const url = new URL(WELLCOME_IMAGES)
    url.searchParams.set('query', withEra(q.query, q.era))
    url.searchParams.set('pageSize', String(Math.min(30, Math.max(8, q.want * 3))))
    const answer = await getJson(url.toString(), ctx)
    const results = arr(answer.results).map(rec)
    const out: MediaCandidate[] = []
    results.forEach((r, i) => {
      const loc = arr(r.locations).map(rec).find((l) => str(rec(l.locationType).id) === 'iiif-image')
      const licence = loc ? WELLCOME_LICENCES[str(rec(loc.license).id)] : undefined
      const info = loc ? str(loc.url) : ''
      if (!licence || !info.endsWith('/info.json')) return
      const base = info.slice(0, -'/info.json'.length)
      const work = rec(r.source)
      const ratio = num(r.aspectRatio)
      out.push(
        candidate({
          provider: 'wellcome', label: 'Wellcome Collection', id: str(r.id), kind: 'image', title: str(work.title), creator: str(loc?.credit) || 'Wellcome Collection',
          pageUrl: `https://wellcomecollection.org/works/${str(work.id)}`, previewUrl: `${base}/full/400,/0/default.jpg`, fileUrl: `${base}/full/!2000,2000/0/default.jpg`, mime: 'image/jpeg',
          ...(ratio ? { width: ratio >= 1 ? 2000 : Math.round(2000 * ratio), height: ratio >= 1 ? Math.round(2000 / ratio) : 2000 } : {}),
          licence, rank: i, total: results.length
        })
      )
    })
    return out
  }
}

function openverse(id: string, kind: MediaKind): SourcingProvider {
  const type = kind === 'image' ? 'images' : 'audio'
  return {
    id,
    label: 'Openverse',
    kinds: [kind],
    optIn: true,
    async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
      const url = new URL(`${OPENVERSE}/${type}/`)
      url.searchParams.set('q', withEra(q.query, q.era))
      url.searchParams.set('license_type', 'commercial')
      url.searchParams.set('page_size', String(Math.min(30, Math.max(8, q.want * 3))))
      if (kind === 'sfx') url.searchParams.set('category', 'sound_effect')
      if (kind === 'music') url.searchParams.set('category', 'music')
      const answer = await getJson(url.toString(), ctx)
      const results = arr(answer.results).map(rec)
      const out: MediaCandidate[] = []
      results.forEach((r, i) => {
        const licence = licenceFromLink(str(r.license_url)) ?? (str(r.license) ? licenceFromLink(`https://creativecommons.org/${/^cc0|pdm/i.test(str(r.license)) ? 'publicdomain/zero' : `licenses/${str(r.license).toLowerCase()}`}/${str(r.license_version) || '4.0'}/`) : undefined)
        const file = str(r.url)
        if (!licence || !file.startsWith('http')) return
        const durationS = num(r.duration) / 1000
        if (q.maxDurationS !== undefined && durationS > q.maxDurationS) return
        if (q.minDurationS !== undefined && durationS < q.minDurationS) return
        out.push(
          candidate({
            provider: id, label: 'Openverse', id: str(r.id), kind, title: str(r.title), creator: str(r.creator) || undefined, tags: arr(r.tags).map((t) => str(rec(t).name)).filter(Boolean),
            pageUrl: str(r.foreign_landing_url), previewUrl: str(r.thumbnail) || file, fileUrl: file, width: num(r.width) || undefined, height: num(r.height) || undefined,
            durationS: durationS || undefined, licence, rank: i, total: results.length
          })
        )
      })
      return out
    }
  }
}

export const openverseImages = openverse('openverse', 'image')
export const openverseSfx = openverse('openverse-sfx', 'sfx')
export const openverseMusic = openverse('openverse-music', 'music')
