// production-5 (voice, decision 0029): a voice job that names an engine is served by that engine's adapter (or its fake),
// a clone needs the consent tick, voice design makes previews then keeps one, and the new adapters (ElevenLabs design and
// clone, Fish Audio, ai33.pro / OpenSpeaker) send what their public docs describe, against a fake fetch. Never the network.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CloneVoiceInput, DesignVoiceInput, SynthesizeInput } from '../../src/shared/cloud-api.ts'
import { CloudConfigFile } from '../src/config.ts'
import { ai33Adapter, AI33_USD_PER_CREDIT } from '../src/providers/ai33.ts'
import { elevenlabsVoiceMaking } from '../src/providers/elevenlabs-voices.ts'
import { FAKE_ENGINES } from '../src/providers/engines.ts'
import { fakeCloneId, FAKE_VOICE_FILE } from '../src/providers/fakes.ts'
import { fishAdapter, fishCostUsd } from '../src/providers/fish.ts'
import { realProviders } from '../src/providers/real.ts'
import { runUsage, type ProviderAdapter, type ProviderContext } from '../src/providers/types.ts'
import { REAL_VOICE_ENGINES, voiceEngineAdapters } from '../src/providers/voice-engines.ts'
import { ctxFor, fakeFetch, json } from './fake-fetch.ts'
import { makeCloud, quoteAndRun, signUpAndIn } from './helpers.ts'

const KEY = 'voice-test-SECRET-7c1e2a9b'
const PROD = { NODE_ENV: 'production' }
const CLIP_URL = 'https://cloud.example/files/art_clip?exp=1&sig=abc'
const MP3 = readFileSync(FAKE_VOICE_FILE)

const withClip = (o: Partial<ProviderContext> = {}): ProviderContext => ({
  ...ctxFor(KEY),
  artefact: (id) => {
    if (id !== 'art_clip') throw new Error('not found')
    return { name: 'voix.mp3', url: CLIP_URL }
  },
  ...o
})

describe('the contract', () => {
  it('a voice job may name a voice engine; anything else is refused', () => {
    expect(SynthesizeInput.parse({ text: 'Bonjour', voiceId: 'v', engine: 'voice:fish-s2' }).engine).toBe('voice:fish-s2')
    expect(SynthesizeInput.safeParse({ text: 'Bonjour', voiceId: 'v', engine: 'clip:wan22' }).success).toBe(false)
    expect(CloneVoiceInput.safeParse({ audioArtefactId: 'a', name: 'n', consent: true, engine: 'voice:ai33' }).success).toBe(true)
  })
  it('voice design asks for a real description; keeping names the preview', () => {
    expect(DesignVoiceInput.safeParse({ description: 'trop court' }).success).toBe(false)
    const d = DesignVoiceInput.parse({ description: 'Une voix grave et calme de conteur, débit posé.', keep: { generatedVoiceId: 'g1', name: 'Conteur' } })
    expect(d).toMatchObject({ language: 'fr', keep: { generatedVoiceId: 'g1', name: 'Conteur' } })
  })
  it('every real voice engine is declared in the engines registry; config.json takes only those in realEngines', () => {
    for (const id of REAL_VOICE_ENGINES) expect(FAKE_ENGINES.find((e) => e.id === id)).toMatchObject({ family: 'voice', usage: 'synthesize' })
    expect(voiceEngineAdapters().map((a) => a.id)).toEqual([...REAL_VOICE_ENGINES])
  })
})

