// Run-time resolution of a valid pipeline (docs/ENGINE-SPEC.md R5.1, R5.4, R6.3, R7.1): a node's params for the active
// budget mode with `$style` / `$inputs` substituted, where it runs, and its fingerprint from its inputs'.
import { compositeFingerprint, contentFingerprint, nodeFingerprint } from './canonical'
import { EngineError } from './errors'
import { PARAM_REF_PATTERN } from './pipeline-schema'
import type { AnyNodeDef, RunSettings } from './registry'
import type { NodeStateStore } from './state'
import { isProvisional, type ArtefactStore, type StoredRun } from './store'
import type { BudgetMode, Estimate, Executor, Json } from './types'
import type { ResolvedNode } from './validate'

/** A pipeline input given at launch: a JSON value (text…) or files whose content hash the host computed. */
export type InputValue = { value: Json; meta?: Record<string, Json> } | { files: string[]; fingerprint: string; meta?: Record<string, Json> }
export type LaunchInputs = Record<string, InputValue | undefined>

const PARAM_REF = new RegExp(PARAM_REF_PATTERN)

/**
 * A pipeline input's fingerprint: its content hash, combined with its `meta` when it has one (nodes and estimates read
 * the meta, so a new duration or language for the same bytes is a new input). Without meta it is the content hash.
 */
export function inputFingerprint(v: InputValue): string {
  const content = 'files' in v ? v.fingerprint : contentFingerprint({ value: v.value })
  if (!v.meta || !Object.values(v.meta).some((m) => m !== undefined)) return content
  // a composite (its own domain): never equal to the content hash of a value that happens to look like {content, meta}
  return compositeFingerprint('input', { content, meta: contentFingerprint({ value: v.meta }) })
}

/** The run-wide settings a node declares it reads (`NodeDef.reads`), as they enter its fingerprint. */
export function declaredSettings(def: AnyNodeDef, run: RunSettings): Record<string, Json> {
  const out: Record<string, Json> = {}
  for (const s of def.reads ?? []) out[s] = run[s]
  return out
}

/** Params for `mode`: `params` shallow-merged with `modes[mode]` (R5.4), references substituted (R5.1). */
export function resolveNodeParams(
  rn: ResolvedNode,
  mode: BudgetMode,
  inputs: LaunchInputs,
  style: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(rn.node.params ?? {}), ...(rn.node.modes?.[mode] ?? {}) }
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== 'string' || !PARAM_REF.test(value)) continue
    const field = value.slice(value.indexOf('.') + 1)
    if (value.startsWith('$style.')) {
      if (!Object.hasOwn(style, field)) throw new EngineError('unknown_ref', `the channel style has no field "${field}"`)
      merged[key] = style[field]
    } else {
      const inp = inputs[field]
      if (inp === undefined) {
        delete merged[key] // an optional input left empty: the param falls back to its default
      } else if ('files' in inp) {
        throw new EngineError('bad_params', `param "${key}" reads input "${field}", which is a file: wire it through "in"`)
      } else merged[key] = inp.value
    }
  }
  return merged
}

/** Validates resolved params with the node's schema (defaults applied), or fails the node permanently. */
export function parseNodeParams(def: AnyNodeDef, params: Record<string, unknown>): unknown {
  const res = def.params.safeParse(params)
  if (!res.success) {
    const first = res.error.issues[0]
    throw new EngineError('bad_params', `${def.type}: ${first ? `${first.path.join('.')} ${first.message}` : 'invalid params'}`)
  }
  return res.data
}

/**
 * Where a node runs (R5.3, R6.3). An explicit executor wins (validation checked it is allowed); no `where` means the
 * node's first executor; `auto` follows the budget mode: `usage_max` prefers `local` (free), else the first allowed;
 * `qualite_max` takes the allowed executor with the shortest estimated duration (ties: declaration order).
 */
export function resolveExecutor(
  def: AnyNodeDef,
  where: Executor | 'auto' | undefined,
  mode: BudgetMode,
  estimateFor: (w: Executor) => Estimate
): Executor {
  const first = def.executors[0] as Executor
  if (where === undefined) return first
  if (where !== 'auto') return where
  if (mode === 'usage_max') return def.executors.includes('local') ? 'local' : first
  let best = first
  let bestS = Infinity
  for (const e of def.executors) {
    const s = estimateFor(e).durationS
    if (s < bestS) {
      best = e
      bestS = s
    }
  }
  return best
}

/**
 * Fingerprints of the artefacts wired to each input port, or null while an upstream node has no result yet.
 * `known` maps a finished node id to its outputs' fingerprints. An optional pipeline input left empty is omitted.
 */
export function inputFingerprints(
  rn: ResolvedNode,
  known: Map<string, Record<string, string>>,
  inputs: LaunchInputs
): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const [port, ref] of Object.entries(rn.node.in ?? {})) {
    const dot = ref.indexOf('.')
    const root = ref.slice(0, dot)
    const name = ref.slice(dot + 1)
    if (root === '$inputs') {
      const v = inputs[name]
      if (v !== undefined) out[port] = inputFingerprint(v)
      continue
    }
    const fp = known.get(root)?.[name]
    if (fp === undefined) return null
    out[port] = fp
  }
  return out
}

/** The stored result of a node run, or the user's replacement of it when one was made at its gate (R11.3). */
export async function effectiveRun(
  store: ArtefactStore,
  state: NodeStateStore | undefined,
  scope: string,
  nodeId: string,
  fp: string
): Promise<StoredRun | null> {
  const replaced = state?.override(scope, nodeId, fp)
  if (replaced) {
    const run = await store.getRun(replaced)
    if (run) return run
  }
  const run = await store.getRun(fp)
  // an output its node marked provisional (pictures that could not be made, filled for now) is never reused: the node runs
  // again and remakes only what is missing (production-17)
  return run && !isProvisional(run) ? run : null
}

/** What else a node-run fingerprint depends on (an object, so later lots add fields without reordering arguments). */
export interface NodeRunFingerprintOptions {
  /** The run's settings; only those the node declares in `reads` enter the fingerprint. */
  run: RunSettings
  /** `true` when the node's demo implementation runs (`useFakes`): `impl: 'fake'` enters the fingerprint (R1.6). */
  fake?: boolean
}

/**
 * The node run's fingerprint (R7.1) once every upstream result is known; the executor is not part of it (H2). The
 * run-wide settings enter it only for a node that declares it reads them (`NodeDef.reads`).
 */
export function nodeRunFingerprint(
  rn: ResolvedNode,
  parsedParams: unknown,
  known: Map<string, Record<string, string>>,
  inputs: LaunchInputs,
  seed: number,
  notes: string[],
  opts: NodeRunFingerprintOptions
): string | null {
  const { run, fake = false } = opts
  const fps = inputFingerprints(rn, known, inputs)
  if (!fps) return null
  return nodeFingerprint({
    type: rn.def.type,
    params: (parsedParams ?? {}) as Record<string, unknown>,
    inputs: fps,
    seed,
    notes,
    settings: declaredSettings(rn.def, run),
    ...(fake ? { impl: 'fake' as const, ...(rn.def.fakeVersion ? { fakeVersion: rn.def.fakeVersion } : {}) } : {})
  })
}
