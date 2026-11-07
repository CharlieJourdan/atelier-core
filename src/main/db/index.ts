import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, type Migration } from './migrations'

export type Db = DatabaseSync

/** Opens (or creates) the database at `path` (':memory:' for tests) and brings it to the latest schema. */
export function openDatabase(path: string, migrations: readonly Migration[] = MIGRATIONS): Db {
  const db = new DatabaseSync(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db, migrations)
  return db
}

export function schemaVersion(db: Db): number {
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }
  return row.v
}

/** Applies every pending migration in order, each in its own transaction. Returns the versions applied. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`)
  const sorted = [...migrations].sort((a, b) => a.version - b.version)
  sorted.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migrations must be numbered 1..n without gaps (found ${m.version})`)
  })
  const current = schemaVersion(db)
  if (current > sorted.length) {
    throw new Error(`Database schema version ${current} is newer than this app (${sorted.length})`)
  }
  const applied: number[] = []
  for (const m of sorted) {
    if (m.version <= current) continue
    // SQLite's table-rebuild procedure: foreign keys off outside the transaction, checked inside it before commit.
    const keysWereOn = m.foreignKeysOff === true && foreignKeysOn(db)
    if (keysWereOn) db.exec('PRAGMA foreign_keys = OFF')
    try {
      transaction(db, () => {
        m.up(db)
        if (m.foreignKeysOff) {
          const broken = db.prepare('PRAGMA foreign_key_check').all()
          if (broken.length > 0) throw new Error(`Migration ${m.version} left ${broken.length} foreign key violations`)
        }
        db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name)
      })
    } finally {
      if (keysWereOn) db.exec('PRAGMA foreign_keys = ON')
    }
    applied.push(m.version)
  }
  const violations = db.prepare('PRAGMA foreign_key_check').all()
  if (violations.length > 0) throw new Error(`Foreign key violations after migration: ${violations.length}`)
  return applied
}

function foreignKeysOn(db: Db): boolean {
  return (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys === 1
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    // SQLite may already have rolled back on its own (I/O error, disk full); keep the original error.
    if (db.isTransaction) db.exec('ROLLBACK')
    throw err
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}
