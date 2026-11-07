// Billing (billing/service.ts): a team's payment account (the provider's customer, the automatic top-up settings),
// its subscription, the payment events already applied (each one once) and what was charged.
export const name = 'billing'

export const sql = `
CREATE TABLE billing_accounts (
  team_id           TEXT PRIMARY KEY REFERENCES teams(id),
  customer_ref      TEXT,
  auto_enabled      INTEGER NOT NULL DEFAULT 0 CHECK (auto_enabled IN (0, 1)),
  auto_threshold    INTEGER NOT NULL,
  auto_pack         TEXT NOT NULL,
  auto_cap_cents    INTEGER NOT NULL,
  auto_month        TEXT NOT NULL,
  auto_spent_cents  INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL
);
CREATE TABLE billing_subscriptions (
  team_id           TEXT PRIMARY KEY REFERENCES teams(id),
  plan              TEXT NOT NULL,
  period            TEXT NOT NULL CHECK (period IN ('month', 'year')),
  status            TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled')),
  subscription_ref  TEXT UNIQUE,
  since             TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE TABLE billing_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  TEXT NOT NULL
);
CREATE TABLE billing_charges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id     TEXT NOT NULL REFERENCES teams(id),
  kind        TEXT NOT NULL CHECK (kind IN ('subscription', 'pack', 'topup')),
  cents       INTEGER NOT NULL,
  ref         TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX billing_charges_team ON billing_charges(team_id, kind, created_at);
`
