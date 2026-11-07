// Media sourcing bricks (src/engine/sourcing): the one search over providers, the ranker and its cache, the legal field, the keys
// and the paid gate, the read-only yt-dlp excerpts, and each provider on a hand-written answer. No network, no process: every
// `fetch` and every yt-dlp run is a fake. Provider answers are written from each API's documentation (the keyless ones were also
// checked live on 2026-11-02 by scripts/media-proof.ts); NARA's shape is NOT verified with a live key (see providers/nara.ts).
import { trackTemp } from '../setup/track-temp'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FREE_KEYS, KEYED, KEYLESS, PAID, PROVIDERS } from '../../src/engine/sourcing/catalog'
import { FileCache, MemoryCache, cacheKey } from '../../src/engine/sourcing/cache'
import { failingProvider, fairUseVideo, fakePaid, fakeProvider, fakeRun, jsonResponse, routedFetch, PD } from '../../src/engine/sourcing/fakes'
import { creditsText, FAIR_USE_LICENCE, publishBlockers } from '../../src/engine/sourcing/legal'
import { europeanaImages } from '../../src/engine/sourcing/providers/europeana'
import { freesound, jamendo } from '../../src/engine/sourcing/providers/audio-keyed'
import { clevelandImages, dvidsImages, dvidsVideo } from '../../src/engine/sourcing/providers/cleveland-dvids'
import { commonsVideo } from '../../src/engine/sourcing/providers/commons-media'
import { internetArchiveVideo } from '../../src/engine/sourcing/providers/internet-archive-media'
import { localBank } from '../../src/engine/sourcing/providers/local-bank'
import { naraImages } from '../../src/engine/sourcing/providers/nara'
import { nasaVideo } from '../../src/engine/sourcing/providers/nasa-media'
import { pixabayVideos } from '../../src/engine/sourcing/providers/stock'
import { smithsonianImages } from '../../src/engine/sourcing/providers/smithsonian'
import { clampRange, downloadExcerpt, excerptArgs, licenceOfVideo, probeArgs, searchArgs, youtubeExcerpts } from '../../src/engine/sourcing/providers/ytdlp'
import { claudeExpander, claudeReranker, heuristicRank } from '../../src/engine/sourcing/rank'
import { searchMedia } from '../../src/engine/sourcing/search'
import type { ProviderCtx, SourceQuery } from '../../src/engine/sourcing/types'

const tmp: string[] = []
afterEach(() => {
  while (tmp.length) rmSync(tmp.pop()!, { recursive: true, force: true })
})

const ctxOf = (fetch: typeof globalThis.fetch, extra: Partial<ProviderCtx> = {}): ProviderCtx => ({ fetch, timeoutMs: 5000, ...extra })
const q = (kind: SourceQuery['kind'], query = 'crowd', want = 6): SourceQuery => ({ query, kind, want })

