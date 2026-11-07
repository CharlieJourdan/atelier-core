// Which adapter serves a usage (config → registry → job), the paidCalls guard with the real adapters, the secret staying out
// of everything a job or the CLI shows, and the configuration file. Real adapters here only ever see a fake fetch.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.ts'
import { CloudConfigFile, loadConfig } from '../src/config.ts'
import { elevenlabsAdapter } from '../src/providers/elevenlabs.ts'
import { geminiAdapter } from '../src/providers/gemini.ts'
import { hedraAdapter } from '../src/providers/hedra.ts'
import { MINIMAX_EXCEPTION_VOICE_IDS } from '../../src/shared/voice-exception.ts'
import { minimaxAdapter } from '../src/providers/minimax.ts'
import { realProviders } from '../src/providers/real.ts'
import { PaidCallBlocked, ProviderRegistry } from '../src/providers/registry.ts'
import { fakeFetch, json } from './fake-fetch.ts'
import { makeCloud, quoteAndRun, signUpAndIn } from './helpers.ts'

const PROD = { NODE_ENV: 'production' } // an environment that is not a test run
const MM_KEY = 'mm-test-SECRET-aa11bb22cc33'
const EL_KEY = 'xi-test-SECRET-dd44ee55ff66'
const GM_KEY = 'AIza-test-SECRET-0a1b2c3d4e'
const hex = (s: string): string => Buffer.from(s).toString('hex')
const minimaxOk = (chars: number) =>
  json({ data: { audio: hex('MP3-BYTES') }, extra_info: { audio_length: 3000, usage_characters: chars }, base_resp: { status_code: 0 } })

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'atelier-cloud-providers-'))
  dirs.push(d)
  return d
}

function io(input = '') {
  const stdin = Object.assign(new PassThrough(), { isTTY: false })
  const out: string[] = []
  const err: string[] = []
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  stdout.on('data', (d) => out.push(String(d)))
  stderr.on('data', (d) => err.push(String(d)))
  if (input) stdin.end(input)
  return { stdin, stdout, stderr, text: () => out.join(''), errors: () => err.join('') }
}

