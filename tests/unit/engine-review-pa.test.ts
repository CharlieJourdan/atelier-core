// Lot PAF: fixes of the phase PA review (archived note REVIEW-v2-PA (old repository)) in the engine core. Finding 1: the run-wide settings a
// node reads (target minutes, budget mode) are in its fingerprint. Finding 2: a pipeline input's meta is fingerprinted.
// Finding 10: every concurrency pool keeps its limit and the pools are independent. Finding 11: `change_requested`
// is a registered code. Fake nodes, fake clock; waits are on engine events, never on timers.
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import {
  ERROR_CODES,
  MemoryArtefactStore,
  MemoryNodeStateStore,
  NodeRegistry,
  RegistryError,
  defineNode,
  contentFingerprint,
  createRunCtx,
  estimatePipeline,
  inputFingerprint,
  startRun,
  validatePipeline,
  type AnyNodeDef,
  type EngineEvent,
  type ResolvedPipeline,
  type Run,
  type StartRunOptions
} from '../../src/engine'
import { fakeClock, harness, settleTicks, videoPipeline } from './engine-fakes'

function setup(over: Parameters<typeof harness>[0] = {}) {
  const h = harness(over)
  const r = validatePipeline(videoPipeline(), h.registry)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  const store = new MemoryArtefactStore()
  const state = new MemoryNodeStateStore()
  const start = (o: Partial<StartRunOptions> = {}): Run =>
    startRun({
      plan: r.plan,
      store,
      state,
      scope: 'video-1',
      inputs: { topic: { value: 'Les pyramides' } },
      style: { voice: 'clara' },
      useFakes: true,
      clock: fakeClock(),
      random: () => 0.5,
      ...o
    })
  return { h, start, plan: r.plan, store, state }
}

async function finish(run: Run): Promise<Awaited<Run['done']>> {
  await run.idle()
  if (run.state('package') === 'waiting_gate') run.approve('package')
  return run.done
}

describe('finding 1: run-wide settings a node reads are in its fingerprint', () => {
  it('changing minutes reruns the node that reads it and its dependents only', async () => {
    const { h, start } = setup({ 'script.write@1': { reads: ['minutes'] } })
    const lengths: number[] = []
    h.behave.set('script.write@1', (ctx) => {
      lengths.push(ctx.minutes)
      return Promise.resolve({ text: { value: `un script de ${ctx.minutes} minutes` } })
    })
    await finish(start({ minutes: 10 }))
    h.calls.length = 0
    const res = await finish(start({ minutes: 12 }))
    expect(res.status).toBe('done')
    expect(lengths).toEqual([10, 12])
    expect(h.calls.sort()).toEqual(['beats.split@1', 'package.youtube@1', 'render.assemble@1', 'script.write@1', 'visuals.fulfil@1', 'voice.tts@1'])
    expect(res.states).toMatchObject({ research: 'cached', thumbs: 'cached', script: 'done' })
  })

  it('without a node reading it, changing minutes reruns nothing', async () => {
    const { h, start } = setup()
    await finish(start({ minutes: 10 }))
    h.calls.length = 0
    await start({ minutes: 12 }).done
    expect(h.calls).toEqual([])
  })

  it('a node declaring the budget mode reruns when only the mode changes', async () => {
    const { h, start } = setup({ 'thumbnail.make@1': { reads: ['budgetMode'] } })
    h.behave.set('thumbnail.make@1', (ctx) => Promise.resolve({ images: { files: [`thumb-${ctx.budgetMode}.png`] } }))
    await finish(start())
    h.calls.length = 0
    await finish(start({ budgetMode: 'qualite_max' }))
    // thumbs reads the mode; visuals has a mode overlay (and so render and package after it)
    expect(h.calls.sort()).toEqual(['package.youtube@1', 'render.assemble@1', 'thumbnail.make@1', 'visuals.fulfil@1'])
  })

  it('reading an undeclared setting fails the node (a stale result is never reused)', async () => {
    const { h, start } = setup()
    h.behave.set('research.topic@1', (ctx) => Promise.resolve({ brief: { value: `pour ${ctx.minutes} min` } }))
    const run = start()
    const res = await run.done
    expect(res.states.research).toBe('error')
    const err = run.events.history().find((e) => e.kind === 'error')
    expect(err).toMatchObject({ nodeId: 'research', code: 'internal', permanent: true })
    expect(err && 'message' in err ? err.message : '').toMatch(/ctx\.minutes.*reads/)
  })

  it('the registry refuses an unknown or repeated run setting', () => {
    const base = { type: 'x.y@1' as const, inputs: {}, outputs: { o: 'json.beats' as const }, params: z.object({}), executors: ['local' as const] }
    const node = (reads: unknown): AnyNodeDef =>
      defineNode({ ...base, reads: reads as never, estimate: () => ({ units: [], durationS: 1 }), run: () => Promise.resolve({ o: { value: 1 } }), fake: () => Promise.resolve({ o: { value: 1 } }) })
    expect(() => new NodeRegistry([node(['seed'])])).toThrow(RegistryError)
    expect(() => new NodeRegistry([node(['minutes', 'minutes'])])).toThrow(/twice/)
    expect(() => new NodeRegistry([node(['minutes', 'budgetMode'])])).not.toThrow()
  })
})

