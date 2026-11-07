// The live state of each brick of a pipeline graph during a run (production-13, R11.2): a brick runs one or more engine
// nodes, so its state is theirs put together: failed if one failed, waiting if one waits at its gate, running while one
// runs (or some are done and others not yet), done when all are done, reused when all were. Pure (unit-tested).
import type { PipelineGraphView } from '../../../../shared/pipeline-graph'
import type { RunNode, RunNodeState } from '../../../../shared/runs'

export interface BrickRunState {
  state: RunNodeState
  /** 0..1 over its nodes. */
  progress: number
  credits: number
  quote: number
  /** The run node to open when the brick is clicked: the one waiting, else the last that produced something. */
  pick: string | null
}

const FINISHED: readonly RunNodeState[] = ['done', 'cached']
const OPENABLE: readonly RunNodeState[] = ['done', 'cached', 'waiting_gate']

function together(states: readonly RunNodeState[]): RunNodeState {
  for (const s of ['error', 'waiting_gate', 'running', 'queued'] as const) if (states.includes(s)) return s
  if (states.every((s) => s === 'cached')) return 'cached'
  if (states.every((s) => FINISHED.includes(s))) return 'done'
  if (states.includes('cancelled')) return 'cancelled'
  return states.some((s) => FINISHED.includes(s)) ? 'running' : 'pending'
}

export function brickStates(graph: PipelineGraphView, nodes: readonly RunNode[]): Map<string, BrickRunState> {
  const out = new Map<string, BrickRunState>()
  for (const b of graph.nodes) {
    if (b.off) continue
    const mine = nodes.filter((n) => b.nodeIds.includes(n.nodeId))
    if (mine.length === 0) continue
    const progress = mine.reduce((a, n) => a + (FINISHED.includes(n.state) ? 1 : n.progress), 0) / mine.length
    const pick = mine.find((n) => n.state === 'waiting_gate') ?? [...mine].reverse().find((n) => OPENABLE.includes(n.state)) ?? null
    out.set(b.id, {
      state: together(mine.map((n) => n.state)),
      progress,
      credits: mine.reduce((a, n) => a + n.credits, 0),
      quote: mine.reduce((a, n) => a + n.quoteCredits, 0),
      pick: pick?.nodeId ?? null
    })
  }
  return out
}

/** The graph with each brick's gate as the run has it (the run is what ran; a brick it did not run keeps its own). */
export function withRunGates(graph: PipelineGraphView, nodes: readonly RunNode[]): PipelineGraphView {
  return {
    ...graph,
    nodes: graph.nodes.map((b) => {
      const mine = nodes.filter((n) => b.nodeIds.includes(n.nodeId))
      return mine.length === 0 ? b : { ...b, gate: mine.some((n) => n.gateKind !== 'none') }
    })
  }
}
