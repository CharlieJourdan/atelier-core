// The object-storage backend against an in-process S3 server that verifies every signature: single and multipart uploads,
// presigned links (shape, expiry, tampering), the refusal to start without keys, and the Cloud's own routes on top of a
// bucket (uploads, the signed /files link redirecting to the bucket so the bytes never pass through the Cloud).
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Artefact } from '../../src/shared/cloud-api.ts'
import { openBlobStore, R2_KEY_ID, R2_SECRET } from '../src/blobs/index.ts'
import { LocalBlobStore } from '../src/blobs/local.ts'
import { MIN_PART_BYTES, S3BlobStore, S3Error } from '../src/blobs/s3.ts'
import { createCloud } from '../src/cloud.ts'
import { runCli } from '../src/cli.ts'
import { loadConfig } from '../src/config.ts'
import { initKeyFile, staticKeySource } from '../src/keysource.ts'
import { startFakeS3, type FakeS3 } from './fake-s3.ts'
import { makeCloud, onCleanup, signUpAndIn, TEST_MASTER_KEY } from './helpers.ts'

let s3: FakeS3
let clockMs = Date.UTC(2026, 9, 19, 9, 0, 0)
beforeEach(async () => {
  clockMs = Date.UTC(2026, 9, 19, 9, 0, 0)
  s3 = await startFakeS3({ now: () => new Date(clockMs) })
})
afterEach(async () => {
  await s3.close()
})

const store = (o: Partial<ConstructorParameters<typeof S3BlobStore>[0]> = {}): S3BlobStore =>
  new S3BlobStore({ endpoint: s3.endpoint, bucket: s3.bucket, region: 'auto', credentials: () => s3.credentials, now: () => new Date(clockMs), ...o })

const hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

