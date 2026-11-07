// Derived view of the team for the three team screens: agents with the user's edits applied, tree helpers, details
// (instructions, routines, memory, journal) merged with edits. Pure functions plus two hooks.
import { useMemo } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import {
  EFFORT_MODEL,
  LOAD_CALIBRATION,
  hash,
  detailFor,
  effortOf,
  type AgentDetail,
  type Effort
} from '@/proto/data-team-agents'
import { useProto, type ProtoState } from '@/proto/store'
import type { ProtoAgent, ProtoChannel } from '@/proto/types'
import { useTeamState, type AgentEdit, type TeamState } from './store'

export interface TeamAgent extends ProtoAgent {
  roleLabel: string
  isNew: boolean
  effort: Effort
}

export function roleLabelOf(role: ProtoAgent['role']): string {
  return t(`role.${role}` as MessageKey)
}

/** The load shown for an agent: calibrated in the demo, and coherent with what it is doing (idle is calm, working is busy). */
export function displayLoad(a: ProtoAgent): number {
  const set = LOAD_CALIBRATION[a.id]
  if (set !== undefined) return set
  if (a.role === 'principal') return a.load
  if (a.status === 'sleeping') return 3 + (hash(a.id) % 5)
  if (a.status === 'idle') return 8 + (hash(a.id) % 17)
  if (a.status === 'working') return Math.max(a.load, 36 + (hash(a.id) % 20))
  return Math.min(70, Math.max(a.load, 24))
}

export function buildTeamAgents(agents: readonly ProtoAgent[], team: Pick<TeamState, 'edits' | 'recruited'>): TeamAgent[] {
  return agents.map((a) => {
    const edit = team.edits[a.id]
    const effort = edit?.effort ?? effortOf(a.model)
    const title = team.recruited[a.id]
    return {
      ...a,
      name: edit?.name?.trim() ? edit.name.trim() : a.name,
      model: edit?.effort ? EFFORT_MODEL[edit.effort] : a.model,
      load: displayLoad(a),
      roleLabel: title ?? roleLabelOf(a.role),
      isNew: title !== undefined,
      effort
    }
  })
}

export function useTeamAgents(): { state: ProtoState; team: TeamState; agents: TeamAgent[] } {
  const state = useProto()
  const team = useTeamState()
  const agents = useMemo(() => buildTeamAgents(state.agents, team), [state.agents, team])
  return { state, team, agents }
}

/* ---------- tree helpers ---------- */

export function leadOf<T extends ProtoAgent>(agents: readonly T[], channelId: string): T | undefined {
  return agents.find((a) => a.channelId === channelId && a.role === 'channel-manager')
}

export function childrenOf<T extends ProtoAgent>(agents: readonly T[], parentId: string): T[] {
  return agents.filter((a) => a.parentId === parentId)
}

export function firstName(name: string): string {
  return name.split(' ')[0] ?? name
}

export function averageLoad(agents: readonly ProtoAgent[]): number {
  return agents.length === 0 ? 0 : Math.round(agents.reduce((n, a) => n + a.load, 0) / agents.length)
}

export function isWaiting(a: Pick<ProtoAgent, 'status'>): boolean {
  return a.status === 'waiting'
}

/* ---------- details ---------- */

export function detailOf(agent: TeamAgent, all: readonly TeamAgent[], channels: readonly ProtoChannel[], edit: AgentEdit | undefined): AgentDetail {
  const channel = channels.find((c) => c.id === agent.channelId)
  const lead = channel ? leadOf(all, channel.id) : undefined
  const colleague = (lead && lead.id !== agent.id ? lead : all.find((a) => a.channelId === agent.channelId && a.id !== agent.id) ?? all[0])?.name ?? 'un collègue'
  const base = detailFor(agent, {
    channelName: channel?.name ?? 'toutes les chaînes',
    cadence: channel?.cadence ?? 'selon le planning',
    colleague
  })
  return {
    ...base,
    instructions: edit?.instructions ?? base.instructions,
    budgetPerDay: edit?.budget ?? base.budgetPerDay,
    permissions: { ...base.permissions, ...edit?.permissions },
    routines: base.routines.map((r) => ({ ...r, on: edit?.routines?.[r.id] ?? r.on })),
    memory: base.memory.filter((m) => !edit?.deletedMemory?.includes(m.id))
  }
}

/** Sentence of the main agent about the load of the team, built from the live numbers. */
export function balanceSentence(agents: readonly TeamAgent[]): { busy?: TeamAgent; rested?: TeamAgent } {
  const worker = agents.filter((a) => a.role !== 'principal' && a.role !== 'qc-eye')
  const sorted = [...worker].sort((a, b) => b.load - a.load)
  const busy = sorted[0]
  const SKIP: ProtoAgent['role'][] = ['qc-eye', 'competitor-analyst', 'researcher', 'channel-manager']
  const rested = [...worker].filter((a) => a.id !== busy?.id && a.channelId === busy?.channelId && !SKIP.includes(a.role)).sort((a, b) => a.load - b.load)[0] ?? sorted[sorted.length - 1]
  return { ...(busy ? { busy } : {}), ...(rested ? { rested } : {}) }
}

/** The conversation of the user with one agent: the main agent has its own thread, the others a direct-message thread. */
export function dmThreadId(agent: Pick<ProtoAgent, 'id' | 'role'>): string {
  return agent.role === 'principal' ? 'th-principal' : `th-dm-${agent.id}`
}

/** Agents of a channel whose manager is not in the channel (e.g. recruited to report to the main agent) hang under the lead. */
export function withLeadsAsParents<T extends ProtoAgent>(agents: readonly T[]): T[] {
  return agents.map((a) => {
    if (!a.channelId || a.role === 'channel-manager' || a.role === 'principal') return a
    const parent = agents.find((p) => p.id === a.parentId)
    if (parent && parent.channelId === a.channelId) return a
    const lead = leadOf(agents, a.channelId)
    return lead ? { ...a, parentId: lead.id } : a
  })
}
