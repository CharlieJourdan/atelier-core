// A headless test brain (record 0066): `--token-file` holds its test team's key; the app's Cloud session exchanges it for the
// usual tokens (no browser), exchanges it again when its tokens die, and stops when the team is revoked. Against an
// in-process Cloud on the loopback (fakes, nothing paid). The key never reaches a log, the settings or the secrets.
import { trackTemp } from '../setup/track-temp'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MSG } from '../../src/main/cloud/session'
import { ConfigError, parseHeadlessArgs } from '../../src/main/headless/config'
import { signInTestBrain } from '../../src/main/headless/host'
import { appCore, startCloud, type CloudRig } from './cloud-app-helpers'

const HOUR = 3600_000

interface TestTeamsApi {
  create(p: { name: string; credits: number; actor: string }): { team: { id: string }; key: string }
  revoke(teamId: string, actor: string): { keys: number; devices: number }
}
const testTeams = (rig: CloudRig): TestTeamsApi => (rig.t.cloud as unknown as { testTeams: TestTeamsApi }).testTeams

/** Everything the app keeps (settings and secret names), to check the key is in none of it. */
function kept(app: ReturnType<typeof appCore>): string {
  const db = app.core.context.db as unknown as { prepare(sql: string): { all(): unknown[] } }
  return JSON.stringify([db.prepare('SELECT * FROM settings').all(), db.prepare('SELECT * FROM secrets').all()])
}

describe('a test brain signs in with its key', () => {
  it('connects without a browser to its test team, and keeps only the usual tokens', async () => {
    const rig = await startCloud(0)
    const made = testTeams(rig).create({ name: 'Tests Atelier', credits: 5000, actor: 'test' })
    const app = appCore()
    await app.core.api['cloud.setBaseUrl'](rig.baseUrl)
    const status = await app.core.cloud.session.useTestKey(made.key, 'cerveau-test')
    expect(status).toMatchObject({ connected: true, account: { teamName: 'Tests Atelier' } })
    expect(app.opened).toEqual([])
    expect(kept(app)).not.toContain(made.key)
    const account = (await app.core.api['cloud.account']()) as { wallet: { balance: number } } | null
    expect(account?.wallet.balance).toBe(5000)
  })

  it('exchanges its key again when its tokens die, and stops when the team is revoked', async () => {
    const rig = await startCloud(0)
    const made = testTeams(rig).create({ name: 'Tests Atelier', credits: 100, actor: 'test' })
    const app = appCore()
    await app.core.api['cloud.setBaseUrl'](rig.baseUrl)
    await app.core.cloud.session.useTestKey(made.key, 'cerveau-test')
    const first = app.core.cloud.session.status().deviceId as string
    // the device is revoked on the Cloud (an operator, a refresh reuse): the refresh is refused, the key signs in again
    ;(rig.t.cloud.auth as { revokeDevice(id: string, by: { accountId: string; platformAdmin: boolean }): void }).revokeDevice(first, { accountId: 'admin', platformAdmin: true })
    app.clock.now += HOUR
    rig.t.clock.advance(HOUR)
    await expect(app.core.cloud.session.token()).resolves.toMatch(/^atk_/)
    const second = app.core.cloud.session.status()
    expect(second).toMatchObject({ connected: true })
    expect(second.deviceId).not.toBe(first)
    // revoked: the tokens die and the key is refused, with a plain French message
    testTeams(rig).revoke(made.team.id, 'test')
    app.clock.now += HOUR
    rig.t.clock.advance(HOUR)
    await expect(app.core.cloud.session.token()).rejects.toMatchObject({ code: 'missing_tool', message: MSG.testKeyRefused })
    expect(app.core.cloud.session.status().connected).toBe(false)
  })

  it('a signed-out brain forgets its key', async () => {
    const rig = await startCloud(0)
    const made = testTeams(rig).create({ name: 'Tests Atelier', credits: 0, actor: 'test' })
    const app = appCore()
    await app.core.api['cloud.setBaseUrl'](rig.baseUrl)
    await app.core.cloud.session.useTestKey(made.key, 'cerveau-test')
    await app.core.cloud.session.logout()
    await expect(app.core.cloud.session.token()).rejects.toThrow(MSG.notConnected)
  })

  it('--token-file: the brain reads the key at start, signs in, and never logs it', async () => {
    const rig = await startCloud(0)
    const made = testTeams(rig).create({ name: 'Tests Atelier', credits: 0, actor: 'test' })
    const file = path.join(trackTemp(mkdtempSync(path.join(tmpdir(), 'atelier-brain-key-'))), 'test-brain.token')
    writeFileSync(file, `${made.key}\r\n`)
    const app = appCore()
    await app.core.api['cloud.setBaseUrl'](rig.baseUrl)
    const lines: string[] = []
    signInTestBrain(app.core, file, (l) => void lines.push(l))
    await vi.waitFor(() => expect(lines.join('\n')).toContain('cerveau de test connecté (Tests Atelier)'), { timeout: 10_000, interval: 20 })
    expect(app.core.cloud.session.status().connected).toBe(true)
    expect(lines.join('\n')).not.toContain(made.key)
    const missing: string[] = []
    signInTestBrain(app.core, path.join(path.dirname(file), 'absent'), (l) => void missing.push(l))
    expect(missing.join('\n')).toContain('illisible')
  })
})

describe('the brain options', () => {
  it('--token-file and --cloud-url (an allowed address only; not with --no-cloud)', () => {
    const a = parseHeadlessArgs(['--token-file', 'keys/test-brain.token', '--cloud-url', 'https://cloud.example.com/'], {})
    expect(a.tokenFile).toBe(path.resolve('keys/test-brain.token'))
    expect(a.cloudUrl).toBe('https://cloud.example.com')
    expect(parseHeadlessArgs([], { ATELIER_TEST_TOKEN_FILE: '/k', ATELIER_CLOUD_URL: 'http://127.0.0.1:8787' })).toMatchObject({ tokenFile: path.resolve('/k'), cloudUrl: 'http://127.0.0.1:8787' })
    expect(parseHeadlessArgs([], {})).toMatchObject({ tokenFile: null, cloudUrl: null })
    expect(() => parseHeadlessArgs(['--cloud-url', 'http://cloud.example.com'], {})).toThrow(ConfigError)
    expect(() => parseHeadlessArgs(['--token-file', 'k', '--no-cloud'], {})).toThrow(/contradictoires/)
  })
})
