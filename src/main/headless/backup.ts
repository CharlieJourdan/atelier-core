// The team computer's backup and restore (docs/BRAIN-HEADLESS.md §10). A backup is a consistent snapshot of the database
// (`VACUUM INTO` from its own connection: safe while the brain runs, WAL included) plus the team files, packed into one
// encrypted archive (backup-archive.ts). It is kept on the machine (the last LOCAL_KEEP, in `<data>/backups/`) and, when
// the machine is enrolled, sent to Atelier Cloud with its own credential. A restore writes an archive into a data folder
// that has no database yet, checks the database it wrote and says what it holds (agents, queue, goals).
//
// What is NOT in a backup: production renders (big; the finished videos are the kits on the Cloud), the agents' account
// logins (`orchestra/accounts`: they are per machine, made again with « Ajouter mon compte »), caches, the machine's Cloud
// credential (a new machine enrols with its own) and the direct-access token (a restored brain makes a new one).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { BACKUP_ROUTES, MAX_BACKUP_BYTES, TeamBackup, TeamBackupList } from '../../shared/cloud-backup'
import { MIGRATIONS } from '../db/migrations'
import { type CloudMachineLink } from './cloud-link'
import { BackupError, packArchive, unpackArchive, type ArchiveManifest } from './backup-archive'

export const DB_ENTRY = 'atelier.db'
/** The folders of the data folder a backup takes, whole (files larger than MAX_FILE_BYTES are named, not taken). */
export const BACKUP_DIRS = ['orchestra/files', 'orchestra/agents', 'orchestra/bricks', 'attachments'] as const
export const LOCAL_DIR = 'backups'
export const LOCAL_KEEP = 3
export const STATE_FILE = 'backup-state.json'
export const MAX_FILE_BYTES = 64 * 1024 * 1024
/** The files of a backup, before compression: past this the backup refuses rather than fill the memory. */
export const MAX_RAW_BYTES = 768 * 1024 * 1024

/** The last backup, as « Ordinateur d'équipe » shows it. */
export interface BackupState {
  at: string
  ok: boolean
  /** Size of the encrypted archive. */
  sizeBytes: number
  files: number
  /** 'sent' to Atelier Cloud, 'off' = machine not enrolled (kept on this machine only), 'failed' = kept here, not sent. */
  cloud: 'sent' | 'off' | 'failed'
  cloudId: string | null
  /** Local copy (absolute path), null when it could not be written. */
  localFile: string | null
  /** What went wrong (French), null when fine. */
  error: string | null
}

export function readBackupState(dataDir: string): BackupState | null {
  try {
    return JSON.parse(readFileSync(path.join(dataDir, STATE_FILE), 'utf8')) as BackupState
  } catch {
    return null
  }
}

function writeBackupState(dataDir: string, s: BackupState): void {
  const file = path.join(dataDir, STATE_FILE)
  writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}

function walk(root: string, rel: string, out: { path: string; abs: string; size: number }[], skipped: { path: string; size: number }[]): void {
  const abs = path.join(root, rel)
  let names: string[]
  try {
    names = readdirSync(abs)
  } catch {
    return
  }
  for (const name of names.sort()) {
    const childRel = `${rel}/${name}`
    const childAbs = path.join(abs, name)
    const st = statSync(childAbs, { throwIfNoEntry: false })
    if (!st) continue
    if (st.isDirectory()) walk(root, childRel, out, skipped)
    else if (st.isFile()) {
      if (st.size > MAX_FILE_BYTES) skipped.push({ path: childRel, size: st.size })
      else out.push({ path: childRel, abs: childAbs, size: st.size })
    }
  }
}

/** The team files a backup takes, in a stable order. */
export function collectTeamFiles(dataDir: string): { files: { path: string; abs: string; size: number }[]; skipped: { path: string; size: number }[] } {
  const files: { path: string; abs: string; size: number }[] = []
  const skipped: { path: string; size: number }[] = []
  for (const dir of BACKUP_DIRS) walk(dataDir, dir, files, skipped)
  return { files, skipped }
}

