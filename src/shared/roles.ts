// Agent roles (SPEC § Rôles) and model tiers. Shared by main and renderer.

export const TIERS = ['best', 'balanced', 'fast'] as const
export type Tier = (typeof TIERS)[number]

export const ROLE_GROUPS = ['steering', 'production', 'operations'] as const
export type RoleGroup = (typeof ROLE_GROUPS)[number]

export interface RoleDefinition {
  role: string
  group: RoleGroup
  defaultTier: Tier
  /** Name shown to Charlie (French), also the `@` mention name. */
  name: string
}

/**
 * The built-in roles (v2, lot 13): the 22 of v1, the 3 production roles of PLAN-V2 §5.1 (the engine operator is the
 * "Opérateur production" of PLAN-V2-PRODUCTION §6.3) and the Analyste and Réalisateur of PLAN-V2-PRODUCTION §6.3.
 * The order is fixed: it gives each agent its colour (`agentIndex`), so new roles go at the end.
 */
export const ROLES: readonly RoleDefinition[] = [
  // Steering and strategy
  { role: 'supervisor', group: 'steering', defaultTier: 'best', name: 'Superviseur' },
  { role: 'channel_strategist', group: 'steering', defaultTier: 'best', name: 'Stratège de niche' },
  { role: 'trend_scout', group: 'steering', defaultTier: 'fast', name: 'Éclaireur d’outliers' },
  { role: 'ideation_lead', group: 'steering', defaultTier: 'balanced', name: 'Responsable idées' },
  { role: 'packaging', group: 'steering', defaultTier: 'balanced', name: 'Stratège packaging' },
  { role: 'competitor_analyst', group: 'steering', defaultTier: 'balanced', name: 'Analyste concurrence' },
  { role: 'seo_researcher', group: 'steering', defaultTier: 'fast', name: 'Spécialiste SEO' },
  // Production
  { role: 'researcher', group: 'production', defaultTier: 'balanced', name: 'Recherchiste' },
  { role: 'scriptwriter', group: 'production', defaultTier: 'best', name: 'Scénariste' },
  { role: 'sponsor_writer', group: 'production', defaultTier: 'balanced', name: 'Rédacteur sponsor' },
  { role: 'voiceover', group: 'production', defaultTier: 'fast', name: 'Voix off' },
  { role: 'video_producer', group: 'production', defaultTier: 'balanced', name: 'Monteur' },
  { role: 'thumbnail_designer', group: 'production', defaultTier: 'balanced', name: 'Designer miniatures' },
  { role: 'thumbnail_tester', group: 'production', defaultTier: 'fast', name: 'Testeur A/B' },
  { role: 'metadata', group: 'production', defaultTier: 'fast', name: 'Rédacteur SEO' },
  { role: 'qc', group: 'production', defaultTier: 'balanced', name: 'Contrôle qualité' },
  // Distribution and operations
  { role: 'publisher', group: 'operations', defaultTier: 'fast', name: 'Préparateur d’upload' },
  { role: 'analytics_analyst', group: 'operations', defaultTier: 'balanced', name: 'Analyste audience' },
  { role: 'product_builder', group: 'operations', defaultTier: 'balanced', name: 'Produits et offres' },
  { role: 'production_coordinator', group: 'operations', defaultTier: 'fast', name: 'Chef de production' },
  { role: 'budget_controller', group: 'operations', defaultTier: 'fast', name: 'Contrôleur budget' },
  { role: 'freelancer_manager', group: 'operations', defaultTier: 'fast', name: 'Gestion freelances' },
  // v2 production roles
  { role: 'engine_operator', group: 'operations', defaultTier: 'balanced', name: 'Opérateur production' },
  { role: 'art_director', group: 'production', defaultTier: 'balanced', name: 'Directeur artistique' },
  { role: 'revenue_manager', group: 'operations', defaultTier: 'balanced', name: 'Responsable revenus' },
  { role: 'analyst', group: 'steering', defaultTier: 'balanced', name: 'Analyste' },
  { role: 'director', group: 'production', defaultTier: 'best', name: 'Réalisateur' }
]

/** French display name of a built-in role (the id, made readable, for an unknown one). */
export function roleName(role: string): string {
  return ROLES.find((r) => r.role === role)?.name ?? role.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export const DEFAULT_TIER_MODELS: Readonly<Record<Tier, string>> = {
  best: 'claude-opus-5-5',
  balanced: 'claude-sonnet-5-5',
  fast: 'claude-haiku-5-5'
}

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value)
}
