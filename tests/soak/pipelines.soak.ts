// `npm run pipelines:soak` (solidite): every base pipeline launched for real SOAK_N times (default 2) on stand-in engines
// (free, no network) with random faults — a provider that is busy (retried), that fails, that never answers (the Cloud's
// job deadline), a busy Cloud (429 on uploads), or all of them mixed. Each run must end on its own (no hang), either with
// its video or failed with a French reason and nothing left running or held; the quote must not move between two asks,
// the run must hold the quote shown, and the Cloud must capture exactly what the run shows, within the quote's ceiling.
// SOAK_SEED replays a sequence (the order of concurrent calls still varies a little).
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { captureCeiling } from '../../src/main/production/runs/cloud'
import type { RunDetail } from '../../src/shared/runs'
import { BASE_PIPELINES, technologyRegistry, techName } from '../../src/engine/technologies'
import { BASE_IDS, bench, cloudCaptured, enginesOfFamily, project, toEnd, type Bench, type Fault } from '../unit/pipeline-bench'

const N = Math.max(1, Number(process.env.SOAK_N ?? 2))
const SEED = Number(process.env.SOAK_SEED ?? Date.now() % 1_000_000)
const SCENARIOS = ['clean', 'retryable', 'fail', 'hang', 'busy', 'mixed'] as const
type Scenario = (typeof SCENARIOS)[number]

/** A small seeded generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Every upload answered 429 now and then (the Cloud's busy answer), as the first real 60 s run met. */
function busyFetch(rnd: () => number): typeof fetch {
  return async (input, init) => {
    const url = String(input)
    if (init?.method === 'POST' && url.includes('/v1/uploads?') && rnd() < 0.4) {
      return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'busy (soak)' } }), { status: 429, headers: { 'retry-after': '1', 'content-type': 'application/json' } })
    }
    return fetch(input, init)
  }
}

const outcomes: { pipeline: string; scenario: Scenario; status: string; quote: number; captured: number; minutes: number; error: string | null }[] = []
const benches: Bench[] = []
afterEach(async () => {
  while (benches.length) await benches.pop()?.close()
})
afterAll(() => {
  process.stdout.write(`\nSOAK seed ${SEED}, ${N} run(s) per pipeline\n`)
  for (const o of outcomes) {
    process.stdout.write(`  ${o.pipeline.padEnd(16)} ${o.scenario.padEnd(9)} ${o.status.padEnd(9)} quote ${String(o.quote).padStart(4)}  captured ${String(o.captured).padStart(4)}  ${o.minutes.toFixed(1)} min${o.error ? `  — ${o.error.slice(0, 120)}` : ''}\n`)
  }
})

describe(`every base pipeline under random faults (seed ${SEED})`, () => {
  let k = 0
  for (const baseId of BASE_IDS) {
    for (let i = 0; i < N; i++) {
      const n = k++
      it(`${baseId} #${i + 1}`, async () => {
        const rnd = seeded(SEED + n * 7919)
        const scenario = SCENARIOS[Math.floor(rnd() * SCENARIOS.length)] as Scenario
        const kinds: Fault[] = ['retryable', 'fail', 'hang']
        const fault = (): Fault => {
          if (scenario === 'clean' || scenario === 'busy' || rnd() >= 0.15) return 'ok'
          return scenario === 'mixed' ? (kinds[Math.floor(rnd() * kinds.length)] as Fault) : scenario
        }
        const b = await bench({ fault, cloudOptions: { maxJobMs: () => 4_000 }, ...(scenario === 'busy' || scenario === 'mixed' ? { cloudFetch: busyFetch(rnd) } : {}) })
        benches.push(b)
        const api = b.app.core.api
        const id = await project(b.app, baseId)
        // the quote does not move between two asks
        const q1 = await api['projects.quote'](id, { real: true })
        const q2 = await api['projects.quote'](id, { real: true })
        expect(q2.modes.usage_max.totalCredits).toBe(q1.modes.usage_max.totalCredits)
        const t0 = Date.now()
        // no hang: toEnd throws « HANG » with every node's state past 10 minutes
        const run: RunDetail = await toEnd(b.app, (await api['projects.run'](id, { real: true })).runId as number, 600_000)
        expect(['succeeded', 'failed']).toContain(run.status)
        expect(run.quoteCredits).toBe(q1.modes[run.budgetMode].totalCredits)
        if (run.status === 'failed') {
          // a clean failure: a reason, nothing left running
          expect(run.error, 'a failed run says why').toBeTruthy()
          expect(run.nodes.filter((x) => x.state === 'running' || x.state === 'queued').map((x) => x.nodeId)).toEqual([])
        } else {
          expect(run.videoFileRef).not.toBeNull()
          expect(run.demo).toBe(false)
        }
        // nothing held on the Cloud, and every capture is one the run shows, within the quote's ceiling
        await b.rig.t.cloud.jobs.whenIdle()
        await b.app.core.context.productionRuns.refreshCloudJobs(run.id)
        const after = api['production.get'](run.id) as RunDetail
        expect(b.rig.t.cloud.wallet.state(b.rig.teamId).held).toBe(0)
        expect(cloudCaptured(b.rig)).toBe(after.spentCredits)
        expect(after.spentCredits).toBeLessThanOrEqual(captureCeiling(after.quoteCredits))
        outcomes.push({ pipeline: baseId, scenario, status: run.status, quote: run.quoteCredits, captured: after.spentCredits, minutes: (Date.now() - t0) / 60_000, error: run.error })
      })
    }
  }
})

