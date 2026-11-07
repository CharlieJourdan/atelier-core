// Lot Z1, migration 018: ideas and automations of the Production section.
// - `ideas`: video ideas per channel, written by hand or proposed by the ideas agent; « Créer la vidéo » turns one into
//   a plain video row (no agent task), linked back through `video_id`.
// - `automations`: « lancer le pipeline X » rules (cadence, hour, where the topic comes from), computed `next_run_at`;
//   `automation_runs` keeps what each firing did. A firing starts a run of our engine (production runs, migration 012).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'ideas'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE ideas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
      angle       TEXT NOT NULL DEFAULT '',
      source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','agent')),
      score       INTEGER CHECK (score IS NULL OR score BETWEEN 0 AND 100),
      status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','kept','rejected','used')),
      video_id    INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      example     INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1)),
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX idx_ideas_channel ON ideas(channel_id, status);

    CREATE TABLE automations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
      channel_id   INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      cadence      TEXT NOT NULL CHECK (cadence IN ('manual','daily','weekly')),
      weekday      INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
      hour         INTEGER NOT NULL DEFAULT 9 CHECK (hour BETWEEN 0 AND 23),
      topic_from   TEXT NOT NULL DEFAULT 'ideas' CHECK (topic_from IN ('ideas','fixed')),
      topic        TEXT NOT NULL DEFAULT '',
      minutes      REAL NOT NULL DEFAULT 1 CHECK (minutes > 0 AND minutes <= 30),
      budget_mode  TEXT NOT NULL DEFAULT 'usage_max' CHECK (budget_mode IN ('usage_max','qualite_max')),
      gate_mode    TEXT NOT NULL DEFAULT 'step' CHECK (gate_mode IN ('step','all')),
      enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      last_run_at  TEXT,
      next_run_at  TEXT,
      example      INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1)),
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX idx_automations_next ON automations(next_run_at) WHERE enabled = 1;

    CREATE TABLE automation_runs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_id  INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
      video_id       INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      run_id         INTEGER,
      status         TEXT NOT NULL CHECK (status IN ('started','skipped','failed')),
      message        TEXT NOT NULL DEFAULT '',
      example        INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1)),
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX idx_automation_runs_automation ON automation_runs(automation_id, created_at);
  `)
}
