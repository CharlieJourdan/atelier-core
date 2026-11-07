// Jobs (§4.1/4.2): every usage's fake through quote → job → events → artefacts; the event stream; cancellation;
// retries; idempotency; the money moves; signed links; restart recovery; and the paidCalls guard (no real adapter can
// be reached in tests, §4.11).
import { describe, expect, it } from 'vitest'
import { JobEvent, USAGES } from '../../src/shared/cloud-api.ts'
import { FAKE_ADAPTERS, FAKE_VOICE_FILE, drawPng } from '../src/providers/fakes.ts'
import { PaidCallBlocked, ProviderRegistry, REAL_ADAPTERS, isTestRun } from '../src/providers/registry.ts'
import { RetryableProviderError, type ProviderAdapter } from '../src/providers/types.ts'
import { CloudConfigFile } from '../src/config.ts'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { makeCloud, parseSse, quoteAndRun, signUpAndIn, wavBytes } from './helpers.ts'

const INPUTS: Record<string, Record<string, unknown>> = {
  synthesize: { text: 'Bonjour et bienvenue sur la chaîne.', voiceId: 'demo-claire' },
  generateImage: { prompt: 'un phare au crépuscule', count: 2 },
  generateVideo: { prompt: 'vagues', seconds: 5 },
  talkingAvatar: { avatarId: 'demo-avatar', seconds: 20 },
  channelData: { url: 'https://www.youtube.com/@exemple' },
  analyseVideo: { url: 'https://youtu.be/dQw4w9WgXcQ', minutes: 12 },
  submitGpuJob: { worker: 'render', payload: { scene: 1 }, estimatedGpuSeconds: 120 },
  searchStock: { query: 'phare en mer', orientation: 'landscape', kind: 'photo', count: 2 },
  // the clip is one of the team's files: the test puts it in storage first (see below)
  // decision 0025: no clone without the consent tick (production-5 made it part of the contract)
  cloneVoice: { name: 'Ma voix', consent: true },
  designVoice: { description: 'Une voix de femme posée, chaleureuse, pour raconter des histoires.' }
}

describe('one fake per usage, end to end', () => {
  it('every usage runs on its fake, is captured at its quote, and is marked demo', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 10_000 })
    let spent = 0
    const clip = await t.cloud.storage.put(p.teamId, null, { name: 'clip.wav', mime: 'audio/wav', bytes: readFileSync(FAKE_VOICE_FILE) }, false)
    for (const usage of USAGES) {
      const input = usage === 'cloneVoice' ? { ...INPUTS.cloneVoice, audioArtefactId: clip.id } : (INPUTS[usage] as Record<string, unknown>)
      const { quote, job } = await quoteAndRun(t, p, usage, input, usage)
      expect(job).toMatchObject({ state: 'succeeded', demo: true, credits: quote.totalCredits, attempts: 1, error: null })
      expect(job.result).not.toBeNull()
      spent += quote.totalCredits
    }
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ balance: 10_000 - spent, held: 0 })
    const kinds = t.cloud.wallet.entries(p.teamId).entries.map((e) => e.kind)
    // the two free usages (stock search, channel data: provider cost 0, decision 0105) hold and capture nothing
    expect(kinds.filter((k) => k === 'capture')).toHaveLength(USAGES.length - 2)
    expect(Object.keys(FAKE_ADAPTERS).sort()).toEqual([...USAGES].sort())
  })

  it('the fake voice is the real sample mp3 with word timings; fake images are valid PNGs', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const voice = await quoteAndRun(t, p, 'synthesize', INPUTS.synthesize as Record<string, unknown>)
    const art = voice.job.artefacts[0] as { sha256: string; size: number }
    const mp3 = readFileSync(FAKE_VOICE_FILE)
    expect(art.sha256).toBe(createHash('sha256').update(mp3).digest('hex'))
    expect(art.size).toBe(mp3.length)
    const words = (voice.job.result as { words: { word: string; start: number; end: number }[] }).words
    expect(words.map((w) => w.word)).toEqual(['Bonjour', 'et', 'bienvenue', 'sur', 'la', 'chaîne.'])
    expect(words[5]?.end).toBe(10)
    const png = drawPng(64, 36, 'x')
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const images = await quoteAndRun(t, p, 'generateImage', INPUTS.generateImage as Record<string, unknown>)
    expect(images.job.artefacts).toHaveLength(2)
  })
})

