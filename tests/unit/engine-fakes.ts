// Test-only nodes, clock and helpers for the engine core (lot P2). Nothing here ships: real nodes arrive in lot P4.
import { z } from 'zod'
import {
  AbortError,
  NodeRegistry,
  defineNode,
  type AnyNodeDef,
  type ArtefactType,
  type Clock,
  type EngineEvent,
  type Estimate,
  type Executor,
  type NodeOutputs,
  type NodeTypeId,
  type PortSpec,
  type ResolvedInputs,
  type RunCtx,
  type RunSetting
} from '../../src/engine'

/** A clock whose sleeps return at once (recorded), so retries and backoff cost no real time. */
export function fakeClock(start = 1_000_000): Clock & { sleeps: number[] } {
  let t = start
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => t,
    sleep: (ms, signal) => {
      if (signal?.aborted) return Promise.reject(new AbortError())
      sleeps.push(ms)
      t += ms
      return Promise.resolve()
    }
  }
}

/** A clock whose sleeps wait until the test advances time (to observe a run while it waits). */
export function manualClock(start = 1_000_000): Clock & { advance(ms: number): Promise<void>; pending(): number } {
  let t = start
  let timers: { at: number; resolve: () => void }[] = []
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  return {
    now: () => t,
    pending: () => timers.length,
    sleep: (ms, signal) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new AbortError())
          return
        }
        const timer = { at: t + ms, resolve }
        timers.push(timer)
        signal?.addEventListener(
          'abort',
          () => {
            timers = timers.filter((x) => x !== timer)
            reject(new AbortError())
          },
          { once: true }
        )
      }),
    advance: async (ms) => {
      t += ms
      const due = timers.filter((x) => x.at <= t)
      timers = timers.filter((x) => x.at > t)
      for (const x of due) x.resolve()
      await flush()
    }
  }
}

/** Lets pending promise callbacks and microtasks run. */
export const settleTicks = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

export type RunFn = (ctx: RunCtx, inputs: ResolvedInputs, params: Record<string, unknown>) => Promise<NodeOutputs>

interface TestNodeSpec {
  type: NodeTypeId
  inputs?: Record<string, PortSpec>
  outputs: Record<string, ArtefactType>
  params?: z.ZodType<Record<string, unknown>>
  executors?: Executor[]
  claudeRole?: string
  render?: boolean
  defaultGate?: 'none' | 'review' | 'owner'
  reads?: RunSetting[]
  estimate?: (where: Executor, params: Record<string, unknown>) => Estimate
}

/** Default output for a type: a string for text, an object for json, a file name for media. */
export function sampleOutput(type: ArtefactType, tag: string): NodeOutputs[string] {
  if (type.startsWith('text.')) return { value: `${type} ${tag}` }
  if (type.startsWith('json.') || type === 'package.youtube') return { value: { tag }, files: type === 'package.youtube' ? [`${tag}.zip`] : undefined }
  if (type.endsWith('[]')) return { files: [`${tag}-0.bin`, `${tag}-1.bin`] }
  return { files: [`${tag}.bin`] }
}

export interface Harness {
  registry: NodeRegistry
  /** Node ids (from ctx-free args: the pipeline node id is not visible to a node) — records `type` per call. */
  calls: string[]
  /** Replace the behaviour of one node type for a test. */
  behave: Map<string, RunFn>
}

const PARAMS = z.object({ tone: z.string().default('calm'), seedNote: z.string().optional() }).strict()

/** The test catalogue: a small video-shaped graph with every kind of node (Claude, cloud, render, gated). */
export const TEST_NODES: TestNodeSpec[] = [
  { type: 'research.topic@1', inputs: { topic: { type: 'text.brief', required: true } }, outputs: { brief: 'text.brief' }, claudeRole: 'researcher' },
  {
    type: 'script.write@1',
    inputs: { brief: { type: 'text.brief', required: true } },
    outputs: { text: 'text.script' },
    claudeRole: 'scriptwriter',
    params: z.object({ tone: z.string().default('calm'), skills: z.array(z.string()).default([]) }).strict()
  },
  {
    type: 'voice.tts@1',
    inputs: { script: { type: 'text.script', required: true } },
    outputs: { audio: 'audio.voice', words: 'json.words' },
    executors: ['cloud', 'local'],
    params: z.object({ voice: z.string().default('v1'), speed: z.number().min(0.5).max(2).default(1) }).strict(),
    estimate: (where) => ({ units: where === 'local' ? [] : [{ unit: 'chars', qty: 1200 }], provider: 'fake-tts', durationS: 30 })
  },
  {
    type: 'beats.split@1',
    inputs: { script: { type: 'text.script', required: true }, words: { type: 'json.words', required: true } },
    outputs: { beats: 'json.beats' }
  },
  {
    type: 'visuals.fulfil@1',
    inputs: { beats: { type: 'json.beats', required: true }, camera: { type: 'media.clip[]', required: false } },
    outputs: { clips: 'media.clip[]' },
    executors: ['cloud', 'local'],
    params: z.object({ videoShare: z.number().min(0).max(1).default(0) }).strict(),
    estimate: (where, p) => ({ units: where === 'local' ? [] : [{ unit: 'images', qty: 10 + Math.round(20 * Number(p.videoShare ?? 0)) }], durationS: 40 })
  },
  {
    type: 'render.assemble@1',
    inputs: {
      beats: { type: 'json.beats', required: true },
      visuals: { type: 'media.clip[]', required: true },
      voice: { type: 'audio.voice', required: true }
    },
    outputs: { video: 'video.final' },
    executors: ['local', 'gpu'],
    render: true,
    estimate: (where) => ({ units: where === 'gpu' ? [{ unit: 'gpu_s', qty: 90 }] : [], durationS: where === 'gpu' ? 90 : 300 })
  },
  {
    type: 'thumbnail.make@1',
    inputs: { brief: { type: 'text.brief', required: true } },
    outputs: { images: 'image.thumbnail[]' },
    executors: ['cloud', 'local']
  },
  {
    type: 'package.youtube@1',
    inputs: { video: { type: 'video.final', required: true }, thumbs: { type: 'image.thumbnail[]', required: false } },
    outputs: { pack: 'package.youtube' },
    claudeRole: 'packager',
    defaultGate: 'owner'
  },
  // a second version lives beside the first (R2.1)
  { type: 'research.topic@2', inputs: { topic: { type: 'text.brief', required: true } }, outputs: { brief: 'text.brief' }, claudeRole: 'researcher' }
]

