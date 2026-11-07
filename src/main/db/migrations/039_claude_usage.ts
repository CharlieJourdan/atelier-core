// Migration 039, what a run consumes on the user's Claude subscription (usage-claude): the ledger already keeps the
// tokens, the model, the video and the API-equivalent cost of every call (Claude Code reports `total_cost_usd`); this
// adds how long the call took. Not money Atelier charges — the screens say « équivalent API ».
// Provisional number: renumbered at merge when another branch took it (decision 0004).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'claude_usage'

export function up(db: DatabaseSync): void {
  db.exec(`ALTER TABLE ledger ADD COLUMN duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0);`)
}
