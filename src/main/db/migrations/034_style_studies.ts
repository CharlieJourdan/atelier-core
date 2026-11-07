// Migration 034, the style studies (production-15): one row per « reproduire un style » — the links the owner pasted, the
// references' measures, the agent's choices and the samples made — kept as one JSON state (src/main/production/style-agent).
// Provisional number: renumbered at merge when another branch took it (decision 0004).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'style_studies'

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE style_studies (
      id         INTEGER PRIMARY KEY,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}
