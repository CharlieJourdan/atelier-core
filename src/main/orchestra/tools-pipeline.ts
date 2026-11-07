// The pipeline technologies of the team agents (production-12, decision 0024 R10.3): the same three tools as the pipeline's
// own agent — read a team pipeline, try edit operations on it (diff, Δ cost, Δ fit, typed errors), propose them. A proposal
// waits in the pipeline's conversation until the owner accepts it in the editor: an agent never saves a pipeline itself.
import { callPipelineTool, type PipelineToolName } from '../production/pipeline-agent/tools'
import type { Handler, ToolCtx } from './tool-args'

async function run(c: ToolCtx, name: PipelineToolName, a: Record<string, unknown>): Promise<string> {
  const p = c.env.services.pipelines
  if (!p) throw new Error('Pipelines are not available here')
  const r = callPipelineTool(await p.teamBench(), name, a)
  if (r.isError) throw new Error(r.text)
  return r.text
}

export const PIPELINE_TOOLS: Record<string, Handler> = {
  'pipeline.read': (c, a) => run(c, 'pipeline_read', a),
  'pipeline.try': (c, a) => run(c, 'pipeline_try', a),
  'pipeline.propose': (c, a) => run(c, 'pipeline_propose', a)
}