/** The test catalogue; `over` changes the declaration of some node types (e.g. `reads`) for one test. */
export function harness(over: Record<string, Partial<TestNodeSpec>> = {}): Harness {
  const calls: string[] = []
  const behave = new Map<string, RunFn>()
  const defs: AnyNodeDef[] = TEST_NODES.map((base) => {
    const spec: TestNodeSpec = { ...base, ...over[base.type] }
    const run: RunFn = async (ctx, inputs, params) => {
      calls.push(spec.type)
      const custom = behave.get(spec.type)
      if (custom) return custom(ctx, inputs, params)
      ctx.emit({ kind: 'progress', frac: 0.5, text: 'à mi-chemin' })
      const tag = `${spec.type}|${JSON.stringify(params)}|${Object.values(inputs).map((a) => a.fingerprint.slice(0, 8)).join(',')}|${ctx.seed}|${ctx.notes.join('/')}`
      return Object.fromEntries(Object.entries(spec.outputs).map(([name, type]) => [name, sampleOutput(type, tag)]))
    }
    return defineNode<Record<string, unknown>>({
      type: spec.type,
      inputs: spec.inputs ?? {},
      outputs: spec.outputs,
      params: spec.params ?? PARAMS,
      executors: spec.executors ?? ['local'],
      ...(spec.claudeRole ? { claudeRole: spec.claudeRole } : {}),
      ...(spec.render ? { render: true } : {}),
      ...(spec.defaultGate ? { defaultGate: spec.defaultGate } : {}),
      ...(spec.reads ? { reads: spec.reads } : {}),
      estimate: (ctx, params) => spec.estimate?.(ctx.where, params) ?? { units: [], durationS: 10 },
      run,
      fake: run
    })
  })
  return { registry: new NodeRegistry(defs), calls, behave }
}

/** A pipeline over the test catalogue, shaped like the spec's example (§5). */
export function videoPipeline(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: 'atelier.pipeline/1',
    id: 'doc-test',
    version: 1,
    name: 'Documentaire de test',
    format: { kind: 'youtube_long', aspect: '16:9', minutes: { default: 10, min: 1, max: 30 } },
    inputs: [
      { id: 'topic', kind: 'text', required: true, label: 'Sujet' },
      { id: 'camera', kind: 'video', suggested: true, label: 'Tes plans' }
    ],
    budget: { default: 'usage_max', capCredits: 400 },
    nodes: [
      { id: 'research', type: 'research.topic@1', in: { topic: '$inputs.topic' } },
      { id: 'script', type: 'script.write@1', in: { brief: 'research.brief' }, params: { skills: ['hook'] } },
      { id: 'voice', type: 'voice.tts@1', in: { script: 'script.text' }, params: { voice: '$style.voice' } },
      { id: 'beats', type: 'beats.split@1', in: { script: 'script.text', words: 'voice.words' } },
      {
        id: 'visuals',
        type: 'visuals.fulfil@1',
        in: { beats: 'beats.beats', camera: '$inputs.camera' },
        modes: { qualite_max: { videoShare: 0.4 }, usage_max: { videoShare: 0 } }
      },
      { id: 'render', type: 'render.assemble@1', where: 'auto', in: { beats: 'beats.beats', visuals: 'visuals.clips', voice: 'voice.audio' } },
      { id: 'thumbs', type: 'thumbnail.make@1', in: { brief: 'research.brief' } },
      { id: 'package', type: 'package.youtube@1', in: { video: 'render.video', thumbs: 'thumbs.images' } }
    ],
    ...over
  }
}

/** Node events of one node, kinds only, in order. */
export const kindsOf = (events: EngineEvent[], nodeId: string): string[] =>
  events.filter((e) => 'nodeId' in e && e.nodeId === nodeId && e.kind !== 'state').map((e) => e.kind)

/** Resolves when `pred` holds for an emitted event (or already did). */
export function waitForEvent(history: () => EngineEvent[], on: (l: (e: EngineEvent) => void) => () => void, pred: (e: EngineEvent) => boolean): Promise<EngineEvent> {
  const hit = history().find(pred)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve) => {
    const off = on((e) => {
      if (pred(e)) {
        off()
        resolve(e)
      }
    })
  })
}
