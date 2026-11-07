// The team computers (machines/service.ts): one row per machine a team has or had. The enrolment token is stored as a
// SHA-256 hash only; a deleted machine keeps its row for the books.
export const name = 'team_machines'

export const sql = `
CREATE TABLE team_machines (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES teams(id),
  plan         TEXT NOT NULL,
  server_type  TEXT NOT NULL,
  location     TEXT NOT NULL,
  provider     TEXT NOT NULL CHECK (provider IN ('hetzner', 'fake')),
  server_id    TEXT,
  snapshot_id  TEXT,
  status       TEXT NOT NULL CHECK (status IN ('creating', 'running', 'hibernating', 'hibernated', 'resuming', 'deleted', 'error')),
  ipv4         TEXT,
  enrol_hash   TEXT NOT NULL UNIQUE,
  enrolled_at  TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX team_machines_team ON team_machines(team_id, status);
`
