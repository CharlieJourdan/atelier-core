// Test-only nodes, pipeline and helpers for lot Z1's runs (no ffmpeg, no system voice): small nodes that write real
// files in a temp folder, so the disk artefact store, outputs and files are exercised for real.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { AbortError, NodeRegistry, defineNode, type AnyNodeDef, type Estimate, type Executor, type NodeOutputs, type RunCtx } from '../../src/engine'
import type { NodeHost } from '../../src/engine/host'
import type { Pipeline } from '../../src/engine/pipeline-schema'
import type { CoreOptions } from '../../src/main/core'

export interface Fixture {
  dir: string
  registry: NodeRegistry
  /** Calls per node type (real executions, not cached reuse). */
  calls: Record<string, number>
  /** Make a node type hang until cancelled (`block.add('render.assemble@1')`). */
  block: Set<string>
  /** Make a node type fail permanently once. */
  failOnce: Set<string>
  /** Paid placement for the voice (non-demo path): `cloud` executor with a chars estimate. */
  paid: boolean
  productionRuns: NonNullable<CoreOptions['productionRuns']>
  cleanup(): void
}

// channelStyle: the real script writers accept the channel's own script words (#107), so the double does
const P = z.object({ voice: z.string().default('v1'), channelStyle: z.string().optional() }).strict()

export function fixture(opts: { paid?: boolean } = {}): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'z1-runs-'))
  const work = path.join(dir, 'work')
  mkdirSync(work, { recursive: true })
  const calls: Record<string, number> = {}
  const block = new Set<string>()
  const failOnce = new Set<string>()
  let n = 0
  const file = (name: string, content: string): string => {
    const f = path.join(work, `${++n}-${name}`)
    writeFileSync(f, content)
    return f
  }
  const wait = (ctx: RunCtx): Promise<never> =>
    new Promise((_, reject) => {
      if (ctx.signal.aborted) reject(new AbortError())
      ctx.signal.addEventListener('abort', () => reject(new AbortError()), { once: true })
    })
  const node = (
    type: `${string}@${number}`,
    spec: {
      inputs: Record<string, { type: Parameters<typeof defineNode>[0]['outputs'][string]; required: boolean }>
      outputs: Parameters<typeof defineNode>[0]['outputs']
      executors?: Executor[]
      estimate?: () => Estimate
      defaultGate?: 'review' | 'owner'
      claudeRole?: string
      make: (ctx: RunCtx, inputs: Record<string, { value?: unknown; files?: string[] }>, p: { voice: string }) => NodeOutputs
    }
  ): AnyNodeDef => {
    const run = async (ctx: RunCtx, inputs: Record<string, { value?: unknown; files?: string[] }>, p: { voice: string }): Promise<NodeOutputs> => {
      calls[type] = (calls[type] ?? 0) + 1
      ctx.emit({ kind: 'progress', frac: 0.5, text: 'à mi-chemin' })
      if (block.has(type)) await wait(ctx)
      if (failOnce.has(type)) {
        failOnce.delete(type)
        const { EngineError } = await import('../../src/engine/errors')
        throw new EngineError('bad_input', 'test failure')
      }
      return spec.make(ctx, inputs, p)
    }
    return defineNode<{ voice: string }>({
      type,
      inputs: spec.inputs,
      outputs: spec.outputs,
      params: P,
      executors: spec.executors ?? ['local'],
      ...(spec.defaultGate ? { defaultGate: spec.defaultGate } : {}),
      ...(spec.claudeRole ? { claudeRole: spec.claudeRole } : {}),
      estimate: spec.estimate ?? (() => ({ units: [], durationS: 1 })),
      run: (ctx, i, p) => run(ctx, i, p),
      fake: (ctx, i, p) => run(ctx, i, p)
    })
  }
  const f: Fixture = {
    dir,
    calls,
    block,
    failOnce,
    paid: opts.paid === true,
    registry: new NodeRegistry([]),
    productionRuns: {},
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  f.registry = new NodeRegistry([
    node('research.topic@1', {
      inputs: { topic: { type: 'text.input', required: true } },
      outputs: { brief: 'text.brief' },
      claudeRole: 'researcher',
      make: (_c, i) => ({ brief: { value: `Brief sur ${String(i.topic?.value)}` } })
    }),
    node('script.write@1', {
      inputs: { brief: { type: 'text.brief', required: true } },
      outputs: { text: 'text.script' },
      claudeRole: 'scriptwriter',
      make: (c) => ({ text: { value: `Script ${c.notes.length > 0 ? `corrigé (${c.notes.join(' / ')})` : 'initial'}`, meta: { demo: true } } })
    }),
    node('voice.tts@1', {
      inputs: { script: { type: 'text.script', required: true } },
      outputs: { audio: 'audio.voice', words: 'json.words' },
      executors: opts.paid ? ['cloud'] : ['local'],
      estimate: () => ({ units: [{ unit: 'chars', qty: 1000 }], provider: 'voice', durationS: 2 }),
      make: (c, i, p) => {
        c.reportCost({ units: [{ unit: 'chars', qty: 500 }], provider: 'voice' })
        return {
          audio: { files: [file('voice.wav', `RIFF ${String(i.script?.value)}`)], meta: { durationS: 3.5, voice: p.voice, systemVoice: 'Test', demo: true } },
          words: { value: [{ w: 'Script', start: 0, end: 0.5, sentence: 0, paragraph: 0 }] }
        }
      }
    }),
    node('render.assemble@1', {
      inputs: { voice: { type: 'audio.voice', required: true } },
      outputs: { video: 'video.final' },
      estimate: () => ({ units: [{ unit: 'images', qty: 2 }], provider: 'image', durationS: 3 }),
      make: (c) => {
        c.reportCost({ units: [{ unit: 'images', qty: 2 }], provider: 'image' })
        return { video: { files: [file('video.mp4', 'MP4DATA')], meta: { durationS: 61.2, width: 1920, height: 1080, demo: true } } }
      }
    }),
    node('package.youtube@1', {
      inputs: { video: { type: 'video.final', required: true } },
      outputs: { metadata: 'json.metadata', package: 'package.youtube' },
      defaultGate: 'owner',
      make: () => ({
        metadata: { value: { title: 'Titre test', alternatives: ['Autre'], description: 'Desc', chapters: [{ at: 0, title: 'Intro' }], tags: ['a', 'b'], demo: true } },
        package: {
          value: { title: 'Titre test', files: ['video.mp4', 'description.txt'], demo: true },
          files: [file('video.mp4', 'MP4DATA'), file('description.txt', 'Desc')]
        }
      })
    })
  ])
  const host = (): NodeHost => ({ services: {}, cleanup: () => Promise.resolve() })
  f.productionRuns = {
    dataDir: path.join(dir, 'data'),
    resourcesDir: path.join(dir, 'resources'),
    registry: f.registry,
    pipeline: testPipeline,
    defaultStyle: { voice: 'v1' },
    host,
    notifyEveryMs: 0,
    demo: !opts.paid
  }
  return f
}

