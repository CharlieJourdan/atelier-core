// Team invitations: an owner or admin invites a person by e-mail; the link (single use, 7 days) is stored hashed, like the
// e-mail tokens. `accounts.default_team_id` is the team an account signs in to once it joined one by invitation (the
// oldest membership otherwise).
export const name = 'team_invites'

export const sql = `
CREATE TABLE team_invites (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES teams(id),
  email        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash   TEXT NOT NULL UNIQUE,
  invited_by   TEXT NOT NULL REFERENCES accounts(id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  revoked_at   TEXT,
  accepted_by  TEXT REFERENCES accounts(id)
);
CREATE INDEX team_invites_team ON team_invites(team_id, email);

ALTER TABLE accounts ADD COLUMN default_team_id TEXT;
`