describe('registry: the configuration picks the provider, the guard opens only with paidCalls + the key', () => {
  const adapters = (fetchImpl: typeof fetch) => [minimaxAdapter({ fetchImpl }), elevenlabsAdapter({ fetchImpl }), geminiAdapter({ fetchImpl })]
  const registry = (t: ReturnType<typeof makeCloud>, o: { paidCalls?: boolean; select?: Record<string, string>; env?: NodeJS.ProcessEnv } = {}) =>
    new ProviderRegistry({
      paidCalls: o.paidCalls ?? true,
      vault: t.cloud.vault,
      real: adapters(fakeFetch(() => json({})).fetch),
      select: o.select ?? { synthesize: 'minimax', analyseVideo: 'gemini' },
      env: o.env ?? PROD
    })

  it('serves a usage with the real adapter the config names, and every other usage with its fake', () => {
    const t = makeCloud()
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    t.cloud.vault.set('ELEVENLABS_API_KEY', EL_KEY, 'test')
    t.cloud.vault.set('GEMINI_API_KEY', GM_KEY, 'test')
    expect(registry(t).resolve('synthesize')).toMatchObject({ status: 'real', adapter: { id: 'minimax' }, reason: null })
    expect(registry(t, { select: { synthesize: 'elevenlabs' } }).resolve('synthesize')).toMatchObject({ status: 'real', adapter: { id: 'elevenlabs' } })
    expect(registry(t).resolve('analyseVideo')).toMatchObject({ status: 'real', adapter: { id: 'gemini' } })
    for (const usage of ['generateImage', 'generateVideo', 'talkingAvatar', 'channelData', 'submitGpuJob'] as const) {
      expect(registry(t).resolve(usage), usage).toMatchObject({ status: 'demo', adapter: { kind: 'fake' } })
    }
  })

  it('a usage left on "fake" (or not listed) stays a demo even with paidCalls on and the key in the vault', () => {
    const t = makeCloud()
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    expect(registry(t, { select: { synthesize: 'fake' } }).resolve('synthesize')).toMatchObject({ status: 'demo', reason: 'this usage is set to the fake provider' })
    expect(registry(t, { select: {} }).resolve('synthesize').status).toBe('demo')
  })

  it('an adapter that does not implement the usage, or a name that does not exist, falls back to the fake', () => {
    const t = makeCloud()
    t.cloud.vault.set('GEMINI_API_KEY', GM_KEY, 'test')
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    expect(registry(t, { select: { synthesize: 'gemini' } }).resolve('synthesize')).toMatchObject({ status: 'demo', reason: 'no real adapter gemini for this usage' })
    expect(registry(t, { select: { analyseVideo: 'minimax' } }).resolve('analyseVideo').status).toBe('demo')
    expect(registry(t, { select: { synthesize: 'nope' } }).resolve('synthesize').status).toBe('demo')
  })

  it('paidCalls off, a missing key or a test run each keep it a demo; the key of ANOTHER provider does not count', () => {
    const t = makeCloud()
    expect(registry(t).resolve('synthesize')).toMatchObject({ status: 'demo', reason: 'the platform key is not in the vault' })
    t.cloud.vault.set('ELEVENLABS_API_KEY', EL_KEY, 'test')
    expect(registry(t).resolve('synthesize').status).toBe('demo') // minimax picked, only the ElevenLabs key is set
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    expect(registry(t, { paidCalls: false }).resolve('synthesize')).toMatchObject({ status: 'demo', reason: 'paidCalls is off' })
    expect(registry(t, { env: { VITEST: 'true' } }).resolve('synthesize')).toMatchObject({ status: 'demo', reason: 'tests never reach a real adapter' })
    expect(registry(t).resolve('synthesize').status).toBe('real')
  })

  it('the guard is checked again at call time', () => {
    const t = makeCloud()
    const [mm] = adapters(fakeFetch(() => json({})).fetch)
    expect(() => registry(t, { paidCalls: false }).assertCallable(mm as never)).toThrow(PaidCallBlocked)
    expect(() => registry(t, { env: { ATELIER_CLOUD_TEST: '1' } }).assertCallable(mm as never)).toThrow(/test run/)
    expect(() => registry(t).assertCallable(mm as never)).not.toThrow()
  })

  it('overview lists every usage with its provider and status', () => {
    const t = makeCloud()
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    const o = registry(t).overview()
    expect(o).toHaveLength(10) // the seven usages of before, plus searchStock, cloneVoice and designVoice (production-5)
    expect(o.find((x) => x.usage === 'synthesize')).toMatchObject({ provider: 'minimax', status: 'real' })
    expect(o.find((x) => x.usage === 'analyseVideo')).toMatchObject({ status: 'demo' })
  })
})

