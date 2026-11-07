// The simulated team VPS (vps-rendu, decision 0084): the brain's core (the same `createCore` the headless brain runs), an
// in-process Atelier Cloud on stand-in engines (free, no network), and real productions launched « Moteur réel » to their end,
// measured step by step: each node's wall time and the box's peak memory while it ran. Run inside the 4 vCPU / 8 GB box by
// `node scripts/vps-sim.mjs`; the results go to VPS_OUT (one JSON line per run, plus one per batch).
//   VPS_BASES    base pipelines, comma-separated (default avatar@1,documentary@2,pov@1,story-short@1)
//   VPS_N        productions launched at once per batch (default 1: one after the other, each alone)
//   VPS_MINUTES  minutes of each film (default 1)
//   VPS_REMOTE   off (default: the box renders) | fake (renders go to the fake remote worker) | fake-down (the remote fails:
//                every render falls back to the box) | capture (each kind of render job written to VPS_CAPTURE for
//                `npm run cloud -- render try`, then made by the box)
import { appendFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import type { RunDetail } from '../../src/shared/runs'
import { bench, project, SCRIPT, toEnd, type Bench } from '../unit/pipeline-bench'
import { oomKills, startBoxMeter } from './box-meter'
import type { RemoteRig } from './remote-rig'

const BASES = (process.env.VPS_BASES ?? 'avatar@1,documentary@2,pov@1,story-short@1').split(',').map((s) => s.trim()).filter(Boolean)
const N = Math.max(1, Number(process.env.VPS_N ?? 1))
const MINUTES = Number(process.env.VPS_MINUTES ?? 1)
const REMOTE = (process.env.VPS_REMOTE ?? 'off') as 'off' | 'fake' | 'fake-down' | 'capture'
const OUT = process.env.VPS_OUT
/** `raised`: the Cloud's per-account limits (300 requests and 20 media searches a minute) lifted, to see the VPS and the renders
 *  past them; default: today's limits. */
const LIMITS = process.env.VPS_CLOUD_LIMITS === 'raised' ? { server: { requestsPerMinute: 100_000, media: { perMinute: 10_000 } } } : null

const meter = startBoxMeter()
const lines: string[] = []
function record(o: Record<string, unknown>): void {
  const line = JSON.stringify(o)
  lines.push(line)
  if (OUT) appendFileSync(OUT, `${line}\n`)
}
afterAll(() => {
  meter.stop()
  process.stdout.write(`\nVPS box: ${meter.scope}, ${meter.cpus ?? '?'} CPU, limit ${meter.limitMB ?? '?'} MB, remote ${REMOTE}, N=${N}\n`)
  for (const l of lines) process.stdout.write(`${l}\n`)
})

const ms = (iso: string | null): number | null => (iso ? Date.parse(iso) : null)

/** One finished run, measured: each node's wall and the box's peak memory while it ran. */
function measure(run: RunDetail, t0: number, t1: number, base: string, batch: string): Record<string, unknown> {
  const steps = run.nodes
    .map((n) => {
      const a = ms(n.startedAt)
      const b = ms(n.finishedAt)
      return a !== null && b !== null ? { node: n.nodeId, type: n.type, state: n.state, wallS: +((b - a) / 1000).toFixed(1), peakMB: meter.peakMB(a, b) } : { node: n.nodeId, type: n.type, state: n.state, wallS: null, peakMB: null }
    })
    .filter((s) => s.wallS !== null && s.wallS >= 0.5)
    .sort((x, y) => (y.wallS ?? 0) - (x.wallS ?? 0))
  return {
    kind: 'run',
    batch,
    base,
    remote: REMOTE,
    status: run.status,
    error: run.error,
    failures: run.nodes.filter((n) => n.error).map((n) => ({ node: n.nodeId, code: n.error?.code, detail: (n.error?.detail ?? n.error?.message ?? '').slice(0, 300) })),
    wallS: +((t1 - t0) / 1000).toFixed(1),
    peakMB: meter.peakMB(t0, t1),
    cpuS: +meter.cpuS(t0, t1).toFixed(0),
    steps
  }
}

describe(`simulated team VPS (N=${N}, remote ${REMOTE})`, () => {
  it(`productions on ${BASES.join(', ')}`, async () => {
    let rig: RemoteRig | null = null
    let b: Bench | null = null
    try {
      rig = REMOTE === 'off' ? null : await (await import('./remote-rig')).remoteSetup({ down: REMOTE === 'fake-down', ...(REMOTE === 'capture' ? { capture: process.env.VPS_CAPTURE ?? '/out/bundles' } : {}) })
      b = await bench({ ...(rig ? { remoteRender: rig.options } : {}), ...(LIMITS ? { cloudOptions: LIMITS } : {}) })
      const app = b.app
      const api = app.core.api
      // N productions at once (round robin over the bases); N=1 = each base alone, one after the other
      const batches: string[][] = N === 1 ? BASES.map((x) => [x]) : [Array.from({ length: N }, (_, i) => BASES[i % BASES.length] as string)]
      for (const [k, batch] of batches.entries()) {
        const label = `${k + 1}:${batch.join('+')}`
        const ids = []
        // each production its own video (its own script, so its own Cloud jobs), as N different videos of one team
        for (const [i, base] of batch.entries()) ids.push(await project(app, base, { minutes: MINUTES, title: `Le ciel, vidéo ${k + 1}.${i + 1}`, script: `${SCRIPT} Ceci est la vidéo numéro ${k + 1}.${i + 1} de la chaîne.` }))
        const t0 = Date.now()
        const results = await Promise.all(
          ids.map(async (id, i) => {
            const runId = (await api['projects.run'](id, { real: true })).runId as number
            const run = await toEnd(app, runId, 3_000_000)
            const t1 = Date.now()
            const m = measure(run, t0, t1, batch[i] as string, label)
            record(m)
            return m
          })
        )
        const t1 = Date.now()
        const jobs = rig?.ledger.splice(0) ?? []
        record({
          kind: 'batch',
          batch: label,
          n: batch.length,
          remote: REMOTE,
          cloudLimits: LIMITS ? 'raised' : 'today',
          succeeded: results.filter((r) => r.status === 'succeeded').length,
          wallS: +((t1 - t0) / 1000).toFixed(1),
          peakMB: meter.peakMB(t0, t1),
          cpuS: +meter.cpuS(t0, t1).toFixed(0),
          oomKills: oomKills(),
          minutesMade: results.filter((r) => r.status === 'succeeded').length * MINUTES,
          remoteJobs: jobs.length,
          remoteFellBack: jobs.filter((j) => j.backend === 'local').length,
          remoteCostEur: +jobs.reduce((s, j) => s + j.costEur, 0).toFixed(5),
          remoteBilledS: +jobs.reduce((s, j) => s + j.billedS, 0).toFixed(1),
          remoteMaxQueueS: +Math.max(0, ...jobs.map((j) => j.queuedS)).toFixed(1)
        })
        for (const r of results) expect(r.status, `${String(r.base)}: ${String(r.error)}`).toBe('succeeded')
      }
    } finally {
      await b?.close()
      await rig?.close()
    }
  })
})
