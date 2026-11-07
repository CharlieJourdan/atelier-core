// Migration 028, approvals from the phone (docs/AGENT-RUNTIME.md §27, chantier agents-4). « Toujours valider pour ce
// type » writes a standing-allow rule: per channel, per gate of a video, optionally limited to one series (« sujets d'une
// série déjà validée ») or to a number of uses. The gate check of the approval levels reads it (orchestra/allow.ts). A
// question to Charlie keeps its gate, its channel and its series so that a rule can be made from it.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'allow_rules'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE orch_allow_rules (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id       INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      gate             TEXT NOT NULL CHECK (gate IN ('topic','script','voice','thumbnail','video','kit')),
      series           TEXT,
      max_uses         INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
      uses             INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
      source_inbox_id  INTEGER,
      created_at       TEXT NOT NULL,
      last_used_at     TEXT,
      revoked_at       TEXT
    );
    CREATE UNIQUE INDEX idx_orch_allow_rules_live ON orch_allow_rules(channel_id, gate, COALESCE(series, '')) WHERE revoked_at IS NULL;
    ALTER TABLE orch_inbox ADD COLUMN gate TEXT;
    ALTER TABLE orch_inbox ADD COLUMN channel_id INTEGER;
    ALTER TABLE orch_inbox ADD COLUMN series TEXT;
  `)
}
