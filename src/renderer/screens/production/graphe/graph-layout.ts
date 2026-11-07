// Where each brick of a pipeline graph sits (production-13, docs/specs/production-model.md §11). The seven stages follow
// each other along the flow; inside a stage, a brick that reads another brick of the same stage moves one step further
// (the sponsor mentions after the script), and bricks with nothing between them stand at the same step, side by side:
// those are the parallel branches (pictures and presenter, captions and music). At each step the bricks are ordered by
// where what feeds them sits, then centred, so the main line runs straight. Two orientations, the same graph:
// `horizontal` (stages as columns, left to right, n8n-like: when the canvas is wide enough) and `vertical` (stages as
// bands, top to bottom: in the editor's column, where a left-to-right avatar@1 would only read at a third of its size,
// decision 0033). The inputs come first, the finished video last. Pure geometry, no React (unit-tested); our own code.
import { RECIPE_STAGES, type RecipeStage } from '../../../../shared/recipes'
import type { GraphEdgeView, PipelineGraphView } from '../../../../shared/pipeline-graph'

export type Orientation = 'horizontal' | 'vertical'

export const NODE_W = 196
export const NODE_H = 100
export const PAD = 20
/** Horizontal: gap between steps (columns), between stacked bricks, height of the stage headers, inputs card width. */
export const COL_GAP = 56
export const ROW_GAP = 18
export const HEAD_H = 44
export const SIDE_W = 152
/** Vertical: gap between steps (rows), between bricks side by side, width of the stage labels, inputs card row. */
export const STEP_GAP = 44
export const SIDE_GAP = 20
export const LABEL_W = 132
export const INPUT_ROW_H = 34
export const END_W = 172
export const END_H = 64
/** Vertical: at most this many bricks side by side; more parallel bricks at one step wrap onto a second row (production-9). */
export const MAX_ACROSS = 3

export interface Placed {
  id: string
  x: number
  y: number
  /** Step along the flow (0 = first step of the first stage present). */
  col: number
}

/** A stage's band: its rectangle, and where its number and name go. */
export interface StageBand {
  stage: RecipeStage
  x: number
  y: number
  width: number
  height: number
}