describe('the event stream', () => {
  it('replays the ordered backlog as server-sent events and ends after the terminal event; Last-Event-ID resumes', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const { job } = await quoteAndRun(t, p, 'synthesize', INPUTS.synthesize as Record<string, unknown>)
    const res = await t.app.inject({ url: `/v1/jobs/${job.id}/events`, headers: p.auth })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    const events = parseSse(res.body)
    expect(events.map((e) => e.event)).toEqual(['queued', 'started', 'progress', 'progress', 'progress', 'artefact', 'succeeded'])
    expect(events.map((e) => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
    for (const e of events) expect(JobEvent.safeParse(e.data).success).toBe(true)
    const resumed = parseSse((await t.app.inject({ url: `/v1/jobs/${job.id}/events`, headers: { ...p.auth, 'last-event-id': '5' } })).body)
    expect(resumed.map((e) => e.id)).toEqual([6, 7])
  })

  it('streams live events of a running job until it ends', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const slowVoice: ProviderAdapter = {
      id: 'fake-voice',
      kind: 'fake',
      async synthesize(input, ctx) {
        ctx.progress(0.5, 'à mi-chemin')
        await gate
        return FAKE_ADAPTERS.synthesize.synthesize?.(input, ctx) as never
      }
    }
    const t = makeCloud({ fakes: { synthesize: slowVoice } })
    const p = await signUpAndIn(t, { credits: 1000 })
    const q = (await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'synthesize', input: INPUTS.synthesize } })).json() as { id: string }
    const j = (await t.app.inject({ method: 'POST', url: '/v1/jobs', headers: p.auth, payload: { quoteId: q.id, idempotencyKey: 'live-stream-1' } })).json() as { id: string }
    const stream = t.app.inject({ url: `/v1/jobs/${j.id}/events`, headers: p.auth })
    setTimeout(release, 20)
    const events = parseSse((await stream).body)
    expect(events[0]?.event).toBe('queued')
    expect(events.at(-1)?.event).toBe('succeeded')
    expect(events.find((e) => e.event === 'progress')?.data).toMatchObject({ data: { fraction: 0.5, note: 'à mi-chemin' } })
  })
})

