// YouTube channel data (usage `channelData`): the fake, the YouTube Data API adapter against a fake fetch (request shape and
// read-only guarantee, pagination, quota accounting and the daily budget, error mapping), the persisted daily counter, the
// config and the guard, and a job end to end. Nothing here reaches the network.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ChannelDataResult } from '../../src/shared/cloud-api.ts'
import { ManualClock } from '../src/clock.ts'
import { loadConfig } from '../src/config.ts'
import { fakeChannelData } from '../src/providers/fakes.ts'
import { realProviders } from '../src/providers/real.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { RetryableProviderError, runUsage } from '../src/providers/types.ts'
import { estimateUnits, isoDurationS, memoryMeter, parseChannelUrl, youtubeAdapter, YOUTUBE_ENDPOINTS } from '../src/providers/youtube.ts'
import { QuotaLedger, pacificDay } from '../src/quota.ts'
import { ctxFor, fakeFetch, json, type Recorded } from './fake-fetch.ts'
import { makeCloud, quoteAndRun, signUpAndIn } from './helpers.ts'

const KEY = 'AIzaSy-test-SECRET-9c8b7a6f5e4d3c2b1a'
const PROD = { NODE_ENV: 'production' }
const BASE = 'https://www.googleapis.com/youtube/v3'
const UC = 'UCabcdefghijklmnopqrstuv'
const HANDLE = 'https://www.youtube.com/@exemple'

