// Migration 030, the channel voice (production-5, decisions 0025 and 0029). A channel owns voices; each voice is made once
// (`design` from a description, `clone` of a sample, `import` of a provider voice id), keeps its source sample so it can be
// cloned again on another engine, and has one provider voice id per engine it was cloned on (`channel_voice_clones`). A
// clone carries the consent of decision 0025 (who, when, what). A voice cloned from the channel's own videos on import is
// `proposed` until the owner accepts it; the channel's runs speak with its `is_default` active voice.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'channel_voices'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE channel_voices (
      id            INTEGER PRIMARY KEY,
      channel_id    INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
      method        TEXT NOT NULL CHECK (method IN ('design', 'clone', 'import')),
      source        TEXT NOT NULL DEFAULT '' CHECK (source IN ('', 'upload', 'channel', 'design', 'provider')),
      description   TEXT NOT NULL DEFAULT '',
      language      TEXT NOT NULL DEFAULT 'fr',
      sample_path   TEXT,
      consent_json  TEXT,
      status        TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'retired')),
      is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX channel_voices_channel ON channel_voices(channel_id);
    CREATE TABLE channel_voice_clones (
      voice_id           INTEGER NOT NULL REFERENCES channel_voices(id) ON DELETE CASCADE,
      engine             TEXT NOT NULL,
      provider_voice_id  TEXT NOT NULL,
      demo               INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
      created_at         TEXT NOT NULL,
      PRIMARY KEY (voice_id, engine)
    );
  `)
}
