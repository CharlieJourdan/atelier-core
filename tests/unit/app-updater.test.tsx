// The app updating itself: the state machine (check, download, ready, install, errors, channel), its schedule (a first check
// shortly after start, then every 4 hours), the `app.update.*` IPC methods on a real core with a fake updater, the wrapper
// around electron-updater's `autoUpdater` (events, feed, flags) and the Réglages › À propos block. No network, no Electron.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { API_METHODS, type UpdateStatus } from '../../src/shared/api'
import { CHECK_EVERY_MS, FIRST_CHECK_DELAY_MS, UpdateService, type DriverEvent, type UpdaterDriver } from '../../src/main/updater/service'
import { driverFor, notesOf } from '../../src/main/updater/electron-driver'
import { SettingsStore } from '../../src/main/settings'
import { openDatabase } from '../../src/main/db'
import { setLocale } from '../../src/shared/fr'
import { UpdateBody, updateLine } from '../../src/renderer/screens/settings/prefs/UpdateBlock'
import { memoryCore } from './helpers'

/** A fake updater: records what it is asked, and plays the events a script gives it. */
class FakeDriver implements UpdaterDriver {
  feeds: string[] = []
  checks = 0
  installs = 0
  listeners = new Set<(e: DriverEvent) => void>()
  /** What a check does: events to emit, or an error to throw. */
  script: (DriverEvent | Error)[] = []
  setFeed(url: string): void {
    this.feeds.push(url)
  }
  async check(): Promise<void> {
    this.checks++
    for (const step of this.script) {
      if (step instanceof Error) throw step
      this.emit(step)
    }
  }
  quitAndInstall(): void {
    this.installs++
  }
  subscribe(l: (e: DriverEvent) => void): () => void {
    this.listeners.add(l)
    return () => void this.listeners.delete(l)
  }
  emit(e: DriverEvent): void {
    for (const l of this.listeners) l(e)
  }
}

function rig(o: { unsupported?: 'dev' | 'platform' | 'headless' | null; platform?: string; cloud?: string } = {}) {
  const driver = new FakeDriver()
  const settings = new SettingsStore(openDatabase(':memory:'))
  let cloud = o.cloud ?? 'http://127.0.0.1:8787'
  let now = Date.parse('2026-10-25T10:00:00.000Z')
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = []
  let created = 0
  let notified = 0
  const service = new UpdateService({
    settings,
    currentVersion: '0.1.0',
    cloudUrl: () => cloud,
    unsupported: o.unsupported ?? null,
    createDriver: async () => (created++, driver),
    osPlatform: o.platform ?? 'win32',
    notify: () => void notified++,
    now: () => now,
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false }
      timers.push(t)
      return () => void (t.cancelled = true)
    }
  })
  return {
    driver,
    service,
    settings,
    timers,
    created: () => created,
    notified: () => notified,
    setCloud: (u: string) => (cloud = u),
    advance: (ms: number) => (now += ms)
  }
}

