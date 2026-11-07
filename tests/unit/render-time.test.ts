// The duration model (pipeline-ui): the average render time of a pipeline, per video length, from the engines' timings
// (src/shared/render-times.ts) the way the cost model prices them. Checked against the real runs: a 1-minute avatar hook took
// ≈ 4 min of assets by hand (Veo relaxed 73 s a clip in parallel, HeyGen 99 s), so the app's run, which writes first and then
// makes the presenter and the pictures at once, lands at a few minutes; it grows with the length; slower engines take longer.
import { describe, expect, it } from 'vitest'
import { avatarBase, fromBase, technologyRegistry, voiceoverBase, type RecipeDoc } from '../../src/engine/technologies'
import { renderSteps, renderTime, timingOf, wallSeconds } from '../../src/main/production/estimates/duration'
import { ENGINE_TIMINGS } from '../../src/shared/render-times'
import { EstimatesService } from '../../src/main/production/estimates'
import type { RecipeDocument } from '../../src/shared/api'
import { memoryCore } from './helpers'

const reg = technologyRegistry()
const avatar = (): RecipeDoc => fromBase(avatarBase)

describe('render time', () => {
  it('takes the measured timings from data: Veo relaxed 73 s a clip, 8 at once; HeyGen 99 s', () => {
    expect(ENGINE_TIMINGS['clip:veo31-lite-relaxed']).toMatchObject({ secondsPerCall: 73, source: 'measured' })
    expect(ENGINE_TIMINGS['presenter:heygen-mcp']).toMatchObject({ secondsPerCall: 99, source: 'measured' })
    expect(wallSeconds(7, timingOf('clip:veo31-lite-relaxed', 'clip'))).toBe(73)
    expect(wallSeconds(9, timingOf('clip:veo31-lite-relaxed', 'clip'))).toBe(146)
    expect(wallSeconds(0, timingOf(null, 'clip'))).toBe(0)
    // an engine no run measured takes its family's default
    expect(timingOf('clip:some-new-model', 'clip').source).toBe('estimate')
  })

  it('a 1-minute avatar hook: about 4 min of assets measured, a few minutes in the app', () => {
    const steps = renderSteps(avatar(), reg, 1)!
    // presenter and pictures at once: about the HeyGen call, not the sum the hand-made hook took
    expect(steps.assets).toBeGreaterThanOrEqual(73)
    expect(steps.assets).toBeLessThanOrEqual(240)
    const r = renderTime(avatar(), reg, 1)!
    expect(r.seconds.avg).toBeGreaterThan(3 * 60)
    expect(r.seconds.avg).toBeLessThan(10 * 60)
    expect(r.seconds.min).toBeLessThan(r.seconds.avg)
    expect(r.seconds.max).toBeGreaterThan(r.seconds.avg)
  })

  it('grows with the length of the video', () => {
    const times = [1, 5, 10, 20].map((m) => renderTime(avatar(), reg, m)!.seconds.avg)
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!)
  })

  it('a slower clip engine (quality « premium ») and more clips take longer; no presenter, no presenter wait', () => {
    const base = renderTime(avatar(), reg, 10)!.seconds.avg
    const premium = renderTime({ ...avatar(), options: { 'quality.clips': 'premium' } }, reg, 10)!.seconds.avg
    expect(premium).toBeGreaterThan(base)
    const voiceover = renderSteps(fromBase(voiceoverBase), reg, 10)!
    expect(voiceover.assets).toBeGreaterThan(0)
    expect(renderTime(fromBase(voiceoverBase), reg, 10)!.seconds.avg).toBeGreaterThan(0)
  })

  it('the estimates show it per length, even with no price known, and on the cards', async () => {
    const core = memoryCore()
    const ctx = core.context
    const s = new EstimatesService({ db: core.db, settings: ctx.settings, prices: ctx.prices, routes: ctx.routes, liveEngines: () => Promise.resolve(null) })
    const doc = avatar()
    const v = await s.pipeline(doc as unknown as RecipeDocument)
    expect(v.available).toBe(false)
    expect(v.renderTimes.map((r) => r.minutes)).toEqual([doc.format.minutes, ...[1, 5, 10, 20].filter((m) => m !== doc.format.minutes)])
    const cards = await s.cards()
    expect(cards.bases['avatar@1']?.renderTime?.minutes).toBe(avatarBase.doc.format.minutes)
    expect(cards.bases['avatar@1']?.renderTime?.seconds.avg).toBeGreaterThan(0)
  })
})
