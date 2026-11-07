// Lot 5: agents get a cadence, and tasks can be held by the runner (a budget cap refused their call). Adding
// columns keeps every foreign key to `tasks` intact (rebuilding it would fire their ON DELETE actions). The
// agent rows themselves are seeded at startup from src/main/agents/roles.ts ("seed what is missing").
import type { DatabaseSync } from 'node:sqlite'

export const name = 'agents_runner'

export function up(db: DatabaseSync): void {
  db.exec(`
    ALTER TABLE agents ADD COLUMN cadence TEXT NOT NULL DEFAULT 'on_task'
      CHECK (cadence IN ('on_task','on_message','hourly','daily','weekly'));
    ALTER TABLE tasks ADD COLUMN hold_reason TEXT;
    CREATE INDEX idx_tasks_hold ON tasks(hold_reason) WHERE hold_reason IS NOT NULL;
  `)
}
