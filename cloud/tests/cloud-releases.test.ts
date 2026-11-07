// App releases and the update feed: the platform admin's routes (create a draft, upload, publish, withdraw, delete) with auth
// before the body and a size cap, and the public feed in the shape of electron-updater's generic provider (latest.yml,
// latest-mac.yml, the files with byte ranges), the highest published version winning, a withdrawn release leaving the feed,
// channels and platforms kept apart, and the same on a bucket (redirect to a presigned link).
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RELEASE_ROUTES, Release, ReleaseListResponse, UPDATE_FEED_PATH, compareVersions } from '../../src/shared/cloud-releases.ts'
import { runCli } from '../src/cli.ts'
import { R2_KEY_ID, R2_SECRET } from '../src/blobs/index.ts'
import { createCloud } from '../src/cloud.ts'
import { staticKeySource } from '../src/keysource.ts'
import { parseRange } from '../src/http/routes-releases.ts'
import { startFakeS3, type FakeS3 } from './fake-s3.ts'
import { makeCloud, onCleanup, signUpAndIn, TEST_MASTER_KEY, type Person, type TestCloud } from './helpers.ts'

const hex = (b: Uint8Array, algo = 'sha256'): string => createHash(algo).update(b).digest('hex')
const b64 = (b: Uint8Array): string => createHash('sha512').update(b).digest('base64')

type Feed = { version: string; files: { url: string; sha512: string; size: number }[]; path: string; sha512: string; releaseDate: string; releaseNotes?: string }
async function parseYaml(text: string): Promise<Feed> {
  const name = 'js-yaml' // dependency of electron-updater (and of eslint); no type package, hence the variable
  const { load } = (await import(name)) as { load: (s: string) => unknown }
  return load(text) as Feed
}

const EXE = randomBytes(5000)
const MAP = randomBytes(300)

const create = (t: TestCloud, who: Person, body: object) => t.app.inject({ method: 'POST', url: '/v1/admin/releases', headers: who.auth, payload: body })
const upload = (t: TestCloud, who: Person | null, id: string, name: string, bytes: Buffer, sha = hex(bytes)) =>
  t.app.inject({
    method: 'POST',
    url: `/v1/admin/releases/${id}/files?name=${encodeURIComponent(name)}&sha256=${sha}`,
    headers: { ...(who?.auth ?? {}), 'content-type': 'application/octet-stream' },
    payload: bytes
  })
const act = (t: TestCloud, who: Person, id: string, what: 'publish' | 'withdraw' | 'delete') =>
  t.app.inject({ method: 'POST', url: `/v1/admin/releases/${id}/${what}`, headers: who.auth })
const feed = (t: TestCloud, channel = 'beta', platform = 'win', name = platform === 'mac' ? 'latest-mac.yml' : 'latest.yml', headers: Record<string, string> = {}) =>
  t.app.inject({ url: `/v1/updates/${channel}/${platform}/${name}`, headers })

/** Creates, uploads and (unless `draft`) publishes a Windows release; returns its id. */
async function release(t: TestCloud, who: Person, version: string, o: { channel?: string; platform?: string; notes?: string; draft?: boolean; exe?: Buffer } = {}): Promise<string> {
  const platform = o.platform ?? 'win'
  const made = await create(t, who, { version, channel: o.channel ?? 'beta', platform, notes: o.notes ?? '' })
  expect(made.statusCode, made.body).toBe(200)
  const { id } = Release.parse(made.json())
  const base = platform === 'win' ? `Atelier-Setup-${version}.exe` : `Atelier-${version}-arm64.zip`
  expect((await upload(t, who, id, base, o.exe ?? EXE)).statusCode).toBe(200)
  expect((await upload(t, who, id, `${base}.blockmap`, MAP)).statusCode).toBe(200)
  if (!o.draft) expect((await act(t, who, id, 'publish')).statusCode).toBe(200)
  return id
}

