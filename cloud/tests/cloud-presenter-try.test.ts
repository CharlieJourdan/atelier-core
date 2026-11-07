// `providers try talkingAvatar` (production-7, decision 0015): refuses unless the engine is really live, prints « Coût maximum »
// before the first provider call, keeps a manual try to 60 s of audio, and the benchmark's budget split can never pass the budget.
// The provider is a fake fetch; nothing here reaches the network or spends a cent.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.ts'
import { gpuUsdPerSecond, INFINITETALK_DEFAULTS, RUNPOD_API_BASE, type InfinitetalkSettings } from '../src/providers/infinitetalk-gpu.ts'
import { presenterEngineAdapters } from '../src/providers/presenter-engines.ts'
import { BENCH_HARD_MAX_USD, BENCH_STEPS, benchTimeoutS, benchWorstCase, tryAvatar, type BenchLimits, type TryAvatarArgs, type TryAvatarDeps, type TryAvatarEnv } from '../src/providers/try-avatar.ts'
import { WAVESPEED_BASE } from '../src/providers/wavespeed.ts'
import { fakeFetch, json, type Recorded } from './fake-fetch.ts'
import { makeCloud, signUpAndIn, type TestCloud } from './helpers.ts'

const KEY = 'try-test-SECRET-6b1e90c4'
const PROD = { NODE_ENV: 'production' }
const CDN = 'https://cdn.provider.example/out'
const MP4 = Buffer.alloc(200, 7)
const EP = 'epinfinitetalk1'
const P = gpuUsdPerSecond('4090')
const SETTINGS: InfinitetalkSettings = { ...INFINITETALK_DEFAULTS, endpointId: EP }

/** A fake provider world: WaveSpeed and a RunPod endpoint. `log` receives every provider call in order. */
function world(log: string[], pod: (n: number, body: { input: Record<string, unknown>; policy: { executionTimeout: number; ttl: number } }) => Record<string, unknown>) {
  let runs = 0
  let current: Recorded | null = null
  const f = fakeFetch((req) => {
    if (req.url.startsWith('https://cloud.example/files/')) return new Response(Buffer.from('bytes'), { status: 200 })
    log.push(`call:${req.method} ${req.url}`)
    if (req.url === `${WAVESPEED_BASE}/api/v3/wavespeed-ai/infinitetalk-fast`) return json({ data: { id: 't1' } })
    if (req.url === `${WAVESPEED_BASE}/api/v3/predictions/t1/result`) return json({ data: { id: 't1', status: 'completed', outputs: [`${CDN}/w.mp4`] } })
    if (req.url === `${RUNPOD_API_BASE}/${EP}/run`) {
      runs++
      current = req
      return json({ id: `job-${runs}`, status: 'IN_QUEUE' })
    }
    if (req.url.startsWith(`${RUNPOD_API_BASE}/${EP}/status/`)) {
      const body = JSON.parse(current?.body ?? '{}') as { input: Record<string, unknown>; policy: { executionTimeout: number; ttl: number } }
      return json({ id: req.url.split('/').pop(), ...pod(runs, body) })
    }
    return new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } })
  })
  return { f, runs: () => runs }
}

const done = (gpuS: number, coldS: number) => ({ status: 'COMPLETED', output: { video_base64: MP4.toString('base64') }, executionTime: gpuS * 1000, delayTime: coldS * 1000 })

async function setup(o: { paid?: boolean; engines?: string[]; keys?: string[]; f?: ReturnType<typeof fakeFetch> } = {}) {
  const f = o.f ?? fakeFetch(() => new Response('{}'))
  const t = makeCloud({
    paidCalls: o.paid ?? true,
    env: PROD,
    realAdapters: presenterEngineAdapters({ fetchImpl: f.fetch }, { endpointId: EP }),
    engines: o.engines ?? ['presenter:infinitetalk-fast', 'presenter:infinitetalk-gpu']
  })
  for (const k of o.keys ?? ['WAVESPEED_API_KEY', 'RUNPOD_API_KEY']) t.cloud.vault.set(k, KEY, 'test')
  const p = await signUpAndIn(t, { credits: 1000 })
  const image = join(t.dir, 'portrait.png')
  const audio = join(t.dir, 'voix.mp3')
  writeFileSync(image, 'PNG')
  writeFileSync(audio, 'MP3')
  return { t, p, image, audio }
}

