// Test teams (record 0066): `admin test-team create` makes a test team whose member has no password, writes the brains' key to a
// file (never printed), and a headless brain exchanges that key for the usual tokens of that team only; `revoke` kills it all.
import { trackTemp } from '../../tests/setup/track-temp'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.ts'
import { makeCloud, signUpAndIn, type TestCloud } from './helpers.ts'

function io() {
  const stdin = Object.assign(new PassThrough(), { isTTY: false })
  const out: string[] = []
  const err: string[] = []
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  stdout.on('data', (d) => out.push(String(d)))
  stderr.on('data', (d) => err.push(String(d)))
  return { stdin, stdout, stderr, text: () => out.join(''), errors: () => err.join('') }
}

const code = (r: { json: () => unknown }): string => (r.json() as { error: { code: string } }).error.code
const exchange = (t: TestCloud, key: string, deviceName = 'cerveau-1') => t.app.inject({ method: 'POST', url: '/v1/auth/test-brain', payload: { key, deviceName } })
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

async function create(t: TestCloud, credits = 5000) {
  const dir = trackTemp(mkdtempSync(join(tmpdir(), 'atelier-test-team-')))
  const file = join(dir, 'secrets', 'test-brain.token')
  const o = io()
  const exit = await runCli(['admin', 'test-team', 'create', '--name', 'Tests Atelier', '--credits', String(credits), '--key-file', file], { ...o, env: {}, cloud: t.cloud })
  expect(o.errors()).toBe('')
  expect(exit).toBe(0)
  const teamId = /test team (team_\S+)/.exec(o.text())?.[1] as string
  const email = /member (\S+@tests\.atelier\.invalid)/.exec(o.text())?.[1] as string
  return { dir, file, key: readFileSync(file, 'utf8').trim(), teamId, email, out: o.text() }
}

describe('admin test-team create', () => {
  it('makes a test team with test credits, writes the key to the file only, and never prints it', async () => {
    const t = makeCloud()
    const made = await create(t)
    expect(made.key).toMatch(/^attb_[A-Za-z0-9_-]{60,}$/)
    expect(made.out).not.toContain(made.key)
    expect(made.out).toContain('test credits: balance 5000')
    if (process.platform !== 'win32') expect(statSync(made.file).mode & 0o777).toBe(0o600)
    const team = t.cloud.accounts.team(made.teamId)
    expect(team).toMatchObject({ name: 'Tests Atelier', internal: true, test: true })
    expect(t.cloud.wallet.state(made.teamId).balance).toBe(5000)
    // only the key's hash is kept
    const rows = t.cloud.db.prepare('SELECT hash FROM test_brain_keys').all() as { hash: string }[]
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain(made.key)
    expect(JSON.stringify(t.cloud.audit.list())).not.toContain(made.key)
    // listed as a test team, without any key value
    const list = io()
    expect(await runCli(['admin', 'test-team', 'list'], { ...list, env: {}, cloud: t.cloud })).toBe(0)
    expect(list.text()).toContain(made.teamId)
    expect(list.text()).not.toContain(made.key)
    const teams = io()
    await runCli(['admin', 'team', 'list'], { ...teams, env: {}, cloud: t.cloud })
    expect(teams.text()).toMatch(new RegExp(`${made.teamId}\\tTests Atelier\\ttest`))
  })

  it('never overwrites an existing key file', async () => {
    const t = makeCloud()
    const made = await create(t)
    const again = io()
    expect(await runCli(['admin', 'test-team', 'create', '--name', 'Encore', '--credits', '10', '--key-file', made.file], { ...again, env: {}, cloud: t.cloud })).toBe(1)
    expect(again.errors()).toContain('already exists')
    expect(readFileSync(made.file, 'utf8').trim()).toBe(made.key)
    expect(t.cloud.testTeams.list()).toHaveLength(1)
  })
})

describe('the test member', () => {
  it('cannot sign in through the site, a device approval or a password reset', async () => {
    const t = makeCloud()
    const made = await create(t)
    for (const password of ['', 'x', '!no-password', 'correct horse battery']) {
      const login = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: made.email, password: password || 'y' } })
      expect(login.statusCode).toBe(401)
    }
    await expect(t.cloud.auth.passwordLogin({ email: made.email, password: '!no-password', deviceName: 'x' })).rejects.toThrow(/wrong e-mail address or password/)
    const accountId = t.cloud.accounts.accountByEmail(made.email)?.id as string
    expect(() => t.cloud.accounts.setPassword(accountId, 'a brand new long password')).toThrow(/never signs in with a password/)
    expect(t.cloud.accounts.hasNoPassword(accountId)).toBe(true)
  })
})

