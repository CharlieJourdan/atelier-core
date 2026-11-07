// Proof driver (chantier moteur-pipeline, decision 0099): runs a COMPILED clone plan end to end on this machine with the engine's
// fakes (`useFakes`: template script, system voice, drawn pictures and presenter) while the local bricks are the real code: the
// director, the motion cards (drawn by the browser in the channel's measured style), the captions, the music bed, the render and
// the quality check. Free and offline. Used by scripts/clone-pipeline-demo.ts and never by the app.
import path from 'node:path'
import type { PipelinePlan } from '../../../../shared/clone'
import { nodeHost } from '../../../../engine/host'
import { productionRegistry } from '../../../../engine/nodes'
import { DEFAULT_SIMPLE_STYLE } from '../../../../engine/pipelines/simple-video'
import { withSpeakers } from '../../../../engine/pipelines/speakers'
import { startRun } from '../../../../engine/scheduler'
import type { EngineServices } from '../../../../engine/services'
import { MemoryNodeStateStore } from '../../../../engine/state'
import { FsArtefactStore } from '../../../../engine/store'
import { compileRecipe, technologyRegistry, type RecipeDoc } from '../../../../engine/technologies'
import type { RunStatus } from '../../../../engine/types'
import { validatePipeline } from '../../../../engine/validate'

export interface FakeRunResult {
  status: RunStatus
  ms: number
  video: string | null
  nodes: string[]
  motionFiles: string[]
  errors: { nodeId: string; code: string; message: string }[]
}

export async function runPlanOnFakes(o: { plan: PipelinePlan; dataDir: string; resourcesDir: string; minutes: number; topic: string; services?: Partial<EngineServices> }): Promise<FakeRunResult> {
  const doc = structuredClone(o.plan.recipe) as RecipeDoc
  const compiled = compileRecipe(doc, technologyRegistry(), { id: 'clone-plan', project: { minutes: o.minutes } })
  if (!compiled.ok) throw new Error(`the plan does not compile: ${compiled.errors.map((e) => `${e.code} ${e.path.join('.')} ${e.message}`).join('; ')}`)
  const style: Record<string, unknown> = { ...DEFAULT_SIMPLE_STYLE, pace: 'fit', ...(doc.language ? { language: doc.language } : {}) }
  const v = validatePipeline(withSpeakers(compiled.pipeline, style), productionRegistry(), { styleFields: Object.keys(style) })
  if (!v.ok) throw new Error(`the compiled pipeline is invalid: ${v.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`)
  const host = nodeHost({ dataDir: o.dataDir, resourcesDir: o.resourcesDir, extra: o.services })
  const store = new FsArtefactStore(path.join(o.dataDir, 'artefacts'))
  const fingerprints = new Map<string, string>()
  const errors: FakeRunResult['errors'] = []
  const t0 = Date.now()
  const run = startRun({
    plan: v.plan,
    store,
    state: new MemoryNodeStateStore(),
    scope: 'clone-plan',
    inputs: { topic: { value: o.topic } },
    style,
    budgetMode: compiled.pipeline.budget.default,
    gateMode: 'all',
    minutes: o.minutes,
    useFakes: true,
    services: host.services,
    onEvent: (e) => {
      if (e.kind === 'gate') queueMicrotask(() => run.approve(e.nodeId))
      if (e.kind === 'done' || e.kind === 'cached') fingerprints.set(e.nodeId, e.fingerprint)
      if (e.kind === 'error') errors.push({ nodeId: e.nodeId, code: e.code, message: e.message })
    }
  })
  const result = await run.done
  const files = async (nodeId: string, output: string): Promise<string[]> => {
    const fp = fingerprints.get(nodeId)
    return fp ? ((await store.getRun(fp))?.outputs[output]?.files ?? []) : []
  }
  const out: FakeRunResult = {
    status: result.status,
    ms: Date.now() - t0,
    video: (await files('render', 'video'))[0] ?? null,
    nodes: compiled.pipeline.nodes.map((n) => n.id),
    motionFiles: await files('motion', 'graphics'),
    errors
  }
  await host.cleanup()
  return out
}
