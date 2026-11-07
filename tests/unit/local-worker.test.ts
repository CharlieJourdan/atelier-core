// The local worker (lot P5, "l'ouvrier local"): one engine node per child process, real processes run by plain Node
// (tests/unit/fixtures/worker-main.ts with the test catalogue). Outputs, events and costs cross the protocol; the
// scheduler stores the results; cancel kills the worker and its grandchild; a crash is transient (retried), a refusal
// permanent; the child's Cloud calls reach the parent's service. A simulated darwin checks the process group and kill.
import { EventEmitter } from 'node:events'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  AbortError,
  EngineError,
  FsArtefactStore,
  createRunCtx,
  defineNode,
  startRun,
  validatePipeline,
  type AnyNodeDef,
  type CloudService,
  type Cost,
  type EngineEvent,
  type EngineServices,
  type NodeExecution,
  type NodeReport,
  type ResolvedInputs
} from '../../src/engine'
import { appWorkerCommand, localWorkerExecutor, nodeWorkerCommand, resourcesDirFor } from '../../src/main/production/local-worker'
import { boundedLines, workerEnv } from '../../src/main/production/worker-io'
import { decodeChildLine, encodeChildLine } from '../../src/shared/worker-protocol'
import { fakeClock } from './engine-fakes'
import { ROOT, RESOURCES, tempDir } from './engine-node-helpers'
import { registry as workerRegistry } from './fixtures/worker-nodes'

const ENTRY = path.join(ROOT, 'tests', 'unit', 'fixtures', 'worker-main.ts')
const REAL = 30_000 // real child processes under plain Node: about a second each

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function waitGone(pid: number): Promise<void> {
  for (let i = 0; i < 200 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50))
  expect(alive(pid)).toBe(false)
}

function setup(services: EngineServices = {}) {
  const t = tempDir('worker')
  const cmd = nodeWorkerCommand(ROOT, path.join(t.dir, 'data'), RESOURCES, ENTRY)
  const worker = localWorkerExecutor({ ...cmd, workRoot: path.join(t.dir, 'work'), services: () => services })
  cleanups.push(t.cleanup, () => {
    for (const pid of worker.pids()) if (alive(pid)) process.kill(pid)
  })
  return { dir: t.dir, worker }
}

/** One attempt of a node as the scheduler hands it to an executor. */
function execution(type: string, o: { inputs?: ResolvedInputs; params?: unknown; signal?: AbortSignal; useFake?: boolean } = {}) {
  const reports: NodeReport[] = []
  const costs: Cost[] = []
  const def = workerRegistry().get(type) ?? defineNode({
    type: type as `${string}@${number}`,
    inputs: {},
    outputs: { text: 'text.brief' },
    params: z.object({}),
    executors: ['local'],
    estimate: () => ({ units: [], durationS: 1 }),
    run: () => Promise.reject(new Error('runs in the worker only')),
    fake: () => Promise.reject(new Error('runs in the worker only'))
  })
  const settings = { minutes: 2, budgetMode: 'usage_max' as const }
  const ctx = createRunCtx(
    def,
    {
      emit: (r) => reports.push(r),
      signal: o.signal ?? new AbortController().signal,
      store: { read: async () => null },
      seed: 7,
      where: 'local',
      attempt: 2,
      notes: ['plus court'],
      reportCost: (c) => costs.push(c),
      services: {}
    },
    settings
  )
  const x: NodeExecution = {
    runId: 'run-1',
    nodeId: 'n1',
    def: def as AnyNodeDef,
    params: o.params ?? {},
    inputs: o.inputs ?? {},
    ctx,
    settings,
    useFake: o.useFake ?? false,
    fingerprint: 'f'.repeat(64),
    idempotencyKey: 'idem-1'
  }
  return { x, reports, costs }
}

