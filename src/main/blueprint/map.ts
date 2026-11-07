// The published blueprint (src/shared/cloud-api.ts `Blueprint`) onto what the app has: agents → the runtime's roles
// (src/main/orchestra/roles.ts), tiers → the runtime's tiers, free-text routines → cron routines, pipelines → drawings.
// Pure functions, no I/O: everything the seed, the apply diff and the screens need is derived from here.
import type { z } from 'zod'
import type { Blueprint } from '../../shared/cloud-api'
import type { BlueprintAgentView, BlueprintPipelineView, BlueprintStatus, BlueprintStepView, BlueprintTier } from '../../shared/blueprint'
import { guessDrawingKind } from '../../shared/blueprint'
import type { Tier } from '../../shared/roles'
import { CHANNEL_TEAM, PRINCIPAL_TEAM, roleInfo, type SeedNode } from '../orchestra/roles'

export type BlueprintDoc = z.infer<typeof Blueprint>

/** The blueprint agent ids the founder's console ships, and the runtime role each one feeds. */
export const ROLE_TABLE: Readonly<Record<string, string>> = {
  atlas: 'principal',
  'chef-chaine': 'channel_lead',
  sujets: 'researcher',
  scenariste: 'scriptwriter',
  realisateur: 'director',
  monteur: 'video_producer',
  miniatures: 'packaging',
  analyse: 'competitor_analyst',
  qualite: 'qc_eye'
}

/** The blueprint's model tier on the runtime's tier names (the tier map then gives Haiku / Sonnet / Opus). */
export const TIER_TABLE: Readonly<Record<BlueprintTier, Tier>> = { fast: 'fast', balanced: 'balanced', deep: 'best' }

function flatten(nodes: readonly SeedNode[]): string[] {
  return nodes.flatMap((n) => [n.role, ...flatten(n.children ?? [])])
}

/** Every role the runtime seeds (a blueprint id equal to one of them, hyphens or underscores, feeds it directly). */
const SEEDED_ROLES: ReadonlySet<string> = new Set(['principal', 'channel_lead', ...flatten(PRINCIPAL_TEAM), ...flatten(CHANNEL_TEAM)])

/** The runtime role a blueprint agent feeds, or null when the runtime has none for it. */
export function runtimeRoleOf(blueprintId: string): string | null {
  const explicit = ROLE_TABLE[blueprintId]
  if (explicit) return explicit
  const direct = blueprintId.trim().toLowerCase().replace(/-/g, '_')
  return SEEDED_ROLES.has(direct) ? direct : null
}

/* ---------- routines ---------- */

export interface ScheduledRoutine {
  /** The founder's text, kept as the routine's name. */
  name: string
  cron: string
  kind: string
}

const WEEKDAYS: readonly (readonly [RegExp, number])[] = [
  [/\bdimanche/i, 0],
  [/\blundi/i, 1],
  [/\bmardi/i, 2],
  [/\bmercredi/i, 3],
  [/\bjeudi/i, 4],
  [/\bvendredi/i, 5],
  [/\bsamedi/i, 6]
]
const DAILY = /\b(chaque jour|tous les jours|quotidien(?:ne)?|chaque matin|chaque soir|par jour)\b/i
const HOUR = /\b(\d{1,2})\s?(?:h|:)\s?(\d{2})?(?!\d)/i
const DEFAULT_WEEKLY_HOUR = 9
const DEFAULT_DAILY_HOUR = 8

/** The kind of task a routine of this role enqueues. */
function routineKind(role: string): string {
  return role === 'principal' ? 'digest' : roleInfo(role).defaultKind
}

/**
 * A French routine sentence as a cron schedule: « Point du matin à 8 h » (every day 08:00), « Chercher 10 sujets chaque
 * lundi » (Monday 09:00), « … chaque jour » (08:00). A sentence with no time of its own (« avant chaque publication »)
 * is not scheduled: null (it stays a rule in the agent's instructions).
 */
