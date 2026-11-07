// `searchMedia`: one query over every provider that can answer the asked kinds, side by side, each with its own deadline and
// its cache. A provider that fails is reported in `errors` and the others still answer; one that needs a key we do not hold,
// or that charges, is reported in `skipped` and never called. Forbidden candidates are removed. Ranked best first, per kind.
import { resolveDeps } from '../archive/http.ts'
import type { ArchiveDeps } from '../archive/types.ts'
import { cacheKey, type SearchCache } from './cache.ts'
import { PROVIDERS } from './catalog.ts'
import { applyRerank, dedupeCandidates, heuristicRank, type QueryExpander, type Reranker } from './rank.ts'
import {
  MEDIA_KINDS,
  type MediaCandidate,
  type MediaKind,
  type MediaSearchResult,
  type ProviderCtx,
  type ProviderError,
  type RunFn,
  type SkippedProvider,
  type SourceQuery,
  type SourcingProvider
} from './types.ts'

export interface MediaSearchOptions {
  /** Default: images only. */
  kinds?: MediaKind[]
  /** Candidates returned per kind, default 6. */
  count?: number
  /** Restrict to these provider ids. Default: every free provider that can answer. */
  providers?: string[]
  /** Paid providers are skipped unless this is on (Charlie's OK, per run). */
  allowPaid?: boolean
  /** Use a provider's published public demo key when no real key is held (proofs and tests, never production). */
  allowDemoKeys?: boolean
  era?: string
  orientation?: 'landscape' | 'portrait' | 'any'
  minLongSide?: number
  minDurationS?: number
  maxDurationS?: number
  /** Other ways to ask for the same thing (the archive’s own words: « Grenzbesetzung 1939 » for « Swiss border 1940 »), at most 3. */
  variants?: string[]
  /** Proposes `variants` itself (Claude on the subscription, see `claudeExpander`); used when `variants` is not given. */
  expand?: QueryExpander
  rerank?: Reranker
  cache?: SearchCache
  /** Drop candidates a person must review (fair-use excerpts…). Default: keep them, flagged. */
  excludeReview?: boolean
}

export interface MediaSearchDeps extends ArchiveDeps {
  /** The value of a secret by vault name (the Cloud reads its vault, a script reads the environment), undefined if not set. */
  secrets?: (name: string) => string | undefined
  providers?: readonly SourcingProvider[]
  run?: RunFn
  /** Whole budget of one provider, default 30 s (the Internet Archive answers in several slow steps). */
  providerTimeoutMs?: number
}

/** One more try after a short pause for a busy search backend (Wikimedia « too busy », HTTP 429 / 5xx). */
async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (signal.aborted || !/too-busy|HTTP (429|5\d\d)/.test(m)) throw e
    await new Promise((r) => setTimeout(r, 1500))
    return await fn()
  }
}

