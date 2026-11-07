// The Pixabay stock adapter (the primary stock source since Pexels paused new keys): request shape, filters, attribution, the 24 h cache,
// the own rate window, failures, and the keyless fallback that keeps a search inside found media (never a generated picture).
// Nothing here reaches the network.
import { describe, expect, it } from 'vitest'
import { StockResult } from '../../src/shared/cloud-api.ts'
import { archiveCandidates, FALLBACK_PROVIDERS, pickPixabayVideo, pixabayAdapter, PIXABAY_CACHE_MS, PIXABAY_MAX_PER_WINDOW } from '../src/providers/pixabay.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { RetryableProviderError, runUsage } from '../src/providers/types.ts'
import type { MediaCandidate } from '../../src/engine/sourcing/types.ts'
import { ctxFor, fakeFetch, json } from './fake-fetch.ts'
import { makeCloud } from './helpers.ts'

const KEY = 'pixabay-test-SECRET-1a2b3c4d5e'
const bytes = (type: string, n = 64): Response => new Response(Buffer.alloc(n, 1), { status: 200, headers: { 'content-type': type } })
const search = (a: ReturnType<typeof pixabayAdapter>, input: Record<string, unknown>, ctx = ctxFor(KEY)) =>
  runUsage(a, 'searchStock', { query: 'crowd cheering', orientation: 'landscape', kind: 'photo', count: 2, ...input }, ctx)
const photo = (id: number, w = 1280, h = 853) => ({ id, pageURL: `https://pixabay.com/photos/${id}/`, tags: 'crowd, people, stadium, fans', user: 'Bob', imageWidth: w, imageHeight: h, largeImageURL: `https://pixabay.com/get/p${id}.jpg`, webformatURL: `https://pixabay.com/get/w${id}.jpg` })
const video = (id: number, sizes: Record<string, [number, number]>) => ({ id, pageURL: `https://pixabay.com/videos/${id}/`, tags: 'sea, waves', user: 'Ann', duration: 14, videos: Object.fromEntries(Object.entries(sizes).map(([k, [w, h]]) => [k, { url: `https://cdn.pixabay.com/v${id}-${k}.mp4`, width: w, height: h }])) })
const none = async () => []

