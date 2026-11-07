// Team files (§4.8): `teams/<teamId>/artefacts/<sha256>` in a BlobStore (a folder under the data folder by default,
// or an S3-compatible bucket such as Cloudflare R2: blobs/). Download links are signed with HMAC-SHA256 and valid 15
// minutes; the link itself is the credential, so it names the artefact, its expiry and nothing else. With a bucket,
// `GET /files/:id` answers a redirect to a presigned storage link: the bytes never pass through the Cloud.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { SIGNED_LINK_TTL_S, type Artefact } from '../../src/shared/cloud-api.ts'
import type { BlobStore } from './blobs/types.ts'
import { iso, type Clock } from './clock.ts'
import type { CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { newId, sha256Hex } from './ids.ts'

export interface StoredArtefact extends Artefact {
  teamId: string
  jobId: string | null
}

export interface NewFile {
  name: string
  mime: string
  bytes: Uint8Array
}

/** How long the redirect of `GET /files/:id` to the object store lives (the caller follows it at once). */
export const DIRECT_LINK_TTL_S = 120

export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  json: 'application/json',
  srt: 'application/x-subrip',
  ass: 'text/x-ssa',
  txt: 'text/plain',
  md: 'text/markdown'
}

/** The media type of a file from its extension (application/octet-stream when unknown). */
export function mimeFor(name: string): string {
  const dot = name.lastIndexOf('.')
  return (dot > 0 && MIME_BY_EXT[name.slice(dot + 1).toLowerCase()]) || 'application/octet-stream'
}

export class Storage {
  private readonly db: CloudDb
  private readonly clock: Clock
  readonly blobs: BlobStore
  private readonly signingKey: Buffer
  constructor(db: CloudDb, clock: Clock, blobs: BlobStore, signingKey: Buffer) {
    if (signingKey.length < 32) throw new Error('the link signing key must be at least 32 bytes')
    this.db = db
    this.clock = clock
    this.blobs = blobs
    this.signingKey = signingKey
  }

  /** Where a team's artefact content lives in the store (shared by the artefacts of one team with the same content). */
  static keyOf(teamId: string, sha256: string): string {
    return `teams/${teamId}/artefacts/${sha256}`
  }

  async put(teamId: string, jobId: string | null, file: NewFile, demo: boolean): Promise<StoredArtefact> {
    const sha256 = sha256Hex(file.bytes)
    return this.record(teamId, jobId, { name: file.name, mime: file.mime, size: file.bytes.byteLength, sha256 }, demo, (key) => this.blobs.put(key, file.bytes, file.mime))
  }

  /** A raw upload already on disk (hashed while it was received): stored from its file, never read whole in memory. */
  async putFile(teamId: string, file: { name: string; mime: string; path: string; size: number; sha256: string }): Promise<StoredArtefact> {
    return this.record(teamId, null, file, false, (key) => this.blobs.putFile(key, file.path, file.size, file.mime))
  }

