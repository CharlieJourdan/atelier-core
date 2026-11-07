// Migration 024, custom bricks (« briques sur mesure », docs/ENGINE-SPEC.md §25.2): the index of the bricks an agent wrote for a channel.
// The bricks themselves are files of the workspace data folder (`<data>/bricks/channel-<id>/<brick>/v<n>/brick.json`, with its preview
// stills next to it); this table says which exist, their state (brouillon → à valider → validée), the version Charlie approved (the one
// the channel's films use), whether the channel uses it in its films, the inbox item of the proposal, his note on a refusal, the number of
// previews of the current draft (the agent's tries are capped) and the last preview's verdict.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'bricks'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE bricks (
      id                INTEGER PRIMARY KEY,
      channel_id        INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      slug              TEXT NOT NULL CHECK (length(slug) BETWEEN 2 AND 40),
      name              TEXT NOT NULL,
      version           INTEGER NOT NULL CHECK (version >= 1),
      state             TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','review','approved')),
      approved_version  INTEGER CHECK (approved_version IS NULL OR approved_version >= 1),
      enabled           INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
      content_hash      TEXT NOT NULL,
      tries             INTEGER NOT NULL DEFAULT 0 CHECK (tries >= 0),
      preview_json      TEXT,
      note              TEXT,
      inbox_id          INTEGER,
      agent_id          INTEGER,
      task_id           INTEGER,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      UNIQUE (channel_id, slug)
    );
    CREATE INDEX idx_bricks_inbox ON bricks(inbox_id);
  `)
}
