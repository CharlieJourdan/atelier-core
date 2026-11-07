// The scheduler (ENGINE-SPEC §6, §7, §10; lot P2 proof): a changed setting redoes only what depends on it, a cancel in
// the middle of a render, 3 retries then the error, events in order. Fake nodes, fake clock: no real time, no I/O.
import { describe, expect, it } from 'vitest'
import {
  EngineError,
  MemoryArtefactStore,
  MemoryNodeStateStore,
  startRun,
  validatePipeline,
  type EngineEvent,
  type Reservation,
  type ResolvedPipeline,
  type Run,
  type StartRunOptions
} from '../../src/engine'
import { fakeClock, harness, kindsOf, settleTicks, videoPipeline, waitForEvent } from './engine-fakes'

function planOf(doc: unknown, h = harness()): ResolvedPipeline {
  const r = validatePipeline(doc, h.registry)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r.plan
}

function setup(doc: unknown = videoPipeline()) {
  const h = harness()
  const plan = planOf(doc, h)
  const store = new MemoryArtefactStore()
  const state = new MemoryNodeStateStore()
  const clock = fakeClock()
  const start = (over: Partial<StartRunOptions> = {}): Run =>
    startRun({
      plan,
      store,
      state,
      scope: 'video-1',
      inputs: { topic: { value: 'Les pyramides' } },
      style: { voice: 'clara' },
      useFakes: true,
      clock,
      random: () => 0.5,
      ...over
    })
  return { h, plan, store, state, clock, start }
}

/** Runs to the end, approving the final package (owner gate) when it asks. */
async function finish(run: Run): Promise<Awaited<Run['done']>> {
  await run.idle()
  if (run.state('package') === 'waiting_gate') run.approve('package')
  return run.done
}

const deferred = <T = void>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

/** The order rules of ENGINE-SPEC R8.1, checked over a whole run. */
function expectOrdered(events: EngineEvent[], plan: ResolvedPipeline): void {
  events.forEach((e, i) => expect(e.seq).toBe(i + 1))
  expect(events.at(-1)?.kind).toBe('run')
  for (const id of plan.order) {
    const kinds = kindsOf(events, id)
    const terminals = kinds.filter((k) => k === 'done' || k === 'error' || k === 'cancelled')
    expect(terminals.length, `${id}: ${kinds.join(',')}`).toBeLessThanOrEqual(1)
    if (terminals.length === 1) expect(kinds.at(-1), id).toBe(terminals[0])
    const openers = kinds.filter((k) => k === 'start' || k === 'cached')
    expect(openers.length, id).toBeLessThanOrEqual(1)
    if (openers.length === 1) expect(kinds[0], id).toBe(openers[0])
    // a node opens only after every node it reads from is done
    const open = events.findIndex((e) => 'nodeId' in e && e.nodeId === id && (e.kind === 'start' || e.kind === 'cached'))
    if (open >= 0) {
      for (const dep of plan.nodes.get(id)?.deps ?? []) {
        const depDone = events.findIndex((e) => 'nodeId' in e && e.nodeId === dep && e.kind === 'done')
        expect(depDone, `${dep} before ${id}`).toBeGreaterThanOrEqual(0)
        expect(depDone).toBeLessThan(open)
      }
    }
    // progress within one attempt never goes back
    let last = 0
    for (const e of events) {
      if (!('nodeId' in e) || e.nodeId !== id) continue
      if (e.kind === 'retry') last = 0
      if (e.kind === 'progress') {
        expect(e.frac).toBeGreaterThanOrEqual(last)
        expect(e.frac).toBeLessThanOrEqual(1)
        last = e.frac
      }
    }
  }
}

