// Lot Z1, migration 013: channel analyses, styles, pipeline library and Builder sessions (PLAN-V2-PRODUCTION §2, §3).
// Table names avoid those of lots P6/P7 (analyses, channel_styles, style_versions, pipelines, pipeline_versions).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'analysis'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE analysis_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_link TEXT NOT NULL DEFAULT '',
      reference_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('choose_examples', 'done')),
      mode TEXT NOT NULL DEFAULT 'usage_max' CHECK (mode IN ('qualite_max', 'usage_max')),
      chosen_examples_json TEXT NOT NULL DEFAULT '[]',
      steps_json TEXT NOT NULL DEFAULT '[]',
      profile_json TEXT NOT NULL DEFAULT 'null',
      style_draft_json TEXT NOT NULL DEFAULT 'null',
      answers_json TEXT NOT NULL DEFAULT '{}',
      replace_json TEXT NOT NULL DEFAULT '{}',
      adjust_json TEXT NOT NULL DEFAULT '{}',
      gauge_json TEXT NOT NULL DEFAULT 'null',
      proposed_pipeline_json TEXT NOT NULL DEFAULT 'null',
      created_pipeline_id INTEGER,
      example INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE analysis_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
      author TEXT NOT NULL CHECK (author IN ('user', 'analyst')),
      body TEXT NOT NULL,
      applied_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX analysis_messages_by_run ON analysis_messages(analysis_id, id);

    CREATE TABLE library_pipelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL CHECK (origin IN ('template', 'own', 'team', 'builder', 'analysis', 'import')),
      channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
      default_for_channel INTEGER NOT NULL DEFAULT 0 CHECK (default_for_channel IN (0, 1)),
      example INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE library_pipeline_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pipeline_id INTEGER NOT NULL REFERENCES library_pipelines(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      json TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE (pipeline_id, number)
    );

    CREATE TABLE channel_style_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      json TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      example INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (channel_id, version)
    );

    CREATE TABLE builder_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      pipeline_id INTEGER REFERENCES library_pipelines(id) ON DELETE SET NULL,
      analysis_id INTEGER REFERENCES analysis_runs(id) ON DELETE SET NULL,
      draft_json TEXT NOT NULL,
      previous_draft_json TEXT,
      errors_json TEXT NOT NULL DEFAULT '[]',
      estimate_json TEXT NOT NULL DEFAULT 'null',
      example INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE builder_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES builder_sessions(id) ON DELETE CASCADE,
      author TEXT NOT NULL CHECK (author IN ('user', 'builder')),
      body TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'none' CHECK (outcome IN ('none', 'valid', 'invalid')),
      errors_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX builder_messages_by_session ON builder_messages(session_id, id);

    CREATE TABLE support_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      what TEXT NOT NULL,
      links TEXT NOT NULL DEFAULT '',
      budget TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL,
      attach_analysis INTEGER NOT NULL DEFAULT 0 CHECK (attach_analysis IN (0, 1)),
      analysis_id INTEGER REFERENCES analysis_runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      example INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      closed_at TEXT
    );
  `)
}
