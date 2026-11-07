// Animated overlays in a real film, end to end on a plain Node host (`npm run engine:motion-demo`, the tests). Two films from the editor's own
// drawings compiled by `pipelineFromDrawing`: a ~20 s documentary (16:9) with a title card, a counter and a lower third that the director
// finds in the narration, and a ~15 s conversation short (9:16) whose two speakers are the voice's own turns, shown as message bubbles over
// a gameplay background. Demo mode (R1.6): the research is the template, the script is given, the voice is the system's (one voice per
// character), the pictures are drawn; the director's choices, the templates, the browser that draws them, the render and the check are the
// real code. No network, no key, no credit.
import path from 'node:path'
import type { PipelineDrawing } from '../../shared/pipeline-drawing'
import type { EditPlan } from '../formats/editplan'
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
import { withSpeakers } from './speakers'

/** The documentary of the demo: narrated pictures with animated graphics. */
export const MOTION_FILM_DRAWING: PipelineDrawing = {
  name: 'Documentaire animé',
  steps: [
    { id: 'f-idea', kind: 'idea', label: 'Sujet', runner: 'agent' },
    { id: 'f-script', kind: 'human-input', label: 'Script', runner: 'human' },
    { id: 'f-voice', kind: 'voice', label: 'Voix', runner: 'api' },
    { id: 'f-director', kind: 'director', label: 'Réalisation', runner: 'agent' },
    { id: 'f-images', kind: 'image-gen', label: 'Images IA', runner: 'api', share: 100 },
    { id: 'f-motion', kind: 'motion', label: 'Animations', runner: 'code', share: 60 },
    { id: 'f-music', kind: 'music', label: 'Musique', runner: 'code' },
    { id: 'f-captions', kind: 'captions', label: 'Sous-titres', runner: 'code' },
    { id: 'f-edit', kind: 'edit', label: 'Montage', runner: 'code' },
    { id: 'f-qc', kind: 'qc', label: 'Contrôle qualité', runner: 'agent' }
  ]
}

/** The conversation short of the demo: a story told in messages over a gameplay background. */
export const MOTION_CHAT_DRAWING: PipelineDrawing = {
  name: 'Conversation en messages',
  format: 'short',
  steps: [
    { id: 'c-idea', kind: 'idea', label: 'Histoire', runner: 'agent' },
    { id: 'c-script', kind: 'human-input', label: 'Script', runner: 'human' },
    { id: 'c-voice', kind: 'voice', label: 'Voix', runner: 'api' },
    { id: 'c-gameplay', kind: 'gameplay', label: 'Gameplay', runner: 'human' },
    { id: 'c-motion', kind: 'motion', label: 'Conversation animée', runner: 'code' },
    { id: 'c-captions', kind: 'captions', label: 'Sous-titres', runner: 'code' },
    { id: 'c-edit', kind: 'edit', label: 'Montage', runner: 'code' },
    { id: 'c-qc', kind: 'qc', label: 'Contrôle qualité', runner: 'agent' }
  ]
}

/** About 20 s read aloud: its first eight words are the title the demo outline gives (and the card shows), then a person named with her role and a figure said in digits. */
export const FILM_SCRIPT =
  'Le phare oublié d’Ouessant est resté éteint longtemps. Pendant quarante ans, personne n’y est monté. Le professeur Élise Moreau a passé sa vie à l’étudier. ' +
  'Dans ses carnets, elle a compté 12 000 navires passés devant ses fenêtres. Chaque soir, elle notait tout, sans jamais se plaindre.'

/** About 15 s: two characters, the first one writes. */
export const CHAT_SCRIPT = [
  'LÉA: Tu dors ?',
  'MAËL: Non. Je regarde le plafond depuis une heure.',
  'LÉA: Moi aussi. J’ai entendu du bruit dans le couloir.',
  'MAËL: Tu es sûre ? Il est trois heures du matin.',
  'LÉA: Oui. Et la porte du fond vient de s’ouvrir.'
].join('\n')

