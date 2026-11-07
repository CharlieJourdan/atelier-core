// Lot Z1, migration 016: team members, devices, Claude profiles with their routing, and the Atelier Cloud link.
// Secret VALUES are not here: API keys live in `secrets` under `claude.profile.<id>.key`, the Cloud token under
// `cloud.token`. `example` marks rows of the example workspace (src/main/example/team.ts).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'team'

export function up(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE team_members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  email        TEXT COLLATE NOCASE UNIQUE,
  role         TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active')),
  monthly_cap  INTEGER CHECK (monthly_cap IS NULL OR monthly_cap >= 0),
  is_self      INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0,1)),
  example      INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE team_devices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  os           TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  is_current   INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  example      INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1))
);

CREATE TABLE claude_profiles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('cli','api')),
  limited_until TEXT,
  is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  example       INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE claude_routing (
  role       TEXT PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES claude_profiles(id) ON DELETE CASCADE
);
`)
}