describe('local worker: one node in a child process', () => {
  it('returns the outputs, the events and the cost of the node; cleanup removes the attempt folder', async () => {
    const { worker, dir } = setup()
    const { x, reports, costs } = execution('t.echo@1', {
      params: { word: 'salut' },
      inputs: { text: { type: 'text.brief', fingerprint: 'a'.repeat(64), value: 'le monde' } }
    })
    const out = await worker.run(x)
    expect(out.text).toEqual({ value: 'salut le monde' })
    const file = out.clips?.files?.[0] as string
    expect(path.isAbsolute(file)).toBe(true)
    expect(file.startsWith(path.join(dir, 'work'))).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('salut|le monde|seed=7|attempt=2|notes=plus court')
    expect(reports).toEqual([
      { kind: 'progress', frac: 0.5, text: 'à moitié' },
      { kind: 'log', level: 'info', text: 'écrit' }
    ])
    expect(costs).toEqual([{ units: [{ unit: 'chars', qty: 42 }], provider: 'test' }])
    expect(worker.pids()).toEqual([])
    await worker.cleanup()
    expect(existsSync(file)).toBe(false)
    expect(existsSync(path.join(dir, 'work'))).toBe(true)
  }, REAL)

  it('runs the fake of the node when asked', async () => {
    const { worker } = setup()
    const { x } = execution('t.echo@1', { params: { word: 'a' }, useFake: true })
    expect((await worker.run(x)).text).toEqual({ value: 'faux-a' })
    await worker.cleanup()
  }, REAL)

  it('a crash is a transient error with the exit code; a refusal stays permanent; an unknown node is bad_params', async () => {
    const { worker } = setup()
    const crash = await worker.run(execution('t.crash@1').x).catch((e: unknown) => e)
    expect(crash).toBeInstanceOf(EngineError)
    expect((crash as EngineError).code).toBe('transient')
    expect((crash as EngineError).permanent).toBe(false)
    expect((crash as EngineError).message).toMatch(/L’ouvrier local s’est arrêté en cours de route \(code 3\)/)

    const refused = await worker.run(execution('t.refuse@1').x).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(EngineError)
    expect(refused).toMatchObject({ code: 'refused', permanent: true, message: 'contenu refusé par le fournisseur' })

    const unknown = await worker.run(execution('t.nope@1').x).catch((e: unknown) => e)
    expect(unknown).toBeInstanceOf(EngineError)
    expect(unknown).toMatchObject({ code: 'bad_params', permanent: true })
    expect((unknown as EngineError).message).toMatch(/t\.nope@1/)

    const badParams = await worker.run(execution('t.echo@1', { params: { word: 3 } }).x).catch((e: unknown) => e)
    expect(badParams).toMatchObject({ code: 'bad_params', permanent: true })
    await worker.cleanup()
  }, REAL)

  it('text a node prints without a final newline never swallows a protocol line', async () => {
    const { worker } = setup()
    const { x, reports } = execution('t.noisy@1')
    expect(await worker.run(x)).toEqual({ text: { value: 'malgré le bruit' } })
    expect(reports).toEqual([{ kind: 'progress', frac: 0.9 }])
    await worker.cleanup()
  }, REAL)

  it('a Cloud call of the node reaches the parent service with its request and options, and the answer comes back', async () => {
    const seen: { req: unknown; opts: { idempotencyKey: string; dir: string; signal: AbortSignal } }[] = []
    const cloud: CloudService = {
      synthesize: async (req, opts) => {
        seen.push({ req, opts })
        return { audioFile: path.join(opts.dir, 'voice.wav'), words: [{ word: 'Salut', start: 0, end: 0.4 }], demo: true, credits: 3 }
      },
      generateImage: () => Promise.reject(new Error('not used')),
      generateVideo: () => Promise.reject(new Error('not used')),
      talkingAvatar: () => Promise.reject(new Error('not used')),
      searchStock: () => Promise.reject(new Error('not used'))
    }
    const { worker } = setup({ cloud })
    const { x } = execution('t.cloud@1')
    const out = await worker.run(x)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.req).toEqual({ text: 'Salut', voiceId: 'v1', wordTimings: true })
    expect(seen[0]?.opts.idempotencyKey).toBe('key-1')
    expect(seen[0]?.opts.signal).toBe(x.ctx.signal)
    const { got, dir } = JSON.parse(String(out.text?.value)) as { got: unknown; dir: string }
    expect(seen[0]?.opts.dir).toBe(dir)
    expect(path.basename(dir)).toBe('001-voice')
    expect(got).toEqual({ audioFile: path.join(dir, 'voice.wav'), words: [{ word: 'Salut', start: 0, end: 0.4 }], demo: true, credits: 3 })
    await worker.cleanup()
  }, REAL)

  it('a Cloud call without a Cloud in the parent fails with the missing_tool message; a failing call keeps its code', async () => {
    const { worker } = setup({})
    const missing = await worker.run(execution('t.cloud@1').x).catch((e: unknown) => e)
    expect(missing).toMatchObject({ code: 'missing_tool', permanent: true, message: 'Atelier Cloud est injoignable : cette étape passe par le Cloud.' })

    const failing = setup({
      cloud: {
        synthesize: () => Promise.reject(new EngineError('budget', 'plus de crédits')),
        generateImage: () => Promise.reject(new Error('not used')),
        generateVideo: () => Promise.reject(new Error('not used')),
        talkingAvatar: () => Promise.reject(new Error('not used')),
      searchStock: () => Promise.reject(new Error('not used'))
      }
    })
    const e = await failing.worker.run(execution('t.cloud@1').x).catch((err: unknown) => err)
    expect(e).toMatchObject({ code: 'budget', permanent: true, message: 'plus de crédits' })
  }, REAL)
})

