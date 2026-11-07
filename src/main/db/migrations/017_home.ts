// Lot Z1, migration 017: Ordinateurs (agent browser sessions, remote machines). Accueil and Validations read existing tables.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'home'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE browser_sessions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      role             TEXT NOT NULL,
      start_url        TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      screenshot_path  TEXT,
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      closed_at        TEXT,
      example          INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1))
    );
    CREATE INDEX idx_browser_sessions_status ON browser_sessions(status);

    CREATE TABLE machines (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT NOT NULL,
      os               TEXT NOT NULL CHECK (os IN ('windows','macos','linux')),
      host             TEXT NOT NULL,
      port             INTEGER NOT NULL DEFAULT 22 CHECK (port BETWEEN 1 AND 65535),
      status           TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown','reachable','unreachable')),
      last_seen_at     TEXT,
      last_checked_at  TEXT,
      last_error       TEXT,
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      example          INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1))
    );
  `)
}
