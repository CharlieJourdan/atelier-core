// One model call through the spend ledger: reserve the estimate, stream, settle the real cost. A failure is
// refunded only when nothing can have been billed; a refusal or a CLI error result is settled at its reported
// usage, a cancelled or broken call that reached the model at the estimate. Shared by chat turns and task runs.
// Throws BudgetExceededError (nothing booked) and ProviderError as they come.
import type { ResolvedRoute } from '../../shared/api'
import { LedgerError, type Ledger, type LedgerHandle } from '../ledger'
import { ProviderError, type CompletionRequest, type CompletionResult, type Provider, type Usage } from '../llm/types'
import type { RoutesStore } from '../llm/routes'
import type { SettingsStore } from '../settings'

export const TOOL_RUN = {
  /** A tool run takes several turns: it reserves this many times the one-turn estimate. */
  multiplierKey: 'agents.toolRunEstimateMultiplier',
  defaultMultiplier: 4,
  /** Most agentic turns of one tool run (Claude Code `--max-turns`). */
  maxTurnsKey: 'agents.maxTurns',
  defaultMaxTurns: 12
} as const

/** The reservation of a tool run: the one-turn estimate times the configured multiplier (1 to 50, default 4). */
export function toolRunEstimate(settings: SettingsStore, oneTurn: Usage): Usage {
  const v = settings.get<number>(TOOL_RUN.multiplierKey, TOOL_RUN.defaultMultiplier)
  const k = typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 50 ? v : TOOL_RUN.defaultMultiplier
  return {
    inputTokens: Math.ceil(oneTurn.inputTokens * k),
    outputTokens: Math.ceil(oneTurn.outputTokens * k),
    cacheReadTokens: Math.ceil(oneTurn.cacheReadTokens * k),
    cacheWriteTokens: Math.ceil(oneTurn.cacheWriteTokens * k)
  }
}

/** Turn limit passed to the CLI for a tool run (1 to 100, default 12). */
export function toolRunMaxTurns(settings: SettingsStore): number {
  const v = settings.get<number>(TOOL_RUN.maxTurnsKey, TOOL_RUN.defaultMaxTurns)
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100 ? v : TOOL_RUN.defaultMaxTurns
}

export interface Attribution {
  channelId: number | null
  videoId: number | null
  taskId: number | null
}

export interface ModelCallResult {
  result: CompletionResult
  /** What the ledger booked for this call. */
  costUsd: number
}

/** Setting naming the model whose price stands in for an unpriced model while a cap is set (default: balanced tier). */
export const UNPRICED_FALLBACK_KEY = 'agents.unpricedFallbackModel'

/**
 * What an unpriced Claude Code run reserves: with a cap set (global or the channel's), the estimate priced like the
 * fallback model (the balanced tier unless the setting names another), so the cap check bounds the run and a
 * cancelled run is booked at it. Without a cap, or without a price to borrow, $0 (the CLI reports the real cost).
 */
export function unpricedReserveUsd(
  ledger: Ledger,
  settings: SettingsStore,
  routes: RoutesStore,
  channelId: number | null,
  estimate: Usage
): number {
  const capped = ledger.globalCap() !== null || (channelId !== null && ledger.channelCap(channelId) !== null)
  if (!capped) return 0
  const named = settings.get<string>(UNPRICED_FALLBACK_KEY, '')
  const model = typeof named === 'string' && named ? named : routes.tierModels().balanced
  try {
    return ledger.estimate(model, estimate)
  } catch {
    return 0
  }
}

/**
 * Reserves the estimate for a route; an unpriced model is allowed on Claude Code only (the CLI reports its cost),
 * reserving `unpricedUsd` (default $0).
 */
export function reserveFor(
  ledger: Ledger,
  route: ResolvedRoute,
  estimate: Usage,
  who: Attribution,
  unpricedUsd = 0
): LedgerHandle {
  const base = { providerId: route.providerId, model: route.model, ...who }
  try {
    return ledger.reserve({ ...base, estimate })
  } catch (err) {
    if (err instanceof LedgerError && err.code === 'UNKNOWN_MODEL' && route.providerId === 'claude-code') {
      return ledger.reserve({ ...base, estimate: { usd: unpricedUsd } })
    }
    if (err instanceof LedgerError && err.code === 'UNKNOWN_MODEL') {
      throw new Error(
        `No price is set for ${route.model}, so its cost cannot be tracked. Add it in Settings > Models & prices.`,
        { cause: err }
      )
    }
    throw err
  }
}

/** Streams a reserved call; `onText` gets the deltas. Settles or releases `handle` in every case. */
export async function runReserved(
  ledger: Ledger,
  handle: LedgerHandle,
  provider: Provider,
  request: CompletionRequest,
  onText?: (delta: string) => void,
  signal?: AbortSignal,
  /** Told what was booked when the call fails after it may have been billed (the group chat's round budget). */
  onBookedOnError?: (usd: number) => void
): Promise<ModelCallResult> {
  let final: CompletionResult | null = null
  let text = ''
  const started = Date.now()
  try {
    for await (const ev of provider.stream(request, signal ? { signal } : {})) {
      if (ev.type === 'text') {
        text += ev.text
        onText?.(ev.text)
      } else {
        final = ev.result
      }
    }
    if (!final) throw new ProviderError('The model returned no result', 'BAD_OUTPUT')
  } catch (err) {
    // A refusal or a CLI error result is a completed, billed call: book its usage instead of refunding.
    // Settle first, then report: `f?.(settle())` would skip the settle when there is no listener.
    let booked: number | null = null
    if (err instanceof ProviderError && err.usage) booked = ledger.settle(handle, err.usage, { costUsd: err.costUsd, durationMs: Date.now() - started })
    else if (mayHaveBilled(err, text)) booked = ledger.settleAtEstimate(handle)
    else ledger.release(handle)
    if (booked !== null) onBookedOnError?.(booked)
    throw err
  }
  const costUsd = ledger.settle(handle, final.usage, { costUsd: final.costUsd, durationMs: Date.now() - started })
  return { result: final.text ? final : { ...final, text }, costUsd }
}

/**
 * True when a failed call without reported usage may still have been billed: the provider says it reached the
 * model (a CLI that died after silent tool turns), it was cancelled after it started, or text came back.
 */
function mayHaveBilled(err: unknown, text: string): boolean {
  if (err instanceof ProviderError && err.reached !== null) return err.reached
  if (err instanceof ProviderError && err.code === 'ABORTED') return true
  return text.length > 0
}
