// solidite, « prices hold »: every base pipeline launched for real on an in-process Cloud (nothing paid: the engines'
// stand-ins answer with fake media and bill their declared prices, so the Cloud captures at cost as on the beta). What the
// Cloud captured from the team (its own ledger) equals what the run shows, the run holds itself to the quote the owner saw,
// and its spend stays within CAPTURE_TOLERANCE of it (× 1.25 + 5 credits). Past that line a real run stops at once with
// the reason. A brick that names its engine is quoted on that engine's price, not its family's default.
import { afterEach, describe, expect, it } from 'vitest'
import { captureCeiling, CAPTURE_TOLERANCE } from '../../src/main/production/runs/cloud'
import { pricesFor } from '../../src/main/production/runs/quote'
import { creditsForUnits } from '../../src/main/credits/prices'
import { BASE_IDS, bench, cloudCaptured, cloudJobs, project, toEnd, type Bench } from './pipeline-bench'

const benches: Bench[] = []
afterEach(async () => {
  while (benches.length) await benches.pop()?.close()
}, 60_000)

describe('quote vs capture, every base pipeline', () => {
  for (const baseId of BASE_IDS) {
    it(`${baseId}: the Cloud captures what the run shows, within ${CAPTURE_TOLERANCE.factor}× its quote`, { timeout: 300_000 }, async () => {
      const b = await bench()
      benches.push(b)
      const api = b.app.core.api
      const id = await project(b.app, baseId)
      const quote = await api['projects.quote'](id, { real: true })
      expect(quote.demo).toBe(false)
      const run = await toEnd(b.app, (await api['projects.run'](id, { real: true })).runId as number)
      expect(run.error, JSON.stringify(run.nodes.filter((n) => n.error).map((n) => [n.nodeId, n.error]))).toBeNull()
      expect(run.status).toBe('succeeded')
      await b.rig.t.cloud.jobs.whenIdle()
      // the Cloud took exactly what the run shows: no capture the app does not know of
      expect(cloudCaptured(b.rig)).toBe(run.spentCredits)
      expect(cloudJobs(b.rig).every((j) => j.state === 'succeeded')).toBe(true)
      // and stays within the stated tolerance of the quote the owner saw
      expect(run.quoteCredits).toBe(quote.modes[run.budgetMode].totalCredits)
      expect(run.spentCredits).toBeLessThanOrEqual(captureCeiling(run.quoteCredits))
    })
  }

  it('a real run whose captures pass its quote’s ceiling stops at once with the reason', { timeout: 300_000 }, async () => {
    const b = await bench()
    benches.push(b)
    const api = b.app.core.api
    const id = await project(b.app, 'avatar@1')
    const launched = await api['projects.run'](id, { real: true })
    const runId = launched.runId as number
    // the quote the run holds itself to, made tiny: the first captured job crosses the line
    b.app.core.db.prepare('UPDATE video_runs SET quote_credits = 0 WHERE id = ?').run(runId)
    const run = await toEnd(b.app, runId)
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/arrêtée pour tenir le prix annoncé/)
    expect(run.error).toMatch(/a déjà pris \d+ crédits pour un devis de 0\./)
    expect(run.spentCredits).toBeGreaterThan(captureCeiling(0))
    await b.rig.t.cloud.jobs.whenIdle()
    expect(b.rig.t.cloud.wallet.state(b.rig.teamId).held).toBe(0)
  })
})

describe('a wallet that fits the quote runs the whole video (reserve-devis, issue #89, decision 0107)', () => {
  it('avatar@1 with just the quote’s ceiling in the wallet: no step is refused for the grid line’s worst case', { timeout: 300_000 }, async () => {
    const b = await bench()
    benches.push(b)
    const api = b.app.core.api
    const id = await project(b.app, 'avatar@1')
    const quote = await api['projects.quote'](id, { real: true })
    const credits = quote.modes.usage_max.totalCredits
    // leave the wallet at the ceiling of the quote the owner saw (the 311-credit quote against 395 credits of 2026-11-04)
    const ledger = b.rig.t.cloud.wallet as unknown as { adjust(p: { teamId: string; credits: number; idemKey: string; actor: string }): unknown; state(id: string): { balance: number } }
    const have = ledger.state(b.rig.teamId).balance
    ledger.adjust({ teamId: b.rig.teamId, credits: captureCeiling(credits) - have, idemKey: 'fit-the-quote', actor: 'test' })
    const launched = await api['projects.run'](id, { real: true })
    const run = await toEnd(b.app, launched.runId as number)
    expect(run.error, JSON.stringify(run.nodes.filter((n) => n.error).map((n) => [n.nodeId, n.error]))).toBeNull()
    expect(run.status).toBe('succeeded')
    await b.rig.t.cloud.jobs.whenIdle()
    expect(b.rig.t.cloud.wallet.state(b.rig.teamId).balance).toBeGreaterThanOrEqual(0)
  })
})

describe('a quote says when an engine it relies on is down (key or access refused)', () => {
  it('names the step and the engine before anything is spent', { timeout: 120_000 }, async () => {
    const b = await bench()
    benches.push(b)
    const api = b.app.core.api
    const id = await project(b.app, 'voiceover@1')
    expect((await api['projects.quote'](id, { real: true })).modes.usage_max.warnings).toBeUndefined()
    ;(b.rig.t.cloud as unknown as { providerAlerts: { set(p: string, m: string): void } }).providerAlerts.set('voice:ai33', 'Clé ou accès refusé (synthesize) : HTTP 403')
    const q = await api['projects.quote'](id, { real: true })
    expect(q.modes.usage_max.warnings).toEqual([expect.stringMatching(/le moteur voice:ai33 est en panne/)])
  })
})

describe('a brick that names its engine is quoted on it', () => {
  it('uses the named engine’s price, else the family default', () => {
    const prices = { video_s: 2, byEngine: { 'clip:grok-imagine-15-lite': { video_s: 1.6 }, 'clip:veo31-lite-vertex': { video_s: 3 } } }
    const units = [{ unit: 'video_s' as const, qty: 30 }]
    expect(creditsForUnits(units, 'video', pricesFor({ engine: 'clip:veo31-lite-vertex' }, prices))).toBe(90)
    expect(creditsForUnits(units, 'video', pricesFor({ engine: 'clip:grok-imagine-15-lite' }, prices))).toBe(48)
    expect(creditsForUnits(units, 'video', pricesFor({}, prices))).toBe(60)
    expect(creditsForUnits(units, 'video', pricesFor({ engine: '$style.clipEngine' }, prices))).toBe(60)
  })
})
