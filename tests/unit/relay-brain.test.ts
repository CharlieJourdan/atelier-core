// The team computer reached through Atelier Cloud, end to end on the loopback (docs/BRAIN-HEADLESS.md §7): a test Cloud
// on a random port, the real headless brain in this process pointed at it through an enrolment file. The brain enrols by
// itself (once; the file is gone, the credential is kept encrypted), keeps an outbound long poll, answers calls a person
// makes on the Cloud, refuses screen-only methods as its own /rpc does, and its events come back as SSE. The desktop app
// connects « via Atelier Cloud » with its Cloud session alone. A revoked credential stops the relay: « hors ligne ».
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BrainStatus, ChangeTopic } from '../../src/shared/api'
import { BRAIN_TOKEN_SECRET, BRAIN_VIA_SETTING } from '../../src/main/brain/link'
import { routeCall } from '../../src/main/brain/route'
import { parseHeadlessArgs } from '../../src/main/headless/config'
import { CLOUD_LINK_FILE, checkCloudUrl, neutraliseEnrolFile, parseEnrolFile } from '../../src/main/headless/cloud-link'
import { brainCall, cloudBrainEndpoint, openBrainEvents } from '../../src/shared/brain-client'
import { t as tr } from '../../src/shared/fr'
import { SITE_TOKENS_KEY, webCloudSession } from '../../src/renderer/web/cloud-session'
import { memoryCore } from './helpers'
import { startTestBrain, tempDir, type TestBrain } from './headless-helpers'

// The Cloud's sources import each other with .ts extensions, which the app's tsconfig does not allow: loaded through a
// computed path (typed here by hand), at collection time so its own afterEach cleanup applies to every test here.
interface Machine {
  id: string
}
interface CloudT {
  app: { listen(o: { host: string; port: number }): Promise<string> }
  cloud: {
    machines(): {
      provision(teamId: string, plan: string, actor: string): Promise<Machine[]>
      newEnrolToken(id: string, actor: string): string
      credentials: { revoke(id: string, actor: string): number }
    }
    relay: { isOnline(id: string): boolean; drop(id: string): void }
    relayAudit: { list(o?: { teamId?: string }): { method: string; outcome: string }[] }
    db: { prepare(sql: string): { all(): unknown[] } }
  }
}
interface PersonT {
  teamId: string
  accessToken: string
  refreshToken: string
}
const HELPERS = 'helpers'
const cloudTesting = (await import(`../../cloud/tests/${HELPERS}.ts`)) as {
  makeCloud(o?: Record<string, unknown>): CloudT
  signUpAndIn(t: CloudT): Promise<PersonT>
}

