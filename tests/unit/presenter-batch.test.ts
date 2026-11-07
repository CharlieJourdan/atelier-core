// production-7, « one generation, then cut » (pipeline-avatar §2.5 b, decision 0034): on the 12-minute French narration
// directed by the mix director (production-6) at the avatar-mix preset, the presenter is generated in as few calls as the
// engine allows, about 17.5 s per finished minute at a 26 % share (Headcast generates ≈ 24 s), and every cut lands on a word
// boundary. Also: joining, packing at the engine's limit, handles inside the voice, angles in their own calls, framings.
import { describe, expect, it } from 'vitest'
import { FPS, type Word } from '../../src/engine/formats/timing'
import type { GenList } from '../../src/engine/formats/editplan'
import { cutBefore } from '../../src/engine/nodes/director-mix'
import { directorPlan } from '../../src/engine/nodes/director-plan'
import type { DirectorParams } from '../../src/engine/nodes/director-cuts'
import { BATCH_DEFAULTS, CONTINUOUS_BRIDGE_S, planBatches, type PresenterShot } from '../../src/engine/presenter/batch'
import { art, makeCtx } from './engine-node-helpers'
import { makeFrenchFilm } from './film-fixture-fr12'

const FILM = makeFrenchFilm(720)
const D = FILM.durationS

async function presenterShots(mix: Record<string, unknown>): Promise<PresenterShot[]> {
  const params = directorPlan.params.parse({ avatar: { segments: ['hook', 'outro'], layout: 'full' }, screen: { mix } }) as DirectorParams
  const out = await directorPlan.fake(makeCtx({}), {
    beats: art('json.beats', { value: FILM.beats as never }),
    words: art('json.words', { value: FILM.words as never, meta: { durationS: D, alignment: 'provider', matched: 1, language: 'fr' } }),
    outline: art('json.outline', { value: FILM.outline as never })
  }, params)
  const list = out.genlist?.value as unknown as GenList
  return list.items.filter((i) => i.kind === 'avatar' && i.voiceRange).map((i) => ({ id: i.id, startS: (i.voiceRange?.startFrame ?? 0) / FPS, endS: (i.voiceRange?.endFrame ?? 0) / FPS }))
}

/**
 * A cut is on a word boundary when it is the cut of the boundary between two words: 3 frames before the next word (R21.2,
 * decision 0031: the cut anticipates the word, so the mouth never starts late), never later than the next word, never more
 * than those 3 frames into the word before it; or the start or the end of the voice.
 */
const BOUNDARIES = new Set([0, ...FILM.words.map((_w, k) => cutBefore(FILM.words, k)).filter((t) => t > 0)].map((t) => Math.round(t * FPS)))
function onWordBoundary(words: readonly Word[], t: number): boolean {
  if (t <= 1e-6 || t >= D - 1e-6) return true
  const k = words.findIndex((w) => w.start >= t - 1e-6)
  const next = words[k]
  const prev = words[k - 1]
  if (!next) return false
  // 3 frames and the half frame the cut is rounded by
  const lead = 3.5 / FPS + 1e-6
  return BOUNDARIES.has(Math.round(t * FPS)) && next.start - t <= lead && (!prev || prev.end - t <= lead)
}