describe('a job on a real adapter (fake fetch)', () => {
  const providerOf = (t: ReturnType<typeof makeCloud>, jobId: string): string => (t.cloud.db.prepare('SELECT provider FROM jobs WHERE id = ?').get(jobId) as { provider: string }).provider
  const setup = (fetchImpl: typeof fetch, extra: Parameters<typeof makeCloud>[0] = {}) =>
    makeCloud({ paidCalls: true, env: PROD, realAdapters: [minimaxAdapter({ fetchImpl }), geminiAdapter({ fetchImpl })], providers: { synthesize: 'minimax', analyseVideo: 'gemini' }, ...extra })

  it('runs on MiniMax when the key is in the vault: real (not demo), the key read with an audit line, charged by characters', async () => {
    const text = 'Une phrase assez longue pour la voix. '.repeat(80)
    const f = fakeFetch(() => minimaxOk(1000))
    const t = setup(f.fetch)
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    const p = await signUpAndIn(t, { credits: 10_000 })
    const { quote, job } = await quoteAndRun(t, p, 'synthesize', { text, voiceId: MINIMAX_EXCEPTION_VOICE_IDS[0], wordTimings: false })
    expect(job).toMatchObject({ state: 'succeeded', demo: false, error: null })
    expect(providerOf(t, job.id)).toBe('minimax')
    expect(f.calls[0]?.headers.authorization).toBe(`Bearer ${MM_KEY}`)
    expect(t.cloud.audit.list().some((e) => e.action === 'vault.read' && e.actor === 'adapter:minimax' && e.target === 'MINIMAX_API_KEY')).toBe(true)
    // billed for the 1000 characters used, not the whole quote
    expect(job.credits as number).toBeLessThan(quote.totalCredits)
    expect(t.cloud.wallet.state(p.teamId).held).toBe(0)
    expect(job.artefacts).toHaveLength(1)
  })

  it('stays a demo on the fake while the key is missing, and calls nothing', async () => {
    const f = fakeFetch(() => minimaxOk(5))
    const t = setup(f.fetch)
    const p = await signUpAndIn(t, { credits: 1000 })
    const { job } = await quoteAndRun(t, p, 'synthesize', { text: 'Bonjour à tous.', voiceId: 'demo-claire' })
    expect(job).toMatchObject({ state: 'succeeded', demo: true })
    expect(providerOf(t, job.id)).toBe('fake-voice')
    expect(f.calls).toHaveLength(0)
  })

  it('a test run never reaches the real adapter, even through the full wiring', async () => {
    const f = fakeFetch(() => minimaxOk(5))
    const t = setup(f.fetch, { env: undefined })
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    const p = await signUpAndIn(t, { credits: 1000 })
    const { job } = await quoteAndRun(t, p, 'synthesize', { text: 'Bonjour à tous.', voiceId: 'demo-claire' })
    expect(job).toMatchObject({ demo: true })
    expect(providerOf(t, job.id)).toBe('fake-voice')
    expect(f.calls).toHaveLength(0)
  })

  it('a retryable failure is retried, then succeeds', async () => {
    const f = fakeFetch((_, n) => (n === 1 ? new Response('{}', { status: 503 }) : minimaxOk(14)))
    const t = setup(f.fetch)
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    const p = await signUpAndIn(t, { credits: 1000 })
    const { job } = await quoteAndRun(t, p, 'synthesize', { text: 'Bonjour à tous.', voiceId: MINIMAX_EXCEPTION_VOICE_IDS[0], wordTimings: false })
    expect(job).toMatchObject({ state: 'succeeded', attempts: 2, demo: false })
  })

  it('a fatal failure fails the job at once, refunds the hold, and no output of the job holds the key', async () => {
    const f = fakeFetch(() => new Response(`unauthorized for ${MM_KEY}`, { status: 401 }))
    const t = setup(f.fetch)
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    const p = await signUpAndIn(t, { credits: 1000 })
    const { job } = await quoteAndRun(t, p, 'synthesize', { text: 'Bonjour à tous.', voiceId: MINIMAX_EXCEPTION_VOICE_IDS[0] })
    expect(job).toMatchObject({ state: 'failed', attempts: 1 })
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ balance: 1000, held: 0 })
    const everything = JSON.stringify({ job, events: t.cloud.db.prepare('SELECT * FROM job_events').all(), audit: t.cloud.audit.list(), jobs: t.cloud.db.prepare('SELECT * FROM jobs').all() })
    expect(everything).not.toContain(MM_KEY)
    expect(String(job.error)).toMatch(/401/)
  })

  it('runs the eyes on Gemini the same way', async () => {
    const analysis = {
      summary: 's',
      hook: { text: 'h', endsAtS: 3, technique: 'q' },
      structure: [{ fromS: 0, toS: 3, kind: 'hook', summary: 'x' }],
      pacing: { cutsPerMinute: 10, tempo: 'medium', notes: 'n' },
      shotTypes: ['b-roll'],
      onScreenText: [],
      music: { present: false, mood: '', notes: '' },
      callsToAction: []
    }
    const f = fakeFetch(() =>
      json({ candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 } })
    )
    const t = setup(f.fetch)
    t.cloud.vault.set('GEMINI_API_KEY', GM_KEY, 'test')
    const p = await signUpAndIn(t, { credits: 1000 })
    const { job } = await quoteAndRun(t, p, 'analyseVideo', { url: 'https://youtu.be/dQw4w9WgXcQ', minutes: 5 })
    expect(job).toMatchObject({ state: 'succeeded', demo: false })
    expect(providerOf(t, job.id)).toBe('gemini')
    expect(f.calls[0]?.headers['x-goog-api-key']).toBe(GM_KEY)
    expect(JSON.stringify(job)).not.toContain(GM_KEY)
  })
})

