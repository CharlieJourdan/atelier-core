// The backup archive of a team computer (docs/BRAIN-HEADLESS.md §10): ONE file holding a snapshot of the database and the
// team files, gzipped, then encrypted with AES-256-GCM under a key derived (HKDF) from the machine key. Whoever holds the
// archive without the machine key reads nothing (the Cloud keeps it, it cannot open it). Layout:
//   encrypted file = "ATB1" | iv (12) | tag (16) | AES-256-GCM(gzip(payload)), "ATB1" as additional data
//   payload        = "ATELIER-BACKUP 1\n" | manifest JSON | "\n" | the files' bytes, in the manifest's order
// Every file carries its size and SHA-256 in the manifest, checked when the archive is opened.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'

export const ARCHIVE_MAGIC = Buffer.from('ATB1')
const PAYLOAD_MAGIC = 'ATELIER-BACKUP 1\n'
const IV_BYTES = 12
const TAG_BYTES = 16
/** An opened archive never inflates past this (a forged size cannot exhaust the memory). */
export const MAX_PAYLOAD_BYTES = 1024 * 1024 * 1024

export interface ArchiveEntry {
  /** Relative to the data folder, `/`-separated. */
  path: string
  size: number
  sha256: string
}

export interface ArchiveManifest {
  v: 1
  createdAt: string
  /** The machine that made it (its hostname) and the app's version and database schema at that time. */
  host: string
  appVersion: string
  schemaVersion: number
  files: ArchiveEntry[]
  /** Files left out (too big), named so a restore can say what is missing. */
  skipped: { path: string; size: number }[]
}

export class BackupError extends Error {
  constructor(
    readonly code: 'BAD_ARCHIVE' | 'WRONG_KEY' | 'TOO_LARGE' | 'NOT_EMPTY' | 'NO_SOURCE' | 'CLOUD',
    message: string
  ) {
    super(message)
  }
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

/** The archive key: derived from the machine key, so the machine key itself encrypts nothing but the secrets. */
export function backupKey(machineKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', machineKey, Buffer.alloc(0), 'atelier team-pc backup v1', 32))
}

/** A relative path a restore may write: `/`-separated, no `..`, no root, no drive, no backslash. */
export function isSafeEntryPath(p: string): boolean {
  if (!p || p.length > 400 || p.startsWith('/') || p.includes('\\') || p.includes('\0') || /^[A-Za-z]:/.test(p)) return false
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..')
}

export function packArchive(manifest: Omit<ArchiveManifest, 'files'>, files: readonly { path: string; bytes: Buffer }[], key: Buffer): Buffer {
  const entries: ArchiveEntry[] = files.map((f) => {
    if (!isSafeEntryPath(f.path)) throw new BackupError('BAD_ARCHIVE', `unsafe path in a backup: ${f.path}`)
    return { path: f.path, size: f.bytes.length, sha256: sha256(f.bytes) }
  })
  const head = Buffer.from(PAYLOAD_MAGIC + JSON.stringify({ ...manifest, files: entries }) + '\n', 'utf8')
  const payload = gzipSync(Buffer.concat([head, ...files.map((f) => f.bytes)]))
  const iv = randomBytes(IV_BYTES)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(ARCHIVE_MAGIC)
  const body = Buffer.concat([c.update(payload), c.final()])
  return Buffer.concat([ARCHIVE_MAGIC, iv, c.getAuthTag(), body])
}

export function unpackArchive(blob: Buffer, key: Buffer): { manifest: ArchiveManifest; files: Map<string, Buffer> } {
  if (blob.length < ARCHIVE_MAGIC.length + IV_BYTES + TAG_BYTES || !blob.subarray(0, ARCHIVE_MAGIC.length).equals(ARCHIVE_MAGIC)) {
    throw new BackupError('BAD_ARCHIVE', 'Ce fichier n’est pas une sauvegarde d’Atelier.')
  }
  const iv = blob.subarray(ARCHIVE_MAGIC.length, ARCHIVE_MAGIC.length + IV_BYTES)
  const tag = blob.subarray(ARCHIVE_MAGIC.length + IV_BYTES, ARCHIVE_MAGIC.length + IV_BYTES + TAG_BYTES)
  let payload: Buffer
  try {
    const d = createDecipheriv('aes-256-gcm', key, iv)
    d.setAAD(ARCHIVE_MAGIC)
    d.setAuthTag(tag)
    payload = Buffer.concat([d.update(blob.subarray(ARCHIVE_MAGIC.length + IV_BYTES + TAG_BYTES)), d.final()])
  } catch {
    throw new BackupError(
      'WRONG_KEY',
      'Sauvegarde illisible avec cette clé de machine : elle a été faite avec une autre clé (donne celle de l’ancien ordinateur avec --key-file), ou le fichier est abîmé.'
    )
  }
  let plain: Buffer
  try {
    plain = gunzipSync(payload, { maxOutputLength: MAX_PAYLOAD_BYTES })
  } catch {
    throw new BackupError('BAD_ARCHIVE', 'Sauvegarde abîmée (décompression impossible).')
  }
  const nl = plain.indexOf(0x0a, PAYLOAD_MAGIC.length)
  if (plain.subarray(0, PAYLOAD_MAGIC.length).toString('utf8') !== PAYLOAD_MAGIC || nl < 0) throw new BackupError('BAD_ARCHIVE', 'Sauvegarde abîmée (en-tête).')
  let manifest: ArchiveManifest
  try {
    manifest = JSON.parse(plain.subarray(PAYLOAD_MAGIC.length, nl).toString('utf8')) as ArchiveManifest
  } catch {
    throw new BackupError('BAD_ARCHIVE', 'Sauvegarde abîmée (liste des fichiers).')
  }
  if (manifest.v !== 1 || !Array.isArray(manifest.files)) throw new BackupError('BAD_ARCHIVE', 'Version de sauvegarde inconnue.')
  const files = new Map<string, Buffer>()
  let at = nl + 1
  for (const e of manifest.files) {
    if (!isSafeEntryPath(e.path) || !Number.isInteger(e.size) || e.size < 0 || at + e.size > plain.length) throw new BackupError('BAD_ARCHIVE', `Sauvegarde abîmée (${String(e.path)}).`)
    const bytes = plain.subarray(at, at + e.size)
    if (sha256(bytes) !== e.sha256) throw new BackupError('BAD_ARCHIVE', `Sauvegarde abîmée : ${e.path} ne correspond pas à son empreinte.`)
    files.set(e.path, bytes)
    at += e.size
  }
  if (at !== plain.length) throw new BackupError('BAD_ARCHIVE', 'Sauvegarde abîmée (octets en trop).')
  return { manifest, files }
}