/** A consistent copy of the live database, from a connection of its own (the brain may keep writing meanwhile). */
export function snapshotDatabase(dbFile: string, target: string): number {
  if (!existsSync(dbFile)) throw new BackupError('NO_SOURCE', `Pas de base à sauvegarder (${dbFile}).`)
  const db = new DatabaseSync(dbFile)
  try {
    db.exec('PRAGMA busy_timeout = 10000')
    db.prepare('VACUUM INTO ?').run(target)
    const r = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }
    return r.v
  } finally {
    db.close()
  }
}

export interface MadeBackup {
  bytes: Buffer
  manifest: Omit<ArchiveManifest, 'files'> & { files: number }
}

/** Builds the encrypted archive of a data folder (the brain may be running). */
export function makeBackup(o: { dataDir: string; key: Buffer; appVersion: string; now?: () => Date }): MadeBackup {
  const now = o.now ?? (() => new Date())
  const local = path.join(o.dataDir, LOCAL_DIR)
  mkdirSync(local, { recursive: true, mode: 0o700 })
  const snap = path.join(local, `.snapshot-${randomBytes(6).toString('hex')}.db`)
  try {
    const schemaVersion = snapshotDatabase(path.join(o.dataDir, DB_ENTRY), snap)
    const { files, skipped } = collectTeamFiles(o.dataDir)
    const db = readFileSync(snap)
    let raw = db.length
    const parts = [{ path: DB_ENTRY, bytes: db }]
    for (const f of files) {
      raw += f.size
      if (raw > MAX_RAW_BYTES) throw new BackupError('TOO_LARGE', `Les fichiers de l’équipe dépassent ${MAX_RAW_BYTES / (1024 * 1024)} Mo : sauvegarde refusée.`)
      try {
        parts.push({ path: f.path, bytes: readFileSync(f.abs) })
      } catch {
        // removed meanwhile (an agent tidied its folder): not in this backup
      }
    }
    const head = { v: 1 as const, createdAt: now().toISOString(), host: os.hostname(), appVersion: o.appVersion, schemaVersion, skipped }
    const bytes = packArchive(head, parts, o.key)
    if (bytes.length > MAX_BACKUP_BYTES) throw new BackupError('TOO_LARGE', `Sauvegarde trop grosse (${Math.round(bytes.length / (1024 * 1024))} Mo, ${MAX_BACKUP_BYTES / (1024 * 1024)} au plus).`)
    return { bytes, manifest: { ...head, files: parts.length } }
  } finally {
    rmSync(snap, { force: true })
  }
}

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

/** Keeps the archive in `<data>/backups/` and removes the oldest beyond LOCAL_KEEP. Returns its path. */
export function keepLocal(dataDir: string, bytes: Buffer, at: Date, keep = LOCAL_KEEP): string {
  const dir = path.join(dataDir, LOCAL_DIR)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, `atelier-${stamp(at)}.atb`)
  writeFileSync(`${file}.tmp`, bytes, { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
  const all = readdirSync(dir)
    .filter((n) => /^atelier-\d{8}-\d{6}\.atb$/.test(n))
    .sort()
  for (const old of all.slice(0, Math.max(0, all.length - keep))) unlinkSync(path.join(dir, old))
  return file
}

// ---- Atelier Cloud ------------------------------------------------------------------------------------------------

async function cloudFail(res: Response, what: string): Promise<BackupError> {
  let code = `HTTP ${res.status}`
  try {
    const e = ((await res.json()) as { error?: { code?: unknown } }).error
    if (typeof e?.code === 'string') code = e.code
  } catch {
    // the status says enough
  }
  return new BackupError('CLOUD', `Atelier Cloud a refusé ${what} (${code}).`)
}

const auth = (link: CloudMachineLink): { authorization: string } => ({ authorization: `Bearer ${link.credential}` })

export async function uploadBackup(link: CloudMachineLink, bytes: Buffer, sha256: string, fetchImpl: typeof fetch = fetch): Promise<TeamBackup> {
  let res: Response
  try {
    res = await fetchImpl(`${link.cloudUrl}${BACKUP_ROUTES.machineBackupUpload.path}?sha256=${sha256}`, {
      method: 'POST',
      headers: { ...auth(link), 'content-type': 'application/octet-stream' },
      // a view, not a copy (the archive is a fresh Buffer, never a shared one)
      body: new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.length),
      signal: AbortSignal.timeout(Math.max(120_000, Math.ceil(bytes.length / (20 * 1024 * 1024)) * 60_000))
    })
  } catch {
    throw new BackupError('CLOUD', `Atelier Cloud ne répond pas (${link.cloudUrl}).`)
  }
  if (!res.ok) throw await cloudFail(res, 'la sauvegarde')
  return TeamBackup.parse(await res.json())
}

