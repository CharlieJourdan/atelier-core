// Validation of an `atelier.pipeline/1` document against the node registry (docs/ENGINE-SPEC.md R5.5, R3.2, R3.3).
// Every error is reported, each with a stable code and a path; an invalid pipeline is never quoted, saved nor run.
import { inputKindFeeds, edgeAccepts } from './artefacts'
import { PARAM_REF_PATTERN, PipelineSchema, type Pipeline, type PipelineNode } from './pipeline-schema'
import type { AnyNodeDef, NodeRegistry } from './registry'
import { BUDGET_MODES, type Gate } from './types'

export const VALIDATION_CODES = [
  'schema',
  'duplicate_id',
  'unknown_node_type',
  'bad_params',
  'unknown_ref',
  'unknown_port',
  'missing_input',
  'type_mismatch',
  'cycle',
  'bad_where'
] as const
export type ValidationCode = (typeof VALIDATION_CODES)[number]

export interface ValidationError {
  code: ValidationCode
  path: (string | number)[]
  message: string
}

/** One node of a valid pipeline, with what the scheduler needs. */
export interface ResolvedNode {
  node: PipelineNode
  def: AnyNodeDef
  /** Position in the document: ties between ready nodes go to the lowest (R6.2, decision). */
  index: number
  /** Ids of the nodes this one reads from (each once). */
  deps: string[]
  gate: Gate
}

export interface ResolvedPipeline {
  pipeline: Pipeline
  nodes: Map<string, ResolvedNode>
  /** A topological order; among nodes free at the same time, declaration order. */
  order: string[]
}

export type ValidationResult = { ok: true; plan: ResolvedPipeline } | { ok: false; errors: ValidationError[] }

export interface ValidateOptions {
  /** Fields of the channel style; when given, an unknown `$style.x` is an error (R5.1). */
  styleFields?: readonly string[]
}

const PARAM_REF = new RegExp(PARAM_REF_PATTERN)
const isParamRef = (v: unknown): v is string => typeof v === 'string' && PARAM_REF.test(v)

/** Splits `a.b` at its only dot (the schema guarantees the shape). */
const splitRef = (ref: string): [string, string] => {
  const i = ref.indexOf('.')
  return [ref.slice(0, i), ref.slice(i + 1)]
}

export function validatePipeline(doc: unknown, registry: NodeRegistry, opts: ValidateOptions = {}): ValidationResult {
  const parsed = PipelineSchema.safeParse(doc)
  if (!parsed.success) {
    // without the document's shape the graph rules cannot be checked meaningfully: report the shape errors alone
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        code: 'schema' as const,
        path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
        message: i.message
      }))
    }
  }
  const pipeline = parsed.data
  const errors: ValidationError[] = []
  const err = (code: ValidationCode, path: (string | number)[], message: string): void => {
    errors.push({ code, path, message })
  }

  const inputs = new Map<string, Pipeline['inputs'][number]>()
  pipeline.inputs.forEach((inp, i) => {
    if (inputs.has(inp.id)) err('duplicate_id', ['inputs', i, 'id'], `input "${inp.id}" is declared twice`)
    else inputs.set(inp.id, inp)
  })
  const byId = new Map<string, { node: PipelineNode; index: number }>()
  pipeline.nodes.forEach((node, i) => {
    if (byId.has(node.id)) err('duplicate_id', ['nodes', i, 'id'], `node "${node.id}" is declared twice`)
    else byId.set(node.id, { node, index: i })
  })
  const defOf = (nodeId: string): AnyNodeDef | undefined => {
    const n = byId.get(nodeId)
    return n ? registry.get(n.node.type) : undefined
  }
  const checkParamRef = (ref: string, path: (string | number)[]): void => {
    const [root, field] = splitRef(ref)
    if (root === '$inputs' && !inputs.has(field)) err('unknown_ref', path, `no pipeline input "${field}"`)
    if (root === '$style' && opts.styleFields && !opts.styleFields.includes(field)) {
      err('unknown_ref', path, `the channel style has no field "${field}"`)
    }
  }

  const deps = new Map<string, string[]>()
  pipeline.nodes.forEach((node, i) => {
    if (byId.get(node.id)?.index !== i) return // a duplicate: reported above, its wiring is not checked
    const at = ['nodes', i]
    const def = registry.get(node.type)
    const nodeDeps: string[] = []
    deps.set(node.id, nodeDeps)
    const wired = node.in ?? {}
    // references are followed even for an unknown node type, so the graph (and its cycles) stays checkable
    for (const [port, ref] of Object.entries(wired)) {
      const [root, name] = splitRef(ref)
      const portSpec = def?.inputs[port]
      if (def && !portSpec) err('unknown_port', [...at, 'in', port], `${node.type} has no input "${port}"`)
      if (root === '$inputs') {
        const inp = inputs.get(name)
        if (!inp) err('unknown_ref', [...at, 'in', port], `no pipeline input "${name}"`)
        else if (portSpec && !inputKindFeeds(inp.kind, portSpec.type)) {
          err('type_mismatch', [...at, 'in', port], `a ${inp.kind} input cannot feed ${portSpec.type}`)
        }
        continue
      }
      if (root === '$style') {
        err('unknown_ref', [...at, 'in', port], 'style fields are settings: reference them from params, not from in')
        continue
      }
      const src = byId.get(root)
      if (!src) {
        err('unknown_ref', [...at, 'in', port], `no node "${root}"`)
        continue
      }
      if (!nodeDeps.includes(root)) nodeDeps.push(root)
      const srcDef = defOf(root)
      if (!srcDef) continue // its unknown type is reported on that node
      const outType = srcDef.outputs[name]
      if (!outType) err('unknown_ref', [...at, 'in', port], `${srcDef.type} has no output "${name}"`)
      else if (portSpec && !edgeAccepts(outType, portSpec.type)) {
        err('type_mismatch', [...at, 'in', port], `${root}.${name} is ${outType}, input "${port}" expects ${portSpec.type}`)
      }
    }
    for (const [key, value] of Object.entries(node.params ?? {})) {
      if (isParamRef(value)) checkParamRef(value, [...at, 'params', key])
    }
    for (const mode of BUDGET_MODES) {
      for (const [key, value] of Object.entries(node.modes?.[mode] ?? {})) {
        if (isParamRef(value)) checkParamRef(value, [...at, 'modes', mode, key])
      }
    }
    if (!def) {
      err('unknown_node_type', [...at, 'type'], `no node type ${node.type} in the catalogue`)
      return
    }
    if (node.where && node.where !== 'auto' && !def.executors.includes(node.where)) {
      err('bad_where', [...at, 'where'], `${node.type} cannot run on "${node.where}" (allowed: ${def.executors.join(', ')})`)
    }
    for (const [port, spec] of Object.entries(def.inputs)) {
      if (spec.required && wired[port] === undefined) err('missing_input', [...at, 'in', port], `input "${port}" is required`)
    }
    checkParams(node, def, at, err)
    // a node that draws the picture says which shape it draws (its `aspect` param, default 16:9): it must be the film's
    const merged = { ...(node.params ?? {}) }
    const shape = def.params.safeParse(merged)
    const drawn = shape.success ? (shape.data as Record<string, unknown>).aspect : undefined
    if (typeof drawn === 'string' && drawn !== pipeline.format.aspect) {
      err('bad_params', [...at, 'params', 'aspect'], `the pipeline is ${pipeline.format.aspect} but ${node.id} draws ${drawn}: set its "aspect" to ${pipeline.format.aspect}`)
    }
  })

  for (const cycle of findCycles(pipeline.nodes.map((n) => n.id), deps)) {
    const first = byId.get(cycle[0] as string)?.index ?? 0
    err('cycle', ['nodes', first], `the graph loops: ${[...cycle, cycle[0]].join(' -> ')}`)
  }

  if (errors.length > 0) return { ok: false, errors }
  const nodes = new Map<string, ResolvedNode>()
  pipeline.nodes.forEach((node, index) => {
    const def = registry.get(node.type) as AnyNodeDef
    nodes.set(node.id, { node, def, index, deps: deps.get(node.id) ?? [], gate: node.gate ?? def.defaultGate ?? 'none' })
  })
  return { ok: true, plan: { pipeline, nodes, order: topoOrder(pipeline.nodes.map((n) => n.id), deps) } }
}

