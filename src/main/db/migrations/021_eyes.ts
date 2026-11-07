// Lot "eyes", migration 021: what the channel analysis ("the eyes") reads and keeps.
// - `channel_competitors`: the competitor channels a channel follows (the YouTube link, its name once read, watched or not).
// - `channel_reads`: the latest public read of a channel through Atelier Cloud (`channelData`): its videos with views, dates and
//   durations. `source_key` 0 = the channel itself, else the competitor's id. One row per source: a new read replaces it.
// - `video_analyses`: the eyes' answer for one video (hook, structure, pacing, shots, text, music, calls to action).
// - `style_profiles`: the channel style profile, numbered versions like the style sheets; `origin` says whether the analysis
//   built it or the owner edited it.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'eyes'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE channel_competitors (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id     INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      url            TEXT NOT NULL CHECK (length(url) BETWEEN 10 AND 500),
      name           TEXT NOT NULL DEFAULT '',
      watched        INTEGER NOT NULL DEFAULT 1 CHECK (watched IN (0,1)),
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (channel_id, url)
    );

    CREATE TABLE channel_reads (
      channel_id     INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      source_key     INTEGER NOT NULL CHECK (source_key >= 0),
      url            TEXT NOT NULL,
      title          TEXT NOT NULL DEFAULT '',
      subscribers    INTEGER,
      videos_json    TEXT NOT NULL CHECK (json_valid(videos_json)),
      quota_units    INTEGER NOT NULL DEFAULT 0,
      demo           INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
      read_at        TEXT NOT NULL,
      PRIMARY KEY (channel_id, source_key)
    );

    CREATE TABLE video_analyses (
      channel_id     INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      source_key     INTEGER NOT NULL CHECK (source_key >= 0),
      video_id       TEXT NOT NULL,
      url            TEXT NOT NULL,
      title          TEXT NOT NULL DEFAULT '',
      duration_s     REAL,
      outlier        INTEGER NOT NULL DEFAULT 0 CHECK (outlier IN (0,1)),
      analysis_json  TEXT NOT NULL CHECK (json_valid(analysis_json)),
      demo           INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
      analysed_at    TEXT NOT NULL,
      PRIMARY KEY (channel_id, source_key, video_id)
    );

    CREATE TABLE style_profiles (
      channel_id     INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      version        INTEGER NOT NULL CHECK (version >= 1),
      json           TEXT NOT NULL CHECK (json_valid(json)),
      note           TEXT NOT NULL DEFAULT '',
      origin         TEXT NOT NULL CHECK (origin IN ('built','edited')),
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (channel_id, version)
    );
  `)
}
