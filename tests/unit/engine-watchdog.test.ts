// The node watchdog (solidite): a node that hangs without a cancel is stopped (its signal aborts, so a worker kills its
// process tree), retried like a transient error, and fails `stalled` with its name once the retries are spent; a slow
// node that keeps showing signs of life is never stopped; a long node is bounded by its estimate. Real time, tiny limits.
import { describe, expect, it } from 'vitest'
import { AttemptWatch, MemoryArtefactStore, startRun, validatePipeline, type Run, type StartRunOptions } from '../../src/engine'
import { fakeClock, harness, sampleOutput, videoPipeline } from './engine-fakes'

const ONE = videoPipeline({ nodes: [{ id: 'a', type: 'research.topic@1', in: { topic: '$inputs.topic' } }] })
const FAST = { quietMs: 60, maxMs: 5_000, factor: 0, checkMs: 10 }

function setup() {
  const h = harness()
  const r = validatePipeline(ONE, h.registry)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  const start = (over: Partial<StartRunOptions> = {}): Run =>
    startRun({ plan: r.plan, store: new MemoryArtefactStore(), inputs: { topic: { value: 'Les pyramides' } }, useFakes: true, gateMode: 'all', clock: fakeClock(), random: () => 0.5, cancelGraceMs: 50, watch: FAST, retry: { retries: 2, delaysMs: [0] }, ...over })
  return { h, start }
}

const hang = (aborted: { n: number }) => (ctx: { signal: AbortSignal }) =>
  new Promise<never>(() => ctx.signal.addEventListener('abort', () => aborted.n++))

describe('node watchdog', () => {
  it('stops a node that hangs, retries it, then fails it « stalled » with its name', { timeout: 10_000 }, async () => {
    const { h, start } = setup()
    const aborted = { n: 0 }
    h.behave.set('research.topic@1', hang(aborted))
    const run = start()
    const res = await run.done
    expect(res.states.a).toBe('error')
    expect(h.calls).toHaveLength(3) // first try + 2 retries
    expect(aborted.n).toBe(3) // each hung attempt saw its signal abort
    const failed = run.events.history().find((e) => e.kind === 'error')
    expect(failed).toMatchObject({ code: 'stalled' })
    expect(JSON.stringify(failed)).toMatch(/research\.topic@1 \(a\).*aucun signe de vie/)
    expect(run.events.history().filter((e) => e.kind === 'retry').map((e) => (e as { code: string }).code)).toEqual(['stalled', 'stalled'])
  })

  it('a hang on the first attempt is retried and the run finishes', { timeout: 10_000 }, async () => {
    const { h, start } = setup()
    let tries = 0
    h.behave.set('research.topic@1', async () => {
      if (++tries === 1) return new Promise<never>(() => undefined) // ignores its signal too: the grace bounds it
      return { brief: sampleOutput('text.brief', 'ok') }
    })
    const res = await start().done
    expect(res.states.a).toBe('done')
    expect(tries).toBe(2)
  })

  it('never stops a slow node that keeps showing signs of life', { timeout: 10_000 }, async () => {
    const { h, start } = setup()
    h.behave.set('research.topic@1', async (ctx) => {
      for (let i = 0; i < 10; i++) {
        ctx.emit({ kind: 'progress', frac: i / 10, text: `étape ${i}` })
        await new Promise((r) => setTimeout(r, 25)) // 250 ms in all, far past the 60 ms quiet limit
      }
      return { brief: sampleOutput('text.brief', 'ok') }
    })
    const res = await start().done
    expect(res.states.a).toBe('done')
    expect(h.calls).toHaveLength(1)
  })

  it('bounds a long node even when it talks, and stretches both limits to its estimate', { timeout: 10_000 }, async () => {
    const run = new AbortController()
    const w = new AttemptWatch(run.signal, { quietMs: 1_000, maxMs: 80, factor: 0, checkMs: 10, graceMs: 20, label: 'render.final@1 (render)' })
    const chatter = setInterval(() => w.touch(), 10)
    await expect(w.follow(new Promise<never>(() => undefined))).rejects.toMatchObject({ code: 'stalled', message: expect.stringMatching(/pas fini après/) })
    clearInterval(chatter)
    expect(w.signal.aborted).toBe(true)
    // the run's cancel reaches the attempt's signal
    const run2 = new AbortController()
    const w2 = new AttemptWatch(run2.signal, { quietMs: 1_000, maxMs: 1_000, factor: 0, checkMs: 10, graceMs: 20, label: 'x' })
    run2.abort()
    expect(w2.signal.aborted).toBe(true)
  })
})

describe('one graphic of motion.render is bounded (a map stuck in the browser held a documentary run)', () => {
  it('fails the attempt past its limit, permanent on the last try, and passes a finished one through', async () => {
    const { boundedDraw, graphicLimitS } = await import('../../src/engine/nodes/motion-render')
    expect(graphicLimitS(150)).toBe(120)
    expect(graphicLimitS(600)).toBe(300)
    const stuck = (signal: AbortSignal) => new Promise<never>(() => void signal)
    await expect(boundedDraw(new AbortController().signal, 0.05, 'carte s1', 1, stuck)).rejects.toMatchObject({ code: 'stalled', permanent: false })
    await expect(boundedDraw(new AbortController().signal, 0.05, 'carte s1', 3, stuck)).rejects.toMatchObject({ code: 'stalled', permanent: true, message: expect.stringMatching(/carte s1 : pas dessinée/) })
    await expect(boundedDraw(new AbortController().signal, 5, 'carte s1', 1, async () => 'ok')).resolves.toBe('ok')
  })
})
