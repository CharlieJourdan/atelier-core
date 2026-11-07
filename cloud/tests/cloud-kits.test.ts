// Publication kits on the platform: upload (start, files, complete) by a person or by a team computer, the texts and
// download links for the team, isolation between teams (another team's ids answer 404), a new kit replacing the old one
// only when complete, retention (default, per plan, abandoned uploads) and the same flow on a bucket (presigned links,
// objects deleted by the sweep).
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Kit, KIT_FILE_PATH, KIT_ROUTES, KitWithLinks, MAX_KIT_FILES } from '../../src/shared/cloud-kit.ts'
import { R2_KEY_ID, R2_SECRET } from '../src/blobs/index.ts'
import { createCloud } from '../src/cloud.ts'
import { DAY_MS } from '../src/clock.ts'
import { staticKeySource } from '../src/keysource.ts'
import { startFakeS3, type FakeS3 } from './fake-s3.ts'
import { givePlan, makeCloud, onCleanup, signIn, signUpAndIn, TEST_MASTER_KEY, type Person, type TestCloud } from './helpers.ts'

/** A person whose team has a plan: uploading kits needs one (or an enrolled team computer), see cloud-kit-quota.test.ts. */
async function subscriber(t: TestCloud, plan = 'starter'): Promise<Person> {
  const p = await signUpAndIn(t)
  givePlan(t, p.teamId, plan)
  return p
}

const hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const TEXTS = {
  title: 'Pourquoi les phares existent encore',
  alternatives: ['Les phares ne sont pas morts'],
  description: 'Une histoire courte des phares.',
  tags: ['phares', 'histoire'],
  chapters: [{ at: 0, title: 'Introduction' }],
  language: 'fr',
  demo: false
}
const VIDEO = Buffer.from('fake mp4 bytes '.repeat(1000))
const THUMB = Buffer.from('PNG-ish bytes')

type Auth = { authorization: string }
const startKit = (t: TestCloud, auth: Auth, videoId = '42', prefix = '/v1/team/videos', texts: object = TEXTS) =>
  t.app.inject({ method: 'POST', url: `${prefix}/${videoId}/kit`, headers: auth, payload: texts })
const putFile = (t: TestCloud, auth: Auth, kitId: string, name: string, bytes: Buffer, videoId = '42', prefix = '/v1/team/videos', sha = hex(bytes)) =>
  t.app.inject({
    method: 'POST',
    url: `${prefix}/${videoId}/kit/${kitId}/files?name=${encodeURIComponent(name)}&sha256=${sha}`,
    headers: { ...auth, 'content-type': 'application/octet-stream' },
    payload: bytes
  })
const complete = (t: TestCloud, auth: Auth, kitId: string, videoId = '42', prefix = '/v1/team/videos') =>
  t.app.inject({ method: 'POST', url: `${prefix}/${videoId}/kit/${kitId}/complete`, headers: auth })

/** The whole upload; returns the kit id. */
async function publish(t: TestCloud, auth: Auth, videoId = '42', files: [string, Buffer][] = [['video.mp4', VIDEO], ['thumbnail.png', THUMB]], texts: object = TEXTS) {
  const s = await startKit(t, auth, videoId, undefined, texts)
  expect(s.statusCode).toBe(200)
  const { kitId } = s.json() as { kitId: string }
  for (const [name, bytes] of files) expect((await putFile(t, auth, kitId, name, bytes, videoId)).statusCode).toBe(200)
  const done = await complete(t, auth, kitId, videoId)
  expect(done.statusCode, done.body).toBe(200)
  return kitId
}

