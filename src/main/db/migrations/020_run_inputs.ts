// Migration 020: a production run keeps the pipeline inputs it was given besides the topic (a person's script, the
// folder of gameplay clips, the channel's name on the intro card), so a resume, a retry or « Refaire pareil » runs
// with the same inputs. JSON object of input id → text.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'run_inputs'

export function up(db: DatabaseSync): void {
  db.exec(`ALTER TABLE video_runs ADD COLUMN inputs_json TEXT NOT NULL DEFAULT '{}';`)
}
