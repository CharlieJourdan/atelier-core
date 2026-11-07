// Migration 027, the planner and the heartbeat (docs/AGENT-RUNTIME.md §26, chantier agents-3). The planner works each
// upcoming publication slot of a channel backwards into steps; a slot (one video) and each of its steps have a key, so a
// step is enqueued once, whatever crashes or restarts happen (the step row and its task are written in one
// transaction). An early warning is given once per slot and reason. The heartbeat reminds Charlie once of a question
// left unanswered (`orch_inbox.reminded_at`).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'plan'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE orch_plan_slots (
      channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      slot_at     TEXT NOT NULL,
      kind        TEXT NOT NULL CHECK (kind IN ('long','short')),
      video_id    INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ready','retired')),
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (channel_id, slot_at)
    );
    CREATE TABLE orch_plan_steps (
      channel_id  INTEGER NOT NULL,
      slot_at     TEXT NOT NULL,
      step        TEXT NOT NULL,
      task_id     INTEGER REFERENCES orch_tasks(id) ON DELETE SET NULL,
      status      TEXT NOT NULL CHECK (status IN ('open','skipped')),
      deadline    TEXT NOT NULL,
      credits     INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
      created_at  TEXT NOT NULL,
      PRIMARY KEY (channel_id, slot_at, step),
      FOREIGN KEY (channel_id, slot_at) REFERENCES orch_plan_slots(channel_id, slot_at) ON DELETE CASCADE
    );
    CREATE INDEX idx_orch_plan_steps_task ON orch_plan_steps(task_id);
    CREATE TABLE orch_plan_warnings (
      channel_id  INTEGER NOT NULL,
      slot_at     TEXT NOT NULL,
      reason      TEXT NOT NULL,
      inbox_id    INTEGER,
      text        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      PRIMARY KEY (channel_id, slot_at, reason),
      FOREIGN KEY (channel_id, slot_at) REFERENCES orch_plan_slots(channel_id, slot_at) ON DELETE CASCADE
    );
    ALTER TABLE orch_inbox ADD COLUMN reminded_at TEXT;
  `)
}
