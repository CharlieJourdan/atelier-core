// Atelier Cloud schema v20: a quote may be worth 0 credit (audit-depenses, decision 0105). A source that costs us nothing
// (Pixabay, Pexels, Wikimedia, the archives, the YouTube reads) is priced 0 credit, and `quotes.total_credits` was
// `CHECK (total_credits >= 1)`. SQLite cannot alter a CHECK, and rebuilding `quotes` would break `jobs.quote_id` (a dropped
// parent leaves deferred foreign-key violations that a later rename does not clear). Loosening a CHECK is the one schema
// edit SQLite documents as safe through `writable_schema` (sqlite.org/lang_altertable.html, "Making Other Kinds Of Table
// Schema Changes"): no row is read or rewritten, the stored text changes, and the schema cookie is bumped so every
// connection reloads it. The test reopens the file and runs `integrity_check`.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'free_quotes'

const OLD = 'total_credits  INTEGER NOT NULL CHECK (total_credits >= 1)'
const NEW = 'total_credits  INTEGER NOT NULL CHECK (total_credits >= 0)'

export function up(db: DatabaseSync): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'quotes'").get() as { sql: string } | undefined
  if (!row || !row.sql.includes(OLD)) throw new Error('migration 020: the quotes table is not in the shape this migration expects')
  const cookie = (db.prepare('PRAGMA schema_version').get() as { schema_version: number }).schema_version
  db.enableDefensive(false) // node:sqlite opens in defensive mode, which forbids writable_schema
  db.exec('PRAGMA writable_schema = ON')
  try {
    db.prepare("UPDATE sqlite_master SET sql = replace(sql, ?, ?) WHERE type = 'table' AND name = 'quotes'").run(OLD, NEW)
    db.exec(`PRAGMA schema_version = ${cookie + 1}`)
  } finally {
    db.exec('PRAGMA writable_schema = OFF')
    db.enableDefensive(true)
  }
}