describe('routing by engine', () => {
  it('without paidCalls, or with the engine left out of realEngines, a named engine is served by the fake', async () => {
    const f = fakeFetch(() => new Response(MP3))
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [fishAdapter({ id: 'voice:fish-s2', fetchImpl: f.fetch })], engines: [] })
    t.cloud.vault.set('FISH_API_KEY', KEY, 'test')
    expect(t.cloud.registry.resolveFor('synthesize', { engine: 'voice:fish-s2' })).toMatchObject({ status: 'demo', reason: expect.stringMatching(/not enabled/) })
    const p = await signUpAndIn(t, { credits: 10_000 })
    const { job } = await quoteAndRun(t, p, 'synthesize', { text: 'Bonjour à tous.', voiceId: 'fish-1', engine: 'voice:fish-s2' })
    expect(job).toMatchObject({ state: 'succeeded', demo: true })
    expect(f.calls).toHaveLength(0)
  })

  it('with paidCalls, the engine in realEngines and its key, the job runs on that engine’s adapter (and nothing else changes)', async () => {
    const f = fakeFetch(() => new Response(MP3))
    const t = makeCloud({
      paidCalls: true,
      env: PROD,
      realAdapters: [fishAdapter({ id: 'voice:fish-s2', fetchImpl: f.fetch })],
      providers: { synthesize: 'fake' },
      engines: ['voice:fish-s2']
    })
    t.cloud.vault.set('FISH_API_KEY', KEY, 'test')
    const p = await signUpAndIn(t, { credits: 10_000 })
    const { job } = await quoteAndRun(t, p, 'synthesize', { text: 'Bonjour à tous.', voiceId: 'fish-1', engine: 'voice:fish-s2' })
    expect(job).toMatchObject({ state: 'succeeded', demo: false })
    expect((t.cloud.db.prepare('SELECT provider FROM jobs WHERE id = ?').get(job.id) as { provider: string }).provider).toBe('voice:fish-s2')
    expect(f.calls).toHaveLength(1)
    // the usage without an engine stays on its configured provider (the fake here)
    const plain = await quoteAndRun(t, p, 'synthesize', { text: 'Bonjour à tous.', voiceId: 'demo-claire' })
    expect(plain.job).toMatchObject({ state: 'succeeded', demo: true })
    expect(f.calls).toHaveLength(1)
  })

  it('a quote that names an unknown engine is refused', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const r = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'synthesize', input: { text: 'x', voiceId: 'v', engine: 'voice:nobody' } } })
    expect(r.statusCode).toBe(400)
    expect(r.body).toMatch(/unknown voice engine/)
  })

  it('config.json lists the engines that may be real; an unknown one is refused', () => {
    const cfg = CloudConfigFile.parse({ realEngines: ['voice:ai33'] })
    expect(realProviders(cfg).engines).toEqual(['voice:ai33'])
    expect(CloudConfigFile.parse({}).realEngines).toEqual([])
    expect(CloudConfigFile.safeParse({ realEngines: ['voice:nobody'] }).success).toBe(false)
  })
})

describe('cloning on an engine, with consent; designing a voice (fakes)', () => {
  it('a clone without the consent tick is refused at the quote; with it, each engine gets its own clone of the voice', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 10_000 })
    const clip = await t.cloud.storage.put(p.teamId, null, { name: 'ma-voix.mp3', mime: 'audio/mpeg', bytes: MP3 }, false)
    const refused = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'cloneVoice', input: { audioArtefactId: clip.id, name: 'Marie' } } })
    expect(refused.statusCode).toBe(400)
    expect(refused.body).toMatch(/consent/)

    const a = await quoteAndRun(t, p, 'cloneVoice', { audioArtefactId: clip.id, name: 'Marie', consent: true, engine: 'voice:elevenlabs-v2' })
    const b = await quoteAndRun(t, p, 'cloneVoice', { audioArtefactId: clip.id, name: 'Marie', consent: true, engine: 'voice:fish-s2' })
    const idA = (a.job.result as { voiceId: string }).voiceId
    const idB = (b.job.result as { voiceId: string }).voiceId
    expect(idA).toBe(fakeCloneId(clip.id, 'Marie', 'voice:elevenlabs-v2'))
    expect(idB).not.toBe(idA)
    expect(a.job.result).toMatchObject({ engine: 'voice:elevenlabs-v2' })
  })

  it('design: one request gives three previews to listen to (files), keep saves one as a voice', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 10_000 })
    const description = 'Une voix de femme posée et chaleureuse, pour raconter des histoires vraies.'
    const { quote, job } = await quoteAndRun(t, p, 'designVoice', { description, engine: 'voice:elevenlabs-v2' })
    expect(quote.totalCredits).toBeGreaterThan(1)
    expect(job).toMatchObject({ state: 'succeeded', demo: true })
    expect(job.artefacts).toHaveLength(3)
    const previews = (job.result as { previews: { generatedVoiceId: string; file: string }[] }).previews
    expect(previews.map((x) => x.file)).toEqual(['preview-1.wav', 'preview-2.wav', 'preview-3.wav'])
    const kept = await quoteAndRun(t, p, 'designVoice', { description, engine: 'voice:elevenlabs-v2', keep: { generatedVoiceId: previews[1]?.generatedVoiceId, name: 'Conteuse' } })
    expect(kept.quote.totalCredits).toBe(1) // saving a preview has no provider price: the one-credit minimum
    expect(kept.job.result).toMatchObject({ name: 'Conteuse', voiceId: expect.stringMatching(/^designed-/) })
  })
})

// ---- adapters against a fake fetch ----------------------------------------------------------------------------------

