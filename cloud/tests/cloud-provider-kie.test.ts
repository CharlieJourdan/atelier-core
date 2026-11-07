// production-10: the Kie.ai adapters (presenter:kling-avatar-kie, clip:veo31-lite-kie, image:gpt-image-25-kie) against a fake
// fetch: the exact createTask request of each model, the key to api.kie.ai only, the polling of recordInfo (its resultJson
// string), the credits kept for reconciliation, the cost of each engine's line, the resume through providerRef, a failed task, a
// content refusal, the HTTP-200 error codes, 401 / 429 / 5xx and a lost creation. Never the network, never a real key.
import { describe, expect, it } from 'vitest'
import { RetryableProviderError, runUsage, type ProviderAdapter, type ProviderContext } from '../src/providers/types.ts'
import { KIE_AVATAR_DEFAULT_PROMPT, KIE_BASE, kieAspect, kieAvatarAdapter, kieImageAdapter, kieVeoAdapter } from '../src/providers/kie.ts'
import { ctxFor, fakeFetch, json, type Recorded } from './fake-fetch.ts'

const KEY = 'kie-test-SECRET-3a9d51f0'
const FILES = 'https://cloud.example/files'
const VOICE_URL = `${FILES}/art_voice?exp=1&sig=a`
const FACE_URL = `${FILES}/art_face?exp=1&sig=b`
const ART: Record<string, string> = { art_a: `${FILES}/art_a?exp=1&sig=aa`, art_b: `${FILES}/art_b?exp=1&sig=bb`, art_still: `${FILES}/art_still?exp=1&sig=ss` }
const CREATE = `${KIE_BASE}/api/v1/jobs/createTask`
const INFO = (id: string): string => `${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${id}`
const CDN = 'https://tempfile.aiquickdraw.example/r'
const MP4 = Buffer.alloc(120, 3)
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9])

function ctxWith(saved: string | null = null) {
  const refs: (string | null)[] = []
  let current = saved
  const known: Record<string, [string, string]> = { art_voice: ['voix.mp3', VOICE_URL], art_face: ['visage.png', FACE_URL] }
  const ctx: ProviderContext = {
    ...ctxFor(KEY),
    artefact: (id) => {
      const k = known[id]
      if (!k) throw new Error('not found')
      return { name: k[0], url: k[1] }
    },
    artefactUrl: (id) => {
      const u = ART[id]
      if (!u) throw new Error('not found')
      return u
    },
    providerRef: () => current,
    setProviderRef: (r) => {
      current = r
      refs.push(r)
    }
  }
  return { ctx, refs }
}

type Info = Record<string, unknown>
const success = (url: string, credits = 30): Info => ({ state: 'success', resultJson: JSON.stringify({ resultUrls: [url] }), creditsConsumed: credits })

