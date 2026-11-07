// The stock / archive search: the fake (deterministic, local media), the Pexels adapter and the Wikimedia Commons adapter against
// a fake fetch (request shape, auth, parsing, filters, attribution, errors, cost), the keyless guard, and a job end to end.
// Nothing here reaches the network.
import { describe, expect, it } from 'vitest'
import { StockResult } from '../../src/shared/cloud-api.ts'
import { fakeStock } from '../src/providers/fakes.ts'
import { pexelsAdapter, pickVideoFile } from '../src/providers/pexels.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { STOCK_MAX_FILE_BYTES } from '../src/providers/stock-common.ts'
import { RetryableProviderError, runUsage } from '../src/providers/types.ts'
import { licenceUsable, titleOf, wikimediaAdapter } from '../src/providers/wikimedia.ts'
import { ctxFor, fakeFetch, json } from './fake-fetch.ts'
import { makeCloud, quoteAndRun, signUpAndIn } from './helpers.ts'

const KEY = 'pexels-test-SECRET-9c8b7a6f5e'
const PROD = { NODE_ENV: 'production' }
const bytes = (type: string, n = 64): Response => new Response(Buffer.alloc(n, 1), { status: 200, headers: { 'content-type': type } })
const search = (a: ReturnType<typeof pexelsAdapter>, input: Record<string, unknown>, ctx = ctxFor(KEY)) =>
  runUsage(a, 'searchStock', { query: 'phare', orientation: 'landscape', kind: 'photo', count: 2, ...input }, ctx)

describe('the fake stock search', () => {
  it('is deterministic, and every result names an artefact file', async () => {
    const input = { query: 'phare en mer', orientation: 'portrait' as const, kind: 'photo' as const, count: 3 }
    const a = await runUsage(fakeStock, 'searchStock', input, ctxFor(''))
    const b = await runUsage(fakeStock, 'searchStock', input, ctxFor(''))
    expect(a.data).toEqual(b.data)
    expect(a.files.map((f) => f.name)).toEqual(['stock-1.png', 'stock-2.png', 'stock-3.png'])
    const results = (a.data.results as unknown[]).map((r) => StockResult.parse(r))
    expect(results.map((r) => r.file)).toEqual(a.files.map((f) => f.name))
    expect(results.every((r) => r.orientation === 'portrait' && r.source === 'demo')).toBe(true)
    expect(a.files[0]?.bytes.subarray(1, 4).toString()).toBe('PNG')
  })

  it('videos are the sample clip', async () => {
    const out = await runUsage(fakeStock, 'searchStock', { query: 'vagues', orientation: 'landscape', kind: 'video', count: 1 }, ctxFor(''))
    expect(out.files[0]).toMatchObject({ name: 'stock-1.mp4', mime: 'video/mp4' })
    expect(out.files[0]?.bytes.length).toBeGreaterThan(1000)
    expect(StockResult.parse((out.data.results as unknown[])[0]).durationS).toBe(10)
  })
})

const photo = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  width: 4000,
  height: 2500,
  url: `https://www.pexels.com/photo/${id}/`,
  photographer: 'Ada Lovelace',
  photographer_url: 'https://www.pexels.com/@ada',
  alt: `Un phare ${id}`,
  src: { original: `https://images.pexels.com/photos/${id}/original.jpeg`, large2x: `https://images.pexels.com/photos/${id}/large2x.jpeg`, large: `https://images.pexels.com/photos/${id}/large.jpeg` },
  ...over
})

