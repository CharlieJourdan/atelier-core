// Per-route reasoning effort for the Anthropic API (`output_config.effort`). NULL = the model's default.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'route_effort'

export function up(db: DatabaseSync): void {
  db.exec(`ALTER TABLE routes ADD COLUMN effort TEXT CHECK (effort IS NULL OR effort IN ('low','medium','high','max'))`)
}