describe('searchMedia: the one interface', () => {
  const crash = fakeProvider('a', 'image', [
    { id: '1', title: 'Wall Street crash 1929 crowd', width: 2000, height: 1300 },
    { id: '2', title: 'Unrelated garden gnome', width: 3000, height: 2000 },
    { id: '3', title: 'Crash of 1929, stock exchange', width: 1800, height: 1200, licence: { short: 'CC BY 4.0', status: 'cc-by', attributionRequired: true } }
  ])

  it('returns ranked candidates with licence, preview and cost 0, and drops the noise', async () => {
    const r = await searchMedia('Wall Street crash 1929', { kinds: ['image'] }, { providers: [crash] })
    expect(r.candidates.map((c) => c.id)).toEqual(['1', '3'])
    expect(r.candidates[0]).toMatchObject({ provider: 'a', kind: 'image', costUsd: 0, previewUrl: 'https://fake.test/1.jpg', review: 'clear' })
    expect(r.candidates[0]!.licence.status).toBe('public-domain')
    expect(r.costUsd).toBe(0)
    expect(r.timingsMs).toHaveProperty('a')
  })

  it('keeps one slice per asked kind and ignores providers of other kinds', async () => {
    const sfx = fakeProvider('s', 'sfx', [{ id: 'x', title: 'crowd cheering loop', durationS: 4 }])
    const before = crash.calls
    const r = await searchMedia('crowd cheering', { kinds: ['sfx'] }, { providers: [crash, sfx] })
    expect(r.candidates.map((c) => c.provider)).toEqual(['s'])
    expect(crash.calls).toBe(before)
  })

  it('removes forbidden candidates and counts them', async () => {
    const p = fakeProvider('f', 'image', [
      { id: '1', title: 'crowd photo', licence: { short: 'All rights reserved', status: 'forbidden', attributionRequired: true } },
      { id: '2', title: 'crowd photo 2' }
    ])
    const r = await searchMedia('crowd photo', {}, { providers: [p] })
    expect(r.candidates.map((c) => c.id)).toEqual(['2'])
    expect(r.droppedForbidden).toBe(1)
  })

  it('reports a failing provider and still answers with the others', async () => {
    const r = await searchMedia('Wall Street crash 1929', {}, { providers: [failingProvider('bad', 'image', 'HTTP 404 nope'), crash] })
    expect(r.errors).toEqual([{ provider: 'bad', message: 'HTTP 404 nope' }])
    expect(r.candidates.length).toBe(2)
  })

  it('keeps review-needed candidates flagged, or drops them on request', async () => {
    const yt = fakeProvider('yt', 'video', [fairUseVideo('v1', 'crowd cheering stadium'), { id: 'v2', title: 'crowd cheering archive', durationS: 20 }])
    const both = await searchMedia('crowd cheering', { kinds: ['video'] }, { providers: [yt] })
    expect(both.candidates.map((c) => c.review).sort()).toEqual(['clear', 'human-review'])
    const clear = await searchMedia('crowd cheering', { kinds: ['video'], excludeReview: true }, { providers: [yt] })
    expect(clear.candidates.map((c) => c.id)).toEqual(['v2'])
    expect(publishBlockers(both.candidates).map((c) => c.id)).toEqual(['v1'])
  })

  it('caches a provider answer: the second search does not call the provider', async () => {
    const cache = new MemoryCache()
    const before = crash.calls
    await searchMedia('Wall Street crash 1929', { cache }, { providers: [crash] })
    const again = await searchMedia('Wall Street crash 1929', { cache }, { providers: [crash] })
    expect(crash.calls - before).toBe(1)
    expect(again.candidates.length).toBe(2)
    expect(again.timingsMs.a).toBe(0)
  })

  it('a cache entry expires', async () => {
    let now = 0
    const cache = new MemoryCache(1000, () => now)
    const p = fakeProvider('t', 'image', [{ id: '1', title: 'crowd photo' }])
    await searchMedia('crowd photo', { cache }, { providers: [p] })
    now = 2000
    await searchMedia('crowd photo', { cache }, { providers: [p] })
    expect(p.calls).toBe(2)
  })

  it('variants find what the literal query cannot (the archive’s own words)', async () => {
    const p = fakeProvider('w', 'image', [{ id: '1', title: 'Grenzbesetzung 1939-1940 Denkmal' }])
    expect((await searchMedia('Swiss border 1940', {}, { providers: [p] })).candidates).toEqual([])
    const r = await searchMedia('Swiss border 1940', { variants: ['Grenzbesetzung 1939'] }, { providers: [p] })
    expect(r.candidates.map((c) => c.id)).toEqual(['1'])
  })

  it('an expander proposes the variants; a broken one is reported, not fatal', async () => {
    const p = fakeProvider('w', 'image', [{ id: '1', title: 'Grenzbesetzung 1939-1940 Denkmal' }])
    const expand = claudeExpander({ ask: async () => ({ text: '{"queries":["Grenzbesetzung 1939","Aktivdienst"]}' }) })
    expect((await searchMedia('Swiss border 1940', { expand }, { providers: [p] })).candidates.length).toBe(1)
    const broken = await searchMedia('Swiss border 1940', { expand: () => Promise.reject(new Error('offline')) }, { providers: [p] })
    expect(broken.errors).toEqual([{ provider: 'expander', message: 'offline' }])
  })

  it('retries once on a busy backend', async () => {
    let n = 0
    const p = { ...fakeProvider('busy', 'image', [{ id: '1', title: 'crowd photo' }]), search: async () => { if (n++ === 0) throw new Error('Wikimedia refused the search (cirrussearch-too-busy-error)'); return fakeProvider('x', 'image', [{ id: '1', title: 'crowd photo' }]).search(q('image'), ctxOf(fetch)) } }
    const r = await searchMedia('crowd photo', {}, { providers: [p] })
    expect(n).toBe(2)
    expect(r.errors).toEqual([])
    expect(r.candidates.length).toBe(1)
  })
})