describe('Pexels adapter', () => {
  it('declares its vault secret', () => {
    expect(pexelsAdapter()).toMatchObject({ id: 'pexels', kind: 'real', secretName: 'PEXELS_API_KEY' })
  })

  it('searches photos with the bare key in Authorization, then downloads each file without the key, and keeps the attribution', async () => {
    const f = fakeFetch((req) => (req.url.startsWith('https://api.pexels.com/') ? json({ photos: [photo(1), photo(2), photo(3)] }) : bytes('image/jpeg')))
    const out = await search(pexelsAdapter({ fetchImpl: f.fetch }), { query: 'phare en mer', orientation: 'portrait' })
    const [req, d1, d2] = f.calls
    const url = new URL(req?.url ?? '')
    expect(url.origin + url.pathname).toBe('https://api.pexels.com/v1/search')
    expect(url.searchParams.get('query')).toBe('phare en mer')
    expect(url.searchParams.get('orientation')).toBe('portrait')
    expect(url.searchParams.get('per_page')).toBe('5')
    expect(req?.method).toBe('GET')
    expect(req?.headers.authorization).toBe(KEY)
    expect(req?.url).not.toContain(KEY)
    // the CDN files: the chosen size, no key sent
    expect([d1?.url, d2?.url]).toEqual(['https://images.pexels.com/photos/1/large2x.jpeg', 'https://images.pexels.com/photos/2/large2x.jpeg'])
    expect(f.calls.slice(1).every((c) => c.headers.authorization === undefined)).toBe(true)
    expect(f.calls).toHaveLength(3) // only `count` files were downloaded
    expect(out.files.map((x) => [x.name, x.mime])).toEqual([['stock-1.jpg', 'image/jpeg'], ['stock-2.jpg', 'image/jpeg']])
    const results = (out.data.results as unknown[]).map((r) => StockResult.parse(r))
    expect(results[0]).toMatchObject({
      id: 'pexels-photo-1',
      source: 'pexels',
      kind: 'photo',
      creator: 'Ada Lovelace',
      creatorUrl: 'https://www.pexels.com/@ada',
      pageUrl: 'https://www.pexels.com/photo/1/',
      licence: 'Pexels License',
      attribution: 'Photo by Ada Lovelace on Pexels',
      orientation: 'landscape',
      file: 'stock-1.jpg'
    })
    expect(out.costUsd).toBe(0)
  })

  it('searches videos on the video endpoint and takes the smallest mp4 of at least 1280 px', async () => {
    const files = [
      { file_type: 'video/mp4', width: 640, height: 360, link: 'https://videos.pexels.com/sd.mp4' },
      { file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://videos.pexels.com/hd.mp4' },
      { file_type: 'video/mp4', width: 3840, height: 2160, link: 'https://videos.pexels.com/uhd.mp4' },
      { file_type: 'video/webm', width: 1280, height: 720, link: 'https://videos.pexels.com/x.webm' }
    ]
    expect(pickVideoFile(files)).toBe('https://videos.pexels.com/hd.mp4')
    expect(pickVideoFile(files.slice(0, 1))).toBe('https://videos.pexels.com/sd.mp4')
    expect(pickVideoFile([])).toBeNull()
    const f = fakeFetch((req) =>
      req.url.startsWith('https://api.pexels.com/')
        ? json({ videos: [{ id: 7, width: 1920, height: 1080, url: 'https://www.pexels.com/video/7/', duration: 12, user: { name: 'Grace', url: 'https://www.pexels.com/@grace' }, video_files: files }] })
        : bytes('video/mp4', 2048)
    )
    const out = await search(pexelsAdapter({ fetchImpl: f.fetch }), { kind: 'video', count: 1 })
    expect(new URL(f.calls[0]?.url ?? '').pathname).toBe('/v1/videos/search')
    expect(f.calls[1]?.url).toBe('https://videos.pexels.com/hd.mp4')
    expect(out.files[0]).toMatchObject({ name: 'stock-1.mp4', mime: 'video/mp4' })
    expect(StockResult.parse((out.data.results as unknown[])[0])).toMatchObject({ kind: 'video', attribution: 'Video by Grace on Pexels', durationS: 12 })
  })

  it('skips a file that is too big or not the announced type, and keeps looking', async () => {
    const f = fakeFetch((req) => {
      if (req.url.startsWith('https://api.pexels.com/')) return json({ photos: [photo(1), photo(2), photo(3)] })
      if (req.url.includes('/1/')) return new Response('x', { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(STOCK_MAX_FILE_BYTES + 1) } })
      if (req.url.includes('/2/')) return bytes('text/html')
      return bytes('image/png')
    })
    const out = await search(pexelsAdapter({ fetchImpl: f.fetch }), { count: 1 })
    expect(out.files).toHaveLength(1)
    expect(out.files[0]).toMatchObject({ name: 'stock-1.png', mime: 'image/png' })
    expect((out.data.results as { id: string }[])[0]?.id).toBe('pexels-photo-3')
  })

  it('no result is a success with an empty list (the engine falls back)', async () => {
    const f = fakeFetch(() => json({ photos: [] }))
    const out = await search(pexelsAdapter({ fetchImpl: f.fetch }), {})
    expect(out.files).toEqual([])
    expect(out.data.results).toEqual([])
  })

  it('maps failures: 429 and 5xx retry, 401 is fatal without the key in the message, a wrong shape retries', async () => {
    const run = (status: number, body = '{}') => search(pexelsAdapter({ fetchImpl: fakeFetch(() => new Response(body, { status })).fetch }), {})
    await expect(run(429)).rejects.toBeInstanceOf(RetryableProviderError)
    await expect(run(503)).rejects.toBeInstanceOf(RetryableProviderError)
    const fatal = (await run(401, `{"error":"bad key ${KEY}"}`).catch((e: unknown) => e)) as Error
    expect(fatal).toBeInstanceOf(Error)
    expect(fatal).not.toBeInstanceOf(RetryableProviderError)
    expect(fatal.message).toMatch(/401/)
    expect(fatal.message).not.toContain(KEY)
    await expect(search(pexelsAdapter({ fetchImpl: fakeFetch(() => json({ photos: 'nope' })).fetch }), {})).rejects.toBeInstanceOf(RetryableProviderError)
  })

  it('when every download fails with a retryable error the job retries; when the job is aborted the abort wins', async () => {
    const down = fakeFetch((req) => (req.url.startsWith('https://api.pexels.com/') ? json({ photos: [photo(1)] }) : new Response('', { status: 503 })))
    await expect(search(pexelsAdapter({ fetchImpl: down.fetch }), {})).rejects.toBeInstanceOf(RetryableProviderError)
    const ac = new AbortController()
    const f = fakeFetch((req) => {
      if (req.url.startsWith('https://api.pexels.com/')) {
        ac.abort(new Error('cancelled'))
        return json({ photos: [photo(1)] })
      }
      return bytes('image/jpeg')
    })
    await expect(search(pexelsAdapter({ fetchImpl: f.fetch }), {}, ctxFor(KEY, ac.signal))).rejects.toThrow('cancelled')
  })
})

