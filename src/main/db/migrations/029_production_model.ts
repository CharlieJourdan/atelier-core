// Migration 029, the production model (decision 0021, docs/specs/production-model.md §4). A brick style is versioned
// DATA dressing one brick family (image, clip, presenter, ...): `brick_styles` holds the name, the family (fixed from
// the first save) and whether it ships with the app; each save is a new immutable row of `brick_style_versions` holding
// the whole `atelier.brickstyle/1` document. A project pins the engine and style versions it runs with, next to the
// recipe version (`projects.pins_json`, `{}` for a project made before this migration).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'production_model'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE brick_styles (
      name        TEXT PRIMARY KEY CHECK (length(name) BETWEEN 1 AND 48),
      family      TEXT NOT NULL,
      builtin     INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE brick_style_versions (
      id          INTEGER PRIMARY KEY,
      style_name  TEXT NOT NULL REFERENCES brick_styles(name) ON DELETE CASCADE,
      number      INTEGER NOT NULL CHECK (number >= 1),
      json        TEXT NOT NULL,
      note        TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      UNIQUE (style_name, number)
    );
    ALTER TABLE projects ADD COLUMN pins_json TEXT NOT NULL DEFAULT '{}';
  `)
}
