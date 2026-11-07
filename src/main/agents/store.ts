// Agents and their memory in SQLite. Built-in agents are seeded from roles.ts when missing; the tier shown is the
// route's (the `routes` table decides the model), `agents.tier` keeps the role's default tier.
import {
  ATELIER_TOOLS,
  isCadence,
  type AgentPatch,
  type AgentRow,
  type AtelierTool,
  type Cadence,
  type MemoryRow
} from '../../shared/agents'
import { ROLES, isTier, type Tier } from '../../shared/roles'
import type { Db } from '../db'
import { AGENT_DEFAULTS, agentDefault, PREVIOUS_INSTRUCTIONS } from './roles'

/** Stored in `agents.tools` next to the Atelier tool names for the CLI's built-in web search. */
export const WEB_SEARCH_TOOL = 'WebSearch'
export const MAX_INSTRUCTIONS_CHARS = 8000
export const MAX_MEMORY_CHARS = 1000
/** Oldest notes beyond this count are dropped for an agent and channel. */
export const MAX_MEMORY_NOTES = 50

interface AgentDb {
  id: string
  role: string
  name: string
  instructions: string
  tools: string
  tier: string | null
  cadence: string
  enabled: number
  updated_at: string
  route_tier: string | null
}

interface MemoryDb {
  id: number
  agent_id: string
  channel_id: number | null
  content: string
  created_at: string
}

export class AgentsStore {
  constructor(
    private readonly db: Db,
    private readonly onChange: () => void = () => undefined
  ) {}

  /**
   * Inserts the built-in agents that are missing. Existing rows keep Charlie's edits; they only gain the built-in tools
   * added since they were seeded, and instructions still equal to an earlier default move to the current one.
   */
  seed(): number {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO agents (id, role, name, instructions, tools, tier, cadence) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const stored = this.db.prepare('SELECT tools, instructions FROM agents WHERE id = ?')
    const upgrade = this.db.prepare('UPDATE agents SET tools = ?, instructions = ? WHERE id = ?')
    let added = 0
    for (const a of AGENT_DEFAULTS) {
      const tier = ROLES.find((r) => r.role === a.role)?.defaultTier ?? 'balanced'
      const defaults = [...a.tools, ...(a.webSearch ? [WEB_SEARCH_TOOL] : [])]
      const n = Number(insert.run(a.role, a.role, a.name, a.instructions, JSON.stringify(defaults), tier, a.cadence).changes)
      added += n
      if (n > 0) continue
      const row = stored.get(a.role) as { tools: string; instructions: string } | undefined
      if (!row) continue
      const have = parseTools(row.tools)
      const tools = [...have, ...defaults.filter((t) => !have.includes(t))]
      const instructions = PREVIOUS_INSTRUCTIONS[a.role]?.includes(row.instructions) ? a.instructions : row.instructions
      if (tools.length !== have.length || instructions !== row.instructions) upgrade.run(JSON.stringify(tools), instructions, a.role)
    }
    return added
  }

  list(): AgentRow[] {
    const rows = this.db
      .prepare(`SELECT a.*, r.tier AS route_tier FROM agents a LEFT JOIN routes r ON r.role = a.role ORDER BY a.rowid`)
      .all() as unknown as AgentDb[]
    return rows.map(toAgent)
  }

  get(id: string): AgentRow {
    const row = this.db
      .prepare(`SELECT a.*, r.tier AS route_tier FROM agents a LEFT JOIN routes r ON r.role = a.role WHERE a.id = ?`)
      .get(id) as unknown as AgentDb | undefined
    if (!row) throw new Error(`Unknown agent: ${String(id)}`)
    return toAgent(row)
  }

  /** The agent for a role, or null when it does not exist. */
  find(role: string): AgentRow | null {
    try {
      return this.get(role)
    } catch {
      return null
    }
  }

