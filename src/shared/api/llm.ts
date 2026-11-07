// IPC contract, module "llm": Providers, default models, routes (role to model) and prices.
import type { RoleGroup, Tier } from '../roles'
import type { Effort, ProviderId } from './core'

export interface ProviderInfo {
  id: ProviderId
  kind: 'claude_code' | 'anthropic'
  label: string
  enabled: boolean
  /** null when the provider needs no key (Claude Code uses the CLI's own login). */
  keySet: boolean | null
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  latencyMs: number
}

export interface RouteRow {
  role: string
  group: RoleGroup
  tier: Tier
  /** Explicit provider for this role, or null to use the default provider. */
  providerId: ProviderId | null
  /** Explicit model id for this role, or null to use the tier's model. */
  model: string | null
  /** Explicit reasoning effort (Anthropic API), or null for the model's default. */
  effort: Effort | null
}

export interface ResolvedRoute {
  role: string
  tier: Tier
  providerId: ProviderId
  model: string
  /** Explicit effort for this role, or null to let the provider pick the model's default. */
  effort: Effort | null
}

export interface RoutePatch {
  tier?: Tier
  providerId?: ProviderId | null
  model?: string | null
  effort?: Effort | null
}

export interface PriceRow {
  model: string
  providerId: ProviderId
  tier: Tier | 'max' | null
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheWritePerMTok: number
  /** True while the values are the seeded placeholders and were never edited. */
  isPlaceholder: boolean
}

export type PricePatch = Partial<Pick<PriceRow, 'inputPerMTok' | 'outputPerMTok' | 'cacheReadPerMTok' | 'cacheWritePerMTok'>>

export interface LlmDefaults {
  defaultProvider: ProviderId
  tierModels: Record<Tier, string>
}

/** Where the director's Claude calls run (decision 0038): the user's subscription or the Anthropic API key. */
export type DirectorBackend = 'subscription' | 'api'

/** The beta rule on models (decision 0038), as the renderer shows it. */
export interface LlmAccessStatus {
  /** A connected Claude Code / Codex subscription works: the agents and script writing are open. */
  subscription: boolean
  /** Subscription accounts whose sign-in expired in use: « À reconnecter » (Réglages › Claude). */
  reconnect: { id: number; label: string }[]
  /** The director: the user's choice (null = default: the subscription when one works), what it runs on now. */
  director: { choice: DirectorBackend | null; effective: DirectorBackend | null; apiKeySet: boolean }
}

export interface LlmContract {
  'providers.list': { args: []; result: ProviderInfo[] }

  'providers.setKey': { args: [id: ProviderId, key: string]; result: void }

  'providers.clearKey': { args: [id: ProviderId]; result: void }

  'providers.test': { args: [id: ProviderId]; result: ProviderTestResult }

  'llm.defaults': { args: []; result: LlmDefaults }

  'llm.setDefaultProvider': { args: [id: ProviderId]; result: void }

  'llm.setTierModel': { args: [tier: Tier, model: string]; result: void }

  'routes.list': { args: []; result: RouteRow[] }

  'routes.set': { args: [role: string, patch: RoutePatch]; result: RouteRow }

  'routes.resolve': { args: [role: string]; result: ResolvedRoute }

  'prices.list': { args: []; result: PriceRow[] }

  'prices.set': { args: [model: string, patch: PricePatch]; result: PriceRow }

  'llm.access': { args: []; result: LlmAccessStatus }

  /** null: back to the default (the subscription when one works). */
  'llm.setDirectorBackend': { args: [backend: DirectorBackend | null]; result: LlmAccessStatus }
}

export const LLM_METHODS = [
  'providers.list',
  'providers.setKey',
  'providers.clearKey',
  'providers.test',
  'llm.defaults',
  'llm.setDefaultProvider',
  'llm.setTierModel',
  'routes.list',
  'routes.set',
  'routes.resolve',
  'prices.list',
  'prices.set',
  'llm.access',
  'llm.setDirectorBackend'
] as const satisfies readonly (keyof LlmContract)[]