export function parseRoutine(text: string, role: string): ScheduledRoutine | null {
  const days = WEEKDAYS.filter(([re]) => re.test(text)).map(([, d]) => d)
  const hour = HOUR.exec(text)
  const daily = DAILY.test(text)
  if (days.length === 0 && !daily && !hour) return null
  let h = days.length > 0 ? DEFAULT_WEEKLY_HOUR : DEFAULT_DAILY_HOUR
  let m = 0
  if (hour) {
    const hh = Number(hour[1])
    const mm = hour[2] ? Number(hour[2]) : 0
    if (hh > 23 || mm > 59) return null
    h = hh
    m = mm
  }
  const dow = days.length > 0 ? [...new Set(days)].sort((a, b) => a - b).join(',') : '*'
  return { name: text.trim().slice(0, 120), cron: `${m} ${h} * * ${dow}`, kind: routineKind(role) }
}

/** The instructions an agent seeded from the blueprint gets: the founder's text, then the routines that have no schedule. */
export function instructionsOf(agent: Pick<BlueprintDoc['agents'][number], 'instructions' | 'routines'>, role: string): string {
  const rules = agent.routines.filter((r) => r.trim() && !parseRoutine(r, role))
  const base = agent.instructions.trim()
  if (rules.length === 0) return base
  return `${base}${base ? '\n\n' : ''}Routines :\n${rules.map((r) => `- ${r.trim()}`).join('\n')}`
}

/* ---------- agents ---------- */

/** What a new agent of one runtime role starts from. */
export interface RoleDefault {
  blueprintId: string
  role: string
  instructions: string
  tier: Tier
  routines: ScheduledRoutine[]
}

export type SeedDefaults = ReadonlyMap<string, RoleDefault>

export interface MappedBlueprint {
  /** By runtime role. */
  defaults: Map<string, RoleDefault>
  agents: BlueprintAgentView[]
  recruitable: BlueprintAgentView[]
}

export function mapAgents(bp: BlueprintDoc): MappedBlueprint {
  const defaults = new Map<string, RoleDefault>()
  const agents: BlueprintAgentView[] = []
  const recruitable: BlueprintAgentView[] = []
  for (const a of bp.agents) {
    const role = runtimeRoleOf(a.id)
    const view = { id: a.id, role: a.role, tier: a.tier, routines: [...a.routines], instructions: a.instructions }
    // two blueprint agents on one runtime role: the first feeds it, the other is offered as a template
    if (role === null || defaults.has(role)) {
      recruitable.push({ ...view, runtimeRole: null })
      continue
    }
    defaults.set(role, {
      blueprintId: a.id,
      role,
      instructions: instructionsOf(a, role) || roleInfo(role).instructions,
      tier: TIER_TABLE[a.tier],
      routines: a.routines.flatMap((r) => parseRoutine(r, role) ?? [])
    })
    agents.push({ ...view, runtimeRole: role })
  }
  return { defaults, agents, recruitable }
}

/* ---------- pipelines ---------- */

export function mapPipelines(bp: BlueprintDoc): BlueprintPipelineView[] {
  return bp.pipelines.map((p) => {
    const steps: BlueprintStepView[] = p.nodes.map((n) => ({
      id: n.id,
      kind: n.kind ?? guessDrawingKind(n.label).kind,
      label: n.label,
      runner: n.runner,
      gate: n.validate === 'review',
      provider: n.provider,
      credits: n.credits,
      kindSource: n.kind ? 'blueprint' : 'guessed'
    }))
    return { id: p.id, name: p.name, credits: steps.reduce((s, x) => s + x.credits, 0), steps }
  })
}

export function viewOf(bp: BlueprintDoc, version: number, meta: { publishedAt: string; fetchedAt: string; stale: boolean }): BlueprintStatus {
  const { agents, recruitable } = mapAgents(bp)
  return { state: 'ok', version, publishedAt: meta.publishedAt, fetchedAt: meta.fetchedAt, stale: meta.stale, agents, recruitable, pipelines: mapPipelines(bp) }
}