describe('publication kits (local files)', () => {
  it('serves every route of the kit contract', () => {
    const t = makeCloud()
    for (const r of Object.values(KIT_ROUTES)) expect(t.app.hasRoute({ method: r.method, url: r.path }), r.path).toBe(true)
    expect(t.app.hasRoute({ method: 'GET', url: KIT_FILE_PATH })).toBe(true)
  })

  it('uploads in three steps, then serves the texts and a signed link per file', async () => {
    const t = makeCloud()
    const p = await subscriber(t)
    const kitId = await publish(t, p.auth)

    // not visible before it is complete
    const early = await startKit(t, p.auth, '77')
    expect(early.statusCode).toBe(200)
    expect((await t.app.inject({ url: '/v1/team/videos/77/kit', headers: p.auth })).statusCode).toBe(404)

    const got = await t.app.inject({ url: '/v1/team/videos/42/kit', headers: p.auth })
    expect(got.statusCode).toBe(200)
    const kit = KitWithLinks.parse(got.json())
    expect(kit).toMatchObject({ id: kitId, videoId: '42', title: TEXTS.title, description: TEXTS.description, tags: TEXTS.tags, alternatives: TEXTS.alternatives, language: 'fr', demo: false })
    expect(kit.files.map((f) => [f.name, f.mime, f.size, f.sha256])).toEqual([
      ['thumbnail.png', 'image/png', THUMB.length, hex(THUMB)],
      ['video.mp4', 'video/mp4', VIDEO.length, hex(VIDEO)]
    ])
    expect(new Date(kit.expiresAt).getTime() - t.clock.now()).toBe(90 * DAY_MS)

    // the signed Cloud link downloads the exact bytes, as an attachment
    const video = kit.files.find((f) => f.name === 'video.mp4')!
    const dl = await t.app.inject({ url: video.url.replace(/^https?:\/\/[^/]+/, '') })
    expect(dl.statusCode).toBe(200)
    expect(dl.headers['content-type']).toBe('video/mp4')
    expect(dl.headers['content-disposition']).toBe('attachment; filename="video.mp4"')
    expect(dl.rawPayload.equals(VIDEO)).toBe(true)

    // the list holds the kit without any link
    const list = await t.app.inject({ url: '/v1/team/kits', headers: p.auth })
    const { kits } = list.json() as { kits: object[] }
    expect(kits).toHaveLength(1)
    expect(Kit.parse(kits[0])).toMatchObject({ id: kitId })
    expect(JSON.stringify(kits)).not.toContain('/kit-files/')
  })

  it('refuses a tampered, foreign or expired link', async () => {
    const t = makeCloud()
    const p = await subscriber(t)
    const kitId = await publish(t, p.auth)
    const kit = KitWithLinks.parse((await t.app.inject({ url: '/v1/team/videos/42/kit', headers: p.auth })).json())
    const path = kit.files[0]!.url.replace(/^https?:\/\/[^/]+/, '')
    expect((await t.app.inject({ url: path })).statusCode).toBe(200)
    expect((await t.app.inject({ url: path.replace(/sig=[^&]+/, `sig=${'A'.repeat(43)}`) })).statusCode).toBe(403)
    expect((await t.app.inject({ url: path.replace('thumbnail.png', 'video.mp4') })).statusCode).toBe(403) // the signature names the file
    expect((await t.app.inject({ url: path.replace(kitId, 'kit_other') })).statusCode).toBe(403)
    expect((await t.app.inject({ url: `/kit-files/${kitId}/thumbnail.png` })).statusCode).toBe(403)
    t.clock.advance(16 * 60_000)
    expect((await t.app.inject({ url: path })).statusCode).toBe(410)
  })

  it('keeps teams apart: another team gets 404 everywhere and cannot write into a kit', async () => {
    const t = makeCloud()
    const a = await subscriber(t)
    const b = await subscriber(t)
    const kitId = await publish(t, a.auth)
    expect((await t.app.inject({ url: '/v1/team/videos/42/kit', headers: b.auth })).statusCode).toBe(404)
    expect(((await t.app.inject({ url: '/v1/team/kits', headers: b.auth })).json() as { kits: unknown[] }).kits).toEqual([])
    // writing into a's kit id from b (even for the same video id) is a 404, not a 403: its existence is not revealed
    expect((await putFile(t, b.auth, kitId, 'x.txt', Buffer.from('x'))).statusCode).toBe(404)
    expect((await complete(t, b.auth, kitId)).statusCode).toBe(404)
    // b has its own kit for the same video id, which does not touch a's
    await publish(t, b.auth, '42', [['video.mp4', Buffer.from('b video')]], { ...TEXTS, title: 'Celui de B' })
    const mine = KitWithLinks.parse((await t.app.inject({ url: '/v1/team/videos/42/kit', headers: a.auth })).json())
    expect(mine.title).toBe(TEXTS.title)
    // the download link of a's file does not work from b's kit id either
    const theirs = KitWithLinks.parse((await t.app.inject({ url: '/v1/team/videos/42/kit', headers: b.auth })).json())
    expect(theirs.id).not.toBe(kitId)
    expect(theirs.title).toBe('Celui de B')
  })

  it('requires sign-in, a plain video id, a matching hash and sane names and counts', async () => {
    const t = makeCloud()
    const p = await subscriber(t)
    expect((await t.app.inject({ method: 'POST', url: '/v1/team/videos/42/kit', payload: TEXTS })).statusCode).toBe(401)
    expect((await t.app.inject({ url: '/v1/team/videos/42/kit' })).statusCode).toBe(401)
    expect((await t.app.inject({ url: '/v1/team/kits' })).statusCode).toBe(401)
    expect((await startKit(t, p.auth, '..%2F..')).statusCode).toBe(400)
    expect((await startKit(t, p.auth, '42', undefined, { ...TEXTS, title: '' })).statusCode).toBe(400)
    const { kitId } = (await startKit(t, p.auth)).json() as { kitId: string }
    expect((await putFile(t, p.auth, kitId, 'a.txt', Buffer.from('x'), '42', undefined, hex(Buffer.from('y')))).statusCode).toBe(400)
    expect((await putFile(t, p.auth, kitId, '../evil.txt', Buffer.from('x'))).statusCode).toBe(400)
    expect((await putFile(t, p.auth, kitId, 'video.mp4', Buffer.from('x'), '43')).statusCode).toBe(404) // another video's id
    expect((await complete(t, p.auth, kitId)).statusCode).toBe(400) // no file yet
    for (let i = 0; i < MAX_KIT_FILES; i++) expect((await putFile(t, p.auth, kitId, `f${i}.txt`, Buffer.from(`${i}`))).statusCode).toBe(200)
    expect((await putFile(t, p.auth, kitId, 'one-too-many.txt', Buffer.from('x'))).statusCode).toBe(400)
    expect((await putFile(t, p.auth, kitId, 'f0.txt', Buffer.from('replaced'))).statusCode).toBe(200) // same name: a replacement
    expect((await complete(t, p.auth, kitId)).statusCode).toBe(200)
    // a complete kit is closed
    expect((await complete(t, p.auth, kitId)).statusCode).toBe(409)
    expect((await putFile(t, p.auth, kitId, 'late.txt', Buffer.from('x'))).statusCode).toBe(409)
  })

  it('replaces the old kit only when the new one is complete, and removes the old files', async () => {
    const t = makeCloud()
    const p = await subscriber(t)
    const first = await publish(t, p.auth)
    const root = (id: string) => t.cloud.db.prepare('SELECT COUNT(*) AS n FROM video_kit_files WHERE kit_id = ?').get(id) as { n: number }
    expect(root(first).n).toBe(2)
    // a second upload that never completes leaves the first kit in place
    const { kitId: second } = (await startKit(t, p.auth)).json() as { kitId: string }
    await putFile(t, p.auth, second, 'video.mp4', Buffer.from('v2'))
    expect(KitWithLinks.parse((await t.app.inject({ url: '/v1/team/videos/42/kit', headers: p.auth })).json()).id).toBe(first)
    expect((await complete(t, p.auth, second)).statusCode).toBe(200)
    expect(KitWithLinks.parse((await t.app.inject({ url: '/v1/team/videos/42/kit', headers: p.auth })).json()).id).toBe(second)
    expect(root(first).n).toBe(0)
    expect(t.cloud.db.prepare('SELECT COUNT(*) AS n FROM video_kits WHERE video_id = ?').get('42')).toMatchObject({ n: 1 })
    expect(await t.cloud.kits.readFile(second, 'video.mp4').then((f) => f.bytes.toString())).toBe('v2')
    await expect(t.cloud.kits.readFile(first, 'video.mp4')).rejects.toThrow(/no such kit/)
  })

  it('accepts a team computer’s own credential for the upload, for its team only', async () => {
    const t = makeCloud()
    const owner = await signUpAndIn(t)
    const other = await signUpAndIn(t)
    const machines = t.cloud.machines()
    const [m] = await machines.provision(owner.teamId, 'starter', 'test')
    const enrolToken = machines.newEnrolToken(m!.id, 'test')
    const { credential } = (await t.app.inject({ method: 'POST', url: '/v1/machines/enrol', payload: { enrolToken } })).json() as { credential: string }
    const machine = { authorization: `Bearer ${credential}` }
    const prefix = '/v1/relay/machine/videos'
    const s = await startKit(t, machine, '9', prefix)
    expect(s.statusCode).toBe(200)
    const { kitId } = s.json() as { kitId: string }
    expect((await putFile(t, machine, kitId, 'video.mp4', VIDEO, '9', prefix)).statusCode).toBe(200)
    expect((await complete(t, machine, kitId, '9', prefix)).statusCode).toBe(200)
    // the team's people see it; another team does not; a person's token is not accepted on the machine route
    expect(KitWithLinks.parse((await t.app.inject({ url: '/v1/team/videos/9/kit', headers: owner.auth })).json()).title).toBe(TEXTS.title)
    expect((await t.app.inject({ url: '/v1/team/videos/9/kit', headers: other.auth })).statusCode).toBe(404)
    expect((await startKit(t, owner.auth, '9', prefix)).statusCode).toBe(401)
    expect((await startKit(t, machine, '9', '/v1/relay/machine/videos')).statusCode).toBe(200)
    expect(t.cloud.audit.list().find((e) => e.action === 'kit.publish')).toMatchObject({ actor: `machine:${m!.id}`, target: kitId })
  })
})

