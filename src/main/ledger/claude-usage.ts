// What the user's Claude Code subscription served, read from the ledger (usage-claude): tokens, API-equivalent cost
// (Claude Code's own `total_cost_usd`, never money Atelier charges) and time, for one video or for the last 7 days.
import type { ClaudeUsage, ClaudeUsageModel, ClaudeUsageScope } from '../../shared/api'
import type { Db } from '../db'

const PROVIDER = 'claude-code'
const WEEK_MS = 7 * 24 * 3600 * 1000

interface Row {
  model: string
  calls: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
  ms: number
}

export function claudeUsage(db: Db, scope: ClaudeUsageScope, now: Date): ClaudeUsage {
  const where =
    'videoId' in scope ? 'video_id = ?' : 'created_at >= ?'
  const arg = 'videoId' in scope ? scope.videoId : new Date(now.getTime() - WEEK_MS).toISOString()
  const rows = db
    .prepare(
      `SELECT model, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(cache_read_tokens) AS cacheRead, SUM(cache_write_tokens) AS cacheWrite,
              SUM(amount_usd) AS usd, COALESCE(SUM(duration_ms), 0) AS ms
       FROM ledger WHERE provider_id = ? AND status = 'settled' AND ${where}
       GROUP BY model ORDER BY model`
    )
    .all(PROVIDER, arg) as unknown as Row[]
  const byModel: ClaudeUsageModel[] = rows.map((r) => ({
    model: r.model,
    calls: r.calls,
    inputTokens: r.input,
    outputTokens: r.output,
    cacheReadTokens: r.cacheRead,
    cacheWriteTokens: r.cacheWrite,
    apiEquivalentUsd: r.usd,
    durationMs: r.ms
  }))
  const sum = (f: (m: ClaudeUsageModel) => number): number => byModel.reduce((a, m) => a + f(m), 0)
  const inputTokens = sum((m) => m.inputTokens)
  const outputTokens = sum((m) => m.outputTokens)
  const cacheReadTokens = sum((m) => m.cacheReadTokens)
  const cacheWriteTokens = sum((m) => m.cacheWriteTokens)
  return {
    calls: sum((m) => m.calls),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    apiEquivalentUsd: sum((m) => m.apiEquivalentUsd),
    durationMs: sum((m) => m.durationMs),
    byModel
  }
}
