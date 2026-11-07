// AWS Signature Version 4 for S3-compatible object storage (Cloudflare R2 first), written with node:crypto only: the
// `Authorization` header form and the query-string form (presigned URLs). Pure functions of their inputs (the date is
// passed in), checked against the worked examples of the AWS documentation in cloud/tests/cloud-s3-sigv4.test.ts.
import { createHash, createHmac } from 'node:crypto'

export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
}

export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'
export const EMPTY_SHA256 = createHash('sha256').update('').digest('hex')

export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest()

/** RFC 3986 percent-encoding as SigV4 wants it: only A-Z a-z 0-9 - . _ ~ stay; `/` stays when `keepSlash`. */
export function uriEncode(value: string, keepSlash = false): string {
  let out = ''
  for (const byte of Buffer.from(value, 'utf8')) {
    const ch = String.fromCharCode(byte)
    if (/[A-Za-z0-9\-._~]/.test(ch) || (keepSlash && ch === '/')) out += ch
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

/** `20130524T000000Z` */
export const amzDate = (now: Date): string => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

function signingKey(secret: string, day: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), 'aws4_request')
}

/** The canonical query string: names and values encoded, sorted by name (then value). */
export function canonicalQuery(query: Iterable<[string, string]>): string {
  return [...query]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

/** The canonical (already encoded) path of an object: every segment encoded once, as S3 does. */
export const canonicalPath = (path: string): string => uriEncode(path, true)

interface Core {
  method: string
  /** Unencoded path, starting with `/`. */
  path: string
  query: Iterable<[string, string]>
  /** Header names (any case) to values: every one of them is signed. */
  headers: Record<string, string>
  payloadHash: string
  credentials: S3Credentials
  region: string
  service: string
  now: Date
}

function derive(c: Core): { signedHeaders: string; signature: string; scope: string; credential: string; canonicalRequest: string } {
  const stamp = amzDate(c.now)
  const day = stamp.slice(0, 8)
  const entries = Object.entries(c.headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const signedHeaders = entries.map(([k]) => k).join(';')
  const canonicalRequest = [
    c.method.toUpperCase(),
    canonicalPath(c.path),
    canonicalQuery(c.query),
    entries.map(([k, v]) => `${k}:${v}\n`).join(''),
    signedHeaders,
    c.payloadHash
  ].join('\n')
  const scope = `${day}/${c.region}/${c.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonicalRequest)].join('\n')
  const signature = createHmac('sha256', signingKey(c.credentials.secretAccessKey, day, c.region, c.service)).update(stringToSign, 'utf8').digest('hex')
  return { signedHeaders, signature, scope, credential: `${c.credentials.accessKeyId}/${scope}`, canonicalRequest }
}

export interface SignedHeaders {
  /** The value of the `Authorization` header. */
  authorization: string
  signature: string
  signedHeaders: string
  canonicalRequest: string
}

/** Header-based signing. `headers` must hold `host`, `x-amz-date` and `x-amz-content-sha256` (all are signed). */
export function signRequest(c: Core): SignedHeaders {
  const d = derive(c)
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${d.credential}, SignedHeaders=${d.signedHeaders}, Signature=${d.signature}`,
    signature: d.signature,
    signedHeaders: d.signedHeaders,
    canonicalRequest: d.canonicalRequest
  }
}

export interface PresignInput {
  method: string
  /** `https://host[:port]`, no path. */
  origin: string
  /** Unencoded path, starting with `/`. */
  path: string
  /** Extra query parameters that are signed with the rest (e.g. `response-content-disposition`). */
  query?: Record<string, string>
  credentials: S3Credentials
  region: string
  service?: string
  now: Date
  expiresS: number
}

/** A presigned URL (query-string signing, `host` the only signed header, payload unsigned). */
export function presignUrl(p: PresignInput): string {
  const service = p.service ?? 's3'
  if (!Number.isInteger(p.expiresS) || p.expiresS < 1 || p.expiresS > 604_800) throw new Error('a presigned link lives 1 second to 7 days')
  const url = new URL(p.origin)
  const stamp = amzDate(p.now)
  const credential = `${p.credentials.accessKeyId}/${stamp.slice(0, 8)}/${p.region}/${service}/aws4_request`
  const query: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(p.expiresS)],
    ['X-Amz-SignedHeaders', 'host'],
    ...Object.entries(p.query ?? {})
  ]
  const d = derive({
    method: p.method,
    path: p.path,
    query,
    headers: { host: url.host },
    payloadHash: UNSIGNED_PAYLOAD,
    credentials: p.credentials,
    region: p.region,
    service,
    now: p.now
  })
  return `${url.origin}${canonicalPath(p.path)}?${canonicalQuery(query)}&X-Amz-Signature=${d.signature}`
}
