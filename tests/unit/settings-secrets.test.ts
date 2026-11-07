import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db'
import { SecretsStore, SecretsUnavailableError } from '../../src/main/secrets'
import { SettingsStore } from '../../src/main/settings'
import { memoryCore, testCipher } from './helpers'

describe('settings', () => {
  it('stores JSON values by key and lists them', () => {
    const s = new SettingsStore(openDatabase(':memory:'))
    expect(s.get('ui.theme')).toBeNull()
    expect(s.get('ui.theme', 'light')).toBe('light')
    s.set('ui.theme', 'dark')
    s.set('budget.global', { monthlyUsd: 50, hard: true })
    s.set('flags', [1, 'two', null])
    expect(s.get('ui.theme')).toBe('dark')
    expect(s.get('budget.global')).toEqual({ monthlyUsd: 50, hard: true })
    s.set('ui.theme', 'light')
    expect(s.get('ui.theme')).toBe('light')
    const all = s.all()
    expect(all['flags']).toEqual([1, 'two', null])
    expect(all['llm.defaultProvider']).toBe('claude-code') // seeded by migration 002
    s.delete('flags')
    expect(s.get('flags')).toBeNull()
  })

  it('the api refuses reserved keys that have validated methods or will hold executable paths', async () => {
    const { api, context } = memoryCore()
    expect(() => api['settings.set']('llm.tierModels', { best: 'x & calc' })).toThrow(/cannot be changed/)
    expect(() => api['settings.set']('engine.h1.host', '-oProxyCommand=calc')).toThrow(/cannot be changed/)
    expect(() => api['settings.set']('production.workDir', 'C:\\evil')).toThrow(/cannot be changed/)
    expect(context.routes.tierModels().best).toBe('claude-opus-5-5')
    await api['settings.set']('ui.lastView', 'spend')
    expect(await api['settings.get']('ui.lastView')).toBe('spend')
  })

  it('rejects bad keys', () => {
    const s = new SettingsStore(openDatabase(':memory:'))
    expect(() => s.set('', 1)).toThrow(/Invalid setting key/)
    expect(() => s.set('has space', 1)).toThrow(/Invalid setting key/)
  })
})

describe('secrets', () => {
  it('round-trips through the cipher and never stores plaintext', () => {
    const db = openDatabase(':memory:')
    const cipher = testCipher()
    const secrets = new SecretsStore(db, cipher)
    const value = 'sk-test-not-a-real-key-123'
    expect(secrets.has('k')).toBe(false)
    secrets.set('k', value)
    expect(cipher.encrypted).toBe(1)
    expect(secrets.has('k')).toBe(true)
    expect(secrets.get('k')).toBe(value)
    const raw = db.prepare('SELECT ciphertext FROM secrets WHERE name = ?').get('k') as { ciphertext: Uint8Array }
    expect(Buffer.from(raw.ciphertext).toString('utf8')).not.toContain(value)
    secrets.set('k', 'second')
    expect(secrets.get('k')).toBe('second')
    secrets.clear('k')
    expect(secrets.get('k')).toBeNull()
  })

  it('refuses to store when OS encryption is unavailable', () => {
    const secrets = new SecretsStore(openDatabase(':memory:'), testCipher(false))
    expect(() => secrets.set('k', 'v')).toThrow(SecretsUnavailableError)
    expect(secrets.has('k')).toBe(false)
  })

  it('the api only reports set / not set, never the key', async () => {
    const topics: string[] = []
    const core = memoryCore({ notify: (t) => topics.push(t) })
    const before = await core.api['providers.list']()
    expect(before.find((p) => p.id === 'anthropic')?.keySet).toBe(false)
    expect(before.find((p) => p.id === 'claude-code')?.keySet).toBeNull()
    await core.api['providers.setKey']('anthropic', '  sk-test-abc  ')
    const after = await core.api['providers.list']()
    expect(after.find((p) => p.id === 'anthropic')?.keySet).toBe(true)
    expect(JSON.stringify(after)).not.toContain('sk-test-abc')
    expect(JSON.stringify(await core.api['settings.list']())).not.toContain('sk-test-abc')
    expect(core.context.secrets.get('provider.anthropic.apiKey')).toBe('sk-test-abc')
    await core.api['providers.clearKey']('anthropic')
    expect((await core.api['providers.list']()).find((p) => p.id === 'anthropic')?.keySet).toBe(false)
    expect(topics).toEqual(['providers', 'providers'])
    expect(() => core.api['providers.setKey']('claude-code', 'x')).toThrow(/does not use a key/)
  })
})
