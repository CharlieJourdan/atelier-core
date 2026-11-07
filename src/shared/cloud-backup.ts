// The team computer's backups on Atelier Cloud (docs/BRAIN-HEADLESS.md §10): every night the brain packs its database
// and its team files into ONE archive, encrypted on the machine with a key derived from the machine key (the Cloud only
// ever holds bytes it cannot read), and sends it with the machine's own credential. Backups belong to the TEAM: a new
// team computer of the same team (a move to another machine) lists and downloads them to restore. Kept 14 days; the
// newest one of a team is never removed by age, so a machine switched off for a month still has its last backup.
//
// A separate file from cloud-api.ts (already large): it imports only zod, so the Cloud (type stripping, imports end in
// `.ts`) and the app (bundler) both read it as it is. Routes use the same shape as CLOUD_ROUTES (src/shared/cloud-api.ts).
import { z } from 'zod'

/** Days a backup is kept on the platform (the newest one of a team stays whatever its age). */
export const BACKUP_RETENTION_DAYS = 14
/** An archive is at most this big (the database and the team files, not the videos: those are the kits). */
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024
/** Backups a team may send in a day (a nightly one, plus the ones made by hand). */
export const MAX_BACKUPS_PER_DAY = 24
export const BACKUP_ID = /^bkp_[A-Za-z0-9_-]{6,64}$/

export const TeamBackup = z.object({
  id: z.string().regex(BACKUP_ID),
  /** The team computer that sent it. */
  machineId: z.string(),
  size: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string(),
  /** Removed after this date, unless it is the team's newest. */
  expiresAt: z.string()
})
export type TeamBackup = z.infer<typeof TeamBackup>

export const TeamBackupList = z.object({ backups: z.array(TeamBackup) })
/** `POST /v1/relay/machine/backups?sha256=…`, body = the encrypted archive (`application/octet-stream`); the hash is checked. */
export const BackupUploadQuery = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/, 'lowercase hex SHA-256') })

export const BACKUP_ROUTES = {
  machineBackupUpload: { method: 'POST', path: '/v1/relay/machine/backups', auth: 'machine', query: BackupUploadQuery, response: TeamBackup },
  machineBackups: { method: 'GET', path: '/v1/relay/machine/backups', auth: 'machine', response: TeamBackupList },
  /** The archive's bytes (`application/octet-stream`). */
  machineBackupGet: { method: 'GET', path: '/v1/relay/machine/backups/:id', auth: 'machine', response: null }
} as const