describe('a test brain key', () => {
  it('gives the usual tokens of its test team, and only that team', async () => {
    const t = makeCloud()
    const made = await create(t)
    const customer = await signUpAndIn(t, { credits: 40 })
    const r = await exchange(t, made.key)
    expect(r.statusCode).toBe(200)
    const tokens = r.json() as { accessToken: string; refreshToken: string; deviceId: string }
    const me = (await t.app.inject({ url: '/v1/me', headers: bearer(tokens.accessToken) })).json() as { team: { id: string }; wallet: { balance: number } }
    expect(me.team.id).toBe(made.teamId)
    expect(me.wallet.balance).toBe(5000)
    const accountId = t.cloud.accounts.accountByEmail(made.email)?.id as string
    expect(t.cloud.accounts.teamsOf(accountId)).toEqual([made.teamId])
    const device = t.cloud.db.prepare('SELECT team_id, name FROM devices WHERE id = ?').get(tokens.deviceId) as { team_id: string; name: string }
    expect(device).toEqual({ team_id: made.teamId, name: 'Cerveau de test — cerveau-1' })
    // the customer's team is untouched and its own token still sees only its own team
    const theirs = (await t.app.inject({ url: '/v1/me', headers: customer.auth })).json() as { team: { id: string }; wallet: { balance: number } }
    expect(theirs).toMatchObject({ team: { id: customer.teamId }, wallet: { balance: 40 } })
    // the tokens refresh like any device's
    const refreshed = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: tokens.refreshToken } })
    expect(refreshed.statusCode).toBe(200)
    // a wrong or foreign key is refused
    expect((await exchange(t, 'attb_wrong')).statusCode).toBe(401)
    expect((await exchange(t, customer.refreshToken)).statusCode).toBe(401)
    expect(t.cloud.audit.list().some((e) => e.action === 'auth.test_brain')).toBe(true)
  })

  it('revoke kills the key and every device of the team at once', async () => {
    const t = makeCloud()
    const made = await create(t)
    const a = (await exchange(t, made.key, 'a')).json() as { accessToken: string; refreshToken: string }
    const b = (await exchange(t, made.key, 'b')).json() as { accessToken: string }
    const o = io()
    expect(await runCli(['admin', 'test-team', 'revoke', '--team', made.teamId], { ...o, env: {}, cloud: t.cloud })).toBe(0)
    expect(o.text()).toContain('revoked 1 key(s) and 2 device(s)')
    for (const token of [a.accessToken, b.accessToken]) {
      const me = await t.app.inject({ url: '/v1/me', headers: bearer(token) })
      expect(me.statusCode).toBe(401)
    }
    const refresh = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: a.refreshToken } })
    expect(refresh.statusCode).toBe(401)
    const again = await exchange(t, made.key)
    expect(again.statusCode).toBe(401)
    expect(code(again)).toBe('unauthorized')
    // a customer team cannot be « revoked » as a test team
    const customer = await signUpAndIn(t)
    const bad = io()
    expect(await runCli(['admin', 'test-team', 'revoke', '--team', customer.teamId], { ...bad, env: {}, cloud: t.cloud })).toBe(1)
    expect(bad.errors()).toContain('not a test team')
  })

  it('expires after a year', async () => {
    const t = makeCloud()
    const made = await create(t)
    expect((await exchange(t, made.key)).statusCode).toBe(200)
    t.clock.advance(366 * 86_400_000)
    expect((await exchange(t, made.key)).statusCode).toBe(401)
  })
})

describe('the founder console', () => {
  it('shows a test team as a test team', async () => {
    const t = makeCloud()
    const made = await create(t)
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const crm = await t.app.inject({ url: `/v1/admin/accounts?q=${encodeURIComponent(made.email)}`, headers: admin.auth })
    expect(crm.statusCode).toBe(200)
    expect(JSON.stringify(crm.json())).toContain('"test":true')
  })
})
