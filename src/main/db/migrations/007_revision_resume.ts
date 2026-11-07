// Lot 10: remembers where the owner's "Try again" resumed a task held after repeated revisions, so the revision
// count behind that hold only counts the revisions since (an approvals id; 0 = count them all).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'revision_resume'

export function up(db: DatabaseSync): void {
  db.exec(`ALTER TABLE tasks ADD COLUMN revisions_resumed_after INTEGER NOT NULL DEFAULT 0;`)
}
