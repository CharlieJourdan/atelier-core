// The two remote controls of a headless brain: the desktop's main process (src/main/brain: the token as an encrypted
// secret, renderer calls routed to the team computer, its events re-emitted to the window) and the web app's bridge
// (src/renderer/state/remote.ts, the module `window.atelier` is in the browser).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRAIN_METHODS, type ApiHandlers, type BrainStatus, type ChangeTopic, type EventContract } from '../../src/shared/api'
import { BRAIN_TOKEN_SECRET, BRAIN_URL_SETTING } from '../../src/main/brain/link'
import { routeCall } from '../../src/main/brain/route'
import { createRemoteBridge } from '../../src/renderer/state/remote'
import { SseParser, fromWire, normalizeBrainUrl, toWire } from '../../src/shared/brain-client'
import { memoryCore } from './helpers'
import { startTestBrain, type TestBrain } from './headless-helpers'

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('desktop main process as a remote control (BrainLink + routeCall)', () => {
  let brain: TestBrain
  beforeEach(async () => {
    brain = await startTestBrain()
  })
  afterEach(async () => {
    await brain.stop()
  })

  it('a wrong token is refused and nothing is kept; the app stays on its own brain', async () => {
    const app = memoryCore()
    try {
      await expect(app.api['brain.connect']({ url: brain.url, token: 'atb_wrong' })).rejects.toThrow(/Jeton/)
      expect(app.api['brain.status']()).toMatchObject({ mode: 'local', tokenSet: false })
      expect(app.context.secrets.has(BRAIN_TOKEN_SECRET)).toBe(false)
      await expect(app.api['brain.connect']({ url: 'ftp://x', token: 't' })).rejects.toThrow(/Adresse invalide/)
      await expect(app.api['brain.connect']({ url: 'http://u:p@127.0.0.1:1', token: 't' })).rejects.toThrow(/identifiant/)
    } finally {
      app.close()
    }
  })

  it('once connected, renderer calls are answered by the team computer and its events reach the window', async () => {
    const notified: ChangeTopic[] = []
    const streamed: EventContract['atelier:stream'][] = []
    const app = memoryCore({ notify: (t) => notified.push(t), emitStream: (p) => streamed.push(p), brain: { retryMs: () => 50 } })
    try {
      app.api['channels.create']({ name: 'Local only' })
      const status = await app.api['brain.connect']({ url: `${brain.url}/`, token: brain.token })
      expect(status).toMatchObject({ mode: 'remote', url: brain.url, tokenSet: true, storage: 'secret' })
      expect(status.name).toBeTruthy()
      // the token is an encrypted secret: not in the settings, not in the status
      expect(JSON.stringify(app.context.settings.all())).not.toContain(brain.token)
      expect(JSON.stringify(status)).not.toContain(brain.token)
      expect(app.context.settings.get(BRAIN_URL_SETTING)).toBe(brain.url)
      // settings.set cannot repoint the link behind brain.connect's back
      expect(() => app.api['settings.set']('brain.url', 'http://evil')).toThrow()

      brain.core.api['channels.create']({ name: 'On the team computer' })
      const remote = await routeCall(app.api, app.brainLink, 'channels.list', [])
      expect(remote).toMatchObject({ ok: true })
      expect((remote as { value: { name: string }[] }).value.map((c) => c.name)).toEqual(['On the team computer'])
      // the link's own methods and the window theme stay local
      expect(await routeCall(app.api, app.brainLink, 'brain.status', [])).toMatchObject({ ok: true, value: { mode: 'remote' } })
      expect(await routeCall(app.api, app.brainLink, 'app.setTheme', ['dark'])).toEqual({ ok: true })
      // an unknown method gets the remote's answer, the same as the local bus
      expect(await routeCall(app.api, app.brainLink, 'nope', [])).toEqual(await routeCall(app.api, null, 'nope', []))

      // events: a write on the team computer refreshes this app's views
      await until(() => (app.api['brain.status']() as BrainStatus).live)
      notified.length = 0
      brain.core.api['channels.create']({ name: 'Second' })
      await until(() => notified.includes('channels'))
      brain.hub.publish('atelier:stream', { streamId: 's1', conversationId: 1, delta: 'Bonjour' })
      await until(() => streamed.length > 0)
      expect(streamed[0]).toEqual({ streamId: 's1', conversationId: 1, delta: 'Bonjour' })

      expect(app.api['brain.disconnect']()).toMatchObject({ mode: 'local', tokenSet: false })
      expect(app.context.secrets.has(BRAIN_TOKEN_SECRET)).toBe(false)
      const local = await routeCall(app.api, app.brainLink, 'channels.list', [])
      expect((local as { value: { name: string }[] }).value.map((c) => c.name)).toEqual(['Local only'])
    } finally {
      app.close()
    }
  })
})

