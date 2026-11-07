// Blueprints (blueprints.ts): every published version of the default agent organisation and preset pipelines, append
// only. The highest version is the one the apps read.
export const name = 'blueprints'

export const sql = `
CREATE TABLE blueprints (
  version       INTEGER PRIMARY KEY,
  json          TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  published_by  TEXT NOT NULL,
  published_at  TEXT NOT NULL
);
`
