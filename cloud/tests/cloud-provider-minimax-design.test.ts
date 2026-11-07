// production-10: MiniMax voice design (`designVoice` on voice:minimax-28-hd) against a fake fetch: the exact request, the preview
// returned as a file with the voice id in data, the preview's cost, `keep` (no call, the designed voice's one-off fee), the
// base_resp codes (refusal, retryable, fatal), HTTP 401 / 429 / 5xx and the key never in a message. Never the network.
import { describe, expect, it } from 'vitest'
import { designPreviewText, MINIMAX_DESIGN_FEE_USD, MINIMAX_DESIGN_PREVIEW_MAX_CHARS, minimaxAdapter } from '../src/providers/minimax.ts'
import { RetryableProviderError, runUsage } from '../src/providers/types.ts'
import { voiceEngineAdapters } from '../src/providers/voice-engines.ts'
import { ctxFor, fakeFetch, json } from './fake-fetch.ts'

const KEY = 'minimax-design-SECRET-0f3b6a2d'
const URL_ = 'https://api.minimax.io/v1/voice_design'
const AUDIO = Buffer.from('ID3-preview-of-the-designed-voice')
const ok = (over: Record<string, unknown> = {}) => json({ voice_id: 'ttv-voice-123', trial_audio: AUDIO.toString('hex'), base_resp: { status_code: 0, status_msg: 'success' }, ...over })
const description = 'Une voix grave et calme de conteur, posée, chaleureuse.'
const text = 'Il était une fois, au bord d’une mer grise, un phare que plus personne ne gardait. '.repeat(3).trim()
const run = (f: { fetch: typeof fetch }, over: Record<string, unknown> = {}) => runUsage(minimaxAdapter({ id: 'voice:minimax-28-hd', fetchImpl: f.fetch }), 'designVoice', { description, language: 'fr', ...over }, ctxFor(KEY))
const outcome = (p: Promise<unknown>): Promise<Error> => p.then(() => { throw new Error('it should have failed') }, (e: unknown) => e as Error)

describe('MiniMax voice design (voice:minimax-28-hd)', () => {
  it('posts the description and the preview text, returns the preview as a file and the voice id as its generatedVoiceId', async () => {
    const f = fakeFetch(() => ok())
    const out = await run(f, { text })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toMatchObject({ method: 'POST', url: URL_ })
    expect(f.calls[0]?.headers).toMatchObject({ authorization: `Bearer ${KEY}`, 'content-type': 'application/json' })
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toEqual({ prompt: description, preview_text: text })
    expect(out.files).toEqual([{ name: 'preview-1.mp3', mime: 'audio/mpeg', bytes: AUDIO }])
    expect(out.data).toMatchObject({ previews: [{ generatedVoiceId: 'ttv-voice-123', file: 'preview-1.mp3', durationS: null }], text, deletedIfUnusedForH: 168 })
    // the preview is billed as speech at 60 USD per million characters
    expect(out.costUsd).toBeCloseTo((text.length * 60) / 1_000_000, 12)
    expect(out.measure).toEqual([{ item: 'voice.design', quantity: 1 }])
  })

  it('without a text it sends a default sentence of the language; a long text is cut at 500 characters on a word', async () => {
    const f = fakeFetch(() => ok())
    await run(f)
    expect(JSON.parse(f.calls[0]?.body ?? '{}').preview_text).toMatch(/^Bonjour/)
    expect(designPreviewText('en', undefined)).toMatch(/^Hello/)
    const long = designPreviewText('fr', 'mot '.repeat(300))
    expect(long.length).toBeLessThanOrEqual(MINIMAX_DESIGN_PREVIEW_MAX_CHARS)
    expect(long.endsWith('mot')).toBe(true)
  })

  it('keep calls nothing: the designed voice already works under its id; its one-off fee is the keep job’s cost', async () => {
    const f = fakeFetch(() => ok())
    const out = await run(f, { keep: { generatedVoiceId: 'ttv-voice-123', name: 'Conteur' } })
    expect(f.calls).toHaveLength(0)
    expect(out.data).toMatchObject({ voiceId: 'ttv-voice-123', name: 'Conteur', feeUsdOnFirstUse: 3 })
    expect(out.costUsd).toBe(MINIMAX_DESIGN_FEE_USD)
    expect(out.files).toEqual([])
  })

  it('the voice engine adapter designs voices; the plain synthesis stays as it was', () => {
    const engine = voiceEngineAdapters().find((a) => a.id === 'voice:minimax-28-hd')
    expect(typeof engine?.designVoice).toBe('function')
    expect(typeof engine?.synthesize).toBe('function')
    expect(typeof engine?.cloneVoice).toBe('function')
  })

  it('base_resp codes: a sensitive-content code is « refused: », a rate limit retries, a refused key is fatal; never the key', async () => {
    const refused = await outcome(run(fakeFetch(() => ok({ voice_id: null, trial_audio: null, base_resp: { status_code: 1026, status_msg: 'input sensitive' } }))))
    expect(refused.message).toMatch(/^refused: /)
    expect(refused).not.toBeInstanceOf(RetryableProviderError)
    expect(await outcome(run(fakeFetch(() => ok({ base_resp: { status_code: 1002, status_msg: 'rate limit' } }))))).toBeInstanceOf(RetryableProviderError)
    const key = await outcome(run(fakeFetch(() => ok({ base_resp: { status_code: 1004, status_msg: `bad ${KEY}` } }))))
    expect(key).not.toBeInstanceOf(RetryableProviderError)
    expect(key.message).toMatch(/1004/)
    expect(key.message).not.toContain(KEY)
    const other = await outcome(run(fakeFetch(() => ok({ base_resp: { status_code: 2013, status_msg: `odd ${KEY}` } }))))
    expect(other.message).toMatch(/2013/)
    expect(other.message).not.toContain(KEY)
    expect(await outcome(run(fakeFetch(() => ok({ trial_audio: 'zz' }))))).toBeInstanceOf(RetryableProviderError)
    expect(await outcome(run(fakeFetch(() => ok({ voice_id: null }))))).toBeInstanceOf(RetryableProviderError)
  })

  it('HTTP 401 is fatal and never shows the key; 429 and 5xx retry', async () => {
    const key = await outcome(run(fakeFetch(() => new Response(`{"message":"${KEY}"}`, { status: 401 }))))
    expect(key).not.toBeInstanceOf(RetryableProviderError)
    expect(key.message).toMatch(/401/)
    expect(key.message).not.toContain(KEY)
    expect(await outcome(run(fakeFetch(() => new Response('{}', { status: 429 }))))).toBeInstanceOf(RetryableProviderError)
    expect(await outcome(run(fakeFetch(() => new Response('{}', { status: 500 }))))).toBeInstanceOf(RetryableProviderError)
  })
})