export const testPipeline = (minutes: number): Pipeline => ({
  $schema: 'atelier.pipeline/1',
  id: 'test-video',
  version: 3,
  name: 'Vidéo de test',
  format: { kind: 'youtube_long', aspect: '16:9', minutes: { default: minutes, min: 0.5, max: 30 } },
  inputs: [{ id: 'topic', kind: 'text', required: true, label: 'Sujet' }],
  budget: { default: 'usage_max' },
  nodes: [
    { id: 'research', type: 'research.topic@1', in: { topic: '$inputs.topic' } },
    { id: 'script', type: 'script.write@1', in: { brief: 'research.brief' }, gate: 'review' },
    { id: 'voice', type: 'voice.tts@1', in: { script: 'script.text' }, params: { voice: '$style.voice' } },
    { id: 'render', type: 'render.assemble@1', in: { voice: 'voice.audio' } },
    { id: 'package', type: 'package.youtube@1', in: { video: 'render.video' }, gate: 'owner' }
  ]
})

/** Polls until `check` returns a truthy value (or throws after `ms`). */
export async function waitFor<T>(check: () => T | Promise<T>, ms = 5_000, what = 'condition'): Promise<NonNullable<T>> {
  const until = Date.now() + ms
  for (;;) {
    const v = await check()
    if (v) return v as NonNullable<T>
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}
