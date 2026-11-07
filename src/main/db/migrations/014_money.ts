// Lot Z1, migration 014: revenues, sponsor deals and offers (Monétisation). Amounts are integer cents.
// `example` marks rows of the example workspace (deleted in one click, see src/main/example/money.ts).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'money'

export function up(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE revenues (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  channel_id    INTEGER REFERENCES channels(id) ON DELETE SET NULL,
  video_id      INTEGER REFERENCES videos(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN ('adsense','sponsor','product','affiliate','other')),
  amount_cents  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR','USD')),
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','csv','example')),
  note          TEXT NOT NULL DEFAULT '',
  example       INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_revenues_date ON revenues(date);
CREATE INDEX idx_revenues_channel ON revenues(channel_id);

CREATE TABLE sponsor_deals (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  brand            TEXT NOT NULL,
  contact          TEXT NOT NULL DEFAULT '',
  amount_cents     INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency         TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR','USD')),
  terms            TEXT NOT NULL DEFAULT '',
  required_phrases TEXT NOT NULL DEFAULT '',
  link             TEXT NOT NULL DEFAULT '',
  placement        TEXT NOT NULL DEFAULT '',
  due_date         TEXT,
  video_id         INTEGER REFERENCES videos(id) ON DELETE SET NULL,
  channel_id       INTEGER REFERENCES channels(id) ON DELETE SET NULL,
  stage            TEXT NOT NULL DEFAULT 'prospect'
                   CHECK (stage IN ('prospect','contacted','negotiation','signed','to_deliver','delivered','paid')),
  draft_message    TEXT NOT NULL DEFAULT '',
  example          INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1)),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sponsor_deals_stage ON sponsor_deals(stage);

CREATE TABLE offers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id   INTEGER REFERENCES channels(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'ebook' CHECK (kind IN ('ebook','course','site','service','other')),
  price_cents  INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  status       TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','building','ready','live')),
  pack_json    TEXT NOT NULL DEFAULT 'null' CHECK (json_valid(pack_json)),
  plugs_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(plugs_json)),
  example      INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`)
}
