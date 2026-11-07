// One model call of the runtime on one account, through the existing spend ledger (reserve → stream → settle, the same
// `runReserved` as chat turns and task runs), attributed to the account and the runtime task. Subscription accounts
// (Claude Code, Codex, the relay) whose model has no price reserve $0 and settle at the cost the CLI reports (Claude
// Code) or at the price table; the API key is always priced.
import type { Tier } from '../../shared/roles'
import { runReserved } from '../agents/call'
import { LedgerError, type LedgerHandle } from '../ledger'
import type { AgentTools, CliSession, CompletionRequest, Usage } from '../llm/types'
import { isSubscription, ledgerProviderId, type AccountRecord } from './accounts'
import type { RuntimeParts } from './parts'
import { estimateTokens } from './util'

export interface CallInput {
  account: AccountRecord
  tier: Tier
  effort: CompletionRequest['effort']
  pinnedModel: string | null
  system: string
  prompt: string
  channelId: number | null
  videoId: number | null
  orchTaskId: number | null
  session?: CliSession
  maxTokens?: number
  signal?: AbortSignal
  /** Called on every streamed delta (the heartbeat). */
  onActivity?: () => void
  /** The agent's technologies for this turn (only sent when the account's provider can offer them). */
  tools?: AgentTools
  maxTurns?: number
}

export interface CallOutput {
  text: string
  model: string
  sessionId: string | null
  usage: Usage
  costUsd: number
}

/** Kinds whose CLI keeps a session we can resume. */
export function supportsSessions(account: AccountRecord): boolean {
  return account.kind === 'claude-code' || account.kind === 'codex'
}

export async function callModel(parts: RuntimeParts, input: CallInput): Promise<CallOutput> {
  const { account } = input
  const model = parts.accounts.modelFor(account, input.tier, parts.tierModels(), input.pinnedModel)
  const providerId = ledgerProviderId(account.kind)
  const estimate: Usage = {
    inputTokens: estimateTokens(input.system + input.prompt),
    outputTokens: Math.min(input.maxTokens ?? 4000, 4000),
    cacheReadTokens: 0,
    cacheWriteTokens: 0
  }
  const channelId = input.channelId !== null && parts.db.prepare('SELECT 1 FROM channels WHERE id = ?').get(input.channelId) ? input.channelId : null
  const base = { providerId, model, channelId, videoId: input.videoId, accountId: account.id, orchTaskId: input.orchTaskId }
  let handle: LedgerHandle
  try {
    handle = parts.ledger.reserve({ ...base, estimate })
  } catch (err) {
    if (!(err instanceof LedgerError && err.code === 'UNKNOWN_MODEL' && isSubscription(account.kind))) throw err
    handle = parts.ledger.reserve({ ...base, estimate: { usd: 0 } })
  }
  const request: CompletionRequest = {
    model,
    system: input.system,
    prompt: input.prompt,
    maxTokens: input.maxTokens ?? 8000,
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.session ? { session: input.session } : {})
  }
  const provider = parts.accounts.provider(account)
  if (input.tools && input.tools.specs.length > 0 && provider.acceptsTools?.(input.tools) === true) {
    request.tools = input.tools
    if (input.maxTurns !== undefined) request.maxTurns = input.maxTurns
  }
  const { result, costUsd } = await runReserved(parts.ledger, handle, provider, request, () => input.onActivity?.(), input.signal)
  return { text: result.text, model: result.model || model, sessionId: result.sessionId, usage: result.usage, costUsd }
}
