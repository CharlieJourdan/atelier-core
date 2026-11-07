// Role → tier → model resolution. Tier models and the default provider live in settings; a route may
// override the provider and/or the model for one role.
import { EFFORTS, PROVIDER_IDS, type Effort, type ProviderId, type ResolvedRoute, type RoutePatch, type RouteRow } from '../../shared/api'
import { DEFAULT_TIER_MODELS, isTier, ROLES, type RoleGroup, type Tier } from '../../shared/roles'
import type { Db } from '../db'
import type { SettingsStore } from '../settings'

interface RouteDbRow {
  role: string
  tier: Tier
  provider_id: ProviderId | null
  model: string | null
  effort: Effort | null
}

const MODEL_RE = /^[A-Za-z0-9._:[\]-]{1,100}$/

export class RoutesStore {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsStore
  ) {}

  defaultProvider(): ProviderId {
    const v = this.settings.get<string>('llm.defaultProvider', 'claude-code')
    return isProviderId(v) ? v : 'claude-code'
  }

  setDefaultProvider(id: ProviderId): void {
    assertProvider(id)
    this.settings.set('llm.defaultProvider', id)
  }

  tierModels(): Record<Tier, string> {
    const stored = this.settings.get<Record<string, string>>('llm.tierModels', { ...DEFAULT_TIER_MODELS })
    return {
      best: stored.best ?? DEFAULT_TIER_MODELS.best,
      balanced: stored.balanced ?? DEFAULT_TIER_MODELS.balanced,
      fast: stored.fast ?? DEFAULT_TIER_MODELS.fast
    }
  }

  setTierModel(tier: Tier, model: string): void {
    if (!isTier(tier)) throw new Error(`Unknown tier: ${String(tier)}`)
    assertModel(model)
    this.settings.set('llm.tierModels', { ...this.tierModels(), [tier]: model })
  }

  list(): RouteRow[] {
    const rows = this.db.prepare('SELECT role, tier, provider_id, model, effort FROM routes').all() as unknown as RouteDbRow[]
    const byRole = new Map(rows.map((r) => [r.role, r]))
    const known = ROLES.map((def) => toRow(byRole.get(def.role) ?? defaultRow(def.role, def.defaultTier), def.group))
    const extra = rows.filter((r) => !ROLES.some((d) => d.role === r.role)).map((r) => toRow(r, 'operations'))
    return [...known, ...extra]
  }

  get(role: string): RouteRow | null {
    return this.list().find((r) => r.role === role) ?? null
  }

  set(role: string, patch: RoutePatch): RouteRow {
    const current = this.get(role)
    if (!current) throw new Error(`Unknown role: ${role}`)
    const tier = patch.tier ?? current.tier
    if (!isTier(tier)) throw new Error(`Unknown tier: ${String(tier)}`)
    const providerId = patch.providerId === undefined ? current.providerId : patch.providerId
    if (providerId !== null) assertProvider(providerId)
    const model = patch.model === undefined ? current.model : patch.model || null
    if (model !== null) assertModel(model)
    const effort = patch.effort === undefined ? current.effort : patch.effort
    if (effort !== null && !EFFORTS.includes(effort)) throw new Error(`Unknown effort: ${String(effort)}`)
    this.db
      .prepare(
        `INSERT INTO routes (role, tier, provider_id, model, effort, updated_at)
         VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(role) DO UPDATE SET tier = excluded.tier, provider_id = excluded.provider_id,
           model = excluded.model, effort = excluded.effort, updated_at = excluded.updated_at`
      )
      .run(role, tier, providerId, model, effort)
    return { ...current, tier, providerId, model, effort }
  }

  /** The provider and model a role's calls go to. Unknown roles fall back to the balanced tier. */
  resolve(role: string): ResolvedRoute {
    const route = this.get(role)
    const tier: Tier = route?.tier ?? 'balanced'
    return {
      role,
      tier,
      providerId: route?.providerId ?? this.defaultProvider(),
      model: route?.model ?? this.tierModels()[tier],
      effort: route?.effort ?? null
    }
  }
}

function defaultRow(role: string, tier: Tier): RouteDbRow {
  return { role, tier, provider_id: null, model: null, effort: null }
}

function toRow(r: RouteDbRow, group: RoleGroup): RouteRow {
  return { role: r.role, group, tier: r.tier, providerId: r.provider_id, model: r.model, effort: r.effort }
}

function isProviderId(v: unknown): v is ProviderId {
  return typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v)
}

function assertProvider(id: unknown): asserts id is ProviderId {
  if (!isProviderId(id)) throw new Error(`Unknown provider: ${String(id)}`)
}

function assertModel(model: string): void {
  if (!MODEL_RE.test(model)) throw new Error(`Invalid model id: ${JSON.stringify(model)}`)
}
