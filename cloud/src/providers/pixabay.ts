// Pixabay stock photos and videos (usage `searchStock`), the primary stock source now that Pexels has paused new keys (2026-11-02).
// Written from the official documentation (https://pixabay.com/api/docs/, read 2026-11-02):
//   Photos  GET https://pixabay.com/api/?key=&q=&image_type=photo&orientation=horizontal|vertical|all&per_page=&safesearch=true
//           → hits[]: { id, pageURL, tags, user, imageWidth, imageHeight, webformatURL, largeImageURL }
//   Videos  GET https://pixabay.com/api/videos/?key=&q=&per_page=&safesearch=true   (no orientation filter: done after)
//           → hits[]: { id, pageURL, tags, user, duration, picture_id, videos { large|medium|small|tiny { url, width, height, size } } }
//   Limits  100 requests per 60 s per key (the adapter keeps its own sliding window and asks the job to retry rather than hit the 429).
//   Terms   Pixabay Content License: free commercial use, no credit needed (the credit line is still kept with the result). Results MUST
//           be cached for 24 hours (the hits are cached here, in memory, per query). Files are DOWNLOADED, never hot-linked
//           (stock-common.ts `collect`). The key goes in the query string (the API takes no header): `call` masks it in logs and errors.
// When Pixabay returns fewer results than asked, the search goes on in keyless banks (never a generated picture): Wikimedia Commons,
// NASA, the Met, Wellcome and the Internet Archive moving images, through the sourcing bricks (src/engine/sourcing). A Pexels key,
// if one is ever issued, stays a separate choice (`providers.searchStock: "pexels"`).
// Cost: free (costUsd 0); the grid's `stock.searches` item is 0 credit too (decision 0105).
import { z } from 'zod'
import { searchMedia } from '../../../src/engine/sourcing/search.ts'
import type { MediaCandidate, MediaKind } from '../../../src/engine/sourcing/types.ts'
import { orientationOf, type StockResult } from '../../../src/shared/cloud-api.ts'
import { call, readJson, type HttpOptions } from './http.ts'
import { collect, type Candidate } from './stock-common.ts'
import { RetryableProviderError, type ProviderAdapter } from './types.ts'

export const PIXABAY_BASE = 'https://pixabay.com'
export const PIXABAY_CACHE_MS = 24 * 3600 * 1000
export const PIXABAY_WINDOW_MS = 60_000
/** The real limit is 100 a minute; one search makes one request, so staying under 90 leaves room for the other jobs of a team. */
export const PIXABAY_MAX_PER_WINDOW = 90

const Hit = z
  .object({
    id: z.number(),
    pageURL: z.string().optional(),
    tags: z.string().optional(),
    user: z.string().optional(),
    imageWidth: z.number().optional(),
    imageHeight: z.number().optional(),
    webformatURL: z.string().optional(),
    largeImageURL: z.string().optional(),
    duration: z.number().optional(),
    videos: z.record(z.string(), z.object({ url: z.string().optional(), width: z.number().optional(), height: z.number().optional() }).passthrough()).optional()
  })
  .passthrough()
const Answer = z.object({ hits: z.array(Hit).default([]) }).passthrough()

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const
const VIDEO_MIMES = ['video/mp4'] as const

/** The video file to download: the smallest rendition whose long side reaches 1280 px, else the biggest listed. */
export function pickPixabayVideo(videos: z.infer<typeof Hit>['videos']): { url: string; width: number; height: number } | null {
  const list = Object.values(videos ?? {})
    .filter((v): v is { url: string; width?: number; height?: number } => typeof v.url === 'string' && v.url.startsWith('https://'))
    .map((v) => ({ url: v.url, width: v.width ?? 0, height: v.height ?? 0 }))
    .sort((a, b) => Math.max(a.width, a.height) - Math.max(b.width, b.height))
  return list.find((v) => Math.max(v.width, v.height) >= 1280) ?? list.at(-1) ?? null
}

/** The keyless banks tried, in order of preference, when Pixabay does not fill the request. */
export const FALLBACK_PROVIDERS: Record<'photo' | 'video', string[]> = {
  photo: ['wikimedia', 'wellcome', 'met', 'nasa', 'internet-archive'],
  video: ['wikimedia-video', 'nasa-video', 'internet-archive-video']
}

const SOURCE_NAME: Record<string, string> = { wikimedia: 'wikimedia', 'wikimedia-video': 'wikimedia' }

/** Archive candidates from the sourcing bricks, shaped as stock candidates (files downloaded by `collect`, like any other). */
export function archiveCandidates(found: readonly MediaCandidate[], kind: 'photo' | 'video', orientation: 'landscape' | 'portrait' | 'square'): Candidate[] {
  const out: Candidate[] = []
  for (const c of found) {
    if (!c.fileUrl.startsWith('https://') || c.licence.status === 'forbidden' || c.licence.status === 'fair-use-excerpt') continue
    // a size we do not know is not a reason to drop an archive film; a known wrong orientation is
    if (c.width && c.height && orientationOf(c.width, c.height) !== orientation) continue
    out.push({
      url: c.fileUrl,
      mimes: kind === 'video' ? VIDEO_MIMES : IMAGE_MIMES,
      result: {
        id: `${c.provider}-${c.id}`.replace(/[^\w.-]+/g, '_').slice(0, 120),
        source: SOURCE_NAME[c.provider] === 'wikimedia' ? 'wikimedia' : 'archive',
        kind,
        title: c.title,
        creator: (c.creator ?? c.provider).slice(0, 200),
        creatorUrl: null,
        pageUrl: c.pageUrl || null,
        licence: c.licence.short,
        attribution: c.credit,
        attributionRequired: c.licence.attributionRequired,
        width: c.width ?? 0,
        height: c.height ?? 0,
        orientation,
        durationS: c.durationS ?? null
      }
    })
  }
  return out
}