  update(id: string, patch: AgentPatch): AgentRow {
    this.get(id)
    if (typeof patch !== 'object' || patch === null) throw new Error('An agent patch must be an object')
    const sets: string[] = []
    const args: (string | number)[] = []
    if (patch.instructions !== undefined) {
      if (typeof patch.instructions !== 'string') throw new Error('instructions must be text')
      const text = patch.instructions.trim()
      if (!text) throw new Error('Instructions cannot be empty (use "Reset to default")')
      if (text.length > MAX_INSTRUCTIONS_CHARS) throw new Error(`Instructions are limited to ${MAX_INSTRUCTIONS_CHARS} characters`)
      sets.push('instructions = ?')
      args.push(text)
    }
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean') throw new Error('enabled must be true or false')
      sets.push('enabled = ?')
      args.push(patch.enabled ? 1 : 0)
    }
    if (patch.cadence !== undefined) {
      if (!isCadence(patch.cadence)) throw new Error(`Unknown cadence: ${String(patch.cadence)}`)
      sets.push('cadence = ?')
      args.push(patch.cadence)
    }
    if (sets.length) {
      this.db
        .prepare(`UPDATE agents SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
        .run(...args, id)
      this.onChange()
    }
    return this.get(id)
  }

  /** Puts the built-in instructions, tools and cadence back. */
  reset(id: string): AgentRow {
    const agent = this.get(id)
    const def = agentDefault(agent.role)
    if (!def) throw new Error(`Agent ${id} has no built-in default`)
    const tools = JSON.stringify([...def.tools, ...(def.webSearch ? [WEB_SEARCH_TOOL] : [])])
    this.db
      .prepare(
        `UPDATE agents SET instructions = ?, tools = ?, cadence = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`
      )
      .run(def.instructions, tools, def.cadence, id)
    this.onChange()
    return this.get(id)
  }

  // ---- memory -------------------------------------------------------------------------------------------

  /** Saves a note for an agent (per channel when known) and keeps the newest MAX_MEMORY_NOTES. */
  remember(agentId: string, channelId: number | null, content: string): MemoryRow {
    this.get(agentId)
    if (typeof content !== 'string' || !content.trim()) throw new Error('A note needs text')
    const text = content.trim().slice(0, MAX_MEMORY_CHARS)
    const r = this.db
      .prepare('INSERT INTO agent_memory (agent_id, channel_id, content) VALUES (?, ?, ?)')
      .run(agentId, channelId, text)
    this.db
      .prepare(
        `DELETE FROM agent_memory WHERE agent_id = ? AND channel_id IS ? AND id NOT IN (
           SELECT id FROM agent_memory WHERE agent_id = ? AND channel_id IS ? ORDER BY id DESC LIMIT ?)`
      )
      .run(agentId, channelId, agentId, channelId, MAX_MEMORY_NOTES)
    this.onChange()
    return this.memoryRow(Number(r.lastInsertRowid))
  }

  /** Notes an agent sees: its channel's notes and its general ones, oldest first. */
  recall(agentId: string, channelId: number | null, limit = 20): MemoryRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (SELECT * FROM agent_memory WHERE agent_id = ? AND (channel_id IS NULL OR channel_id IS ?)
           ORDER BY id DESC LIMIT ?) ORDER BY id`
      )
      .all(agentId, channelId, limit) as unknown as MemoryDb[]
    return rows.map(toMemory)
  }

  memory(agentId: string): MemoryRow[] {
    this.get(agentId)
    const rows = this.db.prepare('SELECT * FROM agent_memory WHERE agent_id = ? ORDER BY id').all(agentId) as unknown as MemoryDb[]
    return rows.map(toMemory)
  }

  forget(memoryId: number): void {
    if (!Number.isInteger(memoryId)) throw new Error('memoryId must be an integer')
    this.db.prepare('DELETE FROM agent_memory WHERE id = ?').run(memoryId)
    this.onChange()
  }

  private memoryRow(id: number): MemoryRow {
    return toMemory(this.db.prepare('SELECT * FROM agent_memory WHERE id = ?').get(id) as unknown as MemoryDb)
  }
}

function toAgent(r: AgentDb): AgentRow {
  const stored = parseTools(r.tools)
  const def = agentDefault(r.role)
  const tier: Tier = isTier(r.route_tier) ? r.route_tier : isTier(r.tier) ? r.tier : 'balanced'
  return {
    id: r.id,
    role: r.role,
    name: r.name,
    instructions: r.instructions,
    customized: def ? def.instructions !== r.instructions : true,
    tools: stored.filter((t): t is AtelierTool => (ATELIER_TOOLS as readonly string[]).includes(t)),
    webSearch: stored.includes(WEB_SEARCH_TOOL),
    tier,
    cadence: isCadence(r.cadence) ? r.cadence : ('on_task' as Cadence),
    enabled: r.enabled === 1,
    updatedAt: r.updated_at
  }
}

function parseTools(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function toMemory(r: MemoryDb): MemoryRow {
  return { id: r.id, agentId: r.agent_id, channelId: r.channel_id, content: r.content, createdAt: r.created_at }
}
