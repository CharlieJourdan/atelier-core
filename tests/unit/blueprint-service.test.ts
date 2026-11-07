// The blueprint in the app: fetched when connected (then every 30 minutes, or on demand), cached in settings with its version,
// not used when the app is not connected or the Cloud has nothing published, kept (« stale ») when the Cloud cannot be reached.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlueprintService, CACHE_KEY, REFRESH_EVERY_MS, type PublishedBlueprint } from '../../src/main/blueprint/service'
import { openDatabase } from '../../src/main/db'
import { SettingsStore } from '../../src/main/settings'
import { Blueprint } from '../../src/shared/cloud-api'
import { PUBLISHED_V3 } from '../../web/src/admin/blueprint'

const bp = Blueprint.parse(PUBLISHED_V3)
const published = (version: number): PublishedBlueprint => ({ version, blueprint: { ...bp, version }, publishedAt: `2026-10-2${version}T10:00:00.000Z` })

function rig() {
  const settings = new SettingsStore(openDatabase(':memory:'))
  const state = { connected: true, baseUrl: 'http://127.0.0.1:8787', answer: published(3) as PublishedBlueprint | null | Error, calls: 0, notified: 0 }
  const service = new BlueprintService({
    settings,
    fetch: async () => {
      state.calls++
      if (state.answer instanceof Error) throw state.answer
      return state.answer
    },
    connected: () => state.connected,
    baseUrl: () => state.baseUrl,
    notify: () => void state.notified++,
    now: () => Date.parse('2026-10-26T08:00:00.000Z')
  })
  return { settings, state, service }
}

describe('BlueprintService', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('not connected: no blueprint, no request, the built-in defaults apply', async () => {
    const { state, service } = rig()
    state.connected = false
    expect(service.status()).toMatchObject({ state: 'not-connected', version: null, agents: [], pipelines: [] })
    expect(service.forSeed()).toBeNull()
    await service.refresh()
    expect(state.calls).toBe(0)
  })

  it('connected with nothing published (404): state « none », no defaults, and a stale cache is dropped', async () => {
    const { state, service, settings } = rig()
    await service.refresh()
    expect(service.version()).toBe(3)
    state.answer = null
    await service.refresh()
    expect(service.status()).toMatchObject({ state: 'none', version: null })
    expect(service.forSeed()).toBeNull()
    expect(settings.get(CACHE_KEY)).toBeNull()
  })

  it('caches the fetched version in settings and serves it read-only: version, date, agents, templates, pipelines', async () => {
    const { service, settings, state } = rig()
    const status = await service.refresh()
    expect(status).toMatchObject({ state: 'ok', version: 3, publishedAt: '2026-10-23T10:00:00.000Z', fetchedAt: '2026-10-26T08:00:00.000Z', stale: false })
    expect(status.agents).toHaveLength(9)
    expect(status.pipelines.map((p) => p.id)).toEqual(['documentaire-narre', 'reddit-gameplay', 'top-10'])
    expect(settings.get<{ version: number }>(CACHE_KEY)).toMatchObject({ version: 3, baseUrl: 'http://127.0.0.1:8787' })
    expect(service.forSeed()?.version).toBe(3)
    expect(service.forSeed()?.defaults.get('principal')?.tier).toBe('best')
    expect(state.notified).toBe(1)
    await service.refresh() // same version: nothing to tell
    expect(state.notified).toBe(1)
    state.answer = published(4)
    await service.refresh()
    expect(service.version()).toBe(4)
    expect(state.notified).toBe(2)
  })

  it('an unreachable Cloud keeps the cached version, marked stale; the next good answer clears the mark', async () => {
    const { service, state } = rig()
    await service.refresh()
    state.answer = new Error('fetch failed')
    const status = await service.refresh()
    expect(status).toMatchObject({ state: 'ok', version: 3, stale: true })
    expect(service.forSeed()?.version).toBe(3)
    state.answer = published(3)
    expect((await service.refresh()).stale).toBe(false)
  })

  it('never cached before and unreachable: still the defaults', async () => {
    const { service, state } = rig()
    state.answer = new Error('down')
    expect(await service.refresh()).toMatchObject({ state: 'none' })
    expect(service.forSeed()).toBeNull()
  })

  it('the cache belongs to one Cloud address and to a connected app', async () => {
    const { service, state } = rig()
    await service.refresh()
    state.baseUrl = 'https://other.example.com'
    expect(service.forSeed()).toBeNull()
    expect(service.status().state).toBe('none')
    state.baseUrl = 'http://127.0.0.1:8787'
    expect(service.forSeed()?.version).toBe(3)
    state.connected = false
    expect(service.forSeed()).toBeNull()
    expect(service.status().state).toBe('not-connected')
  })

  it('refresh calls overlap into one request', async () => {
    const { service, state } = rig()
    await Promise.all([service.refresh(), service.refresh(), service.refresh()])
    expect(state.calls).toBe(1)
  })

  it('connecting fetches once at once; the periodic refresh runs every 30 minutes while connected', async () => {
    const { service, state } = rig()
    state.connected = false
    service.onConnectionChanged()
    service.start()
    expect(state.calls).toBe(0)
    state.connected = true
    service.onConnectionChanged()
    service.onConnectionChanged() // another change notice while connected: no second fetch
    await vi.advanceTimersByTimeAsync(0)
    expect(state.calls).toBe(1)
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS)
    expect(state.calls).toBe(2)
    state.connected = false
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS)
    expect(state.calls).toBe(2)
    service.close()
    state.connected = true
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS * 2)
    expect(state.calls).toBe(2)
  })

  it('starting while already connected fetches right away', async () => {
    const { service, state } = rig()
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(state.calls).toBe(1)
    service.close()
  })
})
