import { describe, expect, it } from 'vitest'
import { API_METHODS, PROVIDER_IDS, type ApiMethod } from '../../src/shared/api'
import { handleCall } from '../../src/main/ipc'
import { dispatchRemote } from '../../src/main/headless/server'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { memoryCore } from './helpers'

describe('atelier:call bus', () => {
  it('dispatches to the api and wraps results in an envelope', async () => {
    const { api } = memoryCore({ appVersion: '0.1.0' })
    const info = await handleCall(api, 'app.info', [])
    expect(info).toMatchObject({ ok: true, value: { name: 'Atelier', version: '0.1.0', dbPath: ':memory:', schemaVersion: MIGRATIONS.length } })
    await handleCall(api, 'settings.set', ['ui.lastView', 'board'])
    expect(await handleCall(api, 'settings.get', ['ui.lastView'])).toEqual({ ok: true, value: 'board' })
    expect(await handleCall(api, 'providers.test', ['claude-code'])).toEqual({
      ok: true, value: { ok: true, message: 'tested claude-code', latencyMs: 0 }
    })
  })

  it('turns thrown errors and bad requests into error envelopes', async () => {
    const { api } = memoryCore()
    expect(await handleCall(api, 'nope.method', [])).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } })
    expect(await handleCall(api, 'toString', [])).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } })
    expect(await handleCall(api, 'settings.get', 'ui')).toMatchObject({ ok: false, error: { code: 'BAD_ARGS' } })
    // Truth moved on purpose (app-ux-robustesse-2): a developer's English sentence reaches the screen as a calm French one.
    expect(await handleCall(api, 'routes.set', ['ghost', { tier: 'fast' }])).toEqual({
      ok: false, error: { code: 'ERROR', message: 'Cette action n’a pas pu aboutir. Vérifie ce que tu as saisi et réessaie ; si ça recommence, relance Atelier.', detail: 'Unknown role: ghost' }
    })
  })

  it('the headless server and the brain route carry the precise reason in `detail`, the French sentence in `message`', async () => {
    const { api } = memoryCore()
    const out = (await dispatchRemote(api, 'routes.set', ['ghost', { tier: 'fast' }])) as { ok: boolean; error: { message: string; detail?: string } }
    expect(out.ok).toBe(false)
    expect(out.error.message).toMatch(/n’a pas pu aboutir/)
    expect(out.error.detail).toBe('Unknown role: ghost')
  })

  it('app.setTheme validates strictly and hands the theme to the injected window callback', async () => {
    const seen: string[] = []
    const { api } = memoryCore({ setWindowTheme: (t) => seen.push(t) })
    expect(await handleCall(api, 'app.setTheme', ['light'])).toEqual({ ok: true })
    expect(await handleCall(api, 'app.setTheme', ['dark'])).toEqual({ ok: true })
    for (const bad of ['sepia', '', 'Light', null, 1, undefined]) {
      expect(await handleCall(api, 'app.setTheme', [bad])).toMatchObject({ ok: false, error: { code: 'ERROR' } })
    }
    expect(await handleCall(api, 'app.setTheme', [])).toMatchObject({ ok: false })
    expect(seen).toEqual(['light', 'dark'])
    // Without a window (tests, headless core) the call is a harmless no-op.
    expect(await handleCall(memoryCore().api, 'app.setTheme', ['light'])).toEqual({ ok: true })
  })

  it('implements every method of the contract', () => {
    const { api } = memoryCore()
    const methods = Object.keys(api) as ApiMethod[]
    // Against the contract's own runtime list: neither a missing nor an extra handler passes.
    expect([...methods].sort()).toEqual([...API_METHODS].sort())
    for (const m of methods) expect(typeof api[m]).toBe('function')
    expect(PROVIDER_IDS).toEqual(['claude-code', 'anthropic'])
  })
})