export async function listCloudBackups(link: CloudMachineLink, fetchImpl: typeof fetch = fetch): Promise<TeamBackup[]> {
  let res: Response
  try {
    res = await fetchImpl(`${link.cloudUrl}${BACKUP_ROUTES.machineBackups.path}`, { headers: auth(link), signal: AbortSignal.timeout(30_000) })
  } catch {
    throw new BackupError('CLOUD', `Atelier Cloud ne répond pas (${link.cloudUrl}).`)
  }
  if (!res.ok) throw await cloudFail(res, 'la liste des sauvegardes')
  return TeamBackupList.parse(await res.json()).backups
}

/** `latest` or a backup id of the team; the bytes are checked against the hash the Cloud recorded. */
export async function downloadCloudBackup(link: CloudMachineLink, which: string, fetchImpl: typeof fetch = fetch): Promise<{ backup: TeamBackup; bytes: Buffer }> {
  const all = await listCloudBackups(link, fetchImpl)
  const backup = which === 'latest' ? all[0] : all.find((b) => b.id === which)
  if (!backup) throw new BackupError('NO_SOURCE', which === 'latest' ? 'Aucune sauvegarde de cette équipe sur Atelier Cloud.' : `Sauvegarde inconnue sur Atelier Cloud : ${which}.`)
  let res: Response
  try {
    res = await fetchImpl(`${link.cloudUrl}${BACKUP_ROUTES.machineBackupGet.path.replace(':id', encodeURIComponent(backup.id))}`, {
      headers: auth(link),
      signal: AbortSignal.timeout(Math.max(120_000, Math.ceil(backup.size / (20 * 1024 * 1024)) * 60_000))
    })
  } catch {
    throw new BackupError('CLOUD', `Atelier Cloud ne répond pas (${link.cloudUrl}).`)
  }
  if (!res.ok) throw await cloudFail(res, 'le téléchargement')
  const bytes = Buffer.from(await res.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== backup.sha256) throw new BackupError('CLOUD', 'Sauvegarde reçue incomplète (empreinte différente) : réessaie.')
  return { backup, bytes }
}

// ---- one backup, as the nightly job and `--backup-now` run it -----------------------------------------------------

export interface RunBackupOptions {
  dataDir: string
  key: Buffer
  appVersion: string
  /** The machine's Cloud link, read when the backup runs (null: kept on this machine only). */
  link: () => CloudMachineLink | null
  fetchImpl?: typeof fetch
  now?: () => Date
  log?: (line: string) => void
}

