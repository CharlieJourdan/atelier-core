// US National Archives Catalog API v2 (NARA). Key by email to Catalog_API@nara.gov (read-only is enough), 10 000 queries a month,
// sent as the `x-api-key` header; vault name NARA_API_KEY.
//   GET https://catalog.archives.gov/api/v2/records/search?q=<words>&limit=N&availableOnline=true
//   → body.hits.hits[]._source.record: { naId, title, scopeAndContentNote, creators[], productionDates[],
//     digitalObjects [{ objectType, objectUrl, thumbnailUrl }], generalRecordsTypes[] }
// NOT VERIFIED AGAINST A LIVE KEY (none was available when this was written, 2026-11-02): the answer is read defensively, from the
// published documentation, and every NARA candidate is flagged for human review until a run with the real key confirms the shape
// (tests/unit/sourcing.test.ts uses a hand-written fixture of that shape). Most NARA holdings are US federal works in the
// public domain, but donated materials and some film carry use restrictions the record names; those words send the item to review.
import type { MediaCandidate, MediaKind, ProviderCtx, SourceQuery, SourcingProvider } from '../types.ts'
import { arr, candidate, getJsonWith, plain, rec, str, withEra } from './common.ts'

export const NARA_SEARCH = 'https://catalog.archives.gov/api/v2/records/search'
const RESTRICTED = /donated|copyright|use restriction|permission|restricted/i

function nara(id: string, kind: Extract<MediaKind, 'image' | 'video'>): SourcingProvider {
  const types = kind === 'image' ? /image|jpeg|jpg|png|tif/i : /video|mp4|mpeg|mov/i
  return {
    id,
    label: 'US National Archives',
    kinds: [kind],
    secret: 'NARA_API_KEY',
    async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
      const url = new URL(NARA_SEARCH)
      url.searchParams.set('q', plain(withEra(q.query, q.era)))
      url.searchParams.set('limit', String(Math.min(40, Math.max(8, q.want * 3))))
      url.searchParams.set('availableOnline', 'true')
      url.searchParams.set('typeOfMaterials', kind === 'image' ? 'Photographs and other Graphic Materials' : 'Moving Images')
      const answer = await getJsonWith(url.toString(), ctx, { 'x-api-key': ctx.key ?? '' })
      const hits = arr(rec(rec(answer.body).hits).hits).map(rec)
      const out: MediaCandidate[] = []
      hits.forEach((hit, i) => {
        const r = rec(rec(hit._source).record)
        const naId = str(r.naId) || str(hit._id)
        const obj = arr(r.digitalObjects)
          .map(rec)
          .find((o) => types.test(`${str(o.objectType)} ${str(o.objectUrl)}`) && str(o.objectUrl).startsWith('http'))
        if (!naId || !obj) return
        const restricted = RESTRICTED.test(`${str(r.scopeAndContentNote)} ${arr(r.useRestriction).map((x) => str(rec(x).note)).join(' ')}`)
        out.push(
          candidate({
            provider: id,
            label: 'US National Archives',
            id: naId,
            kind,
            title: str(r.title),
            description: str(r.scopeAndContentNote),
            creator: arr(r.creators).map((c) => str(rec(c).heading)).find(Boolean),
            date: str(rec(arr(r.productionDates)[0]).logicalDate).slice(0, 10) || undefined,
            pageUrl: `https://catalog.archives.gov/id/${encodeURIComponent(naId)}`,
            previewUrl: str(obj.thumbnailUrl) || str(obj.objectUrl),
            fileUrl: str(obj.objectUrl),
            licence: { short: 'Public domain (US federal records)', status: 'public-domain', attributionRequired: false },
            review: 'human-review',
            reviewReason: restricted ? 'the record mentions a use restriction or a donor' : 'NARA answer shape not yet verified with a live key',
            rank: i,
            total: hits.length
          })
        )
      })
      return out
    }
  }
}

export const naraImages = nara('nara', 'image')
export const naraVideo = nara('nara-video', 'video')
