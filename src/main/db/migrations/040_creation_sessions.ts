// Migration 040, the creation conversations (creation-conversationnelle): one row per « Créer une pipeline » conversation — the
// user's answers, the messages and their illustrated blocks, the videos watched, the verdict, the example runs — kept as one JSON
// state (src/main/production/creation). Provisional number: renumbered at merge when another branch took it (decision 0004).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'creation_sessions'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE creation_sessions (
      id         INTEGER PRIMARY KEY,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}
