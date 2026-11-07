// The app's « mon abonnement » provider outside the agent turns (chat, one-shot asks, the engine's script nodes, the
// director on the subscription): each call runs on the account pool's best working subscription account (a Claude Code
// login with its own config folder, a Codex login), never on a login the user did not connect. A dead login marks the
// account « à reconnecter » and a usage limit marks it limited, and the same call moves at once to the next account;
// when none is left the call fails with the French « locked » error (decision 0038). Counts in the pool's load.
import { lockedError } from '../llm/access'
import type { AgentTools, CallOptions, CompletionRequest, CompletionResult, Provider, StreamEvent } from '../llm/types'
import { TIERS, type Tier } from '../../shared/roles'
import type { AccountPool, AccountRecord } from './accounts'
import { detectAuthFailure, detectLimit } from './limits'

export interface SubscriptionProviderDeps {
  pool: () => AccountPool | null
  /** The tier map (Réglages › Claude et modèles): a request's model tells its tier. */
  tierModels: () => Record<Tier, string>
  now?: () => number
}

export class SubscriptionProvider implements Provider {
  readonly id = 'claude-code'
  private readonly deps: SubscriptionProviderDeps

  constructor(deps: SubscriptionProviderDeps) {
    this.deps = deps
  }

  acceptsTools(tools: AgentTools): boolean {
    // tools reach Claude Code through the MCP bridge; the account chosen at call time is a Claude Code one first
    const a = this.deps.pool()?.pick('balanced')
    return a ? this.deps.pool()?.provider(a).acceptsTools?.(tools) === true : false
  }

  async complete(req: CompletionRequest, opts?: CallOptions): Promise<CompletionResult> {
    let result: CompletionResult | null = null
    for await (const ev of this.stream(req, opts)) if (ev.type === 'done') result = ev.result
    if (!result) throw lockedError()
    return result
  }

  async *stream(req: CompletionRequest, opts?: CallOptions): AsyncGenerator<StreamEvent> {
    const pool = this.deps.pool()
    if (!pool) throw lockedError()
    const tierModels = this.deps.tierModels()
    const tier = TIERS.find((x) => tierModels[x] === req.model) ?? 'balanced'
    const tried = new Set<number>()
    for (;;) {
      const account = pool.pick(tier, tried) ?? pool.usableSubscriptions().find((a) => !tried.has(a.id) && a.tiers.includes(tier)) ?? null
      if (!account) throw lockedError()
      tried.add(account.id)
      let yielded = false
      pool.acquire(account.id)
      try {
        for await (const ev of pool.provider(account).stream(this.request(account, tier, tierModels, req), opts)) {
          yielded = true
          yield ev
        }
        pool.recordCall(account.id, true)
        return
      } catch (err) {
        if (yielded || !this.markIfDead(pool, account, err)) {
          pool.recordCall(account.id, false)
          throw err
        }
      } finally {
        pool.release(account.id)
      }
    }
  }

  /** A Codex account answers with its own model. */
  private request(a: AccountRecord, tier: Tier, tierModels: Record<Tier, string>, req: CompletionRequest): CompletionRequest {
    const model = a.kind === 'codex' ? this.deps.pool()?.modelFor(a, tier, tierModels, req.model) : undefined
    return model && model !== req.model ? { ...req, model } : req
  }

  /** A dead login or a usage limit: the account is marked and the call moves on. */
  private markIfDead(pool: AccountPool, a: AccountRecord, err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err)
    const hit = detectLimit(message, this.deps.now?.() ?? Date.now())
    if (hit) {
      pool.markLimited(a.id, hit)
      return true
    }
    const auth = detectAuthFailure(message)
    if (auth) {
      pool.markNeedsLogin(a.id, auth)
      return true
    }
    return false
  }
}