describe('finding 2: pipeline input meta is fingerprinted', () => {
  const camera = (durationS: number) => ({ files: ['plan.mp4'], fingerprint: 'c'.repeat(64), meta: { durationS } })

  it('the same bytes with a new meta rerun the nodes that read the input, and only them', async () => {
    const { h, start } = setup()
    await finish(start({ inputs: { topic: { value: 'Les pyramides' }, camera: camera(30) } }))
    h.calls.length = 0
    const res = await finish(start({ inputs: { topic: { value: 'Les pyramides' }, camera: camera(45) } }))
    expect(h.calls.sort()).toEqual(['package.youtube@1', 'render.assemble@1', 'visuals.fulfil@1'])
    expect(res.states).toMatchObject({ research: 'cached', script: 'cached', voice: 'cached', beats: 'cached', thumbs: 'cached' })
  })

  it('a text input with a new meta reruns its reader; without meta the fingerprint is the content hash', async () => {
    const { h, start } = setup()
    await finish(start({ inputs: { topic: { value: 'Les pyramides', meta: { lang: 'fr' } } } }))
    h.calls.length = 0
    await finish(start({ inputs: { topic: { value: 'Les pyramides', meta: { lang: 'en' } } } }))
    expect(h.calls).toContain('research.topic@1')
    const plain = { value: 'Les pyramides' }
    expect(inputFingerprint(plain)).toBe(inputFingerprint({ ...plain, meta: {} }))
    expect(inputFingerprint({ ...camera(30), meta: undefined })).toBe('c'.repeat(64))
    expect(inputFingerprint(camera(30))).not.toBe(inputFingerprint(camera(31)))
  })
})

describe('finding 10: each pool keeps its limit, and the pools are independent', () => {
  type Kind = 'claude' | 'render' | 'local'
  const def = (kind: Kind): AnyNodeDef =>
    defineNode({
      type: `job.${kind}@1`,
      inputs: {},
      outputs: { o: 'json.beats' },
      params: z.object({}).strict(),
      executors: ['local'],
      ...(kind === 'claude' ? { claudeRole: 'researcher' } : {}),
      ...(kind === 'render' ? { render: true } : {}),
      estimate: () => ({ units: [], durationS: 1 }),
      run: () => Promise.reject(new Error('fakes only')),
      fake: (ctx) => behaviour(kind, ctx.signal)
    })
  let behaviour: (kind: Kind, signal: AbortSignal) => Promise<{ o: { value: { kind: Kind } } }> = (kind) => Promise.resolve({ o: { value: { kind } } })

  function planWith(counts: Record<Kind, number>): ResolvedPipeline {
    const nodes = (Object.keys(counts) as Kind[]).flatMap((k) => Array.from({ length: counts[k] }, (_, i) => ({ id: `${k}${i}`, type: `job.${k}@1` })))
    const r = validatePipeline(videoPipeline({ inputs: [], nodes }), new NodeRegistry([def('claude'), def('render'), def('local')]))
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    return r.plan
  }

  /** Resolves once `n` nodes have started (an engine event, not a timer). */
  function startsReached(n: number): { listener: (e: EngineEvent) => void; reached: Promise<void> } {
    let seen = 0
    let resolve!: () => void
    const reached = new Promise<void>((r) => (resolve = r))
    return {
      reached,
      listener: (e) => {
        if (e.kind === 'start' && ++seen === n) resolve()
      }
    }
  }

  async function measure(counts: Record<Kind, number>, limits: StartRunOptions['limits'], expectStarted: number) {
    const running: Record<Kind, number> = { claude: 0, render: 0, local: 0 }
    const max: Record<Kind, number> = { claude: 0, render: 0, local: 0 }
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    behaviour = async (kind) => {
      running[kind]++
      max[kind] = Math.max(max[kind], running[kind])
      await gate
      running[kind]--
      return { o: { value: { kind } } }
    }
    const watch = startsReached(expectStarted)
    const plan = planWith(counts)
    // one seed per node: same-type nodes with the same seed would share one fingerprint (one stored run)
    const seeds = Object.fromEntries(plan.order.map((id, i) => [id, i + 1]))
    const run = startRun({ plan, store: new MemoryArtefactStore(), useFakes: true, clock: fakeClock(), limits, seeds, onEvent: watch.listener })
    await watch.reached
    await settleTicks() // anything else able to start has started by now
    const atOnce = { ...running }
    release()
    expect((await run.done).status).toBe('done')
    return { atOnce, max }
  }

  it('defaults: render 1, local 4, claude 2, all at the same time', async () => {
    const { atOnce, max } = await measure({ claude: 3, render: 3, local: 6 }, undefined, 2 + 1 + 4)
    expect(atOnce).toEqual({ claude: 2, render: 1, local: 4 })
    expect(max).toEqual({ claude: 2, render: 1, local: 4 })
  })

  it('a full render pool does not hold back local or Claude nodes', async () => {
    const { atOnce } = await measure({ claude: 1, render: 4, local: 2 }, { render: 1 }, 1 + 1 + 2)
    expect(atOnce).toEqual({ claude: 1, render: 1, local: 2 })
  })

  it('configured limits apply per pool', async () => {
    const { atOnce, max } = await measure({ claude: 2, render: 3, local: 5 }, { render: 2, local: 1, claude: 1 }, 1 + 2 + 1)
    expect(atOnce).toEqual({ claude: 1, render: 2, local: 1 })
    expect(max).toEqual({ claude: 1, render: 2, local: 1 })
  })
})