export async function runBackup(o: RunBackupOptions): Promise<BackupState> {
  const log = o.log ?? (() => undefined)
  const at = (o.now ?? (() => new Date()))()
  let state: BackupState
  try {
    const made = makeBackup(o)
    const localFile = keepLocal(o.dataDir, made.bytes, at)
    state = { at: at.toISOString(), ok: true, sizeBytes: made.bytes.length, files: made.manifest.files, cloud: 'off', cloudId: null, localFile, error: null }
    const link = o.link()
    if (link) {
      try {
        const sent = await uploadBackup(link, made.bytes, createHash('sha256').update(made.bytes).digest('hex'), o.fetchImpl)
        state = { ...state, cloud: 'sent', cloudId: sent.id }
      } catch (err) {
        state = { ...state, cloud: 'failed', error: err instanceof Error ? err.message : String(err) }
      }
    }
  } catch (err) {
    state = { at: at.toISOString(), ok: false, sizeBytes: 0, files: 0, cloud: 'off', cloudId: null, localFile: null, error: err instanceof Error ? err.message : String(err) }
  }
  writeBackupState(o.dataDir, state)
  const mb = state.sizeBytes < 1024 * 1024 ? `${Math.max(1, Math.round(state.sizeBytes / 1024))} Ko` : `${(state.sizeBytes / (1024 * 1024)).toFixed(1)} Mo`
  if (!state.ok) log(`Sauvegarde : échec — ${state.error ?? ''}`)
  else if (state.cloud === 'sent') log(`Sauvegarde : ${mb}, ${state.files} fichiers, envoyée sur Atelier Cloud (${state.cloudId ?? ''}).`)
  else if (state.cloud === 'failed') log(`Sauvegarde : ${mb} gardée sur cet ordinateur, PAS envoyée — ${state.error ?? ''}`)
  else log(`Sauvegarde : ${mb} gardée sur cet ordinateur (machine non reliée à Atelier Cloud).`)
  return state
}

// ---- restore ------------------------------------------------------------------------------------------------------

export interface RestoreResult {
  manifest: ArchiveManifest
  agents: number
  tasks: number
  goals: number
  channels: number
}

/** Writes an archive into a data folder that has no database yet; the database goes last, then is checked. */
export function restoreBackup(o: { bytes: Buffer; key: Buffer; dataDir: string }): RestoreResult {
  const dbFile = path.join(o.dataDir, DB_ENTRY)
  for (const f of [dbFile, `${dbFile}-wal`]) {
    if (existsSync(f)) throw new BackupError('NOT_EMPTY', `${o.dataDir} a déjà une base (${path.basename(f)}) : restaure dans un dossier vide (ou déplace l’ancien dossier).`)
  }
  const { manifest, files } = unpackArchive(o.bytes, o.key)
  if (manifest.schemaVersion > MIGRATIONS.length) {
    throw new BackupError('BAD_ARCHIVE', `Sauvegarde faite par une version plus récente d’Atelier (schéma ${manifest.schemaVersion}, celle-ci ${MIGRATIONS.length}) : mets le code à jour d’abord.`)
  }
  const db = files.get(DB_ENTRY)
  if (!db) throw new BackupError('BAD_ARCHIVE', 'Sauvegarde sans base de données.')
  mkdirSync(o.dataDir, { recursive: true, mode: 0o700 })
  for (const [rel, bytes] of files) {
    if (rel === DB_ENTRY) continue
    const abs = path.join(o.dataDir, ...rel.split('/'))
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, bytes)
  }
  writeFileSync(`${dbFile}.restore`, db, { mode: 0o600 })
  const check = new DatabaseSync(`${dbFile}.restore`)
  let counts: Omit<RestoreResult, 'manifest'>
  try {
    const ok = (check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check
    if (ok !== 'ok') throw new BackupError('BAD_ARCHIVE', `La base restaurée est abîmée (${ok}).`)
    const n = (sql: string): number => {
      try {
        return Number((check.prepare(sql).get() as { n: number }).n)
      } catch {
        return 0
      }
    }
    counts = {
      agents: n('SELECT COUNT(*) AS n FROM orch_agents'),
      tasks: n('SELECT COUNT(*) AS n FROM orch_tasks'),
      goals: n('SELECT COUNT(*) AS n FROM channel_goals'),
      channels: n('SELECT COUNT(*) AS n FROM channels')
    }
  } finally {
    check.close()
  }
  renameSync(`${dbFile}.restore`, dbFile)
  return { manifest, ...counts }
}
