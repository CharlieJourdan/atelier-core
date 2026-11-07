// Default providers, prices and routes. Values are frozen here (not imported) so that this migration keeps
// meaning the same thing forever; later changes go in a new migration.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'seed_defaults'

// Placeholder prices in USD per million tokens. Shown as "placeholder" in Settings until edited.
const PRICES: [model: string, tier: string, input: number, output: number, cacheRead: number, cacheWrite: number][] = [
  ['claude-opus-5-5', 'best', 15, 75, 1.5, 18.75],
  ['claude-sonnet-5-5', 'balanced', 3, 15, 0.3, 3.75],
  ['claude-haiku-5-5', 'fast', 1, 5, 0.1, 1.25]
]

const ROUTES: [role: string, tier: string][] = [
  ['supervisor', 'best'],
  ['channel_strategist', 'best'],
  ['trend_scout', 'fast'],
  ['ideation_lead', 'balanced'],
  ['packaging', 'balanced'],
  ['competitor_analyst', 'balanced'],
  ['seo_researcher', 'fast'],
  ['researcher', 'balanced'],
  ['scriptwriter', 'best'],
  ['sponsor_writer', 'balanced'],
  ['voiceover', 'fast'],
  ['video_producer', 'balanced'],
  ['thumbnail_designer', 'balanced'],
  ['thumbnail_tester', 'fast'],
  ['metadata', 'fast'],
  ['qc', 'balanced'],
  ['publisher', 'fast'],
  ['analytics_analyst', 'balanced'],
  ['product_builder', 'balanced'],
  ['production_coordinator', 'fast'],
  ['budget_controller', 'fast'],
  ['freelancer_manager', 'fast']
]

export function up(db: DatabaseSync): void {
  const provider = db.prepare('INSERT INTO providers (id, kind, label) VALUES (?, ?, ?)')
  provider.run('claude-code', 'claude_code', 'Claude Code (subscription)')
  provider.run('anthropic', 'anthropic', 'Anthropic API')

  // Prices are per model; the same Claude model ids are billed through both providers, so the price rows
  // are attached to the API provider (the Claude Code CLI reports its own cost per call).
  const price = db.prepare(
    `INSERT INTO prices (model, provider_id, tier, input_per_mtok, output_per_mtok, cache_read_per_mtok,
                         cache_write_per_mtok, is_placeholder) VALUES (?, 'anthropic', ?, ?, ?, ?, ?, 1)`
  )
  for (const row of PRICES) price.run(...row)

  const route = db.prepare('INSERT INTO routes (role, tier) VALUES (?, ?)')
  for (const row of ROUTES) route.run(...row)

  const setting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  setting.run('llm.defaultProvider', JSON.stringify('claude-code'))
  setting.run(
    'llm.tierModels',
    JSON.stringify({ best: 'claude-opus-5-5', balanced: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' })
  )
}