describe('update service', () => {
  it('a development build never updates itself: no updater is loaded, nothing is scheduled', async () => {
    const r = rig({ unsupported: 'dev' })
    expect(r.service.status()).toMatchObject({ phase: 'unsupported', unsupported: 'dev', current: '0.1.0', available: null })
    expect((await r.service.check()).phase).toBe('unsupported')
    r.service.start()
    expect(r.created()).toBe(0)
    expect(r.timers).toEqual([])
    expect(() => r.service.install()).toThrow(/Aucune mise à jour/)
  })

  it('looks at the feed of its channel and platform; nothing newer: idle, checked', async () => {
    const r = rig()
    expect(r.service.status()).toMatchObject({ phase: 'idle', channel: 'beta', checkedAt: null, feedUrl: 'http://127.0.0.1:8787/v1/updates/beta/win' })
    r.driver.script = [{ type: 'none' }]
    const s = await r.service.check()
    expect(r.driver.feeds).toEqual(['http://127.0.0.1:8787/v1/updates/beta/win'])
    expect(s).toMatchObject({ phase: 'idle', available: null, percent: null, error: null, checkedAt: '2026-10-25T10:00:00.000Z' })
    // an updater that says nothing at all means nothing newer, too
    r.driver.script = []
    r.advance(1000)
    expect((await r.service.check()).phase).toBe('idle')
    expect(r.driver.checks).toBe(2)
  })

  it('the macOS feed is the mac one, and the Cloud address and the channel are read at each check', async () => {
    const r = rig({ platform: 'darwin' })
    await r.service.check()
    r.setCloud('https://api.example.org')
    await r.service.setChannel('stable')
    expect(r.driver.feeds).toEqual(['http://127.0.0.1:8787/v1/updates/beta/mac', 'https://api.example.org/v1/updates/stable/mac'])
    expect(r.service.status().platform).toBe('mac')
  })

  it('finds a newer version, downloads it in the background, and is ready to install', async () => {
    const r = rig()
    r.driver.script = [{ type: 'available', version: '0.2.0', notes: 'Le panneau Versions' }, { type: 'progress', percent: 42.4 }]
    const s = await r.service.check()
    expect(s).toMatchObject({ phase: 'downloading', available: '0.2.0', notes: 'Le panneau Versions', percent: 42 })
    // a check asked meanwhile does not ask the updater again
    expect((await r.service.check()).phase).toBe('downloading')
    expect(r.driver.checks).toBe(1)
    expect(() => r.service.install()).toThrow(/Aucune mise à jour/)

    r.driver.emit({ type: 'progress', percent: 100 })
    r.driver.emit({ type: 'downloaded', version: '0.2.0' })
    expect(r.service.status()).toMatchObject({ phase: 'ready', available: '0.2.0', percent: 100, notes: 'Le panneau Versions' })
    expect((await r.service.check()).phase).toBe('ready') // nothing more to look for
    r.service.install()
    expect(r.driver.installs).toBe(1)
    expect(r.notified()).toBeGreaterThanOrEqual(4)
  })

  it('a failed check shows a plain sentence, and the next check recovers', async () => {
    const r = rig()
    r.driver.script = [new Error('getaddrinfo ENOTFOUND api.example.org\n    at somewhere')]
    const s = await r.service.check()
    expect(s.phase).toBe('error')
    expect(s.error).toBe('La recherche de mise à jour a échoué : getaddrinfo ENOTFOUND api.example.org')
    expect(s.checkedAt).not.toBeNull()
    r.driver.script = [{ type: 'none' }]
    expect(await r.service.check()).toMatchObject({ phase: 'idle', error: null })
  })

  it('an error event of the updater while downloading is shown; an update already downloaded stays installable', async () => {
    const r = rig()
    r.driver.script = [{ type: 'available', version: '0.2.0', notes: null }]
    await r.service.check()
    r.driver.emit({ type: 'error', message: 'net::ERR_CONNECTION_RESET' })
    expect(r.service.status()).toMatchObject({ phase: 'error', error: expect.stringContaining('ERR_CONNECTION_RESET') })

    const ready = rig()
    ready.driver.script = [{ type: 'available', version: '0.2.0', notes: null }, { type: 'downloaded', version: '0.2.0' }]
    await ready.service.check()
    ready.driver.emit({ type: 'error', message: 'later failure' })
    expect(ready.service.status().phase).toBe('ready')
    ready.service.install()
    expect(ready.driver.installs).toBe(1)
  })

  it('chooses the channel (beta by default), remembers it, and checks on it; not during a download', async () => {
    const r = rig()
    expect(r.service.channel()).toBe('beta')
    await expect(r.service.setChannel('nightly')).rejects.toThrow(/Canal inconnu/)
    r.driver.script = [{ type: 'none' }]
    const s = await r.service.setChannel('stable')
    expect(s.channel).toBe('stable')
    expect(r.settings.get('update.channel')).toBe('stable')
    expect(r.driver.feeds.at(-1)).toBe('http://127.0.0.1:8787/v1/updates/stable/win')
    expect(r.service.status().feedUrl).toContain('/stable/')

    r.driver.script = [{ type: 'available', version: '0.3.0', notes: null }]
    await r.service.setChannel('beta')
    await expect(r.service.setChannel('stable')).rejects.toThrow(/en cours/)
    expect(r.service.channel()).toBe('beta')
  })

  it('looks once shortly after start, then every 4 hours, and stops when closed', async () => {
    const r = rig()
    r.driver.script = [{ type: 'none' }]
    r.service.start()
    r.service.start() // once
    expect(r.timers.map((t) => t.ms)).toEqual([FIRST_CHECK_DELAY_MS])
    r.timers[0]?.fn()
    await new Promise((res) => setImmediate(res))
    await new Promise((res) => setImmediate(res))
    expect(r.driver.checks).toBe(1)
    expect(r.timers.map((t) => t.ms)).toEqual([FIRST_CHECK_DELAY_MS, CHECK_EVERY_MS])
    expect(CHECK_EVERY_MS).toBe(4 * 60 * 60 * 1000)
    r.timers[1]?.fn()
    await new Promise((res) => setImmediate(res))
    await new Promise((res) => setImmediate(res))
    expect(r.driver.checks).toBe(2)
    expect(r.timers).toHaveLength(3)
    r.service.close()
    expect(r.timers[2]?.cancelled).toBe(true)
    expect((await r.service.check()).phase).toBe('idle')
    expect(r.driver.checks).toBe(2)
  })

  it('a scheduled check that fails does not stop the schedule', async () => {
    const r = rig()
    r.driver.script = [new Error('offline')]
    r.service.start()
    r.timers[0]?.fn()
    await new Promise((res) => setImmediate(res))
    await new Promise((res) => setImmediate(res))
    expect(r.service.status().phase).toBe('error')
    expect(r.timers).toHaveLength(2)
  })

  it('an updater that cannot be loaded is a failed check, tried again next time', async () => {
    const settings = new SettingsStore(openDatabase(':memory:'))
    let tries = 0
    const driver = new FakeDriver()
    const service = new UpdateService({
      settings,
      currentVersion: '0.1.0',
      cloudUrl: () => 'http://127.0.0.1:8787',
      unsupported: null,
      createDriver: async () => {
        if (tries++ === 0) throw new Error('Cannot find module')
        return driver
      },
      notify: () => undefined
    })
    expect((await service.check()).phase).toBe('error')
    driver.script = [{ type: 'none' }]
    expect((await service.check()).phase).toBe('idle')
  })
})

