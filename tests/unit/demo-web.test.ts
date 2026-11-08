// The clickable web demo (dist-demo/): the hash route, the first visit (onboarding first), the demo bridge's defaults, and
// that every method the screens load at open has a fixture (no screen falls back to an empty or null answer).
import { afterEach, describe, expect, it } from 'vitest'
import { API_METHODS } from '../../src/shared/api'
import { hashOf, routeFromHash } from '../../src/renderer/lib/router'
import { isDemoWeb } from '../../src/renderer/lib/demo'
import { prepareVisit } from '../../src/renderer/web/demo/visit'

const g = globalThis as { atelier?: unknown; window?: unknown }

afterEach(() => {
  delete g.atelier
})

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed))
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v)
  }
}

describe('demo hash route', () => {
  it('reads a section and its page, and writes them back', () => {
    expect(routeFromHash('#/production/creer')).toEqual({ section: 'production', page: 'creer' })
    expect(hashOf({ section: 'production', page: 'creer' })).toBe('#/production/creer')
    expect(routeFromHash('#/accueil')).toEqual({ section: 'accueil' })
  })

  it('falls back to the section’s first page for an unknown page, and ignores unknown sections', () => {
    expect(routeFromHash('#/reglages/nope')).toEqual({ section: 'reglages', page: 'general' })
    expect(routeFromHash('#/nowhere')).toBeNull()
    expect(routeFromHash('')).toBeNull()
  })
})

describe('demo visit', () => {
  it('opens the onboarding on the first visit only, in the demo workspace', () => {
    const s = memoryStorage()
    prepareVisit(s)
    expect(JSON.parse(s.getItem('atelier.proto.prefs') ?? '{}')).toEqual({ onboarded: false, presentation: true })
    s.setItem('atelier.proto.prefs', JSON.stringify({ onboarded: true }))
    prepareVisit(s)
    expect(JSON.parse(s.getItem('atelier.proto.prefs') ?? '{}')).toEqual({ onboarded: true })
  })

  it('is on only with the demo bridge', () => {
    expect(isDemoWeb()).toBe(false)
    g.atelier = { web: true, call: () => undefined }
    expect(isDemoWeb()).toBe(false)
    g.atelier = { web: true, demo: true, call: () => undefined }
    expect(isDemoWeb()).toBe(true)
  })
})

describe('demo bridge', () => {
  it('answers from its handlers, defaults the rest calmly and notes them', async () => {
    g.window ??= {}
    const { createDemoBridge } = await import('../../src/renderer/web/demo/bridge')
    const bridge = createDemoBridge({ 'settings.get': (key) => (key === 'a' ? 7 : null) })
    expect(await bridge.call('settings.get', 'a')).toBe(7)
    expect(await bridge.call('tools.list')).toEqual([])
    expect(await bridge.call('brain.status')).toBeNull()
    expect((g.window as Window).__demoMissing).toEqual({ 'tools.list': 1, 'brain.status': 1 })
  })

  it('has a fixture for every method the screens load when they open', async () => {
    g.window ??= {}
    const { demoHandlers } = await import('../../src/renderer/web/demo/handlers')
    const handled = Object.keys(demoHandlers())
    // what a tour of every section and page asked at load (collected with the demo bridge's __demoMissing)
    const LOADED = [
      'admin.overview', 'analysis.list', 'analysis.references', 'app.info', 'approvals.pending', 'automations.history',
      'automations.list', 'autopilot.power', 'brain.status', 'builder.list', 'channels.list', 'claude.profiles', 'clone.list',
      'cloud.catalog', 'cloud.loginState', 'cloud.spend', 'cloud.status', 'credits.balance', 'credits.entries', 'credits.packs',
      'discord.status', 'estimates.cards', 'example.status', 'google.status', 'home.inbox', 'ideas.list', 'llm.access',
      'orchestra.accounts', 'orchestra.contextBlock', 'orchestra.status', 'pipelines.list', 'pipelines.templates',
      'previews.options', 'production.engineStatus', 'production.list', 'production.voices', 'projects.list', 'providers.list',
      'recipes.bases', 'recipes.list', 'settings.list', 'spend.claudeUsage', 'spend.overview', 'style.list', 'support.list',
      'team.devices', 'team.members', 'technologies.list', 'tools.list'
    ]
    expect(LOADED.filter((m) => !handled.includes(m))).toEqual([])
    expect(handled.filter((m) => !(API_METHODS as readonly string[]).includes(m))).toEqual([])
  })
})
