// Security review, finding 2: publication kits are not free storage. Only a team with a plan (active or past due) or an
// enrolled team computer uploads kits; its kits (the uploading ones included) fit in its plan's storage, checked from the
// declared length before any byte is read and again from the real size; it uploads at most 4 kits at once.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PLANS } from '../src/billing/catalog.ts'
import { MAX_UPLOADING_KITS } from '../src/kits.ts'
import { givePlan, makeCloud, signUpAndIn, type TestCloud } from './helpers.ts'

const hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const TEXTS = { title: 'Les phares', description: 'D', tags: [], demo: false }
type Auth = { authorization: string }

const start = (t: TestCloud, auth: Auth, videoId = '42', prefix = '/v1/team/videos') => t.app.inject({ method: 'POST', url: `${prefix}/${videoId}/kit`, headers: auth, payload: TEXTS })
const put = (t: TestCloud, auth: Auth, kitId: string, name: string, bytes: Buffer, videoId = '42', prefix = '/v1/team/videos') =>
  t.app.inject({
    method: 'POST',
    url: `${prefix}/${videoId}/kit/${kitId}/files?name=${name}&sha256=${hex(bytes)}`,
    headers: { ...auth, 'content-type': 'application/octet-stream' },
    payload: bytes
  })
const complete = (t: TestCloud, auth: Auth, kitId: string, videoId = '42') => t.app.inject({ method: 'POST', url: `/v1/team/videos/${videoId}/kit/${kitId}/complete`, headers: auth })

describe('who may upload kits', () => {
  it('refuses a free sign-up (and a canceled plan) before reading anything; a plan, even past due, may', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t)
    const refused = await start(t, p.auth)
    expect(refused.statusCode).toBe(403)
    expect(refused.json()).toMatchObject({ error: { code: 'forbidden' } })
    expect((await put(t, p.auth, 'kit_any', 'video.mp4', Buffer.from('x'))).statusCode).toBe(403)
    expect((await complete(t, p.auth, 'kit_any')).statusCode).toBe(403)
    expect(t.cloud.db.prepare('SELECT COUNT(*) AS n FROM video_kits').get()).toEqual({ n: 0 })
    givePlan(t, p.teamId, 'starter', 'canceled')
    expect((await start(t, p.auth)).statusCode).toBe(403)
    givePlan(t, p.teamId, 'starter', 'past_due')
    expect((await start(t, p.auth)).statusCode).toBe(200)
    // reading stays open to the team (nothing is stored by a read)
    expect((await t.app.inject({ url: '/v1/team/kits', headers: p.auth })).statusCode).toBe(200)
  })

  it('a team with an enrolled team computer uploads with its plan’s storage, a provisioned but not enrolled one does not', async () => {
    const t = makeCloud({ kits: { quotaByPlan: { creator: 10 } } })
    const owner = await signUpAndIn(t)
    const machines = t.cloud.machines()
    const [m] = await machines.provision(owner.teamId, 'creator', 'test')
    expect((await start(t, owner.auth)).statusCode).toBe(403)
    const { credential } = (await t.app.inject({ method: 'POST', url: '/v1/machines/enrol', payload: { enrolToken: machines.newEnrolToken(m!.id, 'test') } })).json() as { credential: string }
    const machine = { authorization: `Bearer ${credential}` }
    const s = await start(t, machine, '9', '/v1/relay/machine/videos')
    expect(s.statusCode).toBe(200)
    expect(t.cloud.kits.allowance(owner.teamId)).toEqual({ plan: 'creator', quotaBytes: 10 })
    const { kitId } = s.json() as { kitId: string }
    expect((await put(t, machine, kitId, 'video.mp4', Buffer.alloc(11), '9', '/v1/relay/machine/videos')).statusCode).toBe(403) // 11 bytes > 10
    expect((await put(t, machine, kitId, 'video.mp4', Buffer.alloc(10), '9', '/v1/relay/machine/videos')).statusCode).toBe(200)
  })
})

