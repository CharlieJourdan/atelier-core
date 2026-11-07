// Migration 036, the look of an agent's mascot (agents-mascots, decision 0057): orch_agents.look holds the owner's two
// small choices (a body colour and a held accessory) as JSON; NULL = the defaults of the agent's role. It is a column of
// its own, not a field of `policy`, because the sheet replaces the whole model policy when the effort changes.
// Provisional number: renumbered at merge when another branch took it (decision 0004).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'agent_look'

export function up(db: DatabaseSync): void {
  db.exec(`ALTER TABLE orch_agents ADD COLUMN look TEXT CHECK (look IS NULL OR json_valid(look));`)
}