describe('ElevenLabs voice design and clone', () => {
  const adapter = (f: ReturnType<typeof fakeFetch>): ProviderAdapter => ({ id: 'voice:elevenlabs-v2', kind: 'real', ...elevenlabsVoiceMaking({ fetchImpl: f.fetch }) })
  const audio = Buffer.from('preview-audio').toString('base64')

  it('design posts the description to /v1/text-to-voice/design and returns each preview as a file', async () => {
    const f = fakeFetch(() => json({ previews: [{ generated_voice_id: 'g1', audio_base_64: audio, duration_secs: 4.2 }, { generated_voice_id: 'g2', audio_base_64: audio }], text: 'x'.repeat(120) }))
    const out = await runUsage(adapter(f), 'designVoice', { description: 'Une voix grave et calme de conteur.', language: 'fr' }, ctxFor(KEY))
    expect(f.calls[0]).toMatchObject({ method: 'POST', url: 'https://api.elevenlabs.io/v1/text-to-voice/design' })
    expect(f.calls[0]?.headers['xi-api-key']).toBe(KEY)
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toEqual({ voice_description: 'Une voix grave et calme de conteur.', model_id: 'eleven_multilingual_ttv_v2', auto_generate_text: true })
    expect(out.files.map((x) => x.name)).toEqual(['preview-1.mp3', 'preview-2.mp3'])
    expect(out.data).toMatchObject({ previews: [{ generatedVoiceId: 'g1', durationS: 4.2 }, { generatedVoiceId: 'g2', durationS: null }] })
    expect(out.costUsd).toBeCloseTo(0.0096, 6) // 120 characters at USD 0.08 per 1 000
    expect(out.measure).toEqual([{ item: 'voice.design', quantity: 1 }])
  })

  it('keep saves the preview through /v1/text-to-voice', async () => {
    const f = fakeFetch(() => json({ voice_id: 'voice-123' }))
    const out = await runUsage(adapter(f), 'designVoice', { description: 'Une voix grave et calme de conteur.', language: 'fr', keep: { generatedVoiceId: 'g2', name: 'Conteur' } }, ctxFor(KEY))
    expect(f.calls[0]?.url).toBe('https://api.elevenlabs.io/v1/text-to-voice')
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toEqual({ voice_name: 'Conteur', voice_description: 'Une voix grave et calme de conteur.', generated_voice_id: 'g2' })
    expect(out.data).toEqual({ voiceId: 'voice-123', name: 'Conteur' })
  })

  it('clone downloads the sample without the key and posts it to /v1/voices/add', async () => {
    const f = fakeFetch((req) => (req.url === CLIP_URL ? new Response(MP3) : json({ voice_id: 'ivc-1', requires_verification: false })))
    const out = await runUsage(adapter(f), 'cloneVoice', { audioArtefactId: 'art_clip', name: 'Marie', language: 'fr', consent: true }, withClip())
    expect(f.calls.map((c) => c.url)).toEqual([CLIP_URL, 'https://api.elevenlabs.io/v1/voices/add'])
    expect(f.calls[0]?.headers['xi-api-key']).toBeUndefined()
    expect(f.calls[1]?.form).toMatchObject({ name: 'Marie', remove_background_noise: 'false', files: { name: 'voix.mp3', type: 'audio/mpeg' } })
    expect(out.data).toMatchObject({ voiceId: 'ivc-1', name: 'Marie' })
  })
})

describe('Fish Audio', () => {
  it('speaks through /v1/tts with the s2-pro model header and the clone as reference_id; prices the UTF-8 bytes', async () => {
    const f = fakeFetch(() => new Response(MP3))
    const text = 'Le phare était là, immobile.'
    const out = await runUsage(fishAdapter({ fetchImpl: f.fetch }), 'synthesize', { text, voiceId: 'fish-model-1', wordTimings: true }, ctxFor(KEY))
    expect(f.calls[0]).toMatchObject({ method: 'POST', url: 'https://api.fish.audio/v1/tts' })
    expect(f.calls[0]?.headers).toMatchObject({ authorization: `Bearer ${KEY}`, model: 's2-pro' })
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toMatchObject({ text, reference_id: 'fish-model-1', format: 'mp3' })
    expect(out.data).toMatchObject({ words: [], wordTimings: 'unavailable' })
    expect(out.costUsd).toBeCloseTo(fishCostUsd(text), 9)
    expect(fishCostUsd('é')).toBeCloseTo(2 * 15e-6, 12) // an accented letter is two bytes
  })

  it('clones by creating a private fast model; the answer’s _id is the voice', async () => {
    const f = fakeFetch((req) => (req.url === CLIP_URL ? new Response(MP3) : json({ _id: 'fm-42', state: 'trained' }, 201)))
    const out = await runUsage(fishAdapter({ fetchImpl: f.fetch }), 'cloneVoice', { audioArtefactId: 'art_clip', name: 'Marie', language: 'fr', consent: true }, withClip())
    expect(f.calls[1]?.url).toBe('https://api.fish.audio/model')
    expect(f.calls[1]?.form).toMatchObject({ type: 'tts', title: 'Marie', train_mode: 'fast', visibility: 'private', voices: { name: 'voix.mp3' } })
    expect(out.data).toMatchObject({ voiceId: 'fm-42' })
  })

  it('a refused key is fatal and never quoted in the message', async () => {
    const f = fakeFetch(() => json({ status: 401, message: `bad key ${KEY}` }, 401))
    const err = (await runUsage(fishAdapter({ fetchImpl: f.fetch }), 'synthesize', { text: 'x', voiceId: 'v', wordTimings: false }, ctxFor(KEY)).catch((e: unknown) => e)) as Error
    expect(err.message).toMatch(/401/)
    expect(err.message).not.toContain(KEY)
  })
})

