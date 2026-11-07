// Lot Z1, migration 011: the example workspace. Channels created by "Charger l'espace d'exemple" carry
// `example = 1`; every Z1 table that holds example rows has its own `example` column. Deleting the example workspace
// deletes those rows (videos and everything hanging off an example channel go with it through ON DELETE CASCADE).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'example'

export function up(db: DatabaseSync): void {
  db.exec(`ALTER TABLE channels ADD COLUMN example INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1));`)
}
