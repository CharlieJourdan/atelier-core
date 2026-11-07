// v2 lot P5, migration 010: the local copy of Atelier Cloud spending (src/main/cloud/mirror.ts).
// - `credits`: whole Cloud credits held (reserved) or captured (settled) by the job; 0 once refunded.
// - `amount_eur`: those credits in euros at the quote's credit value, when it is known.
// - `cloud_job_id`: the Cloud job the row copies; unique, so a replayed job event never adds a second row.
// Cloud rows keep their USD columns at 0: they never count against the USD caps (the Cloud enforces credit caps).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'cloud_spend'

export function up(db: DatabaseSync): void {
  db.exec(`
    ALTER TABLE ledger ADD COLUMN credits INTEGER;
    ALTER TABLE ledger ADD COLUMN amount_eur REAL;
    ALTER TABLE ledger ADD COLUMN cloud_job_id TEXT;
    CREATE UNIQUE INDEX idx_ledger_cloud_job ON ledger(cloud_job_id) WHERE cloud_job_id IS NOT NULL;
  `)
}