/** createTask answers task-1, task-2… (or `create`); recordInfo answers the next state of that task (else success). */
function kie(states: Record<string, Info[]> = {}, over: { create?: () => Response; info?: () => Response; done?: (id: string) => Info } = {}) {
  let made = 0
  const queues: Record<string, Info[]> = Object.fromEntries(Object.entries(states).map(([k, v]) => [k, [...v]]))
  return fakeFetch((req: Recorded) => {
    if (req.url === CREATE) return over.create ? over.create() : json({ code: 200, msg: 'success', data: { taskId: `task-${++made}` } })
    if (req.url.startsWith(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=`)) {
      if (over.info) return over.info()
      const id = decodeURIComponent(req.url.slice(req.url.indexOf('=') + 1))
      const next = queues[id]?.shift() ?? (over.done ? over.done(id) : success(`${CDN}/${id}.mp4`))
      return json({ code: 200, msg: 'success', data: { taskId: id, ...next } })
    }
    if (req.url.startsWith(CDN)) return req.url.endsWith('.png') ? new Response(PNG, { headers: { 'content-type': 'image/png' } }) : new Response(MP4, { headers: { 'content-type': 'video/mp4' } })
    return new Response('not here', { status: 404 })
  })
}

const body = (r: Recorded | undefined): Record<string, any> => JSON.parse(r?.body ?? '{}') as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const outcome = (p: Promise<unknown>): Promise<Error> => p.then(() => { throw new Error('it should have failed') }, (e: unknown) => e as Error)
const keyOnlyToKie = (calls: Recorded[]): void => {
  for (const c of calls) expect(c.headers.authorization, c.url).toBe(c.url.startsWith(KIE_BASE) ? `Bearer ${KEY}` : undefined)
  expect(JSON.stringify(calls.map((c) => c.url))).not.toContain(KEY)
}

const avatar = (f: { fetch: typeof fetch }): ProviderAdapter => kieAvatarAdapter({ fetchImpl: f.fetch, pollMs: 0 })
const veo = (f: { fetch: typeof fetch }, extra: Record<string, unknown> = {}): ProviderAdapter => kieVeoAdapter({ fetchImpl: f.fetch, pollMs: 0, ...extra })
const picture = (f: { fetch: typeof fetch }): ProviderAdapter => kieImageAdapter({ fetchImpl: f.fetch, pollMs: 0 })
const talk = (a: ProviderAdapter, ctx: ProviderContext, over: Record<string, unknown> = {}) =>
  runUsage(a, 'talkingAvatar', { avatarId: 'portrait', audioArtefactId: 'art_voice', portraitArtefactId: 'art_face', seconds: 5, aspect: '16:9', ...over }, ctx)
const clip = (a: ProviderAdapter, ctx: ProviderContext, over: Record<string, unknown> = {}) => runUsage(a, 'generateVideo', { prompt: 'les vagues montent', seconds: 5, aspect: '16:9', ...over }, ctx)
const image = (a: ProviderAdapter, ctx: ProviderContext, over: Record<string, unknown> = {}) => runUsage(a, 'generateImage', { prompt: 'un phare', width: 1280, height: 720, count: 1, ...over }, ctx)

describe('Kling AI Avatar on Kie.ai (presenter:kling-avatar-kie)', () => {
  it('creates the task with our signed links and the prompt, polls recordInfo, downloads bare, bills the seconds, keeps the credits', async () => {
    const f = kie({ 'task-1': [{ state: 'waiting' }, { state: 'generating' }] }, { done: (id) => success(`${CDN}/${id}.mp4`, 40) })
    const { ctx, refs } = ctxWith()
    const a = avatar(f)
    expect(a).toMatchObject({ id: 'presenter:kling-avatar-kie', kind: 'real', secretName: 'KIE_API_KEY' })
    const out = await talk(a, ctx, { prompt: 'calm nods' })
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${CREATE}`, `GET ${INFO('task-1')}`, `GET ${INFO('task-1')}`, `GET ${INFO('task-1')}`, `GET ${CDN}/task-1.mp4`])
    expect(body(f.calls[0])).toEqual({ model: 'kling/ai-avatar-standard', input: { image_url: FACE_URL, audio_url: VOICE_URL, prompt: 'calm nods' } })
    expect(f.calls[0]?.headers['content-type']).toBe('application/json')
    keyOnlyToKie(f.calls)
    expect(JSON.parse(refs[0] ?? '{}')).toEqual({ ts: ['task-1'] })
    expect(refs.at(-1)).toBeNull()
    expect(out.files).toEqual([{ name: 'avatar.mp4', mime: 'video/mp4', bytes: MP4 }])
    expect(out.data).toMatchObject({ engine: 'presenter:kling-avatar-kie', resolution: '720p', seconds: 5, credits: 40, creditsUsd: 0.2 })
    expect(out.costUsd).toBeCloseTo(5 * 0.04, 10)
    const plain = kie()
    await talk(avatar(plain), ctxWith().ctx)
    expect(body(plain.calls[0]).input.prompt).toBe(KIE_AVATAR_DEFAULT_PROMPT)
  })

  it('refuses over 180 s, a resolution it does not make and a missing portrait before any call; resumes a stored task', async () => {
    const f = kie()
    await expect(talk(avatar(f), ctxWith().ctx, { seconds: 181 })).rejects.toThrow(/at most 180 seconds/)
    await expect(talk(avatar(f), ctxWith().ctx, { resolution: '1080p' })).rejects.toThrow(/not a resolution/)
    await expect(talk(avatar(f), ctxWith().ctx, { portraitArtefactId: undefined })).rejects.toThrow(/portrait is missing/)
    expect(f.calls).toHaveLength(0)
    const g = kie()
    const { ctx, refs } = ctxWith(JSON.stringify({ ts: ['task-7'] }))
    await talk(avatar(g), ctx)
    expect(g.calls.some((c) => c.url === CREATE)).toBe(false)
    expect(g.calls[0]?.url).toBe(INFO('task-7'))
    expect(refs).toEqual([null])
  })
})

