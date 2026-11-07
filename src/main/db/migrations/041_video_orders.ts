// Migration 041, Charlie's video orders (equipe-3-chaines): « lance-moi 3 vidéos, une par chaîne, avec ces scripts ». One row
// per ordered video: its channel, the owner's script word for word, the video / project / run it became, where it stands
// (made → checked → fixed → ready), the final quality report and when Charlie was told. Provisional number: renumbered at
// merge when another branch took it (decision 0004).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'video_orders'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE video_orders (
      id           INTEGER PRIMARY KEY,
      batch        TEXT NOT NULL,
      channel_id   INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      script       TEXT NOT NULL,
      real         INTEGER NOT NULL DEFAULT 1,
      max_usd      REAL,
      video_id     INTEGER,
      project_id   INTEGER,
      run_id       INTEGER,
      runs_json    TEXT NOT NULL DEFAULT '[]',
      status       TEXT NOT NULL CHECK (status IN ('queued','producing','checking','fixing','ready','failed')),
      fixes        INTEGER NOT NULL DEFAULT 0,
      report_json  TEXT,
      error        TEXT,
      notified_at  TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX idx_video_orders_run ON video_orders(run_id);
    CREATE INDEX idx_video_orders_status ON video_orders(status);
  `)
}
