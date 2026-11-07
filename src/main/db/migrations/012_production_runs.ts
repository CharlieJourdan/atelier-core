// Lot Z1, migration 012: runs of our engine per video, their nodes, the engine's persistent node state (gate
// decisions, change notes, replaced outputs: a run survives an app restart), and the local credits wallet.
// Names avoid `runs`, `node_runs`, `artefacts` (lots P6/P7). Other areas read `video_runs.channel_id`,
// `spent_credits`, `demo`, `finished_at` and `status`: keep those names.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'production_runs'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE video_runs (
      id             INTEGER PRIMARY KEY,
      video_id       INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      channel_id     INTEGER NOT NULL,
      pipeline_json  TEXT NOT NULL,
      pipeline_label TEXT NOT NULL,
      topic          TEXT NOT NULL,
      minutes        REAL NOT NULL,
      budget_mode    TEXT NOT NULL CHECK (budget_mode IN ('usage_max','qualite_max')),
      gate_mode      TEXT NOT NULL CHECK (gate_mode IN ('step','all')),
      style_json     TEXT NOT NULL DEFAULT '{}',
      seeds_json     TEXT NOT NULL DEFAULT '{}',
      status         TEXT NOT NULL CHECK (status IN ('queued','running','waiting','succeeded','failed','cancelled','interrupted')),
      demo           INTEGER NOT NULL DEFAULT 1 CHECK (demo IN (0,1)),
      quote_credits  INTEGER NOT NULL DEFAULT 0,
      spent_credits  INTEGER NOT NULL DEFAULT 0,
      attempt        INTEGER NOT NULL DEFAULT 0,
      hold_id        INTEGER,
      redo_of        INTEGER,
      error          TEXT,
      video_file     TEXT,
      package_dir    TEXT,
      duration_s     REAL,
      created_at     TEXT NOT NULL,
      started_at     TEXT,
      finished_at    TEXT,
      example        INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1))
    );
    CREATE INDEX video_runs_video ON video_runs(video_id);
    CREATE INDEX video_runs_channel ON video_runs(channel_id, status);

    CREATE TABLE video_run_nodes (
      run_id          INTEGER NOT NULL REFERENCES video_runs(id) ON DELETE CASCADE,
      node_id         TEXT NOT NULL,
      position        INTEGER NOT NULL,
      type            TEXT NOT NULL,
      label           TEXT NOT NULL,
      state           TEXT NOT NULL DEFAULT 'pending',
      progress        REAL NOT NULL DEFAULT 0,
      step            TEXT,
      quote_credits   INTEGER NOT NULL DEFAULT 0,
      credits         INTEGER NOT NULL DEFAULT 0,
      fingerprint     TEXT,
      previous_fingerprint TEXT,
      error_code      TEXT,
      error_message   TEXT,
      error_detail    TEXT,
      gate            TEXT NOT NULL DEFAULT 'none' CHECK (gate IN ('none','waiting','approved','changes_requested')),
      gate_kind       TEXT NOT NULL DEFAULT 'none' CHECK (gate_kind IN ('none','review','owner')),
      change_note     TEXT,
      pending_decision TEXT CHECK (pending_decision IN ('approve','change')),
      started_at      TEXT,
      finished_at     TEXT,
      PRIMARY KEY (run_id, node_id)
    );

    CREATE TABLE production_node_records (
      engine_run_id  TEXT NOT NULL,
      node_id        TEXT NOT NULL,
      state          TEXT NOT NULL,
      fingerprint    TEXT,
      attempts       INTEGER NOT NULL DEFAULT 0,
      error_json     TEXT,
      updated_at     INTEGER NOT NULL,
      PRIMARY KEY (engine_run_id, node_id)
    );

    CREATE TABLE production_gate_decisions (
      id             INTEGER PRIMARY KEY,
      scope          TEXT NOT NULL,
      node_id        TEXT NOT NULL,
      kind           TEXT NOT NULL CHECK (kind IN ('approved','override','note')),
      fingerprint    TEXT,
      to_fingerprint TEXT,
      note           TEXT,
      created_at     TEXT NOT NULL
    );
    CREATE INDEX production_gate_decisions_scope ON production_gate_decisions(scope, node_id, kind);

    CREATE TABLE credit_entries (
      id              INTEGER PRIMARY KEY,
      kind            TEXT NOT NULL CHECK (kind IN ('grant','hold','capture','release','adjust')),
      amount          INTEGER NOT NULL,
      run_id          INTEGER,
      hold_id         INTEGER REFERENCES credit_entries(id),
      idempotency_key TEXT NOT NULL UNIQUE,
      source          TEXT NOT NULL CHECK (source IN ('local','simulated_purchase','example')),
      note            TEXT,
      created_at      TEXT NOT NULL,
      example         INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1))
    );
    CREATE INDEX credit_entries_hold ON credit_entries(hold_id);
  `)
}