describe('S3BlobStore', () => {
  it('puts, gets, checks and deletes an object, every request signed', async () => {
    const st = store()
    const bytes = Buffer.from('une vidéo très courte')
    expect(await st.has('teams/t1/a.txt')).toBe(false)
    await st.put('teams/t1/a.txt', bytes, 'text/plain')
    expect(await st.has('teams/t1/a.txt')).toBe(true)
    expect((await st.get('teams/t1/a.txt')).equals(bytes)).toBe(true)
    expect(s3.objects.get('teams/t1/a.txt')?.mime).toBe('text/plain')
    await st.delete('teams/t1/a.txt')
    await st.delete('teams/t1/a.txt') // already gone: not an error
    expect(await st.has('teams/t1/a.txt')).toBe(false)
    expect(s3.log).toEqual([
      'HEAD /atelier-videos/teams/t1/a.txt',
      'PUT /atelier-videos/teams/t1/a.txt',
      'HEAD /atelier-videos/teams/t1/a.txt',
      'GET /atelier-videos/teams/t1/a.txt',
      'DELETE /atelier-videos/teams/t1/a.txt',
      'DELETE /atelier-videos/teams/t1/a.txt',
      'HEAD /atelier-videos/teams/t1/a.txt'
    ])
  })

  it('refuses wrong keys with the service’s error code and never puts a secret in the message', async () => {
    const bad = store({ credentials: () => ({ accessKeyId: s3.credentials.accessKeyId, secretAccessKey: 'not-the-secret-0000000000000000' }) })
    const err = await bad.put('teams/t1/x', Buffer.from('x'), 'text/plain').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(S3Error)
    expect((err as S3Error).message).toBe('object storage refused put: 403 SignatureDoesNotMatch')
    expect(JSON.stringify(err)).not.toContain('not-the-secret')
    const unknown = store({ credentials: () => ({ accessKeyId: 'SOMEONEELSE', secretAccessKey: 'x'.repeat(30) }) })
    expect(((await unknown.get('teams/t1/x').catch((e: unknown) => e)) as S3Error).code).toBe('InvalidAccessKeyId')
  })

  it('uploads a big object in parts of the configured size, in order, and completes it', async () => {
    const st = store({ partSizeBytes: MIN_PART_BYTES })
    const bytes = randomBytes(2 * MIN_PART_BYTES + 12345) // 3 parts, the last one small
    await st.put('teams/t1/big.mp4', bytes, 'video/mp4')
    expect(s3.log).toEqual([
      'POST /atelier-videos/teams/t1/big.mp4?uploads',
      'PUT /atelier-videos/teams/t1/big.mp4?partNumber&uploadId',
      'PUT /atelier-videos/teams/t1/big.mp4?partNumber&uploadId',
      'PUT /atelier-videos/teams/t1/big.mp4?partNumber&uploadId',
      'POST /atelier-videos/teams/t1/big.mp4?uploadId'
    ])
    const stored = s3.objects.get('teams/t1/big.mp4')
    expect(stored?.mime).toBe('video/mp4')
    expect(hex(stored?.bytes ?? Buffer.alloc(0))).toBe(hex(bytes))
    expect(s3.openUploads()).toBe(0)
    // at the threshold exactly: still a single request
    s3.log.length = 0
    await st.put('teams/t1/edge.bin', randomBytes(MIN_PART_BYTES), 'application/octet-stream')
    expect(s3.log).toEqual(['PUT /atelier-videos/teams/t1/edge.bin'])
  })

  it('uploads a raw upload from its file part by part (never the whole file in memory), small files in one request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atelier-putfile-'))
    onCleanup(() => rmSync(dir, { recursive: true, force: true }))
    const bytes = randomBytes(2 * MIN_PART_BYTES + 777)
    const file = join(dir, 'upload.part')
    writeFileSync(file, bytes)
    const st = store({ partSizeBytes: MIN_PART_BYTES })
    await st.putFile('teams/t1/from-file.mp4', file, bytes.length, 'video/mp4')
    expect(s3.log.filter((l) => l.startsWith('PUT')).length).toBe(3)
    expect(hex(s3.objects.get('teams/t1/from-file.mp4')?.bytes ?? Buffer.alloc(0))).toBe(hex(bytes))
    expect(s3.openUploads()).toBe(0)
    s3.log.length = 0
    writeFileSync(file, Buffer.from('petit'))
    await st.putFile('teams/t1/small.txt', file, 5, 'text/plain')
    expect(s3.log).toEqual(['PUT /atelier-videos/teams/t1/small.txt'])
    expect(s3.objects.get('teams/t1/small.txt')?.bytes.toString()).toBe('petit')
    // the local store copies the file (the upload's temporary file stays the caller's to remove)
    const local = new LocalBlobStore(join(dir, 'store'))
    await local.putFile('teams/t1/small.txt', file)
    expect((await local.get('teams/t1/small.txt')).toString()).toBe('petit')
    expect(readdirSync(dir)).toContain('upload.part')
  })

  it('aborts the multipart upload when a part fails, so no orphan parts are kept', async () => {
    let puts = 0
    const flaky: typeof fetch = async (input, init) => {
      if (init?.method === 'PUT' && String(input).includes('partNumber=2')) {
        puts++
        return new Response('<Error><Code>InternalError</Code></Error>', { status: 500, headers: { 'content-type': 'application/xml' } })
      }
      return fetch(input, init)
    }
    const st = store({ partSizeBytes: MIN_PART_BYTES, fetchImpl: flaky })
    const err = await st.put('teams/t1/big.mp4', randomBytes(2 * MIN_PART_BYTES + 1), 'video/mp4').catch((e: unknown) => e)
    expect((err as S3Error).message).toBe('object storage refused upload-part: 500 InternalError')
    expect(puts).toBe(1)
    expect(s3.openUploads()).toBe(0)
    expect(s3.log.at(-1)).toBe('DELETE /atelier-videos/teams/t1/big.mp4?uploadId')
    expect(s3.objects.has('teams/t1/big.mp4')).toBe(false)
  })

  it('rejects unusable settings and unsafe keys', async () => {
    const base = { bucket: 'atelier-videos', region: 'auto', credentials: () => s3.credentials }
    expect(() => new S3BlobStore({ ...base, endpoint: 'http://r2.example.com' })).toThrow(/https/)
    expect(() => new S3BlobStore({ ...base, endpoint: 'https://acct.r2.cloudflarestorage.com/path' })).toThrow(/no path/)
    expect(() => new S3BlobStore({ ...base, endpoint: 'not a url' })).toThrow(/URL/)
    expect(() => new S3BlobStore({ ...base, endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'Bad Bucket' })).toThrow(/bucket/)
    expect(() => new S3BlobStore({ ...base, endpoint: 'https://acct.r2.cloudflarestorage.com', partSizeBytes: 1024 })).toThrow(/5 MiB/)
    const st = store()
    await expect(st.get('../escape')).rejects.toThrow(/unsafe storage key/)
    await expect(st.get('teams//double')).rejects.toThrow(/unsafe storage key/)
    expect(s3.log).toEqual([])
  })
})