describe('Veo 3.1 Lite on Kie.ai (clip:veo31-lite-kie)', () => {
  it('creates the veo-3-1 task: veo3_lite, the start still as first frame, « Avoid: », 4/6/8 s, 720p; billed per clip at its line', async () => {
    const f = kie({ 'task-1': [{ state: 'queuing' }] })
    const { ctx, refs } = ctxWith()
    const a = veo(f)
    expect(a).toMatchObject({ id: 'clip:veo31-lite-kie', kind: 'real', secretName: 'KIE_API_KEY' })
    const out = await clip(a, ctx, { imageArtefactId: 'art_still', negative: 'texte', aspect: '9:16' })
    expect(body(f.calls[0])).toEqual({
      model: 'veo-3-1',
      input: { prompt: 'les vagues montent\n\nAvoid: texte', model: 'veo3_lite', image_urls: [ART.art_still], generation_type: 'FIRST_AND_LAST_FRAMES_2_VIDEO', aspect_ratio: '9:16', resolution: '720p', duration: 6 }
    })
    keyOnlyToKie(f.calls)
    expect(JSON.parse(refs[0] ?? '{}')).toEqual({ ts: ['task-1'] })
    expect(refs.at(-1)).toBeNull()
    expect(out.files[0]).toMatchObject({ name: 'clip.mp4', mime: 'video/mp4' })
    expect(out.data).toMatchObject({ engine: 'clip:veo31-lite-kie', seconds: 6, requestedSeconds: 5, fromImage: true, credits: 30, creditsUsd: 0.15 })
    expect(out.costUsd).toBeCloseTo(0.15, 10)
    const text = kie()
    await clip(veo(text), ctxWith().ctx, { seconds: 9 })
    expect(body(text.calls[0]).input).not.toHaveProperty('image_urls')
    expect(body(text.calls[0]).input).not.toHaveProperty('generation_type')
    expect(body(text.calls[0]).input.duration).toBe(8)
  })

  it('a retry resumes the stored task; a poll that outlasts the wait keeps the ref for the retry', async () => {
    const f = kie()
    await clip(veo(f), ctxWith(JSON.stringify({ ts: ['task-3'] })).ctx)
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false)
    const forever = kie({ 'task-1': Array(50).fill({ state: 'generating' }) })
    const first = ctxWith()
    expect(await outcome(clip(veo(forever, { pollMs: 1, maxWaitMs: 5 }), first.ctx))).toBeInstanceOf(RetryableProviderError)
    expect(first.refs).toEqual([JSON.stringify({ ts: ['task-1'] })])
  })
})

describe('GPT Image 2.5 on Kie.ai (image:gpt-image-25-kie)', () => {
  const png = (id: string): Info => success(`${CDN}/${id}.png`, 6)

  it('text to image: the flare model, aspect from the size, 1K, « Avoid: »; one task per picture; cost per picture', async () => {
    const f = kie({}, { done: png })
    const { ctx, refs } = ctxWith()
    const a = picture(f)
    expect(a).toMatchObject({ id: 'image:gpt-image-25-kie', kind: 'real', secretName: 'KIE_API_KEY' })
    const out = await image(a, ctx, { count: 2, negative: 'du texte' })
    expect(f.calls.filter((c) => c.url === CREATE)).toHaveLength(2)
    expect(body(f.calls[0])).toEqual({ model: 'gpt-image-2-5-flare-text-to-image', input: { prompt: 'un phare\n\nAvoid: du texte', aspect_ratio: '16:9', resolution: '1K' } })
    keyOnlyToKie(f.calls)
    expect(refs.map((r) => (r === null ? null : JSON.parse(r)))).toEqual([{ ts: ['task-1'] }, { ts: ['task-1', 'task-2'] }, null])
    expect(out.files.map((x) => x.name)).toEqual(['image-1.png', 'image-2.png'])
    expect(Buffer.from(out.files[0]?.bytes ?? []).equals(PNG)).toBe(true)
    expect(out.data).toMatchObject({ aspect: '16:9', count: 2, references: 0, credits: 12, creditsUsd: 0.06 })
    expect(out.costUsd).toBeCloseTo(2 * 0.03, 10)
    expect([kieAspect(720, 1280), kieAspect(1024, 1024), kieAspect(1200, 900), kieAspect(4000, 1000)]).toEqual(['9:16', '1:1', '4:3', '16:9'])
  })

  it('with references: the sunburst image-to-image model with input_urls (our signed links, never the key)', async () => {
    const f = kie({}, { done: png })
    const out = await image(picture(f), ctxWith().ctx, { referenceArtefactIds: ['art_a', 'art_b'], width: 720, height: 1280 })
    expect(body(f.calls[0])).toEqual({ model: 'gpt-image-2-5-sunburst-image-to-image', input: { prompt: 'un phare', aspect_ratio: '9:16', resolution: '1K', input_urls: [ART.art_a, ART.art_b] } })
    expect(f.calls.some((c) => c.url.startsWith(FILES))).toBe(false)
    expect(out.data).toMatchObject({ references: 2 })
  })

  it('a retry resumes the stored tasks and only creates the missing ones', async () => {
    const f = kie({}, { done: png })
    const { ctx } = ctxWith(JSON.stringify({ ts: ['task-9'] }))
    const out = await image(picture(f), ctx, { count: 2 })
    expect(f.calls.filter((c) => c.url === CREATE)).toHaveLength(1)
    expect(f.calls.some((c) => c.url === INFO('task-9'))).toBe(true)
    expect(out.files).toHaveLength(2)
  })
})