describe('finding 11: event codes are registered', () => {
  it('the change-request retry code is a known code', async () => {
    expect(ERROR_CODES).toContain('change_requested')
    const { start } = setup()
    const run = start()
    await run.idle()
    run.requestChange('package', 'plus court')
    await run.idle()
    const codes = run.events.history().flatMap((e) => (e.kind === 'retry' || e.kind === 'error' ? [e.code] : []))
    expect(codes).toContain('change_requested')
    for (const c of codes) expect(ERROR_CODES).toContain(c)
    run.approve('package')
    await run.done
  })
})

describe('review of lot PAF: the run context, estimates and input fingerprints', () => {
  const base = {
    emit: () => undefined,
    signal: new AbortController().signal,
    store: { read: () => Promise.resolve(null) },
    seed: 0,
    where: 'local' as const,
    attempt: 1,
    notes: [],
    reportCost: () => undefined,
    services: {}
  }

  it('createRunCtx: a declared setting reads, an undeclared one throws, spreading drops both', () => {
    const ctx = createRunCtx({ type: 'script.write@1', reads: ['minutes'] }, base, { minutes: 12, budgetMode: 'usage_max' })
    expect(ctx.minutes).toBe(12)
    expect(() => ctx.budgetMode).toThrow(/ctx\.budgetMode without declaring it/)
    expect(Object.keys({ ...ctx })).not.toContain('minutes')
    expect(Object.create(ctx).minutes).toBe(12) // the documented way to wrap a context
  })

  it('estimates see the same fingerprints: a minutes change or an input meta change is not cached', async () => {
    const { h, start, plan, store, state } = setup({ 'script.write@1': { reads: ['minutes'] } })
    h.behave.set('script.write@1', (ctx) => Promise.resolve({ text: { value: `${ctx.minutes} min` } }))
    const camera = (durationS: number) => ({ files: ['plan.mp4'], fingerprint: 'c'.repeat(64), meta: { durationS } })
    const inputs = { topic: { value: 'Les pyramides' }, camera: camera(30) }
    await finish(start({ minutes: 10, inputs }))
    const est = (o: { minutes: number; inputs: typeof inputs }) =>
      estimatePipeline(plan, { ...o, style: { voice: 'clara' }, store, gates: { state, scope: 'video-1' }, useFakes: true })
    const cachedOf = async (o: { minutes: number; inputs: typeof inputs }) =>
      Object.fromEntries((await est(o)).nodes.map((n) => [n.nodeId, n.cached]))
    expect(Object.values(await cachedOf({ minutes: 10, inputs })).every(Boolean)).toBe(true)
    expect(await cachedOf({ minutes: 12, inputs })).toMatchObject({ research: true, thumbs: true, script: false, voice: false })
    expect(await cachedOf({ minutes: 10, inputs: { ...inputs, camera: camera(45) } })).toMatchObject({ script: true, visuals: false, render: false })
  })

  it('an input with meta never shares a fingerprint with a value that looks like {content, meta}', () => {
    const withMeta = { value: 'x', meta: { lang: 'fr' } }
    const lookalike = { value: { content: contentFingerprint({ value: 'x' }), meta: { lang: 'fr' } } }
    expect(inputFingerprint(withMeta)).not.toBe(inputFingerprint(lookalike))
  })
})