const describe = (e: unknown): string => (e instanceof Error ? (e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timed out or was cancelled' : e.message) : String(e))

export async function searchMedia(query: string, opts: MediaSearchOptions = {}, deps: MediaSearchDeps = {}): Promise<MediaSearchResult> {
  const text = query.trim()
  const kinds: MediaKind[] = [...new Set<MediaKind>(opts.kinds ?? ['image'])].filter((k) => MEDIA_KINDS.includes(k))
  const count = Math.min(30, Math.max(1, Math.floor(opts.count ?? 6)))
  const all = deps.providers ?? PROVIDERS
  const empty: MediaSearchResult = { candidates: [], errors: [], skipped: [], asked: [], costUsd: 0, droppedForbidden: 0, timingsMs: {} }
  if (!text || kinds.length === 0) return empty
  const http = resolveDeps({ ...deps, timeoutMs: deps.timeoutMs ?? 15_000 })
  const errors: ProviderError[] = []
  let variants = (opts.variants ?? []).map((v) => v.trim()).filter(Boolean)
  if (!opts.variants && opts.expand) {
    try {
      variants = (await opts.expand(text, http.signal)).map((v) => v.trim()).filter(Boolean)
    } catch (e) {
      if (http.signal?.aborted) throw http.signal.reason ?? e
      errors.push({ provider: 'expander', message: describe(e) })
    }
  }
  const queries = [...new Set([text, ...variants])].slice(0, 4)
  const skipped: SkippedProvider[] = []
  const asked = new Set<string>()
  const jobs: Array<{ provider: SourcingProvider; kind: MediaKind; ctx: ProviderCtx; query: string }> = []

  for (const p of all) {
    if (opts.providers && !opts.providers.includes(p.id)) continue
    if (p.optIn && !opts.providers?.includes(p.id)) continue
    const can = kinds.filter((k) => p.kinds.includes(k))
    if (can.length === 0) continue
    if (p.paid && !opts.allowPaid) {
      skipped.push({ provider: p.id, reason: 'paid', detail: p.estCostUsd !== undefined ? `about ${p.estCostUsd} $ per use` : undefined })
      continue
    }
    let key: string | undefined
    let demoKey = false
    if (p.secret) {
      key = deps.secrets?.(p.secret)
      if (!key && opts.allowDemoKeys && p.demoKey) {
        key = p.demoKey
        demoKey = true
      }
      if (!key) {
        skipped.push({ provider: p.id, reason: 'no-key', detail: p.secret })
        continue
      }
    }
    const ctx: ProviderCtx = { ...http, ...(key ? { key } : {}), ...(demoKey ? { demoKey } : {}), ...(deps.run ? { run: deps.run } : {}) }
    for (const kind of can) for (const query of queries) jobs.push({ provider: p, kind, ctx, query })
  }

  const budget = deps.providerTimeoutMs ?? 30_000
  const outcomes = await Promise.all(
    jobs.map(async ({ provider, kind, ctx, query: asked1 }) => {
      const q: SourceQuery = {
        query: asked1,
        kind,
        want: count,
        ...(opts.era ? { era: opts.era } : {}),
        ...(opts.orientation ? { orientation: opts.orientation } : {}),
        ...(opts.minLongSide ? { minLongSide: opts.minLongSide } : {}),
        ...(opts.minDurationS !== undefined ? { minDurationS: opts.minDurationS } : {}),
        ...(opts.maxDurationS !== undefined ? { maxDurationS: opts.maxDurationS } : {})
      }
      const k = cacheKey({ p: provider.id, q, demo: ctx.demoKey === true })
      const cached = await opts.cache?.get(k)
      if (cached) return { provider, hits: cached, ms: 0 }
      const started = Date.now()
      const timeout = AbortSignal.timeout(budget)
      const signal = http.signal ? AbortSignal.any([http.signal, timeout]) : timeout
      try {
        const hits = await withRetry(() => provider.search(q, { ...ctx, signal }), signal)
        await opts.cache?.set(k, hits)
        return { provider, hits, ms: Date.now() - started }
      } catch (e) {
        if (http.signal?.aborted) throw http.signal.reason ?? e
        return { provider, hits: [] as MediaCandidate[], error: describe(e), ms: Date.now() - started }
      }
    })
  )
  const timingsMs: Record<string, number> = {}
  for (const o of outcomes) {
    asked.add(o.provider.id)
    timingsMs[o.provider.id] = Math.max(timingsMs[o.provider.id] ?? 0, o.ms)
    if ('error' in o && o.error) errors.push({ provider: o.provider.id, message: o.error })
  }

  let droppedForbidden = 0
  const usable = outcomes
    .flatMap((o) => o.hits)
    .filter((c) => {
      if (c.licence.status === 'forbidden') {
        droppedForbidden++
        return false
      }
      return !(opts.excludeReview && c.review === 'human-review')
    })

  const out: MediaCandidate[] = []
  for (const kind of kinds) {
    let ranked = heuristicRank(dedupeCandidates(usable.filter((c) => c.kind === kind)), queries, { orientation: opts.orientation })
    if (opts.rerank && ranked.length > 1) {
      const head = ranked.slice(0, Math.min(ranked.length, 24))
      try {
        ranked = [...applyRerank(head, await opts.rerank(text, head, http.signal)), ...ranked.slice(head.length)]
      } catch (e) {
        if (http.signal?.aborted) throw http.signal.reason ?? e
        errors.push({ provider: 'reranker', message: describe(e) })
      }
    }
    out.push(...ranked.slice(0, count))
  }
  return { candidates: out, errors, skipped, asked: [...asked], costUsd: out.reduce((n, c) => n + c.costUsd, 0), droppedForbidden, timingsMs }
}
