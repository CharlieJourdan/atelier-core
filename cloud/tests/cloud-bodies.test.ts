// Security review, finding 1: no body is read before the caller is known. Over a real socket: an anonymous caller that
// declares 512 MiB and never finishes is refused at once (401, nothing spooled); a signed-in one declaring more than the
// route allows gets 413 at once; a raw upload is streamed to a file (never buffered) and its temporary file is gone after
// the answer; a chunked body past the limit is cut; JSON on an upload route and raw bytes on a JSON route are refused
// unread; and the budgets of large bodies (uploads at once, JSON bytes in flight, whole Cloud and per team) answer 429.
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { MAX_UPLOAD_BYTES } from '../../src/shared/cloud-api.ts'
import { bodyGateOf } from '../src/http/route.ts'
import { BUSY_RETRY_S, DEFAULT_BODY_LIMITS, discardSpooled, isSpooled, spoolParser } from '../src/http/bodies.ts'
import { givePlan, makeCloud, onCleanup, signUpAndIn, type Person, type TestCloud } from './helpers.ts'

const hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

interface Raw {
  socket: net.Socket
  /** The status line and headers, as soon as the server answers (the body may still be "sending"). */
  head: Promise<string>
  /** Bytes the client managed to push before the answer. */
  sent: () => number
}

/** Opens a raw HTTP/1.1 request: the head, then `first` bytes of the body, then nothing (the body never ends). */
function rawRequest(port: number, lines: string[], first: Buffer = Buffer.alloc(0)): Raw {
  const socket = net.connect(port, '127.0.0.1')
  let sent = 0
  const head = new Promise<string>((resolve, reject) => {
    let text = ''
    socket.on('data', (d: Buffer) => {
      text += d.toString('latin1')
      const end = text.indexOf('\r\n\r\n')
      if (end >= 0) resolve(text.slice(0, end))
    })
    socket.on('error', reject)
    socket.on('close', () => resolve(text))
  })
  socket.on('connect', () => {
    socket.write([...lines, 'host: 127.0.0.1', '', ''].join('\r\n'))
    if (first.length) socket.write(first, () => (sent += first.length))
  })
  return { socket, head, sent: () => sent }
}

async function listening(o: Parameters<typeof makeCloud>[0] = {}): Promise<{ t: TestCloud; port: number; spool: string }> {
  const spool = mkdtempSync(join(tmpdir(), 'atelier-spool-'))
  onCleanup(() => rmSync(spool, { recursive: true, force: true }))
  const t = makeCloud({ ...o, server: { ...o.server, uploadsDir: spool } })
  const base = await t.app.listen({ host: '127.0.0.1', port: 0 })
  return { t, port: Number(new URL(base).port), spool }
}

const status = (head: string): number => Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1] ?? 0)
const spooled = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

