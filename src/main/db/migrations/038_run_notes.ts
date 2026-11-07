// Migration 038, the notes of a run (solidite, decision 0078): what changed the run's pipeline without anyone saying so
// — an option of the recipe that replaced a value the recipe set itself (avatar round 2's clip share) — kept with the run
// as a JSON list of French sentences, shown in its view and in brain-run's report.
// Provisional number: renumbered at merge when another branch took it (decision 0004).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'run_notes'

export function up(db: DatabaseSync): void {
  db.exec(`ALTER TABLE video_runs ADD COLUMN notes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(notes_json));`)
}