const WM_ORIGIN = 'https://commons.wikimedia.org'
const page = (index: number, title: string, info: Record<string, unknown>, meta: Record<string, string> = {}) => ({
  pageid: index,
  title,
  index,
  imageinfo: [
    {
      url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${encodeURIComponent(title.slice(5))}`,
      thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${encodeURIComponent(title.slice(5))}/1920px-x.jpg`,
      width: 4000,
      height: 2500,
      mime: 'image/jpeg',
      descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      extmetadata: Object.fromEntries(Object.entries({ LicenseShortName: 'CC BY-SA 4.0', Artist: '<a href="//commons.wikimedia.org/wiki/User:Jo">Jo &amp; Co</a>', AttributionRequired: 'true', ...meta }).map(([k, v]) => [k, { value: v }])),
      ...info
    }
  ]
})

describe('Wikimedia Commons adapter', () => {
  it('is keyless: real, no vault entry', () => {
    expect(wikimediaAdapter()).toMatchObject({ id: 'wikimedia', kind: 'real', keyless: true })
    expect(wikimediaAdapter().secretName).toBeUndefined()
  })

  it('licences: public domain, CC0, CC BY and CC BY-SA only', () => {
    for (const ok of ['Public domain', 'CC0', 'CC BY 4.0', 'CC BY-SA 3.0', 'CC-BY-SA-4.0', 'PD-US', 'PD']) expect(licenceUsable(ok), ok).toBe(true)
    for (const no of ['CC BY-NC 4.0', 'CC BY-ND 2.0', 'CC BY-NC-SA 3.0', 'Fair use', 'GFDL', '', 'All rights reserved']) expect(licenceUsable(no), no).toBe(false)
    expect(titleOf('File:Phare de Créac’h_2008.jpg')).toBe('Phare de Créac’h 2008')
  })

  it('searches with a User-Agent and the right parameters, filters licence / orientation / host, keeps the credit', async () => {
    const pages = [
      page(3, 'File:Third.jpg', {}),
      page(1, 'File:First.jpg', {}, { LicenseShortName: 'Public domain', AttributionRequired: 'false', Artist: '' }),
      page(2, 'File:Nc.jpg', {}, { LicenseShortName: 'CC BY-NC 4.0' }),
      page(4, 'File:Portrait.jpg', { width: 1000, height: 2000 }),
      page(5, 'File:Elsewhere.jpg', { thumburl: 'https://evil.example/x.jpg', url: 'https://evil.example/x.jpg' }),
      page(6, 'File:Vector.svg', { mime: 'image/svg+xml' })
    ]
    const f = fakeFetch((req) => (req.url.startsWith(WM_ORIGIN) ? json({ query: { pages } }) : bytes('image/jpeg')))
    const out = await search(wikimediaAdapter({ fetchImpl: f.fetch, contact: 'ops@example.test' }), { query: 'phare', count: 5 }, ctxFor(''))
    const req = f.calls[0]
    const url = new URL(req?.url ?? '')
    expect(url.origin + url.pathname).toBe(`${WM_ORIGIN}/w/api.php`)
    expect(url.searchParams.get('generator')).toBe('search')
    expect(url.searchParams.get('gsrsearch')).toBe('phare filetype:bitmap')
    expect(url.searchParams.get('gsrnamespace')).toBe('6')
    expect(url.searchParams.get('iiurlwidth')).toBe('1920')
    expect(req?.headers['user-agent']).toBe('AtelierCloud/1.0 (ops@example.test)')
    expect(req?.headers.authorization).toBeUndefined()
    // Commons' own rank order, the kept ones only (no NC, no portrait, no foreign host, no SVG)
    const results = (out.data.results as unknown[]).map((r) => StockResult.parse(r))
    expect(results.map((r) => r.id)).toEqual(['wikimedia-First.jpg', 'wikimedia-Third.jpg'])
    expect(results[0]).toMatchObject({ source: 'wikimedia', licence: 'Public domain', attributionRequired: false, creator: 'Wikimedia Commons', file: 'stock-1.jpg' })
    expect(results[1]).toMatchObject({ licence: 'CC BY-SA 4.0', attributionRequired: true, creator: 'Jo & Co', title: 'Third' })
    expect(results[1]?.attribution).toBe('Third by Jo & Co, CC BY-SA 4.0, via Wikimedia Commons')
    expect(results[1]?.pageUrl).toContain('commons.wikimedia.org/wiki/')
    // the 1920 px rendition is downloaded, with the User-Agent too
    expect(f.calls[1]?.url).toContain('/thumb/')
    expect(f.calls[1]?.headers['user-agent']).toContain('AtelierCloud/1.0')
    expect(out.costUsd).toBe(0)
  })

  it('searches videos with filetype:video and downloads the file itself', async () => {
    const pages = [page(1, 'File:Wave.webm', { mime: 'video/webm', thumburl: undefined }, { LicenseShortName: 'CC0' })]
    const f = fakeFetch((req) => (req.url.startsWith(WM_ORIGIN) ? json({ query: { pages } }) : bytes('video/webm', 512)))
    const out = await search(wikimediaAdapter({ fetchImpl: f.fetch }), { kind: 'video', count: 1 }, ctxFor(''))
    expect(new URL(f.calls[0]?.url ?? '').searchParams.get('gsrsearch')).toBe('phare filetype:video')
    expect(f.calls[1]?.url).toBe('https://upload.wikimedia.org/wikipedia/commons/a/ab/Wave.webm')
    expect(out.files[0]).toMatchObject({ name: 'stock-1.webm', mime: 'video/webm' })
  })

  it('an API error inside a 200 answer is fatal; a 5xx retries; no page at all is an empty success', async () => {
    const run = (res: () => Response) => search(wikimediaAdapter({ fetchImpl: fakeFetch(res).fetch }), {}, ctxFor(''))
    await expect(run(() => json({ error: { code: 'badvalue' } }))).rejects.toThrow(/badvalue/)
    await expect(run(() => new Response('', { status: 500 }))).rejects.toBeInstanceOf(RetryableProviderError)
    const none = await run(() => json({ batchcomplete: true }))
    expect(none.data.results).toEqual([])
  })
})

