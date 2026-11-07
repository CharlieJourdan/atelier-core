// App releases (src/shared/cloud-releases.ts): the founder builds an installer, uploads it as a DRAFT release of a channel
// (`beta` or `stable`) and a platform, then publishes it; the testers' apps find it through the public update feed
// (electron-updater's "generic" provider). A release is made in steps so a half-finished upload never reaches anyone:
// create (draft) → one call per file → publish. A published release no longer takes files. Withdrawing one removes it
// from the feed (the previous published version becomes the latest again) and keeps its files, so it can be published again.
// The feed serves the HIGHEST published version of its channel and platform, not the most recent one.
//
// Files live under `releases/<release>/<name>` in the file store (a folder, or the bucket in production). Their SHA-512
// is computed here from the bytes that were stored, never taken from the caller.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  MAX_RELEASE_FILE_BYTES,
  MAX_RELEASE_FILES,
  RELEASE_FILE_NAME,
  compareVersions,
  installerOf,
  isBlockmap,
  type Release,
  type ReleaseChannel,
  type ReleaseCreateRequest,
  type ReleaseFile,
  type ReleasePlatform
} from '../../src/shared/cloud-releases.ts'
import type { Audit } from './audit.ts'
import type { BlobStore } from './blobs/types.ts'
import { iso, type Clock } from './clock.ts'
import type { CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { newId } from './ids.ts'

export interface ReleasesOptions {
  db: CloudDb
  clock: Clock
  audit: Audit
  blobs: BlobStore
  /** Biggest file accepted (default 400 MB; tests shrink it). */
  maxFileBytes?: number
}

interface ReleaseRow {
  id: string
  version: string
  channel: ReleaseChannel
  platform: ReleasePlatform
  notes: string
  state: Release['state']
  created_at: string
  published_at: string | null
  withdrawn_at: string | null
}
interface FileRow {
  release_id: string
  name: string
  size: number
  sha256: string
  sha512: string
}

const keyOf = (releaseId: string, name: string): string => `releases/${releaseId}/${name}`
const notFound = (): CloudError => new CloudError('not_found', 'no such release')

/** A string as a YAML scalar: JSON strings are valid YAML double-quoted scalars. */
const yamlString = (s: string): string => JSON.stringify(s)

/** Base64 SHA-512 of a file on disk, read part by part. */
export function sha512OfFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .once('error', reject)
      .once('end', () => resolve(hash.digest('base64')))
  })
}

export class Releases {
  private readonly o: ReleasesOptions
  constructor(o: ReleasesOptions) {
    this.o = o
  }

  get maxFileBytes(): number {
    return this.o.maxFileBytes ?? MAX_RELEASE_FILE_BYTES
  }

  private row(id: string): ReleaseRow {
    const r = this.o.db.prepare('SELECT * FROM releases WHERE id = ?').get(id) as ReleaseRow | undefined
    if (!r) throw notFound()
    return r
  }

  private filesOf(releaseId: string): FileRow[] {
    return this.o.db.prepare('SELECT * FROM release_files WHERE release_id = ? ORDER BY name').all(releaseId) as unknown as FileRow[]
  }

  private view(r: ReleaseRow): Release {
    return {
      id: r.id,
      version: r.version,
      channel: r.channel,
      platform: r.platform,
      notes: r.notes,
      state: r.state,
      createdAt: r.created_at,
      publishedAt: r.published_at,
      withdrawnAt: r.withdrawn_at,
      files: this.filesOf(r.id).map(({ name, size, sha512 }) => ({ name, size, sha512 }))
    }
  }

  get(id: string): Release {
    return this.view(this.row(id))
  }

  /** The state of a release, for the routes' checks before a body is read (not_found when unknown). */
  state(id: string): Release['state'] {
    return this.row(id).state
  }

