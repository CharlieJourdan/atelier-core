// Test nodes for the local worker (lot P5), run inside a real child process by tests/unit/local-worker.test.ts through
// tests/unit/fixtures/worker-main.ts. Nothing here ships.
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { EngineError } from '../../../src/engine/errors'
import { NodeRegistry, defineNode, type AnyNodeDef, type RunCtx } from '../../../src/engine/registry'
import { need } from '../../../src/engine/services'

const Params = z.object({ word: z.string().default('bonjour') }).strict()
type P = z.infer<typeof Params>
const estimate = () => ({ units: [], durationS: 1 })

const echoRun = async (ctx: RunCtx, inputs: Record<string, { value?: unknown; files?: string[] }>, p: P) => {
  const dir = await (ctx.services.workspace as NonNullable<RunCtx['services']['workspace']>).scratch('echo')
  const file = path.join(dir, 'echo.txt')
  const from = inputs.text?.value
  await writeFile(file, `${p.word}|${String(from ?? '')}|seed=${ctx.seed}|attempt=${ctx.attempt}|notes=${ctx.notes.join('/')}`)
  ctx.emit({ kind: 'progress', frac: 0.5, text: 'à moitié' })
  ctx.emit({ kind: 'log', level: 'info', text: 'écrit' })
  ctx.reportCost({ units: [{ unit: 'chars', qty: 42 }], provider: 'test' })
  return { clips: { files: [file] }, text: { value: `${p.word} ${String(from ?? '')}`.trim() } }
}

const echo = defineNode<P>({
  type: 't.echo@1',
  inputs: { text: { type: 'text.brief', required: false } },
  outputs: { clips: 'media.clip[]', text: 'text.brief' },
  params: Params,
  executors: ['local'],
  estimate,
  run: echoRun,
  fake: async (ctx, inputs, p) => echoRun(ctx, inputs, { word: `faux-${p.word}` })
})

const slowRun = async (ctx: RunCtx): Promise<never> => {
  const g = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' })
  ctx.emit({ kind: 'log', level: 'info', text: `grandchild ${String(g.pid)}` })
  return new Promise<never>(() => setInterval(() => undefined, 1000))
}
const slow = defineNode({
  type: 't.slow@1',
  inputs: {},
  outputs: { text: 'text.brief' },
  params: z.object({}).strict(),
  executors: ['local'],
  estimate,
  run: slowRun,
  fake: slowRun
})

const crashRun = async (): Promise<never> => process.exit(3)
const crash = defineNode({
  type: 't.crash@1',
  inputs: {},
  outputs: { text: 'text.brief' },
  params: z.object({}).strict(),
  executors: ['local'],
  estimate,
  run: crashRun,
  fake: crashRun
})

const cloudRun = async (ctx: RunCtx) => {
  const dir = await (ctx.services.workspace as NonNullable<RunCtx['services']['workspace']>).scratch('voice')
  const got = await need(ctx, 'cloud').synthesize({ text: 'Salut', voiceId: 'v1', wordTimings: true }, { idempotencyKey: 'key-1', signal: ctx.signal, dir })
  return { text: { value: JSON.stringify({ got, dir }) } }
}
const cloud = defineNode({
  type: 't.cloud@1',
  inputs: {},
  outputs: { text: 'text.brief' },
  params: z.object({}).strict(),
  executors: ['local'],
  estimate,
  run: cloudRun,
  fake: cloudRun
})

const refuseRun = async (): Promise<never> => {
  throw new EngineError('refused', 'contenu refusé par le fournisseur')
}
const refuse = defineNode({
  type: 't.refuse@1',
  inputs: {},
  outputs: { text: 'text.brief' },
  params: z.object({}).strict(),
  executors: ['local'],
  estimate,
  run: refuseRun,
  fake: refuseRun
})

// prints on stdout without a final newline, right before its protocol lines (progress, then done)
const noisyRun = async (ctx: RunCtx) => {
  process.stdout.write('bruit sans fin de ligne')
  ctx.emit({ kind: 'progress', frac: 0.9 })
  process.stdout.write('encore du bruit')
  return { text: { value: 'malgré le bruit' } }
}
const noisy = defineNode({
  type: 't.noisy@1',
  inputs: {},
  outputs: { text: 'text.brief' },
  params: z.object({}).strict(),
  executors: ['local'],
  estimate,
  run: noisyRun,
  fake: noisyRun
})

export const WORKER_TEST_NODES: readonly AnyNodeDef[] = [echo, slow, crash, cloud, refuse, noisy]

export function registry(): NodeRegistry {
  return new NodeRegistry(WORKER_TEST_NODES)
}
