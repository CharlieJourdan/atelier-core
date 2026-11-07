// The node contract and the node registry (docs/ENGINE-SPEC.md §2). The registry is the single source for validation,
// estimates and scheduling (R2.6). Versions of one node live side by side (R2.1): `voice.tts@1` and `voice.tts@2` are
// two registrations, and a pipeline keeps resolving the version it names.
import type { z } from 'zod'
import { isArtefactType, type Artefact, type NodeOutputs } from './artefacts'
import { EngineError } from './errors'
import type { EngineServices } from './services'
import {
  EXECUTORS,
  GATES,
  type ArtefactType,
  type BudgetMode,
  type Cost,
  type Estimate,
  type Executor,
  type Gate,
  type Json,
  type NodeTypeId
} from './types'

export interface PortSpec {
  type: ArtefactType
  required: boolean
  label?: string
}

/** What a node may report while it runs. `start` and the terminal events belong to the engine (R8.1). */
export type NodeReport = { kind: 'progress'; frac: number; text?: string } | { kind: 'log'; level: 'info' | 'warn'; text: string }

/** Read access to stored artefacts (R2.2: a node reads its inputs through the store). */
export interface ArtefactReader {
  read(fingerprint: string): Promise<Artefact | null>
}

/**
 * Run-wide settings a node may read from its `RunCtx`. Each one a node declares in `NodeDef.reads` enters its
 * fingerprint (R7.1), so changing it reruns that node and its dependents only (R7.4).
 */
export const RUN_SETTINGS = ['minutes', 'budgetMode'] as const
export type RunSetting = (typeof RUN_SETTINGS)[number]
export interface RunSettings {
  minutes: number
  budgetMode: BudgetMode
}

export interface RunCtx {
  emit(report: NodeReport): void
  /** Aborted on cancel: the node stops promptly, releases its child processes and rejects (R2.3). */
  signal: AbortSignal
  store: ArtefactReader
  /** The only source of variation a node may use for content decisions (R2.5, R7.5). */
  seed: number
  /** Readable only when the node declares `reads: ['budgetMode']` (it is then in the fingerprint); else it throws. */
  budgetMode: BudgetMode
  where: Executor
  /** 1-based attempt number (retries, R10.1). */
  attempt: number
  /** Change requests made at this node's gate, oldest first (R11.3). */
  notes: string[]
  /** Target duration of the video, in minutes. Readable only when the node declares `reads: ['minutes']`; else it throws. */
  minutes: number
  /** What the node really used, in its estimate's units (R9.3: the paid node settles at this cost). */
  reportCost(cost: Cost): void
  /** What the host injects (ENGINE-SPEC §15.7): Claude, Atelier Cloud, ffmpeg, system voice, files, library. */
  services: EngineServices
}

/** A node's `RunCtx` without its run-wide settings; `createRunCtx` adds them. */
export type RunCtxBase = Omit<RunCtx, RunSetting>

/**
 * The one way to build a node's `RunCtx` (the scheduler and node unit tests use it): `minutes` and `budgetMode` are
 * readable only when the node declares them in `reads`, because only then are they in its fingerprint. They are
 * non-enumerable getters: `{ ...ctx }` drops them, so wrap a context with `Object.create(ctx)` instead of spreading it.
 */
export function createRunCtx(def: Pick<AnyNodeDef, 'type' | 'reads'>, base: RunCtxBase, settings: RunSettings): RunCtx {
  const ctx = { ...base } as RunCtx
  for (const s of RUN_SETTINGS) {
    Object.defineProperty(ctx, s, {
      enumerable: false,
      get: () => {
        if (def.reads?.includes(s)) return settings[s]
        throw new EngineError('internal', `${def.type} reads ctx.${s} without declaring it in "reads"`)
      }
    })
  }
  return ctx
}

export interface EstimateCtx {
  where: Executor
  budgetMode: BudgetMode
  /** Target duration of the video, in minutes (the pipeline format's default unless the launch says otherwise). */
  minutes: number
  /**
   * What is known of the artefacts wired to the inputs: their metadata when they exist (cached upstream) or when the node
   * that makes them forecasts it (`NodeDef.forecast`), and the text a pipeline input was launched with.
   */
  inputs: Record<string, { type: ArtefactType; meta?: Record<string, Json>; value?: Json } | undefined>
}

export type ResolvedInputs = Record<string, Artefact>