describe('configuration', () => {
  it('every usage defaults to the fake and paidCalls to off', () => {
    const c = CloudConfigFile.parse({})
    expect(c.paidCalls).toBe('off')
    expect(c.providers).toEqual({ synthesize: 'fake', analyseVideo: 'fake', generateImage: 'fake', generateVideo: 'fake', talkingAvatar: 'fake', searchStock: 'fake', channelData: 'fake' })
    expect(c.minimax).toMatchObject({ model: 'speech-2.8-hd', region: 'global' })
    expect(c.gemini.model).toBe('gemini-3.1-flash-lite')
  })

  it('accepts the real providers, refuses an unknown one or an unknown key', () => {
    expect(CloudConfigFile.parse({ providers: { synthesize: 'elevenlabs', analyseVideo: 'gemini' } }).providers.synthesize).toBe('elevenlabs')
    expect(CloudConfigFile.safeParse({ providers: { synthesize: 'openai' } }).success).toBe(false)
    expect(CloudConfigFile.safeParse({ providers: { analyseVideo: 'minimax' } }).success).toBe(false)
    expect(CloudConfigFile.safeParse({ providers: { generateImage: 'minimax' } }).success).toBe(false)
    expect(CloudConfigFile.safeParse({ minimax: { apiKey: 'sk-nope' } }).success).toBe(false)
    expect(CloudConfigFile.safeParse({ minimax: { model: 'speech-9' } }).success).toBe(false)
  })

  it('cloud/config.example.json is valid, has no secret, and keeps paidCalls off', () => {
    const raw = readFileSync(join(import.meta.dirname, '..', 'config.example.json'), 'utf8')
    const parsed = CloudConfigFile.parse(JSON.parse(raw))
    expect(parsed.paidCalls).toBe('off')
    expect(parsed.providers).toEqual({ synthesize: 'minimax', analyseVideo: 'gemini', generateImage: 'gemini', generateVideo: 'fal', talkingAvatar: 'hedra', searchStock: 'pexels', channelData: 'youtube' })
    expect(raw).not.toMatch(/sk-|AIza|api[_-]?key/i)
  })

  it('loadConfig reads config.json from the data folder, and realProviders builds the adapters from it', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ paidCalls: 'on', providers: { synthesize: 'elevenlabs' }, elevenlabs: { model: 'eleven_flash_v2_5' } }))
    const cfg = loadConfig(dir, {})
    expect(cfg.paidCalls).toBe('on')
    const real = realProviders(cfg)
    // cloning follows the voice provider and only MiniMax clones: with ElevenLabs it stays a demo
    expect(real.select).toEqual({ synthesize: 'elevenlabs', analyseVideo: 'fake', generateImage: 'fake', generateVideo: 'fake', talkingAvatar: 'fake', searchStock: 'fake', channelData: 'fake', cloneVoice: 'fake' })
    expect(real.adapters.map((a) => [a.id, a.secretName])).toEqual([
      ['minimax', 'MINIMAX_API_KEY'],
      ['elevenlabs', 'ELEVENLABS_API_KEY'],
      ['gemini', 'GEMINI_API_KEY'],
      ['fal', 'FAL_KEY'],
      ['hedra', 'HEDRA_API_KEY'],
      ['pexels', 'PEXELS_API_KEY'],
      ['pixabay', 'PIXABAY_API_KEY'],
      ['youtube', 'YOUTUBE_API_KEY'],
      ['wikimedia', undefined],
      // production-5: one adapter per voice engine, its id the engine id (decision 0029); none is enabled by default
      ['voice:elevenlabs-v2', 'ELEVENLABS_API_KEY'],
      ['voice:minimax-28-hd', 'MINIMAX_API_KEY'],
      ['voice:fish-s2', 'FISH_API_KEY'],
      ['voice:ai33', 'AI33_API_KEY'],
      // production-7: one adapter per presenter engine, its id the engine id (decision 0034); none is enabled by default
      ['presenter:heygen-avatar4', 'HEYGEN_API_KEY'],
      ['presenter:hedra-c3', 'HEDRA_API_KEY'],
      ['presenter:kling-avatar2-std', 'FAL_KEY'],
      ['presenter:infinitetalk-fast', 'WAVESPEED_API_KEY'],
      ['presenter:infinitetalk-gpu', 'RUNPOD_API_KEY'],
      // production-10 (decision 0039): Charlie's fallbacks, and HeyGen on its plan through its MCP server (an OAuth sign-in)
      ['presenter:infinitetalk-std', 'WAVESPEED_API_KEY'],
      ['presenter:pruna-avatar', 'WAVESPEED_API_KEY'],
      ['presenter:kling-avatar-kie', 'KIE_API_KEY'],
      ['presenter:heygen-mcp', 'HEYGEN_MCP_OAUTH'],
      // production-8: one adapter per still and clip engine, its id the engine id (decision 0035); none is enabled by default
      ['image:gpt-image-25-low', 'OPENAI_API_KEY'],
      ['image:gpt-image-25-medium', 'OPENAI_API_KEY'],
      ['image:gpt-image-25-high', 'OPENAI_API_KEY'],
      ['image:gpt-image-25-fal-low', 'FAL_KEY'],
      ['image:gpt-image-25-fal-medium', 'FAL_KEY'],
      ['image:gpt-image-25-kie', 'KIE_API_KEY'],
      ['image:flux-schnell', 'FAL_KEY'],
      ['image:nano-banana-2', 'GEMINI_API_KEY'],
      ['clip:wan22', 'FAL_KEY'],
      ['clip:minimax-h3-lite', 'MINIMAX_API_KEY'],
      ['clip:veo31-lite-vertex', 'VERTEX_SERVICE_ACCOUNT_JSON'],
      ['clip:veo31-lite-relaxed', 'UNIFICALLY_API_KEY'],
      ['clip:veo31-lite', 'UNIFICALLY_API_KEY'],
      ['clip:veo31-fast', 'UNIFICALLY_API_KEY'],
      ['clip:veo31-fast-1080p', 'UNIFICALLY_API_KEY'],
      ['clip:veo31-lite-kie', 'KIE_API_KEY'],
      ['image:flux3-klein', 'UNIFICALLY_API_KEY'],
      ['image:z-image-turbo', 'UNIFICALLY_API_KEY'],
      ['image:nano-banana-2-lite', 'UNIFICALLY_API_KEY'],
      ['image:nano-banana-21', 'UNIFICALLY_API_KEY'],
      ['image:seedream-50-lite', 'UNIFICALLY_API_KEY'],
      ['clip:grok-imagine-15-lite', 'UNIFICALLY_API_KEY'],
      ['clip:seedance-20-mini-480p', 'UNIFICALLY_API_KEY'],
      ['clip:seedance-20-mini', 'UNIFICALLY_API_KEY'],
      ['clip:seedance-15-pro', 'UNIFICALLY_API_KEY'],
      ['clip:hailuo-23-fast', 'UNIFICALLY_API_KEY'],
      ['clip:kling-25-turbo', 'UNIFICALLY_API_KEY']
    ])
    expect(real.engines).toEqual([])
    expect(real.adapters.every((a) => a.kind === 'real')).toBe(true)
  })
})

