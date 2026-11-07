// (File 017: see migrations/index.ts.) The founder console's money view (console-depenses, decision 0040):
//   - `wallet_entries.funding`: who paid a credit in, « offered » (an admin grant or correction) or « paid » (a plan, a
//     pack, an automatic top-up). Grants and adjustments written before carry it from their idempotency key: billing's
//     are `billing:…` and `topup:…`, every other one came from an admin.
//   - `quotes.price_multiplier`: the global multiplier a quote was priced with (NULL = the grid's own margins), so a
//     measured job settles on the same rule it was quoted with.
//   - `finished_videos`: one row per video a team finished, written when its publication kit is complete (a kit is deleted
//     after its retention, this row stays), with the length the kit was sent with (finished minutes, cost per minute).
//   - `finance_settings`: the global price multiplier (1.0 = sold at cost, the beta rule) and the dated $ → € rate.
//   - `fixed_costs`: the monthly fixed costs the founder types in (a server, a subscription…); the HeyGen plan and the
//     team computers are computed lines (admin-finance.ts), not rows.
export const name = 'finance'

export const sql = `
ALTER TABLE wallet_entries ADD COLUMN funding TEXT CHECK (funding IS NULL OR funding IN ('offered', 'paid'));
UPDATE wallet_entries SET funding = CASE WHEN idem_key LIKE 'billing:%' OR idem_key LIKE 'topup:%' THEN 'paid' ELSE 'offered' END
  WHERE kind IN ('grant', 'adjust');

ALTER TABLE quotes ADD COLUMN price_multiplier REAL CHECK (price_multiplier IS NULL OR price_multiplier > 0);

CREATE TABLE finished_videos (
  team_id     TEXT NOT NULL REFERENCES teams(id),
  video_id    TEXT NOT NULL,
  duration_s  REAL CHECK (duration_s IS NULL OR duration_s >= 0),
  demo        INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  first_at    TEXT NOT NULL,
  last_at     TEXT NOT NULL,
  PRIMARY KEY (team_id, video_id)
);
CREATE INDEX finished_videos_first ON finished_videos(first_at);
INSERT INTO finished_videos (team_id, video_id, duration_s, demo, first_at, last_at)
  SELECT team_id, video_id, NULL, MAX(CASE WHEN json_extract(extras_json, '$.demo') THEN 1 ELSE 0 END), MIN(completed_at), MAX(completed_at)
  FROM video_kits WHERE status = 'ready' AND completed_at IS NOT NULL GROUP BY team_id, video_id;

CREATE TABLE finance_settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL
);
INSERT INTO finance_settings (key, value_json, updated_at, updated_by) VALUES ('price.multiplier', '1', '2026-11-01T00:00:00.000Z', 'migration');
INSERT INTO finance_settings (key, value_json, updated_at, updated_by)
  SELECT 'fx.eurPerUsd', json_object('rate', usd_to_eur, 'asOf', '2026-10-30'), '2026-11-01T00:00:00.000Z', 'migration'
  FROM price_grids ORDER BY version DESC LIMIT 1;

CREATE TABLE fixed_costs (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency      TEXT NOT NULL CHECK (currency IN ('USD', 'EUR')),
  note          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  removed_at    TEXT
);
`