describe('scheduler: a whole run', () => {
  it('runs every fake node, places auto nodes by budget mode, and its events arrive in order', async () => {
    const { start, plan, h, store } = setup()
    const run = start()
    const res = await finish(run)
    expect(res.status).toBe('done')
    expect(Object.values(res.states).every((s) => s === 'done')).toBe(true)
    expect(h.calls.sort()).toEqual([...plan.order.map((id) => plan.nodes.get(id)?.def.type)].sort())
    expect(store.fingerprints()).toHaveLength(8)
    expectOrdered(run.events.history(), plan)
    expect(kindsOf(run.events.history(), 'package')).toEqual(['start', 'progress', 'artefact', 'gate', 'done'])
    expect(kindsOf(run.events.history(), 'voice')).toEqual(['start', 'progress', 'artefact', 'artefact', 'done'])
    expect(run.progress()).toBe(1)
  })

  it('a required input missing blocks the launch; a suggested one does not', () => {
    const { start } = setup()
    expect(() => start({ inputs: {} })).toThrow(EngineError)
    expect(() => start({ inputs: { topic: { value: 'x' } } })).not.toThrow() // camera (suggested) left empty
  })

  it('the same run again is entirely reused: 0 node runs, and an approved gate is not asked twice', async () => {
    const { start, h } = setup()
    await finish(start())
    h.calls.length = 0
    const again = start()
    const res = await again.done // no approval needed: the package was approved with this fingerprint
    expect(res.status).toBe('done')
    expect(h.calls).toEqual([])
    expect(Object.values(res.states).every((s) => s === 'cached')).toBe(true)
    expect(kindsOf(again.events.history(), 'research')).toEqual(['cached', 'done'])
  })

  it('a changed setting redoes only what depends on it', async () => {
    const { start, h } = setup()
    await finish(start())
    h.calls.length = 0
    const run = start({ style: { voice: 'paul' } }) // the voice comes from the channel style
    const res = await finish(run)
    expect(res.status).toBe('done')
    expect(h.calls.sort()).toEqual(['beats.split@1', 'package.youtube@1', 'render.assemble@1', 'visuals.fulfil@1', 'voice.tts@1'])
    expect(res.states).toMatchObject({ research: 'cached', script: 'cached', thumbs: 'cached', voice: 'done', render: 'done' })
  })

  it('a budget mode overlay changes only the nodes it touches', async () => {
    const { start, h } = setup()
    await finish(start())
    h.calls.length = 0
    await finish(start({ budgetMode: 'qualite_max' })) // visuals: videoShare 0 -> 0.4; render: auto placement only
    // render placement is not part of its fingerprint (H2), but its visuals input changed
    expect(h.calls.sort()).toEqual(['package.youtube@1', 'render.assemble@1', 'visuals.fulfil@1'])
  })

  it('a new seed regenerates that node and its dependents only', async () => {
    const { start, h } = setup()
    await finish(start())
    h.calls.length = 0
    await finish(start({ seeds: { script: 1 } }))
    expect(h.calls).not.toContain('research.topic@1')
    expect(h.calls).not.toContain('thumbnail.make@1')
    expect(h.calls).toContain('script.write@1')
    expect(h.calls).toContain('render.assemble@1')
  })
})

describe('scheduler: limits and order', () => {
  const fan = (n: number) =>
    videoPipeline({
      nodes: Array.from({ length: n }, (_, i) => ({ id: `r${n - i}`, type: 'research.topic@1', in: { topic: '$inputs.topic' } }))
    })

  it('runs independent nodes in parallel within the Claude limit (default 2)', async () => {
    const { h, start } = setup(fan(5))
    let running = 0
    let max = 0
    const gate = deferred()
    const full = deferred()
    h.behave.set('research.topic@1', async () => {
      running++
      max = Math.max(max, running)
      if (running === 2) full.resolve()
      await gate.promise
      running--
      return { brief: { value: 'b' } }
    })
    const run = start({ seeds: { r1: 1, r2: 2, r3: 3, r4: 4, r5: 5 } })
    await full.promise // two nodes are running (waits on the nodes, not on a timer)
    await settleTicks() // a third one able to start would have started by now
    expect(running).toBe(2)
    expect(run.events.history().filter((e) => e.kind === 'start')).toHaveLength(2)
    gate.resolve()
    expect((await run.done).status).toBe('done')
    expect(max).toBe(2)
  })

  it('a waiting node gets the next free slot in declaration order, and limits are configurable', async () => {
    const { start } = setup(fan(4))
    const run = start({ limits: { claude: 1 }, seeds: { r1: 1, r2: 2, r3: 3, r4: 4 } })
    await run.done
    const starts = run.events.history().filter((e) => e.kind === 'start').map((e) => ('nodeId' in e ? e.nodeId : ''))
    expect(starts).toEqual(['r4', 'r3', 'r2', 'r1']) // declared r4, r3, r2, r1
  })
})

