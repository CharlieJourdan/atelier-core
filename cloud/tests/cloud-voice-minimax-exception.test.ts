// Decision 0101: MiniMax is allowed ONLY for the voices of Charlie's three avatar channels. A REAL MiniMax adapter refuses every
// other clone, design and synthesis at the quote and at the job; the allow-list is explicit. Fake fetch, never the network.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MINIMAX_EXCEPTION, MINIMAX_EXCEPTION_CLONE_NAMES, MINIMAX_EXCEPTION_VOICE_IDS, minimaxRefusal } from '../../src/shared/voice-exception.ts'
import { FAKE_VOICE_FILE } from '../src/providers/fakes.ts'
import { minimaxAdapter } from '../src/providers/minimax.ts'
import { fakeFetch, json } from './fake-fetch.ts'
import { makeCloud, quoteAndRun, signUpAndIn } from './helpers.ts'

const KEY = 'mm-test-SECRET-exception-1'
const MP3 = readFileSync(FAKE_VOICE_FILE)
const ENGINE = 'voice:minimax-28-hd'
const hex = Buffer.from('MP3').toString('hex')

const live = () => {
  const f = fakeFetch((req) =>
    req.url.endsWith('/v1/t2a_v2')
      ? json({ data: { audio: hex, status: 2 }, extra_info: { audio_length: 1000, usage_characters: 10 }, base_resp: { status_code: 0 } })
      : req.url.endsWith('/v1/files/upload')
        ? json({ file: { file_id: 'f1' }, base_resp: { status_code: 0 } })
        : req.url.endsWith('/v1/voice_clone')
          ? json({ base_resp: { status_code: 0 } })
          : new Response(MP3)
  )
  const t = makeCloud({ paidCalls: true, env: { NODE_ENV: 'production' }, realAdapters: [minimaxAdapter({ id: ENGINE, fetchImpl: f.fetch })], providers: { synthesize: 'fake' }, engines: [ENGINE] })
  t.cloud.vault.set('MINIMAX_API_KEY', KEY, 'test')
  return { t, f }
}

describe('the allow-list', () => {
  it('names exactly the three avatar channels, with clone names and clone ids of their own', () => {
    expect(MINIMAX_EXCEPTION.map((c) => c.handle)).toEqual(['@exemple-chauffage', '@exemple-kundendienst', '@exemple-compagnon'])
    expect(new Set(MINIMAX_EXCEPTION_CLONE_NAMES).size).toBe(3)
    expect(MINIMAX_EXCEPTION_VOICE_IDS.length).toBeGreaterThan(0)
    expect(MINIMAX_EXCEPTION_VOICE_IDS.every((v) => /^clone-[0-9a-f]{16}$/.test(v))).toBe(true)
  })
  it('allows only those clone names and voice ids, and never a design', () => {
    expect(minimaxRefusal('cloneVoice', { name: MINIMAX_EXCEPTION_CLONE_NAMES[0] })).toBeNull()
    expect(minimaxRefusal('synthesize', { voiceId: MINIMAX_EXCEPTION_VOICE_IDS[0] })).toBeNull()
    expect(minimaxRefusal('cloneVoice', { name: 'Marie' })).toMatch(/trois chaînes avatar/)
    expect(minimaxRefusal('synthesize', { voiceId: 'clone-00000000000000ff' })).toMatch(/ai33/)
    expect(minimaxRefusal('synthesize', { voiceId: 'French_Narrator' })).not.toBeNull()
    expect(minimaxRefusal('designVoice', { description: 'x' })).not.toBeNull()
    expect(minimaxRefusal('synthesize', {})).not.toBeNull()
  })
})

describe('the Cloud with a real MiniMax adapter', () => {
  it('refuses any other synthesis at the quote and calls nothing', async () => {
    const { t, f } = live()
    const p = await signUpAndIn(t, { credits: 10_000 })
    const r = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'synthesize', input: { text: 'Bonjour.', voiceId: 'French_Narrator', engine: ENGINE } } })
    expect(r.statusCode).toBe(403)
    expect(r.body).toMatch(/ai33/)
    expect(f.calls).toHaveLength(0)
  })
  it('refuses any other clone and any design', async () => {
    const { t, f } = live()
    const p = await signUpAndIn(t, { credits: 10_000 })
    const clip = await t.cloud.storage.put(p.teamId, null, { name: 'v.mp3', mime: 'audio/mpeg', bytes: MP3 }, false)
    const clone = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'cloneVoice', input: { audioArtefactId: clip.id, name: 'Marie', consent: true, engine: ENGINE } } })
    expect(clone.statusCode).toBe(403)
    const design = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'designVoice', input: { description: 'Une voix grave et calme de conteur, débit posé.', engine: ENGINE } } })
    expect(design.statusCode).toBe(403)
    expect(f.calls).toHaveLength(0)
  })
  it('serves the allow-listed clone name and voice ids', async () => {
    const { t, f } = live()
    const p = await signUpAndIn(t, { credits: 10_000 })
    const clip = await t.cloud.storage.put(p.teamId, null, { name: 'v.mp3', mime: 'audio/mpeg', bytes: MP3 }, false)
    const cloned = await quoteAndRun(t, p, 'cloneVoice', { audioArtefactId: clip.id, name: MINIMAX_EXCEPTION_CLONE_NAMES[0], consent: true, engine: ENGINE })
    expect(cloned.job).toMatchObject({ state: 'succeeded', demo: false })
    const said = await quoteAndRun(t, p, 'synthesize', { text: 'Bonjour.', voiceId: MINIMAX_EXCEPTION_VOICE_IDS[0], engine: ENGINE })
    expect(said.job).toMatchObject({ state: 'succeeded', demo: false })
    expect(f.calls.length).toBeGreaterThan(0)
  })
  it('a job whose engine is not real (demo) is not blocked: nothing is called', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 10_000 })
    const { job } = await quoteAndRun(t, p, 'synthesize', { text: 'Bonjour.', voiceId: 'French_Narrator', engine: ENGINE })
    expect(job).toMatchObject({ state: 'succeeded', demo: true })
  })
})
