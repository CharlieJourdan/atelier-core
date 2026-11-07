// The engines registry (decision 0021): the fake declarations cover every family, the published list is valid and priced
// on the grid as specified, and GET /v1/engines answers a signed-in user only.
import { describe, expect, it } from 'vitest'
import type { PriceItem } from '../../src/shared/cloud-api.ts'
import { ENGINE_FAMILIES, ENGINE_ID, ENGINES_ROUTE, EnginesResponse } from '../../src/shared/cloud-engines.ts'
import { FAKE_ENGINES, publishEngines } from '../src/providers/engines.ts'
import type { ProviderRegistry } from '../src/providers/registry.ts'
import type { ProviderAdapter } from '../src/providers/types.ts'
import { makeCloud, signUpAndIn } from './helpers.ts'

const avatarItem: PriceItem = {
  item: 'avatar.seconds',
  usage: 'talkingAvatar',
  unit: 'second',
  providerCostUsd: 0.05,
  referenceEur: null,
  pricing: { mode: 'percent', marginPct: 20 }
}
const GRID = { creditValueEur: 0.01, usdToEur: 0.9, overheadPct: 10, items: [avatarItem] }
const registryOf = (status: 'real' | 'demo') => ({ resolve: () => ({ status }), resolveFor: () => ({ status }) }) as unknown as Pick<ProviderRegistry, 'resolve' | 'resolveFor'>
const byId = <T extends { id: string }>(list: T[], id: string): T | undefined => list.find((e) => e.id === id)

describe('the fake engines', () => {
  it('cover every family, with unique ids that carry their family prefix', () => {
    for (const family of ENGINE_FAMILIES) expect(FAKE_ENGINES.some((e) => e.family === family), family).toBe(true)
    expect(new Set(FAKE_ENGINES.map((e) => e.id)).size).toBe(FAKE_ENGINES.length)
    for (const e of FAKE_ENGINES) {
      expect(e.id, e.id).toMatch(ENGINE_ID)
      expect(e.id.startsWith(`${e.family}:`), e.id).toBe(true)
      expect(e.status).toBe('draft')
    }
  })

  it('declare the clip engines billed per call with their 8 s limit, and HeyGen on its plan as needing a sign-in', () => {
    const cloud = publishEngines(FAKE_ENGINES, registryOf('demo'), GRID)
    expect(byId(cloud, 'clip:veo31-lite-relaxed')).toMatchObject({ unit: 'clip', limits: { maxSecondsPerCall: 8 } })
    expect(byId(cloud, 'clip:veo31-lite-vertex')).toMatchObject({ unit: 'second', limits: { maxSecondsPerCall: null } })
    // production-10: HeyGen's API v3 takes an image link (no registration); its plan engine needs the founder's sign-in
    expect(byId(cloud, 'presenter:heygen-avatar4')?.needs).toEqual(['reference-image'])
    expect(byId(cloud, 'presenter:heygen-mcp')).toMatchObject({ needs: ['signin', 'reference-image'], planMonthlyUsd: 49 })
    expect(byId(cloud, 'presenter:infinitetalk-gpu')?.placement).toBe('gpu')
    for (const e of cloud.filter((x) => x.family === 'presenter')) expect(e.needs).toContain('reference-image')
  })
})

