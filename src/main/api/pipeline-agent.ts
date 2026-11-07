// IPC handlers, module "pipelineAgent" (production-12): the agent's proposals, the pipeline's conversation with the agent,
// accepting or rejecting its changes, and the channels a pipeline serves (src/main/production/pipeline-agent).
import type { ApiHandlers } from '../../shared/api'
import type { PIPELINE_AGENT_METHODS } from '../../shared/api/pipeline-agent'
import { checkPositiveId } from '../production/recipes/store'
import type { ApiContext } from './context'

type PipelineAgentMethodKey = (typeof PIPELINE_AGENT_METHODS)[number]

const channelOf = (v: unknown): number | null => (v === null || v === undefined ? null : checkPositiveId(v, 'Chaîne'))

export function pipelineAgentApi(ctx: Pick<ApiContext, 'pipelineAgent'>): Pick<ApiHandlers, PipelineAgentMethodKey> {
  const s = ctx.pipelineAgent
  const recipe = (v: unknown): number => checkPositiveId(v, 'Pipeline')
  return {
    'pipelineAgent.propose': (target, options) => s.propose(target, options ?? {}),
    'pipelineAgent.adopt': (input) => s.adopt(input),
    'pipelineAgent.thread': (id, channelId) => s.thread(recipe(id), channelOf(channelId)),
    'pipelineAgent.say': (id, text, channelId) => s.say(recipe(id), text, channelOf(channelId)),
    'pipelineAgent.accept': (id, changeId) => s.accept(recipe(id), checkPositiveId(changeId, 'Modification')),
    'pipelineAgent.reject': (id, changeId) => s.reject(recipe(id), checkPositiveId(changeId, 'Modification')),
    'pipelineAgent.assignment': (id) => s.assignment(recipe(id)),
    'pipelineAgent.assign': (id, channelIds) => s.assign(recipe(id), channelIds)
  }
}
