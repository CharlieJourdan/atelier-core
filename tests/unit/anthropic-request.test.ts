import { describe, expect, it } from 'vitest'
import { AnthropicProvider, buildRequest, type AnthropicClientLike } from '../../src/main/llm/anthropic'
import { memoryCore } from './helpers'

const FORBIDDEN = ['thinking', 'budget_tokens', 'temperature', 'top_p', 'top_k', 'tool_choice']

describe('buildRequest', () => {
  it('sends effort explicitly with the per-model defaults', () => {
    expect(buildRequest({ model: 'claude-opus-5-5', prompt: 'x' }).output_config).toEqual({ effort: 'medium' })
    expect(buildRequest({ model: 'claude-haiku-5-5', prompt: 'x' }).output_config).toEqual({ effort: 'low' })
    expect(buildRequest({ model: 'claude-sonnet-5-5', prompt: 'x' }).output_config).toEqual({ effort: 'high' })
    expect(buildRequest({ model: 'claude-fable-5-1', prompt: 'x' }).output_config).toEqual({ effort: 'high' })
  })

  it('lets the route override the effort', () => {
    expect(buildRequest({ model: 'claude-opus-5-5', prompt: 'x', effort: 'max' }).output_config).toEqual({ effort: 'max' })
    expect(() => buildRequest({ model: 'm', prompt: 'x', effort: 'turbo' as never })).toThrow(/Unknown effort/)
  })

  it('never contains thinking, budget_tokens, sampling parameters or a forced tool_choice', () => {
    for (const model of ['claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'other']) {
      for (const maxTokens of [undefined, 100, 16000, 64000]) {
        const json = JSON.stringify(buildRequest({ model, prompt: 'p', system: 's', maxTokens }))
        for (const key of FORBIDDEN) expect(json).not.toContain(key)
      }
    }
  })

  it('maps prompt, system and max_tokens, and validates max_tokens', () => {
    expect(buildRequest({ model: 'claude-sonnet-5-5', prompt: 'hi' })).toEqual({
      model: 'claude-sonnet-5-5', max_tokens: 8192, messages: [{ role: 'user', content: 'hi' }],
      output_config: { effort: 'high' }
    })
    expect(buildRequest({ model: 'm', prompt: 'hi', system: 'sys', maxTokens: 32000 })).toMatchObject({
      system: 'sys', max_tokens: 32000
    })
    expect(() => buildRequest({ model: 'm', prompt: 'x', maxTokens: 0 })).toThrow(/max_tokens/)
    expect(() => buildRequest({ model: 'm', prompt: 'x', maxTokens: 1.5 })).toThrow(/max_tokens/)
  })
})

function providerWith(stopReason: string | null, calls: unknown[] = []): AnthropicProvider {
  const client: AnthropicClientLike = {
    messages: {
      stream(body) {
        calls.push(body)
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }
          },
          finalMessage: async () => ({
            model: 'claude-opus-5-5', stop_reason: stopReason, usage: { input_tokens: 1, output_tokens: 1 }
          })
        }
      }
    },
    models: { list: async () => ({}) }
  }
  return new AnthropicProvider({ getKey: () => 'sk-test', createClient: () => client })
}

describe('AnthropicProvider stop_reason', () => {
  it('turns a refusal into a clear error', async () => {
    await expect(providerWith('refusal').complete({ model: 'claude-opus-5-5', prompt: 'x' })).rejects.toMatchObject({
      code: 'REFUSED', message: expect.stringMatching(/declined/)
    })
  })

  it('marks max_tokens and context-window stops as truncated, other stops as complete', async () => {
    const r1 = await providerWith('max_tokens').complete({ model: 'claude-opus-5-5', prompt: 'x' })
    expect(r1).toMatchObject({ text: 'partial', stopReason: 'max_tokens', truncated: true })
    const r2 = await providerWith('model_context_window_exceeded').complete({ model: 'claude-opus-5-5', prompt: 'x' })
    expect(r2.truncated).toBe(true)
    const r3 = await providerWith('end_turn').complete({ model: 'claude-opus-5-5', prompt: 'x' })
    expect(r3.truncated).toBe(false)
  })

  it('always goes through the streaming call, including for max_tokens above 16000', async () => {
    const calls: { max_tokens: number }[] = []
    await providerWith('end_turn', calls).complete({ model: 'claude-opus-5-5', prompt: 'x', maxTokens: 64000 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.max_tokens).toBe(64000)
  })
})

describe('route effort', () => {
  it('is stored per route and resolved, default null', async () => {
    const { api, context } = memoryCore()
    expect(context.routes.resolve('supervisor').effort).toBeNull()
    await api['routes.set']('supervisor', { effort: 'high' })
    expect(context.routes.resolve('supervisor').effort).toBe('high')
    await api['routes.set']('supervisor', { tier: 'fast' })
    expect(context.routes.resolve('supervisor')).toMatchObject({ tier: 'fast', effort: 'high' })
    await api['routes.set']('supervisor', { effort: null })
    expect(context.routes.resolve('supervisor').effort).toBeNull()
    expect(() => context.routes.set('supervisor', { effort: 'turbo' as never })).toThrow(/Unknown effort/)
  })
})
