// The agent tree (orch_agents): principal → one lead per channel → specialists, plus agents created on demand. Each
// agent has a role, a parent, a channel (null for workspace agents), a model policy, a budget and a status the runtime
// recomputes from its tasks: working (a task leased or running), waiting (its task waits on sub-tasks, the user,
// accounts or budget), idle (runnable work queued), sleeping (nothing to do: no tokens spent), paused, error.
import type { OrchAgent, OrchAgentInput, OrchAgentPatch, OrchAgentStatus, OrchModelPolicy, OrchTreeNode } from '../../shared/api/orchestra'
import { EFFORTS } from '../../shared/api/core'
import { isTier, type Tier } from '../../shared/roles'
import { mentionSlug } from '../../shared/chat-rich'
import { checkLook, parseLook, type AgentLook } from '../../shared/mascot'
import type { Db } from '../db'
import { monthBounds, monthOf } from '../ledger'
import { CHANNEL_TEAM, PRINCIPAL_TEAM, canonicalRole, roleInfo, type SeedNode } from './roles'
import { checkTechnologies, technologiesOf } from './technologies'
import { iso, isRecord, parseJson, type Clock, type EventLog } from './util'

export interface AgentRecord {
  id: number
  slug: string
  role: string
  name: string
  parentId: number | null
  channelId: number | null
  status: OrchAgentStatus
  instructions: string
  policy: OrchModelPolicy
  budgetUsdMonth: number | null
  custom: boolean
  paused: boolean
  errorFlag: boolean
  lastActiveAt: string | null
  /** Its own technologies (tool ids); null = the defaults of its role. */
  technologies: string[] | null
  /** Its mascot's colour and accessory; null = the defaults of its role. */
  look: AgentLook | null
  /** Set when its channel was removed: the agent left the tree (its history stays). */
  archivedAt: string | null
}

interface AgentDb {
  id: number
  slug: string
  role: string
  name: string
  parent_id: number | null
  channel_id: number | null
  status: OrchAgentStatus
  instructions: string
  policy: string
  budget_usd_month: number | null
  custom: number
  paused: number
  error_flag: number
  last_active_at: string | null
  technologies: string | null
  look: string | null
  archived_at: string | null
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/
const MAX_INSTRUCTIONS = 8000
const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

interface NewAgent {
  slug: string
  role: string
  parentId: number | null
  channelId: number | null
  channelName?: string
  name?: string
  instructions?: string
  policy?: OrchModelPolicy
  budgetUsdMonth?: number | null
  custom?: boolean
}

/** What a new agent of a role starts from instead of the built-in text (the published blueprint). */
export interface SeedDefault {
  instructions: string
  tier: OrchModelPolicy['tier'] & string
}

export interface SeedOptions {
  defaults?: ReadonlyMap<string, SeedDefault>
  onCreate?: (agent: AgentRecord) => void
}

/** The lead agent's name before it was Atlas everywhere. */
const LEGACY_PRINCIPAL_NAME = 'Agent principal'

export class AgentTree {
  private readonly db: Db
  private readonly now: Clock
  private readonly events: EventLog
  /** The model tier of an agent's usual work (set by the runtime, which owns the routing). */
  tierOf: (agent: AgentRecord) => Tier = (a) => a.policy.tier ?? 'balanced'

  constructor(db: Db, now: Clock, events: EventLog) {
    this.db = db
    this.now = now
    this.events = events
  }

  // ---- seeding ------------------------------------------------------------------------------------------