const args = (s: { image: string; audio: string }, over: Partial<TryAvatarArgs> = {}): TryAvatarArgs => ({ engine: 'presenter:infinitetalk-fast', image: s.image, audio: s.audio, ...over })
const envOf = (over: Partial<TryAvatarEnv> = {}): TryAvatarEnv => ({ publicUrl: 'https://cloud.example', infinitetalk: SETTINGS, ...over })
const deps = (seconds: number, extra: TryAvatarDeps = {}): TryAvatarDeps => ({
  probeSeconds: () => Promise.resolve(seconds),
  cutAudio: (_f, _s, to) => Promise.resolve(void writeFileSync(to, 'MP3')),
  ...extra
})
async function go(t: TestCloud, a: TryAvatarArgs, env: TryAvatarEnv, d: TryAvatarDeps, log: string[] = []) {
  const lines: string[] = []
  const say = (l: string): void => {
    lines.push(l)
    log.push(`say:${l}`)
  }
  const result = await tryAvatar(t.cloud, a, 'cli', env, say, d).then(
    () => null,
    (e: Error) => e
  )
  return { lines, error: result }
}

describe('providers try talkingAvatar: refusals', () => {
  it('refuses when paidCalls is off, when the engine is not in realEngines, and when its key is not in the vault: nothing is called', async () => {
    const log: string[] = []
    const w = world(log, () => done(1, 1))
    for (const o of [{ paid: false }, { engines: [] }, { keys: [] }]) {
      const s = await setup({ ...o, f: w.f })
      const r = await go(s.t, args(s), envOf(), deps(10, { http: { fetchImpl: w.f.fetch, pollMs: 0 } }), log)
      expect(r.error?.message, JSON.stringify(o)).toMatch(/not live/)
      expect(r.lines.join('\n')).not.toContain('Coût maximum')
    }
    expect(log.filter((l) => l.startsWith('call:'))).toEqual([])
  })

  it('refuses the GPU engine without its endpoint, a bad engine, a budget over the hard maximum, and --bench on another engine', async () => {
    const s = await setup()
    const d = deps(10)
    expect((await go(s.t, args(s, { engine: 'presenter:infinitetalk-gpu' }), envOf({ infinitetalk: { ...INFINITETALK_DEFAULTS } }), d)).error?.message).toMatch(/endpointId/)
    expect((await go(s.t, args(s, { engine: 'presenter:nobody' }), envOf(), d)).error?.message).toMatch(/--engine is one of/)
    expect((await go(s.t, args(s, { engine: 'presenter:infinitetalk-gpu', budgetUsd: BENCH_HARD_MAX_USD + 1 }), envOf(), d)).error?.message).toMatch(/at most 20/)
    expect((await go(s.t, args(s, { budgetUsd: 0 }), envOf(), d)).error?.message).toMatch(/positive/)
    expect((await go(s.t, args(s, { bench: true }), envOf(), d)).error?.message).toMatch(/infinitetalk-gpu only/)
    expect((await go(s.t, args(s, { resolution: '1080p' }), envOf(), d)).error?.message).toMatch(/makes 480p, 720p/)
    expect((await go(s.t, { engine: 'presenter:infinitetalk-fast', image: undefined, audio: s.audio }, envOf(), d)).error?.message).toMatch(/--image/)
  })

  it('refuses an audio over 60 s in a manual try, before any call, and the CLI reports a not-live engine with exit code 1', async () => {
    const log: string[] = []
    const w = world(log, () => done(1, 1))
    const s = await setup({ f: w.f })
    const r = await go(s.t, args(s), envOf(), deps(60.5, { http: { fetchImpl: w.f.fetch } }), log)
    expect(r.error?.message).toMatch(/limited to 60 s/)
    expect(log.filter((l) => l.startsWith('call:'))).toEqual([])
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const err: string[] = []
    stderr.on('data', (d) => err.push(String(d)))
    const t = makeCloud()
    const code = await runCli(['providers', 'try', 'talkingAvatar', '--engine', 'presenter:infinitetalk-fast', '--image', s.image, '--audio', s.audio], { stdin: Object.assign(new PassThrough(), { isTTY: false }), stdout, stderr, env: {}, cloud: t.cloud })
    expect(code).toBe(1)
    expect(err.join('')).toMatch(/not live/)
  })
})

