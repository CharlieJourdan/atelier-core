// The read-only graph of a pipeline (decision 0023, docs/specs/production-model.md §11), as main sends it to the
// renderer: one node per brick of the compiled pipeline, one edge per slot a brick reads from another, and the bricks an
// option switched off removes, drawn greyed with their edges dashed. Built by `src/engine/technologies/graph.ts` from what
// the compiler returns, so it can never disagree with what runs; the renderer only lays it out and draws it.
import type { RecipeIssueView, RecipeStage } from './recipes'

export interface GraphNodeView {
  /** The brick: its technology's name (`voice.tts`), unique in a pipeline. */
  id: string
  /** `name@version`. */
  tech: string
  /** French label key (`tech.<name>`). */
  labelKey: string
  stage: RecipeStage
  kind: string
  /** The pipeline nodes it runs (ids of `atelier.pipeline/1`), what a run reports progress on. */
  nodeIds: string[]
  /** The pipeline inputs its nodes read (`$inputs.<id>`). */
  reads: string[]
  /** The engine it runs on (the pipeline's pick, else the family's default), null for local code. */
  engine: string | null
  /** The engine was left open: the family's default is shown. */
  engineDefault: boolean
  fallbacks: string[]
  style: string | null
  /** The owner checks what it makes before the run goes on (a lock on the node). */
  gate: boolean
  /** Not in the pipeline: the option, at its current value, removes it (greyed, edges dashed). */
  off: { option: string; labelKey: string } | null
}

export interface GraphEdgeView {
  from: string
  to: string
  /** The slot it carries (`script`, `voice`…). */
  slot: string
  /** It touches a brick an option removed (dashed). */
  off: boolean
}

export interface GraphInputView {
  id: string
  label: string
  required: boolean
  /** Where the pipeline takes it from (R6.8); absent: asked for each video. */
  source: 'project' | 'channel' | 'fixed'
}

export interface PipelineGraphView {
  ok: boolean
  /** Why it does not compile (then no node). */
  errors: RecipeIssueView[]
  nodes: GraphNodeView[]
  edges: GraphEdgeView[]
  inputs: GraphInputView[]
  /** The brick that hands over the finished video (the package, else the render). */
  output: string | null
}
