// v1 lot 7: render jobs started by the video producer through the first, external video engine, and its
// per-channel settings. That engine was removed in v2 (lot P1). The jobs table is renamed `engine_jobs` by 008 (kept
// as history); the per-channel table is no longer read.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'render_jobs'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE v1_render_jobs (
      id              INTEGER PRIMARY KEY,
      slug            TEXT NOT NULL,
      video_id        INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      deliverable_id  INTEGER NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
      task_id         INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      style           TEXT NOT NULL,
      minutes         REAL NOT NULL,
      state           TEXT NOT NULL DEFAULT 'queued'
                        CHECK (state IN ('queued','running','downloading','done','error')),
      progress        REAL,
      error           TEXT,
      estimate_usd    REAL NOT NULL DEFAULT 0,
      ledger_id       INTEGER REFERENCES ledger(id) ON DELETE SET NULL,
      version_id      INTEGER REFERENCES versions(id) ON DELETE SET NULL,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX idx_v1_render_jobs_active ON v1_render_jobs(state) WHERE state IN ('queued','running','downloading');
    CREATE INDEX idx_v1_render_jobs_deliverable ON v1_render_jobs(deliverable_id);

    CREATE TABLE v1_render_channels (
      channel_id  INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
      style       TEXT,
      minutes     REAL CHECK (minutes IS NULL OR (minutes >= 1 AND minutes <= 60)),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `)
}
