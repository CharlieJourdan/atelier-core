// Lot Z1, Accueil / Validations / Ordinateurs: stores, IPC handlers, error paths, example seed and clear.
import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { HOME_METHODS } from '../../src/shared/api'
import { BrowsersStore, MachinesStore, checkHost, checkStartUrl } from '../../src/main/home/computers'
import { readInbox } from '../../src/main/home/overview'
import { memoryCore } from './helpers'

async function listen(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((s) => s.end())
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as net.AddressInfo).port
  return { port, close: () => new Promise<void>((r) => server.close(() => r())) }
}

async function freePort(): Promise<number> {
  const s = await listen()
  await s.close()
  return s.port
}

describe('home api surface', () => {
  it('lists its IPC methods (one comment per method)', () => {
    expect([...HOME_METHODS]).toEqual([
      'home.overview', // everything the dashboard shows, in one call
      'home.inbox', // workflow approvals and production gates waiting for the owner
      'browsers.list', // agent browser sessions, open ones first
      'browsers.open', // opens a session for an agent role on an http(s) address
      'browsers.close', // closes an open session
      'browsers.remove', // removes a closed session
      'machines.list', // the declared remote machines
      'machines.add', // declares a machine (name, OS, host, port)
      'machines.rename', // renames a machine
      'machines.remove', // removes a machine
      'machines.test' // TCP connect to host:port, records status and last seen
    ])
  })
})

