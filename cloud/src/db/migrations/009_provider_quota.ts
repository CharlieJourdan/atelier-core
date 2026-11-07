// Lot "eyes": a provider with its own free daily quota (the YouTube Data API: 10 000 units a day, reset at midnight Pacific
// time) is counted here, so a restart does not forget what the day has already used. One row per provider and day; the
// adapter refuses a call that would pass its configured budget (providers/youtube.ts).
export const name = 'provider_quota'

export const sql = `
CREATE TABLE provider_quota (
  provider TEXT NOT NULL,
  day      TEXT NOT NULL,
  units    INTEGER NOT NULL DEFAULT 0 CHECK (units >= 0),
  PRIMARY KEY (provider, day)
);
`