  /**
   * Creates what is missing of the hierarchy for every active channel. Returns how many agents were added. `opts.defaults`
   * are the instructions and model tier a NEW agent of a role starts from (the published blueprint; else the built-in
   * ones); agents that already exist are never touched. `opts.onCreate` hears about each agent it creates.
   */
  seed(opts: SeedOptions = {}): number {
    let added = 0
    let principal = this.bySlug('principal')
    if (!principal) {
      principal = this.insertSeeded(opts, { slug: 'principal', role: 'principal', parentId: null, channelId: null })
      added++
    } else if (principal.name === LEGACY_PRINCIPAL_NAME) {
      // one name for the lead agent, « Atlas » (QA A8): the first teams were seeded as « Agent principal »
      this.db.prepare('UPDATE orch_agents SET name = ?, updated_at = ? WHERE id = ?').run(roleInfo('principal').name, iso(this.now()), principal.id)
    }
    added += this.seedNodes(PRINCIPAL_TEAM, principal, null, '', opts)
    const channels = this.db.prepare('SELECT id, name FROM channels WHERE archived_at IS NULL ORDER BY id').all() as { id: number; name: string }[]
    for (const ch of channels) {
      let lead = this.bySlug(`lead-${ch.id}`)
      if (!lead) {
        lead = this.insertSeeded(opts, { slug: `lead-${ch.id}`, role: 'channel_lead', parentId: principal.id, channelId: ch.id, channelName: ch.name })
        added++
      }
      added += this.seedNodes(CHANNEL_TEAM, lead, ch.id, ch.name, opts)
    }
    if (added) this.events.add('seed', `Team seeded: ${added} agent(s) added`)
    return added
  }

  private insertSeeded(opts: SeedOptions, a: NewAgent): AgentRecord {
    const d = opts.defaults?.get(canonicalRole(a.role))
    const agent = this.insert(d ? { ...a, instructions: d.instructions, policy: { tier: d.tier } } : a)
    opts.onCreate?.(agent)
    return agent
  }

  private seedNodes(nodes: readonly SeedNode[], parent: AgentRecord, channelId: number | null, channelName: string, opts: SeedOptions): number {
    let added = 0
    for (const n of nodes) {
      const slug = `${n.role.replace(/_/g, '-')}${channelId === null ? '' : `-${channelId}`}`
      let agent = this.bySlug(slug)
      if (!agent) {
        agent = this.insertSeeded(opts, { slug, role: n.role, parentId: parent.id, channelId, channelName })
        added++
      }
      if (n.children) added += this.seedNodes(n.children, agent, channelId, channelName, opts)
    }
    return added
  }

