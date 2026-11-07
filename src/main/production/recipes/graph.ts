// The read-only graph of a pipeline document as edited (decision 0023, production-13): parsed and compiled with the
// channel's settings like a run would be, then drawn brick by brick (src/engine/technologies/graph.ts). A project's run
// gets its graph from `ProjectStore.graphOfRun`.
import { parseRecipe, pipelineGraph } from '../../../engine/technologies'
import type { PipelineGraphView } from '../../../shared/pipeline-graph'
import { checkPositiveId, type RecipeStore } from './store'

export function graphOfDoc(store: RecipeStore, doc: unknown, channelId?: number | null): PipelineGraphView {
  const parsed = parseRecipe(doc)
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => ({ code: 'schema', path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)), message: i.message }))
    return { ok: false, errors, nodes: [], edges: [], inputs: [], output: null }
  }
  const channel = channelId === null || channelId === undefined ? undefined : store.production(checkPositiveId(channelId, 'Chaîne'))
  return pipelineGraph(parsed.data, store.registry, channel ? { channel } : {})
}