export interface PixabayOptions extends HttpOptions {
  baseUrl?: string
  /** Tests: the clock the cache and the rate window read. */
  now?: () => number
  /** Tests: replaces the keyless fallback (default: the sourcing bricks over the network). */
  fallback?: (input: { query: string; kind: 'photo' | 'video'; orientation: 'landscape' | 'portrait' | 'square'; count: number }, signal: AbortSignal) => Promise<Candidate[]>
}

export function pixabayAdapter(o: PixabayOptions = {}): ProviderAdapter {
  const base = (o.baseUrl ?? PIXABAY_BASE).replace(/\/+$/, '')
  const now = o.now ?? Date.now
  const label = 'Pixabay search'
  const cache = new Map<string, { at: number; hits: Candidate[] }>()
  const window: number[] = []

  const defaultFallback: NonNullable<PixabayOptions['fallback']> = async (input, signal) => {
    const kind: MediaKind = input.kind === 'video' ? 'video' : 'image'
    const r = await searchMedia(
      input.query,
      { kinds: [kind], count: input.count * 2, orientation: input.orientation === 'square' ? 'any' : input.orientation, providers: FALLBACK_PROVIDERS[input.kind], minLongSide: 1000 },
      { signal, providerTimeoutMs: 25_000, ...(o.fetchImpl ? { fetch: o.fetchImpl } : {}) }
    )
    return archiveCandidates(r.candidates, input.kind, input.orientation)
  }

  return {
    id: 'pixabay',
    kind: 'real',
    secretName: 'PIXABAY_API_KEY',
    async searchStock(input, ctx) {
      const secret = ctx.secret()
      const video = input.kind === 'video'
      ctx.progress(0.1)
      const key = JSON.stringify([input.query, input.kind, input.orientation, input.count])
      let candidates: Candidate[]
      const hot = cache.get(key)
      if (hot && now() - hot.at < PIXABAY_CACHE_MS) {
        candidates = hot.hits
      } else {
        while (window.length && now() - window[0]! > PIXABAY_WINDOW_MS) window.shift()
        if (window.length >= PIXABAY_MAX_PER_WINDOW) throw new RetryableProviderError(`${label}: the 100 requests a minute limit is close, will retry`)
        window.push(now())
        const url = new URL(`${base}${video ? '/api/videos/' : '/api/'}`)
        const q = url.searchParams
        q.set('key', secret)
        q.set('q', input.query.slice(0, 100))
        q.set('safesearch', 'true')
        q.set('per_page', String(Math.min(50, Math.max(3, input.count * 4))))
        if (!video) {
          q.set('image_type', 'photo')
          if (input.orientation !== 'square') q.set('orientation', input.orientation === 'landscape' ? 'horizontal' : 'vertical')
        }
        const res = await call({ label, url: url.toString(), secret, signal: ctx.signal, init: { method: 'GET', headers: { accept: 'application/json' } } }, o)
        const parsed = Answer.safeParse(await readJson(res, label, ctx.signal))
        if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
        candidates = []
        for (const h of parsed.data.hits) {
          const who = h.user?.trim() || 'Pixabay'
          const tags = (h.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean)
          const title = tags.slice(0, 4).join(', ') || input.query
          if (video) {
            const file = pickPixabayVideo(h.videos)
            if (!file || (file.width && file.height && orientationOf(file.width, file.height) !== input.orientation)) continue
            candidates.push({
              url: file.url,
              mimes: VIDEO_MIMES,
              result: { id: `pixabay-video-${h.id}`, source: 'pixabay', kind: 'video', title, creator: who, creatorUrl: null, pageUrl: h.pageURL ?? null, licence: 'Pixabay Content License', attribution: `Video by ${who} on Pixabay`, attributionRequired: false, width: file.width, height: file.height, orientation: input.orientation, durationS: h.duration ?? null }
            })
          } else {
            const link = h.largeImageURL ?? h.webformatURL
            if (!link || !h.imageWidth || !h.imageHeight || orientationOf(h.imageWidth, h.imageHeight) !== input.orientation) continue
            candidates.push({
              url: link,
              mimes: IMAGE_MIMES,
              result: { id: `pixabay-photo-${h.id}`, source: 'pixabay', kind: 'photo', title, creator: who, creatorUrl: null, pageUrl: h.pageURL ?? null, licence: 'Pixabay Content License', attribution: `Photo by ${who} on Pixabay`, attributionRequired: false, width: h.imageWidth, height: h.imageHeight, orientation: input.orientation, durationS: null }
            })
          }
        }
        cache.set(key, { at: now(), hits: candidates })
      }
      // Pixabay did not fill the request: keyless banks next, never a generated picture. The fallback is best effort: its failure is a note.
      let extra: Candidate[] = []
      if (candidates.length < input.count) {
        try {
          extra = await (o.fallback ?? defaultFallback)({ query: input.query, kind: input.kind, orientation: input.orientation, count: input.count - candidates.length }, ctx.signal)
        } catch (e) {
          if (ctx.signal.aborted) throw ctx.signal.reason ?? e
        }
      }
      const { files, results } = await collect([...candidates, ...extra], input.count, 'Pixabay download', ctx.signal, o, (f) => ctx.progress(0.1 + 0.9 * f))
      ctx.progress(1)
      return { files, data: { query: input.query, kind: input.kind, orientation: input.orientation, provider: 'pixabay', fallback: results.some((r) => r.source !== 'pixabay'), results: results as StockResult[] }, costUsd: 0 }
    }
  }
}
