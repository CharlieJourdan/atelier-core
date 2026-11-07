// Price grid version 1: one item per usage. Every figure is a placeholder (hypothesis) until the real providers are
// priced in lots P13/P14; Charlie changes them with `atelier-cloud admin price set` or POST /v1/admin/prices.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'default_prices'

/** One cloned voice: the provider's one-off fee (MiniMax USD 1.50, docs/PROVIDERS.md), charged once per voice. No reference
 *  price (no one sells a single clone to compare with); migration 006 adds this item to grids made before it existed. */
export const VOICE_CLONE_ITEM = {
  item: 'voice.clone',
  usage: 'cloneVoice',
  unit: 'voice',
  providerCostUsd: 1.5,
  referenceEur: null,
  pricing: { mode: 'percent', marginPct: 10 }
} as const

export const DEFAULT_GRID = {
  creditValueEur: 0.01,
  usdToEur: 0.92,
  overheadPct: 5,
  note: 'v2 placeholders (hypothesis), all providers in demo',
  items: [
    { item: 'voice.chars', usage: 'synthesize', unit: 'char', providerCostUsd: 0.00018, referenceEur: 0.00022, pricing: { mode: 'percent', marginPct: 10 } },
    { item: 'image.count', usage: 'generateImage', unit: 'image', providerCostUsd: 0.02, referenceEur: 0.04, pricing: { mode: 'percent', marginPct: 25 } },
    { item: 'video.seconds', usage: 'generateVideo', unit: 'second', providerCostUsd: 0.05, referenceEur: 0.1, pricing: { mode: 'percent', marginPct: 25 } },
    { item: 'avatar.seconds', usage: 'talkingAvatar', unit: 'second', providerCostUsd: 0.02, referenceEur: 0.05, pricing: { mode: 'percent', marginPct: 25 } },
    { item: 'channel.request', usage: 'channelData', unit: 'request', providerCostUsd: 0, referenceEur: null, pricing: { mode: 'percent', marginPct: 0 } },
    { item: 'analysis.minutes', usage: 'analyseVideo', unit: 'minute', providerCostUsd: 0.01, referenceEur: 0.012, pricing: { mode: 'percent', marginPct: 5 } },
    { item: 'gpu.seconds', usage: 'submitGpuJob', unit: 'gpu-second', providerCostUsd: 0.00031, referenceEur: null, pricing: { mode: 'percent', marginPct: 25 } },
    VOICE_CLONE_ITEM
  ]
} as const

export function up(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO price_grids (version, credit_value_eur, usd_to_eur, overhead_pct, note, items_json, created_at, created_by)
     VALUES (1, ?, ?, ?, ?, ?, ?, 'migration')`
  ).run(
    DEFAULT_GRID.creditValueEur,
    DEFAULT_GRID.usdToEur,
    DEFAULT_GRID.overheadPct,
    DEFAULT_GRID.note,
    JSON.stringify(DEFAULT_GRID.items),
    new Date(0).toISOString()
  )
}