describe('app.update.* on a core', () => {
  it('lists the four methods in the contract', () => {
    for (const m of ['app.update.status', 'app.update.check', 'app.update.install', 'app.update.setChannel']) expect(API_METHODS).toContain(m)
  })

  it('a core without an updater (the headless brain, plain tests) reports that it does not update itself', async () => {
    const core = memoryCore({ appVersion: '1.2.3' })
    expect(await core.api['app.update.status']()).toMatchObject({ phase: 'unsupported', unsupported: 'headless', current: '1.2.3' })
    expect((await core.api['app.update.check']()).phase).toBe('unsupported')
    await expect(core.api['app.update.install']()).rejects.toThrow(/Aucune mise à jour/)
    core.close()
  })

  it('with a fake updater: check, download, install, channel, and the change topic', async () => {
    const driver = new FakeDriver()
    const topics: string[] = []
    const core = memoryCore({
      appVersion: '0.1.0',
      platform: 'win32',
      notify: (topic) => void topics.push(topic),
      updates: { createDriver: async () => driver, firstCheckDelayMs: 1 }
    })
    driver.script = [{ type: 'available', version: '0.2.0', notes: 'Notes' }]
    expect(await core.api['app.update.check']()).toMatchObject({ phase: 'downloading', available: '0.2.0', notes: 'Notes' })
    driver.emit({ type: 'downloaded', version: '0.2.0' })
    expect((await core.api['app.update.status']()).phase).toBe('ready')
    await core.api['app.update.install']()
    expect(driver.installs).toBe(1)
    expect(topics).toContain('update')

    const fresh = memoryCore({ updates: { createDriver: async () => driver } })
    driver.script = [{ type: 'none' }]
    expect(await fresh.api['app.update.setChannel']('stable')).toMatchObject({ channel: 'stable', phase: 'idle' })
    await expect(fresh.api['app.update.setChannel']('x' as never)).rejects.toThrow(/Canal inconnu/)
    expect((fresh.context.settings.get('update.channel'))).toBe('stable')
    core.close()
    fresh.close()
  })
})

