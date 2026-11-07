// solidite: no key is ever silently broken. A real job refused for its key, account or permission (on the exact call the
// pipeline made: Gemini's model list answered 200 while its video analysis answered 403) raises the engine's alert in the
// founder console and publishes the engine « down »; a content or busy error does not; the next success clears it, and an
// alert the module did not raise (a HeyGen sign-in) is left alone. Fake adapters only, never the network.
import { describe, expect, it } from 'vitest'
import { ENGINES_ROUTE, EnginesResponse } from '../../src/shared/cloud-engines.ts'
import { isKeyProblem, KEY_ALERT } from '../src/key-health.ts'
import type { ProviderAdapter } from '../src/providers/types.ts'
import { makeCloud, quoteAndRun, signUpAndIn } from './helpers.ts'

const ENGINE = 'image:gpt-image-25-low'

function flaky(state: { answer: 'ok' | 'forbidden' | 'content' }): ProviderAdapter {
  return {
    id: ENGINE,
    kind: 'real',
    keyless: true,
    async generateImage() {
      if (state.answer === 'forbidden') throw new Error('HTTP 403: The caller does not have permission')
      if (state.answer === 'content') throw new Error('the prompt was refused by the safety system')
      return { files: [{ name: 'a.png', mime: 'image/png', bytes: Buffer.from('png') }], data: {}, costUsd: 0.006 }
    }
  }
}

describe('key health', () => {
  it('tells a key problem from a content or busy error', () => {
    for (const m of ['HTTP 403 Forbidden', '401 Unauthorized', 'API key not valid. Please pass a valid API key.', 'insufficient credits', 'quota exceeded']) expect(isKeyProblem(m), m).toBe(true)
    for (const m of ['the prompt was refused by the safety system', 'HTTP 503 overloaded', 'timeout after 60 s']) expect(isKeyProblem(m), m).toBe(false)
  })

  it('a 403 on the real call raises the alert and publishes the engine down; the next success clears it', async () => {
    const state: { answer: 'ok' | 'forbidden' | 'content' } = { answer: 'forbidden' }
    const t = makeCloud({ paidCalls: true, env: { NODE_ENV: 'production' }, realAdapters: [flaky(state)], engines: [ENGINE] })
    const p = await signUpAndIn(t, { credits: 1000 })
    const health = async () => EnginesResponse.parse((await t.app.inject({ method: ENGINES_ROUTE.method, url: ENGINES_ROUTE.path, headers: p.auth })).json()).engines.find((e) => e.id === ENGINE)?.health
    const run = () => quoteAndRun(t, p, 'generateImage', { prompt: 'un phare', count: 1, engine: ENGINE })
    const failed = await run()
    expect(failed.job.state).toBe('failed')
    expect(t.cloud.providerAlerts.list()).toEqual([expect.objectContaining({ provider: ENGINE, message: expect.stringMatching(new RegExp(`^${KEY_ALERT} \\(generateImage\\) : HTTP 403`)) })])
    expect(await health()).toBe('down')
    // a content refusal is not a key problem: the alert stays as it was, nothing new raised
    state.answer = 'content'
    await run()
    expect(t.cloud.providerAlerts.list()).toHaveLength(1)
    state.answer = 'ok'
    expect((await run()).job.state).toBe('succeeded')
    expect(t.cloud.providerAlerts.list()).toEqual([])
    expect(await health()).toBe('ok')
  })

  it('an alert it did not raise (a sign-in to renew) is left alone by a success', async () => {
    const state: { answer: 'ok' | 'forbidden' | 'content' } = { answer: 'ok' }
    const t = makeCloud({ paidCalls: true, env: { NODE_ENV: 'production' }, realAdapters: [flaky(state)], engines: [ENGINE] })
    const p = await signUpAndIn(t, { credits: 1000 })
    t.cloud.providerAlerts.set(ENGINE, 'reconnecte le compte dans la console')
    await quoteAndRun(t, p, 'generateImage', { prompt: 'un phare', count: 1, engine: ENGINE })
    expect(t.cloud.providerAlerts.list()).toHaveLength(1)
  })
})
