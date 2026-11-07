// (File 019: see migrations/index.ts.) Test teams (record 0066): a team marked `test` (its credits are test credits, the console
// says so) whose only member is an account that has no usable password, and the keys its headless test brains sign in with.
// A key is stored as its SHA-256 hash, lives a year at most, and is revoked with the team's devices (`admin test-team revoke`).
export const name = 'test_teams'

export const sql = `
ALTER TABLE teams ADD COLUMN test INTEGER NOT NULL DEFAULT 0 CHECK (test IN (0, 1));

CREATE TABLE test_brain_keys (
  id            TEXT PRIMARY KEY,
  hash          TEXT NOT NULL UNIQUE,
  team_id       TEXT NOT NULL REFERENCES teams(id),
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);
CREATE INDEX test_brain_keys_team ON test_brain_keys(team_id);
`