describe('Kie.ai failures (every engine)', () => {
  const runners: [string, (f: { fetch: typeof fetch }, ctx: ProviderContext) => Promise<unknown>][] = [
    ['avatar', (f, ctx) => talk(avatar(f), ctx)],
    ['clip', (f, ctx) => clip(veo(f), ctx, { imageArtefactId: 'art_still' })],
    ['image', (f, ctx) => image(picture(f), ctx)]
  ]

  it.each(runners)('%s: a failed task fails for good, clears the ref, never shows the key; a policy failure is « refused: »', async (_n, go) => {
    const failed = ctxWith()
    const e = await outcome(go(kie({ 'task-1': [{ state: 'fail', failCode: '500', failMsg: `internal error ${KEY}` }] }), failed.ctx))
    expect(e.message).toMatch(/the task failed/)
    expect(e.message).not.toMatch(/^refused/)
    expect(e.message).not.toContain(KEY)
    expect(e).not.toBeInstanceOf(RetryableProviderError)
    expect(failed.refs.at(-1)).toBeNull()
    const policy = ctxWith()
    const p = await outcome(go(kie({ 'task-1': [{ state: 'fail', failMsg: 'Your content was flagged by our safety policy' }] }), policy.ctx))
    expect(p.message).toMatch(/^refused: /)
    expect(p).not.toBeInstanceOf(RetryableProviderError)
    expect(policy.refs.at(-1)).toBeNull()
    const created = await outcome(go(kie({}, { create: () => json({ code: 422, msg: 'prompt rejected by content moderation', data: null }) }), ctxWith().ctx))
    expect(created.message).toMatch(/^refused: /)
  })

  it.each(runners)('%s: HTTP 401 and body code 401 / 402 are fatal without the key; 429 / 455 / 5xx codes in a clear answer retry', async (_n, go) => {
    const http401 = await outcome(go(kie({}, { create: () => json({ code: 401, msg: `bad ${KEY}` }, 401) }), ctxWith().ctx))
    expect(http401).not.toBeInstanceOf(RetryableProviderError)
    expect(http401.message).toMatch(/401/)
    expect(http401.message).not.toContain(KEY)
    for (const code of [401, 402]) {
      const e = await outcome(go(kie({}, { create: () => json({ code, msg: `refused ${KEY}` }) }), ctxWith().ctx))
      expect(e).not.toBeInstanceOf(RetryableProviderError)
      expect(e.message).toMatch(new RegExp(`code ${code}`))
      expect(e.message).not.toContain(KEY)
    }
    for (const code of [429, 455, 500]) expect(await outcome(go(kie({}, { create: () => json({ code, msg: 'busy' }) }), ctxWith().ctx))).toBeInstanceOf(RetryableProviderError)
    expect(await outcome(go(kie({}, { create: () => new Response('{}', { status: 429 }) }), ctxWith().ctx))).toBeInstanceOf(RetryableProviderError)
  })

  it.each(runners)('%s: a creation whose answer was lost (5xx, timeout, not JSON) is not retried; a 5xx poll retries and keeps the ref', async (_n, go) => {
    for (const res of [() => new Response('{}', { status: 502 }), () => new Response('<html>', { status: 200 })]) {
      const lost = await outcome(go(kie({}, { create: res }), ctxWith().ctx))
      expect(lost).not.toBeInstanceOf(RetryableProviderError)
      expect(lost.message).toMatch(/not confirmed|not retried/)
    }
    const busy = ctxWith()
    const e = await outcome(go(kie({}, { info: () => new Response('{}', { status: 503 }) }), busy.ctx))
    expect(e).toBeInstanceOf(RetryableProviderError)
    expect(busy.refs).toEqual([JSON.stringify({ ts: ['task-1'] })])
    const gone = ctxWith(JSON.stringify({ ts: ['task-1'] }))
    const g = await outcome(go(kie({}, { info: () => json({ code: 404, msg: 'task not found' }) }), gone.ctx))
    expect(g.message).toMatch(/no longer knows/)
    expect(gone.refs).toEqual([null])
  })
})
