// scripts/brain-run.mjs, the one sanctioned runner of real runs: it refuses a quote above the cap without starting
// anything, cancels a run whose spend passes the cap, stops loudly on a gate, a failure or a stall, and reports every
// demo item of a real run. The brain is a scripted RPC stub (no network, no cost).
import { describe, expect, it } from 'vitest'

interface Mod {
  EXIT: Record<string, number>
  parseArgs(argv: string[]): Record<string, unknown>
  brainExtra(o: Record<string, unknown>): string[]
  isSpending(method: string): boolean
  RUN_STARTERS: RegExp
  creditsToUsd(credits: number, usdToEur: number): number
  judgeQuote(quote: unknown, maxUsd: number, usdToEur: number, mode?: string | null): { ok: boolean; usd: number; credits: number; problems: string[] }
  judgeDemoQuote(quote: unknown): { ok: boolean; problems: string[] }
  watch(brain: unknown, runId: number, o: unknown, quote: unknown, clock?: () => number): Promise<{ code: number; reason: string; report: Record<string, unknown> }>
  cloneCommand(brain: unknown, o: unknown, io?: unknown): Promise<{ code: number; report: Record<string, unknown> }>
  judgeClone(progress: unknown): { stop: number | null; reason: string | null }
  Brain: new (url: string, token: string, fetchImpl: typeof fetch, expectData?: string | null, seenAs?: string | null) => { call(method: string, args?: unknown[]): Promise<unknown> }
}
// A plain .mjs script (no type declarations): imported through a variable so tsc does not resolve it.
const modPath = '../../scripts/brain-run.mjs'
const load = (): Promise<Mod> => import(modPath) as Promise<Mod>

const quote = (credits: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  pipelineId: 'avatar@1',
  minutes: 1,
  demo: false,
  demoReason: '',
  budgetMode: 'usage_max',
  modes: { usage_max: { totalCredits: credits, totalEur: credits / 100, durationS: 60 }, qualite_max: { totalCredits: credits * 2, totalEur: credits / 50, durationS: 60 } },
  real: { available: true, reason: '' },
  ...extra
})

const run = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 7,
  status: 'running',
  demo: false,
  cloud: true,
  error: null,
  quoteCredits: 50,
  spentCredits: 0,
  progress: 0.1,
  current: { nodeId: 'voice', label: 'Voix', step: 'lecture' },
  waitingNodes: [],
  durationS: null,
  videoFileRef: null,
  packageDir: null,
  nodes: [],
  ...over
})

/** A brain whose `production.get` answers the scripted runs in order (the last one repeats). */
function stubBrain(m: Mod, runs: Record<string, unknown>[], calls: string[] = []): unknown {
  let i = 0
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body) as { method: string }
    calls.push(method)
    const value = method === 'money.overview' ? { usdToEur: 1 } : method === 'production.get' ? runs[Math.min(i++, runs.length - 1)] : null
    return new Response(JSON.stringify({ ok: true, value }), { status: 200 })
  }) as unknown as typeof fetch
  return new m.Brain('http://stub', 'atb_test', fetchImpl)
}

const opts = { maxUsd: 1, stallMin: 20, waitMin: 120, pollS: 0 }