/** A stand-in for electron-updater's `autoUpdater`. */
function fakeAutoUpdater() {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>()
  const calls: unknown[][] = []
  const u = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowDowngrade: true,
    logger: 'real logger' as unknown,
    setFeedURL: (o: unknown) => void calls.push(['setFeedURL', o]),
    checkForUpdates: async () => void calls.push(['checkForUpdates']),
    quitAndInstall: (...a: unknown[]) => void calls.push(['quitAndInstall', ...a]),
    on(ev: string, l: (...a: unknown[]) => void) {
      if (!handlers.has(ev)) handlers.set(ev, new Set())
      handlers.get(ev)?.add(l)
      return u
    },
    removeListener(ev: string, l: (...a: unknown[]) => void) {
      handlers.get(ev)?.delete(l)
      return u
    }
  }
  return { u, calls, emit: (ev: string, ...a: unknown[]) => handlers.get(ev)?.forEach((l) => l(...a)), count: () => [...handlers.values()].reduce((n, s) => n + s.size, 0) }
}

describe('the electron-updater wrapper', () => {
  it('downloads by itself, installs on quit, never goes back a version, and points at the generic feed', async () => {
    const f = fakeAutoUpdater()
    const d = driverFor(f.u)
    expect(f.u).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: true, allowDowngrade: false, logger: null })
    d.setFeed('https://api.example.org/v1/updates/beta/win')
    await d.check()
    d.quitAndInstall()
    expect(f.calls).toEqual([
      ['setFeedURL', { provider: 'generic', url: 'https://api.example.org/v1/updates/beta/win', channel: 'latest' }],
      ['checkForUpdates'],
      ['quitAndInstall', true, true]
    ])
  })

  it("turns the updater's events into ours, and stops listening when asked", () => {
    const f = fakeAutoUpdater()
    const seen: DriverEvent[] = []
    const stop = driverFor(f.u).subscribe((e) => seen.push(e))
    f.emit('update-available', { version: '0.2.0', releaseNotes: 'Nouveau' })
    f.emit('download-progress', { percent: 12.5, bytesPerSecond: 1, total: 2, transferred: 1 })
    f.emit('update-downloaded', { version: '0.2.0', releaseNotes: [{ version: '0.2.0', note: 'Un' }, { version: '0.1.5', note: 'Deux' }] })
    f.emit('update-not-available', {})
    f.emit('error', new Error('boom'))
    expect(seen).toEqual([
      { type: 'available', version: '0.2.0', notes: 'Nouveau' },
      { type: 'progress', percent: 12.5 },
      { type: 'downloaded', version: '0.2.0', notes: 'Un\n\nDeux' },
      { type: 'none' },
      { type: 'error', message: 'boom' }
    ])
    stop()
    expect(f.count()).toBe(0)
    f.emit('error', new Error('after'))
    expect(seen).toHaveLength(5)
  })

  it('reads release notes of every shape', () => {
    expect(notesOf('  Un  ')).toBe('Un')
    expect(notesOf('')).toBeNull()
    expect(notesOf(null)).toBeNull()
    expect(notesOf([{ note: 'A' }, { note: null }, 3])).toBe('A')
  })

  it('works with the real service end to end', async () => {
    const f = fakeAutoUpdater()
    const settings = new SettingsStore(openDatabase(':memory:'))
    const service = new UpdateService({ settings, currentVersion: '0.1.0', cloudUrl: () => 'http://127.0.0.1:8787', unsupported: null, createDriver: async () => driverFor(f.u), notify: () => undefined })
    f.u.checkForUpdates = async () => void f.emit('update-available', { version: '0.2.0' })
    expect((await service.check()).phase).toBe('downloading')
    f.emit('update-downloaded', { version: '0.2.0' })
    service.install()
    expect(f.calls.at(-1)).toEqual(['quitAndInstall', true, true])
  })
})