  private insert(a: NewAgent): AgentRecord {
    const info = roleInfo(a.role)
    const name = a.name ?? (a.channelName ? `${info.name} · ${a.channelName}` : info.name)
    const now = iso(this.now())
    const r = this.db
      .prepare(
        `INSERT INTO orch_agents (slug, role, name, parent_id, channel_id, instructions, policy, budget_usd_month, custom, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(a.slug, info.role, name, a.parentId, a.channelId, a.instructions ?? info.instructions, JSON.stringify(a.policy ?? {}), a.budgetUsdMonth ?? null, a.custom ? 1 : 0, now, now)
    return this.get(Number(r.lastInsertRowid))
  }

  /** An agent created on demand (custom role and instructions), under an existing agent. */
  create(input: OrchAgentInput): AgentRecord {
    if (!isRecord(input)) throw new Error('Un agent a besoin d’un nom, d’un rôle et d’un parent.')
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > 80) throw new Error('Un agent a besoin d’un nom (80 caractères au plus).')
    const role = typeof input.role === 'string' ? canonicalRole(input.role.trim().toLowerCase().replace(/[\s-]+/g, '_')) : ''
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(role)) throw new Error(`Invalid role: ${String(input.role)}`)
    const parent = this.get(input.parentId)
    const channelId = input.channelId === undefined ? parent.channelId : input.channelId
    if (channelId !== null && !this.db.prepare('SELECT 1 FROM channels WHERE id = ?').get(channelId)) throw new Error(`Unknown channel: ${channelId}`)
    if (this.list().some((a) => norm(a.name) === norm(name))) throw new Error(`An agent is already called ${name}`)
    let slug = mentionSlug(norm(name)).replace(/_/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+/, '').slice(0, 50) || role.replace(/_/g, '-')
    if (!SLUG_RE.test(slug)) slug = `agent-${role.replace(/_/g, '-')}`.slice(0, 50)
    let unique = slug
    for (let i = 2; this.bySlug(unique); i++) unique = `${slug}-${i}`
    const instructions = typeof input.instructions === 'string' ? input.instructions.trim().slice(0, MAX_INSTRUCTIONS) : undefined
    const agent = this.insert({
      slug: unique,
      role,
      parentId: parent.id,
      channelId,
      name,
      ...(instructions ? { instructions } : {}),
      policy: checkPolicy(input.policy ?? {}),
      budgetUsdMonth: checkBudget(input.budgetUsdMonth ?? null),
      custom: true
    })
    this.events.add('agent', `${agent.name} joined the team under ${parent.name}`, agent.id)
    return agent
  }

  update(id: number, patch: OrchAgentPatch): AgentRecord {
    const agent = this.get(id)
    if (!isRecord(patch)) throw new Error('Modification invalide : un objet est attendu.')
    const sets: string[] = []
    const args: (string | number | null)[] = []
    if (patch.name !== undefined) {
      const name = typeof patch.name === 'string' ? patch.name.trim() : ''
      if (!name || name.length > 80) throw new Error('Un nom fait de 1 à 80 caractères.')
      sets.push('name = ?')
      args.push(name)
    }
    if (patch.instructions !== undefined) {
      if (typeof patch.instructions !== 'string' || !patch.instructions.trim()) throw new Error('Les instructions ne peuvent pas être vides.')
      sets.push('instructions = ?')
      args.push(patch.instructions.trim().slice(0, MAX_INSTRUCTIONS))
    }
    if (patch.paused !== undefined) {
      if (typeof patch.paused !== 'boolean') throw new Error('La pause se règle par oui ou non.')
      sets.push('paused = ?')
      args.push(patch.paused ? 1 : 0)
    }
    if (patch.policy !== undefined) {
      sets.push('policy = ?')
      args.push(JSON.stringify(checkPolicy(patch.policy)))
    }
    if (patch.budgetUsdMonth !== undefined) {
      sets.push('budget_usd_month = ?')
      args.push(checkBudget(patch.budgetUsdMonth))
    }
    if (patch.technologies !== undefined) {
      sets.push('technologies = ?')
      args.push(patch.technologies === null ? null : JSON.stringify(checkTechnologies(patch.technologies)))
    }
    if (patch.look !== undefined) {
      const look = checkLook(patch.look)
      sets.push('look = ?')
      args.push(look === null ? null : JSON.stringify(look))
    }
    if (sets.length) {
      this.db.prepare(`UPDATE orch_agents SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, iso(this.now()), agent.id)
      if (patch.paused !== undefined) this.events.add(patch.paused ? 'pause' : 'resume', `${agent.name} ${patch.paused ? 'paused' : 'resumed'}`, agent.id)
    }
    this.refreshStatus(agent.id)
    return this.get(agent.id)
  }

  // ---- reads --------------------------------------------------------------------------------------------

  get(id: number): AgentRecord {
    const r = Number.isInteger(id) ? (this.db.prepare('SELECT * FROM orch_agents WHERE id = ?').get(id) as unknown as AgentDb | undefined) : undefined
    if (!r) throw new Error(`Unknown agent: ${String(id)}`)
    return toRecord(r)
  }

  bySlug(slug: string): AgentRecord | null {
    const r = this.db.prepare('SELECT * FROM orch_agents WHERE slug = ?').get(slug) as unknown as AgentDb | undefined
    return r ? toRecord(r) : null
  }

  principal(): AgentRecord | null {
    return this.bySlug('principal')
  }

  /** The team (agents of removed channels are left out: see `archived`). */
  list(): AgentRecord[] {
    return (this.db.prepare('SELECT * FROM orch_agents WHERE archived_at IS NULL ORDER BY id').all() as unknown as AgentDb[]).map(toRecord)
  }

  archived(): AgentRecord[] {
    return (this.db.prepare('SELECT * FROM orch_agents WHERE archived_at IS NOT NULL ORDER BY id').all() as unknown as AgentDb[]).map(toRecord)
  }

  reports(id: number): AgentRecord[] {
    return (this.db.prepare('SELECT * FROM orch_agents WHERE parent_id = ? AND archived_at IS NULL ORDER BY id').all(id) as unknown as AgentDb[]).map(toRecord)
  }