describe('scheduler: cancel', () => {
  it('a cancel in the middle of a render stops it, keeps finished results, and a new run resumes from them', async () => {
    const { h, start, store, plan } = setup()
    let sawAbort = false
    h.behave.set('render.assemble@1', (ctx) => {
      ctx.emit({ kind: 'progress', frac: 0.3, text: 'segment 3 sur 10' })
      return new Promise((_, reject) => {
        ctx.signal.addEventListener('abort', () => {
          sawAbort = true
          reject(new DOMException('stopped', 'AbortError'))
        })
      })
    })
    const run = start()
    await waitForEvent(() => run.events.history(), (l) => run.events.on(l), (e) => e.kind === 'progress' && e.nodeId === 'render')
    run.cancel()
    const res = await run.done
    expect(sawAbort).toBe(true)
    expect(res.status).toBe('cancelled')
    expect(res.states).toMatchObject({ render: 'cancelled', package: 'cancelled', voice: 'done', visuals: 'done' })
    expect(kindsOf(run.events.history(), 'render')).toEqual(['start', 'progress', 'cancelled'])
    expect(kindsOf(run.events.history(), 'package')).toEqual(['cancelled'])
    expectOrdered(run.events.history(), plan)
    expect(store.fingerprints()).toHaveLength(6) // everything but render and package

    h.behave.delete('render.assemble@1')
    h.calls.length = 0
    const again = start()
    expect((await finish(again)).status).toBe('done')
    expect(h.calls.sort()).toEqual(['package.youtube@1', 'render.assemble@1'])
  })

  it('a node that ignores its signal is not waited for beyond the grace period', async () => {
    const { h, start } = setup()
    h.behave.set('render.assemble@1', () => new Promise(() => undefined))
    const run = start({ cancelGraceMs: 5_000 })
    await waitForEvent(() => run.events.history(), (l) => run.events.on(l), (e) => e.kind === 'start' && e.nodeId === 'render')
    run.cancel()
    expect((await run.done).states.render).toBe('cancelled')
  })

  it('a late report from a cancelled node is dropped', async () => {
    const { h, start } = setup()
    let ctxRef: Parameters<Parameters<typeof h.behave.set>[1]>[0] | undefined
    h.behave.set('render.assemble@1', (ctx) => {
      ctxRef = ctx
      return new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    })
    const run = start()
    await waitForEvent(() => run.events.history(), (l) => run.events.on(l), (e) => e.kind === 'start' && e.nodeId === 'render')
    run.cancel()
    await run.done
    const n = run.events.history().length
    ctxRef?.emit({ kind: 'progress', frac: 0.9 })
    ctxRef?.emit({ kind: 'log', level: 'info', text: 'late' })
    expect(run.events.history()).toHaveLength(n)
  })
})

