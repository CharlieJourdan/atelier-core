// Migration 031, the pipeline's conversation with the agent (production-12, decisions 0024 and 0032). A pipeline (recipe)
// keeps its messages with the agent and the changes proposed to it: each change is a batch of edit operations made on one
// version, `pending` until the owner accepts it (a new version is saved, `saved_version`) or rejects it; a newer proposal
// replaces a pending one. A change comes from the pipeline's own agent or from a team agent (orchestra tool).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'pipeline_threads'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE pipeline_changes (
      id             INTEGER PRIMARY KEY,
      recipe_id      INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      base_version   INTEGER NOT NULL,
      ops_json       TEXT NOT NULL,
      note           TEXT NOT NULL DEFAULT '',
      author         TEXT NOT NULL CHECK (author IN ('agent', 'team')),
      status         TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'replaced')),
      saved_version  INTEGER,
      created_at     TEXT NOT NULL,
      decided_at     TEXT
    );
    CREATE INDEX pipeline_changes_recipe ON pipeline_changes(recipe_id, status);
    CREATE TABLE pipeline_messages (
      id           INTEGER PRIMARY KEY,
      recipe_id    INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      role         TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
      text         TEXT NOT NULL,
      change_id    INTEGER REFERENCES pipeline_changes(id) ON DELETE SET NULL,
      errors_json  TEXT,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX pipeline_messages_recipe ON pipeline_messages(recipe_id, id);
  `)
}
