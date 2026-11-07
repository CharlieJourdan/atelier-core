// Layout of a pipeline document as a left-to-right node graph (pure, no React). Nodes sit in columns by dependency depth
// (a node is one column right of its deepest parent); inside a column they are ordered by the mean row of their parents
// so edges stay short; columns are centred on the tallest one. Edges are cubic SVG paths from the right edge of a node
// to the left edge of the next. Cycles cannot come out of validated documents, but a hand-edited one must not hang.

export const NODE_W = 184
export const NODE_H = 56
export const COL_GAP = 64
export const ROW_GAP = 18
export const PAD = 16

export const NODE_KINDS = ['input', 'text', 'audio', 'plan', 'visual', 'output', 'other'] as const
export type NodeKind = (typeof NODE_KINDS)[number]

const KIND_BY_PREFIX: Readonly<Record<string, NodeKind>> = {
  research: 'text',
  script: 'text',
  voice: 'audio',
  sound: 'audio',
  beats: 'plan',
  director: 'plan',
  visuals: 'visual',
  captions: 'visual',
  render: 'output',
  package: 'output'
}

/** `voice.tts@1` gives `audio`; unknown families give `other`. */
export function kindOfType(type: string): NodeKind {
  const prefix = type.split('@')[0]?.split('.')[0] ?? ''
  return KIND_BY_PREFIX[prefix] ?? 'other'
}

export interface RawNode {
  id: string
  type: string
  in?: Record<string, string>
  params?: Record<string, unknown>
  gate?: string
  where?: string
  modes?: Record<string, Record<string, unknown> | undefined>
}

export interface RawInput {
  id: string
  kind: string
  label: string
  required?: boolean
  help?: string
}