  /**
   * A channel is removed: its agents leave the tree (archived: no task of theirs runs), they keep their memory and history. Restoring the
   * channel brings them back as they were. Returns the agents changed.
   */
  setChannelArchived(channelId: number, archived: boolean): AgentRecord[] {
    const rows = (this.db.prepare('SELECT * FROM orch_agents WHERE channel_id = ? ORDER BY id').all(channelId) as unknown as AgentDb[]).map(toRecord)
    const changed = rows.filter((a) => (a.archivedAt !== null) !== archived)
    const at = archived ? iso(this.now()) : null
    for (const a of changed) {
      this.db.prepare('UPDATE orch_agents SET archived_at = ?, updated_at = ? WHERE id = ?').run(at, iso(this.now()), a.id)
      this.refreshStatus(a.id)
    }
    if (changed.length) this.events.add('archive', `${changed.length} agent(s) of channel #${channelId} ${archived ? 'archived' : 'restored'}`)
    return changed
  }

  /** An agent named by slug, name, @mention slug or numeric id. */
  resolve(ref: string | number): AgentRecord | null {
    if (typeof ref === 'number') return Number.isInteger(ref) ? this.list().find((a) => a.id === ref) ?? null : null
    const key = norm(String(ref).replace(/^@/, ''))
    if (!key) return null
    const all = this.list()
    return (
      all.find((a) => a.slug === key) ??
      all.find((a) => norm(a.name) === key) ??
      all.find((a) => norm(mentionSlug(a.name)) === key) ??
      null
    )
  }

  /** True when `ancestor` is above `agent` in the tree. */
  isAbove(ancestorId: number, agentId: number): boolean {
    let cur: AgentRecord | null = this.get(agentId)
    for (let depth = 0; cur && cur.parentId !== null && depth < 50; depth++) {
      if (cur.parentId === ancestorId) return true
      cur = this.get(cur.parentId)
    }
    return false
  }

  // ---- status -------------------------------------------------------------------------------------------

  touch(id: number): void {
    this.db.prepare('UPDATE orch_agents SET last_active_at = ? WHERE id = ?').run(iso(this.now()), id)
  }

  setError(id: number, on: boolean): void {
    this.db.prepare('UPDATE orch_agents SET error_flag = ? WHERE id = ?').run(on ? 1 : 0, id)
    this.refreshStatus(id)
  }

  /** Recomputes the status of an agent from its tasks; logs the change. */
  refreshStatus(id: number): OrchAgentStatus {
    const a = this.get(id)
    const count = (statuses: string): number =>
      (this.db.prepare(`SELECT COUNT(*) AS n FROM orch_tasks WHERE assignee_id = ? AND status IN (${statuses})`).get(id) as { n: number }).n
    let status: OrchAgentStatus
    if (a.paused) status = 'paused'
    else if (count(`'leased','running'`) > 0) status = 'working'
    else if (a.errorFlag) status = 'error'
    else if (count(`'waiting','waiting_human'`) > 0) status = 'waiting'
    else if (count(`'queued','failed'`) > 0) status = 'idle'
    else status = 'sleeping'
    if (status !== a.status) {
      this.db.prepare('UPDATE orch_agents SET status = ? WHERE id = ?').run(status, id)
      if (status === 'sleeping' || a.status === 'sleeping') this.events.add('status', `${a.name}: ${a.status} → ${status}`, id)
    }
    return status
  }

  refreshAll(): void {
    for (const a of this.list()) this.refreshStatus(a.id)
  }

  // ---- API shapes ---------------------------------------------------------------------------------------

