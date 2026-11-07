// IPC contract, module "spend": The spend ledger: overview, summaries, entries and caps.

export const SPEND_GROUPS = ['provider', 'model', 'channel', 'video', 'day'] as const
export type SpendGroup = (typeof SPEND_GROUPS)[number]

export interface SpendChannelRow {
  channelId: number
  name: string
  spentUsd: number
  reservedUsd: number
  /** Monthly cap in USD, null = no cap. */
  budgetUsd: number | null
}

export interface SpendOverview {
  /** UTC month, `YYYY-MM`. */
  month: string
  spentUsd: number
  reservedUsd: number
  calls: number
  /** Global monthly cap in USD, null = no cap. */
  globalCapUsd: number | null
  channels: SpendChannelRow[]
}

export interface SpendSummaryRow {
  key: string
  label: string
  spentUsd: number
  calls: number
  inputTokens: number
  outputTokens: number
}

export interface SpendEntry {
  id: number
  createdAt: string
  providerId: string
  model: string
  channelId: number | null
  channelName: string | null
  videoId: number | null
  videoTitle: string | null
  /** `adjustment`: a correction of a settled entry (measured engine cost); its amount may be negative. */
  status: 'reserved' | 'settled' | 'refunded' | 'adjustment'
  estimateUsd: number
  amountUsd: number
  inputTokens: number
  outputTokens: number
}

/** What to total: one video, or the last 7 days. */
export type ClaudeUsageScope = { videoId: number } | { lastWeek: true }

export interface ClaudeUsageModel {
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** What the same tokens would cost on the Anthropic API (Claude Code's own figure): not money Atelier charges. */
  apiEquivalentUsd: number
  durationMs: number
}

/** What the user's Claude Code subscription served (settled calls of the `claude-code` provider). */
export interface ClaudeUsage extends Omit<ClaudeUsageModel, 'model'> {
  totalTokens: number
  byModel: ClaudeUsageModel[]
}

export interface SpendContract {
  'spend.overview': { args: [month?: string]; result: SpendOverview }

  'spend.summary': { args: [group: SpendGroup, month?: string]; result: SpendSummaryRow[] }

  'spend.entries': { args: [month?: string, limit?: number]; result: SpendEntry[] }

  'spend.claudeUsage': { args: [scope: ClaudeUsageScope]; result: ClaudeUsage }

  'spend.setGlobalCap': { args: [usd: number | null]; result: void }

  'spend.setChannelCap': { args: [channelId: number, usd: number | null]; result: void }
}

export const SPEND_METHODS = [
  'spend.overview',
  'spend.summary',
  'spend.entries',
  'spend.claudeUsage',
  'spend.setGlobalCap',
  'spend.setChannelCap'
] as const satisfies readonly (keyof SpendContract)[]
