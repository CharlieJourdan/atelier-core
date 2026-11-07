// (File 012: see migrations/index.ts.) App releases (releases.ts): one row per version of the app pushed to a channel
// (`beta` or `stable`) for a platform (`win` or `mac`), draft until the founder publishes it, `withdrawn` when it is pulled
// back; and one row per file (the installer, its blockmap). The files themselves are objects under
// `releases/<release>/<name>` in the file store. A version exists once per channel and platform.
export const name = 'app_releases'

export const sql = `
CREATE TABLE releases (
  id            TEXT PRIMARY KEY,
  version       TEXT NOT NULL,
  channel       TEXT NOT NULL CHECK (channel IN ('beta', 'stable')),
  platform      TEXT NOT NULL CHECK (platform IN ('win', 'mac')),
  notes         TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('draft', 'published', 'withdrawn')),
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  published_at  TEXT,
  withdrawn_at  TEXT,
  UNIQUE (channel, platform, version)
);
CREATE INDEX releases_feed ON releases(channel, platform, state);

CREATE TABLE release_files (
  release_id  TEXT NOT NULL REFERENCES releases(id),
  name        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  sha512      TEXT NOT NULL,
  PRIMARY KEY (release_id, name)
);
`
