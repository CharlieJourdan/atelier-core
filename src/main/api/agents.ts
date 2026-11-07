import type { ApiHandlers } from '../../shared/api'
import type { ApiContext } from './context'

type AgentMethods =
  | 'agents.list'
  | 'agents.update'
  | 'agents.reset'
  | 'agents.memory'
  | 'agents.forget'
  | 'proposals.decide'
  | 'tasks.resume'

/** Agents settings, the owner's answer to proposals, and taking a task off hold. */
export function agentsApi(ctx: ApiContext): Pick<ApiHandlers, AgentMethods> {
  const { agents, proposals, runner } = ctx
  return {
    'agents.list': () => agents.list(),
    'agents.update': (id, patch) => agents.update(id, patch),
    'agents.reset': (id) => agents.reset(id),
    'agents.memory': (agentId) => agents.memory(agentId),
    'agents.forget': (memoryId) => agents.forget(memoryId),
    'proposals.decide': async (proposalId, accept) => {
      const row = await proposals.decide(proposalId, accept)
      ctx.notify('chat')
      return row
    },
    'tasks.resume': (id) => {
      if (!Number.isInteger(id)) throw new Error('Tâche invalide : numéro entier attendu.')
      return runner.resume(id)
    }
  }
}