describe('retention', () => {
  it('hides a kit at its date, the sweep deletes it and its files, and the plan sets the length', async () => {
    const t = makeCloud({ kits: { retentionDays: 90, byPlan: { starter: 30 } } })
    // p's plan has no length of its own (the default applies); q's plan sets 30 days
    const p = await subscriber(t, 'creator')
    const q = await subscriber(t, 'starter')
    const free = await publish(t, p.auth)
    const paid = await publish(t, q.auth)
    const days = (id: string) => (new Date((t.cloud.db.prepare('SELECT expires_at FROM video_kits WHERE id = ?').get(id) as { expires_at: string }).expires_at).getTime() - t.clock.now()) / DAY_MS
    expect(days(free)).toBe(90) // a plan without its own length: the default
    expect(days(paid)).toBe(30) // a running plan sets its own length

    t.clock.advance(31 * DAY_MS)
    const later = async (who: Person): Promise<Auth> => ({ authorization: `Bearer ${(await signIn(t, who.email)).accessToken}` }) // the old token has expired
    expect((await t.app.inject({ url: '/v1/team/videos/42/kit', headers: await later(q) })).statusCode).toBe(404) // hidden at once, before any sweep
    expect((await t.app.inject({ url: '/v1/team/videos/42/kit', headers: await later(p) })).statusCode).toBe(200)
    expect(await t.cloud.kits.sweep()).toEqual([paid])
    expect(t.cloud.db.prepare('SELECT COUNT(*) AS n FROM video_kit_files WHERE kit_id = ?').get(paid)).toMatchObject({ n: 0 })
    t.clock.advance(60 * DAY_MS)
    expect(await t.cloud.kits.sweep()).toEqual([free])
    expect((await t.app.inject({ url: '/v1/team/videos/42/kit', headers: await later(p) })).statusCode).toBe(404)
    expect(t.cloud.audit.list().filter((e) => e.action === 'kit.expire').map((e) => e.target).sort()).toEqual([free, paid].sort())
    expect(await t.cloud.kits.sweep()).toEqual([])
  })

  it('drops an upload that was never completed after a day, and nothing younger', async () => {
    const t = makeCloud()
    const p = await subscriber(t)
    const { kitId } = (await startKit(t, p.auth)).json() as { kitId: string }
    await putFile(t, p.auth, kitId, 'video.mp4', VIDEO)
    t.clock.advance(23 * 3_600_000)
    expect(await t.cloud.kits.sweep()).toEqual([])
    t.clock.advance(2 * 3_600_000)
    expect(await t.cloud.kits.sweep()).toEqual([kitId])
    const auth = { authorization: `Bearer ${(await signIn(t, p.email)).accessToken}` }
    expect((await putFile(t, auth, kitId, 'late.txt', Buffer.from('x'))).statusCode).toBe(404)
  })
})

