// (File 010: see migrations/index.ts.) The publication kits on the platform (kits.ts): one row per upload attempt of a video's kit (`uploading` until it is
// completed, then `ready`; a completed kit replaces the video's older ones), and one row per file. The files themselves
// are objects under `kits/<team>/<kit>/<name>` in the file store.
export const name = 'video_kits'

export const sql = `
CREATE TABLE video_kits (
  id            TEXT PRIMARY KEY,
  team_id       TEXT NOT NULL REFERENCES teams(id),
  video_id      TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  extras_json   TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('uploading', 'ready')),
  uploaded_by   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  completed_at  TEXT,
  expires_at    TEXT
);
CREATE INDEX video_kits_video ON video_kits(team_id, video_id, status, created_at);
CREATE INDEX video_kits_expiry ON video_kits(status, expires_at);

CREATE TABLE video_kit_files (
  kit_id  TEXT NOT NULL REFERENCES video_kits(id),
  name    TEXT NOT NULL,
  mime    TEXT NOT NULL,
  size    INTEGER NOT NULL,
  sha256  TEXT NOT NULL,
  PRIMARY KEY (kit_id, name)
);
`
