// Migration 033, the channel's sponsor (production-9, decision 0025, docs/specs/pipeline-avatar.md §2.13): one sponsor asset per
// channel, kept as the text the owner typed (`clé : valeur` lines or a JSON object, read by the engine's `parseSponsor`). The
// channel's runs take it as the pipeline's `sponsor` input when the run was not given one.
// Provisional number: renumbered at merge when another branch took it (decision 0004).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'channel_sponsors'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE channel_sponsors (
      channel_id INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
      text       TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
      updated_at TEXT NOT NULL
    );
  `)
}