describe('presigned links', () => {
  it('are short-lived links to the bucket that download the object under its file name', async () => {
    const st = store()
    const bytes = randomBytes(5000)
    await st.put('teams/t1/artefacts/abc', bytes, 'video/mp4')
    const url = st.presignGet('teams/t1/artefacts/abc', { ttlS: 300, filename: 'ma vidéo (1).mp4', mime: 'video/mp4' })
    const u = new URL(url)
    expect(u.origin).toBe(s3.endpoint)
    expect(u.pathname).toBe('/atelier-videos/teams/t1/artefacts/abc')
    expect(u.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(u.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(u.searchParams.get('X-Amz-Credential')).toBe(`${s3.credentials.accessKeyId}/20261019/auto/s3/aws4_request`)
    expect(u.searchParams.get('X-Amz-Date')).toBe('20261019T090000Z')
    expect(u.searchParams.get('response-content-disposition')).toBe('attachment; filename="ma_vid_o__1_.mp4"')
    expect(url).not.toContain(s3.credentials.secretAccessKey)

    const ok = await fetch(url)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-disposition')).toBe('attachment; filename="ma_vid_o__1_.mp4"')
    expect(ok.headers.get('content-type')).toBe('video/mp4')
    expect(Buffer.from(await ok.arrayBuffer()).equals(bytes)).toBe(true)

    // another object's path with this signature, a changed expiry, a stripped signature: all refused
    expect((await fetch(url.replace('/abc', '/abd'))).status).toBe(403)
    expect((await fetch(url.replace('X-Amz-Expires=300', 'X-Amz-Expires=900'))).status).toBe(403)
    expect((await fetch(url.replace(/&X-Amz-Signature=[0-9a-f]+/, ''))).status).toBe(403)

    // after the expiry the service itself refuses
    clockMs += 301_000
    const late = await fetch(url)
    expect(late.status).toBe(403)
    expect(await late.text()).toContain('ExpiredToken')
  })

  it('are not offered by the local store', () => {
    expect(new LocalBlobStore(tmpdir()).presignGet()).toBeNull()
  })
})

describe('config.json', () => {
  const load = (storage: unknown): ReturnType<typeof loadConfig> => {
    const dir = mkdtempSync(join(tmpdir(), 'atelier-cfg-'))
    onCleanup(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ storage }))
    return loadConfig(dir, {})
  }
  it('defaults to the local folder and checks the bucket settings', () => {
    expect(load(undefined).storage).toEqual({ kind: 'local', region: 'auto' })
    expect(load({ kind: 's3', endpoint: 'https://abc.r2.cloudflarestorage.com', bucket: 'atelier-videos' }).storage).toMatchObject({ kind: 's3', region: 'auto' })
    expect(() => load({ kind: 's3', bucket: 'atelier-videos' })).toThrow(/storage.endpoint and storage.bucket/)
    expect(() => load({ kind: 's3', endpoint: 'https://abc.r2.cloudflarestorage.com' })).toThrow(/storage.endpoint and storage.bucket/)
    expect(() => load({ kind: 's3', endpoint: 'http://abc.r2.example.com', bucket: 'atelier-videos' })).toThrow(/https/)
    expect(() => load({ kind: 's3', endpoint: 'https://abc.r2.example.com/bucket', bucket: 'atelier-videos' })).toThrow(/nothing after/)
    expect(() => load({ kind: 'gcs' })).toThrow()
    expect(load({ kind: 's3', endpoint: 'http://127.0.0.1:9000', bucket: 'atelier-videos' }).storage.kind).toBe('s3')
  })
})

