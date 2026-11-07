// reverse-pipeline: `brain-run reverse` drives `reverse.*` on a scripted brain (no network, no cost): a start refused above
// the cap, follow to the end, result written to a file, transform and prove capped, the spending methods known.
import { describe, expect, it } from 'vitest'

interface Main {
  EXIT: Record<string, number>
  parseArgs(argv: string[]): Record<string, unknown> & { rest: string[] }
  isSpending(method: string): boolean
  RUN_STARTERS: RegExp
  UsageError: new (m: string) => Error
}
interface Rev {
  reverseCommand(brain: unknown, o: unknown, deps: unknown): Promise<{ code: number; report: Record<string, unknown> }>
  judgeReverse(status: unknown, EXIT: Record<string, number>): { stop: number | null }
}
// plain .mjs scripts (no type declarations): imported through a variable so tsc does not resolve them
const mainPath = '../../scripts/brain-run.mjs'
const revPath = '../../scripts/brain-run-reverse.mjs'
const m = (await import(mainPath)) as Main
const r = (await import(revPath)) as Rev

function fakeBrain(values: Record<string, (args: unknown[]) => unknown>) {
  const calls: { method: string; args: unknown[] }[] = []
  return { calls, call: async (method: string, args: unknown[] = []) => { calls.push({ method, args }); return values[method]?.(args) ?? null } }
}

const opts = (o: Record<string, unknown>) => ({ data: 'x', maxUsd: null, budget: null, waitMin: 1, pollS: 0, requestFile: null, transformFile: null, out: null, ...o })

describe('brain-run reverse', () => {
  it('knows reverse.start / transform / prove spend and start runs outside `call`', () => {
    for (const x of ['reverse.start', 'reverse.transform', 'reverse.prove']) {
      expect(m.isSpending(x)).toBe(true)
      expect(m.RUN_STARTERS.test(x)).toBe(true)
    }
    for (const x of ['reverse.status', 'reverse.result', 'reverse.list']) expect(m.isSpending(x)).toBe(false)
    expect(() => m.parseArgs(['reverse', 'start', '--data', 'x'])).toThrow(/--max-usd/)
    expect(() => m.parseArgs(['reverse', 'prove', 'id', '--data', 'x', '--budget', '2'])).toThrow(/--max-usd/)
    const o = m.parseArgs(['reverse', 'start', '--data', 'x', '--max-usd', '5', '--request-file', 'req.json'])
    expect(o.rest).toEqual(['start'])
    expect(String(o['requestFile'])).toMatch(/req\.json$/)
    expect(m.parseArgs(['reverse', 'follow', 'id', '--data', 'x']).rest).toEqual(['follow', 'id'])
  })

  it('start is refused above the cap; follow polls until done; result goes to a file', async () => {
    let polls = 0
    const brain = fakeBrain({
      'reverse.start': () => ({ id: '2026-11-06-x' }),
      'reverse.status': () => ({ id: '2026-11-06-x', phase: 'rounds', state: ++polls > 2 ? 'done' : 'running', stoppedBecause: null, spentUsd: 1, budgetUsd: 8, recent: [] }),
      'reverse.result': () => ({ id: '2026-11-06-x', state: 'proven', summary: 'A pipeline' })
    })
    const written = new Map<string, unknown>()
    const deps = { EXIT: m.EXIT, UsageError: m.UsageError, readJson: () => ({ links: [{ url: 'https://www.youtube.com/@x' }], testBudgetUsd: 8 }), writeJson: (f: string, v: unknown) => void written.set(f, v), clock: () => 0 }
    const over = await r.reverseCommand(brain, opts({ rest: ['start'], maxUsd: 5, requestFile: 'req.json' }), deps)
    expect(over.code).toBe(m.EXIT['overQuote'])
    expect(brain.calls.map((c) => c.method)).not.toContain('reverse.start')
    const started = await r.reverseCommand(brain, opts({ rest: ['start'], maxUsd: 10, requestFile: 'req.json' }), deps)
    expect(started.report).toMatchObject({ started: true, id: '2026-11-06-x', budgetUsd: 8 })
    const followed = await r.reverseCommand(brain, opts({ rest: ['follow', '2026-11-06-x'] }), deps)
    expect(followed.code).toBe(m.EXIT['ok'])
    const res = await r.reverseCommand(brain, opts({ rest: ['result', '2026-11-06-x'], out: 'p.json' }), deps)
    expect(res.report).toMatchObject({ out: 'p.json', state: 'proven' })
    expect(written.get('p.json')).toMatchObject({ id: '2026-11-06-x' })
    await expect(r.reverseCommand(brain, opts({ rest: ['start'], maxUsd: 10 }), deps)).rejects.toThrow(/--request-file/)
  })

  it('transform and prove are capped; list passes through; a stop or a failure ends follow loudly', async () => {
    const brain = fakeBrain({ 'reverse.transform': () => ({ id: 'y' }), 'reverse.prove': (a) => ({ id: a[0], state: 'running', budgetUsd: a[1] }), 'reverse.list': () => [{ id: 'y' }] })
    const deps = { EXIT: m.EXIT, UsageError: m.UsageError, readJson: () => ({ action: 'translate', language: 'en', testBudgetUsd: 4 }), writeJson: () => {}, clock: () => 0 }
    expect((await r.reverseCommand(brain, opts({ rest: ['transform', 'x'], maxUsd: 3, transformFile: 't.json' }), deps)).code).toBe(m.EXIT['overQuote'])
    expect((await r.reverseCommand(brain, opts({ rest: ['transform', 'x'], maxUsd: 5, transformFile: 't.json' }), deps)).report).toMatchObject({ from: 'x', id: 'y' })
    expect((await r.reverseCommand(brain, opts({ rest: ['prove', 'x'], maxUsd: 1, budget: 2 }), deps)).code).toBe(m.EXIT['overQuote'])
    expect((await r.reverseCommand(brain, opts({ rest: ['prove', 'x'], maxUsd: 3, budget: 2 }), deps)).report).toMatchObject({ id: 'x', budgetUsd: 2 })
    expect(brain.calls.filter((c) => c.method === 'reverse.prove')).toHaveLength(1)
    await expect(r.reverseCommand(brain, opts({ rest: ['prove', 'x'], maxUsd: 3 }), deps)).rejects.toThrow(/--budget/)
    expect((await r.reverseCommand(brain, opts({ rest: ['list'] }), deps)).report).toEqual([{ id: 'y' }])
    expect(r.judgeReverse({ state: 'stopped', stoppedBecause: 'budget' }, m.EXIT).stop).toBe(m.EXIT['gate'])
    expect(r.judgeReverse({ state: 'failed' }, m.EXIT).stop).toBe(m.EXIT['runFailed'])
    expect(r.judgeReverse({ state: 'running' }, m.EXIT).stop).toBeNull()
  })
})