export interface MotionDemoOptions {
  kind: 'film' | 'chat'
  dataDir: string
  resourcesDir: string
  /** A folder of background clips (absolute), for the chat. */
  clipsDir?: string
  script?: string
  topic?: string
  seed?: number
  style?: Record<string, unknown>
  services?: Partial<EngineServices>
  onEvent?: (e: EngineEvent) => void
}

export interface MotionDemoResult {
  status: RunStatus
  states: Record<string, NodeState>
  ms: number
  video: string | null
  plan: EditPlan | null
  /** The animations the node drew: their files, the record of which shot each is, and its meta. */
  graphics: { files: string[]; value: unknown; meta: Record<string, unknown> }
  voice: { file: string | null; words: unknown }
  qc: Record<string, unknown> | null
  ran: string[]
  errors: { nodeId: string; code: string; message: string }[]
  gates: string[]
}

export async function runMotionDemo(o: MotionDemoOptions): Promise<MotionDemoResult> {
  const registry = productionRegistry()
  const chat = o.kind === 'chat'
  const minutes = chat ? 0.25 : 0.33
  const style = { ...DEFAULT_SIMPLE_STYLE, ...(chat ? { speakers: { 'LÉA': 'demo-ava', 'MAËL': 'demo-hugo' } } : {}), ...o.style }
  const compiled = pipelineFromDrawing(chat ? MOTION_CHAT_DRAWING : MOTION_FILM_DRAWING, { id: `motion-${o.kind}`, minutes })
  const director = compiled.pipeline.nodes.find((n) => n.id === 'director')
  if (!director) throw new Error('the motion demo pipeline has no director')
  // a film of twenty seconds: allow the overlays more than the usual three a minute, and keep the conversation's own picture clean
  director.params = { ...director.params, motion: chat ? { share: 0.2, titleCard: false } : { share: 0.6, perMinute: 12 } }
  const v = validatePipeline(withSpeakers(compiled.pipeline, style), registry, { styleFields: Object.keys(style) })
  if (!v.ok) throw new Error(`the motion pipeline is invalid: ${v.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`)
  const host = nodeHost({ dataDir: o.dataDir, resourcesDir: o.resourcesDir, extra: o.services })
  const store = new FsArtefactStore(path.join(o.dataDir, 'artefacts'))
  const fingerprints = new Map<string, string>()
  const ran: string[] = []
  const gates: string[] = []
  const errors: MotionDemoResult['errors'] = []
  const t0 = Date.now()
  const run = startRun({
    plan: v.plan,
    store,
    state: new MemoryNodeStateStore(),
    scope: `motion-${o.kind}`,
    inputs: {
      topic: { value: o.topic ?? (chat ? 'La porte du fond' : 'Le phare oublié de la côte sauvage') },
      script: { value: o.script ?? (chat ? CHAT_SCRIPT : FILM_SCRIPT) },
      ...(chat ? { gameplay: { value: o.clipsDir ?? '' } } : {})
    },
    style,
    budgetMode: 'usage_max',
    gateMode: 'all',
    minutes,
    seeds: o.seed !== undefined ? { visuals: o.seed, background: o.seed } : {},
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
  const outputOf = async (nodeId: string, output: string): Promise<{ files: string[]; value: unknown; meta: Record<string, unknown> }> => {
    const fp = fingerprints.get(nodeId)
    const a = fp ? (await store.getRun(fp))?.outputs[output] : undefined
    return { files: a?.files ?? [], value: a?.value, meta: (a?.meta ?? {}) as Record<string, unknown> }
  }
  const out: MotionDemoResult = {
    status: result.status,
    states: result.states,
    ms,
    video: (await outputOf('render', 'video')).files[0] ?? null,
    plan: ((await outputOf('director', 'plan')).value as EditPlan | undefined) ?? null,
    graphics: await outputOf('motion', 'graphics'),
    voice: { file: (await outputOf('voice', 'audio')).files[0] ?? null, words: (await outputOf('voice', 'words')).value },
    qc: ((await outputOf('qc', 'report')).value as Record<string, unknown> | undefined) ?? null,
    ran,
    errors,
    gates
  }
  await host.cleanup()
  return out
}
