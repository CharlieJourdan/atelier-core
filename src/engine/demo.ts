// Runs the template pipeline of lot P4 end to end on a plain Node host (`npm run engine:demo`, the tests): a topic in,
// a 16:9 MP4 out. Demo mode by default (R1.6): every node's `fake` — template research and script, the system voice,
// drawn pictures — while the local stages (beats, director passes, captions, music, render, package) are the real code.
// Gates are approved automatically (all-at-once mode; the package's owner gate is approved by the caller's choice).
import path from 'node:path'
import { nodeHost } from './host'
import { productionRegistry } from './nodes'
import { DEFAULT_SIMPLE_STYLE, simpleVideoPipeline } from './pipelines/simple-video'
import { startRun } from './scheduler'
import type { EngineServices } from './services'
import { MemoryNodeStateStore, type NodeStateStore } from './state'
import { FsArtefactStore, type ArtefactStore } from './store'
import type { BudgetMode, EngineEvent, NodeState, RunStatus } from './types'
import { validatePipeline } from './validate'

export interface TemplateRunOptions {
  dataDir: string
  resourcesDir: string
  topic: string
  minutes?: number
  style?: Record<string, unknown>
  seeds?: Record<string, number>
  budgetMode?: BudgetMode
  /** false: each node's real `run` (needs the host's Claude and Cloud services). Default true. */
  useFakes?: boolean
  services?: Partial<EngineServices>
  /** Shared across calls so gate approvals and change notes persist (one video = one scope). */
  state?: NodeStateStore
  store?: ArtefactStore
  onEvent?: (e: EngineEvent) => void
}

export interface TemplateRunResult {
  status: RunStatus
  states: Record<string, NodeState>
  ms: number
  /** Final video file inside the artefact store, when the render finished. */
  video: string | null
  packageFiles: string[]
  /** Nodes that really ran (not reused from the store). */
  ran: string[]
  /** Fingerprint of each node's result in this run. */
  fingerprints: Record<string, string>
  errors: { nodeId: string; code: string; message: string }[]
}

export async function runTemplate(o: TemplateRunOptions): Promise<TemplateRunResult> {
  const registry = productionRegistry()
  const minutes = o.minutes ?? 1
  const style = { ...DEFAULT_SIMPLE_STYLE, ...o.style }
  const v = validatePipeline(simpleVideoPipeline(minutes), registry, { styleFields: Object.keys(style) })
  if (!v.ok) throw new Error(`the template pipeline is invalid: ${v.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`)
  const host = nodeHost({ dataDir: o.dataDir, resourcesDir: o.resourcesDir, extra: o.services })
  const store = o.store ?? new FsArtefactStore(path.join(o.dataDir, 'artefacts'))
  const fingerprints = new Map<string, string>()
  const ran: string[] = []
  const errors: TemplateRunResult['errors'] = []
  const t0 = Date.now()
  const run = startRun({
    plan: v.plan,
    store,
    state: o.state ?? new MemoryNodeStateStore(),
    scope: 'template-demo',
    inputs: { topic: { value: o.topic } },
    style,
    budgetMode: o.budgetMode ?? 'usage_max',
    gateMode: 'all',
    minutes,
    seeds: o.seeds ?? {},
    useFakes: o.useFakes ?? true,
    services: host.services,
    onEvent: (e) => {
      if (e.kind === 'gate') queueMicrotask(() => run.approve(e.nodeId))
      if (e.kind === 'start') ran.push(e.nodeId)
      if (e.kind === 'done' || e.kind === 'cached') fingerprints.set(e.nodeId, e.fingerprint)
      if (e.kind === 'error') errors.push({ nodeId: e.nodeId, code: e.code, message: e.message })
      o.onEvent?.(e)
    }
  })
  const result = await run.done
  const ms = Date.now() - t0
  const fileOf = async (nodeId: string, output: string): Promise<string[]> => {
    const fp = fingerprints.get(nodeId)
    const stored = fp ? await store.getRun(fp) : null
    return stored?.outputs[output]?.files ?? []
  }
  const video = (await fileOf('render', 'video'))[0] ?? null
  const packageFiles = await fileOf('package', 'package')
  await host.cleanup()
  return { status: result.status, states: result.states, ms, video, packageFiles, ran, fingerprints: Object.fromEntries(fingerprints), errors }
}
