// The first avatar video on fakes (production-3): a project on the base pipeline `avatar@1` (docs/specs/pipeline-avatar.md),
// compiled by the recipe compiler with its default options and a few per-video adjustments (a short film, the presenter on
// the hook, one generated clip), then run end to end on a plain Node host (`npm run engine:avatar-base-demo`, the tests).
// Demo mode (R1.6): the research and the script are the templates, the voice is the system's (or the tone voice), the pictures,
// the clip and the presenter are drawn; the cuts, the captions, the music, the render and the check are the real code. No
// network, no key, no credit. The owner gates of the default checkpoints (topic, thumbnail) are approved as they come.
import path from 'node:path'
import type { BrickStyle } from '../../shared/brick-styles'
import { nodeHost } from '../host'
import { productionRegistry } from '../nodes'
import { startRun } from '../scheduler'
import type { EngineServices } from '../services'
import { MemoryNodeStateStore } from '../state'
import { FsArtefactStore } from '../store'
import { avatarBase, compileRecipe, fromBase, technologyRegistry, type Pins, type RecipeDoc } from '../technologies'
import type { EngineEvent, NodeState, RunStatus } from '../types'
import { validatePipeline } from '../validate'
import type { EditPlan, GenList } from '../formats/editplan'
import type { PresenterRef } from '../presenter/talk'
import { DEFAULT_SIMPLE_STYLE } from './simple-video'
import { withSpeakers } from './speakers'

export interface AvatarBaseDemoOptions {
  dataDir: string
  resourcesDir: string
  topic?: string
  /** Target length in minutes (default 0.5 = 30 s). */
  minutes?: number
  /** The chosen options of `avatar@1` (default: its defaults). */
  options?: RecipeDoc['options']
  /** A script to import as is (option « Script » = import): the real words of a video instead of the template's. */
  script?: string
  /** The channel's sponsor (the `sponsor` input, as the channel's asset gives it: production-9). */
  sponsor?: string
  /** The screen shares, over the pipeline's (a demo shows more of the presenter to show its layouts). */
  mix?: Partial<RecipeDoc['mix']>
  /** Per-video settings by brick (the director's presenter layouts, the script's chapters…), over the demo's own. */
  settings?: Record<string, Record<string, unknown>>
  /** The channel's presenter (its portrait and angles), as a run style carries it (production-7). */
  presenter?: PresenterRef
  services?: Partial<EngineServices>
  /** The documents of the styles the bricks wear (`phone-real`…): their looks reach the pictures (production-8). */
  styles?: Readonly<Record<string, BrickStyle>>
  onEvent?: (e: EngineEvent) => void
}

export interface AvatarBaseDemoResult {
  status: RunStatus
  states: Record<string, NodeState>
  ms: number
  video: string | null
  plan: EditPlan | null
  genlist: GenList | null
  pins: Pins
  nodes: string[]
  avatar: string[]
  /** The presenter clips' records and the node's meta (calls, generated and shown seconds, engine). */
  avatarClips: unknown
  avatarMeta: Record<string, unknown>
  clips: string[]
  /** The pictures (every item's still) and their record, in the list's order. */
  images: string[]
  imageRecord: unknown
  /** The clips' record (`clip.make`). */
  clipRecord: unknown
  thumbnails: string[]
  /** production-9: the editing bricks' layers (the sponsor's slot and QR code, the chapter marks) and the render's meta. */
  sponsor: { files: string[]; value: unknown; meta: Record<string, unknown> }
  chapters: { files: string[]; value: unknown; meta: Record<string, unknown> }
  renderMeta: Record<string, unknown>
  /** The captions' files (ASS, SRT, VTT). */
  subs: string[]
  /** The timeline the director made (`atelier.timeline/1`). */
  timeline: unknown
  /** The voice's words (for the sponsor's windows). */
  words: unknown
  qc: Record<string, unknown> | null
  errors: { nodeId: string; code: string; message: string }[]
  gates: string[]
}

