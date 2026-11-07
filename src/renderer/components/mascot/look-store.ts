// The looks the owner chose in this session, by agent id (module level, useSyncExternalStore). In real mode the choice
// is also stored on the agent (orch_agents.look) and comes back through the agent list; this store makes it show at once
// on every screen, and is what a demo workspace (no runtime behind it) keeps. `null` = « back to the role's defaults ».
import { useSyncExternalStore } from 'react'
import type { AgentLook } from '../../../shared/mascot'

let looks: ReadonlyMap<string, AgentLook | null> = new Map()
const listeners = new Set<() => void>()

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function setLookOverride(agentId: string, look: AgentLook | null): void {
  looks = new Map(looks).set(agentId, look)
  for (const l of listeners) l()
}

export function getLookOverride(agentId: string | undefined): AgentLook | null | undefined {
  return agentId === undefined ? undefined : looks.get(agentId)
}

/** Tests: forget every choice. */
export function resetLookStore(): void {
  looks = new Map()
  for (const l of listeners) l()
}

/** The look chosen for this agent in the session: undefined = nothing chosen, follow the agent's own. */
export function useLookOverride(agentId: string | undefined): AgentLook | null | undefined {
  return useSyncExternalStore(subscribe, () => getLookOverride(agentId), () => getLookOverride(agentId))
}
