// An S3-compatible object store over `fetch` (Cloudflare R2: endpoint https://<account>.r2.cloudflarestorage.com, region
// "auto", path-style addressing), signed with our own SigV4 (sigv4.ts). Small objects go in one PUT; big ones use a
// multipart upload (parts of `partSizeBytes`, aborted on failure so no orphan parts are billed). Downloads are
// presigned links the browser or the app follows directly. The fetch and the clock are injected: tests run it against
// an in-process fake server and never reach the network.
import { open } from 'node:fs/promises'
import { amzDate, canonicalPath, canonicalQuery, presignUrl, sha256, signRequest, EMPTY_SHA256, type S3Credentials } from './sigv4.ts'
import { checkKey, type BlobStore, type PresignOptions } from './types.ts'

/** S3 and R2 refuse parts under 5 MiB (the last one may be smaller). */
export const MIN_PART_BYTES = 5 * 1024 * 1024
export const DEFAULT_PART_BYTES = 16 * 1024 * 1024
/** At most 10 000 parts per upload. */
const MAX_PARTS = 10_000

export interface S3Options {
  /** `https://<account>.r2.cloudflarestorage.com`; plain http only for a loopback host (the fake server of the tests). */
  endpoint: string
  bucket: string
  region: string
  credentials: () => S3Credentials
  fetchImpl?: typeof fetch
  now?: () => Date
  /** Objects up to this size go in one request; bigger ones are cut into parts of this size (default 16 MiB). */
  partSizeBytes?: number
}

/** A refusal from the storage service: its status and S3 error code, never a secret or a signed URL. */
export class S3Error extends Error {
  readonly status: number
  readonly code: string
  constructor(op: string, status: number, code: string) {
    super(`object storage refused ${op}: ${status} ${code}`)
    this.name = 'S3Error'
    this.status = status
    this.code = code
  }
}

export function checkEndpoint(endpoint: string): URL {
  let u: URL
  try {
    u = new URL(endpoint)
  } catch {
    throw new Error('storage.endpoint must be a URL like https://<account>.r2.cloudflarestorage.com')
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && loopback))) throw new Error('storage.endpoint must be https (http only for a loopback address)')
  if (u.pathname !== '/' || u.search || u.username) throw new Error('storage.endpoint is the service address only, no path')
  return u
}

const xmlTag = (xml: string, tag: string): string | null => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1] ?? null

export class S3BlobStore implements BlobStore {
  readonly kind = 's3' as const
  private readonly o: S3Options
  private readonly origin: string
  private readonly partSize: number
  constructor(o: S3Options) {
    this.origin = checkEndpoint(o.endpoint).origin
    if (!/^[a-z0-9][a-z0-9.-]{2,62}$/.test(o.bucket)) throw new Error('storage.bucket is not a valid bucket name')
    this.partSize = o.partSizeBytes ?? DEFAULT_PART_BYTES
    if (this.partSize < MIN_PART_BYTES) throw new Error('multipart parts must be at least 5 MiB')
    this.o = o
  }

  private pathOf(key: string): string {
    checkKey(key)
    return `/${this.o.bucket}/${key}`
  }

  private now(): Date {
    return (this.o.now ?? (() => new Date()))()
  }

  /** One signed request. */
  private async send(
    op: string,
    method: string,
    path: string,
    o: { query?: [string, string][]; body?: Uint8Array; mime?: string; ok?: number[] } = {}
  ): Promise<{ status: number; text: string; headers: Headers; body: Buffer }> {
    const body = o.body
    const now = this.now()
    const payloadHash = body ? sha256(body) : EMPTY_SHA256
    const query = o.query ?? []
    const headers: Record<string, string> = {
      host: new URL(this.origin).host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate(now),
      ...(o.mime ? { 'content-type': o.mime } : {})
    }
    const signed = signRequest({ method, path, query, headers, payloadHash, credentials: this.o.credentials(), region: this.o.region, service: 's3', now })
    const qs = query.length ? `?${canonicalQuery(query)}` : ''
    const sendHeaders = Object.fromEntries(Object.entries(headers).filter(([k]) => k !== 'host'))
    const res = await (this.o.fetchImpl ?? fetch)(`${this.origin}${canonicalPath(path)}${qs}`, {
      method,
      headers: { ...sendHeaders, authorization: signed.authorization },
      ...(body ? { body } : {})
    })
    const buf = Buffer.from(await res.arrayBuffer())
    const text = res.headers.get('content-type')?.includes('xml') || !res.ok ? buf.toString('utf8') : ''
    if (!(o.ok ?? [200]).includes(res.status)) throw new S3Error(op, res.status, xmlTag(text, 'Code') ?? 'unknown')
    return { status: res.status, text, headers: res.headers, body: buf }
  }