  /** What this agent's calls cost this month (settled + open reservations), from the ledger. */
  spentThisMonth(id: number): number {
    const { start, end } = monthBounds(monthOf(new Date(this.now())))
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE l.status WHEN 'reserved' THEN l.estimate_usd WHEN 'refunded' THEN 0 ELSE l.amount_usd END), 0) AS s
         FROM ledger l JOIN orch_tasks t ON t.id = l.orch_task_id
         WHERE t.assignee_id = ? AND l.created_at >= ? AND l.created_at < ?`
      )
      .get(id, start, end) as { s: number }
    return Math.round(r.s * 1e6) / 1e6
  }

  toApi(a: AgentRecord): OrchAgent {
    const current = this.db
      .prepare(`SELECT id FROM orch_tasks WHERE assignee_id = ? AND status IN ('leased','running') ORDER BY id LIMIT 1`)
      .get(a.id) as { id: number } | undefined
    const queued = this.db
      .prepare(`SELECT COUNT(*) AS n FROM orch_tasks WHERE assignee_id = ? AND status IN ('queued','failed')`)
      .get(a.id) as { n: number }
    return {
      id: a.id,
      slug: a.slug,
      role: a.role,
      name: a.name,
      parentId: a.parentId,
      channelId: a.channelId,
      status: a.status,
      instructions: a.instructions,
      policy: a.policy,
      budgetUsdMonth: a.budgetUsdMonth,
      spentUsdMonth: this.spentThisMonth(a.id),
      custom: a.custom,
      paused: a.paused,
      currentTaskId: current?.id ?? null,
      queued: queued.n,
      lastActiveAt: a.lastActiveAt,
      technologies: technologiesOf(a),
      technologiesCustom: a.technologies !== null,
      tier: this.tierOf(a),
      look: a.look
    }
  }

  tree(): OrchTreeNode[] {
    const all = this.list().map((a) => this.toApi(a))
    const byParent = new Map<number | null, OrchAgent[]>()
    for (const a of all) {
      const key = a.parentId !== null && all.some((p) => p.id === a.parentId) ? a.parentId : null
      byParent.set(key, [...(byParent.get(key) ?? []), a])
    }
    const build = (a: OrchAgent, depth: number): OrchTreeNode => ({
      agent: a,
      children: depth > 20 ? [] : (byParent.get(a.id) ?? []).map((c) => build(c, depth + 1))
    })
    return (byParent.get(null) ?? []).map((a) => build(a, 0))
  }
}

function toRecord(r: AgentDb): AgentRecord {
  return {
    id: r.id,
    slug: r.slug,
    role: r.role,
    name: r.name,
    parentId: r.parent_id,
    channelId: r.channel_id,
    status: r.status,
    instructions: r.instructions,
    policy: parseJson<OrchModelPolicy>(r.policy, {}),
    budgetUsdMonth: r.budget_usd_month,
    custom: r.custom === 1,
    paused: r.paused === 1,
    errorFlag: r.error_flag === 1,
    lastActiveAt: r.last_active_at,
    technologies: r.technologies === null ? null : parseJson<string[]>(r.technologies, []),
    look: parseLook(r.look),
    archivedAt: r.archived_at
  }
}

export function checkPolicy(p: unknown): OrchModelPolicy {
  if (!isRecord(p)) throw new Error('Réglage du modèle invalide : un objet est attendu.')
  const out: OrchModelPolicy = {}
  if (p.tier !== undefined) {
    if (!isTier(p.tier)) throw new Error(`Unknown tier: ${String(p.tier)}`)
    out.tier = p.tier
  }
  if (p.effort !== undefined) {
    if (!(EFFORTS as readonly unknown[]).includes(p.effort)) throw new Error(`Unknown effort: ${String(p.effort)}`)
    out.effort = p.effort as OrchModelPolicy['effort'] & string
  }
  if (p.model !== undefined) {
    if (typeof p.model !== 'string' || !/^[A-Za-z0-9._:[\]-]{1,100}$/.test(p.model)) throw new Error('Identifiant de modèle invalide.')
    out.model = p.model
  }
  if (p.compactAtTokens !== undefined) {
    if (typeof p.compactAtTokens !== 'number' || !Number.isInteger(p.compactAtTokens) || p.compactAtTokens < 100) {
      throw new Error('Le seuil de compactage est un entier d’au moins 100.')
    }
    out.compactAtTokens = p.compactAtTokens
  }
  if (p.kinds !== undefined) {
    if (!isRecord(p.kinds)) throw new Error('Les réglages par type de tâche doivent être un objet.')
    out.kinds = {}
    for (const [kind, v] of Object.entries(p.kinds)) {
      const inner = checkPolicy(v)
      out.kinds[kind] = { ...(inner.tier ? { tier: inner.tier } : {}), ...(inner.effort ? { effort: inner.effort } : {}) }
    }
  }
  return out
}

function checkBudget(v: unknown): number | null {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('Un budget est un nombre positif ou nul en dollars, ou vide.')
  return v
}