describe('the keyless guard and a job end to end', () => {
  const setup = (extra: Parameters<typeof makeCloud>[0] = {}, fetchImpl?: typeof fetch) => {
    const f = fakeFetch(
      (req) => (req.url.startsWith(WM_ORIGIN) ? json({ query: { pages: [page(1, 'File:One.jpg', {})] } }) : bytes('image/jpeg')),
    )
    return { f, t: makeCloud({ paidCalls: true, env: PROD, realAdapters: [wikimediaAdapter({ fetchImpl: fetchImpl ?? f.fetch })], providers: { searchStock: 'wikimedia' }, ...extra }) }
  }

  it('a keyless adapter is real without a vault entry, but only with paidCalls on and when the config picks it', () => {
    const { t } = setup()
    const reg = (o: { paidCalls?: boolean; select?: Record<string, string>; env?: NodeJS.ProcessEnv }) =>
      new ProviderRegistry({ paidCalls: o.paidCalls ?? true, vault: t.cloud.vault, real: [wikimediaAdapter({ fetchImpl: fakeFetch(() => json({})).fetch })], select: o.select ?? { searchStock: 'wikimedia' }, env: o.env ?? PROD })
    expect(reg({}).resolve('searchStock')).toMatchObject({ status: 'real', adapter: { id: 'wikimedia' }, reason: null })
    expect(reg({ paidCalls: false }).resolve('searchStock')).toMatchObject({ status: 'demo', reason: 'paidCalls is off' })
    expect(reg({ select: { searchStock: 'fake' } }).resolve('searchStock').status).toBe('demo')
    expect(reg({ env: { VITEST: 'true' } }).resolve('searchStock').status).toBe('demo')
    expect(reg({}).overview().find((o) => o.usage === 'searchStock')).toMatchObject({ provider: 'wikimedia', status: 'real', wanted: 'wikimedia' })
  })

  it('runs a stock search as a real job that is free (decision 0105): 0 credit, the file as an artefact, the credit line in the result', async () => {
    const { t, f } = setup()
    const p = await signUpAndIn(t, { credits: 100 })
    const { quote, job } = await quoteAndRun(t, p, 'searchStock', { query: 'phare', orientation: 'landscape', kind: 'photo', count: 1 })
    expect(t.cloud.pricing.getQuote(quote.id)?.lines).toEqual([expect.objectContaining({ item: 'stock.searches', quantity: 1, credits: 0 })])
    expect(job).toMatchObject({ state: 'succeeded', demo: false, credits: 0 })
    expect(job.artefacts).toHaveLength(1)
    expect((job.artefacts[0] as { name?: string }).name).toBe('stock-1.jpg')
    const results = (job.result as { results: unknown[] }).results.map((r) => StockResult.parse(r))
    expect(results[0]?.attribution).toContain('via Wikimedia Commons')
    expect(f.calls).toHaveLength(2)
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ balance: 100, held: 0 })
  })

  it('with the default configuration the same usage is the demo: local media, no network', async () => {
    const f = fakeFetch(() => json({}))
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [wikimediaAdapter({ fetchImpl: f.fetch })], providers: { searchStock: 'fake' } })
    const p = await signUpAndIn(t, { credits: 100 })
    const { job } = await quoteAndRun(t, p, 'searchStock', { query: 'phare', count: 2 })
    expect(job).toMatchObject({ state: 'succeeded', demo: true })
    expect(job.artefacts).toHaveLength(2)
    expect(f.calls).toHaveLength(0)
  })

  it('the grid prices stock.searches even on a grid stored before the usage existed', async () => {
    const t = makeCloud()
    const item = t.cloud.pricing.current().items.find((i) => i.item === 'stock.searches')
    expect(item).toMatchObject({ usage: 'searchStock', providerCostUsd: 0, pricing: { mode: 'percent', marginPct: 0 } })
  })
})
