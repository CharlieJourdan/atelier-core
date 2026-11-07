// v2 lot 3, migration 008 (kept by lot P1; the SQL is unchanged so every database upgrades the same way).
// - The v1 render jobs table (006) becomes `engine_jobs`, with the target, title, request body, progress, event cursor
//   and measured cost of each render. Since lot P1 nothing writes it: it is read-only history
//   (src/main/production/history.ts). Our own engine stores its runs in new tables (lots P6, P7).
// - The ledger gets a fourth kind of entry, `adjustment`: the difference between what was booked (the estimate) and
//   what was measured afterwards. It may be negative, so the ledger table is rebuilt (SQLite cannot change a CHECK in
//   place). `ref_id` points at the entry it corrects. Credits are settled with it (Ledger.adjust).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'engine_jobs'

export function up(db: DatabaseSync): void {
  db.exec(`
    -- v1_render_jobs references ledger(id): dropping the old ledger would null its ledger_id (ON DELETE SET NULL),
    -- so the jobs are set aside in a plain table first and copied into engine_jobs once the new ledger is in place.
    CREATE TEMP TABLE _jobs_v7 AS SELECT * FROM v1_render_jobs;
    DROP TABLE v1_render_jobs;

    CREATE TABLE ledger_v8 (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id         TEXT NOT NULL,
      model               TEXT NOT NULL,
      channel_id          INTEGER REFERENCES channels(id) ON DELETE SET NULL,
      video_id            INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      task_id             INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      status              TEXT NOT NULL CHECK (status IN ('reserved','settled','refunded','adjustment')),
      estimate_usd        REAL NOT NULL DEFAULT 0 CHECK (estimate_usd >= 0),
      amount_usd          REAL NOT NULL DEFAULT 0 CHECK (amount_usd >= 0 OR status = 'adjustment'),
      input_tokens        INTEGER NOT NULL DEFAULT 0,
      output_tokens       INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
      ref_id              INTEGER REFERENCES ledger(id) ON DELETE SET NULL,
      note                TEXT,
      created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      settled_at          TEXT
    );
    INSERT INTO ledger_v8 (id, provider_id, model, channel_id, video_id, task_id, status, estimate_usd, amount_usd,
                           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at, settled_at)
      SELECT id, provider_id, model, channel_id, video_id, task_id, status, estimate_usd, amount_usd,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at, settled_at FROM ledger;
    DROP TABLE ledger;
    ALTER TABLE ledger_v8 RENAME TO ledger;
    CREATE INDEX idx_ledger_created ON ledger(created_at);
    CREATE INDEX idx_ledger_channel ON ledger(channel_id);
    CREATE INDEX idx_ledger_video ON ledger(video_id);
    CREATE INDEX idx_ledger_task ON ledger(task_id);
    CREATE INDEX idx_ledger_status ON ledger(status);
    CREATE INDEX idx_ledger_ref ON ledger(ref_id) WHERE ref_id IS NOT NULL;

    CREATE TABLE engine_jobs (
      id              INTEGER PRIMARY KEY,
      target          TEXT NOT NULL DEFAULT 'local' CHECK (target IN ('local','h1')),
      slug            TEXT NOT NULL,
      title           TEXT NOT NULL DEFAULT '',
      video_id        INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      deliverable_id  INTEGER NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
      task_id         INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      style           TEXT NOT NULL,
      minutes         REAL NOT NULL,
      payload         TEXT,
      state           TEXT NOT NULL DEFAULT 'queued'
                        CHECK (state IN ('queued','running','downloading','done','error','cancelled')),
      progress        REAL,
      step            TEXT,
      stages          TEXT,
      ext_run         TEXT,
      ext_seq         INTEGER NOT NULL DEFAULT 0,
      error           TEXT,
      estimate_usd    REAL NOT NULL DEFAULT 0,
      measured_usd    REAL,
      ledger_id       INTEGER REFERENCES ledger(id) ON DELETE SET NULL,
      adjustment_id   INTEGER REFERENCES ledger(id) ON DELETE SET NULL,
      version_id      INTEGER REFERENCES versions(id) ON DELETE SET NULL,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO engine_jobs (id, target, slug, video_id, deliverable_id, task_id, style, minutes, state, progress, error,
                             estimate_usd, ledger_id, version_id, created_at, updated_at)
      SELECT id, 'local', slug, video_id, deliverable_id, task_id, style, minutes, state, progress, error,
             estimate_usd, ledger_id, version_id, created_at, updated_at FROM _jobs_v7;
    DROP TABLE _jobs_v7;
    CREATE INDEX idx_engine_jobs_active ON engine_jobs(state) WHERE state IN ('queued','running','downloading');
    CREATE INDEX idx_engine_jobs_deliverable ON engine_jobs(deliverable_id);
    CREATE INDEX idx_engine_jobs_slug ON engine_jobs(slug);
  `)
}
