import { describe, expect, it } from 'vitest'
import { AnthropicProvider, type AnthropicClientLike } from '../../src/main/llm/anthropic'
import { FakeProvider } from '../../src/main/llm/fake'
import { createProviders } from '../../src/main/llm'
import { createProviderTester } from '../../src/main/llm/tester'
import { SecretsStore } from '../../src/main/secrets'
import { openDatabase } from '../../src/main/db'
import type { StreamEvent } from '../../src/main/llm/types'
import { testCipher } from './helpers'

async function drain(events: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

describe('FakeProvider', () => {
  it('streams scripted replies in chunks and records calls', async () => {
    const fake = new FakeProvider(['Hello there world', { text: 'abcdef', chunkSize: 2 }])
    const first = await drain(fake.stream({ model: 'claude-haiku-5-5', prompt: 'hi', system: 'sys' }))
    expect(first.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)).toEqual(['Hello ', 'there ', 'world'])
    const done = first.at(-1)
    expect(done).toMatchObject({ type: 'done', result: { text: 'Hello there world', model: 'claude-haiku-5-5', stopReason: 'end_turn' } })
    const second = await drain(fake.stream({ model: 'm', prompt: 'again' }))
    expect(second.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)).toEqual(['ab', 'cd', 'ef'])
    expect(fake.calls.map((c) => c.prompt)).toEqual(['hi', 'again'])
    await expect(fake.complete({ model: 'm', prompt: 'third' })).rejects.toThrow(/no reply #3/)
  })

  it('defaults to echo, supports errors, usage estimates and abort', async () => {
    const echo = new FakeProvider()
    const r = await echo.complete({ model: 'm', prompt: 'ping' })
    expect(r.text).toBe('echo: ping')
    expect(r.usage.inputTokens).toBeGreaterThan(0)
    expect(r.usage.outputTokens).toBeGreaterThan(0)
    const failing = new FakeProvider([{ text: '', error: 'boom' }])
    await expect(failing.complete({ model: 'm', prompt: 'x' })).rejects.toThrow('boom')
    const ac = new AbortController()
    const slow = new FakeProvider(['one two three four'])
    const it = slow.stream({ model: 'm', prompt: 'x' }, { signal: ac.signal })[Symbol.asyncIterator]()
    await it.next()
    ac.abort()
    await expect(it.next()).rejects.toMatchObject({ code: 'ABORTED' })
  })
})

describe('AnthropicProvider (fake client, no network)', () => {
  function fakeClient(seen: { apiKey?: string; body?: unknown }): (apiKey: string) => AnthropicClientLike {
    return (apiKey) => {
      seen.apiKey = apiKey
      return {
        messages: {
          stream(body) {
            seen.body = body
            const events = [
              { type: 'message_start' },
              { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi ' } },
              { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Charlie' } },
              { type: 'message_stop' }
            ]
            return {
              async *[Symbol.asyncIterator]() {
                yield* events
              },
              finalMessage: async () => ({
                model: 'claude-sonnet-5-5',
                stop_reason: 'end_turn',
                usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 4, cache_creation_input_tokens: null }
              })
            }
          }
        },
        models: { list: async () => ({ data: [] }) }
      }
    }
  }

  it('streams text and maps usage', async () => {
    const seen: { apiKey?: string; body?: unknown } = {}
    const p = new AnthropicProvider({ getKey: () => 'sk-test', createClient: fakeClient(seen) })
    const events = await drain(p.stream({ model: 'claude-sonnet-5-5', prompt: 'hello', system: 'be kind', maxTokens: 50 }))
    expect(seen.apiKey).toBe('sk-test')
    expect(seen.body).toEqual({
      model: 'claude-sonnet-5-5', max_tokens: 50, system: 'be kind', messages: [{ role: 'user', content: 'hello' }],
      output_config: { effort: 'high' }
    })
    expect(events.at(-1)).toEqual({
      type: 'done',
      result: {
        text: 'Hi Charlie', model: 'claude-sonnet-5-5', costUsd: null, stopReason: 'end_turn', truncated: false, sessionId: null,
        usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 4, cacheWriteTokens: 0 }
      }
    })
  })

  it('refuses to run without a key', async () => {
    const p = new AnthropicProvider({ getKey: () => null, createClient: fakeClient({}) })
    await expect(p.complete({ model: 'm', prompt: 'x' })).rejects.toMatchObject({ code: 'NO_KEY' })
  })
})

describe('provider tester', () => {
  it('checks Claude Code with --version and the API with a model list, never a completion', async () => {
    const secrets = new SecretsStore(openDatabase(':memory:'), testCipher())
    const providers = createProviders({
      secrets,
      claudeCode: { findBinary: () => 'C:\\bin\\claude.exe' },
      createAnthropicClient: () => ({
        messages: { stream: () => { throw new Error('must not complete') } },
        models: { list: async () => ({}) }
      })
    })
    const versions: string[] = []
    const tester = createProviderTester(providers, async (bin) => {
      versions.push(bin)
      return '2.1.302 (Claude Code)'
    })
    expect(await tester.test('claude-code')).toMatchObject({ ok: true, message: 'Found C:\\bin\\claude.exe (2.1.302 (Claude Code))' })
    expect(versions).toEqual(['C:\\bin\\claude.exe'])
    expect(await tester.test('anthropic')).toMatchObject({ ok: false, message: expect.stringMatching(/No Anthropic API key/) })
    secrets.set('provider.anthropic.apiKey', 'sk-test')
    expect(await tester.test('anthropic')).toMatchObject({ ok: true })
  })
})
