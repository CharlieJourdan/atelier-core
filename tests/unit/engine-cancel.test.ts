// Cancel and money paths of the scheduler that need time to stand still (ENGINE-SPEC R9.3, R10.1–R10.4): a cancel
// while waiting for a slot, during a retry wait, while results are being stored; the grace wait; settlement failures.
import { describe, expect, it } from 'vitest'
import {
  EngineError,
  MemoryArtefactStore,
  MemoryNodeStateStore,
  startRun,
  validatePipeline,
  type ArtefactStore,
  type Reservation,
  type Run,
  type StartRunOptions,
  type StoredRun
} from '../../src/engine'
import { fakeClock, harness, kindsOf, manualClock, settleTicks, videoPipeline, waitForEvent } from './engine-fakes'

function setup(doc: unknown = videoPipeline()) {
  const h = harness()
  const r = validatePipeline(doc, h.registry)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  const start = (over: Partial<StartRunOptions> = {}): Run =>
    startRun({
      plan: r.plan,
      store: new MemoryArtefactStore(),
      inputs: { topic: { value: 'Les pyramides' } },
      style: { voice: 'clara' },
      useFakes: true,
      clock: fakeClock(),
      random: () => 0.5,
      ...over
    })
  return { h, start }
}

const on = (run: Run) => [() => run.events.history(), (l: Parameters<Run['events']['on']>[0]) => run.events.on(l)] as const

function wallet(settle: (n: number) => Promise<void> = () => Promise.resolve()) {
  const log: string[] = []
  let settles = 0
  return {
    log,
    reserve: (req: { nodeId: string }): Promise<Reservation> => {
      log.push(`reserve ${req.nodeId}`)
      return Promise.resolve({
        settle: () => {
          log.push(`settle ${req.nodeId}`)
          return settle(++settles)
        },
        release: () => {
          log.push(`release ${req.nodeId}`)
          return Promise.resolve()
        }
      })
    }
  }
}

describe('cancel', () => {
  it('while a node waits for a concurrency slot', async () => {
    const fan = videoPipeline({
      nodes: [
        { id: 'a', type: 'research.topic@1', in: { topic: '$inputs.topic' } },
        { id: 'b', type: 'research.topic@1', in: { topic: '$inputs.topic' } }
      ]
    })
    const { h, start } = setup(fan)
    h.behave.set('research.topic@1', (ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('stop')))))
    const run = start({ limits: { claude: 1 }, seeds: { b: 1 } })
    await waitForEvent(...on(run), (e) => e.kind === 'start')
    expect([run.state('a'), run.state('b')].sort()).toEqual(['queued', 'running'])
    run.cancel()
    const res = await run.done
    expect(res.states).toEqual({ a: 'cancelled', b: 'cancelled' })
    expect(h.calls).toHaveLength(1) // the waiting node never ran
  })

  it('during a retry wait: stops at once, the reservation is released, and the slot was free meanwhile', async () => {
    const { h, start } = setup()
    const clock = manualClock()
    h.behave.set('voice.tts@1', () => Promise.reject(new EngineError('transient', 'overloaded')))
    const w = wallet()
    const run = start({ clock, spender: w, limits: { cloud: 1 } })
    await waitForEvent(...on(run), (e) => e.kind === 'retry')
    await waitForEvent(...on(run), (e) => e.kind === 'done' && e.nodeId === 'thumbs')
    expect(clock.pending()).toBeGreaterThan(0) // the voice waits 2 s to retry
    // with one Cloud slot, the thumbnails (Cloud too) ran during the voice's wait
    expect(run.state('thumbs')).toBe('done')
    run.cancel()
    const res = await run.done
    expect(res.states.voice).toBe('cancelled')
    expect(w.log.filter((l) => l.endsWith(' voice'))).toEqual(['reserve voice', 'release voice'])
  })

  it('while a gated node is storing its result: the run ends (no hang) and the finished result stays stored', async () => {
    const doc = videoPipeline() as { nodes: Record<string, unknown>[] }
    doc.nodes[1] = { ...doc.nodes[1], gate: 'review' }
    const { start } = setup(doc)
    const inner = new MemoryArtefactStore()
    let release!: () => void
    const slow: ArtefactStore = {
      getRun: (fp) => inner.getRun(fp),
      read: (fp) => inner.read(fp),
      putRun: async (run: StoredRun) => {
        if (run.outputs.text) await new Promise<void>((r) => (release = r)) // the script's write is slow
        return inner.putRun(run)
      }
    }
    const run = start({ store: slow })
    await waitForEvent(...on(run), (e) => e.kind === 'progress' && e.nodeId === 'script')
    await settleTicks()
    run.cancel()
    release()
    const res = await run.done
    expect(res.status).toBe('cancelled')
    expect(res.states.script).toBe('cancelled')
    // the script's finished result was stored, beside research and the independent thumbnails
    const runs = await Promise.all(inner.fingerprints().map((fp) => inner.getRun(fp)))
    expect(runs.map((r) => Object.keys(r?.outputs ?? {})[0]).sort()).toEqual(['brief', 'images', 'text'])
  })

  it('a node ignoring its signal is waited for exactly the grace period', async () => {
    const { h, start } = setup()
    const clock = manualClock()
    h.behave.set('research.topic@1', () => new Promise(() => undefined))
    const run = start({ clock, cancelGraceMs: 5_000 })
    await waitForEvent(...on(run), (e) => e.kind === 'start')
    run.cancel()
    let over = false
    void run.done.then(() => (over = true))
    await clock.advance(4_999)
    expect(over).toBe(false)
    await clock.advance(1)
    await settleTicks()
    expect(over).toBe(true)
    expect(run.state('research')).toBe('cancelled')
  })
})