describe('cancel, retry, idempotency, money', () => {
  it('cancelling a running job releases its credits; a cancelled job stays cancelled', async () => {
    const hanging: ProviderAdapter = {
      id: 'fake-video',
      kind: 'fake',
      generateVideo: (_input, ctx) =>
        new Promise((_resolve, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    }
    const t = makeCloud({ fakes: { generateVideo: hanging } })
    const p = await signUpAndIn(t, { credits: 1000 })
    const q = (await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'generateVideo', input: INPUTS.generateVideo } })).json() as { id: string; totalCredits: number }
    const j = (await t.app.inject({ method: 'POST', url: '/v1/jobs', headers: p.auth, payload: { quoteId: q.id, idempotencyKey: 'cancel-me-1' } })).json() as { id: string }
    await new Promise((r) => setTimeout(r, 10))
    expect(t.cloud.wallet.state(p.teamId).held).toBe(q.totalCredits)
    const c = await t.app.inject({ method: 'POST', url: `/v1/jobs/${j.id}/cancel`, headers: p.auth })
    expect(c.statusCode).toBe(200)
    await t.cloud.jobs.whenIdle()
    const after = (await t.app.inject({ url: `/v1/jobs/${j.id}`, headers: p.auth })).json() as { state: string }
    expect(after.state).toBe('cancelled')
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ balance: 1000, held: 0 })
    const again = (await t.app.inject({ method: 'POST', url: `/v1/jobs/${j.id}/cancel`, headers: p.auth })).json() as { state: string }
    expect(again.state).toBe('cancelled')
  })

  it('retries a retryable provider error 3 times in all, then fails and releases the credits', async () => {
    let calls = 0
    const flaky: ProviderAdapter = {
      id: 'fake-image',
      kind: 'fake',
      async generateImage() {
        calls++
        throw new RetryableProviderError('provider busy (503)')
      }
    }
    const t = makeCloud({ fakes: { generateImage: flaky } })
    const p = await signUpAndIn(t, { credits: 1000 })
    const { job } = await quoteAndRun(t, p, 'generateImage', INPUTS.generateImage as Record<string, unknown>)
    expect(calls).toBe(3)
    expect(job).toMatchObject({ state: 'failed', attempts: 3, error: 'provider busy (503)' })
    const events = t.cloud.jobs.events(job.id).map((e) => e.type)
    expect(events).toEqual(['queued', 'started', 'retry', 'started', 'retry', 'started', 'failed'])
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ balance: 1000, held: 0 })
  })

  it('a replayed POST /v1/jobs answers the same job and holds once; another quote under the same key is refused', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const quote = async () => ((await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'channelData', input: INPUTS.channelData } })).json() as { id: string }).id
    const q1 = await quote()
    const post = (quoteId: string, key: string) => t.app.inject({ method: 'POST', url: '/v1/jobs', headers: p.auth, payload: { quoteId, idempotencyKey: key } })
    const a = (await post(q1, 'same-key-123')).json() as { id: string }
    const b = (await post(q1, 'same-key-123')).json() as { id: string }
    expect(b.id).toBe(a.id)
    expect((await post(await quote(), 'same-key-123')).statusCode).toBe(409)
    expect((await post(q1, 'another-key-1')).statusCode).toBe(409)
    await t.cloud.jobs.whenIdle()
    // channelData is free (decision 0105): the replay opens no hold at all, and the wallet is untouched
    expect(t.cloud.wallet.entries(p.teamId).entries.filter((e) => e.kind === 'hold')).toHaveLength(0)
    expect(t.cloud.wallet.state(p.teamId).balance).toBe(1000)
  })

  it('refuses a job above the per-job maximum, and another team’s quote or job', async () => {
    const t = makeCloud({ maxCreditsPerJob: 50 })
    const p = await signUpAndIn(t, { credits: 10_000 })
    const other = await signUpAndIn(t, { credits: 10_000 })
    const big = (await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'generateVideo', input: { prompt: 'x', seconds: 60 } } })).json() as { id: string }
    const r = await t.app.inject({ method: 'POST', url: '/v1/jobs', headers: p.auth, payload: { quoteId: big.id, idempotencyKey: 'too-big-1' } })
    expect(r.statusCode).toBe(402)
    expect((r.json() as { error: { code: string } }).error.code).toBe('cap_exceeded')
    const stolen = await t.app.inject({ method: 'POST', url: '/v1/jobs', headers: other.auth, payload: { quoteId: big.id, idempotencyKey: 'stolen-1' } })
    expect(stolen.statusCode).toBe(404)
    const { job } = await quoteAndRun(t, p, 'channelData', INPUTS.channelData as Record<string, unknown>)
    expect((await t.app.inject({ url: `/v1/jobs/${job.id}`, headers: other.auth })).statusCode).toBe(404)
    expect((await t.app.inject({ url: `/v1/jobs/${job.id}/events`, headers: other.auth })).statusCode).toBe(404)
    // An avatar may only be driven by this team's own voice file.
    const audioArtefactId = (await t.cloud.storage.put(p.teamId, null, { name: 'voix.wav', mime: 'audio/wav', bytes: wavBytes(5) }, false)).id
    const avatar = { usage: 'talkingAvatar', input: { avatarId: 'demo-avatar', seconds: 5, audioArtefactId } }
    expect((await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: other.auth, payload: avatar })).statusCode).toBe(404)
    expect((await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: avatar })).statusCode).toBe(200)
  })

  it('after a restart, queued jobs run again and a job cut off mid-run fails with its credits released', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const { job } = await quoteAndRun(t, p, 'channelData', INPUTS.channelData as Record<string, unknown>)
    const hold = t.cloud.wallet.hold({ teamId: p.teamId, accountId: p.accountId, credits: 5, idemKey: 'crash-hold' })
    t.cloud.db.prepare(`UPDATE jobs SET state = 'running', hold_id = ? WHERE id = ?`).run(hold.holdId, job.id)
    t.cloud.jobs.recover()
    expect(t.cloud.jobs.state(job.id)).toBe('failed')
    expect(t.cloud.wallet.holdState(hold.holdId)).toBe('released')
  })
})

