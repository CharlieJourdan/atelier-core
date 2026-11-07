// Migration 037, the team on the real production (agents-production, chantier B):
// - `videos.status` gains `failed`: a video whose production run failed says so (it stayed `in_progress` before). SQLite
//   cannot change a CHECK in place, so the table is rebuilt with foreign keys off (the runner's 12-step procedure), so the
//   tables that reference it with ON DELETE CASCADE keep every row; the keys are checked before commit.
// - `projects.video_id`: the video a project fills before it runs (a slot of the planner, or the video a run made). An
//   imported script is a project with its `script` input; linking it to a slot's video is how the team uses it.
// Provisional number: renumbered at merge when another branch took it (decision 0004).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'team_production'
/** Run with foreign keys off (see the runner): the rebuild must not fire the cascades. */
export const foreignKeysOff = true

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE videos_v37 (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      goal_id     INTEGER REFERENCES goals(id) ON DELETE SET NULL,
      title       TEXT NOT NULL DEFAULT '',
      brief       TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'idea'
                  CHECK (status IN ('idea','in_progress','waiting_approval','ready','published','cancelled','failed')),
      deadline    TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO videos_v37 (id, channel_id, goal_id, title, brief, status, deadline, created_at, updated_at)
      SELECT id, channel_id, goal_id, title, brief, status, deadline, created_at, updated_at FROM videos;
    DROP TABLE videos;
    ALTER TABLE videos_v37 RENAME TO videos;
    CREATE INDEX idx_videos_channel ON videos(channel_id);
    CREATE INDEX idx_videos_goal ON videos(goal_id);
    CREATE INDEX idx_videos_status ON videos(status);

    ALTER TABLE projects ADD COLUMN video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL;
    CREATE INDEX idx_projects_video ON projects(video_id);
  `)
}
