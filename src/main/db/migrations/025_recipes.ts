// Migration 025, recipes and projects (decision 0011). A recipe belongs to the team (not to a channel) and serves one
// video type; each save is a new immutable version holding the whole `atelier.recette/1` document. `recipe_channels` says
// which recipe a channel uses for each video type it makes; `channel_production` holds a channel's own settings per
// technology (keyed by technology name) and its checkpoints (null: topic + thumbnail). A project is ONE video: a pinned
// recipe version, a channel or none, the idea and inputs, per-video adjustments, and the run that made it.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'recipes'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE recipes (
      id           INTEGER PRIMARY KEY,
      name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
      video_type   TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      archived_at  TEXT
    );
    CREATE TABLE recipe_versions (
      id          INTEGER PRIMARY KEY,
      recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      number      INTEGER NOT NULL CHECK (number >= 1),
      json        TEXT NOT NULL,
      note        TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      UNIQUE (recipe_id, number)
    );
    CREATE TABLE recipe_channels (
      channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      video_type  TEXT NOT NULL,
      recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (channel_id, video_type)
    );
    CREATE INDEX idx_recipe_channels_recipe ON recipe_channels(recipe_id);
    CREATE TABLE channel_production (
      channel_id        INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
      settings_json     TEXT NOT NULL DEFAULT '{}',
      checkpoints_json  TEXT,
      updated_at        TEXT NOT NULL
    );
    CREATE TABLE projects (
      id                INTEGER PRIMARY KEY,
      recipe_id         INTEGER NOT NULL REFERENCES recipes(id),
      recipe_version    INTEGER NOT NULL CHECK (recipe_version >= 1),
      channel_id        INTEGER REFERENCES channels(id) ON DELETE SET NULL,
      title             TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
      idea              TEXT NOT NULL DEFAULT '',
      inputs_json       TEXT NOT NULL DEFAULT '{}',
      adjustments_json  TEXT NOT NULL DEFAULT '{}',
      run_id            INTEGER REFERENCES video_runs(id) ON DELETE SET NULL,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    CREATE INDEX idx_projects_channel ON projects(channel_id);
    CREATE INDEX idx_projects_recipe ON projects(recipe_id);
  `)
}
