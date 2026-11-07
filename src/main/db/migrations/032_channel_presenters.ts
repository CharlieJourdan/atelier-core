// Migration 032, the channel presenter (production-7, decisions 0025 and 0034, docs/specs/pipeline-avatar.md §2.5 a). A channel owns
// presenters; each is made once (`portrait` generated from an art-direction description, or `clone` from frames of the
// channel's OWN videos with the consent tick), keeps its portrait and the angles that passed the face-similarity check, the
// id of its face per presenter engine (`registrations_json`), and may be linked to a channel voice. A cloned presenter is
// `proposed` until the owner accepts it; the channel's runs read its `is_default` active presenter as a channel input.
// Provisional number: renumbered at merge when another branch took it (decision 0004).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'channel_presenters'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE channel_presenters (
      id                 INTEGER PRIMARY KEY,
      channel_id         INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
      method             TEXT NOT NULL CHECK (method IN ('portrait', 'clone')),
      description        TEXT NOT NULL DEFAULT '',
      portrait_path      TEXT,
      angles_json        TEXT NOT NULL DEFAULT '[]',
      registrations_json TEXT NOT NULL DEFAULT '{}',
      voice_id           INTEGER REFERENCES channel_voices(id) ON DELETE SET NULL,
      consent_json       TEXT,
      status             TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'retired')),
      is_default         INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE INDEX channel_presenters_channel ON channel_presenters(channel_id);
  `)
}