const pipeline = (nodes: unknown[]) => ({
  $schema: 'atelier.pipeline/1',
  id: 'worker-test',
  version: 1,
  name: 'Ouvrier',
  format: { kind: 'youtube_long', aspect: '16:9', minutes: { default: 1, min: 1, max: 30 } },
  inputs: [],
  budget: { default: 'usage_max', capCredits: 10 },
  nodes
})

function planOf(doc: unknown) {
  const r = validatePipeline(doc, workerRegistry())
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r.plan
}

describe('local worker under the scheduler', () => {
  it('a 2-node pipeline: results stored, scratch cleaned by cleanup()', async () => {
    const { worker, dir } = setup()
    const store = new FsArtefactStore(path.join(dir, 'store'))
    const events: EngineEvent[] = []
    const run = startRun({
      plan: planOf(pipeline([
        { id: 'a', type: 't.echo@1', params: { word: 'un' } },
        { id: 'b', type: 't.echo@1', params: { word: 'deux' }, in: { text: 'a.text' } }
      ])),
      store,
      executors: { local: worker },
      clock: fakeClock(),
      onEvent: (e) => events.push(e)
    })
    const res = await run.done
    expect(res.status).toBe('done')
    expect(res.states).toEqual({ a: 'done', b: 'done' })
    const doneB = events.find((e) => e.kind === 'done' && e.nodeId === 'b')
    expect(doneB && 'cost' in doneB ? doneB.cost : undefined).toEqual({ units: [{ unit: 'chars', qty: 42 }], provider: 'test' })
    expect(events.some((e) => e.kind === 'progress' && e.nodeId === 'a' && e.text === 'à moitié')).toBe(true)
    await worker.cleanup()
    const fp = doneB && doneB.kind === 'done' ? doneB.fingerprint : ''
    const stored = await store.getRun(fp)
    expect(stored?.outputs.text?.value).toBe('deux un')
    const kept = stored?.outputs.clips?.files?.[0] as string
    expect(kept.startsWith(path.join(dir, 'store'))).toBe(true)
    expect(readFileSync(kept, 'utf8')).toBe('deux|un|seed=0|attempt=1|notes=')
    expect(existsSync(path.join(dir, 'work')) ? readdirSync(path.join(dir, 'work')) : []).toEqual([])
  }, REAL)

  it('cancel kills the worker and its grandchild; the node ends cancelled', async () => {
    const { worker, dir } = setup()
    let grandchild = 0
    let gotLog!: () => void
    const logged = new Promise<void>((r) => (gotLog = r))
    const run = startRun({
      plan: planOf(pipeline([{ id: 's', type: 't.slow@1' }])),
      store: new FsArtefactStore(path.join(dir, 'store')),
      executors: { local: worker },
      clock: fakeClock(),
      onEvent: (e) => {
        if (e.kind === 'log' && e.text.startsWith('grandchild ')) {
          grandchild = Number(e.text.slice('grandchild '.length))
          gotLog()
        }
      }
    })
    await logged
    const [pid] = worker.pids()
    expect(pid).toBeGreaterThan(0)
    expect(grandchild).toBeGreaterThan(0)
    expect(alive(grandchild)).toBe(true)
    run.cancel()
    const res = await run.done
    expect(res.status).toBe('cancelled')
    expect(res.states.s).toBe('cancelled')
    await waitGone(pid as number)
    await waitGone(grandchild)
    // the killed child's exit event arrives right after the process is gone
    for (let i = 0; i < 100 && worker.pids().length > 0; i++) await new Promise((r) => setTimeout(r, 50))
    expect(worker.pids()).toEqual([])
    await worker.cleanup()
  }, REAL)

  it('a crash is retried by the scheduler, then the node fails', async () => {
    const { worker, dir } = setup()
    const events: EngineEvent[] = []
    const run = startRun({
      plan: planOf(pipeline([{ id: 'c', type: 't.crash@1' }])),
      store: new FsArtefactStore(path.join(dir, 'store')),
      executors: { local: worker },
      clock: fakeClock(),
      retry: { retries: 1 },
      onEvent: (e) => events.push(e)
    })
    const res = await run.done
    expect(res.status).toBe('error')
    expect(events.filter((e) => e.kind === 'retry').map((e) => (e.kind === 'retry' ? e.code : ''))).toEqual(['transient'])
    const err = events.find((e) => e.kind === 'error')
    expect(err).toMatchObject({ code: 'transient', permanent: true })
    expect(err && err.kind === 'error' ? err.message : '').toMatch(/gave up after 1 retries: L’ouvrier local s’est arrêté/)
    await worker.cleanup()
  }, REAL)
})

