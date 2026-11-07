// A documentary on fakes (style-markets): a project on the base pipeline `documentary@2` (research note style-markets-of-the-past-
// 2026-11.md), compiled with its default options, then run end to end on a plain Node host (`npm run engine:documentary-demo`, the
// tests). Demo mode (R1.6): the script is the template, the voice is the system's, the pictures are drawn and the director's directives
// are the deterministic ones (framed archives in turn, a data card on a sentence with figures); the cards are drawn by the real motion
// runtime in the system's browser, and the cuts, the cross-fades, the archive grade, the music, the render and the check are the real
// code. No network, no key, no credit. A project may pass its own script and its own directives (a real sample's, replayed for free).
import path from 'node:path'
import type { BrickStyle } from '../../shared/brick-styles'
import { nodeHost } from '../host'
import { productionRegistry } from '../nodes'
import { startRun } from '../scheduler'
import type { EngineServices } from '../services'
import { MemoryNodeStateStore } from '../state'
import { FsArtefactStore } from '../store'
import { compileRecipe, documentary2Base, fromBase, technologyRegistry, type BasePipeline, type RecipeDoc } from '../technologies'
import type { EngineEvent, NodeState, RunStatus } from '../types'
import { validatePipeline } from '../validate'
import type { EditPlan, GenList } from '../formats/editplan'
import { DEFAULT_SIMPLE_STYLE } from './simple-video'
import { withSpeakers } from './speakers'

export interface DocumentaryDemoOptions {
  /** The base pipeline (default `documentary@2`). */
  base?: BasePipeline
  dataDir: string
  resourcesDir: string
  topic?: string
  /** Target length in minutes (default 1). */
  minutes?: number
  options?: RecipeDoc['options']
  settings?: Record<string, Record<string, unknown>>
  services?: Partial<EngineServices>
  styles?: Readonly<Record<string, BrickStyle>>
  onEvent?: (e: EngineEvent) => void
}

export interface DocumentaryDemoResult {
  status: RunStatus
  states: Record<string, NodeState>
  ms: number
  video: string | null
  plan: EditPlan | null
  genlist: GenList | null
  nodes: string[]
  /** `motion.render`'s files and records (the cards are the ones marked `base`). */
  motion: { files: string[]; value: unknown; meta: Record<string, unknown> }
  images: string[]
  renderMeta: Record<string, unknown>
  qc: Record<string, unknown> | null
  errors: { nodeId: string; code: string; message: string }[]
}

export async function runDocumentaryDemo(o: DocumentaryDemoOptions): Promise<DocumentaryDemoResult> {
  const minutes = o.minutes ?? 1
  const pipelineBase = o.base ?? documentary2Base
  const base = fromBase(pipelineBase, 'Documentaire — démo')
  const doc: RecipeDoc = { ...base, options: o.options ?? base.options }
  const compiled = compileRecipe(doc, technologyRegistry(), { id: 'documentary-demo', ...(o.styles ? { styles: o.styles } : {}), project: { minutes, technologies: { ...o.settings } } })
  if (!compiled.ok) throw new Error(`${pipelineBase.id} does not compile: ${compiled.errors.map((e) => `${e.code} ${e.path.join('.')}`).join(', ')}`)
  const style: Record<string, unknown> = { ...DEFAULT_SIMPLE_STYLE, pace: 'fit' }
  const v = validatePipeline(withSpeakers(compiled.pipeline, style), productionRegistry(), { styleFields: Object.keys(style) })
  if (!v.ok) throw new Error(`the ${pipelineBase.id} pipeline is invalid: ${v.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`)
  const host = nodeHost({ dataDir: o.dataDir, resourcesDir: o.resourcesDir, extra: o.services })
  const store = new FsArtefactStore(path.join(o.dataDir, 'artefacts'))
  const fingerprints = new Map<string, string>()
  const errors: DocumentaryDemoResult['errors'] = []
  const t0 = Date.now()
  const run = startRun({
    plan: v.plan,
    store,
    state: new MemoryNodeStateStore(),
    scope: 'documentary-demo',
    inputs: { topic: { value: o.topic ?? 'Why the 1929 crash turned into the Great Depression' } },
    style,
    budgetMode: compiled.pipeline.budget.default,
    gateMode: 'all',
    minutes,
    useFakes: true,
    services: host.services,
    onEvent: (e) => {
      if (e.kind === 'gate') queueMicrotask(() => run.approve(e.nodeId))
      if (e.kind === 'done' || e.kind === 'cached') fingerprints.set(e.nodeId, e.fingerprint)
      if (e.kind === 'error') errors.push({ nodeId: e.nodeId, code: e.code, message: e.message })
      o.onEvent?.(e)
    }
  })
  const result = await run.done
  const ms = Date.now() - t0
  const outputOf = async (nodeId: string, output: string): Promise<{ files: string[]; value: unknown; meta: Record<string, unknown> }> => {
    const fp = fingerprints.get(nodeId)
    const a = fp ? (await store.getRun(fp))?.outputs[output] : undefined
    return { files: a?.files ?? [], value: a?.value, meta: (a?.meta ?? {}) as Record<string, unknown> }
  }
  const render = await outputOf('render', 'video')
  const out: DocumentaryDemoResult = {
    status: result.status,
    states: result.states,
    ms,
    video: render.files[0] ?? null,
    renderMeta: render.meta,
    plan: ((await outputOf('director', 'plan')).value as EditPlan | undefined) ?? null,
    genlist: ((await outputOf('director', 'genlist')).value as GenList | undefined) ?? null,
    nodes: compiled.pipeline.nodes.map((n) => n.id),
    motion: await outputOf('motion', 'graphics'),
    images: (await outputOf('visuals', 'images')).files,
    qc: ((await outputOf('qc', 'report')).value as Record<string, unknown> | undefined) ?? null,
    errors
  }
  await host.cleanup()
  return out
}
