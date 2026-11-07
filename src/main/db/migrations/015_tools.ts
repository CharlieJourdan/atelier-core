// Lot Z1, migration 015: Mes outils (tool manifests, their versions and their runs).
// Secret VALUES are not here: they live in `secrets` under the name `tools.<slug>.<NAME>`; `secrets_json` keeps names only.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'tools'

export function up(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE tools (
  slug                TEXT PRIMARY KEY CHECK (slug GLOB '[a-z0-9]*'),
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('command','script','http','mcp')),
  version             TEXT NOT NULL,
  manifest_json       TEXT NOT NULL CHECK (json_valid(manifest_json)),
  status              TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','disabled')),
  error               TEXT NOT NULL DEFAULT '',
  permissions_json    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(permissions_json)),
  granted_json        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(granted_json)),
  granted_agents_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(granted_agents_json)),
  secrets_json        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(secrets_json)),
  example             INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1)),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE tool_versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tool           TEXT NOT NULL REFERENCES tools(slug) ON DELETE CASCADE,
  version        TEXT NOT NULL,
  manifest_json  TEXT NOT NULL CHECK (json_valid(manifest_json)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tool, version)
);

CREATE TABLE tool_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tool         TEXT NOT NULL REFERENCES tools(slug) ON DELETE CASCADE,
  input_json   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
  output_text  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL CHECK (status IN ('ok','error','dry_run')),
  ms           INTEGER NOT NULL DEFAULT 0,
  example      INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tool_runs_tool ON tool_runs(tool, id);
`)
}