/** A child process that never answers, for the simulated platforms. */
function fakeChild(pid: number): ChildProcess {
  const c = new EventEmitter() as unknown as ChildProcess
  Object.assign(c, { pid, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
  return c
}

describe('local worker: platforms (simulated)', () => {
  for (const platform of ['darwin', 'win32'] as const) {
    it(`${platform}: detached = ${String(platform !== 'win32')}, cancel kills the tree of the child pid at once`, async () => {
      const spawned: { command: string; args: string[]; options: SpawnOptions }[] = []
      const kills: [number, NodeJS.Platform][] = []
      const child = fakeChild(4242)
      const worker = localWorkerExecutor({
        command: '/Applications/Atelier.app/Contents/MacOS/Atelier',
        args: ['worker.js', '--parent-services'],
        workRoot: '/tmp/atelier-work',
        services: () => ({}),
        platform,
        spawnImpl: (command, args, options) => {
          spawned.push({ command, args, options })
          return child
        },
        killTree: (pid, p) => {
          kills.push([pid, p])
          child.emit('exit', null, 'SIGKILL')
        }
      })
      const ac = new AbortController()
      const { x } = execution('t.echo@1', { signal: ac.signal })
      const job = new Promise<string>((r) => (child.stdin as PassThrough).once('data', (d: Buffer) => r(d.toString())))
      const p = worker.run(x)
      const line = JSON.parse(await job) as { t: string; job: { nodeType: string; settings: unknown; outDir: string } }
      expect(line.t).toBe('job')
      expect(line.job.nodeType).toBe('t.echo@1')
      expect(line.job.settings).toEqual({ minutes: 2, budgetMode: 'usage_max' })
      expect(spawned[0]?.options).toMatchObject({ detached: platform !== 'win32', windowsHide: true, shell: false })
      expect(spawned[0]?.options.stdio).toEqual(['pipe', 'pipe', 'pipe'])
      ac.abort()
      await expect(p).rejects.toBeInstanceOf(AbortError)
      expect(kills).toEqual([[4242, platform]])
      expect(worker.pids()).toEqual([])
    })
  }
  it('killAll kills every running worker tree synchronously; the spawn gets the allow-listed env only', async () => {
    const children = [fakeChild(101), fakeChild(102)]
    const spawned: SpawnOptions[] = []
    const syncKills: [number, NodeJS.Platform][] = []
    const worker = localWorkerExecutor({
      command: 'atelier',
      args: [],
      env: { PATH: '/usr/bin', LC_ALL: 'fr_FR.UTF-8', ANTHROPIC_API_KEY: 'sk-test-not-real', GH_TOKEN: 'x', RANDOM_VAR: 'y' },
      workRoot: '/tmp/w',
      services: () => ({}),
      platform: 'darwin',
      spawnImpl: (_c, _a, options) => {
        spawned.push(options)
        return children[spawned.length - 1] as ChildProcess
      },
      killTree: () => undefined,
      killTreeSync: (pid, p) => {
        syncKills.push([pid, p])
        children.find((c) => c.pid === pid)?.emit('exit', null, 'SIGKILL')
      }
    })
    const runs = [worker.run(execution('t.echo@1').x), worker.run(execution('t.echo@1').x)].map((p) => p.catch((e: unknown) => e))
    expect(worker.pids().sort()).toEqual([101, 102])
    expect(spawned[0]?.env).toEqual({ PATH: '/usr/bin', LC_ALL: 'fr_FR.UTF-8' })
    worker.killAll()
    expect(syncKills).toEqual([
      [101, 'darwin'],
      [102, 'darwin']
    ])
    expect(worker.pids()).toEqual([])
    // killed without an answer: transient, so a run that was not cancelled would retry
    for (const e of await Promise.all(runs)) expect(e).toMatchObject({ code: 'transient' })
  })

  it('an attempt already cancelled spawns nothing', async () => {
    let spawns = 0
    const worker = localWorkerExecutor({
      command: 'x',
      args: [],
      workRoot: '/tmp/w',
      services: () => ({}),
      spawnImpl: () => {
        spawns++
        return fakeChild(1)
      }
    })
    const ac = new AbortController()
    ac.abort()
    await expect(worker.run(execution('t.echo@1', { signal: ac.signal }).x)).rejects.toBeInstanceOf(AbortError)
    expect(spawns).toBe(0)
  })
})

describe('local worker: commands and resources', () => {
  it('the app runs out/main/worker.js (unpacked) with Electron as Node; resources sit next to the app when packaged', () => {
    const c = appWorkerCommand({ electronPath: '/A/Atelier', outMainDir: path.join('/A', 'app.asar', 'out', 'main'), dataDir: '/d', resourcesDir: '/r' })
    expect(c.command).toBe('/A/Atelier')
    expect(c.args).toEqual([path.join('/A', 'app.asar.unpacked', 'out', 'main', 'worker.js'), '--data', '/d', '--resources', '/r', '--parent-services'])
    expect(c.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(resourcesDirFor({ isPackaged: true, resourcesPath: '/A/res', appPath: '/x' })).toBe(path.join('/A/res', 'resources'))
    expect(resourcesDirFor({ isPackaged: false, resourcesPath: '/A/res', appPath: '/repo' })).toBe(path.join('/repo', 'resources'))
  })
})

describe('local worker: env and protocol lines', () => {
  it('workerEnv keeps the system variables and never a secret', () => {
    const env = workerEnv({
      Path: 'C:\\Windows',
      PATHEXT: '.EXE',
      SystemRoot: 'C:\\Windows',
      TEMP: 't',
      HOME: '/Users/c',
      LANG: 'fr_FR.UTF-8',
      LC_CTYPE: 'UTF-8',
      ANTHROPIC_API_KEY: 'no',
      OPENAI_KEY: 'no',
      GITHUB_TOKEN: 'no',
      DB_PASSWORD: 'no',
      CLIENT_SECRET: 'no',
      NODE_OPTIONS: '--inspect',
      SOMETHING: 'no'
    })
    expect(env).toEqual({ Path: 'C:\\Windows', PATHEXT: '.EXE', SystemRoot: 'C:\\Windows', TEMP: 't', HOME: '/Users/c', LANG: 'fr_FR.UTF-8', LC_CTYPE: 'UTF-8' })
    const app = appWorkerCommand({ electronPath: 'e', outMainDir: 'o', dataDir: 'd', resourcesDir: 'r' })
    expect(Object.keys(app.env).filter((k) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k))).toEqual([])
    expect(Object.keys(nodeWorkerCommand(ROOT, 'd', 'r').env).filter((k) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k))).toEqual([])
  })

  it('a child line starts on a line of its own and decodes even glued after other text', () => {
    const line = encodeChildLine({ t: 'progress', frac: 0.5 })
    expect(line.startsWith('\n')).toBe(true)
    expect(line.endsWith('\n')).toBe(true)
    const [empty, body] = line.split('\n')
    expect(empty).toBe('')
    expect(decodeChildLine(body as string)).toEqual({ t: 'progress', frac: 0.5 })
    expect(decodeChildLine(`bruit${body as string}`)).toEqual({ t: 'progress', frac: 0.5 })
    expect(decodeChildLine('{"t":"progress","frac":0.5}')).toBeNull()
  })

  it('boundedLines splits across chunks, strips \\r, and drops a line longer than the limit', async () => {
    const s = new PassThrough()
    const got: string[] = []
    const stop = boundedLines(s, (l) => got.push(l), 10)
    s.write('ab')
    s.write('c\r\nde')
    s.write('f\n' + 'x'.repeat(8))
    s.write('y'.repeat(8)) // over the limit before any newline: dropped whole
    s.write('zz\nok\n' + 'w'.repeat(11) + '\nfin\n')
    await new Promise((r) => setImmediate(r))
    expect(got).toEqual(['abc', 'def', 'ok', 'fin'])
    stop()
  })
})