describe('signed download links (§4.8)', () => {
  it('a 15-minute link gives the bytes; tampered, expired or foreign links are refused', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const other = await signUpAndIn(t)
    const { job } = await quoteAndRun(t, p, 'synthesize', INPUTS.synthesize as Record<string, unknown>)
    const artefactId = (job.artefacts[0] as { id: string }).id
    const link = (await t.app.inject({ url: `/v1/artefacts/${artefactId}`, headers: p.auth })).json() as { url: string; expiresAt: string }
    const path = link.url.replace('http://localhost:80', '')
    const file = await t.app.inject({ url: path })
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toBe('audio/mpeg')
    expect(file.headers['content-disposition']).toBe('attachment; filename="voice.mp3"')
    expect(file.rawPayload.equals(readFileSync(FAKE_VOICE_FILE))).toBe(true)
    expect((await t.app.inject({ url: path.replace(/sig=[^&]+/, 'sig=AAAA') })).statusCode).toBe(403)
    expect((await t.app.inject({ url: path.replace(/exp=\d+/, (m) => `exp=${Number(m.slice(4)) + 3600}`) })).statusCode).toBe(403)
    expect((await t.app.inject({ url: `/files/${artefactId}` })).statusCode).toBe(403)
    expect((await t.app.inject({ url: `/v1/artefacts/${artefactId}`, headers: other.auth })).statusCode).toBe(404)
    t.clock.advance(15 * 60_000)
    expect((await t.app.inject({ url: path })).statusCode).toBe(410)
  })
})

describe('the paidCalls guard: no real adapter can be reached in tests', () => {
  const spyReal = (calls: string[]): ProviderAdapter => ({
    id: 'real-voice-spy',
    kind: 'real',
    secretName: 'ELEVENLABS_API_KEY',
    async synthesize() {
      calls.push('called')
      throw new Error('a real adapter was reached')
    }
  })

  it('ships no real adapter, and paidCalls is off by default', () => {
    expect(REAL_ADAPTERS).toEqual([])
    expect(CloudConfigFile.parse({}).paidCalls).toBe('off')
    expect(isTestRun(process.env)).toBe(true)
  })

  it('even with paidCalls on, the key in the vault and a real adapter registered, a test run uses the fake', async () => {
    const calls: string[] = []
    const t = makeCloud({ paidCalls: true, realAdapters: [spyReal(calls)] })
    t.cloud.vault.set('ELEVENLABS_API_KEY', 'sk-test-guard-0001', 'test')
    const p = await signUpAndIn(t, { credits: 1000 })
    const catalog = (await t.app.inject({ url: '/v1/catalog', headers: p.auth })).json() as { paidCalls: boolean; providers: { usage: string; status: string; reason: string }[] }
    expect(catalog.paidCalls).toBe(true)
    expect(catalog.providers.every((x) => x.status === 'demo')).toBe(true)
    expect(catalog.providers.find((x) => x.usage === 'synthesize')?.reason).toBe('tests never reach a real adapter')
    const { job } = await quoteAndRun(t, p, 'synthesize', INPUTS.synthesize as Record<string, unknown>)
    expect(job).toMatchObject({ state: 'succeeded', demo: true })
    expect(calls).toEqual([])
    expect(t.cloud.audit.list().some((e) => e.action === 'vault.read')).toBe(false)
  })

  it('outside tests the guard opens only with paidCalls on, a real adapter and its key; it is checked again at call time', () => {
    const calls: string[] = []
    const t = makeCloud()
    const real = spyReal(calls)
    const prod = { NODE_ENV: 'production' }
    const reg = (paidCalls: boolean) => new ProviderRegistry({ paidCalls, vault: t.cloud.vault, real: [real], env: prod })
    expect(reg(false).resolve('synthesize')).toMatchObject({ status: 'demo', reason: 'paidCalls is off' })
    expect(reg(true).resolve('synthesize')).toMatchObject({ status: 'demo', reason: 'the platform key is not in the vault' })
    t.cloud.vault.set('ELEVENLABS_API_KEY', 'sk-test-guard-0002', 'test')
    expect(reg(true).resolve('synthesize')).toMatchObject({ status: 'real', adapter: real })
    expect(reg(true).resolve('generateImage')).toMatchObject({ status: 'demo', reason: 'no real adapter in this version' })
    expect(() => reg(false).assertCallable(real)).toThrow(PaidCallBlocked)
    expect(() => new ProviderRegistry({ paidCalls: true, vault: t.cloud.vault, real: [real] }).assertCallable(real)).toThrow(/test run/)
    expect(() => reg(true).assertCallable(FAKE_ADAPTERS.synthesize)).not.toThrow()
    expect(calls).toEqual([])
  })
})
