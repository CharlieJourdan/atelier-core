// Publication kits on the platform (src/shared/cloud-kit.ts): a video's package (texts + files) kept for the team's people
// to download from anywhere. An upload is three steps (start, one call per file, complete): the new kit becomes the video's
// kit only when it is complete, and then replaces the older ones, so a failed upload never destroys a good kit. Files
// live under `kits/<team>/<kit>/<name>` in the file store (a bucket in production: a lifecycle rule on the `kits/` prefix
// is the safety net of the retention below). Every read and write is scoped to the caller's team: another team's ids
// answer `not_found`, like unknown ones.
import { KIT_FILE_NAME, MAX_KIT_FILES, DEFAULT_KIT_RETENTION_DAYS, type Kit, type KitTexts, type KitWithLinks } from '../../src/shared/cloud-kit.ts'
import { SIGNED_LINK_TTL_S } from '../../src/shared/cloud-api.ts'
import type { Audit } from './audit.ts'
import type { BlobStore } from './blobs/types.ts'
import { DAY_MS, HOUR_MS, iso, type Clock } from './clock.ts'
import type { CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { newId } from './ids.ts'
import { mimeFor, type Storage } from './storage.ts'
import { PLANS } from './billing/catalog.ts'
import { isPlanId, type PlanId } from './machines/plans.ts'

/** An upload not completed after this long is abandoned and removed by the sweep. */
export const UPLOAD_ABANDONED_MS = 24 * HOUR_MS
/** Kits of a team being uploaded at once (each one started and not completed yet, nor abandoned). */
export const MAX_UPLOADING_KITS = 4

/** What a team may store as kits: its plan (a running subscription, else the plan of an enrolled team computer). */
export interface KitAllowance {
  plan: PlanId
  quotaBytes: number
}

export interface KitsOptions {
  db: CloudDb
  clock: Clock
  audit: Audit
  blobs: BlobStore
  storage: Storage
  /** Days a kit is kept: the default, and per plan (a team with a running plan uses its own). */
  retentionDays?: number
  retentionByPlan?: Partial<Record<string, number>>
  /** Storage per plan in bytes (default: the catalog's `storageBytes`); tests shrink it. */
  quotaByPlan?: Partial<Record<string, number>>
  maxUploadingKits?: number
}

interface KitRow {
  id: string
  team_id: string
  video_id: string
  title: string
  description: string
  extras_json: string
  status: 'uploading' | 'ready'
  created_at: string
  expires_at: string | null
}
interface FileRow {
  kit_id: string
  name: string
  mime: string
  size: number
  sha256: string
}

type Extras = Pick<KitTexts, 'alternatives' | 'tags' | 'chapters' | 'language' | 'demo'> & { durationS?: number | null }

const keyOf = (teamId: string, kitId: string, name: string): string => `kits/${teamId}/${kitId}/${name}`
const notFound = (): CloudError => new CloudError('not_found', 'no such kit')

export class Kits {
  private readonly o: KitsOptions
  /** Bytes being written to the store now, per team: counted in the quota before their rows exist. */
  private readonly writing = new Map<string, number>()
  constructor(o: KitsOptions) {
    this.o = o
  }

  /**
   * The team's right to upload kits: a plan that is not canceled, else an enrolled team computer (its plan); null for a
   * free sign-up, which may not store anything on the platform.
   */
  allowance(teamId: string): KitAllowance | null {
    const sub = this.o.db.prepare(`SELECT plan FROM billing_subscriptions WHERE team_id = ? AND status != 'canceled'`).get(teamId) as { plan: string } | undefined
    const machine = sub
      ? undefined
      : (this.o.db
          .prepare(`SELECT plan FROM team_machines WHERE team_id = ? AND status != 'deleted' AND enrolled_at IS NOT NULL ORDER BY created_at LIMIT 1`)
          .get(teamId) as { plan: string } | undefined)
    const plan = sub?.plan ?? machine?.plan
    if (!plan || !isPlanId(plan)) return null
    return { plan, quotaBytes: this.o.quotaByPlan?.[plan] ?? PLANS[plan].storageBytes }
  }

  /** Refuses a team without a plan nor an enrolled team computer (the routes check it before any body is read). */
  requireAllowance(teamId: string): KitAllowance {
    const a = this.allowance(teamId)
    if (!a) throw new CloudError('forbidden', 'publication kits on the platform come with a plan (or a team computer)')
    return a
  }

  /** Bytes the team's kits hold: every file of its kits, the ones being uploaded included, and the writes in progress. */
  usedBytes(teamId: string): number {
    const r = this.o.db
      .prepare('SELECT COALESCE(SUM(f.size), 0) AS n FROM video_kit_files f JOIN video_kits k ON k.id = f.kit_id WHERE k.team_id = ?')
      .get(teamId) as { n: number }
    return Number(r.n) + (this.writing.get(teamId) ?? 0)
  }

  /** Refuses `bytes` more when they would not fit in the team's storage (`freed`: the size of a file they replace). */
  checkRoom(teamId: string, bytes: number, freed = 0): void {
    const a = this.requireAllowance(teamId)
    if (this.usedBytes(teamId) - freed + bytes > a.quotaBytes) {
      throw new CloudError('forbidden', `the team's storage is full (${Math.round(a.quotaBytes / 1e9)} GB on the ${a.plan} plan): let older kits expire first`)
    }
  }

  /** Days this team's kits are kept. */
  retentionDays(teamId: string): number {
    const sub = this.o.db.prepare(`SELECT plan FROM billing_subscriptions WHERE team_id = ? AND status != 'canceled'`).get(teamId) as { plan: string } | undefined
    return (sub && this.o.retentionByPlan?.[sub.plan]) || this.o.retentionDays || DEFAULT_KIT_RETENTION_DAYS
  }

  /** Refuses a file of `bytes` that would not fit; the file of the same name it replaces in that kit gives its room back. */
  checkFileRoom(teamId: string, kitId: string, name: string, bytes: number): void {
    const replaced = this.o.db
      .prepare('SELECT f.size FROM video_kit_files f JOIN video_kits k ON k.id = f.kit_id WHERE f.kit_id = ? AND f.name = ? AND k.team_id = ?')
      .get(kitId, name, teamId) as { size: number } | undefined
    this.checkRoom(teamId, bytes, replaced?.size ?? 0)
  }

  /** Step 1: a new kit for the video, empty, not visible yet. */
  start(teamId: string, videoId: string, texts: KitTexts, by: string): { kitId: string; videoId: string } {
    this.requireAllowance(teamId)
    const busy = this.o.db
      .prepare(`SELECT COUNT(*) AS n FROM video_kits WHERE team_id = ? AND status = 'uploading' AND created_at > ?`)
      .get(teamId, iso(this.o.clock.now() - UPLOAD_ABANDONED_MS)) as { n: number }
    const most = this.o.maxUploadingKits ?? MAX_UPLOADING_KITS
    if (busy.n >= most) throw new CloudError('rate_limited', `at most ${most} kits are uploaded at once: finish one first`)
    const id = newId('kit')
    const extras: Extras = {
      alternatives: texts.alternatives,
      tags: texts.tags,
      chapters: texts.chapters,
      language: texts.language,
      demo: texts.demo,
      durationS: texts.durationS
    }
    this.o.db
      .prepare(
        `INSERT INTO video_kits (id, team_id, video_id, title, description, extras_json, status, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`
      )
      .run(id, teamId, videoId, texts.title, texts.description, JSON.stringify(extras), by, iso(this.o.clock.now()))
    return { kitId: id, videoId }
  }

  private uploading(teamId: string, videoId: string, kitId: string): KitRow {
    const r = this.o.db.prepare('SELECT * FROM video_kits WHERE id = ? AND team_id = ? AND video_id = ?').get(kitId, teamId, videoId) as KitRow | undefined
    if (!r) throw notFound()
    if (r.status !== 'uploading') throw new CloudError('conflict', 'this kit is already complete: start a new one')
    return r
  }

  /**
   * Step 2: one file (the same name again replaces it). The hash was checked by the route. The bytes are in memory
   * (`bytes`) or in a raw upload's temporary file (`path` + `size`, http/bodies.ts): then they go to the store part by part.
   */
  async addFile(
    teamId: string,
    videoId: string,
    kitId: string,
    file: { name: string; sha256: string } & ({ bytes: Uint8Array } | { path: string; size: number })
  ): Promise<Kit['files'][number]> {
    this.uploading(teamId, videoId, kitId)
    if (!KIT_FILE_NAME.test(file.name)) throw new CloudError('bad_request', 'name: a plain file name')
    const count = (this.o.db.prepare('SELECT COUNT(*) AS n FROM video_kit_files WHERE kit_id = ? AND name != ?').get(kitId, file.name) as { n: number }).n
    if (count >= MAX_KIT_FILES) throw new CloudError('bad_request', `a kit holds at most ${MAX_KIT_FILES} files`)
    const size = 'bytes' in file ? file.bytes.byteLength : file.size
    this.checkFileRoom(teamId, kitId, file.name, size)
    const mime = mimeFor(file.name)
    const key = keyOf(teamId, kitId, file.name)
    // counted while it is written, so two uploads at once cannot both take the last room
    this.writing.set(teamId, (this.writing.get(teamId) ?? 0) + size)
    try {
      if ('bytes' in file) await this.o.blobs.put(key, file.bytes, mime)
      else await this.o.blobs.putFile(key, file.path, file.size, mime)
      const row = { name: file.name, mime, size, sha256: file.sha256 }
      this.o.db
        .prepare(
          `INSERT INTO video_kit_files (kit_id, name, mime, size, sha256) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(kit_id, name) DO UPDATE SET mime = excluded.mime, size = excluded.size, sha256 = excluded.sha256`
        )
        .run(kitId, row.name, row.mime, row.size, row.sha256)
      return row
    } finally {
      const left = (this.writing.get(teamId) ?? size) - size
      if (left <= 0) this.writing.delete(teamId)
      else this.writing.set(teamId, left)
    }
  }

  /** Step 3: the kit becomes the video's kit; the older kits of the video (and their files) are removed. */
  async complete(teamId: string, videoId: string, kitId: string, by: string): Promise<Kit> {
    this.requireAllowance(teamId)
    this.uploading(teamId, videoId, kitId)
    const files = this.o.db.prepare('SELECT COUNT(*) AS n FROM video_kit_files WHERE kit_id = ?').get(kitId) as { n: number }
    if (files.n === 0) throw new CloudError('bad_request', 'a kit needs at least one file')
    const now = this.o.clock.now()
    const expires = iso(now + this.retentionDays(teamId) * DAY_MS)
    this.o.db.prepare(`UPDATE video_kits SET status = 'ready', completed_at = ?, expires_at = ? WHERE id = ?`).run(iso(now), expires, kitId)
    this.o.audit.record(by, 'kit.publish', kitId, { videoId, files: files.n })
    this.recordFinished(teamId, videoId, this.row(kitId), iso(now))
    const older = this.o.db.prepare(`SELECT id FROM video_kits WHERE team_id = ? AND video_id = ? AND id != ?`).all(teamId, videoId, kitId) as { id: string }[]
    for (const { id } of older) await this.remove(teamId, id).catch(() => undefined)
    return this.view(this.row(kitId))
  }

  /** A finished video, counted once per video in the founder console (finished minutes); a new kit updates its length. */
  private recordFinished(teamId: string, videoId: string, kit: KitRow, at: string): void {
    const extras = JSON.parse(kit.extras_json) as Extras
    this.o.db
      .prepare(
        `INSERT INTO finished_videos (team_id, video_id, duration_s, demo, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(team_id, video_id) DO UPDATE SET duration_s = COALESCE(excluded.duration_s, finished_videos.duration_s),
           demo = excluded.demo, last_at = excluded.last_at`
      )
      .run(teamId, videoId, extras.durationS ?? null, extras.demo ? 1 : 0, at, at)
  }

  private row(id: string): KitRow {
    return this.o.db.prepare('SELECT * FROM video_kits WHERE id = ?').get(id) as unknown as KitRow
  }

  private filesOf(kitId: string): FileRow[] {
    return this.o.db.prepare('SELECT * FROM video_kit_files WHERE kit_id = ? ORDER BY name').all(kitId) as unknown as FileRow[]
  }

  private view(r: KitRow): Kit {
    const extras = JSON.parse(r.extras_json) as Extras
    return {
      id: r.id,
      videoId: r.video_id,
      title: r.title,
      description: r.description,
      ...extras,
      durationS: extras.durationS ?? null,
      createdAt: r.created_at,
      expiresAt: r.expires_at ?? r.created_at,
      files: this.filesOf(r.id).map(({ name, mime, size, sha256 }) => ({ name, mime, size, sha256 }))
    }
  }

  /** The video's current kit, or not_found (none, still uploading, or expired and not swept yet). */
  latest(teamId: string, videoId: string): Kit {
    const r = this.o.db
      .prepare(`SELECT * FROM video_kits WHERE team_id = ? AND video_id = ? AND status = 'ready' AND expires_at > ? ORDER BY completed_at DESC, rowid DESC LIMIT 1`)
      .get(teamId, videoId, iso(this.o.clock.now())) as KitRow | undefined
    if (!r) throw notFound()
    return this.view(r)
  }

  /** The team's current kits, newest first. */
  list(teamId: string): Kit[] {
    const rows = this.o.db
      .prepare(`SELECT * FROM video_kits WHERE team_id = ? AND status = 'ready' AND expires_at > ? ORDER BY completed_at DESC, rowid DESC LIMIT 500`)
      .all(teamId, iso(this.o.clock.now())) as unknown as KitRow[]
    return rows.map((r) => this.view(r))
  }

  /** The video's kit with a download link per file: a presigned link to the bucket, else a signed Cloud link. */
  withLinks(kit: Kit, teamId: string, baseUrl: string, ttlS: number = SIGNED_LINK_TTL_S): KitWithLinks {
    return {
      ...kit,
      files: kit.files.map((f) => {
        const direct = this.o.blobs.presignGet(keyOf(teamId, kit.id, f.name), { ttlS, filename: f.name, mime: f.mime })
        if (direct) return { ...f, url: direct, expiresAt: iso(this.o.clock.now() + ttlS * 1000) }
        const link = this.o.storage.signedKitPath(kit.id, f.name, ttlS)
        return { ...f, url: `${baseUrl}${link.path}`, expiresAt: link.expiresAt }
      })
    }
  }

  /** A file of a kit for the signed local link (the signature was already verified). */
  async readFile(kitId: string, name: string): Promise<{ bytes: Buffer; mime: string; size: number }> {
    const r = this.o.db.prepare(`SELECT * FROM video_kits WHERE id = ? AND status = 'ready' AND expires_at > ?`).get(kitId, iso(this.o.clock.now())) as KitRow | undefined
    const f = r ? (this.o.db.prepare('SELECT * FROM video_kit_files WHERE kit_id = ? AND name = ?').get(kitId, name) as FileRow | undefined) : undefined
    if (!r || !f) throw notFound()
    return { bytes: await this.o.blobs.get(keyOf(r.team_id, kitId, name)), mime: f.mime, size: f.size }
  }

  /** Deletes one kit: its files from the store first (a failure keeps the rows, the next sweep tries again), then the rows. */
  private async remove(teamId: string, kitId: string): Promise<void> {
    for (const f of this.filesOf(kitId)) await this.o.blobs.delete(keyOf(teamId, kitId, f.name))
    this.o.db.prepare('DELETE FROM video_kit_files WHERE kit_id = ?').run(kitId)
    this.o.db.prepare('DELETE FROM video_kits WHERE id = ?').run(kitId)
  }

  /** Retention: removes the kits past their date and the uploads abandoned for a day. Returns the ids removed. */
  async sweep(): Promise<string[]> {
    const now = this.o.clock.now()
    const due = this.o.db
      .prepare(`SELECT id, team_id, status FROM video_kits WHERE (status = 'ready' AND expires_at <= ?) OR (status = 'uploading' AND created_at <= ?)`)
      .all(iso(now), iso(now - UPLOAD_ABANDONED_MS)) as { id: string; team_id: string; status: string }[]
    const removed: string[] = []
    for (const k of due) {
      try {
        await this.remove(k.team_id, k.id)
        removed.push(k.id)
        if (k.status === 'ready') this.o.audit.record('kits', 'kit.expire', k.id)
      } catch {
        // the store was unreachable: the rows stay, the next sweep tries again
      }
    }
    return removed
  }
}