  async put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    await this.upload(key, bytes.byteLength, mime, async (start, end) => bytes.subarray(start, end))
  }

  async putFile(key: string, path: string, size: number, mime: string): Promise<void> {
    const fh = await open(path, 'r')
    try {
      await this.upload(key, size, mime, async (start, end) => {
        const buf = Buffer.alloc(end - start)
        let at = 0
        while (at < buf.length) {
          const { bytesRead } = await fh.read(buf, at, buf.length - at, start + at)
          if (bytesRead === 0) throw new Error('the upload file is shorter than its size')
          at += bytesRead
        }
        return buf
      })
    } finally {
      await fh.close()
    }
  }

  /** One request up to a part's size; above, a multipart upload that reads one part at a time. */
  private async upload(key: string, size: number, mime: string, slice: (start: number, end: number) => Promise<Uint8Array>): Promise<void> {
    const path = this.pathOf(key)
    if (size <= this.partSize) {
      await this.send('put', 'PUT', path, { body: await slice(0, size), mime })
      return
    }
    const parts = Math.ceil(size / this.partSize)
    if (parts > MAX_PARTS) throw new Error('this file needs more than 10 000 parts: raise the part size')
    const started = await this.send('create-multipart', 'POST', path, { query: [['uploads', '']], mime })
    const uploadId = xmlTag(started.text, 'UploadId')
    if (!uploadId) throw new S3Error('create-multipart', started.status, 'no UploadId')
    try {
      const etags: string[] = []
      for (let i = 0; i < parts; i++) {
        const chunk = await slice(i * this.partSize, Math.min(size, (i + 1) * this.partSize))
        const r = await this.send('upload-part', 'PUT', path, { query: [['partNumber', String(i + 1)], ['uploadId', uploadId]], body: chunk })
        const etag = r.headers.get('etag')
        if (!etag) throw new S3Error('upload-part', r.status, 'no ETag')
        etags.push(etag)
      }
      const xml = `<CompleteMultipartUpload>${etags.map((e, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${e.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
      const done = await this.send('complete-multipart', 'POST', path, { query: [['uploadId', uploadId]], body: Buffer.from(xml, 'utf8'), mime: 'application/xml' })
      // S3 may answer 200 with an <Error> body when completion fails after the headers were sent
      if (xmlTag(done.text, 'Code') && !xmlTag(done.text, 'ETag')) throw new S3Error('complete-multipart', done.status, xmlTag(done.text, 'Code') ?? 'unknown')
    } catch (err) {
      await this.send('abort-multipart', 'DELETE', path, { query: [['uploadId', uploadId]], ok: [200, 204, 404] }).catch(() => undefined)
      throw err
    }
  }

  async get(key: string): Promise<Buffer> {
    return (await this.send('get', 'GET', this.pathOf(key))).body
  }

  async has(key: string): Promise<boolean> {
    try {
      await this.send('head', 'HEAD', this.pathOf(key))
      return true
    } catch (err) {
      if (err instanceof S3Error && err.status === 404) return false
      throw err
    }
  }

  async delete(key: string): Promise<void> {
    await this.send('delete', 'DELETE', this.pathOf(key), { ok: [200, 204, 404] })
  }

  /** A short-lived link a remote worker PUTs one file to (vps-rendu: the render job's upload slots). */
  presignPut(key: string, ttlS: number): string {
    return presignUrl({ method: 'PUT', origin: this.origin, path: this.pathOf(key), credentials: this.o.credentials(), region: this.o.region, now: this.now(), expiresS: ttlS })
  }

  presignGet(key: string, o: PresignOptions): string {
    const safeName = o.filename.replace(/[^A-Za-z0-9._-]/g, '_')
    return presignUrl({
      method: 'GET',
      origin: this.origin,
      path: this.pathOf(key),
      query: { 'response-content-disposition': `attachment; filename="${safeName}"`, 'response-content-type': o.mime },
      credentials: this.o.credentials(),
      region: this.o.region,
      now: this.now(),
      expiresS: o.ttlS
    })
  }
}
