// Migration 035, real runs from the app (production-16, decision 0044): a run the owner turned real goes through Atelier
// Cloud's jobs (`video_runs.cloud` = 1). Each Cloud job of such a run is kept with the node that made it: the engine that
// really ran it (`provider`, the Cloud's adapter id), real or the Cloud's demo, its state and the credits the Cloud took.
// One row per job id, so a job replayed by a retry is never counted twice. A node's real cost (`video_run_nodes.credits`)
// and the run's (`video_runs.spent_credits`) are the sums of their succeeded jobs.
// Provisional number: renumbered at merge when another branch took it (decision 0004).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'real_runs'

export function up(db: DatabaseSync): void {
  db.exec(`
    ALTER TABLE video_runs ADD COLUMN cloud INTEGER NOT NULL DEFAULT 0 CHECK (cloud IN (0, 1));
    CREATE TABLE video_run_jobs (
      job_id     TEXT PRIMARY KEY,
      run_id     INTEGER NOT NULL REFERENCES video_runs(id) ON DELETE CASCADE,
      node_id    TEXT NOT NULL,
      usage      TEXT NOT NULL,
      provider   TEXT,
      demo       INTEGER NOT NULL CHECK (demo IN (0, 1)),
      state      TEXT NOT NULL,
      credits    INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX video_run_jobs_run ON video_run_jobs(run_id, node_id);
  `)
}
