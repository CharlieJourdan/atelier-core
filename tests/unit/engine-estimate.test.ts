// Cost estimates and quotes (ENGINE-SPEC §9), auto placement (R6.3), and the events' order rules (§8).
import { describe, expect, it } from 'vitest'
import {
  MemoryArtefactStore,
  QUOTE_TTL_MS,
  RunEvents,
  backoffMs,
  DEFAULT_RETRY,
  estimatePipeline,
  expectedDurationS,
  globalProgress,
  isQuoteValid,
  quotePipeline,
  seededRandom,
  startRun,
  validatePipeline,
  type QuoteRequestItem,
  type Quoter
} from '../../src/engine'
import { fakeClock, harness, videoPipeline } from './engine-fakes'

function plan() {
  const h = harness()
  const r = validatePipeline(videoPipeline(), h.registry)
  if (!r.ok) throw new Error('invalid')
  return { h, plan: r.plan }
}

/** A fake price grid: 1 credit per 100 chars, 2 per image, 1 per 10 GPU seconds. */
const fakeQuoter = (seen: QuoteRequestItem[][] = []): Quoter => ({
  quote: (items) => {
    seen.push(items)
    const rate = { chars: 0.01, images: 2, gpu_s: 0.1, video_s: 1, avatar_s: 1, searches: 1, watch_min: 1, calls: 1, tokens: 0 }
    return Promise.resolve({
      quoteId: 'q-1',
      lines: items.map((i) => ({ nodeId: i.nodeId, credits: i.units.reduce((s, u) => s + u.qty * rate[u.unit], 0) }))
    })
  }
})

describe('estimates', () => {
  it('estimates each node in provider units, with auto placement by budget mode', async () => {
    const { plan: p } = plan()
    const usage = await estimatePipeline(p, { budgetMode: 'usage_max' })
    const byId = Object.fromEntries(usage.nodes.map((n) => [n.nodeId, n]))
    expect(byId.render?.where).toBe('local') // usage_max prefers the free executor
    expect(byId.voice).toMatchObject({ where: 'cloud', paid: true, estimate: { units: [{ unit: 'chars', qty: 1200 }] } })
    expect(byId.script).toMatchObject({ where: 'local', paid: false })
    expect(byId.visuals?.estimate.units).toEqual([{ unit: 'images', qty: 10 }]) // videoShare 0 in usage_max
    const quality = await estimatePipeline(p, { budgetMode: 'qualite_max' })
    const q = Object.fromEntries(quality.nodes.map((n) => [n.nodeId, n]))
    expect(q.render?.where).toBe('gpu') // faster on a GPU (90 s against 300 s)
    expect(q.visuals?.estimate.units).toEqual([{ unit: 'images', qty: 18 }]) // videoShare 0.4
    // the same estimate twice (pure, R2.4)
    expect(await estimatePipeline(p, { budgetMode: 'qualite_max' })).toEqual(quality)
  })

  it('quotes paid nodes through the injected quoter, free nodes at 0, valid 15 minutes', async () => {
    const { plan: p } = plan()
    const clock = fakeClock()
    const seen: QuoteRequestItem[][] = []
    const quote = await quotePipeline(await estimatePipeline(p, { budgetMode: 'qualite_max' }), fakeQuoter(seen), clock)
    expect(seen[0]?.map((i) => i.nodeId).sort()).toEqual(['render', 'thumbs', 'visuals', 'voice'])
    expect(Object.fromEntries(quote.lines.map((l) => [l.nodeId, l.credits]))).toMatchObject({
      voice: 12,
      visuals: 36,
      render: 9,
      thumbs: 0,
      script: 0,
      package: 0
    })
    expect(quote.totalCredits).toBe(57)
    expect(quote.expiresAt - quote.createdAt).toBe(QUOTE_TTL_MS)
    expect(isQuoteValid(quote, clock.now() + QUOTE_TTL_MS - 1)).toBe(true)
    expect(isQuoteValid(quote, clock.now() + QUOTE_TTL_MS)).toBe(false)
    // a quoter that forgets a paid line is an error, never a silent 0
    const forgetful: Quoter = { quote: () => Promise.resolve({ lines: [] }) }
    await expect(quotePipeline(await estimatePipeline(p), forgetful, clock)).rejects.toThrow(/no valid price/)
  })

  it('cached nodes are quoted at 0 and not sent to the quoter', async () => {
    const { plan: p } = plan()
    const store = new MemoryArtefactStore()
    const opts = { inputs: { topic: { value: 'Les pyramides' } }, style: { voice: 'clara' } }
    const run = startRun({ plan: p, store, ...opts, useFakes: true, clock: fakeClock(), gateMode: 'all' })
    await run.idle()
    run.approve('package')
    await run.done
    // the video was made with the fakes (demo): its quote is asked as a demo too (lot P4: demo and real never share results)
    const est = await estimatePipeline(p, { ...opts, store, useFakes: true })
    expect(est.nodes.every((n) => n.cached && !n.paid)).toBe(true)
    const real = await estimatePipeline(p, { ...opts, store })
    expect(real.nodes.some((n) => n.cached)).toBe(false)
    expect(est.durationS).toBe(0)
    const seen: QuoteRequestItem[][] = []
    expect((await quotePipeline(est, fakeQuoter(seen), fakeClock())).totalCredits).toBe(0)
    expect(seen).toEqual([])
    // a different voice: the voice and what follows are no longer cached
    const changed = await estimatePipeline(p, { ...opts, style: { voice: 'paul' }, store, useFakes: true })
    expect(changed.nodes.filter((n) => !n.cached).map((n) => n.nodeId)).toEqual(['voice', 'beats', 'visuals', 'render', 'package'])
  })

  it('#115: paid work a node’s item cache still holds is quoted at 0 (only what goes beyond it is billed); no ledger, the whole bill', async () => {
    const { plan: p } = plan()
    const visuals = p.nodes.get('visuals')
    if (!visuals) throw new Error('no visuals node')
    ;(visuals.def as { reuse?: unknown }).reuse = { kind: 'visuals-test', key: () => 'same-voice' }
    const asked: string[] = []
    const reused = (kind: string, key: string): Promise<Record<string, number> | null> => {
      asked.push(`${kind}/${key}`)
      return Promise.resolve(key === 'same-voice' ? { images: 4 } : null)
    }
    const whole = await estimatePipeline(p, { budgetMode: 'usage_max' })
    expect(whole.nodes.find((n) => n.nodeId === 'visuals')?.estimate.units).toEqual([{ unit: 'images', qty: 10 }])
    const less = await estimatePipeline(p, { budgetMode: 'usage_max', reused })
    expect(less.nodes.find((n) => n.nodeId === 'visuals')?.estimate.units).toEqual([{ unit: 'images', qty: 6 }])
    expect(asked).toEqual(['visuals-test/same-voice'])
    // more reusable than asked: never negative
    const all = await estimatePipeline(p, { budgetMode: 'usage_max', reused: () => Promise.resolve({ images: 99 }) })
    expect(all.nodes.find((n) => n.nodeId === 'visuals')?.estimate.units).toEqual([{ unit: 'images', qty: 0 }])
  })
})

