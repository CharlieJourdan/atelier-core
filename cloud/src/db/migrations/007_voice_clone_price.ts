// Lot "voices": the usage `cloneVoice` is priced by the grid item `voice.clone`. A database whose current grid was made before
// that item existed gets a new grid version, the current one plus the item (every other figure unchanged); a database that
// already has the item (a fresh one: migration 002 now includes it) is left alone, so its grid stays at version 1.
import type { DatabaseSync } from 'node:sqlite'
import { VOICE_CLONE_ITEM } from './002_default_prices.ts'

export const name = 'voice_clone_price'

export function up(db: DatabaseSync): void {
  const row = db.prepare('SELECT * FROM price_grids ORDER BY version DESC LIMIT 1').get() as
    | { version: number; credit_value_eur: number; usd_to_eur: number; overhead_pct: number; items_json: string }
    | undefined
  if (!row) return
  const items = JSON.parse(row.items_json) as { item: string }[]
  if (items.some((i) => i.item === VOICE_CLONE_ITEM.item)) return
  db.prepare(
    `INSERT INTO price_grids (version, credit_value_eur, usd_to_eur, overhead_pct, note, items_json, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'migration')`
  ).run(
    row.version + 1,
    row.credit_value_eur,
    row.usd_to_eur,
    row.overhead_pct,
    'adds voice.clone (the price of a cloned voice)',
    JSON.stringify([...items, VOICE_CLONE_ITEM]),
    new Date().toISOString()
  )
}