describe('publishEngines', () => {
  it('produces a list the contract accepts', () => {
    expect(EnginesResponse.parse({ engines: publishEngines(FAKE_ENGINES, registryOf('demo'), GRID) }).engines).toHaveLength(FAKE_ENGINES.length)
    expect(EnginesResponse.safeParse({ engines: publishEngines(FAKE_ENGINES, registryOf('real'), null) }).success).toBe(true)
  })

  it('prices one unit in credits from the grid: cost × usd→eur × overhead × margin ÷ credit value', () => {
    const list = publishEngines(FAKE_ENGINES, registryOf('demo'), GRID)
    // 0.05 $/s × 0.9 × 1.10 × 1.20 ÷ 0.01 € = 5.94 credits per second (the avatar item's margin is 20 %)
    expect(byId(list, 'presenter:heygen-avatar4')?.priceCredits).toBe(5.94)
    // no grid item for the image usage: the default 25 % margin: 0.003 × 0.9 × 1.1 × 1.25 ÷ 0.01 = 0.37125
    expect(byId(list, 'image:flux-schnell')?.priceCredits).toBe(0.37125)
    // no usage: the default margin too (0.15 $/min of generated music)
    expect(byId(list, 'music:elevenlabs-music')?.priceCredits).toBe(18.5625)
    // the library and the LLM cost nothing here
    expect(byId(list, 'music:library')?.priceCredits).toBe(0)
    expect(byId(list, 'llm:anthropic-sonnet-55')?.priceCredits).toBe(0)
  })

  it('prices at 0 without a grid', () => {
    for (const e of publishEngines(FAKE_ENGINES, registryOf('demo'), null)) expect(e.priceCredits).toBe(0)
  })

  it('says who serves each engine: the registry for a usage, local code is real, the rest is demo', () => {
    const demo = publishEngines(FAKE_ENGINES, registryOf('demo'), GRID)
    expect(demo.filter((e) => e.usage !== null).every((e) => e.served === 'demo')).toBe(true)
    expect(byId(demo, 'music:library')?.served).toBe('real')
    expect(byId(demo, 'music:elevenlabs-music')?.served).toBe('demo')
    expect(byId(demo, 'llm:anthropic-haiku-55')?.served).toBe('demo')
    const real = publishEngines(FAKE_ENGINES, registryOf('real'), GRID)
    expect(byId(real, 'voice:fish-s2')?.served).toBe('real')
    expect(real.every((e) => e.health === 'ok')).toBe(true)
  })
})

describe('GET /v1/engines', () => {
  it('answers the list to a signed-in user, priced on the current grid, all served by fakes', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t)
    const res = await t.app.inject({ method: ENGINES_ROUTE.method, url: ENGINES_ROUTE.path, headers: p.auth })
    expect(res.statusCode).toBe(200)
    const { engines } = EnginesResponse.parse(res.json())
    expect(engines.map((e) => e.id)).toEqual(FAKE_ENGINES.map((e) => e.id))
    expect(byId(engines, 'presenter:hedra-c3')?.priceCredits).toBeGreaterThan(0)
    expect(engines.filter((e) => e.usage !== null).every((e) => e.served === 'demo')).toBe(true)
  })

  it('issue #88: an engine in realEngines with its key, paidCalls on, is served « real » (engines list and catalog)', async () => {
    const real: ProviderAdapter = { id: 'image:gpt-image-25-low', kind: 'real', secretName: 'OPENAI_API_KEY', generateImage: () => Promise.reject(new Error('never called here')) }
    const t = makeCloud({ paidCalls: true, env: { NODE_ENV: 'production' }, realAdapters: [real], engines: ['image:gpt-image-25-low'] })
    const p = await signUpAndIn(t)
    const list = async () => EnginesResponse.parse((await t.app.inject({ method: ENGINES_ROUTE.method, url: ENGINES_ROUTE.path, headers: p.auth })).json()).engines
    const catalog = async () => (await t.app.inject({ url: '/v1/catalog', headers: p.auth })).json() as { providers: { usage: string; status: string }[]; models: { usage: string; demo: boolean }[] }
    // without its key: still demo
    expect(byId(await list(), 'image:gpt-image-25-low')?.served).toBe('demo')
    expect((await catalog()).providers.find((x) => x.usage === 'generateImage')?.status).toBe('demo')
    t.cloud.vault.set('OPENAI_API_KEY', 'sk-test-SECRET-0001', 'test')
    const engines = await list()
    expect(byId(engines, 'image:gpt-image-25-low')?.served).toBe('real')
    // an engine not listed in realEngines, or of another usage, stays demo
    expect(byId(engines, 'image:gpt-image-25-fal-low')?.served).toBe('demo')
    expect(byId(engines, 'voice:ai33')?.served).toBe('demo')
    const c = await catalog()
    expect(c.providers.find((x) => x.usage === 'generateImage')?.status).toBe('real')
    expect(c.models.find((x) => x.usage === 'generateImage')?.demo).toBe(false)
    expect(c.providers.find((x) => x.usage === 'synthesize')?.status).toBe('demo')
  })

  it('refuses a call without a session', async () => {
    const t = makeCloud()
    const res = await t.app.inject({ method: ENGINES_ROUTE.method, url: ENGINES_ROUTE.path })
    expect(res.statusCode).toBe(401)
  })
})
