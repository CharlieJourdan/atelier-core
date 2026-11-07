// IPC contract, module "pipelineAgent" (production-12, decisions 0024 and 0032): the agent proposes pipelines for a target
// (variants with price and fit, the open questions), a proposal becomes the team's pipeline, the pipeline's conversation
// with the agent (every change it proposes is a diff with Δ cost and Δ fit, saved as a new version only when the owner
// accepts), and the channels a pipeline serves with their inputs. Types: `src/shared/pipeline-agent.ts`.
// Every method added here must also be listed in PIPELINE_AGENT_METHODS (tests/unit/ipc.test.ts compares the list with main).
import type { RecipeDetail, RecipeDocument } from '../recipes'
import type { AgentTarget, AssignView, ProposalView, ProposeOptions, ThreadView, VariantKindId } from '../pipeline-agent'

export type * from '../pipeline-agent'

export interface PipelineAgentContract {
  /** Variants for a target: the code's proposal, and the agent's draft on top when `agent` is true. */
  'pipelineAgent.propose': { args: [target: AgentTarget, options?: ProposeOptions]; result: ProposalView }
  /** Saves the chosen variant as the team's pipeline, starts its conversation, assigns it to channels. */
  'pipelineAgent.adopt': {
    args: [input: { doc: RecipeDocument; kind: VariantKindId; summary?: string; channelIds?: number[] }]
    result: RecipeDetail
  }
  'pipelineAgent.thread': { args: [recipeId: number, channelId?: number | null]; result: ThreadView }
  /** One message to the agent; its answer may carry a proposed change (pending until accepted). */
  'pipelineAgent.say': { args: [recipeId: number, text: string, channelId?: number | null]; result: ThreadView }
  /** Saves the pending change as a new version of the pipeline. */
  'pipelineAgent.accept': { args: [recipeId: number, changeId: number]; result: ThreadView }
  'pipelineAgent.reject': { args: [recipeId: number, changeId: number]; result: ThreadView }
  /** The channels the pipeline serves (for its video type) and their inputs, pre-filled from each channel. */
  'pipelineAgent.assignment': { args: [recipeId: number]; result: AssignView }
  /** Sets the channels the pipeline serves for its video type (the others stop using it). */
  'pipelineAgent.assign': { args: [recipeId: number, channelIds: number[]]; result: AssignView }
}

export const PIPELINE_AGENT_METHODS = [
  'pipelineAgent.propose',
  'pipelineAgent.adopt',
  'pipelineAgent.thread',
  'pipelineAgent.say',
  'pipelineAgent.accept',
  'pipelineAgent.reject',
  'pipelineAgent.assignment',
  'pipelineAgent.assign'
] as const satisfies readonly (keyof PipelineAgentContract)[]