describe('providers try talkingAvatar: one generation', () => {
  it('prints the maximum cost BEFORE the first provider call, then runs once, saves the clip and the report lines', async () => {
    const log: string[] = []
    const w = world(log, () => done(1, 1))
    const s = await setup({ f: w.f })
    const out = join(s.t.dir, 'out')
    const r = await go(s.t, args(s, { out }), envOf(), deps(8.2), log)
    expect(r.error).toBeNull()
    const firstSay = log.findIndex((l) => l.startsWith('say:Coût maximum'))
    const firstCall = log.findIndex((l) => l.startsWith('call:'))
    expect(firstSay).toBeGreaterThanOrEqual(0)
    expect(firstCall).toBeGreaterThan(firstSay)
    // 8.2 s of audio is 9 s billed, at the 720p rate of the fast engine (0.03 $/s): 0.27 $
    expect(r.lines).toContain('Coût maximum : 0.2700 $ (plafond 20.00 $)')
    expect(r.lines.join('\n')).toMatch(/provider cost \$0\.270000/)
    expect(readFileSync(join(out, 'avatar-infinitetalk-fast-720p-9s.mp4')).length).toBe(MP4.length)
    expect(w.f.calls.some((c) => c.headers.authorization && !c.url.startsWith(WAVESPEED_BASE))).toBe(false)
  })

  it('on the GPU engine the printed maximum is the ceiling (limit + cold-start reserve) at the GPU price, and the job carries that limit', async () => {
    const log: string[] = []
    const w = world(log, () => done(40, 25))
    const s = await setup({ f: w.f })
    const r = await go(s.t, args(s, { engine: 'presenter:infinitetalk-gpu', resolution: '480p', budgetUsd: 1, out: join(s.t.dir, 'o') }), envOf(), deps(10, { http: { fetchImpl: w.f.fetch, pollMs: 0 } }), log)
    expect(r.error).toBeNull()
    // the budget of 1 $ buys floor(1 / P - 180) seconds of limit
    const timeoutS = Math.min(SETTINGS.maxGpuSeconds, Math.floor(1 / P - SETTINGS.coldStartReserveS))
    expect(timeoutS).toBe(1800)
    const run = JSON.parse(w.f.calls.find((c) => c.url.endsWith('/run'))?.body ?? '{}') as { policy: { executionTimeout: number } }
    expect(run.policy.executionTimeout).toBe(timeoutS * 1000)
    const maxLine = r.lines.find((l) => l.startsWith('Coût maximum'))
    expect(maxLine).toBe(`Coût maximum : ${((timeoutS + 180) * P).toFixed(4)} $ (plafond 1.0000 $)`.replace('1.0000', '1.00'))
  })
})