describe('ai33.pro (OpenSpeaker)', () => {
  const AUDIO_URL = 'https://cdn.openspeaker.example/out/t1.mp3'
  function api(o: { status?: string[] } = {}) {
    const states = [...(o.status ?? ['doing', 'done'])]
    return fakeFetch((req) => {
      if (req.url.endsWith('/v3/text-to-speech')) return json({ success: true, task_id: 't1' })
      if (req.url.endsWith('/v1/task/t1')) return json({ id: 't1', status: states.shift() ?? 'done', credit_cost: 3000, metadata: { audio_url: AUDIO_URL } })
      if (req.url === AUDIO_URL) return new Response(MP3)
      if (req.url === CLIP_URL) return new Response(MP3)
      if (req.url.endsWith('/v3/text-to-speech/voice-clone')) return json({ success: true, data: { voice_id: 987 } })
      return new Response('unexpected', { status: 404 })
    })
  }

  it('creates a task, keeps its id with the job, polls it, and downloads the audio without the key; cost from credit_cost', async () => {
    const f = api()
    let ref: string | null = null
    const ctx = { ...ctxFor(KEY), providerRef: () => ref, setProviderRef: (r: string | null) => void (ref = r) }
    const out = await runUsage(ai33Adapter({ fetchImpl: f.fetch, pollMs: 1 }), 'synthesize', { text: 'Bonjour.', voiceId: 'clone_987', wordTimings: true }, ctx)
    expect(f.calls.map((c) => [c.method, c.url])).toEqual([
      ['POST', 'https://api.openspeaker.ai/v3/text-to-speech'],
      ['GET', 'https://api.openspeaker.ai/v1/task/t1'],
      ['GET', 'https://api.openspeaker.ai/v1/task/t1'],
      ['GET', AUDIO_URL]
    ])
    expect(f.calls[0]?.headers['xi-api-key']).toBe(KEY)
    expect(f.calls[0]?.form).toMatchObject({ voice_id: 'clone_987', text: 'Bonjour.', with_transcript: 'false' })
    expect(f.calls[3]?.headers['xi-api-key']).toBeUndefined()
    expect(ref).toBe('t1')
    expect(out.costUsd).toBeCloseTo(3000 * AI33_USD_PER_CREDIT, 9)
    expect(out.data).toMatchObject({ wordTimings: 'unavailable', creditCost: 3000 })
  })

  it('a retry polls the same task instead of paying a new one', async () => {
    const f = api({ status: ['done'] })
    const ctx = { ...ctxFor(KEY), providerRef: () => 't1' }
    await runUsage(ai33Adapter({ fetchImpl: f.fetch, pollMs: 1 }), 'synthesize', { text: 'Bonjour.', voiceId: 'clone_987', wordTimings: true }, ctx)
    expect(f.calls.some((c) => c.url.endsWith('/v3/text-to-speech'))).toBe(false)
  })

  it('a failed task fails the job and clears the task id', async () => {
    const f = api({ status: ['error'] })
    let ref: string | null = 't1'
    const ctx = { ...ctxFor(KEY), providerRef: () => ref, setProviderRef: (r: string | null) => void (ref = r) }
    await expect(runUsage(ai33Adapter({ fetchImpl: f.fetch, pollMs: 1 }), 'synthesize', { text: 'x', voiceId: 'v', wordTimings: true }, ctx)).rejects.toThrow(/failed/)
    expect(ref).toBeNull()
  })

  it('clones a sample and names the voice clone_<id>', async () => {
    const f = api()
    const out = await runUsage(ai33Adapter({ fetchImpl: f.fetch }), 'cloneVoice', { audioArtefactId: 'art_clip', name: 'Marie', language: 'fr', consent: true }, withClip())
    expect(f.calls[1]?.form).toMatchObject({ voice_name: 'Marie', audio_file: { name: 'voix.mp3' } })
    expect(out.data).toMatchObject({ voiceId: 'clone_987' })
  })
})