describe('keys and the paid gate', () => {
  const keyed = fakeProvider('k', 'sfx', [{ id: '1', title: 'crowd cheering' }], { secret: 'FREESOUND_API_KEY', demoKey: 'DEMO' })

  it('skips a provider whose key is not in the vault, and says which secret is missing', async () => {
    const r = await searchMedia('crowd cheering', { kinds: ['sfx'] }, { providers: [keyed] })
    expect(r.skipped).toEqual([{ provider: 'k', reason: 'no-key', detail: 'FREESOUND_API_KEY' }])
    expect(keyed.calls).toBe(0)
  })

  it('uses the vault value, and the public demo key only when allowed', async () => {
    const seen: Array<string | undefined> = []
    const spy = { ...keyed, search: async (_q: SourceQuery, c: ProviderCtx) => (seen.push(c.key), []) }
    await searchMedia('crowd cheering', { kinds: ['sfx'] }, { providers: [spy], secrets: (n) => (n === 'FREESOUND_API_KEY' ? 'REAL' : undefined) })
    await searchMedia('crowd cheering', { kinds: ['sfx'], allowDemoKeys: true }, { providers: [spy] })
    await searchMedia('crowd cheering', { kinds: ['sfx'] }, { providers: [spy] })
    expect(seen).toEqual(['REAL', 'DEMO'])
  })

  it('never calls a paid provider unless allowed, then reports its cost', async () => {
    const paid = fakePaid('el-music', 'music', 0.15)
    const refused = await searchMedia('calm piano track', { kinds: ['music'] }, { providers: [paid] })
    expect(paid.calls).toBe(0)
    expect(refused.skipped).toEqual([{ provider: 'el-music', reason: 'paid', detail: 'about 0.15 $ per use' }])
    const allowed = await searchMedia('generated track', { kinds: ['music'], allowPaid: true }, { providers: [paid] })
    expect(paid.calls).toBe(1)
    expect(allowed.costUsd).toBeCloseTo(0.15)
  })

  it('the real paid slots refuse until their adapter exists', async () => {
    const r = await searchMedia('crowd', { kinds: ['sfx', 'music'], allowPaid: true, providers: ['elevenlabs-sfx', 'elevenlabs-music'] })
    expect(r.errors.map((e) => e.provider).sort()).toEqual(['elevenlabs-music', 'elevenlabs-sfx'])
    expect(r.candidates).toEqual([])
  })

  it('a web-excerpt provider only runs when it is named', async () => {
    const { run, calls } = fakeRun(() => '')
    await searchMedia('wall street', { kinds: ['video'], providers: undefined }, { providers: [youtubeExcerpts], run })
    expect(calls.length).toBe(0)
    await searchMedia('wall street', { kinds: ['video'], providers: ['youtube-excerpt'] }, { providers: [youtubeExcerpts], run })
    expect(calls.length).toBe(1)
  })

  it('the catalog: free ones first, paid ones last, every key listed with its site', () => {
    expect(PROVIDERS.slice(0, KEYLESS.length)).toEqual([...KEYLESS])
    expect(PAID.every((p) => p.paid)).toBe(true)
    expect(KEYLESS.every((p) => !p.secret && !p.paid)).toBe(true)
    const wanted = new Set(KEYED.map((p) => p.secret))
    for (const s of wanted) expect(FREE_KEYS.map((k) => k.secret)).toContain(s)
    for (const k of FREE_KEYS) expect(k.secret).toMatch(/^[A-Z][A-Z0-9_]{1,63}$/)
  })
})

describe('the ranker', () => {
  it('prefers public domain and CC0 over CC BY-SA and fair use at equal relevance', () => {
    const mk = (id: string, licence: Parameters<typeof fakeProvider>[2][number]['licence']) => ({ id, title: 'crowd cheering', licence })
    const p = fakeProvider('p', 'image', [
      mk('fair', FAIR_USE_LICENCE),
      mk('sa', { short: 'CC BY-SA 4.0', status: 'cc-by-sa', attributionRequired: true }),
      mk('pd', PD)
    ])
    return p.search(q('image'), ctxOf(fetch)).then((cs) => {
      const ranked = heuristicRank(cs.map((c) => ({ ...c, score: 10 })), 'crowd cheering')
      expect(ranked.map((c) => c.id)).toEqual(['pd', 'sa', 'fair'])
    })
  })

  it('the same file from two providers is listed once', async () => {
    const a = fakeProvider('a', 'image', [{ id: '1', title: 'Crowds gathering outside New York Stock Exchange' }])
    const b = fakeProvider('b', 'image', [{ id: '9', title: 'Crowds gathering outside New York Stock Exchange' }])
    const r = await searchMedia('crowds New York Stock Exchange', {}, { providers: [a, b] })
    expect(r.candidates.length).toBe(1)
  })

  it('a Claude reranker reorders by the model’s scores; unreadable answers keep the heuristic order', async () => {
    const p = fakeProvider('p', 'image', [
      { id: 'first', title: 'crowd cheering stadium' },
      { id: 'second', title: 'crowd cheering in 1950s street' },
      { id: 'third', title: 'crowd cheering festival' }
    ])
    let prompt = ''
    // the heuristic puts « 1950s street » first (it matches every word); the model, by the numbers printed in the prompt, prefers « festival »
    const rerank = claudeReranker({ ask: async (req) => ((prompt = req.prompt), { text: '```json\n{"scores":[{"i":0,"s":3},{"i":1,"s":2},{"i":2,"s":10}]}\n```' }) })
    expect((await searchMedia('crowd cheering 1950s', {}, { providers: [p] })).candidates[0]!.id).toBe('second')
    const r = await searchMedia('crowd cheering 1950s', { rerank }, { providers: [p] })
    expect(r.candidates[0]!.id).toBe('third')
    expect(prompt).toContain('crowd cheering 1950s')
    const junk = claudeReranker({ ask: async () => ({ text: 'not json' }) })
    const same = await searchMedia('crowd cheering', { rerank: junk }, { providers: [p] })
    expect(same.candidates.length).toBe(3)
    const down = await searchMedia('crowd cheering', { rerank: () => Promise.reject(new Error('quota')) }, { providers: [p] })
    expect(down.errors).toEqual([{ provider: 'reranker', message: 'quota' }])
    expect(down.candidates.length).toBe(3)
  })

  it('the credits block lists what asks for attribution, once each', async () => {
    const p = fakeProvider('p', 'image', [
      { id: '1', title: 'crowd photo', licence: { short: 'CC BY 4.0', status: 'cc-by', attributionRequired: true } },
      { id: '2', title: 'crowd photo two' }
    ])
    const r = await searchMedia('crowd photo', {}, { providers: [p] })
    expect(creditsText(r.candidates)).toBe('crowd photo, CC BY 4.0, via Fake p')
    expect(creditsText(r.candidates, true).split('\n').length).toBe(2)
  })
})

