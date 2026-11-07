// reserve-devis (issue #89, decision 0107): a step reserves what ITS quote line says, for the engine it names, never the
// grid line's worst case. The exact case of 2026-11-04: a 3-minute Marcel run quoted 311 credits, a wallet of 395, and the
// « Clips » step asking 619 (the grid line of generated video) → « Crédits insuffisants ». On an in-process Cloud (fakes,
// nothing paid) the step now reserves its engine's price and the run goes on; the run's reservations never pass its quote
// ceiling and the wallet is never exceeded.
import { afterEach, describe, expect, it } from 'vitest'
import { cloudCaller } from '../../src/engine/cloud-http'
import { CreditSpender, engineOfUnit } from '../../src/main/production/credits'
import { captureCeiling } from '../../src/main/production/runs/cloud'
import { cloudHelpers, startCloud, type CloudRig } from './cloud-app-helpers'

const rigs: CloudRig[] = []
afterEach(async () => {
  while (rigs.length) await rigs.pop()?.t.cloud.jobs.whenIdle()
})

/** An in-process Cloud with a wallet of `credits`, and the app's caller signed in to it. */
async function rig(credits: number) {
  const r = await startCloud(0)
  rigs.push(r)
  const who = await cloudHelpers.signUpAndIn(r.t, { credits })
  const caller = cloudCaller({ baseUrl: r.baseUrl, token: () => who.accessToken })
  return { r, who, caller, teamId: who.teamId }
}

/** The « Clips » step of a 3-minute avatar run: ~54 s of generated clips on the default clip engine (a Marcel-shaped estimate). */
const clips = { runId: 'r', nodeId: 'clips', idempotencyKey: 'k-clips', estimate: { units: [{ unit: 'video_s' as const, qty: 54 }], provider: 'video', durationS: 1 }, params: { engine: 'clip:veo31-lite-relaxed' } }

describe('a step reserves its engine’s price, not the grid line’s worst case', () => {
  it('prices every unit on the engine the node names, else the family default (as the run’s quote does)', () => {
    expect(engineOfUnit('video_s', { engine: 'clip:wan22' })).toBe('clip:wan22')
    expect(engineOfUnit('video_s', {})).toBe('clip:veo31-lite-relaxed')
    // an image engine named on a node does not price its clip seconds
    expect(engineOfUnit('video_s', { engine: 'image:flux-schnell' })).toBe('clip:veo31-lite-relaxed')
    expect(engineOfUnit('images', { engine: 'image:flux-schnell' })).toBe('image:flux-schnell')
    expect(engineOfUnit('images', undefined)).toBe('image:gpt-image-25-low')
    expect(engineOfUnit('chars', { engine: 'not-an-engine' })).toBe('voice:ai33')
    expect(engineOfUnit('searches', {})).toBeUndefined()
  })

  it('the case of 2026-11-04: a 311-credit run with a 395-credit wallet is no longer blocked at « Clips »', async () => {
    const { caller, r, teamId } = await rig(395)
    // what the old step asked: the grid line of generated video, 54 s × the line
    const grid = await caller.call('POST', '/v1/estimates', (await import('../../src/shared/cloud-api')).EstimateResponse, new AbortController().signal, { items: [{ key: 'a', usage: 'generateVideo', quantity: 54 }] })
    const onEngine = await caller.call('POST', '/v1/estimates', (await import('../../src/shared/cloud-api')).EstimateResponse, new AbortController().signal, { items: [{ key: 'a', usage: 'generateVideo', quantity: 54, engine: 'clip:veo31-lite-relaxed' }] })
    expect(onEngine.totalCredits).toBeLessThan(grid.totalCredits / 2)
    // the run: quote 311, ceiling 395 ≈ ceil(311 × 1.25) + 5; 150 credits already spent by the voice and the presenter
    const quote = 311
    const spender = new CreditSpender({ caller, run: { ceilingCredits: captureCeiling(quote), spentCredits: 150 } })
    const reservation = await spender.reserve(clips)
    expect(spender.committed()).toBe(onEngine.totalCredits)
    await reservation.settle({ units: [{ unit: 'video_s', qty: 54 }], provider: 'video' })
    expect(r.t.cloud.wallet.state(teamId).available).toBeGreaterThanOrEqual(0)
  })

  it('the old behaviour would have refused it: the grid line’s price of that step is more than the wallet', async () => {
    const { caller } = await rig(100)
    // no engine named on a unit the grid prices: still the grid line (searches have no engine)
    const refused = new CreditSpender({ caller })
    await expect(refused.reserve({ ...clips, estimate: { units: [{ unit: 'video_s', qty: 54 }], provider: 'video', durationS: 1 }, params: { engine: 'clip:veo31-fast' } })).rejects.toMatchObject({
      code: 'budget',
      message: expect.stringMatching(/Crédits insuffisants pour cette étape : il en faut ≈ \d+, il en reste 100/)
    })
  })
})

describe('guards', () => {
  it('the total a run reserves never exceeds its quote ceiling, counting what it already spent', async () => {
    const { caller } = await rig(10_000)
    const step = (n: number) => ({ ...clips, nodeId: `clips-${n}`, idempotencyKey: `k${n}` })
    const one = (await caller.call('POST', '/v1/estimates', (await import('../../src/shared/cloud-api')).EstimateResponse, new AbortController().signal, { items: [{ key: 'a', usage: 'generateVideo', quantity: 54, engine: 'clip:veo31-lite-relaxed' }] })).totalCredits
    const ceiling = one * 2 + 3
    const s = new CreditSpender({ caller, run: { ceilingCredits: ceiling, spentCredits: 2 } })
    const a = await s.reserve(step(1))
    await s.reserve(step(2))
    await expect(s.reserve(step(3))).rejects.toMatchObject({ code: 'budget', message: expect.stringMatching(/plafond du devis de cette fabrication/) })
    // a released step gives its room back
    await a.release()
    await s.reserve(step(4))
    expect(2 + s.committed()).toBeLessThanOrEqual(ceiling)
  })

  it('the wallet is never exceeded: a step dearer than what is left is refused, whatever the quote says', async () => {
    const { caller, r, teamId } = await rig(30)
    const s = new CreditSpender({ caller, run: { ceilingCredits: 100_000, spentCredits: 0 } })
    await expect(s.reserve(clips)).rejects.toMatchObject({ code: 'budget', message: expect.stringMatching(/Crédits insuffisants pour cette étape/) })
    expect(r.t.cloud.wallet.state(teamId).balance).toBe(30)
  })

  it('without a run ceiling (a retest outside a run) only the video cap and the wallet apply, as before', async () => {
    const { caller } = await rig(10_000)
    const s = new CreditSpender({ caller })
    await s.reserve(clips)
    expect(s.committed()).toBeGreaterThan(0)
  })
})