describe('brain-run', () => {
  it('needs --data, and --max-usd to run, wait or approve', async () => {
    const m = await load()
    expect(() => m.parseArgs(['run', '3'])).toThrow(/--data/)
    expect(() => m.parseArgs(['run', '3', '--data', 'x'])).toThrow(/--max-usd/)
    expect(m.parseArgs(['quote', '3', '--data', 'x']).rest).toEqual(['3'])
  })

  it('starts the brain without the agents’ tools by default, with them on --mcp (the team at work: production-equipe)', async () => {
    const m = await load()
    const plain = m.brainExtra(m.parseArgs(['start', '--data', 'x', '--token-file', 't']))
    expect(plain).toContain('--no-mcp')
    const team = m.brainExtra(m.parseArgs(['start', '--data', 'x', '--token-file', 't', '--mcp', '--cloud-url', 'http://127.0.0.1:8790']))
    expect(team).not.toContain('--no-mcp')
    expect(team).toEqual(expect.arrayContaining(['--no-backup', '--cloud-url', 'http://127.0.0.1:8790']))
  })

  it('knows the methods that spend, and refuses run starters outside « run »', async () => {
    const m = await load()
    for (const method of ['projects.run', 'production.retry', 'channelVoices.clone', 'channelPresenters.clean', 'channelClips.fromStock', 'style.study', 'style.sample']) expect(m.isSpending(method)).toBe(true)
    for (const method of ['projects.create', 'projects.quote', 'production.get', 'channels.list', 'style.get', 'style.quote']) expect(m.isSpending(method)).toBe(false)
    expect(m.RUN_STARTERS.test('projects.run')).toBe(true)
    expect(m.RUN_STARTERS.test('production.approve')).toBe(false)
    // moteur-assemblage: a clone starts reads and runs in the brain's background: `call` refuses it (use `clone start`)
    expect(m.RUN_STARTERS.test('clone.start')).toBe(true)
    expect(m.isSpending('clone.resume')).toBe(true)
    expect(m.isSpending('clone.progress')).toBe(false)
  })

  it('drives « Créer une pipeline » the way a user does: intake turns, a start refused above the cap, follow to the end (moteur-assemblage)', async () => {
    const m = await load()
    const calls: string[] = []
    let progressCalls = 0
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const { method, args } = JSON.parse(init.body) as { method: string; args: unknown[] }
      calls.push(method)
      const draft = { testBudgetUsd: 8, references: [{ url: 'https://www.youtube.com/@x' }] }
      const values: Record<string, unknown> = {
        'clone.intakeStart': { draft: { testBudgetUsd: null }, said: [], asked: null },
        'clone.intakeTurn': { state: { draft, said: [String(args[1])], asked: null }, text: 'Voilà', ready: true, missing: [], changes: [] },
        'clone.start': { cloneId: '2026-11-04-x' },
        'clone.progress': ++progressCalls && { now: { key: 'k', vars: {} }, spentUsd: 0.5, budgetUsd: 8, steps: [], recent: [], state: progressCalls > 2 ? { kind: 'done', outcome: 'cloned' } : { kind: 'running' } }
      }
      return new Response(JSON.stringify({ ok: true, value: values[method] ?? null }), { status: 200 })
    }) as unknown as typeof fetch
    const brain = new m.Brain('http://stub', 'atb_test', fetchImpl)
    const files = new Map<string, unknown>()
    const io = { read: (f: string) => files.get(f) ?? null, write: (f: string, v: unknown) => void files.set(f, v), clock: () => 0 }
    const base = { ...opts, data: 'x', intake: 'intake.json', budget: null }
    const said = await m.cloneCommand(brain, { ...base, rest: ['say', 'copie', 'cette', 'chaîne'] }, io)
    expect(said.report).toMatchObject({ text: 'Voilà', ready: true })
    expect(calls.slice(0, 2)).toEqual(['clone.intakeStart', 'clone.intakeTurn'])
    // the brief accepts 8 $: refused under a 5 $ cap, nothing starts
    const over = await m.cloneCommand(brain, { ...base, maxUsd: 5, rest: ['start'] }, io)
    expect(over.code).toBe(m.EXIT.overQuote)
    expect(calls).not.toContain('clone.start')
    const started = await m.cloneCommand(brain, { ...base, maxUsd: 10, rest: ['start'] }, io)
    expect(started.report).toMatchObject({ started: true, cloneId: '2026-11-04-x' })
    const followed = await m.cloneCommand(brain, { ...base, rest: ['follow', '2026-11-04-x'] }, io)
    expect(followed.code).toBe(m.EXIT.ok)
    // a clone never waits for a person (decision 0110): a stop (the budget) is a stop, never a gate
    expect(m.judgeClone({ state: { kind: 'stopped', why: 'budget' } }).stop).toBe(m.EXIT.runFailed)
    expect(() => m.parseArgs(['clone', 'start', '--data', 'x'])).toThrow(/--max-usd/)
    expect(m.parseArgs(['clone', 'follow', 'id', '--data', 'x']).rest).toEqual(['follow', 'id'])
  })

  it('refuses a quote above the cap, a demo quote and an unavailable real engine', async () => {
    const m = await load()
    expect(m.judgeQuote(quote(80), 1, 1).ok).toBe(true)
    const over = m.judgeQuote(quote(120), 1, 1)
    expect(over.ok).toBe(false)
    expect(over.problems.join()).toMatch(/au-dessus du plafond/)
    expect(m.judgeQuote(quote(80), 1, 1, 'qualite_max').ok).toBe(false)
    expect(m.judgeQuote(quote(10, { demo: true, demoReason: 'pas de Cloud' }), 1, 1).ok).toBe(false)
    expect(m.judgeQuote(quote(10, { real: { available: false, reason: 'paidCalls off' } }), 1, 1).ok).toBe(false)
    // 1 credit = 0,01 €; at 0.92 € a dollar, 92 credits are exactly 1 $
    expect(m.creditsToUsd(92, 0.92)).toBeCloseTo(1, 6)
  })

  it('reports a finished run with its spend, outputs and every demo item', async () => {
    const m = await load()
    const done = run({ status: 'succeeded', progress: 1, spentCredits: 48, videoFileRef: 'final.mp4', nodes: [{ nodeId: 'visuals', state: 'done', quoteCredits: 30, credits: 28, engines: [{ id: 'fake-image', real: false, jobs: 1, credits: 0 }, { id: 'still:gpt-image', real: true, jobs: 9, credits: 28 }], error: null }] })
    const w = await m.watch(stubBrain(m, [run(), done]), 7, opts, null)
    expect(w.code).toBe(m.EXIT.ok)
    expect(w.report).toMatchObject({ status: 'succeeded', videoFileRef: 'final.mp4', demoItems: ['visuals: fake-image'], spent: { credits: 48, usd: 0.48 }, captureOverQuote: 0.96 })
  })

  it('cancels a run whose spend passes the cap', async () => {
    const m = await load()
    const calls: string[] = []
    const w = await m.watch(stubBrain(m, [run({ spentCredits: 40 }), run({ spentCredits: 130 }), run({ status: 'cancelled', spentCredits: 130 })], calls), 7, opts, null)
    expect(w.code).toBe(m.EXIT.overSpend)
    expect(calls).toContain('production.cancel')
  })

  it('stops loudly at a gate, on a failure, and when nothing moves', async () => {
    const m = await load()
    const gate = await m.watch(stubBrain(m, [run({ status: 'waiting', waitingNodes: ['script'] })]), 7, opts, null)
    expect([gate.code, gate.reason]).toEqual([m.EXIT.gate, expect.stringMatching(/script/)])
    const failed = await m.watch(stubBrain(m, [run({ status: 'failed', error: 'Voix impossible' })]), 7, opts, null)
    expect([failed.code, failed.reason]).toEqual([m.EXIT.runFailed, expect.stringMatching(/Voix impossible/)])
    let t = 0
    const stalled = await m.watch(stubBrain(m, [run()]), 7, opts, null, () => (t += 5 * 60_000))
    expect(stalled.code).toBe(m.EXIT.stalled)
    expect(stalled.reason).toMatch(/rien n’a bougé/)
  })

  it('never talks to another session’s brain: the data folder is checked, a foreign token is refused', async () => {
    const m = await load()
    const answer = (dbPath: string, status = 200) =>
      (async () => new Response(JSON.stringify(status === 200 ? { ok: true, value: { dbPath } } : { ok: false }), { status })) as unknown as typeof fetch
    const mine = new m.Brain('http://stub', 'atb_x', answer('C:/data/mine/atelier.db'), 'C:/data/mine')
    await expect(mine.call('app.info')).resolves.toMatchObject({ dbPath: 'C:/data/mine/atelier.db' })
    const other = new m.Brain('http://stub', 'atb_x', answer('C:/data/other/atelier.db'), 'C:/data/mine')
    await expect(other.call('projects.list')).rejects.toThrow(/pas C:.data.mine : refusé|refusé/)
    const foreign = new m.Brain('http://stub', 'atb_x', answer('', 401), 'C:/data/mine')
    await expect(foreign.call('projects.list')).rejects.toThrow(/n’est pas celui de ce dossier --data/)
  })

  it('starts a demo run only when the quote says it is a demo that debits nothing (vps-essai)', async () => {
    const m = await load()
    expect(m.parseArgs(['run', '--data', 'x', '1', '--demo'])).toMatchObject({ demo: true, maxUsd: 0 })
    expect(m.judgeDemoQuote(quote(0, { demo: true, debited: false }))).toMatchObject({ ok: true, problems: [] })
    expect(m.judgeDemoQuote(quote(40, { demo: false })).ok).toBe(false)
    expect(m.judgeDemoQuote(quote(0, { demo: true, debited: true })).ok).toBe(false)
  })

  it('checks a brain in a container against the folder as the container sees it (vps-essai)', async () => {
    const m = await load()
    const answer = (dbPath: string) => (async () => new Response(JSON.stringify({ ok: true, value: { dbPath } }), { status: 200 })) as unknown as typeof fetch
    // the host folder C:/inputs/vps/brain is mounted at /vps/brain: the brain answers a POSIX path
    const boxed = new m.Brain('http://stub', 'atb_x', answer('/vps/brain/atelier.db'), 'C:/inputs/vps/brain', '/vps/brain')
    await expect(boxed.call('app.info')).resolves.toMatchObject({ dbPath: '/vps/brain/atelier.db' })
    const otherBox = new m.Brain('http://stub', 'atb_x', answer('/vps/other/atelier.db'), 'C:/inputs/vps/brain', '/vps/brain')
    await expect(otherBox.call('projects.list')).rejects.toThrow(/refusé/)
    const prefix = new m.Brain('http://stub', 'atb_x', answer('/vps/brain2/atelier.db'), 'C:/inputs/vps/brain', '/vps/brain')
    await expect(prefix.call('projects.list')).rejects.toThrow(/refusé/)
  })
})