// Every engine inside every base pipeline that can use it (one run each, the brick pinned to it, no fallback), then mixed
// pipelines (each paid brick on an engine drawn at random). A pipeline is fixed code: only its settings change here.
// SOAK_ENGINES=0 skips this part; SOAK_MIXED runs per base (default 1).
const reg = technologyRegistry()
const PAID = ['voice', 'image', 'clip', 'presenter']
const pinned = (brick: string, engine: string) => [
  { op: 'setEngine', brick, engine },
  { op: 'setFallbacks', brick, fallbacks: [] }
]
const paidBricks = (baseId: string): { brick: string; family: string }[] =>
  (BASE_PIPELINES.find((b) => b.id === baseId)?.doc.bricks ?? []).flatMap((b) => {
    const family = reg.get(b.tech)?.engineFamily
    return family && PAID.includes(family) ? [{ brick: techName(b.tech as never), family }] : []
  })

/** One clean run with the given edits: it must end with its video, on the engines it was pinned to, within its quote. */
async function cleanRun(baseId: string, ops: Record<string, unknown>[], expected: Record<string, string>): Promise<void> {
  const b = await bench()
  benches.push(b)
  const api = b.app.core.api
  const id = await project(b.app, baseId, { ops })
  const run: RunDetail = await toEnd(b.app, (await api['projects.run'](id, { real: true })).runId as number, 600_000)
  expect(run.error, JSON.stringify(run.nodes.filter((x) => x.error).map((x) => [x.nodeId, x.error]))).toBeNull()
  expect(run.status).toBe('succeeded')
  for (const [brick, engine] of Object.entries(expected)) {
    const node = run.nodes.find((x) => x.type.startsWith(`${brick}@`))
    if (node && node.engines.length > 0) expect(node.engines.map((e) => e.id), `${brick} on ${engine}`).toContain(engine)
  }
  await b.rig.t.cloud.jobs.whenIdle()
  expect(cloudCaptured(b.rig)).toBe(run.spentCredits)
  expect(run.spentCredits).toBeLessThanOrEqual(captureCeiling(run.quoteCredits))
  outcomes.push({ pipeline: baseId, scenario: 'clean', status: `${run.status} ${Object.values(expected).join('+')}`, quote: run.quoteCredits, captured: run.spentCredits, minutes: 0, error: null })
}

describe.skipIf(process.env.SOAK_ENGINES === '0')('every engine in every base pipeline that can use it, and mixed', () => {
  for (const baseId of BASE_IDS) {
    for (const { brick, family } of paidBricks(baseId)) {
      for (const engine of enginesOfFamily(family)) {
        it(`${baseId} · ${brick} on ${engine}`, () => cleanRun(baseId, pinned(brick, engine), { [brick]: engine }))
      }
    }
    for (let i = 0; i < Math.max(0, Number(process.env.SOAK_MIXED ?? 1)); i++) {
      it(`${baseId} · mixed #${i + 1}`, () => {
        const rnd = seeded(SEED + 104_729 + i)
        const expected: Record<string, string> = {}
        const ops = paidBricks(baseId).flatMap(({ brick, family }) => {
          const all = enginesOfFamily(family)
          const engine = all[Math.floor(rnd() * all.length)] as string
          expected[brick] = engine
          return pinned(brick, engine)
        })
        return cleanRun(baseId, ops, expected)
      })
    }
  }
})
