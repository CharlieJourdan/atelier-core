// The Hedra talking-avatar adapter against a fake fetch: the audio from the Cloud's signed link, the two-step asset upload, the
// generation, the status polls, the download, the cost per second, the resume through providerRef, and the failures. Nothing
// here reaches the network.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { HEDRA_BASE, HEDRA_DEFAULT_MODEL, HEDRA_USD_PER_SECOND, hedraAdapter, hedraCostUsd } from '../src/providers/hedra.ts'
import { RetryableProviderError, runUsage, type ProviderContext } from '../src/providers/types.ts'
import { ctxFor, fakeFetch, json, type Recorded } from './fake-fetch.ts'
import { makeCloud, quoteAndRun, signUpAndIn, wavBytes } from './helpers.ts'

const KEY = 'hedra-test-SECRET-7c8d9e0f1a'
const PROD = { NODE_ENV: 'production' }
const CDN = 'https://cdn.hedra.example/out'
const AUDIO_URL = 'https://cloud.test/v1/files/aud-1?sig=xyz'
const AUDIO = Buffer.from('ID3-voice-bytes-of-the-hook')
const MP4 = Buffer.alloc(300, 5)

const ctxWith = (saved: string | null, signal?: AbortSignal) => {
  const refs: (string | null)[] = []
  let current = saved
  const ctx: ProviderContext = {
    ...ctxFor(KEY, signal),
    artefact: (id) => {
      if (id !== 'art_voice') throw new Error('not found')
      return { name: 'hook.mp3', url: AUDIO_URL }
    },
    providerRef: () => current,
    setProviderRef: (r) => {
      current = r
      refs.push(r)
    }
  }
  return { ctx, refs }
}

/** A fake Hedra: assets, generation, statuses answered in order then `complete`, the CDN file. */
function hedra(statuses: string[] = [], over: { status?: (n: number) => Response; start?: Response; create?: Response; upload?: Response } = {}) {
  let polls = 0
  return fakeFetch((req: Recorded) => {
    if (req.url === AUDIO_URL) return new Response(AUDIO, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    if (req.method === 'POST' && req.url === `${HEDRA_BASE}/assets`) return over.create ?? json({ id: 'aud-1', name: 'hook.mp3', type: 'audio' })
    if (req.method === 'POST' && req.url === `${HEDRA_BASE}/assets/aud-1/upload`) return over.upload ?? json({ id: 'aud-1' })
    if (req.method === 'POST' && req.url === `${HEDRA_BASE}/generations`) return over.start ?? json({ id: 'gen-9', asset_id: 'vid-9', status: 'queued' })
    if (req.url === `${HEDRA_BASE}/generations/gen-9/status`) {
      polls++
      return over.status ? over.status(polls) : json({ id: 'gen-9', status: statuses[polls - 1] ?? 'complete', url: `${CDN}/avatar.mp4`, duration_ms: 5000 })
    }
    return new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } })
  })
}

const input = (over: Record<string, unknown> = {}) => ({ avatarId: 'img-avatar-1', audioArtefactId: 'art_voice', seconds: 5, aspect: '16:9', ...over })
const run = (a: ReturnType<typeof hedraAdapter>, ctx: ProviderContext, over: Record<string, unknown> = {}) => runUsage(a, 'talkingAvatar', input(over), ctx)