describe('publication kits on a bucket', () => {
  let s3: FakeS3
  let t: TestCloud
  let p: Person
  beforeEach(async () => {
    s3 = await startFakeS3({ now: () => new Date(t ? t.clock.now() : Date.now()) })
    const dir = mkdtempSync(join(tmpdir(), 'atelier-kits3-'))
    onCleanup(() => rmSync(dir, { recursive: true, force: true }))
    const dbPath = join(dir, 'cloud.db')
    const seed = createCloud({ dbPath, filesDir: dir, signingKey: Buffer.alloc(32, 3), keySource: staticKeySource(TEST_MASTER_KEY), paidCalls: false })
    seed.vault.set(R2_KEY_ID, s3.credentials.accessKeyId, 'test')
    seed.vault.set(R2_SECRET, s3.credentials.secretAccessKey, 'test')
    await seed.close()
    t = makeCloud({ dbPath, filesDir: dir, storage: { kind: 's3', endpoint: s3.endpoint, bucket: s3.bucket, region: 'auto' } })
    p = await subscriber(t)
  })
  afterEach(async () => {
    await s3.close()
  })

  it('keeps the files in the bucket, hands out presigned links, and deletes the objects when the kit expires', async () => {
    const big = randomBytes(1_000_000)
    const kitId = await publish(t, p.auth, '42', [['video.mp4', big], ['thumbnail.png', THUMB]])
    const keys = [`kits/${p.teamId}/${kitId}/video.mp4`, `kits/${p.teamId}/${kitId}/thumbnail.png`]
    for (const k of keys) expect(s3.objects.has(k)).toBe(true)
    expect(hex(s3.objects.get(keys[0]!)!.bytes)).toBe(hex(big))

    const kit = KitWithLinks.parse((await t.app.inject({ url: '/v1/team/videos/42/kit', headers: p.auth })).json())
    const video = kit.files.find((f) => f.name === 'video.mp4')!
    expect(video.url.startsWith(`${s3.endpoint}/${s3.bucket}/${keys[0]}?`)).toBe(true)
    expect(new URL(video.url).searchParams.get('X-Amz-Expires')).toBe('900')
    expect(new URL(video.url).searchParams.get('response-content-disposition')).toBe('attachment; filename="video.mp4"')
    // straight from the bucket: the Cloud serves no bytes
    const direct = await fetch(video.url)
    expect(direct.status).toBe(200)
    expect(hex(Buffer.from(await direct.arrayBuffer()))).toBe(hex(big))
    expect(video.url).not.toContain(s3.credentials.secretAccessKey)

    // replaced by a newer kit: the old objects go
    const second = await publish(t, p.auth, '42', [['video.mp4', Buffer.from('v2')]])
    expect(keys.some((k) => s3.objects.has(k))).toBe(false)
    expect(s3.objects.has(`kits/${p.teamId}/${second}/video.mp4`)).toBe(true)

    // retention
    t.clock.advance(91 * DAY_MS)
    expect(await t.cloud.kits.sweep()).toEqual([second])
    expect([...s3.objects.keys()].filter((k) => k.startsWith('kits/'))).toEqual([])
  })

  it('keeps the rows when the bucket cannot be reached, and retries at the next sweep', async () => {
    const kitId = await publish(t, p.auth, '42', [['video.mp4', VIDEO]])
    t.clock.advance(91 * DAY_MS)
    await s3.close()
    expect(await t.cloud.kits.sweep()).toEqual([])
    expect(t.cloud.db.prepare('SELECT COUNT(*) AS n FROM video_kits WHERE id = ?').get(kitId)).toMatchObject({ n: 1 })
  })
})
