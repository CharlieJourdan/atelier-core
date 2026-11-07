// Pure helpers of the Agents screens: what the grid shows for each agent (department, state, route) from the data the
// existing APIs return. No React, no DOM: unit-tested.
import type { AgentRow } from '../../../shared/agents'
import type { RouteRow, LlmDefaults } from '../../../shared/api'
import { agentIndex, departmentOf } from '../../../shared/chat-folders'
import { DEPARTMENTS, type Department, type RoomInfo } from '../../../shared/chat-rich'
import type { ConversationRow } from '../../../shared/chat'
import { ROLES, roleName, type Tier } from '../../../shared/roles'
import type { TaskRow } from '../../../shared/workflow'

export interface AgentCardData {
  agent: AgentRow
  index: number
  department: Department
  /** 'working' while one of its tasks runs, 'waiting' while one waits for approval, 'off' when disabled. */
  state: 'working' | 'waiting' | 'idle' | 'off'
  tier: Tier
  model: string
  providerId: string
  /** Latest tasks assigned to it, newest first (max 5). */
  recent: TaskRow[]
  runningCount: number
}

export interface DepartmentGroup {
  department: Department
  cards: AgentCardData[]
}

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function buildAgentCards(input: {
  agents: readonly AgentRow[]
  routes: readonly RouteRow[]
  defaults: LlmDefaults | null
  tasks: readonly TaskRow[]
}): AgentCardData[] {
  const order = new Map(ROLES.map((r, i) => [r.role, i]))
  return [...input.agents]
    .sort((a, b) => (order.get(a.role) ?? 999) - (order.get(b.role) ?? 999) || a.name.localeCompare(b.name, 'fr'))
    .map((agent) => {
      const route = input.routes.find((r) => r.role === agent.role)
      const tier = route?.tier ?? agent.tier
      const mine = input.tasks
        .filter((t) => t.assigneeType === 'agent' && t.assignee === agent.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      const running = mine.filter((t) => t.status === 'running').length
      const waiting = mine.some((t) => t.status === 'waiting_approval')
      return {
        agent,
        index: agentIndex(agent.id),
        department: departmentOf(agent.id),
        state: !agent.enabled ? 'off' : running > 0 ? 'working' : waiting ? 'waiting' : 'idle',
        tier,
        model: route?.model ?? input.defaults?.tierModels[tier] ?? '',
        providerId: route?.providerId ?? input.defaults?.defaultProvider ?? 'claude-code',
        recent: mine.slice(0, 5),
        runningCount: running
      }
    })
}

export type StateFilter = 'all' | 'working' | 'idle'

/** Search (name, role, department word) and state filter, then grouping by department in the fixed order. */
export function groupByDepartment(
  cards: readonly AgentCardData[],
  query: string,
  state: StateFilter,
  deptLabel: (d: Department) => string
): DepartmentGroup[] {
  const q = norm(query.trim())
  const kept = cards.filter((c) => {
    if (state === 'working' && c.state !== 'working') return false
    if (state === 'idle' && c.state === 'working') return false
    if (!q) return true
    return [c.agent.name, roleName(c.agent.role), c.agent.role, deptLabel(c.department)].some((s) => norm(s).includes(q))
  })
  return DEPARTMENTS.map((department) => ({ department, cards: kept.filter((c) => c.department === department) })).filter(
    (g) => g.cards.length > 0
  )
}

export interface RoomCardData {
  room: RoomInfo
  members: AgentRow[]
  conversation: ConversationRow | null
}

/** Rooms of the group engine with their members (agents of the department) and last message. */
export function buildRoomCards(input: {
  rooms: readonly RoomInfo[]
  agents: readonly AgentRow[]
  conversations: readonly ConversationRow[]
}): RoomCardData[] {
  return input.rooms
    .map((room) => ({
      room,
      members: input.agents.filter((a) => a.enabled && room.department !== undefined && departmentOf(a.id) === room.department),
      conversation: input.conversations.find((c) => c.id === room.conversationId) ?? null
    }))
}
