// An S3-compatible server in this process (127.0.0.1, random port, path-style) for the tests: it VERIFIES the SigV4
// signature of every request and of every presigned link (so a signing bug fails here, like on R2), keeps objects in
// memory, supports multipart uploads with the real minimum part size, and counts what it saw. No real network.
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { canonicalPath, presignUrl, sha256, signRequest, type S3Credentials } from '../src/blobs/sigv4.ts'
import { MIN_PART_BYTES } from '../src/blobs/s3.ts'

export interface FakeS3 {
  endpoint: string
  bucket: string
  credentials: S3Credentials
  objects: Map<string, { bytes: Buffer; mime: string }>
  /** `METHOD /bucket/key?query` of every request, in order (signature already checked). */
  log: string[]
  /** Uploads started and not completed or aborted. */
  openUploads(): number
  close(): Promise<void>
}

const parseQuery = (search: string): [string, string][] => [...new URLSearchParams(search)].map(([k, v]) => [k, v])

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

export async function startFakeS3(o: { bucket?: string; region?: string; now?: () => Date } = {}): Promise<FakeS3> {
  const bucket = o.bucket ?? 'atelier-videos'
  const region = o.region ?? 'auto'
  const credentials: S3Credentials = { accessKeyId: 'FAKEACCESSKEYID0001', secretAccessKey: 'fake/secret+access/key/for/tests/only0000' }
  const objects = new Map<string, { bytes: Buffer; mime: string }>()
  const uploads = new Map<string, { key: string; parts: Map<number, Buffer>; mime: string }>()
  const log: string[] = []
  const now = o.now ?? (() => new Date())
  let nextUpload = 1

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const send = (status: number, payload = '', headers: Record<string, string> = {}): void => {
        res.writeHead(status, { 'content-length': Buffer.byteLength(payload), ...headers })
        res.end(req.method === 'HEAD' ? undefined : payload)
      }
      const fail = (status: number, code: string): void => send(status, `<Error><Code>${code}</Code></Error>`, { 'content-type': 'application/xml' })
      const data = await body(req)
      const method = req.method ?? 'GET'
      const query = parseQuery(url.search)
      const pathname = decodeURIComponent(url.pathname)

      // --- authentication: the Authorization header, or the presigned query -------------------------------------------
      const presigned = url.searchParams.has('X-Amz-Signature')
      if (presigned) {
        const expires = Number(url.searchParams.get('X-Amz-Expires'))
        const stamp = url.searchParams.get('X-Amz-Date') ?? ''
        const issued = Date.parse(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`)
        if (now().getTime() > issued + expires * 1000) return fail(403, 'ExpiredToken')
        const extra = Object.fromEntries(query.filter(([k]) => !k.startsWith('X-Amz-')))
        const expected = presignUrl({ method, origin: `http://${req.headers.host}`, path: pathname, query: extra, credentials, region, now: new Date(issued), expiresS: expires })
        if (new URL(expected).searchParams.get('X-Amz-Signature') !== url.searchParams.get('X-Amz-Signature')) return fail(403, 'SignatureDoesNotMatch')
      } else {
        const auth = /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(String(req.headers.authorization ?? ''))
        if (!auth) return fail(403, 'AccessDenied')
        const [, credential, signedHeaders, signature] = auth as unknown as [string, string, string, string]
        if (!credential.startsWith(`${credentials.accessKeyId}/`)) return fail(403, 'InvalidAccessKeyId')
        const headers = Object.fromEntries((signedHeaders as string).split(';').map((h) => [h, String(req.headers[h] ?? '')]))
        const payloadHash = String(req.headers['x-amz-content-sha256'] ?? '')
        if (payloadHash !== sha256(data)) return fail(400, 'XAmzContentSHA256Mismatch')
        const stamp = String(req.headers['x-amz-date'])
        const issued = new Date(Date.parse(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`))
        const again = signRequest({ method, path: pathname, query, headers, payloadHash, credentials, region, service: 's3', now: issued })
        if (again.signature !== signature) return fail(403, 'SignatureDoesNotMatch')
      }
      log.push(`${method} ${canonicalPath(pathname)}${query.filter(([k]) => !k.startsWith('X-Amz-')).length ? '?' + query.filter(([k]) => !k.startsWith('X-Amz-')).map(([k]) => k).join('&') : ''}`)

      const prefix = `/${bucket}/`
      if (!pathname.startsWith(prefix)) return fail(404, 'NoSuchBucket')
      const key = pathname.slice(prefix.length)

      // --- multipart --------------------------------------------------------------------------------------------------
      if (method === 'POST' && url.searchParams.has('uploads')) {
        const id = `upload-${nextUpload++}`
        uploads.set(id, { key, parts: new Map(), mime: String(req.headers['content-type'] ?? 'application/octet-stream') })
        return send(200, `<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`, { 'content-type': 'application/xml' })
      }
      const uploadId = url.searchParams.get('uploadId')
      if (uploadId) {
        const up = uploads.get(uploadId)
        if (!up || up.key !== key) return fail(404, 'NoSuchUpload')
        if (method === 'PUT') {
          const n = Number(url.searchParams.get('partNumber'))
          if (!Number.isInteger(n) || n < 1 || n > 10_000) return fail(400, 'InvalidArgument')
          up.parts.set(n, data)
          return send(200, '', { etag: `"${createHash('md5').update(data).digest('hex')}"` })
        }
        if (method === 'DELETE') {
          uploads.delete(uploadId)
          return send(204)
        }
        if (method === 'POST') {
          const wanted = [...data.toString('utf8').matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>([^<]+)<\/ETag>/g)].map((m) => [Number(m[1]), m[2]] as const)
          const chunks: Buffer[] = []
          for (const [i, [n, etag]] of wanted.entries()) {
            const part = up.parts.get(n)
            if (!part || etag !== `"${createHash('md5').update(part).digest('hex')}"`) return fail(400, 'InvalidPart')
            if (i < wanted.length - 1 && part.byteLength < MIN_PART_BYTES) return fail(400, 'EntityTooSmall')
            chunks.push(part)
          }
          objects.set(key, { bytes: Buffer.concat(chunks), mime: up.mime })
          uploads.delete(uploadId)
          return send(200, `<CompleteMultipartUploadResult><Key>${key}</Key><ETag>"done"</ETag></CompleteMultipartUploadResult>`, { 'content-type': 'application/xml' })
        }
      }

      // --- plain objects ----------------------------------------------------------------------------------------------
      if (method === 'PUT') {
        objects.set(key, { bytes: data, mime: String(req.headers['content-type'] ?? 'application/octet-stream') })
        return send(200, '', { etag: `"${createHash('md5').update(data).digest('hex')}"` })
      }
      if (method === 'GET' || method === 'HEAD') {
        const obj = objects.get(key)
        if (!obj) return fail(404, 'NoSuchKey')
        const disposition = url.searchParams.get('response-content-disposition')
        const headers: Record<string, string> = {
          'content-type': url.searchParams.get('response-content-type') ?? obj.mime,
          ...(disposition ? { 'content-disposition': disposition } : {})
        }
        res.writeHead(200, { ...headers, 'content-length': obj.bytes.byteLength })
        return void res.end(method === 'HEAD' ? undefined : obj.bytes)
      }
      if (method === 'DELETE') {
        objects.delete(key)
        return send(204)
      }
      return fail(405, 'MethodNotAllowed')
    })().catch(() => {
      res.statusCode = 500
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    endpoint: `http://127.0.0.1:${port}`,
    bucket,
    credentials,
    objects,
    log,
    openUploads: () => uploads.size,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
