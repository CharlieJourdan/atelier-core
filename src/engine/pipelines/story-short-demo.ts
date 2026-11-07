// A story short on fakes (clone-reddit-shorts): a project on the base pipeline `story-short@1`
// (research note style-redditchroniques-2026-11 (old repository)), compiled from its document, then run end to end on a plain Node host
// (`npm run engine:story-demo`, the tests). Demo mode (R1.6): the voice is the system's (stretched to the measured pace like the real
// one), the translation passes through (the story is already French); the clips are a folder on this computer and everything that
// makes the picture — the post card in the browser, the one-word captions, the clip cuts, the music, the render — is the real code.
import path from 'node:path'
import { nodeHost } from '../host'
import { productionRegistry } from '../nodes'
import { startRun } from '../scheduler'
import type { EngineServices } from '../services'
import { MemoryNodeStateStore } from '../state'
import { FsArtefactStore } from '../store'
import { compileRecipe, fromBase, storyShortBase, technologyRegistry, type RecipeDoc } from '../technologies'
import type { EngineEvent, NodeState, RunStatus } from '../types'
import { validatePipeline } from '../validate'
import { DEFAULT_SIMPLE_STYLE } from './simple-video'
import { withSpeakers } from './speakers'

/** An original story (written for this demo), its first sentence the title the post card shows. */
export const DEMO_STORY = [
  'Mon voisin m’a confié la clé de son garage pour un week-end, et j’aurais dû refuser.',
  'Il m’avait juste demandé d’arroser ses plantes. Rien de plus. Le samedi matin, j’entre, j’arrose, je ressors.',
  'Mais le dimanche, j’entends un bruit derrière la porte du fond. Un bruit régulier, comme quelqu’un qui tape doucement.',
  'Je l’appelle. Pas de réponse. Je rappelle. Messagerie. Alors j’ouvre la porte du fond, et là, je comprends pourquoi il ne voulait pas que j’y entre.',
  'Une machine à laver tournait toute seule, remplie de billets de banque. Des centaines.',
  'Le lundi, il est revenu, il a vu ma tête, et il m’a simplement dit : maintenant, tu fais partie de l’affaire.'
].join('\n\n')

export interface StoryShortDemoOptions {
  dataDir: string
  resourcesDir: string
  /** The clip library (a folder of clips). */
  clipsDir: string
  script?: string
  channel?: string
  /** The channel's avatar picture. */
  avatar?: string
  minutes?: number
  seed?: number
  /** A real run's services (voice, translation) instead of the fakes. */
  real?: boolean
  settings?: Record<string, Record<string, unknown>>
  style?: Record<string, unknown>
  services?: Partial<EngineServices>
  onEvent?: (e: EngineEvent) => void
}

export interface StoryShortDemoResult {
  status: RunStatus
  states: Record<string, NodeState>
  ms: number
  video: string | null
  nodes: string[]
  card: Record<string, unknown>
  background: Record<string, unknown>
  voice: Record<string, unknown>
  captions: Record<string, unknown>
  renderMeta: Record<string, unknown>
  qc: Record<string, unknown> | null
  errors: { nodeId: string; code: string; message: string }[]
}

export async function runStoryShortDemo(o: StoryShortDemoOptions): Promise<StoryShortDemoResult> {
  const minutes = o.minutes ?? 0.5
  const base = fromBase(storyShortBase, 'Histoire Reddit — démo')
  const doc: RecipeDoc = { ...base }
  const compiled = compileRecipe(doc, technologyRegistry(), { id: 'story-short-demo', project: { minutes, technologies: { ...o.settings } } })
  if (!compiled.ok) throw new Error(`story-short@1 does not compile: ${compiled.errors.map((e) => `${e.code} ${e.path.join('.')} ${e.message ?? ''}`).join(', ')}`)
  const style: Record<string, unknown> = { ...DEFAULT_SIMPLE_STYLE, ...o.style }
  const v = validatePipeline(withSpeakers(compiled.pipeline, style), productionRegistry(), { styleFields: Object.keys(style) })
  if (!v.ok) throw new Error(`the story-short@1 pipeline is invalid: ${v.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`)
  const host = nodeHost({ dataDir: o.dataDir, resourcesDir: o.resourcesDir, extra: o.services })
  const store = new FsArtefactStore(path.join(o.dataDir, 'artefacts'))
  const fingerprints = new Map<string, string>()
  const errors: StoryShortDemoResult['errors'] = []
  const t0 = Date.now()
  const run = startRun({
    plan: v.plan,
    store,
    state: new MemoryNodeStateStore(),
    scope: 'story-short-demo',
    inputs: {
      topic: { value: 'La clé du garage' },
      script: { value: o.script ?? DEMO_STORY },
      gameplay: { value: o.clipsDir },
      channel: { value: o.channel ?? 'Histoires Vraies' },
      ...(o.avatar ? { channelAvatar: { value: o.avatar } } : {})
    },
    style,
    budgetMode: compiled.pipeline.budget.default,
    gateMode: 'all',
    minutes,
    ...(o.seed !== undefined ? { seeds: { background: o.seed } } : {}),
    useFakes: o.real !== true,
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
  const metaOf = async (nodeId: string, output: string): Promise<{ files: string[]; value: unknown; meta: Record<string, unknown> }> => {
    const fp = fingerprints.get(nodeId)
    const a = fp ? (await store.getRun(fp))?.outputs[output] : undefined
    return { files: a?.files ?? [], value: a?.value, meta: (a?.meta ?? {}) as Record<string, unknown> }
  }
  const render = await metaOf('render', 'video')
  const out: StoryShortDemoResult = {
    status: result.status,
    states: result.states,
    ms,
    video: render.files[0] ?? null,
    nodes: compiled.pipeline.nodes.map((n) => n.id),
    card: (await metaOf('card', 'card')).meta,
    background: (await metaOf('background', 'layer')).meta,
    voice: (await metaOf('voice', 'audio')).meta,
    captions: (await metaOf('captions', 'subs')).meta,
    renderMeta: render.meta,
    qc: ((await metaOf('qc', 'report')).value as Record<string, unknown> | undefined) ?? null,
    errors
  }
  await host.cleanup()
  return out
}
