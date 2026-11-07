// Model routing for cost: each task kind goes to a tier (fast = Haiku, balanced = Sonnet, best = Opus) with an effort
// hint. Precedence: the agent's policy for that kind > the agent's policy > the workspace table (setting
// `orchestra.routing`, `{ kind: { tier, effort } }`) > the built-in table > balanced / medium. The tier's model comes
// from the existing tier map (`llm.tierModels`, Réglages › Claude et modèles), unless the agent names a model or the
// account maps the tier to its own model (Codex).
import type { Effort } from '../../shared/api/core'
import { EFFORTS } from '../../shared/api/core'
import type { OrchModelPolicy } from '../../shared/api/orchestra'
import { isTier, type Tier } from '../../shared/roles'
import type { SettingsStore } from '../settings'
import { isRecord } from './util'

export interface Route {
  tier: Tier
  effort: Effort
  /** A model the agent pins, if any. */
  model: string | null
  /** Where the decision came from (shown in events and tests). */
  source: 'agent-kind' | 'agent' | 'workspace' | 'built-in' | 'default'
}

/** The built-in table (docs/AGENT-RUNTIME.md § Routing). */
export const ROUTING_TABLE: Readonly<Record<string, { tier: Tier; effort: Effort }>> = {
  // cheap: triage, summaries, checks, chat replies
  triage: { tier: 'fast', effort: 'low' },
  summary: { tier: 'fast', effort: 'low' },
  compaction: { tier: 'fast', effort: 'low' },
  qc_check: { tier: 'fast', effort: 'low' },
  digest: { tier: 'fast', effort: 'medium' },
  mention: { tier: 'fast', effort: 'low' },
  approval: { tier: 'fast', effort: 'low' },
  followup: { tier: 'fast', effort: 'low' },
  publish_package: { tier: 'fast', effort: 'low' },
  // most of the work
  plan: { tier: 'balanced', effort: 'medium' },
  topics: { tier: 'balanced', effort: 'medium' },
  research: { tier: 'balanced', effort: 'medium' },
  competitor_scan: { tier: 'balanced', effort: 'medium' },
  packaging: { tier: 'balanced', effort: 'medium' },
  production: { tier: 'balanced', effort: 'medium' },
  sponsors: { tier: 'balanced', effort: 'medium' },
  task: { tier: 'balanced', effort: 'medium' },
  // only where quality pays for itself
  script: { tier: 'best', effort: 'high' },
  architecture: { tier: 'best', effort: 'high' },
  review: { tier: 'best', effort: 'medium' }
}

export const ROUTING_SETTING = 'orchestra.routing'

export class Router {
  private readonly settings: SettingsStore

  constructor(settings: SettingsStore) {
    this.settings = settings
  }

  /** The workspace overrides, checked (unknown tiers or efforts are ignored). */
  workspaceTable(): Record<string, { tier?: Tier; effort?: Effort }> {
    const raw = this.settings.get(ROUTING_SETTING, {})
    const out: Record<string, { tier?: Tier; effort?: Effort }> = {}
    if (!isRecord(raw)) return out
    for (const [kind, v] of Object.entries(raw)) {
      if (!isRecord(v)) continue
      const tier = isTier(v.tier) ? v.tier : undefined
      const effort = (EFFORTS as readonly unknown[]).includes(v.effort) ? (v.effort as Effort) : undefined
      if (tier || effort) out[kind] = { ...(tier ? { tier } : {}), ...(effort ? { effort } : {}) }
    }
    return out
  }

  resolve(kind: string, policy: OrchModelPolicy = {}): Route {
    const builtIn = ROUTING_TABLE[kind]
    const ws = this.workspaceTable()[kind]
    const agentKind = policy.kinds?.[kind]
    const pick = <K extends 'tier' | 'effort'>(key: K): { value: Route[K]; source: Route['source'] } => {
      if (agentKind?.[key]) return { value: agentKind[key] as Route[K], source: 'agent-kind' }
      if (policy[key]) return { value: policy[key] as Route[K], source: 'agent' }
      if (ws?.[key]) return { value: ws[key] as Route[K], source: 'workspace' }
      if (builtIn) return { value: builtIn[key] as Route[K], source: 'built-in' }
      return { value: (key === 'tier' ? 'balanced' : 'medium') as Route[K], source: 'default' }
    }
    const tier = pick('tier')
    const effort = pick('effort')
    return { tier: tier.value, effort: effort.value, model: policy.model ?? null, source: tier.source }
  }
}
