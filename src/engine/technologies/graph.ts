// The read-only graph of a pipeline (decision 0023, docs/specs/production-model.md §11): what the compiler returns, seen
// brick by brick. One node per brick of the compiled pipeline (its engine, fallbacks, style, owner gate, the pipeline
// nodes it runs), one edge per slot a brick reads from another (read from the compiled nodes' wiring, so a translation or
// a fact check that replaces the script moves the edges as it moves the run). An option whose current value only removes
// bricks (music « none », sponsor « off », fact check off) shows them anyway, `off`: the pipeline is compiled once more
// with that option on, and the removed bricks and their edges come from that second compile, flagged; every other node
// and edge comes from the real compile. Pure: no I/O.
import { DEFAULT_ENGINES } from '../../shared/cloud-engines'
import type { GraphEdgeView, GraphInputView, GraphNodeView, PipelineGraphView } from '../../shared/pipeline-graph'
import { basePipeline } from './bases'
import { compileRecipe, type CompileOptions, type CompileResult } from './compile'
import { optionValues } from './options'
import type { OptionValue, RecipeDoc } from './recipe'
import type { TechnologyRegistry } from './registry'
import { techName, type AnyTechnology } from './types'

type Compiled = Extract<CompileResult, { ok: true }>

/** The bricks the options switch off, by brick name: the option, and the value that would put the brick back. */
export function offBricks(doc: RecipeDoc, present: ReadonlySet<string>): Map<string, { option: string; labelKey: string; on: OptionValue }> {
  const out = new Map<string, { option: string; labelKey: string; on: OptionValue }>()
  const base = basePipeline(doc.base)
  if (!base) return out
  const values = optionValues(doc, base.options)
  for (const d of base.options) {
    if (d.kind === 'slider' || d.soon) continue
    const current = d.choices.find((c) => c.value === values[d.id])
    if (!current) continue
    // a swap (script by the agent / imported) is a choice, not a switch off: only a value that adds nothing counts
    if (current.effects.some((e) => e.op === 'addBrick')) continue
    for (const e of current.effects) {
      if (e.op !== 'removeBrick' || present.has(e.brick)) continue
      const on = d.choices.find((c) => !c.soon && c.effects.some((x) => x.op === 'addBrick' && techName(x.tech as `${string}@${number}`) === e.brick))
      if (on && !out.has(e.brick)) out.set(e.brick, { option: d.id, labelKey: d.labelKey, on: on.value })
    }
  }
  return out
}

/** Pipeline node id → brick name, for the bricks of a compiled document. */
function owners(c: Compiled, reg: TechnologyRegistry): Map<string, AnyTechnology> {
  const out = new Map<string, AnyTechnology>()
  for (const b of c.doc.bricks) {
    const t = reg.get(b.tech)
    if (t) for (const n of t.nodes) out.set(n.id, t)
  }
  return out
}

/** One edge per (from, to, slot) a compiled pipeline wires between two bricks. */
function edgesOf(c: Compiled, reg: TechnologyRegistry): GraphEdgeView[] {
  const owner = owners(c, reg)
  const seen = new Set<string>()
  const out: GraphEdgeView[] = []
  for (const n of c.pipeline.nodes) {
    const to = owner.get(n.id)
    if (!to) continue
    for (const ref of Object.values(n.in ?? {})) {
      const m = /^([^.$][^.]*)\.(.+)$/.exec(ref)
      const from = m ? owner.get(m[1] as string) : undefined
      if (!m || !from || from === to) continue
      const slot = Object.entries(from.provides).find(([, r]) => r === ref)?.[0] ?? (m[2] as string)
      const key = `${techName(from.id)}|${techName(to.id)}|${slot}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ from: techName(from.id), to: techName(to.id), slot, off: false })
    }
  }
  return out
}

function nodesOf(c: Compiled, reg: TechnologyRegistry): GraphNodeView[] {
  const gated = new Set(c.pipeline.nodes.filter((n) => n.gate === 'owner').map((n) => n.id))
  const byId = new Map(c.pipeline.nodes.map((n) => [n.id, n]))
  const out: GraphNodeView[] = []
  for (const b of c.doc.bricks) {
    const t = reg.get(b.tech)
    if (!t) continue
    const name = techName(t.id)
    const pin = c.pins[name]
    const fallback = t.engineFamily ? DEFAULT_ENGINES[t.engineFamily] : null
    const engine = pin?.engine ?? fallback?.engine ?? null
    out.push({
      id: name,
      tech: t.id,
      labelKey: t.labelKey,
      stage: t.stage,
      kind: t.kind,
      nodeIds: t.nodes.map((n) => n.id),
      reads: [...new Set(t.nodes.flatMap((n) => Object.values(byId.get(n.id)?.in ?? {}).flatMap((r) => /^\$inputs\.([a-zA-Z0-9_]+)/.exec(r)?.[1] ?? [])))],
      engine,
      engineDefault: engine !== null && !pin?.engine,
      fallbacks: pin?.engine ? [...pin.fallbacks] : fallback ? [...fallback.fallbacks] : [],
      style: pin?.style ?? null,
      gate: t.nodes.some((n) => gated.has(n.id)),
      off: null
    })
  }
  return out
}

function inputsOf(c: Compiled): GraphInputView[] {
  return c.pipeline.inputs.map((i) => {
    const src = c.doc.inputs[i.id]
    return { id: i.id, label: i.label, required: i.required === true, source: src === undefined ? 'project' : typeof src === 'string' ? src : 'fixed' }
  })
}

/** The graph of a pipeline document, compiled with the same options a run would use. */
export function pipelineGraph(doc: RecipeDoc, reg: TechnologyRegistry, o: CompileOptions = {}): PipelineGraphView {
  const c = compileRecipe(doc, reg, o)
  if (!c.ok) return { ok: false, errors: c.errors, nodes: [], edges: [], inputs: [], output: null }
  const nodes = nodesOf(c, reg)
  const edges = edgesOf(c, reg)
  const present = new Set(nodes.map((n) => n.id))
  const off = offBricks(c.doc, present)
  if (off.size > 0) {
    const on: Record<string, OptionValue> = { ...doc.options }
    for (const x of off.values()) on[x.option] = x.on
    const full = compileRecipe({ ...doc, options: on }, reg, o)
    if (full.ok) {
      const ghosts = nodesOf(full, reg).filter((n) => off.has(n.id))
      for (const g of ghosts) {
        const why = off.get(g.id)
        // a removed brick runs nothing, so it holds no gate either
        nodes.push({ ...g, gate: false, off: why ? { option: why.option, labelKey: why.labelKey } : null })
      }
      const ghostIds = new Set(ghosts.map((g) => g.id))
      for (const e of edgesOf(full, reg)) if (ghostIds.has(e.from) || ghostIds.has(e.to)) edges.push({ ...e, off: true })
    }
  }
  const providerOf = (slot: string): string | null => {
    const ref = c.doc.bricks.map((b) => reg.get(b.tech)).filter((t): t is AnyTechnology => !!t && slot in t.provides).at(-1)
    return ref ? techName(ref.id) : null
  }
  return { ok: true, errors: [], nodes, edges, inputs: inputsOf(c), output: providerOf('package') ?? providerOf('video') }
}
