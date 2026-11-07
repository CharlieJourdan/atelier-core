// The team computers' link to the Cloud (machines/credentials.ts, relay/): the long-lived credential a machine gets for
// its single-use enrolment token (stored as a SHA-256 hash only, revocable), and the relay's audit of who called which
// brain method (never the arguments).
export const name = 'machine_relay'

export const sql = `
CREATE TABLE machine_credentials (
  id            TEXT PRIMARY KEY,
  machine_id    TEXT NOT NULL REFERENCES team_machines(id),
  team_id       TEXT NOT NULL REFERENCES teams(id),
  hash          TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT,
  revoked_at    TEXT
);
CREATE INDEX machine_credentials_machine ON machine_credentials(machine_id, revoked_at);

CREATE TABLE relay_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  team_id     TEXT NOT NULL,
  account_id  TEXT NOT NULL,
  machine_id  TEXT,
  method      TEXT NOT NULL,
  outcome     TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'offline', 'timeout', 'too_large', 'busy')),
  ms          INTEGER NOT NULL
);
CREATE INDEX relay_calls_team ON relay_calls(team_id, id);
`