describe('yt-dlp excerpts: read-only, a licence field, human review by default', () => {
  const lines = [
    { id: 'abc123', title: 'Wall Street crash 1929 newsreel', duration: 200, channel: 'Old Films', thumbnails: [{ url: 'https://i.ytimg.com/vi/abc123/small.jpg' }, { url: 'https://i.ytimg.com/vi/abc123/big.jpg' }] },
    { id: 'def456', title: 'Crash of 1929 explained', duration: 30, uploader: 'Someone' }
  ]

  it('searches without downloading: fair-use excerpt, human review, a default window', async () => {
    const { run, calls } = fakeRun(() => lines.map((l) => JSON.stringify(l)).join('\n'))
    const r = await searchMedia('Wall Street crash 1929', { kinds: ['video'], providers: ['youtube-excerpt'] }, { providers: [youtubeExcerpts], run })
    expect(calls[0]).toContain('--flat-playlist')
    expect(calls[0]!.join(' ')).not.toContain('--download')
    const c = r.candidates[0]!
    expect(c).toMatchObject({ provider: 'youtube-excerpt', review: 'human-review', costUsd: 0, previewUrl: 'https://i.ytimg.com/vi/abc123/big.jpg' })
    expect(c.licence.status).toBe('fair-use-excerpt')
    expect(c.excerpt).toEqual({ startS: 0, endS: 45 })
    expect(r.candidates[1]!.excerpt).toEqual({ startS: 0, endS: 30 }) // a 30 s video is cut to its length
  })

  it('no argument list logs in, uses cookies, uploads, comments or touches a write endpoint', () => {
    const all = [searchArgs('x', 5), probeArgs('https://www.youtube.com/watch?v=abc'), excerptArgs('https://www.youtube.com/watch?v=abc', { startS: 70, endS: 85 }, 'out')].flat()
    for (const a of all) expect(a).not.toMatch(/^--(cookies|username|password|netrc|video-password|ap-|add-header|exec|upload|post)/i)
    expect(all).toContain('--ignore-config')
    expect(all).toContain('--no-cookies-from-browser')
    const section = all[all.indexOf('--download-sections') + 1]
    expect(section).toBe('*0:01:10-0:01:25')
  })

  it('caps and clamps the range', () => {
    expect(clampRange({ startS: 10, endS: 500 })).toEqual({ startS: 10, endS: 130 })
    expect(clampRange({ startS: 50, endS: 40 })).toEqual({ startS: 50, endS: 51 })
    expect(clampRange({ startS: 0, endS: 45 }, 20)).toEqual({ startS: 0, endS: 20 })
    expect(clampRange({ startS: 500, endS: 520 }, 100)).toEqual({ startS: 99, endS: 100 })
  })

  it('reads the uploader’s Creative Commons licence, nothing else clears a video', () => {
    expect(licenceOfVideo('Creative Commons Attribution license (reuse allowed)')).toMatchObject({ review: false, licence: { status: 'cc-by', attributionRequired: true } })
    expect(licenceOfVideo(null)).toMatchObject({ review: true, licence: { status: 'fair-use-excerpt' } })
    expect(licenceOfVideo('Standard YouTube License').review).toBe(true)
  })

  it('downloads only the range and returns the printed file; refuses a non-http link', async () => {
    const { run, calls } = fakeRun(() => 'C:\\out\\abc123_70.mp4\n')
    const r = await downloadExcerpt('https://www.youtube.com/watch?v=abc123', { startS: 70, endS: 85 }, trackTemp(path.join(os.tmpdir(), 'atelier-excerpt-test')), { run })
    expect(r.file).toBe('C:\\out\\abc123_70.mp4')
    expect(calls[0]).toContain('--download-sections')
    await expect(downloadExcerpt('file:///etc/passwd', { startS: 0, endS: 5 }, 'x', { run })).rejects.toThrow('only http(s)')
  })
})

