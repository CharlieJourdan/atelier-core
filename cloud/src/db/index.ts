// The Cloud's SQLite access (node:sqlite, WAL). One file `cloud.db` in the data folder, ':memory:' in tests.
// Hosted later, Postgres replaces it behind the same services (§4.1); nothing outside cloud/src/ touches SQL.
import { DatabaseSync } from 'node:sqlite'
import { CLOUD_MIGRATIONS, type CloudMigration } from './migrations/index.ts'

export type CloudDb = DatabaseSync

export function openCloudDb(path: string, migrations: readonly CloudMigration[] = CLOUD_MIGRATIONS): CloudDb {
  const db = new DatabaseSync(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 10000')
  migrateCloud(db, migrations)
  return db
}

export function cloudSchemaVersion(db: CloudDb): number {
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }
  return row.v
}

export function migrateCloud(db: CloudDb, migrations: readonly CloudMigration[] = CLOUD_MIGRATIONS): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`)
  const sorted = [...migrations].sort((a, b) => a.version - b.version)
  sorted.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Cloud migrations must be numbered 1..n without gaps (found ${m.version})`)
  })
  const current = cloudSchemaVersion(db)
  if (current > sorted.length) throw new Error(`Cloud schema version ${current} is newer than this server (${sorted.length})`)
  const applied: number[] = []
  for (const m of sorted) {
    if (m.version <= current) continue
    tx(db, () => {
      m.up(db)
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name)
    })
    applied.push(m.version)
  }
  return applied
}

/** BEGIN IMMEDIATE: the write lock is taken before the first read, so a check and its write can never interleave
 *  with another connection's (the wallet relies on this). Nested calls join the outer transaction. */
export function tx<T>(db: CloudDb, fn: () => T): T {
  if (db.isTransaction) return fn()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw err
  }
}
