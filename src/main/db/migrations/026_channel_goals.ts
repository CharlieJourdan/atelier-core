// Migration 026, a channel's standing goals (docs/AGENT-RUNTIME.md §25, chantier agents-2): proposed when the channel is
// created or imported (linked to a YouTube channel), confirmed or edited by Charlie, read by the channel's agents every
// turn. Time (publication slots, formats and lengths, deadlines), budget (monthly credits) and the approval level (which
// gates of a video ask Charlie). The lists are JSON; the store (src/main/orchestra/goals.ts) validates them.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'channel_goals'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE channel_goals (
      channel_id      INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
      status          TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed')),
      slots_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(slots_json)),
      formats_json    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(formats_json)),
      budget_credits  INTEGER NOT NULL DEFAULT 0 CHECK (budget_credits >= 0),
      deadlines_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(deadlines_json)),
      level           TEXT NOT NULL DEFAULT 'recommended' CHECK (level IN ('recommended','all-auto','manual','custom')),
      gates_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(gates_json)),
      reasons         TEXT NOT NULL DEFAULT '',
      source          TEXT NOT NULL CHECK (source IN ('baseline','agent','user')),
      trigger_kind    TEXT NOT NULL CHECK (trigger_kind IN ('create','import')),
      inbox_id        INTEGER,
      proposed_at     TEXT NOT NULL,
      confirmed_at    TEXT,
      updated_at      TEXT NOT NULL
    );
  `)
}
