// Small local store of the team screens (module level, useSyncExternalStore): the thread selected in Messages, the edits
// the user makes to agents (name, effort, instructions, routines, memory, permissions), who was just recruited, and the
// messages / typing of the demo chat. The shared proto store has no action for these, and they must survive opening and
// closing a sheet or switching screens.
import { useSyncExternalStore } from 'react'
import type { Effort, Permissions } from '@/proto/data-team-agents'
import type { ProtoMessage } from '@/proto/types'

export interface AgentEdit {
  name?: string
  effort?: Effort
  instructions?: string
  budget?: number
  permissions?: Partial<Permissions>
  /** Routine id → on / off. */
  routines?: Record<string, boolean>
  deletedMemory?: string[]
}

export interface TeamState {
  selectedThread: string | null
  edits: Record<string, AgentEdit>
  /** Agents recruited in this session: id → the title shown under the name. */
  recruited: Record<string, string>
  /** Messages posted in this session on threads the shared store does not answer (everything but the main agent). */
  chat: ProtoMessage[]
  /** Thread id → ids of the agents who are « typing ». */
  typing: Record<string, string[]>
  /** Synthesised threads the user has opened. */
  read: string[]
}

const INITIAL: TeamState = { selectedThread: null, edits: {}, recruited: {}, chat: [], typing: {}, read: [] }

let state: TeamState = INITIAL
const listeners = new Set<() => void>()

function set(fn: (s: TeamState) => TeamState): void {
  state = fn(state)
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useTeamState(): TeamState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

export function getTeamState(): TeamState {
  return state
}

/** Tests: back to a blank store. */
export function resetTeamStore(): void {
  set(() => INITIAL)
}

export const teamActions = {
  selectThread: (id: string | null) => set((s) => ({ ...s, selectedThread: id })),
  editAgent: (id: string, patch: AgentEdit) =>
    set((s) => {
      const prev = s.edits[id] ?? {}
      const merged: AgentEdit = {
        ...prev,
        ...patch,
        ...(patch.permissions ? { permissions: { ...prev.permissions, ...patch.permissions } } : {}),
        ...(patch.routines ? { routines: { ...prev.routines, ...patch.routines } } : {}),
        ...(patch.deletedMemory ? { deletedMemory: [...(prev.deletedMemory ?? []), ...patch.deletedMemory] } : {})
      }
      return { ...s, edits: { ...s.edits, [id]: merged } }
    }),
  markRecruited: (id: string, title: string) => set((s) => ({ ...s, recruited: { ...s.recruited, [id]: title } })),
  post: (message: ProtoMessage) => set((s) => ({ ...s, chat: [...s.chat, message] })),
  setTyping: (threadId: string, agentId: string, on: boolean) =>
    set((s) => {
      const cur = s.typing[threadId] ?? []
      const next = on ? (cur.includes(agentId) ? cur : [...cur, agentId]) : cur.filter((x) => x !== agentId)
      return { ...s, typing: { ...s.typing, [threadId]: next } }
    }),
  markRead: (threadId: string) => set((s) => (s.read.includes(threadId) ? s : { ...s, read: [...s.read, threadId] }))
}

let seq = 0
export function localId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}
