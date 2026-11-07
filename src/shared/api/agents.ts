// IPC contract, module "agents": Agents, their memory and the proposals they make.
import type { AgentPatch, AgentRow, MemoryRow, ProposalRow } from '../agents'

export interface AgentsContract {
  'agents.list': { args: []; result: AgentRow[] }

  'agents.update': { args: [id: string, patch: AgentPatch]; result: AgentRow }

  /** Puts the built-in instructions back. */
  'agents.reset': { args: [id: string]; result: AgentRow }

  'agents.memory': { args: [agentId: string]; result: MemoryRow[] }

  'agents.forget': { args: [memoryId: number]; result: void }

  /** The owner confirms (true) or dismisses (false) an agent's proposal; confirming runs it. */
  'proposals.decide': { args: [proposalId: number, accept: boolean]; result: ProposalRow }
}

export const AGENTS_METHODS = [
  'agents.list',
  'agents.update',
  'agents.reset',
  'agents.memory',
  'agents.forget',
  'proposals.decide'
] as const satisfies readonly (keyof AgentsContract)[]