describe('bodies are refused before they are read', () => {
  it('an anonymous 512 MiB upload that never ends is refused at once with 401, nothing spooled', async () => {
    const { port, spool } = await listening()
    for (const path of ['/v1/uploads?name=a.mp4&sha256=' + '0'.repeat(64), '/v1/team/videos/42/kit/kit_x/files?name=video.mp4&sha256=' + '0'.repeat(64), '/v1/relay/machine/videos/42/kit/kit_x/files?name=video.mp4&sha256=' + '0'.repeat(64), '/v1/team/brain/rpc', '/v1/relay/machine/reply']) {
      const r = rawRequest(port, [`POST ${path} HTTP/1.1`, `content-length: ${MAX_UPLOAD_BYTES}`, 'content-type: application/octet-stream'], randomBytes(64 * 1024))
      const head = await r.head
      expect(status(head), path).toBe(401)
      expect(head.toLowerCase()).toContain('connection: close')
      r.socket.destroy()
    }
    // the same without any length (chunked, endless)
    const chunked = rawRequest(port, ['POST /v1/uploads?name=a.mp4&sha256=' + '0'.repeat(64) + ' HTTP/1.1', 'transfer-encoding: chunked', 'content-type: application/octet-stream'], Buffer.from('10000\r\n'))
    expect(status(await chunked.head)).toBe(401)
    chunked.socket.destroy()
    expect(spooled(spool)).toEqual([])
  })

  it('a signed-in caller declaring more than the route allows gets 413 at once; within the limit the bytes stream to a file that is removed after', async () => {
    const { t, port, spool } = await listening()
    const p = await signUpAndIn(t)
    const over = rawRequest(port, ['POST /v1/uploads?name=a.mp4&sha256=' + '0'.repeat(64) + ' HTTP/1.1', `authorization: ${p.auth.authorization}`, `content-length: ${MAX_UPLOAD_BYTES + 1}`, 'content-type: application/octet-stream'], randomBytes(1024))
    expect(status(await over.head)).toBe(413)
    over.socket.destroy()
    const rpc = rawRequest(port, ['POST /v1/team/brain/rpc HTTP/1.1', `authorization: ${p.auth.authorization}`, `content-length: ${9 * 1024 * 1024}`, 'content-type: application/json'], Buffer.from('{"method":'))
    expect(status(await rpc.head)).toBe(413)
    rpc.socket.destroy()
    expect(spooled(spool)).toEqual([])

    // a real upload: the handler sees a spooled file (hash and size computed on the way in), never a Buffer
    const bytes = randomBytes(3 * 1024 * 1024)
    const seen: unknown[] = []
    const original = t.cloud.storage.putFile.bind(t.cloud.storage)
    vi.spyOn(t.cloud.storage, 'putFile').mockImplementation(async (team, file) => {
      seen.push(file)
      expect(spooled(spool)).toHaveLength(1) // the bytes are on disk while the store copies them
      return original(team, file)
    })
    const res = await fetch(`http://127.0.0.1:${port}/v1/uploads?name=clip.mp4&sha256=${hex(bytes)}`, { method: 'POST', headers: { ...p.auth, 'content-type': 'application/octet-stream' }, body: bytes })
    expect(res.status).toBe(200)
    expect(seen[0]).toMatchObject({ size: bytes.length, sha256: hex(bytes) })
    await vi.waitFor(() => expect(spooled(spool)).toEqual([]))
    expect(bodyGateOf(t.app).usage()).toEqual({ uploads: 0, bufferedBytes: 0 })
  })

  it('a kit file that does not fit in the team’s storage is refused from its declared size, before the body is read', async () => {
    const { t, port, spool } = await listening({ kits: { quotaByPlan: { starter: 1000 } } })
    const p = await signUpAndIn(t)
    givePlan(t, p.teamId, 'starter')
    const { kitId } = (await t.app.inject({ method: 'POST', url: '/v1/team/videos/42/kit', headers: p.auth, payload: { title: 'T', description: '' } })).json() as { kitId: string }
    const r = rawRequest(port, [`POST /v1/team/videos/42/kit/${kitId}/files?name=video.mp4&sha256=${'0'.repeat(64)} HTTP/1.1`, `authorization: ${p.auth.authorization}`, 'content-length: 5000', 'content-type: application/octet-stream'], Buffer.alloc(100))
    expect(status(await r.head)).toBe(403)
    r.socket.destroy()
    expect(spooled(spool)).toEqual([])
  })

  it('refuses JSON on an upload route and raw bytes on a JSON route without reading them', async () => {
    const { t, port, spool } = await listening()
    const p = await signUpAndIn(t)
    const json = rawRequest(port, ['POST /v1/uploads?name=a.txt&sha256=' + '0'.repeat(64) + ' HTTP/1.1', `authorization: ${p.auth.authorization}`, `content-length: ${400 * 1024 * 1024}`, 'content-type: application/json'], Buffer.from('{"a":'))
    expect(status(await json.head)).toBe(400)
    json.socket.destroy()
    const raw = rawRequest(port, ['POST /v1/quotes HTTP/1.1', `authorization: ${p.auth.authorization}`, 'transfer-encoding: chunked', 'content-type: application/octet-stream'], Buffer.from('10000\r\n'))
    expect(status(await raw.head)).toBe(400)
    raw.socket.destroy()
    expect(spooled(spool)).toEqual([])
  })

  it('cuts a chunked raw body at the route limit and removes what was spooled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atelier-spool-unit-'))
    onCleanup(() => rmSync(dir, { recursive: true, force: true }))
    const app = Fastify()
    onCleanup(() => app.close())
    app.addContentTypeParser('application/octet-stream', spoolParser(dir))
    app.setErrorHandler((err: { code?: string }, _req, reply) => void reply.code(err.code === 'too_large' ? 413 : 400).send({ code: err.code }))
    app.post('/v1/uploads', { bodyLimit: 1000, config: { upload: true } }, async (req) => {
      if (!isSpooled(req.body)) return null
      await discardSpooled(req.body) // what route() does after every handler
      return { size: req.body.size, sha256: req.body.sha256 }
    })
    app.post('/json', async () => 'no')
    const base = await app.listen({ host: '127.0.0.1', port: 0 })
    const ok = await fetch(`${base}/v1/uploads`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(1000, 1) })
    expect(await ok.json()).toEqual({ size: 1000, sha256: hex(Buffer.alloc(1000, 1)) })
    const port = Number(new URL(base).port)
    // 4 KiB in one chunk of a chunked body that never ends: cut at 1000 bytes
    const big = rawRequest(port, ['POST /v1/uploads HTTP/1.1', 'transfer-encoding: chunked', 'content-type: application/octet-stream'], Buffer.concat([Buffer.from('1000\r\n'), Buffer.alloc(4096, 2), Buffer.from('\r\n')]))
    expect(status(await big.head)).toBe(413)
    big.socket.destroy()
    await vi.waitFor(() => expect(readdirSync(dir).filter((f) => f.endsWith('.part'))).toEqual([]))
    // a route not flagged as an upload never spools
    const refused = await fetch(`${base}/json`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(10) })
    expect(refused.status).toBe(400)
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('budgets of large bodies', () => {
  const holdUpload = (port: number, who: Person) =>
    rawRequest(port, ['POST /v1/uploads?name=a.bin&sha256=' + '0'.repeat(64) + ' HTTP/1.1', `authorization: ${who.auth.authorization}`, 'content-length: 100000', 'content-type: application/octet-stream'], Buffer.alloc(10))
  const upload = (t: TestCloud, who: Person, bytes: Buffer) =>
    t.app.inject({ method: 'POST', url: `/v1/uploads?name=a.bin&sha256=${hex(bytes)}`, headers: { ...who.auth, 'content-type': 'application/octet-stream' }, payload: bytes })

  it('caps raw uploads at once, per team and on the whole Cloud, and frees a slot when an upload is cut', async () => {
    const { t, port } = await listening({ server: { bodies: { maxUploads: 2, maxUploadsPerTeam: 1 } } })
    const a = await signUpAndIn(t)
    const b = await signUpAndIn(t)
    const c = await signUpAndIn(t)
    const gate = bodyGateOf(t.app)
    const heldA = holdUpload(port, a)
    await vi.waitFor(() => expect(gate.usage().uploads).toBe(1))
    const secondA = await upload(t, a, Buffer.from('x'))
    expect(secondA.statusCode).toBe(429)
    expect(secondA.json()).toMatchObject({ error: { code: 'rate_limited' } })
    // production-17: a busy refusal says when to come back, and a team may send 4 files at once by default
    expect(secondA.headers['retry-after']).toBe(String(BUSY_RETRY_S))
    expect(DEFAULT_BODY_LIMITS.maxUploadsPerTeam).toBe(4)
    expect(DEFAULT_BODY_LIMITS.maxUploadsPerTeam).toBeLessThan(DEFAULT_BODY_LIMITS.maxUploads)
    const heldB = holdUpload(port, b)
    await vi.waitFor(() => expect(gate.usage().uploads).toBe(2))
    expect((await upload(t, c, Buffer.from('x'))).statusCode).toBe(429) // the whole Cloud is full
    heldA.socket.destroy()
    heldB.socket.destroy()
    await vi.waitFor(() => expect(gate.usage().uploads).toBe(0))
    expect((await upload(t, c, Buffer.from('x'))).statusCode).toBe(200)
    expect((await upload(t, a, Buffer.from('y'))).statusCode).toBe(200)
  })

  it('caps the bytes of large JSON bodies in flight per team (declared length, else the route’s whole limit)', async () => {
    const { t, port } = await listening({ server: { bodies: { maxBufferedBytesPerTeam: 1024 * 1024 } } })
    const a = await signUpAndIn(t)
    const b = await signUpAndIn(t)
    const gate = bodyGateOf(t.app)
    const held = rawRequest(port, ['POST /v1/team/brain/rpc HTTP/1.1', `authorization: ${a.auth.authorization}`, `content-length: ${900 * 1024}`, 'content-type: application/json'], Buffer.from('{"method":'))
    await vi.waitFor(() => expect(gate.usage().bufferedBytes).toBe(900 * 1024))
    const second = await t.app.inject({ method: 'POST', url: '/v1/team/brain/rpc', headers: { ...a.auth, 'content-type': 'application/json' }, payload: JSON.stringify({ method: 'app.info', args: ['x'.repeat(200 * 1024)] }) })
    expect(second.statusCode).toBe(429)
    // another team is not held back by this one (its call fails for another reason: it has no team computer)
    expect((await t.app.inject({ method: 'POST', url: '/v1/team/brain/rpc', headers: b.auth, payload: { method: 'app.info', args: ['x'.repeat(200 * 1024)] } })).statusCode).toBe(404)
    // a chunked body (no declared length) counts the route's whole limit: over this team's budget at once
    const chunked = rawRequest(port, ['POST /v1/team/brain/rpc HTTP/1.1', `authorization: ${b.auth.authorization}`, 'transfer-encoding: chunked', 'content-type: application/json'], Buffer.from('1\r\n{\r\n'))
    expect(status(await chunked.head)).toBe(429)
    chunked.socket.destroy()
    held.socket.destroy()
    await vi.waitFor(() => expect(gate.usage().bufferedBytes).toBe(0))
  })
})
