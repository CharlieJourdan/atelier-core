// `searchArchives`: one query over the free public archives (Wikimedia Commons, Internet Archive, NASA, the Met Open Access),
// every hit with its licence. The sources run side by side (one request at a time inside each), each with its own deadline; a
// source that fails is reported in `errors` and the others still answer. It throws only when EVERY asked source failed.
// Not used: the Library of Congress JSON API (loc.gov), which sits behind a Cloudflare challenge that scripts cannot pass.
import { resolveDeps, type HttpDeps } from './http.ts'
import { retryWait, sleepMs } from './polite.ts'
import { searchInternetArchive } from './internet-archive.ts'
import { searchMet } from './met.ts'
import { searchNasa } from './nasa.ts'
import { rankHits } from './rank.ts'
import { ARCHIVE_SOURCES, DEFAULT_MIN_LONG_SIDE, type ArchiveDeps, type ArchiveHit, type ArchiveSearchOptions, type ArchiveSearchResult, type ArchiveSource, type ArchiveSourceError, type SourceQuery } from './types.ts'
import { searchWikimedia } from './wikimedia.ts'

const SEARCHERS: Record<ArchiveSource, (q: SourceQuery, d: HttpDeps) => Promise<ArchiveHit[]>> = {
  wikimedia: searchWikimedia,
  'internet-archive': searchInternetArchive,
  nasa: searchNasa,
  met: searchMet
}

/** Second chances for the sources that failed while no source found anything. */
const RECHECKS = 1

export class ArchiveSearchError extends Error {
  readonly errors: ArchiveSourceError[]
  constructor(errors: ArchiveSourceError[]) {
    super(`every archive failed: ${errors.map((e) => `${e.source}: ${e.message}`).join('; ')}`)
    this.name = 'ArchiveSearchError'
    this.errors = errors
  }
}

function describe(e: unknown, source: ArchiveSource, deadline: AbortSignal): string {
  if (deadline.aborted && !(e instanceof Error && e.name === 'HttpStatusError')) return `${source} timed out`
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'request timed out or was cancelled'
  return e instanceof Error ? e.message : String(e)
}

export async function searchArchives(query: string, opts: ArchiveSearchOptions = {}, deps: ArchiveDeps = {}): Promise<ArchiveSearchResult> {
  const text = query.trim()
  const count = Math.min(30, Math.max(1, Math.floor(opts.count ?? 6)))
  const sources = ARCHIVE_SOURCES.filter((s) => (opts.sources ?? ARCHIVE_SOURCES).includes(s)) // Wikimedia first
  if (!text || sources.length === 0) return { hits: [], errors: [] }
  const http = resolveDeps(deps)
  const sq: SourceQuery = {
    query: text,
    hints: { ...(opts.era ? { era: opts.era } : {}), ...(opts.kind ? { kind: opts.kind } : {}) },
    want: count,
    minLongSide: opts.minLongSide ?? DEFAULT_MIN_LONG_SIDE
  }
  const ask = (list: readonly ArchiveSource[]): Promise<{ source: ArchiveSource; hits: ArchiveHit[]; error?: string }[]> =>
    Promise.all(
      list.map(async (source): Promise<{ source: ArchiveSource; hits: ArchiveHit[]; error?: string }> => {
        // a whole source (several sequential requests) may take twice the per-request timeout
        const timeout = AbortSignal.timeout(http.timeoutMs * 2)
        const signal = http.signal ? AbortSignal.any([http.signal, timeout]) : timeout
        try {
          return { source, hits: await SEARCHERS[source](sq, { ...http, signal }) }
        } catch (e) {
          return { source, hits: [], error: describe(e, source, signal) }
        }
      })
    )
  let outcomes = await ask(sources)
  // a source that failed (throttled past its retries, timed out) while the others found nothing is not « nothing found »: it is
  // asked once more after a pause, with the others' answers kept (issue #106)
  for (let again = 0; again < RECHECKS && !http.signal?.aborted; again++) {
    const failed = outcomes.filter((o) => o.error !== undefined).map((o) => o.source)
    if (failed.length === 0 || outcomes.some((o) => o.hits.length > 0)) break
    await (http.sleep ?? sleepMs)(retryWait(null, 2 + again), http.signal)
    const second = await ask(failed)
    outcomes = outcomes.map((o) => second.find((x) => x.source === o.source) ?? o)
  }
  if (http.signal?.aborted) throw http.signal.reason ?? new Error('aborted')
  const errors = outcomes.filter((o) => o.error !== undefined).map((o): ArchiveSourceError => ({ source: o.source, message: o.error as string }))
  if (errors.length === sources.length) throw new ArchiveSearchError(errors)
  const all = outcomes.flatMap((o) => o.hits)
  // a query too precise for every archive (« tulip mania 1637 pamphlet »): once more without its last word, from three words on
  const words = text.split(/\s+/)
  if (all.length === 0 && words.length >= 3) {
    const wider = await searchArchives(words.slice(0, -1).join(' '), opts, deps).catch(() => null)
    if (wider) return { hits: wider.hits, errors: [...errors, ...wider.errors] }
  }
  const hits = rankHits(all, { query: text, orientation: opts.orientation ?? 'any', kind: opts.kind }).slice(0, count)
  return { hits, errors }
}