describe('providers on recorded-shape answers', () => {
  it('Europeana: open rights only, needs a key, flags a non-direct file for review', async () => {
    const { fetch, calls } = routedFetch([
      [
        'api.europeana.eu',
        () =>
          jsonResponse({
            success: true,
            items: [
              { id: '/1/a', guid: 'https://www.europeana.eu/item/1/a?utm=x', title: ['Grenzbesetzung, Soldaten am Rhein'], dcCreator: ['Anon'], year: ['1940'], rights: ['http://creativecommons.org/publicdomain/mark/1.0/'], edmIsShownBy: ['https://img.example/a.jpg'], edmPreview: ['https://img.example/a-thumb.jpg'] },
              { id: '/1/b', title: ['Closed'], rights: ['http://rightsstatements.org/vocab/InC/1.0/'], edmIsShownBy: ['https://img.example/b.jpg'] },
              { id: '/1/c', title: ['Film'], rights: ['https://creativecommons.org/licenses/by/4.0/'], edmIsShownBy: ['https://player.example/watch/c'] }
            ]
          })
      ]
    ])
    const r = await europeanaImages.search(q('image', 'Grenzbesetzung'), ctxOf(fetch, { key: 'KEY' }))
    expect(calls[0]!.url).toContain('wskey=KEY')
    expect(calls[0]!.url).toContain('reusability=open')
    expect(r.map((c) => c.id)).toEqual(['/1/a', '/1/c'])
    expect(r[0]).toMatchObject({ licence: { status: 'public-domain' }, review: 'clear', pageUrl: 'https://www.europeana.eu/item/1/a', previewUrl: 'https://img.example/a-thumb.jpg' })
    expect(r[1]).toMatchObject({ licence: { status: 'cc-by' }, review: 'clear' }) // images are direct files
  })

  it('Smithsonian: CC0 media only', async () => {
    const row = (id: string, access: string) => ({ id, title: `Item ${id}`, content: { descriptiveNonRepeating: { record_link: `https://si.edu/${id}`, online_media: { media: [{ type: 'Images', content: `https://ids.si.edu/${id}`, thumbnail: `https://ids.si.edu/${id}-t`, usage: { access } }] } }, freetext: { date: [{ content: '1930' }] } } })
    const { fetch } = routedFetch([['api.si.edu', () => jsonResponse({ response: { rows: [row('a', 'CC0'), row('b', 'Usage conditions apply')] } })]])
    const r = await smithsonianImages.search(q('image', 'item'), ctxOf(fetch, { key: 'DEMO_KEY' }))
    expect(r.map((c) => c.id)).toEqual(['a'])
    expect(r[0]!.licence.status).toBe('cc0')
  })

  it('Pixabay video: picks the biggest listed file, no attribution needed, licence named', async () => {
    const { fetch, calls } = routedFetch([['pixabay.com/api/videos', () => jsonResponse({ hits: [{ id: 7, tags: 'crowd, people, stadium', user: 'bob', pageURL: 'https://pixabay.com/videos/7', picture_id: '123', duration: 12, videos: { large: { url: 'https://cdn/p7-l.mp4', width: 1920, height: 1080 }, small: { url: 'https://cdn/p7-s.mp4', width: 640, height: 360 } } }] })]])
    const r = await pixabayVideos.search(q('video'), ctxOf(fetch, { key: 'K' }))
    expect(calls[0]!.url).toContain('key=K')
    expect(r[0]).toMatchObject({ id: 'pixabay-video-7', fileUrl: 'https://cdn/p7-l.mp4', durationS: 12, licence: { short: 'Pixabay Content License', status: 'free-licence', attributionRequired: false } })
  })

  it('Freesound: CC0 / CC BY only, the token is sent, previews are the files', async () => {
    const res = (id: number, license: string) => ({ id, name: `cheer ${id}`, description: 'a crowd', tags: ['crowd'], username: 'u', license, duration: 6, url: `https://freesound.org/s/${id}/`, previews: { 'preview-hq-mp3': `https://cdn.freesound.org/${id}.mp3` } })
    const { fetch, calls } = routedFetch([['freesound.org/apiv2/search/text', () => jsonResponse({ results: [res(1, 'http://creativecommons.org/publicdomain/zero/1.0/'), res(2, 'http://creativecommons.org/licenses/by-nc/3.0/'), res(3, 'https://creativecommons.org/licenses/by/4.0/')] })]])
    const r = await freesound.search(q('sfx', 'cheer'), ctxOf(fetch, { key: 'TOK' }))
    expect(decodeURIComponent(calls[0]!.url.replace(/\+/g, ' '))).toContain('license:("Creative Commons 0" OR "Attribution")')
    expect(calls[0]!.url).toContain('token=TOK')
    expect(r.map((c) => c.id)).toEqual(['1', '3'])
    expect(r[1]!.licence).toMatchObject({ status: 'cc-by', attributionRequired: true })
  })

  it('Jamendo: NC tracks dropped, every track left for human review', async () => {
    const t = (id: string, cc: string) => ({ id, name: `Track ${id}`, artist_name: 'A', license_ccurl: cc, audio: `https://mp3/${id}.mp3`, audiodownload: `https://mp3/${id}-dl.mp3`, duration: 120, shareurl: `https://jamendo.com/track/${id}` })
    const { fetch } = routedFetch([['api.jamendo.com', () => jsonResponse({ headers: { status: 'success' }, results: [t('1', 'http://creativecommons.org/licenses/by/3.0/'), t('2', 'http://creativecommons.org/licenses/by-nc-nd/3.0/')] })]])
    const r = await jamendo.search(q('music', 'track'), ctxOf(fetch, { key: 'CID' }))
    expect(r.map((c) => c.id)).toEqual(['1'])
    expect(r[0]!.review).toBe('human-review')
    const refused = routedFetch([['api.jamendo.com', () => jsonResponse({ headers: { status: 'failed', error_message: 'bad id' }, results: [] })]])
    await expect(jamendo.search(q('music'), ctxOf(refused.fetch, { key: 'x' }))).rejects.toThrow('Jamendo refused')
  })

  it('NARA: sends the x-api-key header; every record is left for review until verified live', async () => {
    const { fetch, calls } = routedFetch([
      [
        'catalog.archives.gov/api/v2',
        () => jsonResponse({ body: { hits: { hits: [{ _id: '5', _source: { record: { naId: 5, title: 'Border patrol, 1940', scopeAndContentNote: 'Soldiers at a border post.', digitalObjects: [{ objectType: 'Image (JPG)', objectUrl: 'https://s3.amazonaws.com/NARAprodstorage/5.jpg', thumbnailUrl: 'https://s3.amazonaws.com/NARAprodstorage/5-t.jpg' }] } } }] } } })
      ]
    ])
    const r = await naraImages.search(q('image', 'border'), ctxOf(fetch, { key: 'NARAKEY' }))
    expect(calls[0]!.headers['x-api-key']).toBe('NARAKEY')
    expect(r[0]).toMatchObject({ id: '5', review: 'human-review', licence: { status: 'public-domain' } })
  })

  it('Commons video: licence read from the file page, poster as preview, duration window applied', async () => {
    const page = (i: number, title: string, lic: string, duration: number) => ({ title: `File:${title}.webm`, index: i, imageinfo: [{ url: `https://upload.wikimedia.org/wikipedia/commons/${i}/${title}.webm?utm=x`, thumburl: `https://upload.wikimedia.org/thumb/${i}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}.webm`, mime: 'video/webm', size: 5_000_000, width: 960, height: 720, duration, extmetadata: { LicenseShortName: { value: lic }, ObjectName: { value: title.replace(/_/g, ' ') } } }] })
    const { fetch, calls } = routedFetch([['commons.wikimedia.org', () => jsonResponse({ query: { pages: [page(1, 'Paris_1960', 'CC BY-SA 4.0', 90), page(2, 'Paris_NC', 'CC BY-NC 4.0', 90), page(3, 'Paris_long', 'Public domain', 5000)] } })]])
    const r = await commonsVideo.search({ ...q('video', 'Paris 1960'), maxDurationS: 600 }, ctxOf(fetch))
    expect(decodeURIComponent(calls[0]!.url.replace(/\+/g, ' '))).toContain('filetype:video')
    expect(r.map((c) => c.id)).toEqual(['Paris_1960.webm'])
    expect(r[0]).toMatchObject({ licence: { status: 'cc-by-sa' }, previewUrl: 'https://upload.wikimedia.org/thumb/1.jpg', durationS: 90, fileUrl: 'https://upload.wikimedia.org/wikipedia/commons/1/Paris_1960.webm' })
  })

  it('Internet Archive film: playable derivative, YouTube mirrors skipped, Prelinger left for review', async () => {
    const doc = (identifier: string, extra: Record<string, unknown> = {}) => ({ identifier, title: `Film ${identifier}`, date: '1962-01-01', ...extra })
    const meta = (name: string) => ({ files: [{ name: `${name}.mpg`, format: 'MPEG2', size: '9000000' }, { name: `${name}.mp4`, format: 'h.264', size: '5000000', length: '312.4', width: '640', height: '480' }] })
    const { fetch } = routedFetch([
      ['advancedsearch.php', () => jsonResponse({ response: { docs: [doc('cc-film', { licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/' }), doc('youtube-xyz', { licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/' }), doc('prelinger-one', { collection: ['prelinger', 'ephemera'] }), doc('nolicence')] } })],
      ['/metadata/cc-film', () => jsonResponse(meta('cc-film'))],
      ['/metadata/prelinger-one', () => jsonResponse(meta('prelinger-one'))]
    ])
    const r = await internetArchiveVideo.search(q('video', 'film'), ctxOf(fetch))
    expect(r.map((c) => [c.id, c.review])).toEqual([['cc-film', 'clear'], ['prelinger-one', 'human-review']])
    expect(r[0]).toMatchObject({ fileUrl: 'https://archive.org/download/cc-film/cc-film.mp4', durationS: 312.4, previewUrl: 'https://archive.org/services/img/cc-film', licence: { status: 'cc0' } })
  })

  it('NASA video: the medium rendition, a third-party item skipped', async () => {
    const item = (id: string, desc: string) => ({ href: `https://images-assets.nasa.gov/video/${id}/collection.json`, data: [{ nasa_id: id, title: `Launch ${id}`, description: desc, media_type: 'video', date_created: '2011-02-24T00:00:00Z', keywords: ['launch'] }], links: [] })
    const { fetch } = routedFetch([
      ['images-api.nasa.gov/search', () => jsonResponse({ collection: { items: [item('a', 'Launch of a shuttle'), item('b', 'Video © Someone Else, all rights reserved')] } })],
      ['video/a/collection.json', () => jsonResponse(['http://images-assets.nasa.gov/video/a/a~orig.mp4', 'http://images-assets.nasa.gov/video/a/a~medium.mp4', 'http://images-assets.nasa.gov/video/a/a~thumb.jpg'])]
    ])
    const r = await nasaVideo.search(q('video', 'launch'), ctxOf(fetch))
    expect(r.map((c) => c.id)).toEqual(['a'])
    expect(r[0]).toMatchObject({ fileUrl: 'https://images-assets.nasa.gov/video/a/a~medium.mp4', previewUrl: 'https://images-assets.nasa.gov/video/a/a~thumb.jpg', licence: { status: 'public-domain' } })
  })

  it('the local CC0 bank: matches tags, honours the duration window, no bank = no answer', async () => {
    const dir = trackTemp(mkdtempSync(path.join(os.tmpdir(), 'atelier-bank-')))
    tmp.push(dir)
    expect(await localBank(dir).search(q('sfx', 'whoosh'), ctxOf(fetch))).toEqual([])
    writeFileSync(path.join(dir, 'bank.json'), JSON.stringify({ items: [{ file: 'w1.wav', title: 'Whoosh soft', tags: ['whoosh', 'transition'], kind: 'sfx', durationS: 0.9, licence: 'CC0', creator: 'Atelier synth' }, { file: 'h1.wav', title: 'Hit low', tags: ['hit'], kind: 'sfx', durationS: 8, licence: 'CC0' }, { file: 'x.wav', title: 'Whoosh other licence', tags: ['whoosh'], kind: 'sfx', durationS: 1, licence: 'All rights reserved' }] }))
    const r = await localBank(dir).search(q('sfx', 'whoosh transition'), ctxOf(fetch))
    expect(r.map((c) => c.id)).toEqual(['w1.wav'])
    expect(r[0]).toMatchObject({ costUsd: 0, licence: { status: 'cc0' }, mime: 'audio/wav', durationS: 0.9 })
    expect(r[0]!.fileUrl.startsWith('file:///')).toBe(true)
    const short = await localBank(dir).search({ ...q('sfx', 'hit'), maxDurationS: 3 }, ctxOf(fetch))
    expect(short).toEqual([])
  })
})