export async function runAvatarBaseDemo(o: AvatarBaseDemoOptions): Promise<AvatarBaseDemoResult> {
  const minutes = o.minutes ?? 0.5
  const base = fromBase(avatarBase, 'Avatar — démo')
  const doc: RecipeDoc = { ...base, options: o.options ?? {}, ...(o.mix && base.mix ? { mix: { ...base.mix, ...o.mix } } : {}) }
  // per-video adjustments a project may make: a short film keeps one generated clip and the presenter on the hook only
  const compiled = compileRecipe(doc, technologyRegistry(), {
    id: 'avatar-base-demo',
    ...(o.styles ? { styles: o.styles } : {}),
    project: {
      minutes,
      technologies: {
        ...o.settings,
        'director.plan': { videoShare: 0.5, maxVideoClips: 30, ...o.settings?.['director.plan'] },
        'avatar.speak': { segments: ['hook'], ...o.settings?.['avatar.speak'] }
      }
    }
  })
  if (!compiled.ok) throw new Error(`avatar@1 does not compile: ${compiled.errors.map((e) => `${e.code} ${e.path.join('.')}`).join(', ')}`)
  const style: Record<string, unknown> = { ...DEFAULT_SIMPLE_STYLE, pace: 'fit', ...(o.presenter ? { presenter: o.presenter } : {}) }
  const v = validatePipeline(withSpeakers(compiled.pipeline, style), productionRegistry(), { styleFields: Object.keys(style) })
  if (!v.ok) throw new Error(`the avatar@1 pipeline is invalid: ${v.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`)
  const host = nodeHost({ dataDir: o.dataDir, resourcesDir: o.resourcesDir, extra: o.services })
  const store = new FsArtefactStore(path.join(o.dataDir, 'artefacts'))
  const fingerprints = new Map<string, string>()
  const gates: string[] = []
  const errors: AvatarBaseDemoResult['errors'] = []
  const t0 = Date.now()
  const run = startRun({
    plan: v.plan,
    store,
    state: new MemoryNodeStateStore(),
    scope: 'avatar-base-demo',
    inputs: { topic: { value: o.topic ?? 'Rattraper une poêle brûlée sans produit chimique' }, ...(o.sponsor ? { sponsor: { value: o.sponsor } } : {}), ...(o.script ? { script: { value: o.script } } : {}) },
    style,
    budgetMode: compiled.pipeline.budget.default,
    gateMode: 'all',
    minutes,
    useFakes: true,
    services: host.services,
    onEvent: (e) => {
      if (e.kind === 'gate') {
        gates.push(e.nodeId)
        queueMicrotask(() => run.approve(e.nodeId))
      }
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
  const presenter = await outputOf('avatar', 'clips')
  const render = await outputOf('render', 'video')
  const has = (id: string): boolean => compiled.pipeline.nodes.some((n) => n.id === id)
  const none = { files: [], value: undefined, meta: {} }
  const out: AvatarBaseDemoResult = {
    status: result.status,
    states: result.states,
    ms,
    video: render.files[0] ?? null,
    renderMeta: render.meta,
    sponsor: has('sponsorslot') ? await outputOf('sponsorslot', 'slots') : none,
    chapters: has('chapters') ? await outputOf('chapters', 'marks') : none,
    subs: (await outputOf('captions', 'subs')).files,
    timeline: (await outputOf('director', 'timeline')).value,
    words: (await outputOf('voice', 'words')).value,
    plan: ((await outputOf('director', 'plan')).value as EditPlan | undefined) ?? null,
    genlist: ((await outputOf('director', 'genlist')).value as GenList | undefined) ?? null,
    pins: compiled.pins,
    nodes: compiled.pipeline.nodes.map((n) => n.id),
    avatar: presenter.files,
    avatarClips: presenter.value,
    avatarMeta: presenter.meta,
    // the clips come from the clip brick since production-8 (the stills brick makes only their start stills)
    clips: (await outputOf(compiled.pipeline.nodes.some((n) => n.id === 'clips') ? 'clips' : 'visuals', 'clips')).files,
    images: (await outputOf('visuals', 'images')).files,
    imageRecord: (await outputOf('visuals', 'images')).value,
    clipRecord: (await outputOf('clips', 'clips')).value,
    thumbnails: (await outputOf('thumbnails', 'thumbnails')).files,
    qc: ((await outputOf('qc', 'report')).value as Record<string, unknown> | undefined) ?? null,
    errors,
    gates
  }
  await host.cleanup()
  return out
}