describe('the storage of a plan', () => {
  it('matches the pricing page (50 GB … 2 TB)', () => {
    expect(Object.fromEntries(Object.values(PLANS).map((p) => [p.id, p.storageBytes / 1e9]))).toEqual({ starter: 50, creator: 150, studio: 400, agency: 1000, network: 2000 })
  })

  it('counts every kit file (uploading kits too); refuses what does not fit, from the declared size, before the body is read', async () => {
    const t = makeCloud({ kits: { quotaByPlan: { starter: 10_000 } } })
    const p = await signUpAndIn(t)
    givePlan(t, p.teamId, 'starter')
    const first = (await start(t, p.auth, '1')).json() as { kitId: string }
    expect((await put(t, p.auth, first.kitId, 'video.mp4', Buffer.alloc(6000, 1), '1')).statusCode).toBe(200)
    expect(t.cloud.kits.usedBytes(p.teamId)).toBe(6000) // not completed yet: it counts
    const second = (await start(t, p.auth, '2')).json() as { kitId: string }
    const full = await put(t, p.auth, second.kitId, 'video.mp4', Buffer.alloc(6000, 2), '2')
    expect(full.statusCode).toBe(403)
    expect((full.json() as { error: { message: string } }).error.message).toMatch(/storage is full/)
    expect(t.cloud.db.prepare('SELECT COUNT(*) AS n FROM video_kit_files WHERE kit_id = ?').get(second.kitId)).toEqual({ n: 0 })
    // replacing a file frees its old size first
    expect((await put(t, p.auth, first.kitId, 'video.mp4', Buffer.alloc(9000, 3), '1')).statusCode).toBe(200)
    expect(t.cloud.kits.usedBytes(p.teamId)).toBe(9000)
    expect((await put(t, p.auth, second.kitId, 'video.mp4', Buffer.alloc(1000, 4), '2')).statusCode).toBe(200)
    expect((await put(t, p.auth, second.kitId, 'thumb.png', Buffer.alloc(1), '2')).statusCode).toBe(403)

    // the real size is checked again after the bytes arrive (a body sent without a length)
    const chunked = await t.app.inject({
      method: 'POST',
      url: `/v1/team/videos/2/kit/${second.kitId}/files?name=thumb.png&sha256=${hex(Buffer.alloc(5))}`,
      headers: { ...p.auth, 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' },
      payload: Buffer.alloc(5)
    })
    expect(chunked.statusCode).toBe(403)

    // a newer kit of the same video replaces the old one when complete, and gives its room back
    expect((await complete(t, p.auth, first.kitId, '1')).statusCode).toBe(200)
    const again = (await start(t, p.auth, '1')).json() as { kitId: string }
    expect((await put(t, p.auth, again.kitId, 'video.mp4', Buffer.alloc(9000, 5), '1')).statusCode).toBe(403) // both kits count while uploading
    t.cloud.db.prepare('DELETE FROM video_kits WHERE id = ?').run(again.kitId)
    expect(t.cloud.kits.usedBytes(p.teamId)).toBe(10_000)
  })

  it('uploads at most a few kits at once per team; abandoned uploads stop counting after a day', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t)
    givePlan(t, p.teamId, 'starter')
    for (let i = 0; i < MAX_UPLOADING_KITS; i++) expect((await start(t, p.auth, `v${i}`)).statusCode).toBe(200)
    const busy = await start(t, p.auth, 'one-more')
    expect(busy.statusCode).toBe(429)
    expect((busy.json() as { error: { message: string } }).error.message).toMatch(/at most 4 kits/)
    t.clock.advance(24 * 3_600_000 + 1)
    const auth = { authorization: `Bearer ${(await signUpAndIn(t, { teamId: p.teamId })).accessToken}` }
    expect((await start(t, auth, 'one-more')).statusCode).toBe(200)
  })
})