describe('the admin tool with an s3 config', () => {
  it('lets the keys be put in the vault after config.json says "s3", while every other command refuses until they are there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atelier-cli-s3-'))
    onCleanup(() => rmSync(dir, { recursive: true, force: true }))
    const keyFile = join(dir, 'master.key')
    initKeyFile(keyFile)
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ storage: { kind: 's3', endpoint: 'https://abc.r2.cloudflarestorage.com', bucket: 'atelier-videos' } }))
    const env = { ATELIER_CLOUD_DATA: dir, ATELIER_CLOUD_MASTER_KEY_FILE: keyFile }
    const run = async (argv: string[], input = ''): Promise<{ code: number; text: string; errors: string }> => {
      const stdin = Object.assign(new PassThrough(), { isTTY: false })
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      const out: string[] = []
      const err: string[] = []
      stdout.on('data', (d) => out.push(String(d)))
      stderr.on('data', (d) => err.push(String(d)))
      stdin.end(input)
      const code = await runCli(argv, { stdin, stdout, stderr, env })
      return { code, text: out.join(''), errors: err.join('') }
    }
    const refused = await run(['admin', 'team', 'list'])
    expect(refused.code).toBe(1)
    expect(refused.errors).toContain('R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY is missing from the vault')
    expect((await run(['vault', 'set', 'R2_ACCESS_KEY_ID', '--from-stdin'], 'AKIAFAKEFAKEFAKE0001\n')).code).toBe(0)
    expect((await run(['admin', 'team', 'list'])).code).toBe(1) // one key is not enough
    expect((await run(['vault', 'set', 'R2_SECRET_ACCESS_KEY', '--from-stdin'], 'fake-secret-fake-secret-fake-0001\n')).code).toBe(0)
    const listed = await run(['vault', 'list'])
    expect(listed.text).toContain('R2_ACCESS_KEY_ID')
    expect(listed.text).toContain('R2_SECRET_ACCESS_KEY')
    expect(listed.text).not.toContain('fake-secret')
    expect((await run(['admin', 'team', 'list'])).code).toBe(0) // both keys are there: the Cloud opens on the bucket
  })
})

