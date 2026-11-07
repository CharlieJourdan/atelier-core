// The four keyless picture archives of src/engine/archive (Wikimedia Commons, Internet Archive images, NASA, the Met) as
// sourcing providers: each one calls the archive module with a single source and wraps the hits.
import { searchArchives } from '../../archive/search.ts'
import type { ArchiveHit, ArchiveSource } from '../../archive/types.ts'
import { SOURCE_LABEL } from '../../archive/util.ts'
import { fromArchiveLicence } from '../legal.ts'
import type { MediaCandidate, ProviderCtx, SourceQuery, SourcingProvider } from '../types.ts'
import { candidate } from './common.ts'
import { licenceFromName } from '../../archive/licence.ts'

function wrap(h: ArchiveHit, rank: number, total: number): MediaCandidate {
  const lic = licenceFromName(h.licence, h.licenceUrl)
  // NASA's « Public domain (NASA) » and the like read as public domain
  const licence = lic ? fromArchiveLicence(lic) : { short: h.licence, status: /^public domain/i.test(h.licence) ? ('public-domain' as const) : ('forbidden' as const), attributionRequired: h.attributionRequired }
  return candidate({
    provider: h.source,
    label: SOURCE_LABEL[h.source],
    id: h.id,
    kind: 'image',
    title: h.title,
    creator: h.creator,
    date: h.date,
    tags: h.tags,
    pageUrl: h.pageUrl,
    previewUrl: h.fileUrl,
    fileUrl: h.fileUrl,
    mime: h.mime,
    width: h.width,
    height: h.height,
    licence: { ...licence, ...(h.licenceUrl ? { url: h.licenceUrl } : {}) },
    rank,
    total
  })
}

function archiveProvider(source: ArchiveSource): SourcingProvider {
  return {
    id: source,
    label: SOURCE_LABEL[source],
    kinds: ['image'],
    async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
      const { hits } = await searchArchives(
        q.query,
        { count: q.want, sources: [source], era: q.era, orientation: q.orientation, minLongSide: q.minLongSide ?? 1200 },
        { fetch: ctx.fetch, signal: ctx.signal, timeoutMs: ctx.timeoutMs }
      )
      return hits.map((h, i) => wrap(h, i, hits.length))
    }
  }
}

export const wikimediaImages = archiveProvider('wikimedia')
export const internetArchiveImages = archiveProvider('internet-archive')
export const nasaImages = archiveProvider('nasa')
export const metImages = archiveProvider('met')