describe('web app bridge (renderer state/remote.ts)', () => {
  let brain: TestBrain
  beforeEach(async () => {
    brain = await startTestBrain()
  })
  afterEach(async () => {
    await brain.stop()
  })

  it('unwraps results and errors like the preload, answers local methods in the page, relays events', async () => {
    const onState = vi.fn()
    const bridge = createRemoteBridge({ url: brain.url, token: brain.token }, { local: { 'app.setTheme': () => null }, onState, retryMs: () => 50 })
    try {
      expect((await bridge.call('app.info')).name).toBe('Atelier')
      await expect(bridge.call('app.setTheme', 'light')).resolves.toBeNull()
      const err = await bridge.call('production.revealPackage', 1).catch((e: Error) => e)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('UNAVAILABLE_REMOTE')
      const topics: string[] = []
      bridge.on('atelier:changed', (p) => topics.push(p.topic))
      await until(() => onState.mock.calls.some(([s]) => (s as { live: boolean }).live))
      await bridge.call('channels.create', { name: 'Web' })
      await until(() => topics.includes('channels'))
    } finally {
      bridge.close()
    }
  })

  it('a wrong token is a clear error, the event stream stops on 401', async () => {
    const onState = vi.fn()
    const bridge = createRemoteBridge({ url: brain.url, token: 'atb_nope' }, { onState })
    try {
      await expect(bridge.call('app.info')).rejects.toMatchObject({ name: 'UNAUTHORIZED' })
      bridge.on('atelier:changed', () => undefined)
      await until(() => onState.mock.calls.length > 0)
      expect(onState).toHaveBeenLastCalledWith({ live: false, error: expect.stringMatching(/Jeton/) })
    } finally {
      bridge.close()
    }
  })

  it('an unreachable brain is a French error, not a crash', async () => {
    const bridge = createRemoteBridge({ url: 'http://127.0.0.1:1', token: 't' })
    await expect(bridge.call('app.info')).rejects.toMatchObject({ name: 'BRAIN_UNREACHABLE', message: expect.stringMatching(/tunnel SSH/) })
    bridge.close()
  })
})

describe('brain-client helpers', () => {
  it('parses SSE across chunk boundaries, CRLF, comments and multi-line data', () => {
    const p = new SseParser()
    expect(p.push(': ping\n\nevent: chan')).toEqual([])
    expect(p.push('ged\r\ndata: {"topic":\r\ndata: "x"}\r\n\r\nevent: stream\ndata: 1\n\n')).toEqual([
      { event: 'changed', data: '{"topic":\n"x"}' },
      { event: 'stream', data: '1' }
    ])
  })

  it('normalizes addresses', () => {
    expect(normalizeBrainUrl(' http://127.0.0.1:8790/ ')).toBe('http://127.0.0.1:8790')
    expect(normalizeBrainUrl('https://brain.example/atelier/')).toBe('https://brain.example/atelier')
    expect(() => normalizeBrainUrl('http://x/?token=1')).toThrow()
    expect(() => normalizeBrainUrl('javascript:alert(1)')).toThrow()
  })

  it('refuses plain http to another machine: the token would cross the network in clear (https, or the loopback)', () => {
    for (const ok of ['http://localhost:8790', 'http://127.0.0.2:8790', 'http://[::1]:8790', 'https://192.168.1.20:8790', 'https://brain.example']) {
      expect(normalizeBrainUrl(ok), ok).toBe(ok)
    }
    for (const bad of ['http://192.168.1.20:8790', 'http://brain.example', 'http://127.0.0.1.evil.example', 'http://localhost.evil.example:8790', 'http://0.0.0.0:8790']) {
      expect(() => normalizeBrainUrl(bad), bad).toThrow(/en clair/)
    }
  })
})

describe('bytes over the wire', () => {
  it('Uint8Array and Buffer survive toWire → JSON → fromWire (production.file over HTTP)', () => {
    const value = { name: 'a.mp4', size: 3, bytes: Buffer.from([0, 255, 7]), list: [new Uint8Array([1, 2])], nested: Object.assign(Object.create(null), { b: new Uint8Array(70_000).fill(9) }) }
    const back = fromWire(JSON.parse(JSON.stringify(toWire(value)))) as { bytes: Uint8Array; list: Uint8Array[]; nested: { b: Uint8Array }; name: string }
    expect(back.name).toBe('a.mp4')
    expect([...back.bytes]).toEqual([0, 255, 7])
    expect(back.bytes).toBeInstanceOf(Uint8Array)
    expect([...(back.list[0] as Uint8Array)]).toEqual([1, 2])
    expect(back.nested.b.length).toBe(70_000)
    expect(back.nested.b[69_999]).toBe(9)
  })

  it('a method returning bytes reaches the remote caller as bytes', async () => {
    const { createBrainServer } = await import('../../src/main/headless/server')
    const { EventHub } = await import('../../src/main/headless/events')
    const api = { 'production.file': () => ({ name: 'f', mime: 'video/mp4', size: 2, bytes: Buffer.from([4, 2]) }) } as unknown as ApiHandlers
    const server = createBrainServer({ api, hub: new EventHub(), tokens: { verifyHeader: (h) => h === 'Bearer ok' } })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    try {
      const port = (server.address() as { port: number }).port
      const bridge = createRemoteBridge({ url: `http://127.0.0.1:${port}`, token: 'ok' })
      const file = await bridge.call('production.file', 1, 'x')
      expect(file.bytes).toBeInstanceOf(Uint8Array)
      expect([...file.bytes]).toEqual([4, 2])
      bridge.close()
    } finally {
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
    }
  })
})

describe('brain.* contract', () => {
  it('lists its three methods', () => {
    // status: local or remote, the address, the name, « set / not set » for the token, live events, last error
    // connect: checks address + token against the brain before keeping them (token encrypted by main)
    // disconnect: forgets both, the app's own core answers again
    expect([...BRAIN_METHODS]).toEqual(['brain.status', 'brain.connect', 'brain.disconnect'])
    const app = memoryCore()
    try {
      expect(app.api['brain.status']()).toEqual({ mode: 'local', url: null, name: null, tokenSet: false, live: false, error: null, storage: null })
    } finally {
      app.close()
    }
  })
})