describe('browser sessions', () => {
  it('opens, closes and removes a session, notifying the computers topic', async () => {
    const topics: string[] = []
    const core = memoryCore({ notify: (t) => topics.push(t) })
    try {
      const s = await core.api['browsers.open']({ role: 'researcher', startUrl: 'https://example.org' })
      expect(s).toMatchObject({ role: 'researcher', status: 'open', startUrl: 'https://example.org/', screenshotPath: null, example: false })
      expect(s.agentName).not.toBe('')
      expect(await core.api['browsers.list']()).toHaveLength(1)
      await expect(Promise.resolve().then(() => core.api['browsers.remove'](s.id))).rejects.toThrow('Ferme la session')
      expect((await core.api['browsers.close'](s.id)).status).toBe('closed')
      await expect(Promise.resolve().then(() => core.api['browsers.close'](s.id))).rejects.toThrow('déjà fermée')
      await core.api['browsers.remove'](s.id)
      expect(await core.api['browsers.list']()).toEqual([])
      expect(topics.filter((t) => t === 'computers')).toHaveLength(3)
    } finally {
      core.close()
    }
  })

  it('refuses bad arguments with French messages', async () => {
    const core = memoryCore()
    try {
      const open = (input: unknown) => Promise.resolve().then(() => core.api['browsers.open'](input as never))
      await expect(open({ role: 'nobody', startUrl: 'https://a.fr' })).rejects.toThrow('n’existe pas')
      await expect(open({ role: 'researcher', startUrl: 'javascript:alert(1)' })).rejects.toThrow('http et https')
      await expect(open({ role: 'researcher', startUrl: 'pas une adresse' })).rejects.toThrow('invalide')
      await expect(open({ role: 'researcher', startUrl: '' })).rejects.toThrow('à renseigner')
      await expect(open({ role: 42, startUrl: 'https://a.fr' })).rejects.toThrow('texte attendu')
      await expect(open(null)).rejects.toThrow('Session invalide')
      await expect(Promise.resolve().then(() => core.api['browsers.close'](999))).rejects.toThrow('introuvable')
      await expect(Promise.resolve().then(() => core.api['browsers.close']('1' as never))).rejects.toThrow('identifiant invalide')
      expect(await core.api['browsers.list']()).toEqual([])
    } finally {
      core.close()
    }
  })

  it('validates addresses', () => {
    expect(checkStartUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x')
    expect(() => checkStartUrl('ftp://a.fr')).toThrow('http et https')
    expect(checkHost('h1.local')).toBe('h1.local')
    expect(checkHost('192.168.1.42')).toBe('192.168.1.42')
    expect(checkHost('[::1]')).toBe('::1')
    for (const bad of ['http://h1', 'h1/chemin', 'a b', '-x.fr', 'x..fr']) expect(() => checkHost(bad)).toThrow('Adresse invalide')
  })

  it('works as a plain store too', () => {
    const core = memoryCore()
    try {
      const store = new BrowsersStore(core.db, (r) => (r === 'researcher' ? 'Chercheur' : null))
      expect(store.open({ role: 'researcher', startUrl: 'https://a.fr' }).agentName).toBe('Chercheur')
    } finally {
      core.close()
    }
  })
})

describe('machines', () => {
  it('adds, renames and removes a machine', async () => {
    const topics: string[] = []
    const core = memoryCore({ notify: (t) => topics.push(t) })
    try {
      const m = await core.api['machines.add']({ name: ' H1 ', os: 'windows', host: '192.168.1.42' })
      expect(m).toMatchObject({ name: 'H1', os: 'windows', host: '192.168.1.42', port: 22, status: 'unknown', lastSeenAt: null, example: false })
      expect((await core.api['machines.rename'](m.id, 'Le PC du bureau')).name).toBe('Le PC du bureau')
      expect(await core.api['machines.list']()).toHaveLength(1)
      await core.api['machines.remove'](m.id)
      expect(await core.api['machines.list']()).toEqual([])
      expect(topics.filter((t) => t === 'computers')).toHaveLength(3)
    } finally {
      core.close()
    }
  })

  it('refuses bad arguments with French messages', async () => {
    const core = memoryCore()
    try {
      const add = (input: unknown) => Promise.resolve().then(() => core.api['machines.add'](input as never))
      await expect(add({ name: '', os: 'windows', host: 'h1' })).rejects.toThrow('à renseigner')
      await expect(add({ name: 'x', os: 'beos', host: 'h1' })).rejects.toThrow('Système inconnu')
      await expect(add({ name: 'x', os: 'linux', host: 'http://h1' })).rejects.toThrow('Adresse invalide')
      await expect(add({ name: 'x', os: 'linux', host: 'h1', port: 70000 })).rejects.toThrow('Port invalide')
      await expect(add({ name: 'x', os: 'linux', host: 'h1', port: 22.5 })).rejects.toThrow('Port invalide')
      await expect(add({ name: 'x'.repeat(81), os: 'linux', host: 'h1' })).rejects.toThrow('80 caractères')
      await expect(add(undefined)).rejects.toThrow('Machine invalide')
      await expect(Promise.resolve().then(() => core.api['machines.rename'](1, 'x'))).rejects.toThrow('introuvable')
      await expect(Promise.resolve().then(() => core.api['machines.remove'](-1))).rejects.toThrow('identifiant invalide')
      await expect(core.api['machines.test'](5)).rejects.toThrow('introuvable')
      expect(await core.api['machines.list']()).toEqual([])
    } finally {
      core.close()
    }
  })

  it('tests a real TCP connection: reachable on an open port, unreachable on a closed one', async () => {
    const core = memoryCore()
    const open = await listen()
    try {
      const up = await core.api['machines.add']({ name: 'Local', os: 'linux', host: '127.0.0.1', port: open.port })
      const ok = await core.api['machines.test'](up.id)
      expect(ok.ok).toBe(true)
      expect(ok.ms).toBeGreaterThanOrEqual(0)
      expect(ok.message).toContain('répond sur 127.0.0.1')
      expect(ok.machine).toMatchObject({ status: 'reachable', lastError: null })
      expect(ok.machine.lastSeenAt).not.toBeNull()

      const down = await core.api['machines.add']({ name: 'Fermé', os: 'linux', host: '127.0.0.1', port: await freePort() })
      const ko = await core.api['machines.test'](down.id)
      expect(ko.ok).toBe(false)
      expect(ko.ms).toBeNull()
      expect(ko.machine).toMatchObject({ status: 'unreachable', lastSeenAt: null })
      expect(ko.machine.lastError).toContain('refusée')
      expect((await core.api['machines.list']()).map((m) => m.status)).toEqual(['reachable', 'unreachable'])
    } finally {
      await open.close()
      core.close()
    }
  })

  it('keeps the last-seen time when a later test fails, and reports a timeout from the probe', async () => {
    const core = memoryCore()
    try {
      let answer: { ok: true; ms: number } | { ok: false; error: string } = { ok: true, ms: 3 }
      const store = new MachinesStore(core.db, async () => answer, () => new Date('2026-10-20T10:00:00.000Z'))
      const m = store.add({ name: 'P', os: 'macos', host: 'p.local' })
      expect((await store.test(m.id)).machine.lastSeenAt).toBe('2026-10-20T10:00:00.000Z')
      answer = { ok: false, error: 'Aucune réponse au bout de 4 s.' }
      const r = await store.test(m.id)
      expect(r.machine).toMatchObject({ status: 'unreachable', lastSeenAt: '2026-10-20T10:00:00.000Z', lastError: 'Aucune réponse au bout de 4 s.' })
      expect(r.message).toContain('ne répond pas')
    } finally {
      core.close()
    }
  })
})

describe('inbox and overview', () => {
  it('is empty on a fresh core', async () => {
    const core = memoryCore()
    try {
      expect(await core.api['home.inbox']()).toEqual({ approvals: [], gates: [], total: 0 })
      const o = await core.api['home.overview']()
      expect(o.channels).toEqual([])
      expect(o.videos).toEqual([])
      expect(o.validations).toEqual({ total: 0, top: [] })
      expect(o.agents.recent).toEqual([])
      expect(o.spend.spentUsd).toBe(0)
      expect(o.credits.available).toBeGreaterThanOrEqual(0)
    } finally {
      core.close()
    }
  })

  it('lists a workflow deliverable waiting for approval, and the approval empties it', async () => {
    const core = memoryCore()
    try {
      const ch = await core.api['channels.create']({ name: 'Ma chaîne' })
      const v = await core.api['videos.create'](ch.id, { title: 'Ma vidéo' })
      const research = v.deliverables.find((d) => d.type === 'research')!
      const brief = v.deliverables.find((d) => d.type === 'thumbnail_brief')!
      await core.api['versions.add'](research.id, { content: 'faits' })
      await core.api['versions.add'](brief.id, { content: 'brief' })
      const inbox = await core.api['home.inbox']()
      expect(inbox.total).toBe(1)
      expect(inbox.approvals[0]!.deliverable.type).toBe('thumbnail_brief')
      const o = await core.api['home.overview']()
      expect(o.validations).toEqual({
        total: 1,
        top: [{ kind: 'approval', key: `deliverable:${brief.id}`, title: 'Brief de miniature', videoTitle: 'Ma vidéo', channelName: 'Ma chaîne' }]
      })
      expect(o.channels).toEqual([expect.objectContaining({ name: 'Ma chaîne', example: false, waiting: 1, videosOpen: 1 })])
      expect(o.videos).toEqual([expect.objectContaining({ title: 'Ma vidéo', source: 'workflow', example: false })])
      await core.api['approvals.approve'](brief.id)
      expect((await core.api['home.inbox']()).total).toBe(0)
    } finally {
      core.close()
    }
  })

  it('turns a node waiting at a gate into an inbox item (runs stubbed)', () => {
    const core = memoryCore()
    try {
      const run = { id: 7, videoId: 3, videoTitle: 'Vidéo X', channelId: 1, channelName: 'Chaîne X', pipelineLabel: 'Atelier', demo: true }
      const node = (nodeId: string, gate: string, gateKind: string) => ({ nodeId, label: `N ${nodeId}`, gate, gateKind, step: nodeId === 'a' ? 'Script prêt' : null })
      const ctx = {
        workflow: core.context.workflow,
        productionRuns: {
          list: () => [run],
          get: () => ({ nodes: [node('a', 'waiting', 'review'), node('b', 'approved', 'review'), node('c', 'waiting', 'owner'), node('d', 'waiting', 'none')] })
        }
      }
      const inbox = readInbox(ctx as never)
      expect(inbox.gates.map((g) => [g.nodeId, g.gateKind, g.demo, g.step])).toEqual([
        ['a', 'review', true, 'Script prêt'],
        ['c', 'owner', true, null]
      ])
      expect(inbox.total).toBe(2)
    } finally {
      core.close()
    }
  })
})

describe('example workspace rows', () => {
  it('seeds one H1 machine and one browser session marked example, and clears them', async () => {
    const core = memoryCore()
    try {
      await core.api['example.load']()
      const machines = await core.api['machines.list']()
      expect(machines).toHaveLength(1)
      expect(machines[0]).toMatchObject({ example: true, os: 'windows', status: 'reachable' })
      const sessions = await core.api['browsers.list']()
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({ example: true, status: 'open', role: 'researcher' })
      // the example data shows on the dashboard with its channels
      const o = await core.api['home.overview']()
      expect(o.channels).toHaveLength(2)
      expect(o.channels.every((c) => c.example)).toBe(true)
      // a real machine survives the delete
      await core.api['machines.add']({ name: 'Réel', os: 'macos', host: 'mac.local' })
      await core.api['example.delete']()
      expect((await core.api['machines.list']()).map((m) => m.name)).toEqual(['Réel'])
      expect(await core.api['browsers.list']()).toEqual([])
    } finally {
      core.close()
    }
  })
})
