// IPC handlers, module "graph" (decision 0023, production-13): the read-only graph of a pipeline as edited, and of the
// project a run was launched from (src/main/production/recipes/graph.ts). Read-only.
import type { ApiHandlers } from '../../shared/api'
import type { GRAPH_METHODS } from '../../shared/api/graph'
import { ProjectStore, RecipeStore } from '../production/recipes'
import { graphOfDoc } from '../production/recipes/graph'
import type { ApiContext } from './context'

type GraphMethodKey = (typeof GRAPH_METHODS)[number]

export function graphApi(ctx: Pick<ApiContext, 'db' | 'productionRuns'>): Pick<ApiHandlers, GraphMethodKey> {
  const recipes = new RecipeStore(ctx.db)
  const projects = new ProjectStore(ctx.db, recipes, ctx.productionRuns)
  return {
    'graph.pipeline': (doc, channelId) => graphOfDoc(recipes, doc, channelId),
    'graph.run': (runId) => projects.graphOfRun(runId)
  }
}