describe('presenter: one generation, then cut', () => {
  it('generates ≈ 17.5 s per finished minute at a 26 % share, in few calls, every cut on a word boundary', async () => {
    const shots = await presenterShots({ presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' })
    expect(shots.length).toBeGreaterThan(30)
    const plan = planBatches(shots, { ...BATCH_DEFAULTS, maxCallS: 60, voiceS: D })
    const minutes = D / 60
    const perMin = plan.generatedS / minutes
    const share = plan.shownS / D
    console.log(`shots ${shots.length}, stretches ${plan.stretches.length}, calls ${plan.calls.length}, shown ${plan.shownS.toFixed(1)} s (${(share * 100).toFixed(1)} %), generated ${plan.generatedS.toFixed(1)} s = ${perMin.toFixed(2)} s/min; one clip per shot with 2×0.2 s margins would be ${(plan.shownS + shots.length * 0.4) / minutes} s/min`)
    expect(share).toBeGreaterThan(0.24)
    expect(share).toBeLessThan(0.28)
    expect(perMin).toBeGreaterThan(16.5)
    expect(perMin).toBeLessThan(18.5)
    // every cut of a shot (its start and its end on the voice) is between words
    for (const s of shots) {
      expect(onWordBoundary(FILM.words, s.startS), `${s.id} starts inside a word at ${s.startS}`).toBe(true)
      expect(onWordBoundary(FILM.words, s.endS), `${s.id} ends inside a word at ${s.endS}`).toBe(true)
    }
    // the cut finds the shot's own audio: same voice time at the same offset in the generated video
    for (const c of plan.cuts) {
      const shot = shots.find((s) => s.id === c.shotId) as PresenterShot
      const call = plan.calls[c.call]
      const piece = call?.pieces.find((p) => p.atS <= c.offsetS + 1e-6 && c.offsetS + c.durationS <= p.atS + (p.toS - p.fromS) + 1e-6)
      expect(piece, c.shotId).toBeDefined()
      expect(Math.abs((piece?.fromS ?? 0) + (c.offsetS - (piece?.atS ?? 0)) - shot.startS)).toBeLessThan(1e-3)
    }
    for (const call of plan.calls) expect(call.seconds).toBeLessThanOrEqual(60 + 1e-9)
    // as few calls as the engine's limit allows: never two calls whose stretches would have fitted in one
    expect(plan.calls.length).toBeLessThanOrEqual(Math.ceil(plan.generatedS / 55))
  })
})

describe('presenter: « continuous » generation (production-10, the base of the cost ladder)', () => {
  it('also generates the short cutaways between presenter shots: more seconds than once-then-cut, the cuts still on the shots', async () => {
    const shots = await presenterShots({ presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' })
    const cut = planBatches(shots, { ...BATCH_DEFAULTS, maxCallS: 180, voiceS: D })
    const continuous = planBatches(shots, { ...BATCH_DEFAULTS, maxCallS: 180, voiceS: D, bridgeS: CONTINUOUS_BRIDGE_S })
    const perMin = (p: typeof cut): number => p.generatedS / (D / 60)
    console.log(`continuous: ${perMin(continuous).toFixed(2)} s/min in ${continuous.stretches.length} stretches; cut: ${perMin(cut).toFixed(2)} s/min in ${cut.stretches.length}`)
    expect(continuous.stretches.length).toBeLessThan(cut.stretches.length)
    expect(perMin(continuous)).toBeGreaterThan(perMin(cut) + 2)
    // the estimator's « continuous » ratio (23.9 s a minute, measured before avatar-qualite put the presenter on the talk
    // sentences) is a ceiling: the cutaways are fewer now (≈ 20.7 s a minute on this film), never more
    expect(perMin(continuous)).toBeLessThanOrEqual(23.9 + 1e-9)
    expect(perMin(continuous)).toBeGreaterThan(23.9 - 4)
    expect(continuous.shownS).toBeCloseTo(cut.shownS, 6)
    // a bridged cutaway is never longer than the bridge, and every shot is still cut on its own audio
    for (const st of continuous.stretches) expect(st.toS - st.fromS).toBeLessThanOrEqual(180 + 1e-9)
    for (const c of continuous.cuts) {
      const shot = shots.find((s) => s.id === c.shotId) as PresenterShot
      const piece = continuous.calls[c.call]?.pieces.find((p) => p.atS <= c.offsetS + 1e-6 && c.offsetS + c.durationS <= p.atS + (p.toS - p.fromS) + 1e-6)
      expect(Math.abs((piece?.fromS ?? 0) + (c.offsetS - (piece?.atS ?? 0)) - shot.startS)).toBeLessThan(1e-3)
    }
  })
})
