// Test nodes of lot P5's proof: one per executor. `p5.script` runs in the local worker, `p5.voice` runs in the host
// and buys a voice from Atelier Cloud, `p5.render` is sent to the Cloud and runs in the fake RunPod's worker. The same
// registry is loaded by the test, by the local worker and by the fake RunPod's worker (p5-worker-main.ts).
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { EngineError } from '../../../src/engine/errors'
import { defineNode, NodeRegistry } from '../../../src/engine/registry'
import { need } from '../../../src/engine/services'

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

const scriptNode = defineNode({
  type: 'p5.script@1',
  inputs: { topic: { type: 'text.input', required: true } },
  outputs: { text: 'text.script' },
  params: z.object({}).strict(),
  executors: ['local'],
  estimate: () => ({ units: [], durationS: 1 }),
  run: async (ctx, inputs) => {
    ctx.emit({ kind: 'progress', frac: 0.5, text: `pid ${process.pid}` })
    return { text: { value: `Script sur ${String(inputs.topic?.value)}. Deuxième phrase du script.`, meta: { pid: process.pid } } }
  },
  fake: () => Promise.reject(new Error('not used'))
})

const voiceNode = defineNode({
  type: 'p5.voice@1',
  inputs: { script: { type: 'text.script', required: true } },
  outputs: { audio: 'audio.voice' },
  params: z.object({ voice: z.string().default('demo-claire') }).strict(),
  executors: ['cloud'],
  estimate: () => ({ units: [{ unit: 'chars', qty: 200 }], provider: 'voice', durationS: 2 }),
  run: async (ctx, inputs, p) => {
    const text = String(inputs.script?.value)
    const dir = await need(ctx, 'workspace').scratch('p5-voice')
    const res = await need(ctx, 'cloud').synthesize(
      { text, voiceId: p.voice, wordTimings: true },
      { idempotencyKey: `p5-voice-${sha(text + p.voice).slice(0, 32)}`, signal: ctx.signal, dir }
    )
    ctx.reportCost({ units: [{ unit: 'chars', qty: text.length }], provider: 'voice' })
    return { audio: { files: [res.audioFile], meta: { demo: res.demo, pid: process.pid } } }
  },
  fake: () => Promise.reject(new Error('not used'))
})

export const RenderParams = z.object({ mode: z.enum(['ok', 'fail', 'slow']).default('ok'), delayMs: z.number().int().min(0).default(0) }).strict()

const renderNode = defineNode({
  type: 'p5.render@1',
  inputs: { voice: { type: 'audio.voice', required: true }, script: { type: 'text.script', required: true } },
  outputs: { video: 'video.final' },
  params: RenderParams,
  executors: ['gpu', 'local'],
  estimate: () => ({ units: [{ unit: 'gpu_s', qty: 600 }], provider: 'gpu', durationS: 20 }),
  run: async (ctx, inputs, p) => {
    if (p.mode === 'fail') throw new EngineError('refused', 'le rendu de test refuse ce plan')
    if (p.mode === 'slow') {
      // a grandchild the cancel must take down with the worker
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      ctx.emit({ kind: 'log', level: 'info', text: `grandchild ${child.pid}` })
      ctx.emit({ kind: 'progress', frac: 0.3, text: `worker ${process.pid} grandchild ${child.pid}` })
      await new Promise(() => undefined)
    }
    if (p.delayMs > 0) await new Promise((r) => setTimeout(r, p.delayMs))
    const voice = await readFile(inputs.voice?.files?.[0] as string)
    const out = path.join(await need(ctx, 'workspace').scratch('p5-render'), 'film.txt')
    await writeFile(out, `film\nscript=${String(inputs.script?.value)}\nvoice=${sha(voice)} ${voice.length}\nwhere=${ctx.where}\n`)
    ctx.reportCost({ units: [{ unit: 'gpu_s', qty: 7 }], provider: 'gpu' })
    return { video: { files: [out], meta: { where: ctx.where, pid: process.pid, voiceSha: sha(voice) } } }
  },
  fake: () => Promise.reject(new Error('not used'))
})

/** A local node that buys pictures from the Cloud (like `visuals.fulfil`): it runs in the local worker, whose Cloud
 *  calls go through the parent. */
const buyerNode = defineNode({
  type: 'p5.buyer@1',
  inputs: { script: { type: 'text.script', required: true } },
  outputs: { images: 'media.image[]' },
  params: z.object({ count: z.number().int().min(1).default(2) }).strict(),
  executors: ['local'],
  estimate: (_ctx, p) => ({ units: [{ unit: 'images', qty: p.count }], provider: 'image', durationS: 2 }),
  run: async (ctx, inputs, p) => {
    const files: string[] = []
    for (let i = 0; i < p.count; i++) {
      const dir = await need(ctx, 'workspace').scratch(`p5-image-${i}`)
      const res = await need(ctx, 'cloud').generateImage(
        { prompt: `${String(inputs.script?.value)} #${i}`, width: 640, height: 360 },
        { idempotencyKey: `p5-image-${sha(`${String(inputs.script?.value)}#${i}`).slice(0, 32)}`, signal: ctx.signal, dir }
      )
      files.push(...res.files)
    }
    ctx.reportCost({ units: [{ unit: 'images', qty: p.count }], provider: 'image' })
    return { images: { files, meta: { pid: process.pid } } }
  },
  fake: () => Promise.reject(new Error('not used'))
})

export function registry(): NodeRegistry {
  return new NodeRegistry([scriptNode, voiceNode, renderNode, buyerNode])
}

/** script (local) → buyer (local, buys pictures from the Cloud). */
export function buyerPipeline(count = 2): Record<string, unknown> {
  return {
    $schema: 'atelier.pipeline/1',
    id: 'p5-buyer',
    version: 1,
    name: 'Un nœud local qui achète',
    format: { kind: 'youtube_long', aspect: '16:9', minutes: { default: 1, min: 1, max: 30 } },
    inputs: [{ id: 'topic', kind: 'text', required: true, label: 'Sujet' }],
    budget: { default: 'usage_max', capCredits: 400 },
    nodes: [
      { id: 'script', type: 'p5.script@1', in: { topic: '$inputs.topic' } },
      { id: 'buyer', type: 'p5.buyer@1', in: { script: 'script.text' }, params: { count } }
    ]
  }
}

/** The proof's pipeline: local → cloud → gpu. */
export function mixedPipeline(renderMode: 'ok' | 'fail' | 'slow' = 'ok', delayMs = 0): Record<string, unknown> {
  return {
    $schema: 'atelier.pipeline/1',
    id: 'p5-mixed',
    version: 1,
    name: 'Trois exécuteurs',
    format: { kind: 'youtube_long', aspect: '16:9', minutes: { default: 1, min: 1, max: 30 } },
    inputs: [{ id: 'topic', kind: 'text', required: true, label: 'Sujet' }],
    budget: { default: 'usage_max', capCredits: 400 },
    nodes: [
      { id: 'script', type: 'p5.script@1', in: { topic: '$inputs.topic' } },
      { id: 'voice', type: 'p5.voice@1', in: { script: 'script.text' } },
      { id: 'render', type: 'p5.render@1', where: 'gpu', in: { voice: 'voice.audio', script: 'script.text' }, params: { mode: renderMode, delayMs } }
    ]
  }
}