describe('app releases (local files)', () => {
  it('serves every route of the release contract and the public feed', () => {
    const t = makeCloud()
    for (const r of Object.values(RELEASE_ROUTES)) expect(t.app.hasRoute({ method: r.method, url: r.path }), r.path).toBe(true)
    expect(t.app.hasRoute({ method: 'GET', url: UPDATE_FEED_PATH })).toBe(true)
  })

  it('refuses the admin routes without a platform admin, and an upload before a byte of it is read', async () => {
    const t = makeCloud()
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const user = await signUpAndIn(t)
    const body = { version: '0.2.0', channel: 'beta', platform: 'win', notes: '' }
    expect((await t.app.inject({ method: 'POST', url: '/v1/admin/releases', payload: body })).statusCode).toBe(401)
    expect((await create(t, user, body)).statusCode).toBe(403)
    expect((await t.app.inject({ url: '/v1/admin/releases', headers: user.auth })).statusCode).toBe(403)
    const id = Release.parse((await create(t, admin, body)).json()).id
    // an anonymous or ordinary caller is turned away with the bytes unread: the connection closes after the answer
    const anon = await upload(t, null, id, 'Atelier-Setup-0.2.0.exe', EXE)
    expect(anon.statusCode).toBe(401)
    expect(anon.headers.connection).toBe('close')
    const plain = await upload(t, user, id, 'Atelier-Setup-0.2.0.exe', EXE)
    expect(plain.statusCode).toBe(403)
    expect(t.cloud.releases.get(id).files).toEqual([])
    for (const what of ['publish', 'withdraw', 'delete'] as const) expect((await t.app.inject({ method: 'POST', url: `/v1/admin/releases/${id}/${what}`, headers: user.auth })).statusCode).toBe(403)
  })

  it('uploads in steps, checks the hash, and publishes only a release that has its installer', async () => {
    const t = makeCloud()
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const made = await create(t, admin, { version: '0.2.0', channel: 'beta', platform: 'win', notes: 'Première bêta' })
    const rel = Release.parse(made.json())
    expect(rel).toMatchObject({ version: '0.2.0', channel: 'beta', platform: 'win', state: 'draft', publishedAt: null, files: [] })

    expect((await upload(t, admin, rel.id, 'Atelier-Setup-0.2.0.exe', EXE, '0'.repeat(64))).statusCode).toBe(400)
    expect((await upload(t, admin, rel.id, '../evil.exe', EXE)).statusCode).toBe(400)
    // a blockmap alone is not an installer
    expect((await upload(t, admin, rel.id, 'Atelier-Setup-0.2.0.exe.blockmap', MAP)).statusCode).toBe(200)
    const early = await act(t, admin, rel.id, 'publish')
    expect(early.statusCode).toBe(400)
    expect(early.json().error.message).toContain('installer')

    const sent = await upload(t, admin, rel.id, 'Atelier-Setup-0.2.0.exe', EXE)
    expect(sent.json()).toEqual({ name: 'Atelier-Setup-0.2.0.exe', size: EXE.length, sha512: b64(EXE) })
    // the same name again replaces the file
    expect((await upload(t, admin, rel.id, 'Atelier-Setup-0.2.0.exe', EXE)).statusCode).toBe(200)
    expect(t.cloud.releases.get(rel.id).files).toHaveLength(2)

    expect((await feed(t)).statusCode).toBe(404) // a draft is not on the feed
    const done = Release.parse((await act(t, admin, rel.id, 'publish')).json())
    expect(done.state).toBe('published')
    expect(done.publishedAt).not.toBeNull()

    // a published release is history: no more files, no deletion, the number is taken
    expect((await upload(t, admin, rel.id, 'Atelier-Setup-0.2.0.exe', EXE)).statusCode).toBe(409)
    expect((await act(t, admin, rel.id, 'delete')).statusCode).toBe(409)
    expect((await create(t, admin, { version: '0.2.0', channel: 'beta', platform: 'win' })).statusCode).toBe(409)
    expect((await create(t, admin, { version: 'not-a-version', channel: 'beta', platform: 'win' })).statusCode).toBe(400)
    // another channel or platform may use the same number
    expect((await create(t, admin, { version: '0.2.0', channel: 'stable', platform: 'win' })).statusCode).toBe(200)
  })

  it('asking for a draft again answers the same draft (a retried command), and a draft can be deleted with its files', async () => {
    const t = makeCloud()
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const a = Release.parse((await create(t, admin, { version: '0.3.0', channel: 'beta', platform: 'win', notes: 'a' })).json())
    const b = Release.parse((await create(t, admin, { version: '0.3.0', channel: 'beta', platform: 'win', notes: 'b' })).json())
    expect(b.id).toBe(a.id)
    expect(b.notes).toBe('b')
    await upload(t, admin, a.id, 'Atelier-Setup-0.3.0.exe', EXE)
    expect(await t.cloud.releases.blobs.has(`releases/${a.id}/Atelier-Setup-0.3.0.exe`)).toBe(true)
    expect((await act(t, admin, a.id, 'withdraw')).statusCode).toBe(409) // never published
    expect((await act(t, admin, a.id, 'delete')).json()).toEqual({ ok: true })
    expect(await t.cloud.releases.blobs.has(`releases/${a.id}/Atelier-Setup-0.3.0.exe`)).toBe(false)
    expect((await act(t, admin, a.id, 'publish')).statusCode).toBe(404)
  })

  it('serves latest.yml in electron-updater generic provider format', async () => {
    const t = makeCloud()
    const admin = await signUpAndIn(t, { platformAdmin: true })
    await release(t, admin, '0.2.0', { notes: 'Ligne un\nLigne « deux » avec : deux-points et "guillemets"' })
    const res = await feed(t)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/yaml')
    expect(res.headers['cache-control']).toBe('no-cache')
    const y = await parseYaml(res.body)
    expect(y.version).toBe('0.2.0')
    // the installer only: the blockmap is fetched next to it by the updater, not listed
    expect(y.files).toEqual([{ url: 'Atelier-Setup-0.2.0.exe', sha512: b64(EXE), size: EXE.length }])
    expect(y.path).toBe('Atelier-Setup-0.2.0.exe')
    expect(y.sha512).toBe(b64(EXE))
    expect(Date.parse(y.releaseDate)).toBe(Date.parse(t.cloud.releases.latest('beta', 'win')!.publishedAt!))
    expect(y.releaseNotes).toBe('Ligne un\nLigne « deux » avec : deux-points et "guillemets"')
    // no notes: no releaseNotes line
    const t2 = makeCloud()
    const admin2 = await signUpAndIn(t2, { platformAdmin: true })
    await release(t2, admin2, '0.2.0')
    expect((await parseYaml((await feed(t2)).body)).releaseNotes).toBeUndefined()
  })

  it('serves the files (whole and by byte range), the blockmap too, and nothing that is not published', async () => {
    const t = makeCloud()
    const admin = await signUpAndIn(t, { platformAdmin: true })
    await release(t, admin, '0.2.0')
    const whole = await feed(t, 'beta', 'win', 'Atelier-Setup-0.2.0.exe')
    expect(whole.statusCode).toBe(200)
    expect(whole.headers['content-length']).toBe(String(EXE.length))
    expect(whole.headers['accept-ranges']).toBe('bytes')
    expect(Buffer.from(whole.rawPayload).equals(EXE)).toBe(true)
    expect(Buffer.from((await feed(t, 'beta', 'win', 'Atelier-Setup-0.2.0.exe.blockmap')).rawPayload).equals(MAP)).toBe(true)

    const part = await feed(t, 'beta', 'win', 'Atelier-Setup-0.2.0.exe', { range: 'bytes=10-19' })
    expect(part.statusCode).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 10-19/${EXE.length}`)
    expect(Buffer.from(part.rawPayload).equals(EXE.subarray(10, 20))).toBe(true)
    const tail = await feed(t, 'beta', 'win', 'Atelier-Setup-0.2.0.exe', { range: 'bytes=-5' })
    expect(Buffer.from(tail.rawPayload).equals(EXE.subarray(EXE.length - 5))).toBe(true)
    expect((await feed(t, 'beta', 'win', 'Atelier-Setup-0.2.0.exe', { range: `bytes=${EXE.length}-` })).statusCode).toBe(416)

    expect((await feed(t, 'beta', 'win', 'nothing.exe')).statusCode).toBe(404)
    expect((await feed(t, 'beta', 'win', '..%2Fx')).statusCode).toBe(404)
    expect((await feed(t, 'stable', 'win', 'Atelier-Setup-0.2.0.exe')).statusCode).toBe(404)
    expect((await feed(t, 'nightly', 'win')).statusCode).toBe(404)
    expect((await feed(t, 'beta', 'linux')).statusCode).toBe(404)
  })

  it('parses byte ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull()
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
    for (const bad of ['bytes=100-', 'bytes=5-2', 'bytes=-', 'bytes=-0', 'items=1-2', 'bytes=1-2,5-6']) expect(parseRange(bad, 100), bad).toBe('bad')
    expect(parseRange('bytes=0-0', 0)).toBe('bad')
  })

  it('serves the highest published version; withdrawing it makes the previous one the latest again', async () => {
    const t = makeCloud()
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const v1 = await release(t, admin, '0.2.0', { exe: Buffer.from('one') })
    const v3 = await release(t, admin, '0.10.0', { exe: Buffer.from('three') })
    const v2 = await release(t, admin, '0.3.0', { exe: Buffer.from('two') })
    expect((await parseYaml((await feed(t)).body)).version).toBe('0.10.0') // not the most recent upload, and 0.10 > 0.3
    const listed = ReleaseListResponse.parse((await t.app.inject({ url: '/v1/admin/releases', headers: admin.auth })).json())
    expect(listed.releases.map((r) => r.version)).toEqual(['0.10.0', '0.3.0', '0.2.0'])
    expect(listed.latest).toEqual([{ channel: 'beta', platform: 'win', releaseId: v3, version: '0.10.0' }])

    const out = Release.parse((await act(t, admin, v3, 'withdraw')).json())
    expect(out.state).toBe('withdrawn')
    expect(out.withdrawnAt).not.toBeNull()
    expect((await parseYaml((await feed(t)).body)).version).toBe('0.3.0')
    // its files are gone from the feed; the others stay (an old blockmap is served for a differential download)
    expect((await feed(t, 'beta', 'win', 'Atelier-Setup-0.10.0.exe')).statusCode).toBe(404)
    expect((await feed(t, 'beta', 'win', 'Atelier-Setup-0.2.0.exe.blockmap')).statusCode).toBe(200)
    expect((await act(t, admin, v3, 'withdraw')).statusCode).toBe(200) // again: nothing changes

    await act(t, admin, v2, 'withdraw')
    expect((await parseYaml((await feed(t)).body)).version).toBe('0.2.0')
    await act(t, admin, v1, 'withdraw')
    expect((await feed(t)).statusCode).toBe(404)
    expect(t.cloud.releases.latestAll()).toEqual([])

    // published again (a mistake): back on the feed
    await act(t, admin, v3, 'publish')
    expect((await parseYaml((await feed(t)).body)).version).toBe('0.10.0')
    expect(t.cloud.audit.list().filter((e) => e.action.startsWith('release.')).map((e) => e.action)).toContain('release.withdraw')
  })

  it('keeps channels and platforms apart, and answers latest-mac.yml for macOS', async () => {
    const t = makeCloud()
    const admin = await signUpAndIn(t, { platformAdmin: true })
    await release(t, admin, '0.2.0', { channel: 'beta' })
    await release(t, admin, '0.1.5', { channel: 'stable' })
    await release(t, admin, '0.2.0', { channel: 'beta', platform: 'mac', exe: Buffer.from('zip bytes') })
    expect((await parseYaml((await feed(t, 'beta')).body)).version).toBe('0.2.0')
    expect((await parseYaml((await feed(t, 'stable')).body)).version).toBe('0.1.5')
    const mac = await parseYaml((await feed(t, 'beta', 'mac')).body)
    expect(mac).toMatchObject({ version: '0.2.0', path: 'Atelier-0.2.0-arm64.zip', files: [{ url: 'Atelier-0.2.0-arm64.zip', size: 9 }] })
    // each platform has its own feed file name
    expect((await feed(t, 'beta', 'mac', 'latest.yml')).statusCode).toBe(404)
    expect((await feed(t, 'beta', 'win', 'latest-mac.yml')).statusCode).toBe(404)
    expect((await feed(t, 'stable', 'mac')).statusCode).toBe(404)
  })

  it('refuses a file over the size cap before reading it, and one that grows past it', async () => {
    const t = makeCloud({ releases: { maxFileBytes: 1000 } })
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const id = Release.parse((await create(t, admin, { version: '0.2.0', channel: 'beta', platform: 'win' })).json()).id
    const big = Buffer.alloc(2000, 1)
    const res = await upload(t, admin, id, 'Atelier-Setup-0.2.0.exe', big)
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('too_large')
    expect(res.headers.connection).toBe('close')
    expect((await upload(t, admin, id, 'Atelier-Setup-0.2.0.exe', Buffer.alloc(1000, 1))).statusCode).toBe(200)
    expect(t.cloud.releases.maxFileBytes).toBe(1000)
  })

  it('defaults the cap to about 400 MB', () => {
    const t = makeCloud()
    expect(t.cloud.releases.maxFileBytes).toBe(400 * 1024 * 1024)
  })

  it('orders versions by SemVer precedence', () => {
    const order = ['0.1.0', '0.2.0-beta.1', '0.2.0-beta.2', '0.2.0-beta.10', '0.2.0', '0.10.0', '1.0.0']
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) expect(Math.sign(compareVersions(order[i]!, order[j]!)), `${order[i]} vs ${order[j]}`).toBe(Math.sign(i - j))
    }
  })
})

describe('app releases on a bucket', () => {
  let s3: FakeS3
  let t: TestCloud
  let admin: Person
  beforeEach(async () => {
    s3 = await startFakeS3({ now: () => new Date(t ? t.clock.now() : Date.now()) })
    const dir = mkdtempSync(join(tmpdir(), 'atelier-rel3-'))
    onCleanup(() => rmSync(dir, { recursive: true, force: true }))
    const dbPath = join(dir, 'cloud.db')
    const seed = createCloud({ dbPath, filesDir: dir, signingKey: Buffer.alloc(32, 3), keySource: staticKeySource(TEST_MASTER_KEY), paidCalls: false })
    seed.vault.set(R2_KEY_ID, s3.credentials.accessKeyId, 'test')
    seed.vault.set(R2_SECRET, s3.credentials.secretAccessKey, 'test')
    await seed.close()
    t = makeCloud({ dbPath, filesDir: dir, storage: { kind: 's3', endpoint: s3.endpoint, bucket: s3.bucket, region: 'auto' } })
    admin = await signUpAndIn(t, { platformAdmin: true })
  })
  afterEach(async () => {
    await s3.close()
  })

  it('keeps the files in the bucket and answers a redirect to a presigned link', async () => {
    const id = await release(t, admin, '0.2.0')
    expect(s3.objects.has(`releases/${id}/Atelier-Setup-0.2.0.exe`)).toBe(true)
    const res = await feed(t, 'beta', 'win', 'Atelier-Setup-0.2.0.exe')
    expect(res.statusCode).toBe(302)
    const location = String(res.headers.location)
    expect(location.startsWith(`${s3.endpoint}/${s3.bucket}/releases/${id}/Atelier-Setup-0.2.0.exe?`)).toBe(true)
    expect(location).not.toContain(s3.credentials.secretAccessKey)
    const direct = await fetch(location)
    expect(direct.status).toBe(200)
    expect(hex(Buffer.from(await direct.arrayBuffer()))).toBe(hex(EXE))
    // the feed itself comes from the Cloud, with the hash it computed
    expect((await parseYaml((await feed(t)).body)).sha512).toBe(b64(EXE))
    // withdrawn: no link any more
    await act(t, admin, id, 'withdraw')
    expect((await feed(t, 'beta', 'win', 'Atelier-Setup-0.2.0.exe')).statusCode).toBe(404)
  })
})

describe('the admin tool for releases', () => {
  const io = () => {
    const out: string[] = []
    const err: string[] = []
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    stdout.on('data', (d) => out.push(String(d)))
    stderr.on('data', (d) => err.push(String(d)))
    return { stdin: Object.assign(new PassThrough(), { isTTY: false }), stdout, stderr, text: () => out.join(''), errors: () => err.join('') }
  }

  it('`admin token` gives a platform admin an access token that works as a bearer, and refuses anyone else', async () => {
    const t = makeCloud()
    const admin = await signUpAndIn(t, { platformAdmin: true, email: 'charlie@example.com' })
    const user = await signUpAndIn(t, { email: 'tester@example.com' })
    const a = io()
    expect(await runCli(['admin', 'token', '--email', 'charlie@example.com'], { ...a, env: {}, cloud: t.cloud })).toBe(0)
    const token = a.text().trim()
    expect(token).toMatch(/^atk_[A-Za-z0-9_-]+$/)
    expect(a.errors()).toContain('valid 60 minutes')
    const list = await t.app.inject({ url: '/v1/admin/releases', headers: { authorization: `Bearer ${token}` } })
    expect(list.statusCode).toBe(200)
    // the first device is still signed in too
    expect((await t.app.inject({ url: '/v1/admin/releases', headers: admin.auth })).statusCode).toBe(200)

    const b = io()
    expect(await runCli(['admin', 'token', '--email', 'tester@example.com'], { ...b, env: {}, cloud: t.cloud })).toBe(1)
    expect(b.text()).toBe('')
    expect(b.errors()).toContain('not a platform admin')
    expect(user.accessToken).not.toBe(token)
    expect(await runCli(['admin', 'token', '--email', 'nobody@example.com'], { ...io(), env: {}, cloud: t.cloud })).toBe(1)
  })

  it('`releases list` shows the state and the latest of each feed', async () => {
    const t = makeCloud()
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const empty = io()
    await runCli(['releases', 'list'], { ...empty, env: {}, cloud: t.cloud })
    expect(empty.text()).toContain('(no release yet)')
    await release(t, admin, '0.2.0')
    await release(t, admin, '0.3.0', { draft: true })
    const l = io()
    expect(await runCli(['releases', 'list'], { ...l, env: {}, cloud: t.cloud })).toBe(0)
    expect(l.text()).toMatch(/0\.2\.0\tbeta\/win\tpublished \(latest\)\t2 files/)
    expect(l.text()).toMatch(/0\.3\.0\tbeta\/win\tdraft\t2 files/)
  })
})
