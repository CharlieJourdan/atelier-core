// Real Anthropic list prices (USD per million tokens) replace the lot 1 placeholders, and the prices table
// accepts the "max" tier (claude-fable-5-1, never routed by default). SQLite cannot alter a CHECK, so the table
// is rebuilt; nothing references it.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'real_prices'

const PRICES: [model: string, tier: string, input: number, output: number, cacheWrite: number, cacheRead: number][] = [
  ['claude-opus-5-5', 'best', 4.0, 20.0, 5.0, 0.2],
  ['claude-sonnet-5-5', 'balanced', 2.0, 10.0, 2.5, 0.2],
  ['claude-haiku-5-5', 'fast', 0.1, 0.5, 0.125, 0.01],
  ['claude-fable-5-1', 'max', 10.0, 50.0, 12.5, 0.25]
]

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE prices_new (
      model                 TEXT PRIMARY KEY,
      provider_id           TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      tier                  TEXT CHECK (tier IN ('best','balanced','fast','max')),
      input_per_mtok        REAL NOT NULL CHECK (input_per_mtok >= 0),
      output_per_mtok       REAL NOT NULL CHECK (output_per_mtok >= 0),
      cache_read_per_mtok   REAL NOT NULL DEFAULT 0 CHECK (cache_read_per_mtok >= 0),
      cache_write_per_mtok  REAL NOT NULL DEFAULT 0 CHECK (cache_write_per_mtok >= 0),
      is_placeholder        INTEGER NOT NULL DEFAULT 0 CHECK (is_placeholder IN (0,1)),
      updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO prices_new SELECT * FROM prices;
    DROP TABLE prices;
    ALTER TABLE prices_new RENAME TO prices;
  `)
  const upsert = db.prepare(
    `INSERT INTO prices (model, provider_id, tier, input_per_mtok, output_per_mtok, cache_write_per_mtok,
                         cache_read_per_mtok, is_placeholder)
     VALUES (?, 'anthropic', ?, ?, ?, ?, ?, 0)
     ON CONFLICT(model) DO UPDATE SET tier = excluded.tier, input_per_mtok = excluded.input_per_mtok,
       output_per_mtok = excluded.output_per_mtok, cache_write_per_mtok = excluded.cache_write_per_mtok,
       cache_read_per_mtok = excluded.cache_read_per_mtok, is_placeholder = 0,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  )
  for (const row of PRICES) upsert.run(...row)
}