describe('atelier-cloud providers', () => {
  it('status shows each usage, its provider and why it is a demo', async () => {
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [minimaxAdapter({ fetchImpl: fakeFetch(() => json({})).fetch })], providers: { synthesize: 'minimax' } })
    const a = io()
    expect(await runCli(['providers', 'status'], { ...a, env: {}, cloud: t.cloud })).toBe(0)
    expect(a.text()).toContain('paidCalls: ON')
    expect(a.text()).toMatch(/synthesize\tfake-voice\tdemo\t\(the platform key is not in the vault; configured: minimax\)/)
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    const b = io()
    await runCli(['providers', 'status'], { ...b, env: {}, cloud: t.cloud })
    expect(b.text()).toMatch(/synthesize\tminimax\treal/)
    expect(b.text()).toMatch(/analyseVideo\tfake-analysis\tdemo/)
    expect(b.text()).not.toContain(MM_KEY)
  })

  it('status says talkingAvatar is a demo until Hedra is configured, paidCalls is on and HEDRA_API_KEY is in the vault; then it is real', async () => {
    const unconfigured = makeCloud({ paidCalls: true, env: PROD, realAdapters: [hedraAdapter({ fetchImpl: fakeFetch(() => json({})).fetch })], providers: { talkingAvatar: 'fake' } })
    const a = io()
    await runCli(['providers', 'status'], { ...a, env: {}, cloud: unconfigured.cloud })
    expect(a.text()).toContain('talkingAvatar\tfake-avatar\tdemo\t(this usage is set to the fake provider)')
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [hedraAdapter({ fetchImpl: fakeFetch(() => json({})).fetch })], providers: { talkingAvatar: 'hedra' } })
    const b = io()
    await runCli(['providers', 'status'], { ...b, env: {}, cloud: t.cloud })
    expect(b.text()).toContain('talkingAvatar\tfake-avatar\tdemo\t(the platform key is not in the vault; configured: hedra)')
    t.cloud.vault.set('HEDRA_API_KEY', 'hedra-test-SECRET-1234567890', 'test')
    const c = io()
    await runCli(['providers', 'status'], { ...c, env: {}, cloud: t.cloud })
    expect(c.text()).toContain('talkingAvatar\thedra\treal')
    expect(c.text()).not.toContain('hedra-test-SECRET')
  })

  it('try refuses unless the usage is live, and does not call anything', async () => {
    const f = fakeFetch(() => minimaxOk(5))
    const t = makeCloud({ paidCalls: false, env: PROD, realAdapters: [minimaxAdapter({ fetchImpl: f.fetch })], providers: { synthesize: 'minimax' } })
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    const a = io()
    expect(await runCli(['providers', 'try', 'synthesize', '--voice', 'v1'], { ...a, env: {}, cloud: t.cloud })).toBe(1)
    expect(a.errors()).toContain('not live: paidCalls is off')
    expect(f.calls).toHaveLength(0)
  })

  it('try makes ONE small call, writes the audio, prints the provider cost, and caps the size', async () => {
    const f = fakeFetch(() => minimaxOk(38))
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [minimaxAdapter({ fetchImpl: f.fetch })], providers: { synthesize: 'minimax' } })
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    const out = join(tmp(), 'try.mp3')
    const a = io()
    expect(await runCli(['providers', 'try', 'synthesize', '--voice', 'French_Narrator', '--out', out], { ...a, env: {}, cloud: t.cloud })).toBe(0)
    expect(f.calls).toHaveLength(1)
    expect(readFileSync(out).toString()).toBe('MP3-BYTES')
    expect(a.text()).toMatch(/minimax: ok, provider cost \$0\.003800/)
    expect(a.text() + a.errors()).not.toContain(MM_KEY)
    expect(t.cloud.audit.list().some((e) => e.action === 'provider.try')).toBe(true)
    const big = io()
    expect(await runCli(['providers', 'try', 'synthesize', '--voice', 'v', '--text', 'x'.repeat(300)], { ...big, env: {}, cloud: t.cloud })).toBe(1)
    expect(big.errors()).toContain('limited to 200 characters')
    expect(f.calls).toHaveLength(1)
  })

  it('try --engine serves the try by that voice engine (listed in realEngines), not by the usage provider', async () => {
    const f = fakeFetch(() => minimaxOk(12))
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [minimaxAdapter({ id: 'voice:minimax-28-hd', fetchImpl: f.fetch })], engines: ['voice:minimax-28-hd'], providers: { synthesize: 'fake' } })
    t.cloud.vault.set('MINIMAX_API_KEY', MM_KEY, 'test')
    const off = io()
    expect(await runCli(['providers', 'try', 'synthesize', '--voice', 'v'], { ...off, env: {}, cloud: t.cloud })).toBe(1)
    expect(off.errors()).toContain('set to the fake provider')
    const on = io()
    expect(await runCli(['providers', 'try', 'synthesize', '--voice', 'clone_1', '--engine', 'voice:minimax-28-hd', '--out', join(tmp(), 'e.mp3')], { ...on, env: {}, cloud: t.cloud })).toBe(0)
    expect(on.text()).toMatch(/voice:minimax-28-hd: ok, provider cost/)
    expect(f.calls).toHaveLength(1)
  })
})