describe('money', () => {
  it('a failed settlement is retried alone: the paid node never runs twice', async () => {
    const { h, start } = setup()
    const w = wallet((n) => (n === 1 ? Promise.reject(new EngineError('transient', 'cloud busy')) : Promise.resolve()))
    const run = start({ spender: w, gateMode: 'all' })
    await run.idle()
    run.approve('package')
    expect((await run.done).status).toBe('done')
    expect(h.calls.filter((c) => c === 'thumbnail.make@1' || c === 'voice.tts@1' || c === 'visuals.fulfil@1')).toHaveLength(3)
    expect(w.log.filter((l) => l.startsWith('settle'))).toHaveLength(4) // 3 paid nodes, one settlement retried
  })

  it('a settlement that keeps failing leaves the result done, with a warning to reconcile', async () => {
    const { start } = setup()
    const w = wallet(() => Promise.reject(new EngineError('refused', 'no')))
    const run = start({ spender: w, gateMode: 'all' })
    await run.idle()
    run.approve('package')
    expect((await run.done).status).toBe('done')
    const warns = run.events.history().filter((e) => e.kind === 'log' && e.level === 'warn')
    expect(warns).toHaveLength(3)
  })

  it('a paid node with no wallet is refused before it starts (fail closed), except with fake nodes', async () => {
    const { start } = setup()
    const run = start({ useFakes: false })
    await run.done
    expect(kindsOf(run.events.history(), 'thumbs')).toEqual(['error'])
    expect(run.events.history().find((e) => e.kind === 'error' && e.nodeId === 'thumbs')).toMatchObject({ code: 'budget' })
  })
})

describe('gates and the cache', () => {
  it('a reused result asked at a gate stays cached after approval', async () => {
    const doc = videoPipeline() as { nodes: Record<string, unknown>[] }
    doc.nodes[1] = { ...doc.nodes[1], gate: 'review' }
    const { start } = setup(doc)
    const store = new MemoryArtefactStore()
    const state = new MemoryNodeStateStore()
    const first = start({ store, state, scope: 'v', gateMode: 'all' }) // review gates skipped
    await first.idle()
    first.approve('package')
    await first.done
    const second = start({ store, state, scope: 'v' }) // step by step: the script is now asked
    await second.idle()
    expect(second.state('script')).toBe('waiting_gate')
    second.approve('script')
    await second.done
    expect(second.state('script')).toBe('cached')
  })
})