  /** Every release, newest version first (then newest created). */
  list(): Release[] {
    const rows = this.o.db.prepare('SELECT * FROM releases').all() as unknown as ReleaseRow[]
    rows.sort((a, b) => compareVersions(b.version, a.version) || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    return rows.map((r) => this.view(r))
  }

  /** The release the feed of this channel and platform serves: the highest published version. */
  latest(channel: ReleaseChannel, platform: ReleasePlatform): Release | null {
    const rows = this.o.db.prepare(`SELECT * FROM releases WHERE channel = ? AND platform = ? AND state = 'published'`).all(channel, platform) as unknown as ReleaseRow[]
    rows.sort((a, b) => compareVersions(b.version, a.version))
    const top = rows[0]
    return top ? this.view(top) : null
  }

  /** What every feed serves now. */
  latestAll(): { channel: ReleaseChannel; platform: ReleasePlatform; releaseId: string; version: string }[] {
    const out: { channel: ReleaseChannel; platform: ReleasePlatform; releaseId: string; version: string }[] = []
    for (const channel of ['beta', 'stable'] as const) {
      for (const platform of ['win', 'mac'] as const) {
        const r = this.latest(channel, platform)
        if (r) out.push({ channel, platform, releaseId: r.id, version: r.version })
      }
    }
    return out
  }

  /** A new draft. The same version asked again while it is still a draft answers that draft (a retried command); once published or withdrawn the number is taken. */
  create(req: ReleaseCreateRequest, by: string): Release {
    const existing = this.o.db
      .prepare('SELECT * FROM releases WHERE channel = ? AND platform = ? AND version = ?')
      .get(req.channel, req.platform, req.version) as ReleaseRow | undefined
    if (existing) {
      if (existing.state !== 'draft') {
        throw new CloudError('conflict', `version ${req.version} already exists on ${req.channel}/${req.platform} (${existing.state}): bump the version`)
      }
      if (existing.notes !== req.notes) this.o.db.prepare('UPDATE releases SET notes = ? WHERE id = ?').run(req.notes, existing.id)
      return this.get(existing.id)
    }
    const id = newId('rel')
    this.o.db
      .prepare(`INSERT INTO releases (id, version, channel, platform, notes, state, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`)
      .run(id, req.version, req.channel, req.platform, req.notes, by, iso(this.o.clock.now()))
    this.o.audit.record(by, 'release.create', id, { version: req.version, channel: req.channel, platform: req.platform })
    return this.get(id)
  }

  /**
   * One file of a draft (the same name again replaces it). The caller's SHA-256 was already checked against the bytes by
   * the upload parser; the SHA-512 of the feed is computed here from the spooled file, then the file goes to the store.
   */
  async addFile(releaseId: string, file: { name: string; path: string; size: number; sha256: string }): Promise<ReleaseFile> {
    const r = this.row(releaseId)
    if (r.state !== 'draft') throw new CloudError('conflict', 'this release is already published: files can no longer be added')
    if (!RELEASE_FILE_NAME.test(file.name)) throw new CloudError('bad_request', 'name: a plain file name')
    if (file.size > this.maxFileBytes) throw new CloudError('too_large', 'body too large')
    const others = (this.o.db.prepare('SELECT COUNT(*) AS n FROM release_files WHERE release_id = ? AND name != ?').get(releaseId, file.name) as { n: number }).n
    if (others >= MAX_RELEASE_FILES) throw new CloudError('bad_request', `a release holds at most ${MAX_RELEASE_FILES} files`)
    const sha512 = await sha512OfFile(file.path)
    await this.o.blobs.putFile(keyOf(releaseId, file.name), file.path, file.size, 'application/octet-stream')
    return this.record(releaseId, file.name, file.size, sha512, file.sha256)
  }

  /** Same as addFile for bytes already in memory (tests, small files). */
  async addBytes(releaseId: string, name: string, bytes: Uint8Array): Promise<ReleaseFile> {
    const r = this.row(releaseId)
    if (r.state !== 'draft') throw new CloudError('conflict', 'this release is already published: files can no longer be added')
    if (!RELEASE_FILE_NAME.test(name)) throw new CloudError('bad_request', 'name: a plain file name')
    await this.o.blobs.put(keyOf(releaseId, name), bytes, 'application/octet-stream')
    return this.record(releaseId, name, bytes.byteLength, createHash('sha512').update(bytes).digest('base64'), createHash('sha256').update(bytes).digest('hex'))
  }

  private record(releaseId: string, name: string, size: number, sha512: string, sha256 = ''): ReleaseFile {
    this.o.db
      .prepare(
        `INSERT INTO release_files (release_id, name, size, sha256, sha512) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(release_id, name) DO UPDATE SET size = excluded.size, sha256 = excluded.sha256, sha512 = excluded.sha512`
      )
      .run(releaseId, name, size, sha256, sha512)
    return { name, size, sha512 }
  }

  /** Puts a draft (or a withdrawn release) on the feed. It needs its installer. */
  publish(id: string, by: string): Release {
    const r = this.row(id)
    if (r.state === 'published') return this.view(r)
    const names = this.filesOf(id).map((f) => f.name)
    if (!installerOf(r.platform, names)) {
      throw new CloudError('bad_request', r.platform === 'win' ? 'a Windows release needs its installer (.exe) before it is published' : 'a macOS release needs its .zip (or .dmg) before it is published')
    }
    this.o.db.prepare(`UPDATE releases SET state = 'published', published_at = ?, withdrawn_at = NULL WHERE id = ?`).run(iso(this.o.clock.now()), id)
    this.o.audit.record(by, 'release.publish', id, { version: r.version, channel: r.channel, platform: r.platform })
    return this.get(id)
  }

  /** Takes a published release off the feed; the previous published version becomes the latest again. */
  withdraw(id: string, by: string): Release {
    const r = this.row(id)
    if (r.state === 'draft') throw new CloudError('conflict', 'this release was never published: delete it instead')
    if (r.state === 'withdrawn') return this.view(r)
    this.o.db.prepare(`UPDATE releases SET state = 'withdrawn', withdrawn_at = ? WHERE id = ?`).run(iso(this.o.clock.now()), id)
    this.o.audit.record(by, 'release.withdraw', id, { version: r.version, channel: r.channel, platform: r.platform })
    return this.get(id)
  }

  /** Deletes a draft and its files (a published or withdrawn release is history: it stays). */
  async remove(id: string, by: string): Promise<void> {
    const r = this.row(id)
    if (r.state !== 'draft') throw new CloudError('conflict', 'only a draft can be deleted: withdraw a published release instead')
    for (const f of this.filesOf(id)) await this.o.blobs.delete(keyOf(id, f.name))
    this.o.db.prepare('DELETE FROM release_files WHERE release_id = ?').run(id)
    this.o.db.prepare('DELETE FROM releases WHERE id = ?').run(id)
    this.o.audit.record(by, 'release.delete', id, { version: r.version, channel: r.channel, platform: r.platform })
  }

  /** The feed file (`latest.yml` / `latest-mac.yml`) of a channel and platform, or null when nothing is published. */
  feed(channel: ReleaseChannel, platform: ReleasePlatform): string | null {
    const r = this.latest(channel, platform)
    if (!r) return null
    const installer = installerOf(
      platform,
      r.files.map((f) => f.name)
    )
    if (!installer) return null
    const main = r.files.find((f) => f.name === installer) as ReleaseFile
    const listed = r.files.filter((f) => !isBlockmap(f.name))
    // the installer first: older updaters read the top-level path and sha512, which are the installer's
    listed.sort((a, b) => (a.name === installer ? -1 : b.name === installer ? 1 : a.name < b.name ? -1 : 1))
    const lines = [`version: ${yamlString(r.version)}`, 'files:']
    for (const f of listed) lines.push(`  - url: ${yamlString(f.name)}`, `    sha512: ${yamlString(f.sha512)}`, `    size: ${f.size}`)
    lines.push(`path: ${yamlString(main.name)}`, `sha512: ${yamlString(main.sha512)}`, `releaseDate: ${yamlString(r.publishedAt ?? r.createdAt)}`)
    if (r.notes.trim()) lines.push(`releaseNotes: ${yamlString(r.notes)}`)
    return lines.join('\n') + '\n'
  }

  /**
   * A downloadable file of a channel and platform: the latest release's, else one of an older published release (the
   * updater asks for the previous version's blockmap to download only the difference). Withdrawn and draft releases serve nothing.
   */
  find(channel: ReleaseChannel, platform: ReleasePlatform, name: string): { key: string; size: number } | null {
    const rows = this.o.db
      .prepare(
        `SELECT r.id AS id, r.version AS version, f.size AS size FROM releases r JOIN release_files f ON f.release_id = r.id
         WHERE r.channel = ? AND r.platform = ? AND r.state = 'published' AND f.name = ?`
      )
      .all(channel, platform, name) as unknown as { id: string; version: string; size: number }[]
    rows.sort((a, b) => compareVersions(b.version, a.version))
    const top = rows[0]
    return top ? { key: keyOf(top.id, name), size: top.size } : null
  }

  get blobs(): BlobStore {
    return this.o.blobs
  }
}