describe('Réglages › À propos › Mises à jour', () => {
  const base: UpdateStatus = {
    phase: 'idle',
    unsupported: null,
    current: '0.1.0',
    channel: 'beta',
    available: null,
    notes: null,
    percent: null,
    checkedAt: '2026-10-25T10:00:00.000Z',
    error: null,
    platform: 'win',
    feedUrl: 'http://127.0.0.1:8787/v1/updates/beta/win'
  }
  const html = (s: Partial<UpdateStatus>, busy = false): string => renderToStaticMarkup(<UpdateBody status={{ ...base, ...s }} busy={busy} onCheck={() => undefined} onInstall={() => undefined} onChannel={() => undefined} />)

  it('shows the version, the channel switch, the check button and the unsigned-installer help on Windows', () => {
    const h = html({})
    expect(h).toContain('0.1.0')
    expect(h).toContain('Version installée')
    expect(h).toContain('Bêta')
    expect(h).toContain('Stable')
    expect(h).toContain('aria-pressed="true"')
    expect(h).toContain('Rechercher des mises à jour')
    expect(h).toContain('Atelier est à jour.')
    expect(h).toContain('SmartScreen')
    expect(h).not.toContain('app signée')
    expect(h).toContain('toutes les 4 heures')
    expect(h).not.toMatch(/undefined|NaN|\[object/)
  })

  it('shows the progress while downloading, with the notes, and « Redémarrer pour installer » when ready', () => {
    const d = html({ phase: 'downloading', available: '0.2.0', percent: 40, notes: 'Ligne un\nLigne deux' })
    expect(d).toContain('Téléchargement de la version 0.2.0 : 40 %')
    expect(d).toContain('role="progressbar"')
    expect(d).toContain('aria-valuenow="40"')
    expect(d).toContain('Nouveautés de la version 0.2.0')
    expect(d).toContain('Ligne un')
    expect(d).not.toContain('data-testid="update-install"')
    const r = html({ phase: 'ready', available: '0.2.0', percent: 100 })
    expect(r).toContain('Redémarrer pour installer')
    expect(r).toContain('data-testid="update-install"')
    expect(r).toContain('quand tu fermeras Atelier')
    expect(r).not.toContain('data-testid="update-check"')
  })

  it('says what failed, what is not supported, and the Mac signing caveat', () => {
    expect(html({ phase: 'error', error: 'La recherche de mise à jour a échoué : hors ligne' })).toContain('hors ligne')
    const dev = html({ phase: 'unsupported', unsupported: 'dev', checkedAt: null })
    expect(dev).toContain('ne se met pas à jour toute seule')
    expect(dev).not.toContain('data-testid="update-check"')
    const mac = html({ platform: 'mac' })
    expect(mac).toContain('app signée')
    expect(mac).not.toContain('SmartScreen')
  })

  it('has a line in English too', () => {
    setLocale('en')
    try {
      expect(updateLine({ ...base, phase: 'ready', available: '0.2.0' })).toBe('Version 0.2.0 is ready to install.')
      expect(html({ phase: 'idle' })).toContain('Check for updates')
    } finally {
      setLocale('fr')
    }
  })

  it('disables the buttons while busy or checking', () => {
    expect(html({}, true)).toMatch(/<button[^>]*disabled=""[^>]*data-testid="update-check"|data-testid="update-check"[^>]*disabled=""/)
    expect(html({ phase: 'checking' })).toContain('Recherche en cours…')
  })
})
