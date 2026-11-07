// Model prices (USD per million tokens) and the cost of a call's usage.
import type { PricePatch, PriceRow, ProviderId } from '../../shared/api'
import type { Tier } from '../../shared/roles'
import type { Db } from '../db'
import type { Usage } from './types'

interface PriceDbRow {
  model: string
  provider_id: ProviderId
  tier: Tier | 'max' | null
  input_per_mtok: number
  output_per_mtok: number
  cache_read_per_mtok: number
  cache_write_per_mtok: number
  is_placeholder: number
}

const COLUMNS: Record<keyof PricePatch, string> = {
  inputPerMTok: 'input_per_mtok',
  outputPerMTok: 'output_per_mtok',
  cacheReadPerMTok: 'cache_read_per_mtok',
  cacheWritePerMTok: 'cache_write_per_mtok'
}

export class PricesStore {
  constructor(private readonly db: Db) {}

  list(): PriceRow[] {
    const rows = this.db.prepare('SELECT * FROM prices ORDER BY input_per_mtok DESC, model').all()
    return (rows as unknown as PriceDbRow[]).map(toRow)
  }

  get(model: string): PriceRow | null {
    const row = this.db.prepare('SELECT * FROM prices WHERE model = ?').get(model) as PriceDbRow | undefined
    return row ? toRow(row) : null
  }

  /** Editing a price clears its placeholder flag. */
  set(model: string, patch: PricePatch): PriceRow {
    if (!this.get(model)) throw new Error(`Unknown model: ${model}`)
    const sets: string[] = []
    const values: number[] = []
    for (const key of Object.keys(COLUMNS) as (keyof PricePatch)[]) {
      const v = patch[key]
      if (v === undefined) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`Invalid price for ${key}: ${v}`)
      sets.push(`${COLUMNS[key]} = ?`)
      values.push(v)
    }
    if (sets.length > 0) {
      this.db
        .prepare(
          `UPDATE prices SET ${sets.join(', ')}, is_placeholder = 0,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE model = ?`
        )
        .run(...values, model)
    }
    return this.get(model) as PriceRow
  }
}

export function costOf(price: PriceRow, usage: Usage): number {
  const perToken = 1 / 1_000_000
  return (
    usage.inputTokens * price.inputPerMTok * perToken +
    usage.outputTokens * price.outputPerMTok * perToken +
    usage.cacheReadTokens * price.cacheReadPerMTok * perToken +
    usage.cacheWriteTokens * price.cacheWritePerMTok * perToken
  )
}

function toRow(r: PriceDbRow): PriceRow {
  return {
    model: r.model,
    providerId: r.provider_id,
    tier: r.tier,
    inputPerMTok: r.input_per_mtok,
    outputPerMTok: r.output_per_mtok,
    cacheReadPerMTok: r.cache_read_per_mtok,
    cacheWritePerMTok: r.cache_write_per_mtok,
    isPlaceholder: r.is_placeholder === 1
  }
}
