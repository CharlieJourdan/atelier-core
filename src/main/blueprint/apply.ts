// Putting the published blueprint on the team. New agents are seeded from it (Orchestra.seed); existing agents keep
// their own settings until the user clicks « Appliquer la version N »: `plan` lists, per agent, what would change and
// whether the user edited that agent by hand, `apply` changes only the agents the user picked. What the blueprint last
// wrote on each agent is remembered (setting `blueprint.applied`), so « edited by hand » means: different from that.
import type { BlueprintAgentChange, BlueprintApplyResult, BlueprintPlan } from '../../shared/blueprint'
import type { JsonValue } from '../../shared/api'
import type { Tier } from '../../shared/roles'
import { roleInfo } from '../orchestra/roles'
import type { RoutineStore } from '../orchestra/routines'
import type { AgentRecord, AgentTree } from '../orchestra/tree'
import type { SettingsStore } from '../settings'
import type { RoleDefault, SeedDefaults } from './map'

export const APPLIED_KEY = 'blueprint.applied'

interface Written {
  instructions: string
  tier: Tier | null
}
interface Applied {
  version: number | null
  agents: Record<string, Written>
}

export interface ApplyParts {
  tree: AgentTree
  routines: RoutineStore
  settings: SettingsStore
}

function readApplied(settings: SettingsStore): Applied {
  const raw = settings.get<JsonValue>(APPLIED_KEY, null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { version: null, agents: {} }
  const r = raw as Record<string, JsonValue>
  const agents = r.agents && typeof r.agents === 'object' && !Array.isArray(r.agents) ? (r.agents as unknown as Record<string, Written>) : {}
  return { version: typeof r.version === 'number' ? r.version : null, agents }
}

function writeApplied(settings: SettingsStore, a: Applied): void {
  settings.set(APPLIED_KEY, a as unknown as JsonValue)
}

/** Remembers what the blueprint wrote on an agent (a new agent seeded from it, or one the user applied it to). */
export function recordWritten(settings: SettingsStore, version: number, agent: AgentRecord): void {
  const a = readApplied(settings)
  a.agents[agent.slug] = { instructions: agent.instructions, tier: agent.policy.tier ?? null }
  a.version = Math.max(a.version ?? 0, version)
  writeApplied(settings, a)
}

/** Schedules the blueprint's routines on an agent (idempotent by name). Returns the names that were added. */
export function ensureRoutines(routines: RoutineStore, agentId: number, d: RoleDefault): string[] {
  const have = new Set(routines.list(agentId).map((r) => r.name))
  const added: string[] = []
  for (const r of d.routines) {
    if (have.has(r.name)) continue
    routines.ensure(agentId, { name: r.name, kind: r.kind, cron: r.cron, payload: { title: r.name } })
    added.push(r.name)
  }
  return added
}

function changeOf(parts: ApplyParts, applied: Applied, agent: AgentRecord, d: RoleDefault): BlueprintAgentChange | null {
  const change: BlueprintAgentChange = { agentId: agent.id, slug: agent.slug, name: agent.name, role: agent.role, blueprintId: d.blueprintId, handEdited: false }
  if (agent.instructions.trim() !== d.instructions.trim()) change.instructions = { from: agent.instructions, to: d.instructions }
  if ((agent.policy.tier ?? null) !== d.tier) change.tier = { from: agent.policy.tier ?? null, to: d.tier }
  const have = new Set(parts.routines.list(agent.id).map((r) => r.name))
  const missing = d.routines.map((r) => r.name).filter((n) => !have.has(n))
  if (missing.length > 0) change.routines = missing
  if (!change.instructions && !change.tier && !change.routines) return null
  const base: Written = applied.agents[agent.slug] ?? { instructions: roleInfo(agent.role).instructions, tier: null }
  change.handEdited = agent.instructions !== base.instructions || (agent.policy.tier ?? null) !== base.tier
  return change
}

/** What « Appliquer la version N » would change, per existing agent. Agents created by hand are never listed. */
export function planApply(parts: ApplyParts, version: number | null, defaults: SeedDefaults | null): BlueprintPlan {
  const applied = readApplied(parts.settings)
  const changes: BlueprintAgentChange[] = []
  if (defaults) {
    for (const agent of parts.tree.list()) {
      const d = agent.custom ? undefined : defaults.get(agent.role)
      const c = d ? changeOf(parts, applied, agent, d) : null
      if (c) changes.push(c)
    }
  }
  return { version, changes, appliedVersion: applied.version }
}

/** Applies the version to the agents the user picked (an id that is not in the plan is skipped). */
export function applyBlueprint(parts: ApplyParts, version: number, defaults: SeedDefaults, agentIds: readonly number[]): BlueprintApplyResult {
  const wanted = new Set(agentIds)
  const plan = planApply(parts, version, defaults)
  let applied = 0
  for (const c of plan.changes) {
    if (!wanted.has(c.agentId)) continue
    const d = defaults.get(c.role)
    if (!d) continue
    const agent = parts.tree.get(c.agentId)
    parts.tree.update(agent.id, {
      ...(c.instructions && d.instructions.trim() ? { instructions: d.instructions } : {}),
      ...(c.tier ? { policy: { ...agent.policy, tier: d.tier } } : {})
    })
    ensureRoutines(parts.routines, agent.id, d)
    recordWritten(parts.settings, version, parts.tree.get(agent.id))
    applied++
  }
  return { version, applied, skipped: wanted.size - applied }
}