describe('scheduler: failures and retries', () => {
  function spender() {
    const log: string[] = []
    const keys: string[] = []
    return {
      log,
      keys,
      reserve: (req: { nodeId: string; idempotencyKey: string }): Promise<Reservation> => {
        log.push(`reserve ${req.nodeId}`)
        keys.push(req.idempotencyKey)
        return Promise.resolve({
          settle: (cost) => {
            log.push(`settle ${req.nodeId} ${JSON.stringify(cost?.units ?? null)}`)
            return Promise.resolve()
          },
          release: () => {
            log.push(`release ${req.nodeId}`)
            return Promise.resolve()
          }
        })
      }
    }
  }

  it('a transient error is retried 3 times with a growing wait, on the same reservation, then the node errors', async () => {
    const { h, start, clock } = setup()
    h.behave.set('voice.tts@1', () => Promise.reject(new EngineError('transient', 'provider overloaded')))
    const wallet = spender()
    const run = start({ spender: wallet })
    const res = await run.done
    expect(h.calls.filter((c) => c === 'voice.tts@1')).toHaveLength(4) // 1 + 3 retries
    const retries = run.events.history().filter((e) => e.kind === 'retry')
    expect(retries.map((e) => (e.kind === 'retry' ? [e.attempt, e.delayMs] : []))).toEqual([
      [2, 2_000],
      [3, 8_000],
      [4, 30_000]
    ])
    expect(clock.sleeps).toEqual([2_000, 8_000, 30_000])
    const err = run.events.history().find((e) => e.kind === 'error')
    // retries exhausted: the node stops for good, so the error is permanent (R10.2)
    expect(err).toMatchObject({ nodeId: 'voice', code: 'transient', permanent: true })
    expect(err && 'message' in err ? err.message : '').toMatch(/gave up after 3 retries/)
    expect(kindsOf(run.events.history(), 'voice')).toEqual(['start', 'retry', 'retry', 'retry', 'error'])
    // the failure costs nothing: one reservation, released
    expect(wallet.log.filter((l) => l.endsWith(' voice'))).toEqual(['reserve voice', 'release voice'])
    // dependents stay pending; the independent branch went on
    expect(res.status).toBe('error')
    expect(res.states).toMatchObject({ voice: 'error', beats: 'pending', render: 'pending', package: 'pending', thumbs: 'done' })
  })

  it('jitter spreads the waits around the base values, never below 80 % nor above 120 %', async () => {
    const { h, start, clock } = setup()
    h.behave.set('voice.tts@1', () => Promise.reject(new EngineError('transient', 'x')))
    await start({ random: () => 0 }).done
    expect(clock.sleeps).toEqual([1_600, 6_400, 24_000])
  })

  it('a transient error then a success: done, settled once at the reported cost', async () => {
    const { h, start } = setup()
    let n = 0
    h.behave.set('voice.tts@1', (ctx) => {
      n++
      if (n <= 2) return Promise.reject(new EngineError('transient', 'network'))
      ctx.reportCost({ units: [{ unit: 'chars', qty: 1100 }] })
      return Promise.resolve({ audio: { files: ['v.wav'] }, words: { value: [] } })
    })
    const wallet = spender()
    const run = start({ spender: wallet })
    expect((await finish(run)).status).toBe('done')
    expect(wallet.log.filter((l) => l.split(' ')[1] === 'voice')).toEqual(['reserve voice', 'settle voice [{"unit":"chars","qty":1100}]'])
    // paid = cloud or gpu: voice, visuals and thumbs run on the Cloud by default; the render is local (auto, usage_max)
    expect(wallet.log.filter((l) => l.startsWith('reserve')).sort()).toEqual(['reserve thumbs', 'reserve visuals', 'reserve voice'])
    expect(wallet.log.some((l) => l.startsWith('release'))).toBe(false)
    expect(run.events.history().find((e) => e.kind === 'done' && e.nodeId === 'voice')).toMatchObject({ cost: { units: [{ unit: 'chars', qty: 1100 }] } })
    expect(new Set(wallet.keys).size).toBe(wallet.keys.length) // one idempotency key per paid node run
  })

  it('a permanent error is not retried; a node breaking its output contract is an error too', async () => {
    const { h, start } = setup()
    h.behave.set('voice.tts@1', () => Promise.reject(new EngineError('refused', 'content refused')))
    h.behave.set('thumbnail.make@1', () => Promise.resolve({ images: { value: 'not a list' } }))
    const run = start()
    const res = await run.done
    expect(h.calls.filter((c) => c === 'voice.tts@1')).toHaveLength(1)
    expect(res.states).toMatchObject({ voice: 'error', thumbs: 'error' })
    const errs = run.events.history().flatMap((e) => (e.kind === 'error' ? [`${e.nodeId}:${e.code}:${e.permanent}`] : []))
    expect(errs.sort()).toEqual(['thumbs:bad_output:true', 'voice:refused:true'])
  })

  it('an undeclared or missing output, or anything thrown, is a permanent error', async () => {
    const { h, start } = setup()
    h.behave.set('script.write@1', () => Promise.resolve({ text: { value: 's' }, extra: { value: 1 } }))
    h.behave.set('thumbnail.make@1', () => Promise.reject(new TypeError('boom')))
    const run = start()
    const res = await run.done
    expect(res.states).toMatchObject({ script: 'error', thumbs: 'error' })
    const codes = run.events.history().flatMap((e) => (e.kind === 'error' ? [`${e.nodeId}:${e.code}`] : []))
    expect(codes.sort()).toEqual(['script:bad_output', 'thumbs:internal'])
  })

  it('a reservation refused by the cap is an error before the node starts', async () => {
    const { start } = setup()
    const run = start({
      spender: { reserve: () => Promise.reject(new EngineError('budget', 'cap reached')) }
    })
    await run.done
    expect(kindsOf(run.events.history(), 'voice')).toEqual(['error'])
    expect(run.events.history().find((e) => e.kind === 'error' && e.nodeId === 'voice')).toMatchObject({ code: 'budget' })
  })

  it('state is kept behind the NodeStateStore: a restart reuses the finished nodes', async () => {
    const { h, start, state } = setup()
    h.behave.set('render.assemble@1', (ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('x')))))
    const first = start({ runId: 'run-1' })
    await waitForEvent(() => first.events.history(), (l) => first.events.on(l), (e) => e.kind === 'start' && e.nodeId === 'render')
    first.cancel()
    await first.done
    expect(state.get('run-1', 'voice')).toMatchObject({ state: 'done', attempts: 1 })
    expect(state.get('run-1', 'render')?.state).toBe('cancelled')
    h.behave.delete('render.assemble@1')
    const second = start({ runId: 'run-2' })
    await finish(second)
    expect(state.list('run-2').filter((r) => r.state === 'cached').map((r) => r.nodeId).sort()).toEqual(
      ['beats', 'research', 'script', 'thumbs', 'visuals', 'voice']
    )
  })
})