describe('the Pixabay adapter', () => {
  it('is a real adapter with the vault name PIXABAY_API_KEY', () => {
    expect(pixabayAdapter()).toMatchObject({ id: 'pixabay', kind: 'real', secretName: 'PIXABAY_API_KEY' })
  })

  it('searches photos with the key in the query, the orientation as Pixabay words it, safesearch on; downloads the large file; keeps the credit', async () => {
    const f = fakeFetch((req) => (req.url.startsWith('https://pixabay.com/api/') ? json({ hits: [photo(1), photo(2, 800, 1200), photo(3)] }) : bytes('image/jpeg', 2048)))
    const out = await search(pixabayAdapter({ fetchImpl: f.fetch, fallback: none }), {})
    const u = new URL(f.calls[0]!.url)
    expect(u.pathname).toBe('/api/')
    expect(u.searchParams.get('key')).toBe(KEY)
    expect(u.searchParams.get('q')).toBe('crowd cheering')
    expect(u.searchParams.get('orientation')).toBe('horizontal')
    expect(u.searchParams.get('image_type')).toBe('photo')
    expect(u.searchParams.get('safesearch')).toBe('true')
    expect(f.calls.slice(1).map((c) => c.url)).toEqual(['https://pixabay.com/get/p1.jpg', 'https://pixabay.com/get/p3.jpg']) // the portrait hit was skipped
    expect(out.files.map((x) => x.name)).toEqual(['stock-1.jpg', 'stock-2.jpg'])
    const r = StockResult.parse((out.data.results as unknown[])[0])
    expect(r).toMatchObject({ id: 'pixabay-photo-1', source: 'pixabay', licence: 'Pixabay Content License', attribution: 'Photo by Bob on Pixabay', attributionRequired: false, orientation: 'landscape' })
    expect(out.costUsd).toBe(0)
  })

  it('searches videos on /api/videos/, picks the smallest file that reaches 1280 px, filters the orientation after', async () => {
    expect(pickPixabayVideo({ large: { url: 'https://c/l.mp4', width: 1920, height: 1080 }, small: { url: 'https://c/s.mp4', width: 960, height: 540 }, medium: { url: 'https://c/m.mp4', width: 1280, height: 720 } })).toMatchObject({ url: 'https://c/m.mp4' })
    expect(pickPixabayVideo({ small: { url: 'https://c/s.mp4', width: 640, height: 360 }, tiny: { url: '' } })).toMatchObject({ url: 'https://c/s.mp4' })
    expect(pickPixabayVideo({})).toBeNull()
    const f = fakeFetch((req) => (req.url.startsWith('https://pixabay.com/api/videos/') ? json({ hits: [video(7, { large: [1080, 1920] }), video(8, { large: [1920, 1080], small: [640, 360] })] }) : bytes('video/mp4', 4096)))
    const out = await search(pixabayAdapter({ fetchImpl: f.fetch, fallback: none }), { kind: 'video', count: 1 })
    expect(new URL(f.calls[0]!.url).pathname).toBe('/api/videos/')
    expect(f.calls[1]!.url).toBe('https://cdn.pixabay.com/v8-large.mp4')
    expect(StockResult.parse((out.data.results as unknown[])[0])).toMatchObject({ id: 'pixabay-video-8', kind: 'video', durationS: 14, attribution: 'Video by Ann on Pixabay' })
  })

  it('caches the hits 24 hours: the same search asks Pixabay once, a day later it asks again', async () => {
    let now = 1_000
    const f = fakeFetch((req) => (req.url.startsWith('https://pixabay.com/api/') ? json({ hits: [photo(1), photo(2)] }) : bytes('image/jpeg')))
    const a = pixabayAdapter({ fetchImpl: f.fetch, fallback: none, now: () => now })
    await search(a, {})
    await search(a, {})
    expect(f.calls.filter((c) => c.url.startsWith('https://pixabay.com/api/'))).toHaveLength(1)
    now += PIXABAY_CACHE_MS + 1
    await search(a, {})
    expect(f.calls.filter((c) => c.url.startsWith('https://pixabay.com/api/'))).toHaveLength(2)
  })

  it('keeps under the 100 requests a minute: past its own window it asks the job to retry', async () => {
    const f = fakeFetch((req) => (req.url.startsWith('https://pixabay.com/api/') ? json({ hits: [] }) : bytes('image/jpeg')))
    const a = pixabayAdapter({ fetchImpl: f.fetch, fallback: none, now: () => 5_000 })
    for (let i = 0; i < PIXABAY_MAX_PER_WINDOW; i++) await search(a, { query: `q${i}` })
    await expect(search(a, { query: 'one more' })).rejects.toBeInstanceOf(RetryableProviderError)
  })

  it('maps failures: 429 and 5xx retry, 401 is fatal and never shows the key, a wrong shape retries', async () => {
    const run = (status: number, body = '{}') => search(pixabayAdapter({ fetchImpl: fakeFetch(() => new Response(body, { status })).fetch, fallback: none }), {})
    await expect(run(429)).rejects.toBeInstanceOf(RetryableProviderError)
    await expect(run(503)).rejects.toBeInstanceOf(RetryableProviderError)
    const fatal = (await run(400, `[ERROR 400] Invalid key ${KEY}`).catch((e: unknown) => e)) as Error
    expect(fatal).not.toBeInstanceOf(RetryableProviderError)
    expect(fatal.message).not.toContain(KEY)
    await expect(search(pixabayAdapter({ fetchImpl: fakeFetch(() => json({ hits: 'nope' })).fetch, fallback: none }), {})).rejects.toBeInstanceOf(RetryableProviderError)
  })
})

