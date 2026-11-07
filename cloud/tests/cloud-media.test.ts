// Media sourcing on the Cloud (src/shared/cloud-media.ts, cloud/src/http/routes-media.ts): a signed-in team asks one search; the
// Cloud runs the free providers it holds a key for, reads the keys from its vault (audited, never in the answer), skips what it
// has no key for and says which vault name is missing, never reaches a paid provider or a web excerpt, and caches answers.
// No network: providers and fetch are fakes.
import { describe, expect, it } from 'vitest'
import { fakePaid, fakeProvider, fairUseVideo, jsonResponse, routedFetch } from '../../src/engine/sourcing/fakes.ts'
import { MEDIA_ROUTES, MediaSearchResponse, MediaWatchResponse } from '../../src/shared/cloud-media.ts'
import type { ProviderCtx } from '../../src/engine/sourcing/types.ts'
import { makeCloud, signUpAndIn } from './helpers.ts'

const body = (query: string, extra: Record<string, unknown> = {}) => ({ query, kinds: ['image', 'sfx'], ...extra })

describe('POST /v1/media/search', () => {
  it('answers ranked candidates with licence, preview and cost 0 for a signed-in user, and refuses anonymous calls', async () => {
    const free = fakeProvider('free-img', 'image', [{ id: '1', title: 'Wall Street crash 1929 crowd' }])
    const t = makeCloud({ server: { media: { providers: [free] } } })
    const p = await signUpAndIn(t)
    expect((await t.app.inject({ method: 'POST', url: MEDIA_ROUTES.mediaSearch.path, payload: body('Wall Street crash 1929') })).statusCode).toBe(401)
    const res = await t.app.inject({ method: 'POST', url: MEDIA_ROUTES.mediaSearch.path, headers: p.auth, payload: body('Wall Street crash 1929') })
    expect(res.statusCode).toBe(200)
    const out = MediaSearchResponse.parse(res.json())
    expect(out.candidates).toHaveLength(1)
    expect(out.candidates[0]).toMatchObject({ provider: 'free-img', costUsd: 0, previewUrl: 'https://fake.test/1.jpg', licence: { status: 'public-domain' } })
    expect(out.costUsd).toBe(0)
  })

  it('uses the vault key (audited), never returns it, and names the missing vault entry when there is none', async () => {
    const seen: Array<string | undefined> = []
    const keyed = { ...fakeProvider('snd', 'sfx', []), secret: 'FREESOUND_API_KEY', search: async (_q: unknown, c: ProviderCtx) => (seen.push(c.key), []) }
    const t = makeCloud({ server: { media: { providers: [keyed] } } })
    const p = await signUpAndIn(t)
    const without = MediaSearchResponse.parse((await t.app.inject({ method: 'POST', url: MEDIA_ROUTES.mediaSearch.path, headers: p.auth, payload: body('crowd cheering', { kinds: ['sfx'] }) })).json())
    expect(without.skipped).toEqual([{ provider: 'snd', reason: 'no-key', detail: 'FREESOUND_API_KEY' }])
    expect(seen).toEqual([])
    t.cloud.vault.set('FREESOUND_API_KEY', 'freesound-test-SECRET-0001', 'test')
    const res = await t.app.inject({ method: 'POST', url: MEDIA_ROUTES.mediaSearch.path, headers: p.auth, payload: body('crowd cheering', { kinds: ['sfx'] }) })
    expect(seen).toEqual(['freesound-test-SECRET-0001'])
    expect(res.body).not.toContain('freesound-test-SECRET-0001')
    expect(t.cloud.vault.list().map((v) => v.name)).toContain('FREESOUND_API_KEY')
  })

  it('never reaches a paid provider or a web-excerpt provider, even when named', async () => {
    const paid = fakePaid('el-music', 'music')
    const yt = { ...fakeProvider('youtube-excerpt', 'video', [fairUseVideo('v', 'crowd cheering')]), optIn: true }
    const free = fakeProvider('free-vid', 'video', [{ id: 'f', title: 'crowd cheering film' }])
    const t = makeCloud({ server: { media: { providers: [paid, yt, free] } } })
    const p = await signUpAndIn(t)
    const res = await t.app.inject({ method: 'POST', url: MEDIA_ROUTES.mediaSearch.path, headers: p.auth, payload: { query: 'crowd cheering', kinds: ['video', 'music'], providers: ['el-music', 'youtube-excerpt', 'free-vid'] } })
    const out = MediaSearchResponse.parse(res.json())
    expect(out.candidates.map((c) => c.provider)).toEqual(['free-vid'])
    expect(paid.calls).toBe(0)
  })

  it('caches: the same question does not ask the providers twice', async () => {
    const free = fakeProvider('free-img', 'image', [{ id: '1', title: 'crowd photo' }])
    const t = makeCloud({ server: { media: { providers: [free] } } })
    const p = await signUpAndIn(t)
    for (let i = 0; i < 3; i++) expect((await t.app.inject({ method: 'POST', url: MEDIA_ROUTES.mediaSearch.path, headers: p.auth, payload: { query: 'crowd photo' } })).statusCode).toBe(200)
    expect(free.calls).toBe(1)
  })

  it('refuses a malformed request in the error shape', async () => {
    const t = makeCloud({ server: { media: { providers: [] } } })
    const p = await signUpAndIn(t)
    const res = await t.app.inject({ method: 'POST', url: MEDIA_ROUTES.mediaSearch.path, headers: p.auth, payload: { query: '', kinds: ['hologram'] } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('error.code', 'bad_request')
  })
})

describe('POST /v1/media/watch (Gemini reads a public YouTube video: costs money)', () => {
  const shots = JSON.stringify({ shots: [{ start: '00:10', end: '00:16', shows: 'a border post', kind: 'archive-film', text: 'none', logo: 'none', ai: false, edited: false, subtitles: false, quality: 4 }] })
  const gemini = () => routedFetch([['generativelanguage.googleapis.com', () => jsonResponse({ candidates: [{ content: { parts: [{ text: shots }] } }], usageMetadata: { promptTokenCount: 12_000, candidatesTokenCount: 200 } })]])
  const ask = (t: ReturnType<typeof makeCloud>, headers: Record<string, string>, url = 'https://www.youtube.com/watch?v=abc') => t.app.inject({ method: 'POST', url: MEDIA_ROUTES.mediaWatch.path, headers, payload: { url, endS: 60, focus: 'a border post' } })

  it('answers the shot log and its cost for an internal team, key read from the vault (audited), never echoed', async () => {
    const g = gemini()
    const t = makeCloud({ paidCalls: true, server: { media: { providers: [], fetch: g.fetch } } })
    const p = await signUpAndIn(t, { internal: true })
    t.cloud.vault.set('GEMINI_API_KEY', 'gemini-test-SECRET-0001', 'test')
    const res = await ask(t, p.auth)
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('gemini-test-SECRET-0001')
    const out = MediaWatchResponse.parse(res.json())
    expect(out.shots).toHaveLength(1)
    expect(out.costUsd).toBeCloseTo((12_000 * 0.25 + 200 * 1.5) / 1e6, 8)
    expect(g.calls[0]!.headers['x-goog-api-key']).toBe('gemini-test-SECRET-0001')
  })

  it('asks the dense shot log at the asked frame rate and echoes that it did (« watch a whole video »)', async () => {
    const dense = JSON.stringify({ shots: [{ start: '00:00', end: '00:02.5', shows: 'a map of Europe', kind: 'graphic', text: 'large', logo: 'none', ai: false, edited: false, subtitles: false, quality: 4, onText: 'EUROPE 1940', says: 'In the summer of 1940', camera: 'push-in' }] })
    let sent = ''
    const g = routedFetch([['generativelanguage.googleapis.com', (_u, init) => {
      sent = String(init?.body ?? '')
      return jsonResponse({ candidates: [{ content: { parts: [{ text: dense }] } }], usageMetadata: { promptTokenCount: 9_000, candidatesTokenCount: 300 } })
    }]])
    const t = makeCloud({ paidCalls: true, server: { media: { providers: [], fetch: g.fetch } } })
    const p = await signUpAndIn(t, { internal: true })
    t.cloud.vault.set('GEMINI_API_KEY', 'gemini-test-SECRET-0001', 'test')
    const res = await t.app.inject({ method: 'POST', url: MEDIA_ROUTES.mediaWatch.path, headers: p.auth, payload: { url: 'https://www.youtube.com/watch?v=abc', startS: 0, endS: 60, dense: true, fps: 2 } })
    expect(res.statusCode).toBe(200)
    const out = MediaWatchResponse.parse(res.json())
    expect(out.dense).toBe(true)
    expect(out.shots[0]).toMatchObject({ onText: 'EUROPE 1940', says: 'In the summer of 1940', camera: 'push-in' })
    const body = JSON.parse(sent) as { contents: { parts: { videoMetadata?: { fps?: number } }[] }[]; generationConfig: { responseJsonSchema: { properties: { shots: { items: { required: string[] } } } } } }
    expect(body.contents[0]!.parts[0]!.videoMetadata?.fps).toBe(2)
    expect(body.generationConfig.responseJsonSchema.properties.shots.items.required).toContain('says')
  })

  it('refuses a team that is not internal or test, a Cloud with paid calls off, a missing key, and a link that is not YouTube', async () => {
    const g = gemini()
    const open = makeCloud({ paidCalls: true, server: { media: { providers: [], fetch: g.fetch } } })
    open.cloud.vault.set('GEMINI_API_KEY', 'gemini-test-SECRET-0001', 'test')
    const customer = await signUpAndIn(open)
    expect((await ask(open, customer.auth)).statusCode).toBe(403)
    const off = makeCloud({ paidCalls: false, server: { media: { providers: [], fetch: g.fetch } } })
    off.cloud.vault.set('GEMINI_API_KEY', 'gemini-test-SECRET-0001', 'test')
    expect((await ask(off, (await signUpAndIn(off, { internal: true })).auth)).statusCode).toBe(403)
    const nokey = makeCloud({ paidCalls: true, server: { media: { providers: [], fetch: g.fetch } } })
    const p = await signUpAndIn(nokey, { internal: true })
    const missing = await ask(nokey, p.auth)
    expect(missing.statusCode).toBe(404)
    expect(missing.body).toContain('GEMINI_API_KEY')
    expect((await ask(nokey, p.auth, 'https://example.com/video')).statusCode).toBe(400)
    expect(g.calls).toHaveLength(0)
  })
})