/** Params after each mode's overlay must pass the node's schema (R5.4, R5.5); reference values are checked later. */
function checkParams(
  node: PipelineNode,
  def: AnyNodeDef,
  at: (string | number)[],
  err: (code: ValidationCode, path: (string | number)[], message: string) => void
): void {
  const seen = new Set<string>()
  const variants = node.modes && Object.keys(node.modes).length > 0 ? BUDGET_MODES : ([null] as const)
  for (const mode of variants) {
    const merged: Record<string, unknown> = { ...(node.params ?? {}), ...(mode ? (node.modes?.[mode] ?? {}) : {}) }
    const refKeys = new Set(Object.keys(merged).filter((k) => isParamRef(merged[k])))
    const res = def.params.safeParse(merged)
    if (res.success) continue
    for (const issue of res.error.issues) {
      const key = issue.path[0]
      if (typeof key === 'string' && refKeys.has(key)) continue // resolved at run start, checked then
      const sub = issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))
      const sig = `${sub.join('.')}|${issue.message}`
      if (seen.has(sig)) continue
      seen.add(sig)
      const fromMode = mode !== null && typeof key === 'string' && node.modes?.[mode]?.[key] !== undefined
      err('bad_params', fromMode ? [...at, 'modes', mode, ...sub] : [...at, 'params', ...sub], issue.message)
    }
  }
}

/** Strongly connected components with more than one node, or a node reading itself (Tarjan, iterative-safe sizes). */
export function findCycles(ids: readonly string[], deps: Map<string, string[]>): string[][] {
  let counter = 0
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const cycles: string[][] = []
  const visit = (v: string): void => {
    index.set(v, counter)
    low.set(v, counter)
    counter++
    stack.push(v)
    onStack.add(v)
    for (const w of deps.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, index.get(w) as number))
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = []
      let w: string
      do {
        w = stack.pop() as string
        onStack.delete(w)
        comp.push(w)
      } while (w !== v)
      if (comp.length > 1 || (deps.get(v) ?? []).includes(v)) {
        const order = new Map(ids.map((id, i) => [id, i]))
        cycles.push(comp.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)))
      }
    }
  }
  for (const id of ids) if (!index.has(id)) visit(id)
  return cycles
}

/** Kahn's algorithm; among the nodes free at each step, the first declared goes first. */
function topoOrder(ids: readonly string[], deps: Map<string, string[]>): string[] {
  const done = new Set<string>()
  const order: string[] = []
  while (order.length < ids.length) {
    const next = ids.find((id) => !done.has(id) && (deps.get(id) ?? []).every((d) => done.has(d)))
    if (next === undefined) break // unreachable for a validated pipeline (no cycles)
    done.add(next)
    order.push(next)
  }
  return order
}