/** A fake YouTube: a channel with `n` uploads (newest first) served the way the API serves them, 50 a page. */
function youtube(n: number, o: { hidden?: boolean; missing?: string[]; viewsOf?: (i: number) => number } = {}) {
  const ids = Array.from({ length: n }, (_, i) => `vid${String(i).padStart(8, '0')}`)
  const handler = (req: Recorded): Response => {
    const url = new URL(req.url)
    const path = url.pathname.replace('/youtube/v3', '')
    if (path === '/channels') {
      return json({
        items: [
          {
            id: UC,
            snippet: { title: 'Chaîne exemple' },
            statistics: { subscriberCount: '12345', hiddenSubscriberCount: o.hidden ?? false, viewCount: '9876543', videoCount: String(n) },
            contentDetails: { relatedPlaylists: { uploads: 'UUabcdefghijklmnopqrstuv' } }
          }
        ]
      })
    }
    if (path === '/playlistItems') {
      const size = Number(url.searchParams.get('maxResults'))
      const start = Number(url.searchParams.get('pageToken') ?? 0)
      const page = ids.slice(start, start + size)
      const next = start + size < n ? String(start + size) : undefined
      return json({ items: page.map((videoId) => ({ contentDetails: { videoId } })), ...(next ? { nextPageToken: next } : {}) })
    }
    if (path === '/videos') {
      const asked = (url.searchParams.get('id') ?? '').split(',')
      return json({
        items: asked
          .filter((id) => !(o.missing ?? []).includes(id))
          .map((id) => {
            const i = ids.indexOf(id)
            return {
              id,
              snippet: { title: `Titre ${i}`, publishedAt: new Date(Date.UTC(2026, 8, 30 - i)).toISOString(), channelId: UC, thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hq.jpg` } } },
              statistics: { viewCount: String(o.viewsOf ? o.viewsOf(i) : 1000 + i), likeCount: '50', commentCount: '5' },
              contentDetails: { duration: 'PT10M30S' }
            }
          })
      })
    }
    return new Response('{}', { status: 404 })
  }
  return { ids, handler }
}

/** Writes a config.json into the Cloud's data folder (tests only). */
function writeConfig(dir: string, raw: unknown): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify(raw))
}

const read = (a: ReturnType<typeof youtubeAdapter>, input: Record<string, unknown>, ctx = ctxFor(KEY, undefined, memoryMeter())) =>
  runUsage(a, 'channelData', { url: HANDLE, maxVideos: 30, ...input }, ctx)

describe('the fake channel data', () => {
  it('answers the shape the app reads, with a few spikes for the outlier maths to find', async () => {
    const out = await runUsage(fakeChannelData, 'channelData', { url: HANDLE, maxVideos: 12 }, ctxFor(''))
    const data = ChannelDataResult.parse(out.data)
    expect(data.videos).toHaveLength(12)
    expect(data.quotaUnits).toBe(0)
    expect(data.channelId).toMatch(/^UCdemo/)
    expect(Math.max(...data.videos.map((v) => v.views))).toBeGreaterThan(3 * Math.min(...data.videos.map((v) => v.views)))
  })
})

describe('reading a channel link', () => {
  it('finds the channel by id, @handle or legacy user name, and a video link gives its video', () => {
    expect(parseChannelUrl(`https://www.youtube.com/channel/${UC}`)).toEqual({ kind: 'id', value: UC })
    expect(parseChannelUrl('https://www.youtube.com/@Exemple/videos')).toEqual({ kind: 'handle', value: '@Exemple' })
    expect(parseChannelUrl('https://www.youtube.com/user/oldname')).toEqual({ kind: 'user', value: 'oldname' })
    expect(parseChannelUrl('https://www.youtube.com/watch?v=abc123DEF45')).toEqual({ kind: 'video', value: 'abc123DEF45' })
    expect(parseChannelUrl('https://youtu.be/abc123DEF45')).toEqual({ kind: 'video', value: 'abc123DEF45' })
    expect(parseChannelUrl('https://www.youtube.com/shorts/abc123DEF45')).toEqual({ kind: 'video', value: 'abc123DEF45' })
  })

  it('refuses a custom URL: it has no free lookup (search.list costs 100 units)', () => {
    expect(() => parseChannelUrl('https://www.youtube.com/c/monnom')).toThrow(/cannot be looked up for free/)
    expect(() => parseChannelUrl('https://www.youtube.com/')).toThrow(/cannot be looked up for free/)
  })

  it('reads ISO 8601 durations', () => {
    expect(isoDurationS('PT10M30S')).toBe(630)
    expect(isoDurationS('PT1H2M3S')).toBe(3723)
    expect(isoDurationS('P1DT1H')).toBe(90_000)
    expect(isoDurationS('P0D')).toBe(0)
    expect(isoDurationS(undefined)).toBe(0)
    expect(isoDurationS('nonsense')).toBe(0)
  })
})

describe('the YouTube Data API adapter', () => {
  it('declares its vault secret and implements channelData only', () => {
    const a = youtubeAdapter()
    expect(a).toMatchObject({ id: 'youtube', kind: 'real', secretName: 'YOUTUBE_API_KEY' })
    expect(a.keyless).toBeUndefined()
    expect(typeof a.channelData).toBe('function')
    expect(a.synthesize).toBeUndefined()
  })

  it('reads a channel: the key in a header, GET on the three list endpoints only, every call counted', async () => {
    const yt = youtube(30)
    const f = fakeFetch(yt.handler)
    const meter = memoryMeter()
    const out = await read(youtubeAdapter({ fetchImpl: f.fetch }), {}, ctxFor(KEY, undefined, meter))
    const data = ChannelDataResult.parse(out.data)
    expect(data).toMatchObject({ channelId: UC, title: 'Chaîne exemple', subscribers: 12345, totalViews: 9876543, videoCount: 30, quotaUnits: 3 })
    expect(data.videos).toHaveLength(30)
    expect(data.videos[0]).toEqual({
      id: yt.ids[0],
      title: 'Titre 0',
      views: 1000,
      likes: 50,
      comments: 5,
      durationS: 630,
      publishedAt: '2026-09-30T00:00:00.000Z',
      thumbnailUrl: `https://i.ytimg.com/vi/${yt.ids[0]}/hq.jpg`
    })
    expect(out.costUsd).toBe(0)
    expect(out.files).toEqual([])
    // channels, one playlist page, one videos call = 3 units, counted in the meter too
    expect(f.calls.map((c) => new URL(c.url).pathname.replace('/youtube/v3/', ''))).toEqual(['channels', 'playlistItems', 'videos'])
    expect(meter.used()).toBe(3)
    // the @handle goes to forHandle
    expect(new URL(f.calls[0]?.url ?? '').searchParams.get('forHandle')).toBe('@exemple')
  })

  it('is read-only: only GET, only the three list endpoints, no OAuth, and the key never in a URL', async () => {
    const f = fakeFetch(youtube(60).handler)
    await read(youtubeAdapter({ fetchImpl: f.fetch }), { maxVideos: 60 })
    expect(f.calls.length).toBeGreaterThan(0)
    for (const c of f.calls) {
      expect(c.method).toBe('GET')
      expect(c.body).toBe('')
      expect(c.url.startsWith(`${BASE}/`)).toBe(true)
      expect(YOUTUBE_ENDPOINTS as readonly string[]).toContain(new URL(c.url).pathname.replace('/youtube/v3/', ''))
      expect(c.url).not.toContain(KEY)
      expect(c.url).not.toMatch(/[?&]key=/)
      expect(c.headers['x-goog-api-key']).toBe(KEY)
      expect(c.headers.authorization).toBeUndefined()
    }
    // no write verb or endpoint exists in the module's vocabulary
    expect([...YOUTUBE_ENDPOINTS]).toEqual(['channels', 'playlistItems', 'videos'])
    expect(YOUTUBE_ENDPOINTS.some((e) => /insert|update|delete|rate|comment|search|caption|upload/i.test(e))).toBe(false)
  })

  it('pages through the uploads 50 at a time and asks the videos in chunks of 50', async () => {
    const yt = youtube(120)
    const f = fakeFetch(yt.handler)
    const meter = memoryMeter()
    const out = await read(youtubeAdapter({ fetchImpl: f.fetch }), { maxVideos: 120 }, ctxFor(KEY, undefined, meter))
    const data = ChannelDataResult.parse(out.data)
    expect(data.videos.map((v) => v.id)).toEqual(yt.ids)
    const paths = f.calls.map((c) => new URL(c.url).pathname.replace('/youtube/v3/', ''))
    expect(paths).toEqual(['channels', 'playlistItems', 'playlistItems', 'playlistItems', 'videos', 'videos', 'videos'])
    const sizes = f.calls.filter((c) => c.url.includes('/playlistItems')).map((c) => new URL(c.url).searchParams.get('maxResults'))
    expect(sizes).toEqual(['50', '50', '20'])
    expect(f.calls.filter((c) => c.url.includes('/videos')).map((c) => (new URL(c.url).searchParams.get('id') ?? '').split(',').length)).toEqual([50, 50, 20])
    expect(data.quotaUnits).toBe(7)
    expect(meter.used()).toBe(7)
    expect(estimateUnits(120)).toBe(7)
  })

  it('stops at maxVideos, skips a private video, and reports hidden subscribers as null', async () => {
    const yt = youtube(40, { hidden: true, missing: ['vid00000002'] })
    const out = await read(youtubeAdapter({ fetchImpl: fakeFetch(yt.handler).fetch }), { maxVideos: 10 })
    const data = ChannelDataResult.parse(out.data)
    expect(data.subscribers).toBeNull()
    expect(data.videos).toHaveLength(9)
    expect(data.videos.map((v) => v.id)).not.toContain('vid00000002')
  })

  it('a video link is resolved to its channel first (one more unit)', async () => {
    const yt = youtube(5)
    const f = fakeFetch(yt.handler)
    const meter = memoryMeter()
    const out = await read(youtubeAdapter({ fetchImpl: f.fetch }), { url: 'https://www.youtube.com/watch?v=vid00000001', maxVideos: 5 }, ctxFor(KEY, undefined, meter))
    expect(ChannelDataResult.parse(out.data).channelId).toBe(UC)
    expect(new URL(f.calls[0]?.url ?? '').pathname).toBe('/youtube/v3/videos')
    expect(new URL(f.calls[1]?.url ?? '').searchParams.get('id')).toBe(UC)
    expect(meter.used()).toBe(4)
  })

  it('counts quota across jobs and refuses, before any call, a read that would pass the daily budget', async () => {
    const f = fakeFetch(youtube(30).handler)
    const a = youtubeAdapter({ fetchImpl: f.fetch, dailyQuota: 100 })
    const meter = memoryMeter()
    meter.add(98)
    await expect(read(a, {}, ctxFor(KEY, undefined, meter))).rejects.toThrow(/daily budget of 100 units would be passed \(98 used today, 3 needed\)/)
    expect(f.calls).toHaveLength(0)
    expect(meter.used()).toBe(98)
    // with room for it, the same read goes through and the counter moves
    const meter2 = memoryMeter()
    meter2.add(90)
    await read(a, {}, ctxFor(KEY, undefined, meter2))
    expect(meter2.used()).toBe(93)
  })

  it('never exceeds the free allowance, whatever the configured budget', async () => {
    const f = fakeFetch(youtube(5).handler)
    const a = youtubeAdapter({ fetchImpl: f.fetch, dailyQuota: 50_000 })
    const meter = memoryMeter()
    meter.add(9_999)
    await expect(read(a, { maxVideos: 5 }, ctxFor(KEY, undefined, meter))).rejects.toThrow(/daily budget of 10000 units/)
  })

  it('maps failures: 429 and 5xx retry; 403 and 404 are fatal without the key in the message; a quota refusal closes the day', async () => {
    const run = (status: number, body = '{}', meter = memoryMeter()) => read(youtubeAdapter({ fetchImpl: fakeFetch(() => new Response(body, { status })).fetch }), {}, ctxFor(KEY, undefined, meter))
    await expect(run(429)).rejects.toBeInstanceOf(RetryableProviderError)
    await expect(run(503)).rejects.toBeInstanceOf(RetryableProviderError)
    const keyBody = JSON.stringify({ error: { errors: [{ reason: 'keyInvalid' }], message: `bad key ${KEY}` } })
    const fatal = (await run(403, keyBody).catch((e: unknown) => e)) as Error
    expect(fatal).not.toBeInstanceOf(RetryableProviderError)
    expect(fatal.message).toMatch(/403/)
    expect(fatal.message).toContain('keyInvalid')
    expect(fatal.message).not.toContain(KEY)
    await expect(run(404)).rejects.toThrow(/404/)
    const meter = memoryMeter()
    const quota = JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } })
    await expect(run(403, quota, meter)).rejects.toThrow(/quotaExceeded/)
    // Google said the day is over: our counter follows, so no further call is made today
    expect(meter.used()).toBe(8000)
    await expect(read(youtubeAdapter({ fetchImpl: fakeFetch(youtube(3).handler).fetch }), {}, ctxFor(KEY, undefined, meter))).rejects.toThrow(/daily budget/)
  })

  it('a wrong answer shape retries, an unknown channel is fatal', async () => {
    await expect(read(youtubeAdapter({ fetchImpl: fakeFetch(() => json({ items: 'nope' })).fetch }), {})).rejects.toBeInstanceOf(RetryableProviderError)
    const none = (await read(youtubeAdapter({ fetchImpl: fakeFetch(() => json({ items: [] })).fetch }), {}).catch((e: unknown) => e)) as Error
    expect(none.message).toMatch(/no such channel/)
    expect(none).not.toBeInstanceOf(RetryableProviderError)
  })

  it('an aborted job stops between two calls', async () => {
    const ac = new AbortController()
    const yt = youtube(60)
    const f = fakeFetch((req) => {
      if (req.url.includes('/playlistItems')) ac.abort(new Error('cancelled'))
      return yt.handler(req)
    })
    await expect(read(youtubeAdapter({ fetchImpl: f.fetch }), { maxVideos: 60 }, ctxFor(KEY, ac.signal, memoryMeter()))).rejects.toThrow('cancelled')
  })
})

describe('the daily counter', () => {
  it('uses the Pacific day, where the YouTube quota resets', () => {
    expect(pacificDay(Date.UTC(2026, 9, 19, 9, 0, 0))).toBe('2026-10-19')
    expect(pacificDay(Date.UTC(2026, 9, 20, 6, 59, 0))).toBe('2026-10-19') // 23:59 in Los Angeles (UTC-7)
    expect(pacificDay(Date.UTC(2026, 9, 20, 7, 0, 0))).toBe('2026-10-20')
  })

  it('is kept in the database per provider and day, and starts again the next day', () => {
    const t = makeCloud()
    const clock = new ManualClock(Date.UTC(2026, 9, 19, 9, 0, 0))
    const ledger = new QuotaLedger(t.cloud.db, clock)
    ledger.add('youtube', 3)
    ledger.add('youtube', 4)
    ledger.add('other', 9)
    expect(ledger.meter('youtube').used()).toBe(7)
    expect(ledger.meter('other').used()).toBe(9)
    clock.set(Date.UTC(2026, 9, 20, 7, 0, 0))
    expect(ledger.meter('youtube').used()).toBe(0)
    ledger.meter('youtube').add(1)
    expect(ledger.used('youtube', '2026-10-19')).toBe(7)
    expect(ledger.used('youtube')).toBe(1)
    expect(() => ledger.add('youtube', -1)).toThrow()
    expect(() => ledger.add('youtube', 1.5)).toThrow()
  })
})

describe('configuration, guard and a job end to end', () => {
  it('config.json picks the provider and the budget; unknown values are refused', () => {
    const t = makeCloud()
    const cfgOf = (raw: unknown) => {
      const dir = t.dir
      writeConfig(dir, raw)
      return loadConfig(dir)
    }
    const cfg = cfgOf({ paidCalls: 'on', providers: { channelData: 'youtube' }, youtube: { dailyQuota: 5000 } })
    expect(cfg.providers.channelData).toBe('youtube')
    expect(cfg.youtube.dailyQuota).toBe(5000)
    const set = realProviders(cfg)
    expect(set.select.channelData).toBe('youtube')
    expect(set.adapters.map((a) => a.id)).toContain('youtube')
    expect(() => cfgOf({ providers: { channelData: 'nope' } })).toThrow()
    expect(() => cfgOf({ youtube: { dailyQuota: 20_000 } })).toThrow()
    expect(() => cfgOf({ youtube: { apiKey: 'x' } })).toThrow()
    expect(cfgOf({}).providers.channelData).toBe('fake')
    expect(cfgOf({}).youtube.dailyQuota).toBe(8000)
  })

  it('is real only with paidCalls on, a test-free process, the config picking it AND the key in the vault', () => {
    const t = makeCloud()
    const adapter = youtubeAdapter({ fetchImpl: fakeFetch(() => json({})).fetch })
    const reg = (o: { paidCalls?: boolean; select?: Record<string, string>; env?: NodeJS.ProcessEnv }) =>
      new ProviderRegistry({ paidCalls: o.paidCalls ?? true, vault: t.cloud.vault, real: [adapter], select: o.select ?? { channelData: 'youtube' }, env: o.env ?? PROD })
    expect(reg({}).resolve('channelData')).toMatchObject({ status: 'demo', reason: 'the platform key is not in the vault' })
    t.cloud.vault.set('YOUTUBE_API_KEY', KEY, 'test')
    expect(reg({}).resolve('channelData')).toMatchObject({ status: 'real', adapter: { id: 'youtube' }, reason: null })
    expect(reg({ paidCalls: false }).resolve('channelData')).toMatchObject({ status: 'demo', reason: 'paidCalls is off' })
    expect(reg({ select: { channelData: 'fake' } }).resolve('channelData').status).toBe('demo')
    expect(reg({ env: { VITEST: 'true' } }).resolve('channelData').status).toBe('demo')
    // a real adapter handed out earlier still cannot run in a test process
    expect(() => reg({ env: { VITEST: 'true' } }).assertCallable(adapter)).toThrow(/never calls a real adapter/)
  })

  it('runs as a real, quoted job: 1 credit, the numbers in the result, the quota persisted in the Cloud', async () => {
    const yt = youtube(30)
    const f = fakeFetch(yt.handler)
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [youtubeAdapter({ fetchImpl: f.fetch })], providers: { channelData: 'youtube' } })
    t.cloud.vault.set('YOUTUBE_API_KEY', KEY, 'test')
    const p = await signUpAndIn(t, { credits: 100 })
    const { quote, job } = await quoteAndRun(t, p, 'channelData', { url: HANDLE, maxVideos: 30 })
    expect(t.cloud.pricing.getQuote(quote.id)?.lines).toEqual([expect.objectContaining({ item: 'channel.request', quantity: 1 })])
    expect(job).toMatchObject({ state: 'succeeded', demo: false })
    const data = ChannelDataResult.parse(job.result)
    expect(data).toMatchObject({ title: 'Chaîne exemple', quotaUnits: 3 })
    expect(data.videos).toHaveLength(30)
    expect(f.calls).toHaveLength(3)
    expect(f.calls.every((c) => c.headers['x-goog-api-key'] === KEY)).toBe(true)
    // the counter lives in the database, not in the adapter
    expect(new QuotaLedger(t.cloud.db, t.clock).used('youtube')).toBe(3)
    // a second read the same day adds to it
    await quoteAndRun(t, p, 'channelData', { url: HANDLE, maxVideos: 30 })
    expect(new QuotaLedger(t.cloud.db, t.clock).used('youtube')).toBe(6)
  })

  it('a job past the daily budget fails without any call, and its credits go back', async () => {
    const f = fakeFetch(youtube(30).handler)
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [youtubeAdapter({ fetchImpl: f.fetch, dailyQuota: 100 })], providers: { channelData: 'youtube' } })
    t.cloud.vault.set('YOUTUBE_API_KEY', KEY, 'test')
    new QuotaLedger(t.cloud.db, t.clock).add('youtube', 99)
    const p = await signUpAndIn(t, { credits: 100 })
    const { job } = await quoteAndRun(t, p, 'channelData', { url: HANDLE, maxVideos: 30 })
    expect(job.state).toBe('failed')
    expect(String(job.error)).toMatch(/daily budget/)
    expect(f.calls).toHaveLength(0)
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ balance: 100, held: 0 })
  })

  it('with the default configuration the usage is the demo: no network, no quota', async () => {
    const f = fakeFetch(() => json({}))
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [youtubeAdapter({ fetchImpl: f.fetch })], providers: { channelData: 'fake' } })
    t.cloud.vault.set('YOUTUBE_API_KEY', KEY, 'test')
    const p = await signUpAndIn(t, { credits: 100 })
    const { job } = await quoteAndRun(t, p, 'channelData', { url: HANDLE, maxVideos: 12 })
    expect(job).toMatchObject({ state: 'succeeded', demo: true })
    expect(ChannelDataResult.parse(job.result).videos).toHaveLength(12)
    expect(f.calls).toHaveLength(0)
    expect(new QuotaLedger(t.cloud.db, t.clock).used('youtube')).toBe(0)
  })
})