export interface DrawnEdge {
  from: string
  to: string
  /** The slots it carries (one drawn line per pair of bricks). */
  slots: string[]
  off: boolean
  d: string
  /** Middle of the curve, for its label. */
  mid: { x: number; y: number }
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface GraphLayout {
  orientation: Orientation
  width: number
  height: number
  nodes: Map<string, Placed>
  stages: StageBand[]
  edges: DrawnEdge[]
  /** The inputs card and the finished video, with the lines that join them to the bricks. */
  side: Box | null
  /** Columns of the inputs list in its card. */
  sideCols: number
  sideEdges: { to: string; d: string }[]
  end: Box | null
  endEdge: string | null
}

/** A smooth curve from an out port to an in port, along the flow. */
export function curve(o: Orientation, x1: number, y1: number, x2: number, y2: number): string {
  if (o === 'horizontal') {
    const dx = Math.max(36, Math.abs(x2 - x1) / 2)
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
  }
  const dy = Math.max(28, Math.abs(y2 - y1) / 2)
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`
}

/** The step of each brick inside its stage: 1 + the deepest brick of the same stage it reads from. */
export function depths(graph: PipelineGraphView): Map<string, number> {
  const stageOf = new Map(graph.nodes.map((n) => [n.id, n.stage]))
  const depth = new Map(graph.nodes.map((n) => [n.id, 0]))
  // relax as many times as there are bricks: enough for any chain, and safe if two bricks ever read each other
  for (let i = 0; i < graph.nodes.length; i++) {
    let moved = false
    for (const e of graph.edges) {
      if (e.from === e.to || stageOf.get(e.from) !== stageOf.get(e.to)) continue
      const want = (depth.get(e.from) ?? 0) + 1
      if (want > (depth.get(e.to) ?? 0) && want < graph.nodes.length) {
        depth.set(e.to, want)
        moved = true
      }
    }
    if (!moved) break
  }
  return depth
}

/** One drawn line per pair of bricks; it is dashed only when every slot it carries is (a removed brick). */
export function mergeEdges(edges: readonly GraphEdgeView[]): { from: string; to: string; slots: string[]; off: boolean }[] {
  const out = new Map<string, { from: string; to: string; slots: string[]; off: boolean }>()
  for (const e of edges) {
    const key = `${e.from}>${e.to}`
    const m = out.get(key)
    if (m) {
      m.slots.push(e.slot)
      m.off = m.off && e.off
    } else out.set(key, { from: e.from, to: e.to, slots: [e.slot], off: e.off })
  }
  return [...out.values()]
}

export function layoutGraph(graph: PipelineGraphView, orientation: Orientation = 'horizontal'): GraphLayout {
  const h = orientation === 'horizontal'
  const depth = depths(graph)
  const order = new Map(graph.nodes.map((n, i) => [n.id, i]))
  const present = RECIPE_STAGES.filter((s) => graph.nodes.some((n) => n.stage === s))

  // steps: each stage present takes as many steps as its deepest brick needs
  const stepOf = new Map<string, number>()
  const spans: { stage: RecipeStage; first: number; count: number }[] = []
  let steps = 0
  for (const s of present) {
    const inStage = graph.nodes.filter((n) => n.stage === s)
    const count = Math.max(...inStage.map((n) => depth.get(n.id) ?? 0)) + 1
    for (const n of inStage) stepOf.set(n.id, steps + (depth.get(n.id) ?? 0))
    spans.push({ stage: s, first: steps, count })
    steps += count
  }
  const atStep: string[][] = Array.from({ length: steps }, () => [])
  for (const n of graph.nodes) atStep[stepOf.get(n.id) ?? 0]?.push(n.id)
  // the rows of each step: one when horizontal; vertical, a step wider than MAX_ACROSS wraps (the editor's column stays narrow)
  const perRow = h ? Number.POSITIVE_INFINITY : MAX_ACROSS
  const rowsAt = atStep.map((ids) => Math.max(1, Math.ceil(ids.length / perRow)))
  const rowStart: number[] = []
  let totalRows = 0
  for (const r of rowsAt) {
    rowStart.push(totalRows)
    totalRows += r
  }
  const widest = Math.max(1, ...atStep.map((c) => Math.min(perRow, c.length)))

  // along the flow (`along`) and across it (`across`), whatever the orientation
  const alongSize = h ? NODE_W : NODE_H
  const acrossSize = h ? NODE_H : NODE_W
  const alongGap = h ? COL_GAP : STEP_GAP
  const acrossGap = h ? ROW_GAP : SIDE_GAP
  const stack = (k: number): number => k * acrossSize + Math.max(0, k - 1) * acrossGap
  const hasSide = graph.inputs.length > 0
  const inputCols = Math.max(1, Math.min(3, Math.floor((stack(widest) + 1) / 168)))
  const sideAcross = h ? SIDE_W : stack(widest)
  const sideAlong = h ? SIDE_W : 40 + Math.ceil(graph.inputs.length / inputCols) * INPUT_ROW_H
  const flowStart = PAD + (hasSide ? sideAlong + alongGap : 0)
  const acrossStart = h ? HEAD_H + PAD : LABEL_W + PAD
  // the inputs card stands beside the columns: they make room for it
  const sideTall = 40 + graph.inputs.length * INPUT_ROW_H
  const span = h && hasSide ? Math.max(stack(widest), sideTall) : stack(widest)
  const mid = acrossStart + span / 2
  const preds = new Map<string, string[]>()
  for (const e of graph.edges) preds.set(e.to, [...(preds.get(e.to) ?? []), e.from])

  const nodes = new Map<string, Placed>()
  const place = (along: number, across: number): { x: number; y: number } => (h ? { x: along, y: across } : { x: across, y: along })
  const acrossOf = (p: Placed): number => (h ? p.y : p.x) + acrossSize / 2
  atStep.forEach((ids, c) => {
    const centreOf = (id: string): number => {
      const vs = (preds.get(id) ?? []).map((p) => nodes.get(p)).filter((p): p is Placed => !!p && p.col < c).map(acrossOf)
      return vs.length > 0 ? vs.reduce((a, b) => a + b, 0) / vs.length : mid
    }
    const sorted = [...ids].sort((a, b) => centreOf(a) - centreOf(b) || (order.get(a) ?? 0) - (order.get(b) ?? 0))
    sorted.forEach((id, i) => {
      const sub = Math.floor(i / perRow)
      // (0 × Infinity is NaN: the first row starts at 0 whatever the width)
      const before = sub === 0 ? 0 : sub * perRow
      const inRow = Math.min(perRow, sorted.length - before)
      const top = mid - stack(inRow) / 2
      const along = flowStart + ((rowStart[c] ?? c) + sub) * (alongSize + alongGap)
      nodes.set(id, { id, col: c, ...place(along, top + (i - before) * (acrossSize + acrossGap)) })
    })
  })

  const flowEnd = flowStart + totalRows * (alongSize + alongGap) - alongGap
  const out = (p: Placed) => (h ? { x: p.x + NODE_W, y: p.y + NODE_H / 2 } : { x: p.x + NODE_W / 2, y: p.y + NODE_H })
  const inn = (p: Placed) => (h ? { x: p.x, y: p.y + NODE_H / 2 } : { x: p.x + NODE_W / 2, y: p.y })

  const edges: DrawnEdge[] = []
  for (const e of mergeEdges(graph.edges)) {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b) continue
    const p = out(a)
    const q = inn(b)
    edges.push({ ...e, d: curve(orientation, p.x, p.y, q.x, q.y), mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } })
  }

  const stages: StageBand[] = spans.map((s) => {
    const first = rowStart[s.first] ?? s.first
    const rows = (s.first + s.count < steps ? (rowStart[s.first + s.count] ?? totalRows) : totalRows) - first
    const along = flowStart + first * (alongSize + alongGap)
    const length = rows * alongSize + (rows - 1) * alongGap
    return h
      ? { stage: s.stage, x: along - 12, y: PAD / 2, width: length + 24, height: HEAD_H + span + PAD }
      : { stage: s.stage, x: PAD / 2, y: along - 12, width: LABEL_W + span + PAD, height: length + 24 }
  })

  const sideBox: Box | null = hasSide
    ? h
      ? { x: PAD, y: mid - sideTall / 2, width: SIDE_W, height: sideTall }
      : { x: acrossStart, y: PAD, width: sideAcross, height: sideAlong }
    : null
  const sideEdges = sideBox
    ? graph.nodes
        .filter((n) => n.reads.length > 0 && nodes.has(n.id))
        .map((n) => {
          const q = inn(nodes.get(n.id) as Placed)
          return h ? { to: n.id, d: curve(orientation, sideBox.x + sideBox.width, mid, q.x, q.y) } : { to: n.id, d: curve(orientation, q.x, sideBox.y + sideBox.height, q.x, q.y) }
        })
    : []

  const last = graph.output ? nodes.get(graph.output) : undefined
  const end: Box | null = last ? (h ? { x: flowEnd + alongGap, y: mid - END_H / 2, width: END_W, height: END_H } : { x: mid - END_W / 2, y: flowEnd + alongGap, width: END_W, height: END_H }) : null
  let endEdge: string | null = null
  if (last && end) {
    const p = out(last)
    endEdge = h ? curve(orientation, p.x, p.y, end.x, mid) : curve(orientation, p.x, p.y, mid, end.y)
  }
  const flowTotal = (end ? (h ? end.x + END_W : end.y + END_H) : flowEnd) + PAD
  const acrossTotal = acrossStart + span + PAD
  return { orientation, width: h ? flowTotal : acrossTotal, height: h ? acrossTotal : flowTotal, nodes, stages, edges, side: sideBox, sideCols: h ? 1 : inputCols, sideEdges, end, endEdge }
}