describe('the file cache', () => {
  it('survives a new instance, expires, and treats a damaged file as a miss', async () => {
    const dir = trackTemp(mkdtempSync(path.join(os.tmpdir(), 'atelier-cache-')))
    tmp.push(dir)
    let now = 1000
    const [c] = await fakeProvider('p', 'image', [{ id: '1', title: 'crowd photo' }]).search(q('image'), ctxOf(fetch))
    const key = cacheKey({ a: 1 })
    await new FileCache(dir, 5000, () => now).set(key, [c!])
    expect((await new FileCache(dir, 5000, () => now).get(key))?.[0]?.id).toBe('1')
    now = 9000
    expect(await new FileCache(dir, 5000, () => now).get(key)).toBeUndefined()
    writeFileSync(path.join(dir, `${key}.json`), '{ not json')
    expect(await new FileCache(dir, 5000, () => 1000).get(key)).toBeUndefined()
  })
})

describe('Cleveland and DVIDS', () => {
  it('Cleveland: CC0 only, the 3400 px print when it fits, the web size otherwise, no key', async () => {
    const art = (id: number, license: string, print?: { url: string; width: string; height: string }) => ({ id, title: `Work ${id}`, creation_date: 'c. 1900', creators: [{ description: 'An Artist (French)' }], type: 'Painting', culture: ['France'], url: `https://clevelandart.org/art/${id}`, share_license_status: license, images: { web: { url: `https://cdn/${id}_web.jpg`, width: '900', height: '600' }, ...(print ? { print } : {}) } })
    const { fetch, calls } = routedFetch([['openaccess-api.clevelandart.org', () => jsonResponse({ data: [art(1, 'CC0', { url: 'https://cdn/1_print.jpg', width: '3400', height: '2100' }), art(2, 'Copyrighted'), art(3, 'CC0'), art(4, 'CC0', { url: 'https://cdn/4_print.jpg', width: '9000', height: '6000' })] })]])
    const r = await clevelandImages.search(q('image', 'harbor'), ctxOf(fetch))
    expect(calls[0]!.url).toContain('cc0=1')
    expect(r.map((c) => [c.id, c.fileUrl])).toEqual([['1', 'https://cdn/1_print.jpg'], ['3', 'https://cdn/3_web.jpg'], ['4', 'https://cdn/4_web.jpg']])
    expect(r[0]).toMatchObject({ licence: { status: 'cc0' }, previewUrl: 'https://cdn/1_web.jpg', creator: 'An Artist (French)', width: 3400 })
  })

  it('DVIDS: search then asset, the key in the query, the biggest sensible MP4, public domain but left for review', async () => {
    const { fetch, calls } = routedFetch([
      ['dvidshub.net/search', () => jsonResponse({ results: [{ id: 'video:1', title: 'Convoy 1944 reenactment', short_description: 'x', date: '2019-05-01T00:00:00', thumbnail: 'https://d/t1.jpg', url: 'https://dvidshub.net/video/1', unit_name: '1st Unit', credit: [{ name: 'Sgt. Jane Doe' }], duration: 95, keywords: 'convoy, army' }, { id: 'video:2', title: 'No file' }] })],
      ['asset?id=video%3A1', () => jsonResponse({ files: [{ src: 'https://d/v1-360.mp4', type: 'video/mp4', width: 640, height: 360, size: 1000 }, { src: 'https://d/v1-720.mp4', type: 'video/mp4', width: 1280, height: 720, size: 9000 }, { src: 'https://d/v1-1080.mp4', type: 'video/mp4', width: 1920, height: 1080, size: 99_999_999_999 }] })],
      ['asset?id=video%3A2', () => jsonResponse({ files: [] })]
    ])
    const r = await dvidsVideo.search(q('video', 'convoy'), ctxOf(fetch, { key: 'DVKEY' }))
    expect(calls[0]!.url).toContain('api_key=DVKEY')
    expect(decodeURIComponent(calls[0]!.url)).toContain('type[]=video')
    expect(r.map((c) => c.id)).toEqual(['video:1'])
    expect(r[0]).toMatchObject({ fileUrl: 'https://d/v1-720.mp4', durationS: 95, creator: 'Sgt. Jane Doe', review: 'human-review', licence: { status: 'public-domain' } })
  })

  it('DVIDS images: the full-resolution link of the asset; a plain-string credit works too', async () => {
    const { fetch } = routedFetch([
      ['dvidshub.net/search', () => jsonResponse({ results: [{ id: 'image:9', title: 'Parade', thumbnail: { url: 'https://d/t9.jpg' }, url: 'https://dvidshub.net/image/9', credit: 'Courtesy', width: 4000, height: 3000 }] })],
      ['asset?id=image%3A9', () => jsonResponse({ image: 'https://d/9-full.jpg', dimensions: { width: 4000, height: 3000 } })]
    ])
    const r = await dvidsImages.search(q('image', 'parade'), ctxOf(fetch, { key: 'K' }))
    expect(r[0]).toMatchObject({ fileUrl: 'https://d/9-full.jpg', previewUrl: 'https://d/t9.jpg', creator: 'Courtesy', width: 4000 })
  })
})