async function until(check: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function cloudWithMachine() {
  const t = cloudTesting.makeCloud({ relay: { timeoutMs: 10_000 } })
  const base = await t.app.listen({ host: '127.0.0.1', port: 0 })
  const owner = await cloudTesting.signUpAndIn(t)
  const [m] = await t.cloud.machines().provision(owner.teamId, 'starter', 'test')
  const machineId = (m as Machine).id
  const enrolToken = t.cloud.machines().newEnrolToken(machineId, 'test')
  return { t, base, owner, machineId, enrolToken }
}

async function enrolledBrain(base: string, enrolToken: string, machineOnline: () => boolean): Promise<{ brain: TestBrain; enrolFile: string }> {
  const dir = tempDir('atb-enrol-')
  const enrolFile = path.join(dir, 'enrol')
  writeFileSync(enrolFile, `ATELIER_CLOUD_URL=${base}\nATELIER_ENROL_TOKEN=${enrolToken}\n`, { mode: 0o600 })
  const brain = await startTestBrain({ enrolFile, cloudEnrol: true, cloudLink: { retryMs: () => 50, relay: { waitS: 1, eventFlushMs: 10 } } })
  await brain.cloud?.ready
  await until(() => machineOnline() && brain.cloud?.state().online === true)
  return { brain, enrolFile }
}

describe('a team computer reached through Atelier Cloud', () => {
  it('enrols once by itself, then answers relayed calls and streams its events; no port, no brain token', async () => {
    const { t, base, owner, machineId, enrolToken } = await cloudWithMachine()
    const { brain, enrolFile } = await enrolledBrain(base, enrolToken, () => t.cloud.relay.isOnline(machineId))
    try {
      // the single-use file is gone; the credential is on disk only encrypted with the machine key
      expect(existsSync(enrolFile)).toBe(false)
      const stored = readFileSync(path.join(brain.dir, 'data', CLOUD_LINK_FILE), 'utf8')
      expect(stored).toContain(machineId)
      expect(stored).not.toMatch(/amc_|enr_/)
      expect(brain.cloud?.state()).toMatchObject({ online: true, machineId })

      const ep = cloudBrainEndpoint(base, owner.accessToken)
      const info = await brainCall(ep, 'app.info', [])
      expect(info).toMatchObject({ ok: true, value: { name: 'Atelier' } })
      // the remote brain's own refusals stay the same through the relay
      const reveal = await brainCall(ep, 'production.revealPackage', ['x'])
      expect(reveal).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE_REMOTE' } })
      // and an unknown method answers what the IPC bus answers
      expect(await brainCall(ep, 'no.such.method', [])).toMatchObject({ ok: false })

      const changed: ChangeTopic[] = []
      const states: boolean[] = []
      const stream = openBrainEvents(ep, (event, payload) => {
        if (event === 'atelier:changed') changed.push((payload as { topic: ChangeTopic }).topic)
      }, { onState: (s) => states.push(s.live), retryMs: () => 50 })
      try {
        await until(() => states.includes(true))
        const created = await brainCall(ep, 'channels.create', [{ name: 'Par le Cloud', niche: 'relais' }])
        expect(created).toMatchObject({ ok: true, value: { name: 'Par le Cloud' } })
        await until(() => changed.includes('channels'))
      } finally {
        stream.close()
      }
      // the same data as the brain's own core: one brain, reached through the Cloud
      expect((brain.core.api['channels.list']() as { name: string }[]).map((c) => c.name)).toContain('Par le Cloud')
      // the audit names who called which method, never the arguments
      const calls = t.cloud.relayAudit.list({ teamId: owner.teamId })
      expect(calls.map((c) => c.method)).toEqual(expect.arrayContaining(['app.info', 'channels.create', 'production.revealPackage']))
      expect(JSON.stringify(t.cloud.db.prepare('SELECT * FROM relay_calls').all())).not.toContain('Par le Cloud')
    } finally {
      await brain.stop()
    }
  })

  it('the desktop app connects « via Atelier Cloud » with its Cloud session only, and its calls and events go through the relay', async () => {
    const { t, base, owner, machineId, enrolToken } = await cloudWithMachine()
    const { brain } = await enrolledBrain(base, enrolToken, () => t.cloud.relay.isOnline(machineId))
    const notified: ChangeTopic[] = []
    const app = memoryCore({ notify: (topic) => notified.push(topic), brain: { retryMs: () => 50 } })
    try {
      // not signed in to the Cloud: no offer, and connecting via the Cloud is refused
      expect((app.api['brain.status']() as BrainStatus).cloud).toBeUndefined()
      await expect(app.api['brain.connect']({ via: 'cloud' })).rejects.toThrow(/Atelier Cloud/)
      // the app's Cloud session (what device sign-in stores)
      app.context.settings.set('cloud.baseUrl', base)
      app.context.secrets.set('cloud.accessToken', owner.accessToken)
      app.context.secrets.set('cloud.refreshToken', owner.refreshToken)
      app.context.settings.set('cloud.accessExpiresAt', Date.now() + 3_600_000)
      app.api['brain.status']()
      await until(() => (app.api['brain.status']() as BrainStatus).cloud?.checked === true)
      expect((app.api['brain.status']() as BrainStatus).cloud?.machines).toEqual([expect.objectContaining({ id: machineId, online: true })])

      app.api['channels.create']({ name: 'Seulement ici' })
      const status = await app.api['brain.connect']({ via: 'cloud' })
      expect(status).toMatchObject({ mode: 'remote', via: 'cloud', tokenSet: false, url: base })
      expect(app.context.settings.get(BRAIN_VIA_SETTING)).toBe('cloud')
      expect(app.context.secrets.has(BRAIN_TOKEN_SECRET)).toBe(false)
      brain.core.api['channels.create']({ name: 'Sur l’ordinateur d’équipe' })
      const remote = await routeCall(app.api, app.brainLink, 'channels.list', [])
      expect(remote.ok && (remote.value as { name: string }[]).map((c) => c.name)).toEqual(expect.arrayContaining(['Sur l’ordinateur d’équipe']))
      expect(remote.ok && (remote.value as { name: string }[]).map((c) => c.name)).not.toContain('Seulement ici')
      await until(() => (app.api['brain.status']() as BrainStatus).live)
      notified.length = 0
      await routeCall(app.api, app.brainLink, 'channels.create', [{ name: 'Encore', niche: 'x' }])
      await until(() => notified.includes('channels'))
      expect((app.api['brain.disconnect']() as BrainStatus).mode).toBe('local')
      expect(app.context.settings.get(BRAIN_VIA_SETTING)).toBeNull()
    } finally {
      app.close()
      await brain.stop()
    }
  })

  it('a revoked credential stops the relay; the person then reads « en veille ou hors ligne »', async () => {
    const { t, base, owner, machineId, enrolToken } = await cloudWithMachine()
    const { brain } = await enrolledBrain(base, enrolToken, () => t.cloud.relay.isOnline(machineId))
    try {
      expect(t.cloud.machines().credentials.revoke(machineId, 'test')).toBe(1)
      t.cloud.relay.drop(machineId)
      await until(() => brain.cloud?.state().online === false && brain.cloud.state().error !== null)
      const ep = cloudBrainEndpoint(base, owner.accessToken)
      const off = await brainCall(ep, 'app.info', [])
      expect(off).toEqual({ ok: false, error: { code: 'BRAIN_OFFLINE', message: tr('brain.err.offline') } })
      expect(tr('brain.err.offline')).toBe('L’ordinateur d’équipe est en veille ou hors ligne.')
    } finally {
      await brain.stop()
    }
  })
})

describe('the web app’s Cloud session (the site’s sign-in, reused under the same origin)', () => {
  it('lists the team’s computers and refreshes a refused access token once, writing the new pair back', async () => {
    const { t, base, owner, machineId } = await cloudWithMachine()
    const store = new Map<string, string>([[SITE_TOKENS_KEY, JSON.stringify({ accessToken: owner.accessToken, refreshToken: owner.refreshToken })]])
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    expect(webCloudSession({ storage, baseUrl: null })).toBeNull()
    expect(webCloudSession({ storage: { getItem: () => null, setItem: () => undefined }, baseUrl: base })).toBeNull()
    const s = webCloudSession({ storage, baseUrl: base })!
    expect(await s.machines()).toEqual([{ id: machineId, status: 'running', online: false, demo: true }])
    s.expire()
    const fresh = await s.token()
    expect(fresh).not.toBe(owner.accessToken)
    expect(JSON.parse(store.get(SITE_TOKENS_KEY)!).accessToken).toBe(fresh)
    expect(t.cloud.relay.isOnline(machineId)).toBe(false)
  })
})

describe('the enrolment file and the brain’s Cloud options', () => {
  it('reads only its two keys, wants https off the loopback, and refuses a start with --cloud-enrol and nothing to enrol with', async () => {
    expect(parseEnrolFile('ATELIER_CLOUD_URL=https://api.atelier.test\nATELIER_ENROL_TOKEN=enr_abcdefghijklmnop\nOTHER=1\n')).toEqual({
      cloudUrl: 'https://api.atelier.test',
      token: 'enr_abcdefghijklmnop'
    })
    expect(() => parseEnrolFile('ATELIER_CLOUD_URL=https://api.atelier.test\n')).toThrow(/incomplet/)
    expect(() => checkCloudUrl('http://api.atelier.test')).toThrow(/https/)
    expect(checkCloudUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
    expect(() => checkCloudUrl('https://u:p@api.atelier.test')).toThrow()
    const dir = tempDir('atb-file-')
    const f = path.join(dir, 'enrol')
    writeFileSync(f, 'ATELIER_ENROL_TOKEN=enr_x\n')
    expect(neutraliseEnrolFile(f)).toBe(true)
    expect(existsSync(f)).toBe(false)

    const args = parseHeadlessArgs(['--cloud-enrol', '--enrol-file', f], {})
    expect(args).toMatchObject({ cloudEnrol: true, cloud: true, enrolFile: path.resolve(f) })
    expect(parseHeadlessArgs(['--no-cloud'], {}).cloud).toBe(false)
    expect(parseHeadlessArgs([], { ATELIER_CLOUD: 'off' }).cloud).toBe(false)
    expect(() => parseHeadlessArgs(['--cloud-enrol', '--no-cloud'], {})).toThrow(/contradictoires/)
    await expect(startTestBrain({ enrolFile: f, cloudEnrol: true })).rejects.toThrow(/Pas d’inscription/)
    // without --cloud-enrol and nothing to enrol with, the brain simply has no Cloud link
    const plain = await startTestBrain({ enrolFile: f })
    try {
      expect(plain.cloud).toBeNull()
    } finally {
      await plain.stop()
    }
  })

  it('a refused enrolment token is said clearly and the brain keeps serving its own API', async () => {
    const { base } = await cloudWithMachine()
    const dir = tempDir('atb-bad-')
    const enrolFile = path.join(dir, 'enrol')
    writeFileSync(enrolFile, `ATELIER_CLOUD_URL=${base}\nATELIER_ENROL_TOKEN=enr_${'z'.repeat(43)}\n`)
    const lines: string[] = []
    const brain = await startTestBrain({ enrolFile, cloudEnrol: true, log: (l) => lines.push(l), cloudLink: { retryMs: () => 20 } })
    try {
      await brain.cloud?.ready
      expect(brain.cloud?.state()).toMatchObject({ online: false, machineId: null })
      expect(lines.join('\n')).toMatch(/Jeton d’inscription refusé/)
      expect(lines.join('\n')).not.toContain('z'.repeat(43))
      expect((await brain.rpc('app.info')).body).toMatchObject({ ok: true })
    } finally {
      await brain.stop()
    }
  })
})