describe('the fallback stays inside found media', () => {
  const archive = (id: string, over: Partial<MediaCandidate> = {}): MediaCandidate => ({
    provider: 'internet-archive-video', id, kind: 'video', title: `Film ${id}`, pageUrl: `https://archive.org/details/${id}`, previewUrl: '', fileUrl: `https://archive.org/download/${id}/${id}.mp4`,
    licence: { short: 'Public domain', status: 'public-domain', attributionRequired: false }, credit: `Film ${id}, Public domain, via Internet Archive`, review: 'clear', costUsd: 0, score: 5, durationS: 120, ...over
  })

  it('names keyless banks only, and drops forbidden and fair-use candidates and known wrong orientations', () => {
    expect(FALLBACK_PROVIDERS.video).toEqual(['wikimedia-video', 'nasa-video', 'internet-archive-video'])
    expect(FALLBACK_PROVIDERS.photo).toContain('internet-archive')
    const c = archiveCandidates(
      [archive('a'), archive('b', { licence: { short: 'x', status: 'fair-use-excerpt', attributionRequired: true } }), archive('c', { width: 720, height: 1280 }), archive('d', { fileUrl: 'http://insecure/x.mp4' }), archive('e', { provider: 'wikimedia-video' })],
      'video',
      'landscape'
    )
    expect(c.map((x) => x.result.id)).toEqual(['internet-archive-video-a', 'wikimedia-video-e'])
    expect(c.map((x) => x.result.source)).toEqual(['archive', 'wikimedia'])
    expect(StockResult.omit({ file: true }).parse(c[0]!.result).attribution).toBe('Film a, Public domain, via Internet Archive')
  })

  it('when Pixabay finds nothing, the job gets archive footage instead, with the archive’s credit; never a generated picture', async () => {
    const f = fakeFetch((req) => (req.url.startsWith('https://pixabay.com/api/') ? json({ hits: [] }) : bytes('video/mp4', 4096)))
    const a = pixabayAdapter({ fetchImpl: f.fetch, fallback: async (input) => archiveCandidates([archive('x'), archive('y')], input.kind, input.orientation) })
    const out = await search(a, { kind: 'video', count: 2 })
    expect(out.files.map((x) => x.name)).toEqual(['stock-1.mp4', 'stock-2.mp4'])
    expect(out.data).toMatchObject({ provider: 'pixabay', fallback: true })
    expect((out.data.results as Array<{ source: string }>).map((r) => r.source)).toEqual(['archive', 'archive'])
  })

  it('Pixabay results come first and the fallback only fills what is missing; a failing fallback is not an error', async () => {
    const f = fakeFetch((req) => (req.url.startsWith('https://pixabay.com/api/') ? json({ hits: [photo(1)] }) : bytes('image/jpeg')))
    let asked = 0
    const a = pixabayAdapter({ fetchImpl: f.fetch, fallback: async (input) => ((asked = input.count), archiveCandidates([archive('z', { kind: 'image', provider: 'wikimedia', fileUrl: 'https://upload.wikimedia.org/z.jpg' })], 'photo', 'landscape')) })
    const out = await search(a, { count: 3 })
    expect(asked).toBe(2)
    expect((out.data.results as Array<{ id: string }>).map((r) => r.id)).toEqual(['pixabay-photo-1', 'wikimedia-z'])
    const broken = pixabayAdapter({ fetchImpl: f.fetch, fallback: async () => { throw new Error('IA down') } })
    expect((await search(broken, { count: 2, query: 'other' })).files).toHaveLength(1)
  })
})

describe('the Cloud configuration', () => {
  it('searchStock: "pixabay" is accepted and picks the adapter when its key is in the vault', () => {
    const t = makeCloud({ paidCalls: true, env: { NODE_ENV: 'production' }, realAdapters: [pixabayAdapter({ fetchImpl: fakeFetch(() => json({})).fetch })], providers: { searchStock: 'pixabay' } })
    const reg = new ProviderRegistry({ paidCalls: true, vault: t.cloud.vault, real: [pixabayAdapter()], select: { searchStock: 'pixabay' }, env: { NODE_ENV: 'production' } })
    expect(reg.resolve('searchStock')).toMatchObject({ status: 'demo', reason: 'the platform key is not in the vault' })
    t.cloud.vault.set('PIXABAY_API_KEY', KEY, 'test')
    expect(reg.resolve('searchStock')).toMatchObject({ status: 'real', adapter: { id: 'pixabay' } })
  })
})
