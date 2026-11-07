// solidite: one demo item never marks a real film « DÉMO ». On a Cloud whose paid calls are on, a job answered in demo
// (its engine not served for real: key missing, not enabled) is refused by the app: the brick tries its next engine,
// then its gap, or the run fails with the reason; the film is never mixed. A Cloud whose paid calls are off answers every
// job in demo: that whole run is a demo, as before (tests/unit/real-runs.test.ts). Stand-in engines, nothing paid.
import { afterEach, describe, expect, it } from 'vitest'
import { bench, project, toEnd, type Bench } from './pipeline-bench'

const benches: Bench[] = []
afterEach(async () => {
  while (benches.length) await benches.pop()?.close()
}, 60_000)

describe('a demo answer in a real run', () => {
  it('every engine served for real: the film is real, no demo item anywhere', { timeout: 300_000 }, async () => {
    const b = await bench()
    benches.push(b)
    const api = b.app.core.api
    const run = await toEnd(b.app, (await api['projects.run'](await project(b.app, 'voiceover@1'), { real: true })).runId as number)
    expect(run.status).toBe('succeeded')
    expect(run.demo).toBe(false)
    for (const n of run.nodes) for (const e of n.engines) expect(e.real, `${n.nodeId}: ${e.id}`).toBe(true)
    const video = await api['production.output'](run.id, 'render')
    expect((video as { demo?: boolean }).demo).toBe(false)
  })

  it('the voice answered in demo is refused: the run stops with the reason, nothing marked DÉMO', { timeout: 300_000 }, async () => {
    const b = await bench({ without: ['voice:'] })
    benches.push(b)
    const api = b.app.core.api
    const run = await toEnd(b.app, (await api['projects.run'](await project(b.app, 'voiceover@1'), { real: true })).runId as number)
    expect(run.status).toBe('failed')
    const voice = run.nodes.find((n) => n.nodeId === 'voice')
    expect(voice?.state).toBe('error')
    expect(JSON.stringify(voice?.error)).toMatch(/La voix : Atelier Cloud a répondu en démo pendant une fabrication réelle/)
    expect(run.videoFileRef).toBeNull()
    // the demo answer cost nothing
    await b.rig.t.cloud.jobs.whenIdle()
    expect(b.rig.t.cloud.wallet.state(b.rig.teamId).held).toBe(0)
  })
})