describe('the Cloud on a bucket', () => {
  // the folder is removed after makeCloud's own cleanup (it closes the database) because this one is registered first
  const tmpDir = (prefix: string): string => {
    const d = mkdtempSync(join(tmpdir(), prefix))
    onCleanup(() => rmSync(d, { recursive: true, force: true }))
    return d
  }
  const withKeys = async (dbPath: string): Promise<void> => {
    // the keys go into the vault first (as `npm run cloud -- vault set` does), then config.json says "s3"
    const seed = createCloud({ dbPath, filesDir: tmpdir(), signingKey: Buffer.alloc(32, 3), keySource: staticKeySource(TEST_MASTER_KEY), paidCalls: false })
    seed.vault.set(R2_KEY_ID, s3.credentials.accessKeyId, 'test')
    seed.vault.set(R2_SECRET, s3.credentials.secretAccessKey, 'test')
    await seed.close()
  }
  const settings = (): { kind: 's3'; endpoint: string; bucket: string; region: string } => ({ kind: 's3', endpoint: s3.endpoint, bucket: s3.bucket, region: 'auto' })

  it('refuses to start without its keys: no silent fallback to the local folder', () => {
    const dir = tmpDir('atelier-nokeys-')
    const open = (storage: Record<string, unknown>) =>
      createCloud({ dbPath: ':memory:', filesDir: dir, signingKey: Buffer.alloc(32, 3), keySource: staticKeySource(TEST_MASTER_KEY), paidCalls: false, storage: storage as never })
    expect(() => open(settings())).toThrow(/storage is "s3" but R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY is missing from the vault/)
    expect(() => open({ kind: 's3', bucket: 'atelier-videos' })).toThrow(/storage.endpoint or storage.bucket is missing/)
    expect(readdirSync(dir)).toEqual([]) // nothing was written locally
    expect(() => open({ kind: 'local' })).not.toThrow()
    expect(() => openBlobStore({ settings: undefined, filesDir: dir, vault: null as never })).not.toThrow()
  })

  it('stores uploads in the bucket and serves downloads by redirecting to a presigned link', async () => {
    const dir = tmpDir('atelier-s3cloud-')
    const dbPath = join(dir, 'cloud.db')
    await withKeys(dbPath)
    const t = makeCloud({ dbPath, storage: settings(), filesDir: dir })
    const p = await signUpAndIn(t)
    const bytes = randomBytes(300_000)
    const up = await t.app.inject({
      method: 'POST',
      url: `/v1/uploads?name=clip.mp4&sha256=${hex(bytes)}`,
      headers: { ...p.auth, 'content-type': 'application/octet-stream' },
      payload: bytes
    })
    expect(up.statusCode).toBe(200)
    const a = Artefact.parse(up.json())
    const key = `teams/${p.teamId}/artefacts/${a.sha256}`
    expect(hex(s3.objects.get(key)?.bytes ?? Buffer.alloc(0))).toBe(a.sha256)
    expect(readdirSync(dir).filter((f) => f === 'teams')).toEqual([]) // nothing on the Cloud's disk
    // the same content again is not sent again
    s3.log.length = 0
    await t.app.inject({ method: 'POST', url: `/v1/uploads?name=autre.mp4&sha256=${a.sha256}`, headers: { ...p.auth, 'content-type': 'application/octet-stream' }, payload: bytes })
    expect(s3.log).toEqual([])

    // the artefact link of the API goes straight to the bucket (15 minutes), nothing through the Cloud
    const link = await t.app.inject({ url: `/v1/artefacts/${a.id}`, headers: p.auth })
    const api = link.json() as { url: string }
    expect(api.url.startsWith(`${s3.endpoint}/${s3.bucket}/${key}?`)).toBe(true)
    expect(new URL(api.url).searchParams.get('X-Amz-Expires')).toBe('900')
    expect((await fetch(api.url)).status).toBe(200)

    // the signed Cloud link (the one remote executors get) answers a redirect to the bucket
    const signed = t.cloud.storage.signedPath(a.id)
    const viaCloud = await t.app.inject({ url: signed.path })
    expect(viaCloud.statusCode).toBe(302)
    expect(viaCloud.body).toBe('')
    const location = viaCloud.headers.location as string
    expect(location.startsWith(`${s3.endpoint}/${s3.bucket}/${key}?`)).toBe(true)
    expect(new URL(location).searchParams.get('X-Amz-Expires')).toBe('120')
    const direct = await fetch(location)
    expect(direct.status).toBe(200)
    expect(hex(Buffer.from(await direct.arrayBuffer()))).toBe(a.sha256)
    // a tampered Cloud link is still refused before any redirect
    expect((await t.app.inject({ url: `/files/${a.id}?exp=1&sig=bad` })).statusCode).toBe(403)
  })
})