export interface PipelineDoc {
  name: string
  minutes: { default: number; min: number; max: number } | null
  budgetDefault: string | null
  inputs: RawInput[]
  nodes: RawNode[]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Reads the parts of an `atelier.pipeline/1` document the canvas needs; null when it is not a usable document. */
export function parsePipelineDoc(json: string): PipelineDoc | null {
  let doc: unknown
  try {
    doc = JSON.parse(json)
  } catch {
    return null
  }
  if (!isObj(doc) || !Array.isArray(doc.nodes)) return null
  const nodes: RawNode[] = []
  for (const n of doc.nodes) {
    if (!isObj(n) || typeof n.id !== 'string' || typeof n.type !== 'string') continue
    const node: RawNode = { id: n.id, type: n.type }
    if (isObj(n.in)) {
      node.in = Object.fromEntries(Object.entries(n.in).filter((e): e is [string, string] => typeof e[1] === 'string'))
    }
    if (isObj(n.params)) node.params = n.params
    if (typeof n.gate === 'string') node.gate = n.gate
    if (typeof n.where === 'string') node.where = n.where
    if (isObj(n.modes)) node.modes = n.modes as RawNode['modes']
    nodes.push(node)
  }
  const inputs: RawInput[] = []
  if (Array.isArray(doc.inputs)) {
    for (const i of doc.inputs) {
      if (!isObj(i) || typeof i.id !== 'string') continue
      inputs.push({
        id: i.id,
        kind: typeof i.kind === 'string' ? i.kind : 'text',
        label: typeof i.label === 'string' ? i.label : i.id,
        ...(typeof i.required === 'boolean' ? { required: i.required } : {}),
        ...(typeof i.help === 'string' ? { help: i.help } : {})
      })
    }
  }
  const m = isObj(doc.format) && isObj(doc.format.minutes) ? doc.format.minutes : null
  const minutes =
    m && typeof m.default === 'number' && typeof m.min === 'number' && typeof m.max === 'number'
      ? { default: m.default, min: m.min, max: m.max }
      : null
  const budget = isObj(doc.budget) && typeof doc.budget.default === 'string' ? doc.budget.default : null
  return { name: typeof doc.name === 'string' ? doc.name : '', minutes, budgetDefault: budget, inputs, nodes }
}

export interface GraphNode {
  /** Node id; pipeline inputs are `$inputs.<id>`. */
  id: string
  title: string
  type: string
  kind: NodeKind
  isInput: boolean
  gate: string | null
  where: string | null
  depth: number
  row: number
  x: number
  y: number
  w: number
  h: number
}

export interface GraphEdge {
  from: string
  to: string
  port: string
  path: string
}

export interface GraphLayout {
  nodes: GraphNode[]
  edges: GraphEdge[]
  width: number
  height: number
}

/** The node a reference points at: `script.text` gives `script`, `$inputs.topic` stays itself, `$style.x` gives null. */
export function refSource(ref: string): string | null {
  if (ref.startsWith('$style.')) return null
  if (ref.startsWith('$inputs.')) return ref
  const dot = ref.indexOf('.')
  return dot > 0 ? ref.slice(0, dot) : null
}

export function layoutGraph(doc: PipelineDoc): GraphLayout {
  type Draft = Omit<GraphNode, 'row' | 'x' | 'y' | 'w' | 'h'>
  const drafts = new Map<string, Draft>()
  for (const i of doc.inputs) {
    drafts.set(`$inputs.${i.id}`, { id: `$inputs.${i.id}`, title: i.label, type: i.kind, kind: 'input', isInput: true, gate: null, where: null, depth: 0 })
  }
  for (const n of doc.nodes) {
    if (drafts.has(n.id)) continue
    drafts.set(n.id, { id: n.id, title: n.id, type: n.type, kind: kindOfType(n.type), isInput: false, gate: n.gate ?? null, where: n.where ?? null, depth: 0 })
  }

  const parents = new Map<string, { from: string; port: string }[]>()
  for (const n of doc.nodes) {
    const list: { from: string; port: string }[] = []
    for (const [port, ref] of Object.entries(n.in ?? {})) {
      const from = refSource(ref)
      if (from && from !== n.id && drafts.has(from)) list.push({ from, port })
    }
    parents.set(n.id, list)
  }

  const depthOf = new Map<string, number>()
  const visiting = new Set<string>()
  const depth = (id: string): number => {
    const known = depthOf.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    let d = 0
    for (const p of parents.get(id) ?? []) d = Math.max(d, depth(p.from) + 1)
    visiting.delete(id)
    depthOf.set(id, d)
    return d
  }
  for (const d of drafts.values()) d.depth = depth(d.id)

  const columns: Draft[][] = []
  for (const d of drafts.values()) (columns[d.depth] ??= []).push(d)
  const rowOf = new Map<string, number>()
  columns.forEach((col, ci) => {
    if (!col) return
    if (ci > 0) {
      const bary = (d: Draft): number => {
        const ps = parents.get(d.id) ?? []
        if (ps.length === 0) return 0
        return ps.reduce((sum, p) => sum + (rowOf.get(p.from) ?? 0), 0) / ps.length
      }
      const order = new Map(col.map((d, i) => [d.id, i]))
      col.sort((a, b) => bary(a) - bary(b) || (order.get(a.id) as number) - (order.get(b.id) as number))
    }
    col.forEach((d, r) => rowOf.set(d.id, r))
  })

  const colCount = columns.length
  const tallest = Math.max(1, ...columns.map((c) => c?.length ?? 0))
  const colHeight = (rows: number): number => rows * NODE_H + (rows - 1) * ROW_GAP
  const innerH = colHeight(tallest)
  const nodes: GraphNode[] = []
  columns.forEach((col, ci) => {
    if (!col) return
    const offset = (innerH - colHeight(col.length)) / 2
    col.forEach((d, r) => {
      nodes.push({ ...d, row: r, x: PAD + ci * (NODE_W + COL_GAP), y: PAD + offset + r * (NODE_H + ROW_GAP), w: NODE_W, h: NODE_H })
    })
  })

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges: GraphEdge[] = []
  for (const n of doc.nodes) {
    const to = byId.get(n.id)
    if (!to) continue
    for (const p of parents.get(n.id) ?? []) {
      const from = byId.get(p.from)
      if (!from) continue
      const x1 = from.x + from.w
      const y1 = from.y + from.h / 2
      const x2 = to.x
      const y2 = to.y + to.h / 2
      const dx = Math.max(24, (x2 - x1) / 2)
      edges.push({ from: from.id, to: to.id, port: p.port, path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}` })
    }
  }

  return {
    nodes,
    edges,
    width: PAD * 2 + Math.max(1, colCount) * NODE_W + Math.max(0, colCount - 1) * COL_GAP,
    height: PAD * 2 + innerH
  }
}
