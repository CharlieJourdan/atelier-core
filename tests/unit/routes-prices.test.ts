import { describe, expect, it } from 'vitest'
import { costOf } from '../../src/main/llm'
import { ROLES } from '../../src/shared/roles'
import { memoryCore } from './helpers'

describe('routes', () => {
  it('seeds a route for every SPEC role', async () => {
    const core = memoryCore()
    const rows = await core.api['routes.list']()
    expect(rows.map((r) => r.role)).toEqual(ROLES.map((r) => r.role))
    // 22 v1 roles + 5 v2 roles (lot 13); the routes table keeps the 22 rows seeded by migration 002, the new roles
    // get their default tier until Charlie sets a route.
    expect(rows).toHaveLength(27)
    const seeded = core.db.prepare('SELECT COUNT(*) AS n FROM routes').get() as { n: number }
    expect(seeded.n).toBe(22)
    for (const def of ROLES) expect(rows.find((r) => r.role === def.role)?.tier).toBe(def.defaultTier)
  })

  it('resolves role → tier → model on the default provider', () => {
    const { context } = memoryCore()
    expect(context.routes.resolve('supervisor')).toEqual({
      role: 'supervisor', tier: 'best', providerId: 'claude-code', model: 'claude-opus-5-5', effort: null
    })
    expect(context.routes.resolve('researcher').model).toBe('claude-sonnet-5-5')
    expect(context.routes.resolve('metadata').model).toBe('claude-haiku-5-5')
    // Unknown roles fall back to the balanced tier.
    expect(context.routes.resolve('mystery').model).toBe('claude-sonnet-5-5')
  })

  it('applies tier changes, provider and model overrides, and tier model edits', async () => {
    const topics: string[] = []
    const { api, context } = memoryCore({ notify: (t) => topics.push(t) })
    await api['routes.set']('qc', { tier: 'fast' })
    expect(context.routes.resolve('qc')).toMatchObject({ tier: 'fast', model: 'claude-haiku-5-5' })
    await api['routes.set']('qc', { providerId: 'anthropic', model: 'claude-sonnet-5-5' })
    expect(context.routes.resolve('qc')).toEqual({
      role: 'qc', tier: 'fast', providerId: 'anthropic', model: 'claude-sonnet-5-5', effort: null
    })
    await api['routes.set']('qc', { providerId: null, model: null })
    expect(context.routes.resolve('qc')).toMatchObject({ providerId: 'claude-code', model: 'claude-haiku-5-5' })
    await api['llm.setTierModel']('fast', 'claude-haiku-5-6')
    expect(context.routes.resolve('qc').model).toBe('claude-haiku-5-6')
    await api['llm.setDefaultProvider']('anthropic')
    expect(context.routes.resolve('supervisor').providerId).toBe('anthropic')
    expect(await api['llm.defaults']()).toEqual({
      defaultProvider: 'anthropic',
      tierModels: { best: 'claude-opus-5-5', balanced: 'claude-sonnet-5-5', fast: 'claude-haiku-5-6' }
    })
    expect(topics).toEqual(['routes', 'routes', 'routes', 'routes', 'routes'])
  })

  it('rejects unknown roles, tiers, providers and malformed models', () => {
    const { context } = memoryCore()
    expect(() => context.routes.set('nobody', { tier: 'fast' })).toThrow(/Unknown role/)
    expect(() => context.routes.set('qc', { tier: 'turbo' as never })).toThrow(/Unknown tier/)
    expect(() => context.routes.set('qc', { providerId: 'openai' as never })).toThrow(/Unknown provider/)
    expect(() => context.routes.set('qc', { model: 'rm -rf; x' })).toThrow(/Invalid model/)
    expect(() => context.routes.setTierModel('best', '')).toThrow(/Invalid model/)
  })
})

describe('prices', () => {
  it('seeds the real Anthropic list prices, none flagged as placeholder', async () => {
    const { api } = memoryCore()
    const prices = await api['prices.list']()
    expect(prices.map((p) => p.model).sort()).toEqual([
      'claude-fable-5-1', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'
    ])
    expect(prices.some((p) => p.isPlaceholder)).toBe(false)
    const by = Object.fromEntries(prices.map((p) => [p.model, p]))
    const pick = (m: string) => [by[m]?.inputPerMTok, by[m]?.outputPerMTok, by[m]?.cacheWritePerMTok, by[m]?.cacheReadPerMTok]
    expect(pick('claude-opus-5-5')).toEqual([4, 20, 5, 0.2])
    expect(pick('claude-sonnet-5-5')).toEqual([2, 10, 2.5, 0.2])
    expect(pick('claude-haiku-5-5')).toEqual([0.1, 0.5, 0.125, 0.01])
    expect(pick('claude-fable-5-1')).toEqual([10, 50, 12.5, 0.25])
    expect(by['claude-fable-5-1']?.tier).toBe('max')
  })

  it('fable is not routed by default', () => {
    const { context } = memoryCore()
    expect(Object.values(context.routes.tierModels())).not.toContain('claude-fable-5-1')
    expect(context.routes.list().every((r) => r.model !== 'claude-fable-5-1')).toBe(true)
  })

  it('editing a price clears the placeholder flag; invalid values are refused', async () => {
    const { api } = memoryCore()
    const row = await api['prices.set']('claude-haiku-5-5', { inputPerMTok: 0.8 })
    expect(row).toMatchObject({ inputPerMTok: 0.8, isPlaceholder: false })
    expect(() => api['prices.set']('claude-haiku-5-5', { outputPerMTok: -1 })).toThrow(/Invalid price/)
    expect(() => api['prices.set']('gpt-x', { outputPerMTok: 1 })).toThrow(/Unknown model/)
  })

  it('computes a call cost from usage', () => {
    const price = {
      model: 'm', providerId: 'anthropic' as const, tier: null, isPlaceholder: false,
      inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75
    }
    const cost = costOf(price, { inputTokens: 1_000_000, outputTokens: 200_000, cacheReadTokens: 500_000, cacheWriteTokens: 0 })
    expect(cost).toBeCloseTo(3 + 3 + 0.15, 10)
  })
})