export interface NodeDef<P = unknown> {
  type: NodeTypeId
  inputs: Record<string, PortSpec>
  outputs: Record<string, ArtefactType>
  /** Validates params and applies their defaults. */
  params: z.ZodType<P>
  /** Where it may run; the first one is the default. */
  executors: readonly Executor[]
  /** Set for Claude nodes (R1.4): they count against the Claude concurrency limit. */
  claudeRole?: string
  /** Heavy local rendering: counts against the per-machine render limit when it runs locally (R6.2). */
  render?: boolean
  defaultGate?: Gate
  /**
   * Run-wide settings its output depends on (e.g. a script reads the target `minutes`). They enter its fingerprint;
   * reading an undeclared one from `RunCtx` fails the node, so a stale result is never reused. Estimates may read them
   * freely (an estimate changes no output).
   */
  reads?: readonly RunSetting[]
  /**
   * The version of the demo implementation (`fake`): it enters a demo run's fingerprint, so a demo whose code changed is made
   * again instead of served from the cache (moteur-pov-2: a free demo kept showing the old drawn director). Absent: none.
   */
  fakeVersion?: number
  /** Pure and deterministic, no I/O, no spending (R2.4). */
  estimate(ctx: EstimateCtx, params: P): Estimate
  /**
   * The metadata of its outputs before it has run, from its params and the video's length (pure, no I/O): what a quote reads when
   * the nodes downstream estimate their bill from this node's meta (the director's list of pictures, clips and presenter seconds).
   * Absent, or an output left out: nothing is known until the node has run.
   */
  forecast?(ctx: EstimateCtx, params: P): Record<string, Record<string, Json>>
  /**
   * Paid work its item cache keeps for a later run (issue #115): `kind` names the ledger, `key` is made of the fingerprints of the
   * inputs the cached items depend on (null when one is not known yet). The quote bills only what goes beyond what the ledger holds.
   */
  reuse?: { kind: string; key(fingerprints: Record<string, string | undefined>, params: P): string | null }
  run(ctx: RunCtx, inputs: ResolvedInputs, params: P): Promise<NodeOutputs>
  /** Used by tests and demo mode (R1.6). */
  fake(ctx: RunCtx, inputs: ResolvedInputs, params: P): Promise<NodeOutputs>
}

/** A registered node with its params type erased (the registry checks params with the def's own schema). */
export type AnyNodeDef = NodeDef<unknown>

/** Keeps `P` checked while writing a node, then erases it for the registry. */
export const defineNode = <P>(def: NodeDef<P>): AnyNodeDef => def as unknown as AnyNodeDef

const TYPE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*@[1-9][0-9]*$/
const PORT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/

export class RegistryError extends Error {
  override name = 'RegistryError'
}

export class NodeRegistry {
  private readonly defs = new Map<string, AnyNodeDef>()

  constructor(defs: readonly AnyNodeDef[] = []) {
    for (const d of defs) this.register(d)
  }

  /** Adds one node version. Refuses a malformed definition or a second registration of the same `name@version`. */
  register(def: AnyNodeDef): void {
    const problems: string[] = []
    if (!TYPE_ID.test(def.type)) problems.push(`type id "${def.type}" is not name@version`)
    if (this.defs.has(def.type)) problems.push(`${def.type} is already registered`)
    for (const [name, port] of Object.entries(def.inputs)) {
      if (!PORT_NAME.test(name)) problems.push(`input "${name}" is not a valid port name`)
      if (!isArtefactType(port.type)) problems.push(`input "${name}" has unknown type "${port.type}"`)
    }
    if (Object.keys(def.outputs).length === 0) problems.push('a node declares at least one output')
    for (const [name, type] of Object.entries(def.outputs)) {
      if (!PORT_NAME.test(name)) problems.push(`output "${name}" is not a valid port name`)
      if (!isArtefactType(type)) problems.push(`output "${name}" has unknown type "${type}"`)
    }
    if (def.executors.length === 0) problems.push('a node runs on at least one executor')
    for (const e of def.executors) if (!EXECUTORS.includes(e)) problems.push(`unknown executor "${e}"`)
    if (new Set(def.executors).size !== def.executors.length) problems.push('executors are listed twice')
    if (def.defaultGate && !GATES.includes(def.defaultGate)) problems.push(`unknown gate "${def.defaultGate}"`)
    for (const s of def.reads ?? []) if (!RUN_SETTINGS.includes(s)) problems.push(`unknown run setting "${s}"`)
    if (def.reads && new Set(def.reads).size !== def.reads.length) problems.push('run settings are listed twice')
    if (problems.length > 0) throw new RegistryError(`${def.type}: ${problems.join('; ')}`)
    this.defs.set(def.type, def)
  }

  get(type: string): AnyNodeDef | undefined {
    return this.defs.get(type)
  }

  has(type: string): boolean {
    return this.defs.has(type)
  }

  /** Every registered version, sorted by type id (the Builder's catalogue, R2.6). */
  list(): AnyNodeDef[] {
    return [...this.defs.values()].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
  }
}