describe('events', () => {
  it('enforces the order of one node: opener first, one terminal, nothing after', () => {
    const ev = new RunEvents('r')
    expect(ev.emit({ kind: 'progress', nodeId: 'a', frac: 0.1 })).toBeNull() // before start: dropped
    expect(() => ev.emit({ kind: 'retry', nodeId: 'a', attempt: 2, delayMs: 1, code: 'transient' })).toThrow(/before it started/)
    ev.emit({ kind: 'start', nodeId: 'a', at: 0 })
    expect(() => ev.emit({ kind: 'cached', nodeId: 'a', fingerprint: 'x' })).toThrow(/opened twice/)
    expect(ev.emit({ kind: 'progress', nodeId: 'a', frac: 0.6 })).toMatchObject({ frac: 0.6 })
    expect(ev.emit({ kind: 'progress', nodeId: 'a', frac: 0.4 })).toMatchObject({ frac: 0.6 }) // never back
    expect(ev.emit({ kind: 'progress', nodeId: 'a', frac: 7 })).toMatchObject({ frac: 1 }) // clamped
    ev.emit({ kind: 'retry', nodeId: 'a', attempt: 2, delayMs: 1, code: 'transient' })
    expect(ev.emit({ kind: 'progress', nodeId: 'a', frac: 0.2 })).toMatchObject({ frac: 0.2 }) // a new attempt
    ev.emit({ kind: 'done', nodeId: 'a', fingerprint: 'f' })
    expect(ev.emit({ kind: 'log', nodeId: 'a', level: 'info', text: 'late' })).toBeNull()
    expect(() => ev.emit({ kind: 'error', nodeId: 'a', permanent: true, message: 'm', code: 'internal' })).toThrow(/out of order/)
    // a node may end before it starts (cancelled while pending)
    ev.emit({ kind: 'cancelled', nodeId: 'b' })
    expect(ev.history().map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('a failing listener never breaks the run', () => {
    const ev = new RunEvents('r')
    const seen: string[] = []
    ev.on(() => {
      throw new Error('listener bug')
    })
    ev.on((e) => seen.push(e.kind))
    ev.emit({ kind: 'start', nodeId: 'a', at: 0 })
    expect(seen).toEqual(['start'])
  })

  it('global progress weighs nodes by expected duration; history sharpens the weight', () => {
    expect(globalProgress([{ weightS: 300, frac: 0.5, finished: false }, { weightS: 100, frac: 0, finished: true }])).toBe(250 / 400)
    expect(globalProgress([])).toBe(1)
    expect(globalProgress([{ weightS: 0, frac: 0, finished: true }, { weightS: 0, frac: 0, finished: false }])).toBe(0.5)
    expect(expectedDurationS([], 40)).toBe(40)
    expect(expectedDurationS([10, 20, NaN, 30], 40)).toBe(20)
  })
})

describe('retry waits', () => {
  it('grow 2 s, 8 s, 30 s then stay at 30 s, jittered by at most 20 %, reproducible from a seed', () => {
    const mid = () => 0.5
    expect([1, 2, 3, 4].map((n) => backoffMs(DEFAULT_RETRY, n, mid))).toEqual([2_000, 8_000, 30_000, 30_000])
    const rnd = seededRandom(42)
    for (let i = 0; i < 1000; i++) {
      const d = backoffMs(DEFAULT_RETRY, 2, rnd)
      expect(d).toBeGreaterThanOrEqual(6_400)
      expect(d).toBeLessThanOrEqual(9_600)
    }
    const a = seededRandom(7)
    const b = seededRandom(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})
