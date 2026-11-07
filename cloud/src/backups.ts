// The team computer's backups (src/shared/cloud-backup.ts): encrypted archives a team computer sends every night with its
// own credential. They belong to the team (a new machine of the team restores from them), live under
// `backups/<team>/<id>.atb` in the file store, and are kept BACKUP_RETENTION_DAYS; the team's newest one is never removed
// by age. The Cloud never reads them: they are encrypted on the machine with a key the Cloud does not have.
import type { Readable } from 'node:stream'
import { BACKUP_RETENTION_DAYS, MAX_BACKUP_BYTES, MAX_BACKUPS_PER_DAY, type TeamBackup } from '../../src/shared/cloud-backup.ts'
import type { Audit } from './audit.ts'
import type { BlobStore } from './blobs/types.ts'
import { DAY_MS, iso, type Clock } from './clock.ts'
import type { CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { newId } from './ids.ts'

export interface BackupsOptions {
  db: CloudDb
  clock: Clock
  audit: Audit
  blobs: BlobStore
  retentionDays?: number
  maxPerDay?: number
}

interface Row {
  id: string
  team_id: string
  machine_id: string
  size: number
  sha256: string
  created_at: string
  expires_at: string
}

const keyOf = (teamId: string, id: string): string => `backups/${teamId}/${id}.atb`
const MIME = 'application/octet-stream'

const view = (r: Row): TeamBackup => ({ id: r.id, machineId: r.machine_id, size: r.size, sha256: r.sha256, createdAt: r.created_at, expiresAt: r.expires_at })

export class TeamBackups {
  private readonly o: BackupsOptions
  constructor(o: BackupsOptions) {
    this.o = o
  }

  /** Refuses before the body is read: an archive over the limit, or too many backups today. */
  checkUpload(teamId: string, declaredBytes: number | null): void {
    if (declaredBytes !== null && declaredBytes > MAX_BACKUP_BYTES) throw new CloudError('too_large', `a backup is at most ${MAX_BACKUP_BYTES / (1024 * 1024)} MB`)
    const since = iso(this.o.clock.now() - DAY_MS)
    const n = (this.o.db.prepare('SELECT COUNT(*) AS n FROM team_backups WHERE team_id = ? AND created_at > ?').get(teamId, since) as { n: number }).n
    const most = this.o.maxPerDay ?? MAX_BACKUPS_PER_DAY
    if (n >= most) throw new CloudError('rate_limited', `at most ${most} backups a day`)
  }

  /** Keeps an uploaded archive (a raw upload already on disk, its hash checked by the route). */
  async add(teamId: string, machineId: string, file: { path: string; size: number; sha256: string }): Promise<TeamBackup> {
    this.checkUpload(teamId, file.size)
    if (file.size === 0) throw new CloudError('bad_request', 'an empty backup')
    const now = this.o.clock.now()
    const row: Row = {
      id: newId('bkp'),
      team_id: teamId,
      machine_id: machineId,
      size: file.size,
      sha256: file.sha256,
      created_at: iso(now),
      expires_at: iso(now + (this.o.retentionDays ?? BACKUP_RETENTION_DAYS) * DAY_MS)
    }
    // the bytes first: a row never points at a missing object
    await this.o.blobs.putFile(keyOf(teamId, row.id), file.path, file.size, MIME)
    this.o.db
      .prepare('INSERT INTO team_backups (id, team_id, machine_id, size, sha256, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.team_id, row.machine_id, row.size, row.sha256, row.created_at, row.expires_at)
    this.o.audit.record(`machine:${machineId}`, 'backup.add', row.id, { size: row.size })
    return view(row)
  }

  /** The team's backups, newest first. */
  list(teamId: string): TeamBackup[] {
    const rows = this.o.db.prepare('SELECT * FROM team_backups WHERE team_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200').all(teamId) as unknown as Row[]
    return rows.map(view)
  }

  /** One archive of the team, as a stream when the store has one (a folder on disk), else its bytes. */
  async read(teamId: string, id: string): Promise<{ backup: TeamBackup; body: Readable | Buffer }> {
    const r = this.o.db.prepare('SELECT * FROM team_backups WHERE id = ? AND team_id = ?').get(id, teamId) as Row | undefined
    // another team's id answers like an unknown one
    if (!r) throw new CloudError('not_found', 'no such backup')
    const key = keyOf(teamId, id)
    const body = this.o.blobs.readStream ? this.o.blobs.readStream(key) : await this.o.blobs.get(key)
    return { backup: view(r), body }
  }

  /** Retention: removes the backups past their date, except each team's newest. Returns the ids removed. */
  async sweep(): Promise<string[]> {
    const due = this.o.db
      .prepare(
        `SELECT b.id, b.team_id FROM team_backups b
          WHERE b.expires_at <= ?
            AND b.id != (SELECT n.id FROM team_backups n WHERE n.team_id = b.team_id ORDER BY n.created_at DESC, n.rowid DESC LIMIT 1)`
      )
      .all(iso(this.o.clock.now())) as { id: string; team_id: string }[]
    const removed: string[] = []
    for (const b of due) {
      try {
        await this.o.blobs.delete(keyOf(b.team_id, b.id))
        this.o.db.prepare('DELETE FROM team_backups WHERE id = ?').run(b.id)
        this.o.audit.record('backups', 'backup.expire', b.id)
        removed.push(b.id)
      } catch {
        // the store was unreachable: the row stays, the next sweep tries again
      }
    }
    return removed
  }
}