describe('the benchmark budget', () => {
  const lim = (budgetUsd: number, perJobCapS = 1800): BenchLimits => ({ budgetUsd, usdPerGpuSecond: P, coldReserveS: 180, perJobCapS })

  it('benchTimeoutS gives the seconds the remaining budget can pay after the cold-start reserve, capped, 0 when nothing fits', () => {
    expect(benchTimeoutS(20, lim(20))).toBe(1800)
    expect(benchTimeoutS(0.2, lim(0.2))).toBe(Math.floor(0.2 / P - 180))
    expect(benchTimeoutS(180 * P, lim(1))).toBe(0)
    expect(benchTimeoutS(0, lim(1))).toBe(0)
    expect(benchTimeoutS(-3, lim(1))).toBe(0)
    // a job's share of the whole budget caps it even when plenty remains
    expect(benchTimeoutS(20, lim(20), 0.15)).toBe(Math.floor((0.15 * 20) / P - 180) > 1800 ? 1800 : Math.floor((0.15 * 20) / P - 180))
    expect(benchTimeoutS(0.1, lim(20), 0.5)).toBe(Math.floor(0.1 / P - 180))
    expect(BENCH_STEPS.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1, 10)
  })

  it('no budget, cap or number of jobs can make the worst case of the series pass the budget', () => {
    for (const budget of [0.06, 0.2, 0.5, 1, 3, 7.5, 20]) {
      for (const cap of [30, 300, 1800, 7200]) {
        const w = benchWorstCase(BENCH_STEPS, lim(budget, cap))
        expect(w.maxUsd, `${budget}/${cap}`).toBeLessThanOrEqual(budget + 1e-9)
        for (const p of w.planned) expect(p.timeoutS).toBeLessThanOrEqual(cap)
        expect(w.maxUsd).toBeCloseTo(
          w.planned.reduce((n, p) => n + p.maxUsd, 0),
          10
        )
      }
    }
    expect(benchWorstCase(BENCH_STEPS, lim(0.01)).planned).toEqual([])
  })

  it('runs the series one job after the other, each limit from what is left, and writes bench.json; the counted spend stays under the budget', async () => {
    const log: string[] = []
    const w = world(log, (n) => done(20 * n, 30))
    const s = await setup({ f: w.f })
    const out = join(s.t.dir, 'bench')
    mkdirSync(out, { recursive: true })
    const budget = 2
    const r = await go(s.t, args(s, { engine: 'presenter:infinitetalk-gpu', bench: true, budgetUsd: budget, out }), envOf(), deps(75, { http: { fetchImpl: w.f.fetch, pollMs: 0 } }), log)
    expect(r.error).toBeNull()
    expect(w.runs()).toBe(4)
    const bodies = w.f.calls.filter((c) => c.url.endsWith('/run')).map((c) => JSON.parse(c.body) as { input: { resolution: string }; policy: { executionTimeout: number; ttl: number } })
    expect(bodies.map((b) => b.input.resolution)).toEqual(['480p', '720p', '720p', '720p'])
    // each limit is what the budget LEFT after the previous jobs (execution + cold start counted) could pay
    let left = budget
    bodies.forEach((b, i) => {
      expect(b.policy.executionTimeout / 1000).toBe(benchTimeoutS(left, lim(budget), BENCH_STEPS[i]?.share))
      expect(b.policy.ttl).toBe(b.policy.executionTimeout + 180_000)
      left -= (20 * (i + 1) + 30) * P
    })
    const report = JSON.parse(readFileSync(join(out, 'bench.json'), 'utf8')) as { countedSpentUsd: number; budgetUsd: number; jobs: { status: string; gpuSecondsPerVideoSecond: number; seconds: number; coldStartS: number; usdPerMinuteOfVideo: number }[] }
    expect(report.budgetUsd).toBe(budget)
    expect(report.countedSpentUsd).toBeCloseTo(budget - left, 10)
    expect(report.countedSpentUsd).toBeLessThanOrEqual(budget)
    expect(report.jobs.map((j) => j.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(report.jobs[0]).toMatchObject({ seconds: 10, gpuSecondsPerVideoSecond: 2, coldStartS: 30 })
    expect(report.jobs[0]?.usdPerMinuteOfVideo).toBeCloseTo((20 * P) / 10 * 60, 10)
    expect(r.lines.some((l) => l.startsWith('Coût maximum'))).toBe(true)
    expect(r.lines.join('\n')).toMatch(/Série \| s GPU \/ s vidéo \| \$ \/ minute de vidéo/)
    expect(log.findIndex((l) => l.startsWith('say:Coût maximum'))).toBeLessThan(log.findIndex((l) => l.startsWith('call:')))
  })

  it('jobs that all fail are counted at their full ceiling: the series stops being run when the budget is spent', async () => {
    const log: string[] = []
    const w = world(log, () => ({ status: 'FAILED', error: 'CUDA out of memory' }))
    const s = await setup({ f: w.f })
    const out = join(s.t.dir, 'bench2')
    const budget = 0.6
    const r = await go(s.t, args(s, { engine: 'presenter:infinitetalk-gpu', bench: true, budgetUsd: budget, out }), envOf({ infinitetalk: { ...SETTINGS, maxGpuSeconds: 400 } }), deps(75, { http: { fetchImpl: w.f.fetch, pollMs: 0 } }), log)
    expect(r.error).toBeNull()
    const report = JSON.parse(readFileSync(join(out, 'bench.json'), 'utf8')) as { countedSpentUsd: number; jobs: { status: string }[] }
    expect(report.countedSpentUsd).toBeLessThanOrEqual(budget + 1e-9)
    expect(report.jobs.some((j) => j.status === 'failed')).toBe(true)
    expect(report.jobs.map((j) => j.status).every((x) => x === 'failed' || x === 'skipped')).toBe(true)
    // every job that did run had a limit its remaining budget could pay in full
    for (const c of w.f.calls.filter((c) => c.url.endsWith('/run'))) {
      const ex = (JSON.parse(c.body) as { policy: { executionTimeout: number } }).policy.executionTimeout / 1000
      expect((ex + 180) * P).toBeLessThanOrEqual(budget + 1e-9)
    }
  })

  it('leaves out the steps longer than the audio, and needs ffmpeg (a clear refusal when it cannot cut)', async () => {
    const log: string[] = []
    const w = world(log, () => done(5, 5))
    const s = await setup({ f: w.f })
    const out = join(s.t.dir, 'bench3')
    const r = await go(s.t, args(s, { engine: 'presenter:infinitetalk-gpu', bench: true, out }), envOf(), deps(35, { http: { fetchImpl: w.f.fetch, pollMs: 0 } }), log)
    expect(r.error).toBeNull()
    expect(w.runs()).toBe(3)
    expect(r.lines[0]).toMatch(/10 s 480p.*10 s 720p.*30 s 720p/)
    expect(r.lines[0]).not.toContain('60 s 720p')
    const tooShort = await go(s.t, args(s, { engine: 'presenter:infinitetalk-gpu', bench: true, out }), envOf(), deps(4))
    expect(tooShort.error?.message).toMatch(/at least 10 s/)
    const noOut = await go(s.t, args(s, { engine: 'presenter:infinitetalk-gpu', bench: true }), envOf(), deps(35, { http: { fetchImpl: w.f.fetch } }))
    expect(noOut.error?.message).toMatch(/--out/)
    const noFfmpeg = await go(
      s.t,
      args(s, { engine: 'presenter:infinitetalk-gpu', bench: true, out }),
      envOf(),
      deps(35, { http: { fetchImpl: w.f.fetch }, cutAudio: () => Promise.reject(new Error('ffmpeg could not be run')) })
    )
    expect(noFfmpeg.error?.message).toMatch(/ffmpeg/)
  })
})