  private async record(
    teamId: string,
    jobId: string | null,
    file: { name: string; mime: string; size: number; sha256: string },
    demo: boolean,
    write: (key: string) => Promise<void>
  ): Promise<StoredArtefact> {
    if (!SAFE_NAME.test(file.name)) throw new CloudError('internal', `unsafe file name ${file.name}`)
    if (!/^[A-Za-z0-9_-]+$/.test(teamId)) throw new CloudError('internal', 'unsafe team id')
    const sha256 = file.sha256
    const key = Storage.keyOf(teamId, sha256)
    if (!(await this.blobs.has(key))) await write(key)
    const artefact: StoredArtefact = {
      id: newId('art'),
      name: file.name,
      mime: file.mime,
      size: file.size,
      sha256,
      demo,
      teamId,
      jobId
    }
    this.db
      .prepare('INSERT INTO artefacts (id, team_id, job_id, sha256, name, mime, size, demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(artefact.id, teamId, jobId, sha256, file.name, file.mime, artefact.size, demo ? 1 : 0, iso(this.clock.now()))
    return artefact
  }

  get(id: string): StoredArtefact | null {
    const r = this.db.prepare('SELECT * FROM artefacts WHERE id = ?').get(id) as
      | { id: string; team_id: string; job_id: string | null; sha256: string; name: string; mime: string; size: number; demo: number }
      | undefined
    if (!r) return null
    return { id: r.id, name: r.name, mime: r.mime, size: r.size, sha256: r.sha256, demo: r.demo === 1, teamId: r.team_id, jobId: r.job_id }
  }

  /** The newest of a team's artefacts with this content (uploaded or produced), or null. Never another team's. */
  findByHash(teamId: string, sha256: string): StoredArtefact | null {
    const r = this.db
      .prepare('SELECT id FROM artefacts WHERE team_id = ? AND sha256 = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(teamId, sha256) as { id: string } | undefined
    return r ? this.get(r.id) : null
  }

  forJob(jobId: string): StoredArtefact[] {
    const ids = this.db.prepare('SELECT id FROM artefacts WHERE job_id = ? ORDER BY created_at, id').all(jobId) as { id: string }[]
    return ids.map(({ id }) => this.get(id) as StoredArtefact)
  }

  /** A team's own artefact only; another team's id answers not_found, like an unknown one. */
  forTeam(teamId: string, id: string): StoredArtefact {
    const a = this.get(id)
    if (!a || a.teamId !== teamId) throw new CloudError('not_found', 'no such artefact')
    return a
  }

  read(a: StoredArtefact): Promise<Buffer> {
    return this.blobs.get(Storage.keyOf(a.teamId, a.sha256))
  }

  /** The first `n` bytes of a file (a header): a range of the local folder, else the whole object cut. */
  async head(a: StoredArtefact, n: number): Promise<Buffer> {
    const key = Storage.keyOf(a.teamId, a.sha256)
    if (!this.blobs.readStream) return (await this.blobs.get(key)).subarray(0, n)
    const parts: Buffer[] = []
    for await (const chunk of this.blobs.readStream(key, { start: 0, end: Math.max(0, Math.min(n, a.size) - 1) })) parts.push(chunk as Buffer)
    return Buffer.concat(parts)
  }

  /** A link straight to the object store, valid `ttlS` seconds; null when the files are in a local folder. */
  presign(a: StoredArtefact, ttlS: number): string | null {
    return this.blobs.presignGet(Storage.keyOf(a.teamId, a.sha256), { ttlS, filename: a.name, mime: a.mime })
  }

  /** A signed download path, valid `ttlS` seconds (15 minutes by default; longer for a queued remote executor). */
  signedPath(id: string, ttlS: number = SIGNED_LINK_TTL_S): { path: string; expiresAt: string } {
    const exp = Math.floor(this.clock.now() / 1000) + ttlS
    return { path: `/files/${encodeURIComponent(id)}?exp=${exp}&sig=${this.sign(id, exp)}`, expiresAt: iso(exp * 1000) }
  }

  /** Checks a signed link; any defect (bad or missing signature, expired) is the same refusal. */
  verify(id: string, exp: string | undefined, sig: string | undefined): StoredArtefact {
    const expN = Number(exp)
    if (!exp || !sig || !Number.isSafeInteger(expN)) throw new CloudError('forbidden', 'invalid link')
    const expected = Buffer.from(this.sign(id, expN))
    const given = Buffer.from(sig)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new CloudError('forbidden', 'invalid link')
    if (this.clock.now() >= expN * 1000) throw new CloudError('gone', 'this link has expired')
    const a = this.get(id)
    if (!a) throw new CloudError('not_found', 'no such artefact')
    return a
  }

  /**
   * The link a provider fetches one file of a running job with (production-10, the beta without a bucket): bound to the job and
   * the file, signed, expiring in `ttlS`. `GET /provider-files/:job/:id` serves it only while that job runs (routes-provider-files.ts).
   */
  signedJobPath(jobId: string, id: string, ttlS: number): string {
    const exp = Math.floor(this.clock.now() / 1000) + ttlS
    return `/provider-files/${encodeURIComponent(jobId)}/${encodeURIComponent(id)}?exp=${exp}&sig=${this.signJob(jobId, id, exp)}`
  }

  /** Checks a job-bound link (signature and expiry; the job's state is the route's check). Any defect is the same refusal. */
  verifyJob(jobId: string, id: string, exp: string | undefined, sig: string | undefined): StoredArtefact {
    const expN = Number(exp)
    if (!exp || !sig || !Number.isSafeInteger(expN)) throw new CloudError('forbidden', 'invalid link')
    const expected = Buffer.from(this.signJob(jobId, id, expN))
    const given = Buffer.from(sig)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new CloudError('forbidden', 'invalid link')
    if (this.clock.now() >= expN * 1000) throw new CloudError('gone', 'this link has expired')
    const a = this.get(id)
    if (!a) throw new CloudError('not_found', 'no such artefact')
    return a
  }

  private signJob(jobId: string, id: string, exp: number): string {
    return createHmac('sha256', this.signingKey).update(`job\n${jobId}\n${id}\n${exp}`).digest('base64url')
  }

  private sign(id: string, exp: number): string {
    return createHmac('sha256', this.signingKey).update(`${id}\n${exp}`).digest('base64url')
  }

  /** The signed Cloud path of a kit file kept in a local folder (kits.ts); same HMAC key, its own message format. */
  signedKitPath(kitId: string, name: string, ttlS: number = SIGNED_LINK_TTL_S): { path: string; expiresAt: string } {
    const exp = Math.floor(this.clock.now() / 1000) + ttlS
    const path = `/kit-files/${encodeURIComponent(kitId)}/${encodeURIComponent(name)}?exp=${exp}&sig=${this.signKit(kitId, name, exp)}`
    return { path, expiresAt: iso(exp * 1000) }
  }

  /** Checks a signed kit link: any defect is the same refusal; an expired link is `gone`. */
  verifyKit(kitId: string, name: string, exp: string | undefined, sig: string | undefined): void {
    const expN = Number(exp)
    if (!exp || !sig || !Number.isSafeInteger(expN)) throw new CloudError('forbidden', 'invalid link')
    const expected = Buffer.from(this.signKit(kitId, name, expN))
    const given = Buffer.from(sig)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new CloudError('forbidden', 'invalid link')
    if (this.clock.now() >= expN * 1000) throw new CloudError('gone', 'this link has expired')
  }

  private signKit(kitId: string, name: string, exp: number): string {
    return createHmac('sha256', this.signingKey).update(`kit-file\n${kitId}\n${name}\n${exp}`).digest('base64url')
  }
}
