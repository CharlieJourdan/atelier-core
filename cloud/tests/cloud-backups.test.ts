// The team computer's backups on the Cloud (src/shared/cloud-backup.ts): a machine sends an archive with its own
// credential, any enrolled machine of the SAME team lists and downloads it (a move to a new computer), another team's
// machine and a person's token cannot; the hash is checked; an oversized declared body and a team past its daily count
// are refused before a byte is read; retention removes backups older than 14 days but never the team's newest.
import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BACKUP_RETENTION_DAYS, BACKUP_ROUTES, MAX_BACKUP_BYTES, TeamBackup, TeamBackupList } from '../../src/shared/cloud-backup.ts'
import { DAY_MS } from '../src/clock.ts'
import { makeCloud, signUpAndIn, type TestCloud } from './helpers.ts'

const hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
type Auth = { authorization: string }

async function machineOf(t: TestCloud, teamId: string): Promise<{ id: string; auth: Auth }> {
  const machines = t.cloud.machines()
  const [m] = await machines.provision(teamId, 'starter', 'test')
  const res = await t.app.inject({ method: 'POST', url: '/v1/machines/enrol', payload: { enrolToken: machines.newEnrolToken(m!.id, 'test') } })
  return { id: m!.id, auth: { authorization: `Bearer ${(res.json() as { credential: string }).credential}` } }
}

const upload = (t: TestCloud, auth: Auth, bytes: Buffer, sha = hex(bytes)) =>
  t.app.inject({ method: 'POST', url: `/v1/relay/machine/backups?sha256=${sha}`, headers: { ...auth, 'content-type': 'application/octet-stream' }, payload: bytes })
const list = async (t: TestCloud, auth: Auth) => TeamBackupList.parse((await t.app.inject({ url: '/v1/relay/machine/backups', headers: auth })).json()).backups

describe('team computer backups on the Cloud', () => {
  it('has its three routes', async () => {
    const t = makeCloud()
    await t.app.ready()
    for (const r of Object.values(BACKUP_ROUTES)) expect(t.app.hasRoute({ method: r.method, url: r.path }), r.path).toBe(true)
  })

  it('stores an archive sent with the machine credential; the team’s other machine downloads the same bytes, another team cannot', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const old = await machineOf(t, owner.teamId)
    const bytes = randomBytes(4096)
    const res = await upload(t, old.auth, bytes)
    expect(res.statusCode).toBe(200)
    const b = TeamBackup.parse(res.json())
    expect(b).toMatchObject({ machineId: old.id, size: 4096, sha256: hex(bytes) })
    expect(Date.parse(b.expiresAt) - Date.parse(b.createdAt)).toBe(BACKUP_RETENTION_DAYS * DAY_MS)
    // a new computer of the same team (the move to another machine) sees and reads it
    const fresh = await machineOf(t, owner.teamId)
    expect((await list(t, fresh.auth)).map((x) => x.id)).toEqual([b.id])
    const got = await t.app.inject({ url: `/v1/relay/machine/backups/${b.id}`, headers: fresh.auth })
    expect(got.statusCode).toBe(200)
    expect(got.headers['content-type']).toBe('application/octet-stream')
    expect(got.headers['x-backup-sha256']).toBe(hex(bytes))
    expect(Buffer.compare(got.rawPayload, bytes)).toBe(0)
    // another team's machine: an empty list, and its id answers like an unknown one
    const stranger = await signUpAndIn(t, { email: 'autre@example.com' })
    const theirs = await machineOf(t, stranger.teamId)
    expect(await list(t, theirs.auth)).toEqual([])
    expect((await t.app.inject({ url: `/v1/relay/machine/backups/${b.id}`, headers: theirs.auth })).statusCode).toBe(404)
    // a person's token opens no machine route
    expect((await t.app.inject({ url: '/v1/relay/machine/backups', headers: owner.auth })).statusCode).toBe(401)
    expect((await t.app.inject({ url: '/v1/relay/machine/backups' })).statusCode).toBe(401)
  })

  it('checks the hash, refuses a raw body that is not octet-stream, an oversized declared body and a 25th backup of the day', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const m = await machineOf(t, owner.teamId)
    const bytes = randomBytes(64)
    expect((await upload(t, m.auth, bytes, hex(Buffer.from('autre')))).statusCode).toBe(400)
    const json = await t.app.inject({ method: 'POST', url: `/v1/relay/machine/backups?sha256=${hex(bytes)}`, headers: { ...m.auth, 'content-type': 'application/json' }, payload: '{}' })
    expect(json.statusCode).toBe(400)
    const big = await t.app.inject({
      method: 'POST',
      url: `/v1/relay/machine/backups?sha256=${hex(bytes)}`,
      headers: { ...m.auth, 'content-type': 'application/octet-stream', 'content-length': String(MAX_BACKUP_BYTES + 1) },
      payload: bytes
    })
    expect(big.statusCode).toBe(413)
    for (let i = 0; i < 24; i++) expect((await upload(t, m.auth, randomBytes(16))).statusCode).toBe(200)
    const late = await upload(t, m.auth, randomBytes(16))
    expect(late.statusCode).toBe(429)
    expect(late.json()).toMatchObject({ error: { code: 'rate_limited' } })
    t.clock.advance(DAY_MS + 1000)
    expect((await upload(t, m.auth, randomBytes(16))).statusCode).toBe(200)
  })

  it('removes backups older than 14 days, never the team’s newest', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const m = await machineOf(t, owner.teamId)
    const first = TeamBackup.parse((await upload(t, m.auth, randomBytes(32))).json())
    t.clock.advance(DAY_MS)
    const second = TeamBackup.parse((await upload(t, m.auth, randomBytes(32))).json())
    // the machine is switched off for a month: the first expires, the newest stays
    t.clock.advance(30 * DAY_MS)
    expect(await t.cloud.backups.sweep()).toEqual([first.id])
    expect((await list(t, m.auth)).map((b) => b.id)).toEqual([second.id])
    expect((await t.app.inject({ url: `/v1/relay/machine/backups/${second.id}`, headers: m.auth })).statusCode).toBe(200)
    expect(await t.cloud.backups.sweep()).toEqual([])
  })
})
