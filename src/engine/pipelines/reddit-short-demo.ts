// A Reddit-style story short (vertical, 1080×1920), end to end on a plain Node host (`npm run engine:reddit-demo`, the tests): a script given by
// a person, a folder of gameplay clips, an intro card, burned captions, then the free quality check. Demo mode (R1.6): the
// research and the voice are the fakes (template brief, the deterministic tone voice or the system voice), everything
// that makes the picture is the real code. The pipeline is the editor's Reddit drawing compiled by `pipelineFromDrawing`,
// with a quality-check step added, so it also proves the drawing → engine path for these kinds.
import path from 'node:path'
import { nodeHost } from '../host'
import { productionRegistry } from '../nodes'
import { pipelineFromDrawing } from './from-drawing'
import { withSpeakers } from './speakers'
import { DEFAULT_SIMPLE_STYLE } from './simple-video'
import { startRun } from '../scheduler'
import type { EngineServices } from '../services'
import { MemoryNodeStateStore } from '../state'
import { FsArtefactStore } from '../store'
import type { EngineEvent, NodeState, RunStatus } from '../types'
import { validatePipeline } from '../validate'
import type { PipelineDrawing } from '../../shared/pipeline-drawing'

/** The editor's « Histoire Reddit + gameplay » drawing (the voice is the engine's), with a quality check at the end. */
export const REDDIT_SHORT_DRAWING: PipelineDrawing = {
  name: 'Histoire Reddit + gameplay',
  // a short: 1080×1920 with the shorts captions
  format: 'short',
  steps: [
    { id: 'r-idea', kind: 'idea', label: 'Histoire', runner: 'agent' },
    { id: 'r-script', kind: 'human-input', label: 'Script', runner: 'human' },
    { id: 'r-voice', kind: 'voice', label: 'Voix', runner: 'api' },
    { id: 'r-gameplay', kind: 'gameplay', label: 'Gameplay', runner: 'human' },
    { id: 'r-card', kind: 'card', label: 'Carte d’intro', runner: 'code' },
    { id: 'r-captions', kind: 'captions', label: 'Sous-titres', runner: 'code' },
    { id: 'r-edit', kind: 'edit', label: 'Montage', runner: 'code' },
    { id: 'r-qc', kind: 'qc', label: 'Contrôle qualité', runner: 'agent' }
  ]
}

/** A short first-person story (original text) of about 15 seconds read at a natural pace. */
export const SAMPLE_STORY =
  'Je n’aurais jamais cru raconter ça un jour. Mon voisin m’a demandé de garder une clé pour lui, juste le temps d’un week-end. ' +
  'Dimanche soir, la clé avait disparu. Et ce que j’ai trouvé derrière sa porte m’a coupé le souffle.'

export interface RedditShortOptions {
  dataDir: string
  resourcesDir: string
  /** Folder of gameplay clips (absolute). */
  clipsDir: string
  script?: string
  /** The title of the story, shown on the card and given as the topic. */
  topic?: string
  channel?: string
  /** Target length in minutes, 0.25 = 15 s. */
  minutes?: number
  seed?: number
  style?: Record<string, unknown>
  services?: Partial<EngineServices>
  onEvent?: (e: EngineEvent) => void
}

export interface RedditShortResult {
  status: RunStatus
  states: Record<string, NodeState>
  ms: number
  video: string | null
  /** The quality report (`atelier.qc/1`), when the check ran. */
  qc: Record<string, unknown> | null
  /** The background layer (a silent film as long as the voice) and what it and the card said about themselves. */
  backgroundFile: string | null
  background: Record<string, unknown> | null
  card: Record<string, unknown> | null
  /** The voice node's outputs: the audio file with its meta, and the word times. */
  voice: { file: string | null; meta: Record<string, unknown>; words: unknown }
  /** Drawn step → engine node, and what the compiler said about the drawing. */
  compiled: ReturnType<typeof pipelineFromDrawing>
  ran: string[]
  errors: { nodeId: string; code: string; message: string }[]
  /** Nodes that stopped at a gate (the quality check does, when it finds a problem). */
  gates: string[]
}

export async function runRedditShort(o: RedditShortOptions): Promise<RedditShortResult> {
  const registry = productionRegistry()
  const minutes = o.minutes ?? 0.25
  const style = { ...DEFAULT_SIMPLE_STYLE, ...o.style }
  const compiled = pipelineFromDrawing(REDDIT_SHORT_DRAWING, { id: 'reddit-short', minutes })
  const v = validatePipeline(withSpeakers(compiled.pipeline, style), registry, { styleFields: Object.keys(style) })
  if (!v.ok) throw new Error(`the Reddit pipeline is invalid: ${v.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`)
  const host = nodeHost({ dataDir: o.dataDir, resourcesDir: o.resourcesDir, extra: o.services })
  const store = new FsArtefactStore(path.join(o.dataDir, 'artefacts'))
  const fingerprints = new Map<string, string>()
  const ran: string[] = []
  const gates: string[] = []
  const errors: RedditShortResult['errors'] = []
  const t0 = Date.now()
  const topic = o.topic ?? 'Le voisin et la clé disparue'
  const run = startRun({
    plan: v.plan,
    store,
    state: new MemoryNodeStateStore(),
    scope: 'reddit-short',
    inputs: {
      topic: { value: topic },
      script: { value: o.script ?? SAMPLE_STORY },
      gameplay: { value: o.clipsDir },
      ...(o.channel ? { channel: { value: o.channel } } : {})
    },
    style,
    budgetMode: 'usage_max',
    gateMode: 'all',
    minutes,
    seeds: o.seed !== undefined ? { background: o.seed } : {},
    useFakes: true,
    services: host.services,
    onEvent: (e) => {
      // every gate is approved so the film is made; a flagged quality check is recorded in `gates` first
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
  const video = (await outputOf('render', 'video')).files[0] ?? null
  const qc = (await outputOf('qc', 'report')).value
  await host.cleanup()
  return {
    status: result.status,
    states: result.states,
    ms,
    video,
    qc: (qc as Record<string, unknown> | undefined) ?? null,
    backgroundFile: (await outputOf('background', 'layer')).files[0] ?? null,
    background: (await outputOf('background', 'layer')).meta,
    card: (await outputOf('card', 'card')).meta,
    voice: { file: (await outputOf('voice', 'audio')).files[0] ?? null, meta: (await outputOf('voice', 'audio')).meta, words: (await outputOf('voice', 'words')).value },
    compiled,
    ran,
    errors,
    gates
  }
}
