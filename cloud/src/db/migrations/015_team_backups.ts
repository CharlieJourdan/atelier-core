// (File 015: see migrations/index.ts.) The team computer's backups (backups.ts, src/shared/cloud-backup.ts): one row per
// encrypted archive a team computer sent with its own credential. The bytes are an object `backups/<team>/<id>.atb` in the
// file store; the Cloud cannot read them (encrypted on the machine).
export const name = 'team_backups'

export const sql = `
CREATE TABLE team_backups (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id),
  machine_id  TEXT NOT NULL,
  size        INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX team_backups_team ON team_backups(team_id, created_at);
CREATE INDEX team_backups_expiry ON team_backups(expires_at);
`