describe('Hedra talking avatar', () => {
  it('declares its secret and the one usage', () => {
    const a = hedraAdapter()
    expect(a).toMatchObject({ id: 'hedra', kind: 'real', secretName: 'HEDRA_API_KEY' })
    expect(typeof a.talkingAvatar).toBe('function')
    expect(a.synthesize).toBeUndefined()
  })

  it('uploads the voice, starts the generation with the avatar as first frame, polls, downloads, and bills the seconds of the clip', async () => {
    const f = hedra(['queued', 'processing'])
    const { ctx, refs } = ctxWith(null)
    const out = await run(hedraAdapter({ fetchImpl: f.fetch, pollMs: 0 }), ctx)
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${AUDIO_URL}`,
      `POST ${HEDRA_BASE}/assets`,
      `POST ${HEDRA_BASE}/assets/aud-1/upload`,
      `POST ${HEDRA_BASE}/generations`,
      `GET ${HEDRA_BASE}/generations/gen-9/status`,
      `GET ${HEDRA_BASE}/generations/gen-9/status`,
      `GET ${HEDRA_BASE}/generations/gen-9/status`,
      `GET ${CDN}/avatar.mp4`
    ])
    const [audio, create, upload, start] = f.calls as [Recorded, Recorded, Recorded, Recorded]
    // the key goes to Hedra's API only: not to the Cloud's signed link, not to the CDN
    expect(audio.headers['x-api-key']).toBeUndefined()
    expect(f.calls.at(-1)?.headers['x-api-key']).toBeUndefined()
    expect(JSON.stringify(f.calls.map((c) => c.url))).not.toContain(KEY)
    expect(create.headers['x-api-key']).toBe(KEY)
    expect(JSON.parse(create.body)).toEqual({ name: 'hook.mp3', type: 'audio' })
    expect(upload.form).toEqual({ file: { name: 'hook.mp3', type: 'audio/mpeg', size: AUDIO.length } })
    expect(upload.headers['content-type']).toBeUndefined() // multipart: fetch writes the boundary itself
    expect(JSON.parse(start.body)).toEqual({
      type: 'video',
      ai_model_id: HEDRA_DEFAULT_MODEL,
      start_keyframe_id: 'img-avatar-1',
      audio_id: 'aud-1',
      generated_video_inputs: { text_prompt: 'A person talking to the camera, natural and calm', resolution: '720p', aspect_ratio: '16:9' }
    })
    // the generation id is stored before the first poll and cleared once the clip is in hand
    expect(JSON.parse(refs[0] ?? '{}')).toEqual({ g: 'gen-9' })
    expect(refs.at(-1)).toBeNull()
    expect(out.files).toEqual([{ name: 'avatar.mp4', mime: 'video/mp4', bytes: MP4 }])
    expect(out.data).toMatchObject({ seconds: 5, requestedSeconds: 5, resolution: '720p', avatarId: 'img-avatar-1' })
    expect(out.costUsd).toBeCloseTo(5 * HEDRA_USD_PER_SECOND, 10)
    expect(hedraCostUsd(60)).toBeCloseTo(1.5, 10) // BUSINESS-INFRA §3.2: "from USD 1.50" a minute
  })

  it('asks the shape of the film (9:16 for a short), the configured model and the configured size', async () => {
    const f = hedra()
    await run(hedraAdapter({ fetchImpl: f.fetch, pollMs: 0, model: 'my-model', resolution: '540p' }), ctxWith(null).ctx, { aspect: '9:16' })
    expect(JSON.parse(f.calls[3]?.body ?? '{}')).toMatchObject({ ai_model_id: 'my-model', generated_video_inputs: { resolution: '540p', aspect_ratio: '9:16' } })
  })

  it('bills the length of the clip Hedra reports when it is shorter than the request, never more than the request', async () => {
    const shorter = await run(hedraAdapter({ fetchImpl: hedra([], { status: () => json({ status: 'complete', url: `${CDN}/a.mp4`, duration_ms: 3200 }) }).fetch, pollMs: 0 }), ctxWith(null).ctx, { seconds: 5 })
    expect(shorter.costUsd).toBeCloseTo(4 * HEDRA_USD_PER_SECOND, 10) // 3.2 s rounds up to 4
    const longer = await run(hedraAdapter({ fetchImpl: hedra([], { status: () => json({ status: 'complete', url: `${CDN}/a.mp4`, duration_ms: 9000 }) }).fetch, pollMs: 0 }), ctxWith(null).ctx, { seconds: 5 })
    expect(longer.costUsd).toBeCloseTo(5 * HEDRA_USD_PER_SECOND, 10)
    const unknown = await run(hedraAdapter({ fetchImpl: hedra([], { status: () => json({ status: 'complete', download_url: `${CDN}/a.mp4` }) }).fetch, pollMs: 0 }), ctxWith(null).ctx, { seconds: 7 })
    expect(unknown.costUsd).toBeCloseTo(7 * HEDRA_USD_PER_SECOND, 10)
  })

  it('a retry resumes the stored generation: no audio fetched, nothing uploaded, no second generation, no second bill', async () => {
    const f = hedra(['processing'])
    const { ctx, refs } = ctxWith(JSON.stringify({ g: 'gen-9' }))
    const out = await run(hedraAdapter({ fetchImpl: f.fetch, pollMs: 0 }), ctx)
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false)
    expect(f.calls.some((c) => c.url === AUDIO_URL)).toBe(false)
    expect(out.files).toHaveLength(1)
    expect(refs).toEqual([null])
  })

  it('a poll that times out leaves the ref for the retry, which resumes it', async () => {
    const forever = hedra([], { status: () => json({ status: 'processing' }) })
    const first = ctxWith(null)
    await expect(run(hedraAdapter({ fetchImpl: forever.fetch, pollMs: 1, maxWaitMs: 5 }), first.ctx)).rejects.toBeInstanceOf(RetryableProviderError)
    expect(first.refs).toHaveLength(1)
    const second = ctxWith(first.refs[0] ?? null)
    const done = hedra()
    const out = await run(hedraAdapter({ fetchImpl: done.fetch, pollMs: 0 }), second.ctx)
    expect(done.calls.some((c) => c.method === 'POST')).toBe(false)
    expect(out.files).toHaveLength(1)
  })

  it('a generation that ended in error, one Hedra no longer knows, or one without a link fails for good and clears the ref', async () => {
    const failed = ctxWith(null)
    const e1 = await run(hedraAdapter({ fetchImpl: hedra([], { status: () => json({ status: 'error', error_message: `bad audio ${KEY}` }) }).fetch, pollMs: 0 }), failed.ctx).catch((e: Error) => e)
    expect(e1).not.toBeInstanceOf(RetryableProviderError)
    expect((e1 as Error).message).toMatch(/generation failed.*bad audio/)
    expect((e1 as Error).message).not.toContain(KEY)
    expect(failed.refs.at(-1)).toBeNull()
    const gone = ctxWith(null)
    const e2 = await run(hedraAdapter({ fetchImpl: hedra([], { status: () => new Response('{}', { status: 404 }) }).fetch, pollMs: 0 }), gone.ctx).catch((e: Error) => e)
    expect((e2 as Error).message).toMatch(/no longer knows/)
    expect(gone.refs.at(-1)).toBeNull()
    const nolink = ctxWith(null)
    await expect(run(hedraAdapter({ fetchImpl: hedra([], { status: () => json({ status: 'complete' }) }).fetch, pollMs: 0 }), nolink.ctx)).rejects.toThrow(/no video link/)
    expect(nolink.refs.at(-1)).toBeNull()
  })

  it('refuses before any call: no voice audio, or a clip longer than the limit', async () => {
    const f = hedra()
    await expect(run(hedraAdapter({ fetchImpl: f.fetch }), ctxWith(null).ctx, { audioArtefactId: undefined })).rejects.toThrow(/voice audio is missing/)
    await expect(run(hedraAdapter({ fetchImpl: f.fetch }), ctxWith(null).ctx, { seconds: 121 })).rejects.toThrow(/at most 120 seconds/)
    expect(f.calls).toHaveLength(0)
  })

  it('maps failures: 429/5xx retry, 401 and 402 are fatal, the key never shows', async () => {
    const start = (res: Response) => run(hedraAdapter({ fetchImpl: hedra([], { start: res }).fetch, pollMs: 0 }), ctxWith(null).ctx)
    await expect(start(new Response('{}', { status: 429 }))).rejects.toBeInstanceOf(RetryableProviderError)
    await expect(start(new Response('{}', { status: 503 }))).rejects.toBeInstanceOf(RetryableProviderError)
    const auth = await start(new Response(`{"detail":"bad key ${KEY}"}`, { status: 401 })).catch((e: Error) => e)
    expect(auth).not.toBeInstanceOf(RetryableProviderError)
    expect((auth as Error).message).toMatch(/401/)
    expect((auth as Error).message).not.toContain(KEY)
    const broke = await start(new Response('{"detail":"insufficient credits"}', { status: 402 })).catch((e: Error) => e)
    expect((broke as Error).message).toMatch(/no balance left/)
    const upload = await run(hedraAdapter({ fetchImpl: hedra([], { upload: new Response('{}', { status: 502 }) }).fetch, pollMs: 0 }), ctxWith(null).ctx).catch((e: unknown) => e)
    expect(upload).toBeInstanceOf(RetryableProviderError)
    // no generation was started when an upload failed: nothing to resume, nothing paid
    const nothing = ctxWith(null)
    const f = hedra([], { upload: new Response('{}', { status: 502 }) })
    await run(hedraAdapter({ fetchImpl: f.fetch, pollMs: 0 }), nothing.ctx).catch(() => undefined)
    expect(nothing.refs).toEqual([])
    expect(f.calls.some((c) => c.url === `${HEDRA_BASE}/generations`)).toBe(false)
  })

  it('a job cancelled while polling stops at once and clears nothing it did not set', async () => {
    const ac = new AbortController()
    const f = hedra([], {
      status: () => {
        ac.abort(new Error('cancelled'))
        return json({ status: 'processing' })
      }
    })
    await expect(run(hedraAdapter({ fetchImpl: f.fetch, pollMs: 0 }), ctxWith(null, ac.signal).ctx)).rejects.toThrow('cancelled')
  })
})

describe('a Hedra job (fake fetch)', () => {
  it('is real, reads the voice from the team’s own artefact, is charged on the quote and keeps the key out of everything', async () => {
    const served = hedra()
    // Hedra and its CDN answer from the fake; the Cloud's own signed link (the voice file) answers with the voice
    const fetchImpl = ((url: string, init?: RequestInit) =>
      String(url).startsWith(HEDRA_BASE) || String(url).startsWith(CDN)
        ? served.fetch(url, init)
        : Promise.resolve(new Response(AUDIO, { status: 200, headers: { 'content-type': 'audio/mpeg' } }))) as typeof fetch
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [hedraAdapter({ pollMs: 0, fetchImpl })], providers: { talkingAvatar: 'hedra' } })
    t.cloud.vault.set('HEDRA_API_KEY', KEY, 'test')
    const p = await signUpAndIn(t, { credits: 10_000 })
    const voice = wavBytes(5)
    const sha = createHash('sha256').update(voice).digest('hex')
    const up = await t.app.inject({ method: 'POST', url: `/v1/uploads?name=hook.wav&sha256=${sha}`, headers: { ...p.auth, 'content-type': 'application/octet-stream' }, payload: voice })
    const audioArtefactId = (up.json() as { id: string }).id
    const { job } = await quoteAndRun(t, p, 'talkingAvatar', { avatarId: 'img-avatar-1', audioArtefactId, seconds: 5 })
    expect(job).toMatchObject({ state: 'succeeded', demo: false })
    expect(job.artefacts).toHaveLength(1)
    expect(job.artefacts[0]).toMatchObject({ name: 'avatar.mp4', mime: 'video/mp4' })
    expect(served.calls.some((c) => c.url === `${HEDRA_BASE}/generations` && c.headers['x-api-key'] === KEY)).toBe(true)
    expect(t.cloud.audit.list().some((e) => e.action === 'vault.read' && e.actor === 'adapter:hedra')).toBe(true)
    const row = t.cloud.db.prepare('SELECT provider_ref FROM jobs WHERE id = ?').get(job.id) as { provider_ref: string | null }
    expect(row.provider_ref).toBeNull()
    expect(JSON.stringify({ job, events: t.cloud.db.prepare('SELECT * FROM job_events').all() })).not.toContain(KEY)
  })
})
