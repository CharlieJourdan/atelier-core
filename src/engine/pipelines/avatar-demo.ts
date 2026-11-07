// A short narrated film with a generated-video shot and a talking presenter on its hook, end to end on a plain Node host
// (`npm run engine:avatar-demo`, the tests): the editor's drawing (images, generated video, an avatar, captions, music, a quality
// check) compiled by `pipelineFromDrawing`, with the director told to make one clip and to put the presenter on the hook only.
// Demo mode (R1.6): the research and the script are the templates, the voice is the system's (or the tone voice), the pictures,
// the clip and the presenter are drawn here; the cuts, the captions, the music, the render and the check are the real code. No
// network, no key, no credit.
import path from 'node:path'
import type { PipelineDrawing } from '../../shared/pipeline-drawing'
import { nodeHost } from '../host'
import { productionRegistry } from '../nodes'
import { startRun } from '../scheduler'
import type { EngineServices } from '../services'
import { MemoryNodeStateStore } from '../state'
import { FsArtefactStore } from '../store'
import type { EngineEvent, NodeState, RunStatus } from '../types'
import { validatePipeline } from '../validate'
import { pipelineFromDrawing } from './from-drawing'
import { DEFAULT_SIMPLE_STYLE } from './simple-video'
import type { EditPlan, GenList } from '../formats/editplan'

export const AVATAR_DEMO_DRAWING: PipelineDrawing = {
  name: 'Présentateur et clip généré',
  steps: [
    { id: 'v-idea', kind: 'idea', label: 'Sujet', runner: 'agent' },
    { id: 'v-script', kind: 'script', label: 'Script', runner: 'agent' },
    { id: 'v-voice', kind: 'voice', label: 'Voix', runner: 'api' },
    { id: 'v-director', kind: 'director', label: 'Réalisation', runner: 'agent' },
    { id: 'v-images', kind: 'image-gen', label: 'Images IA', runner: 'api', share: 100 },
    { id: 'v-video', kind: 'video-gen', label: 'Clip généré', runner: 'api', share: 20 },
    { id: 'v-avatar', kind: 'avatar', label: 'Présentateur', runner: 'api' },
    { id: 'v-music', kind: 'music', label: 'Musique', runner: 'code' },
    { id: 'v-captions', kind: 'captions', label: 'Sous-titres', runner: 'code' },
    { id: 'v-edit', kind: 'edit', label: 'Montage', runner: 'code' },
    { id: 'v-qc', kind: 'qc', label: 'Contrôle qualité', runner: 'agent' }
  ]
}

export interface AvatarDemoOptions {
  dataDir: string
  resourcesDir: string
  topic?: string
  /** Target length in minutes, 0.33 = 20 s. */
  minutes?: number
  /** The seconds of the hook the presenter speaks (the cut is on the base track's own cuts). */
  hookS?: number
  layout?: 'full' | 'pip'
  seed?: number
  style?: Record<string, unknown>
  services?: Partial<EngineServices>
  onEvent?: (e: EngineEvent) => void
}

export interface AvatarDemoResult {
  status: RunStatus
  states: Record<string, NodeState>
  ms: number
  video: string | null
  plan: EditPlan | null
  genlist: GenList | null
  /** The files and records of the generated clip(s) (`visuals.clips`) and of the presenter (`avatar.clips`). */
  clips: { files: string[]; value: unknown }
  avatar: { files: string[]; value: unknown }
  qc: Record<string, unknown> | null
  ran: string[]
  errors: { nodeId: string; code: string; message: string }[]
  gates: string[]
}

export async function runAvatarDemo(o: AvatarDemoOptions): Promise<AvatarDemoResult> {
  const registry = productionRegistry()
  const minutes = o.minutes ?? 0.33
  const style = { ...DEFAULT_SIMPLE_STYLE, pace: 'fit', ...o.style }
  const compiled = pipelineFromDrawing(AVATAR_DEMO_DRAWING, { id: 'avatar-demo', minutes })
  // the demo wants one generated clip in a film of twenty seconds (the compiler's budget modes only make clips on long films) and
  // the presenter on the hook alone
  const director = compiled.pipeline.nodes.find((n) => n.id === 'director')
  if (!director) throw new Error('the avatar demo pipeline has no director')
  director.params = { ...director.params, videoShare: 0.5, maxVideoClips: 30, mix: { stock: 0, image: 1 }, avatar: { segments: ['hook'], layout: o.layout ?? 'full', hookS: o.hookS ?? 6 } }
  delete director.modes
  const v = validatePipeline(compiled.pipeline, registry, { styleFields: Object.keys(style) })
  if (!v.ok) throw new Error(`the avatar pipeline is invalid: ${v.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`)
  const host = nodeHost({ dataDir: o.dataDir, resourcesDir: o.resourcesDir, extra: o.services })
  const store = new FsArtefactStore(path.join(o.dataDir, 'artefacts'))
  const fingerprints = new Map<string, string>()
  const ran: string[] = []
  const gates: string[] = []
  const errors: AvatarDemoResult['errors'] = []
  const t0 = Date.now()
  const run = startRun({
    plan: v.plan,
    store,
    state: new MemoryNodeStateStore(),
    scope: 'avatar-demo',
    inputs: { topic: { value: o.topic ?? 'Le phare oublié de la côte sauvage' } },
    style,
    budgetMode: 'usage_max',
    gateMode: 'all',
    minutes,
    seeds: o.seed !== undefined ? { visuals: o.seed } : {},
    useFakes: true,
    services: host.services,
    onEvent: (e) => {
      if (e.kind === 'gate') {
        gates.push(e.nodeId)
        queueMicrotask(() => run.approve(e.nodeId))
      }
      if (e.kind === 'start') ran.push(e.nodeId)
      if (e.kind === 'done' || e.kind === 'cached') fingerprints.set(e.nodeId, e.fingerprint)
      if (e.kind === 'error') errors.push({ nodeId: e.nodeId, code: e.code, message: e.message })
      o.onEvent?.(e)
    }
  })
  const result = await run.done
  const ms = Date.now() - t0
  const outputOf = async (nodeId: string, output: string): Promise<{ files: string[]; value: unknown }> => {
    const fp = fingerprints.get(nodeId)
    const a = fp ? (await store.getRun(fp))?.outputs[output] : undefined
    return { files: a?.files ?? [], value: a?.value }
  }
  const video = (await outputOf('render', 'video')).files[0] ?? null
  const out = {
    status: result.status,
    states: result.states,
    ms,
    video,
    plan: ((await outputOf('director', 'plan')).value as EditPlan | undefined) ?? null,
    genlist: ((await outputOf('director', 'genlist')).value as GenList | undefined) ?? null,
    clips: await outputOf('visuals', 'clips'),
    avatar: await outputOf('avatar', 'clips'),
    qc: ((await outputOf('qc', 'report')).value as Record<string, unknown> | undefined) ?? null,
    ran,
    errors,
    gates
  }
  await host.cleanup()
  return out
}
