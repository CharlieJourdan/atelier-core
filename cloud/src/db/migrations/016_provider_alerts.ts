// (File 016: see migrations/index.ts.) A provider that needs the founder's hand (production-10): today HeyGen's MCP sign-in,
// whose token refresh failed. One row per provider adapter, raised by the adapter and cleared when it works again; the founder
// console shows them (`GET /v1/admin/overview`, `providerAlerts`) and `providers status` prints them.
export const name = 'provider_alerts'

export const sql = `
CREATE TABLE provider_alerts (
  provider    TEXT PRIMARY KEY,
  message     TEXT NOT NULL,
  raised_at   TEXT NOT NULL
);
`
