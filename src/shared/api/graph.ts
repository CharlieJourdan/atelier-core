// IPC contract, module "graph" (decision 0023, production-13): the read-only graph of a pipeline, generated in main from
// the compiled pipeline (src/engine/technologies/graph.ts), for the editor and for a project's run. Types:
// `src/shared/pipeline-graph.ts`. Every method added here must also be listed in GRAPH_METHODS.
import type { RecipeDocument } from '../recipes'
import type { PipelineGraphView } from '../pipeline-graph'

export type * from '../pipeline-graph'

export interface GraphContract {
  /** The graph of a pipeline document as edited (not saved), compiled with a channel's settings (null: none). */
  'graph.pipeline': { args: [doc: RecipeDocument, channelId?: number | null]; result: PipelineGraphView }
  /** The graph of the project a run was launched from (null: the run comes from no project). */
  'graph.run': { args: [runId: number]; result: PipelineGraphView | null }
}

export const GRAPH_METHODS = ['graph.pipeline', 'graph.run'] as const satisfies readonly (keyof GraphContract)[]
