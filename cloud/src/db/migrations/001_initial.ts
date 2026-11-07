// Atelier Cloud schema v1: accounts and teams, device logins and tokens, the wallet, price grids and quotes, jobs and their
// events, stored artefacts, the vault, the audit log and support requests. Times are ISO-8601 UTC strings.
export const name = 'initial'

export const sql = `
CREATE TABLE accounts (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  platform_admin INTEGER NOT NULL DEFAULT 0 CHECK (platform_admin IN (0, 1)),
  created_at     TEXT NOT NULL
);

CREATE TABLE teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  internal    INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0, 1)),
  created_at  TEXT NOT NULL
);

CREATE TABLE members (
  team_id      TEXT NOT NULL REFERENCES teams(id),
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  daily_cap    INTEGER CHECK (daily_cap IS NULL OR daily_cap >= 0),
  monthly_cap  INTEGER CHECK (monthly_cap IS NULL OR monthly_cap >= 0),
  created_at   TEXT NOT NULL,
  PRIMARY KEY (team_id, account_id)
);

CREATE TABLE devices (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  team_id       TEXT NOT NULL REFERENCES teams(id),
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT,
  revoked_at    TEXT
);

CREATE TABLE device_logins (
  device_code_hash  TEXT PRIMARY KEY,
  user_code         TEXT NOT NULL UNIQUE,
  code_challenge    TEXT NOT NULL,
  device_name       TEXT NOT NULL,
  account_id        TEXT REFERENCES accounts(id),
  team_id           TEXT REFERENCES teams(id),
  approved_at       TEXT,
  consumed_at       TEXT,
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL
);

CREATE TABLE tokens (
  hash         TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  device_id    TEXT NOT NULL REFERENCES devices(id),
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  revoked_at   TEXT
);
CREATE INDEX tokens_device ON tokens(device_id);

CREATE TABLE wallets (
  team_id  TEXT PRIMARY KEY REFERENCES teams(id),
  balance  INTEGER NOT NULL DEFAULT 0,
  held     INTEGER NOT NULL DEFAULT 0,
  CHECK (held >= 0 AND balance >= held)
);

CREATE TABLE holds (
  id               TEXT PRIMARY KEY,
  team_id          TEXT NOT NULL REFERENCES teams(id),
  account_id       TEXT REFERENCES accounts(id),
  amount           INTEGER NOT NULL CHECK (amount > 0),
  captured_amount  INTEGER CHECK (captured_amount IS NULL OR captured_amount >= 0),
  state            TEXT NOT NULL CHECK (state IN ('open', 'captured', 'released')),
  job_id           TEXT,
  created_at       TEXT NOT NULL,
  closed_at        TEXT
);
CREATE INDEX holds_open ON holds(state, created_at);
CREATE INDEX holds_account ON holds(account_id, created_at);

CREATE TABLE wallet_entries (
  id          TEXT PRIMARY KEY,
  seq         INTEGER NOT NULL UNIQUE,
  team_id     TEXT NOT NULL REFERENCES teams(id),
  kind        TEXT NOT NULL CHECK (kind IN ('grant', 'hold', 'capture', 'release', 'adjust')),
  delta       INTEGER NOT NULL,
  held_delta  INTEGER NOT NULL,
  hold_id     TEXT REFERENCES holds(id),
  job_id      TEXT,
  account_id  TEXT,
  idem_key    TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (team_id, idem_key)
);
CREATE INDEX wallet_entries_team ON wallet_entries(team_id, seq);

CREATE TABLE price_grids (
  version          INTEGER PRIMARY KEY,
  credit_value_eur REAL NOT NULL CHECK (credit_value_eur > 0),
  usd_to_eur       REAL NOT NULL CHECK (usd_to_eur > 0),
  overhead_pct     REAL NOT NULL CHECK (overhead_pct >= 0),
  note             TEXT,
  items_json       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  created_by       TEXT NOT NULL
);

CREATE TABLE quotes (
  id             TEXT PRIMARY KEY,
  team_id        TEXT NOT NULL REFERENCES teams(id),
  account_id     TEXT NOT NULL REFERENCES accounts(id),
  usage          TEXT NOT NULL,
  input_json     TEXT NOT NULL,
  lines_json     TEXT NOT NULL,
  total_credits  INTEGER NOT NULL CHECK (total_credits >= 1),
  reference_eur  REAL,
  cost_eur       REAL NOT NULL,
  grid_version   INTEGER NOT NULL REFERENCES price_grids(version),
  demo           INTEGER NOT NULL CHECK (demo IN (0, 1)),
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);

CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES teams(id),
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  usage        TEXT NOT NULL,
  quote_id     TEXT NOT NULL REFERENCES quotes(id),
  idem_key     TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  credits      INTEGER NOT NULL,
  hold_id      TEXT REFERENCES holds(id),
  provider     TEXT NOT NULL,
  demo         INTEGER NOT NULL CHECK (demo IN (0, 1)),
  attempts     INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  result_json  TEXT,
  cost_usd     REAL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (team_id, idem_key),
  UNIQUE (quote_id)
);
CREATE INDEX jobs_state ON jobs(state);

CREATE TABLE job_events (
  job_id     TEXT NOT NULL REFERENCES jobs(id),
  seq        INTEGER NOT NULL,
  type       TEXT NOT NULL,
  data_json  TEXT NOT NULL,
  at         TEXT NOT NULL,
  PRIMARY KEY (job_id, seq)
);

CREATE TABLE artefacts (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id),
  job_id      TEXT REFERENCES jobs(id),
  sha256      TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  demo        INTEGER NOT NULL CHECK (demo IN (0, 1)),
  created_at  TEXT NOT NULL
);

CREATE TABLE vault_secrets (
  name        TEXT PRIMARY KEY,
  iv          BLOB NOT NULL,
  tag         BLOB NOT NULL,
  ciphertext  BLOB NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  target       TEXT,
  detail_json  TEXT
);

CREATE TABLE support_requests (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  team_id     TEXT NOT NULL REFERENCES teams(id),
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
`
