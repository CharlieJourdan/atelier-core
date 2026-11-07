// Migration 023, Google connection (read-only): the cache of what YouTube says about the owner's own channels.
// - `google_channels`: the channels of the connected Google account (Data API `channels.list?mine=true`): title, handle,
//   the public counts, and whether Analytics gave estimated revenue for it. Which Atelier channel a row feeds is decided
//   at read time from `channels.youtube_channel_id`, so editing a channel never leaves a stale link here.
// - `google_channel_days`: one row per channel and day of YouTube Analytics (`reports.query`, dimension `day`): views,
//   minutes watched, subscribers gained and lost, estimated revenue in euros (null when Google gives none).
// Disconnecting deletes both. No token or secret lives here (they are in `secrets`, encrypted).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'google'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE google_channels (
      youtube_channel_id  TEXT PRIMARY KEY CHECK (length(youtube_channel_id) BETWEEN 3 AND 64),
      title               TEXT NOT NULL DEFAULT '',
      handle              TEXT,
      subscribers         INTEGER CHECK (subscribers IS NULL OR subscribers >= 0),
      total_views         INTEGER CHECK (total_views IS NULL OR total_views >= 0),
      revenue_available   INTEGER NOT NULL DEFAULT 0 CHECK (revenue_available IN (0,1)),
      fetched_at          TEXT NOT NULL
    );

    CREATE TABLE google_channel_days (
      youtube_channel_id  TEXT NOT NULL REFERENCES google_channels(youtube_channel_id) ON DELETE CASCADE,
      day                 TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      views               INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
      watch_minutes       INTEGER NOT NULL DEFAULT 0 CHECK (watch_minutes >= 0),
      subs_gained         INTEGER NOT NULL DEFAULT 0 CHECK (subs_gained >= 0),
      subs_lost           INTEGER NOT NULL DEFAULT 0 CHECK (subs_lost >= 0),
      revenue_eur         REAL,
      PRIMARY KEY (youtube_channel_id, day)
    );
  `)
}
