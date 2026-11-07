// Lot Z1 (analysis): the reproducibility gauge of PLAN-V2-PRODUCTION §2.3, checked against hand computations.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { findReference, patternShares, timelineFor, REFERENCES, PATTERN_SECONDS } from '../../src/main/analysis/references'
import {
  CAPABILITY_MATRIX,
  COMPONENT_IDS,
  computeGauge,
  scoreOf,
  segmentTone,
  tierOf,
  type CapabilityMatrix,
  type ComponentId,
  type GaugeProfile,
  type GaugeState
} from '../../src/shared/gauge'

const profileOf = (id: string): GaugeProfile => {
  const r = findReference(id)
  if (!r) throw new Error(id)
  const n = r.profile.notes
  return { components: patternShares(r), voice: n.voice, script: n.script, edit: n.edit, analystConfidence: r.profile.analystConfidence }
}
const UM: GaugeState = { mode: 'usage_max', answers: {}, replace: {} }
const QM: GaugeState = { mode: 'qualite_max', answers: {}, replace: {} }

describe('reference channels: hand computations', () => {
  it('every pattern lasts exactly 600 s', () => {
    for (const r of REFERENCES) expect(r.pattern.reduce((s, p) => s + p.seconds, 0)).toBe(PATTERN_SECONDS)
  })

  it('Archives Silencieuses (documentaire sans visage) = 85', () => {
    // shares: stock 300/600 = .50, ai_image 150/600 = .25, text_anim .10, ai_video .10, clip .05 (< .20: L = 1)
    // Usage max: Σ = .50×.9 + .25×.9 + .10×.9 + .10×.4 + .05×0 = .45 + .225 + .09 + .04 = .805
    // confidence high (k = 1): V = .805
    // G = 100 × 1 × (.55×.805 + .15×.95 + .15×.9 + .15×.85) = 100 × (.44275 + .405) = 84.775 → 85
    const p = profileOf('archives-silencieuses')
    const g = computeGauge(p, UM)
    expect(g.score).toBe(85)
    expect(g.v).toBeCloseTo(0.805, 10)
    expect(g.l).toBe(1)
    expect(g.tier).toBe('reproductible')
    expect(g.confidence).toBe('high')
    // Qualité max: ai_video .75 → Σ = .84 → 100 × (.462 + .405) = 86.7 → 87
    expect(g.perMode).toEqual({ qualite_max: 87, usage_max: 85 })
    expect(g.inputsEffect).toEqual([])
    expect(g.supportSuggested).toBe(false)
  })

  it('Récits Manette (histoires texte sur gameplay) = 34, then 62 once the user has gameplay', () => {
    // shares: gameplay 330/600 = .55, cartoon 240/600 = .40, text_anim 30/600 = .05
    // unanswered, Usage max: Σ = .55×0 + .40×.2 + .05×.9 = .125 ; k = 1 → V = .125
    // G = 100 × (.55×.125 + .15×(.95 + .55 + .28)) = 100 × (.06875 + .267) = 33.575 → 34
    const p = profileOf('recits-manette')
    const before = computeGauge(p, UM)
    expect(before.score).toBe(34)
    expect(before.tier).toBe('partiel')
    expect(before.confidence).toBe('medium') // a question is open
    // « oui » : gameplay .95 → Σ = .125 + .55×.95 = .6475 → 100 × (.356125 + .267) = 62.3125 → 62
    const yes = computeGauge(p, { ...UM, answers: { gameplay: true } })
    expect(yes.score).toBe(62)
    expect(yes.tier).toBe('adaptations')
    expect(yes.confidence).toBe('high')
    // « non » : replaced by stock in Usage max at half fidelity: .55 × .9 × .5 = .2475 → Σ = .3725
    // → 100 × (.204875 + .267) = 47.1875 → 47
    expect(computeGauge(p, { ...UM, answers: { gameplay: false } }).score).toBe(47)
    // Qualité max, unanswered: cartoon .4 → Σ = .16 + .045 = .205 → 100 × (.11275 + .267) = 37.975 → 38
    expect(before.perMode).toEqual({ qualite_max: 38, usage_max: 34 })
    // effect of the input, as shown under the gauge (« Avec ton gameplay : 62 · sans : 47 »)
    expect(before.inputsEffect).toEqual([{ input: 'gameplay', with: 62, without: 47 }])
    expect(before.adaptations[0]).toEqual({ kind: 'input', input: 'gameplay', score: 62 })
  })

  it('Top Dix Animé (top 10 en animations) = 77, 80 in Qualité max', () => {
    // shares: text_anim 180/600 = .30, ai_image .25, stock .20, cartoon .15, ai_video .10
    // Usage max: Σ = .27 + .225 + .18 + .15×.2 + .10×.4 = .745
    // confidence medium (k = .85): V = .85×.745 + .15×.5 = .63325 + .075 = .70825
    // G = 100 × (.55×.70825 + .15×(.95 + .9 + .7)) = 100 × (.3895375 + .3825) = 77.20375 → 77
    // Qualité max: Σ = .27 + .225 + .18 + .06 + .075 = .81 → V = .7635 → 100 × (.419925 + .3825) = 80.2425 → 80
    const g = computeGauge(profileOf('top-dix-anime'), UM)
    expect(g.score).toBe(77)
    expect(g.perMode).toEqual({ qualite_max: 80, usage_max: 77 })
    expect(g.tier).toBe('adaptations')
    expect(g.adaptations).toEqual([{ kind: 'mode', mode: 'qualite_max', score: 80 }])
    expect(computeGauge(profileOf('top-dix-anime'), QM).tier).toBe('reproductible')
  })

  it('a format made of clips of others is capped at 50', () => {
    // clip .30 (≥ .20: L = .5), stock .70; every other note perfect
    // Σ = .70×.9 = .63 → G = 100 × .5 × (.55×.63 + .15×3) = 50 × .7965 = 39.825 → 40
    const clips: GaugeProfile = { components: [{ component: 'clip', share: 0.3 }, { component: 'stock', share: 0.7 }], voice: 1, script: 1, edit: 1, analystConfidence: 'high' }
    const g = computeGauge(clips, UM)
    expect(g.l).toBe(0.5)
    expect(g.score).toBe(40)
    // even with a perfect matrix, never above 50
    const perfect = Object.fromEntries(COMPONENT_IDS.map((c) => [c, { qualite_max: 1, usage_max: 1 }])) as unknown as CapabilityMatrix
    expect(scoreOf(clips, UM, perfect)).toBe(50)
  })

  it('camera: « Avec ta caméra : … · sans : … » and the Analyste replacement', () => {
    // face_camera .50, stock .50, notes .95/.9/.9, high
    // with camera: Σ = .45 + .45 = .90 → 100 × (.495 + .4125) = 90.75 → 91
    // without (Usage max replaces by text animation at half fidelity): Σ = .45 + .5×.9×.5 = .675 → 100 × (.37125 + .4125) = 78.375 → 78
    // unanswered: Σ = .45 → 100 × (.2475 + .4125) = 66
    // explicit avatar (Usage max .5, half fidelity): Σ = .45 + .125 = .575 → 100 × (.31625 + .4125) = 72.875 → 73
    const p: GaugeProfile = { components: [{ component: 'face_camera', share: 0.5 }, { component: 'stock', share: 0.5 }], voice: 0.95, script: 0.9, edit: 0.9, analystConfidence: 'high' }
    const g = computeGauge(p, UM)
    expect(g.score).toBe(66)
    expect(g.inputsEffect).toEqual([{ input: 'camera', with: 91, without: 78 }])
    expect(scoreOf(p, { ...UM, answers: { camera: false }, replace: { face_camera: 'avatar' } })).toBe(73)
  })
})

describe('tiers, colours and support', () => {
  it('tiers follow §2.3', () => {
    expect([100, 80, 79, 50, 49, 30, 29, 0].map(tierOf)).toEqual(['reproductible', 'reproductible', 'adaptations', 'adaptations', 'partiel', 'partiel', 'special', 'special'])
  })

  it('segment colours: green ≥ .75, amber ≥ .4, red below', () => {
    expect([0.9, 0.75, 0.74, 0.4, 0.39, 0].map(segmentTone)).toEqual(['green', 'green', 'amber', 'amber', 'red', 'red'])
  })

  it('suggests support under 30 or when more than 40 % of the time cannot be made', () => {
    const p: GaugeProfile = { components: [{ component: 'gameplay', share: 0.45 }, { component: 'stock', share: 0.55 }], voice: 0.95, script: 0.9, edit: 0.9, analystConfidence: 'high' }
    const g = computeGauge(p, UM)
    expect(g.score).toBeGreaterThanOrEqual(30)
    expect(g.unproducibleShare).toBeCloseTo(0.45, 10)
    expect(g.supportSuggested).toBe(true)
    expect(computeGauge(p, { ...UM, answers: { gameplay: true } }).supportSuggested).toBe(false)
  })

  it('example timelines cover the whole video, in order', () => {
    const r = findReference('archives-silencieuses')
    if (!r) throw new Error('ref')
    const video = r.recentVideos.find((v) => v.id === 'as-7')
    const t = timelineFor(r, 'as-7')
    expect(t[0]?.startS).toBe(0)
    expect(t.at(-1)?.endS).toBe(video?.durationS)
    for (let i = 1; i < t.length; i++) expect(t[i]?.startS).toBe(t[i - 1]?.endS)
    expect(t.some((s) => s.note.includes('Archive télé'))).toBe(true)
  })

  it('is deterministic', () => {
    const p = profileOf('top-dix-anime')
    expect(computeGauge(p, UM)).toEqual(computeGauge(p, UM))
  })
})

describe('property: a larger capability never lowers the score', () => {
  const comp = fc.constantFrom(...COMPONENT_IDS)
  const profile = fc.record({
    components: fc.array(fc.record({ component: comp, share: fc.double({ min: 0, max: 1, noNaN: true }) }), { minLength: 1, maxLength: 6 }),
    voice: fc.double({ min: 0, max: 1, noNaN: true }),
    script: fc.double({ min: 0, max: 1, noNaN: true }),
    edit: fc.double({ min: 0, max: 1, noNaN: true }),
    analystConfidence: fc.constantFrom('high' as const, 'medium' as const, 'low' as const)
  })
  const state = fc.record({
    mode: fc.constantFrom('qualite_max' as const, 'usage_max' as const),
    answers: fc.record({ camera: fc.option(fc.boolean(), { nil: undefined }), gameplay: fc.option(fc.boolean(), { nil: undefined }) }, { requiredKeys: [] }),
    replace: fc.dictionary(comp, comp, { maxKeys: 3 }) as fc.Arbitrary<Partial<Record<ComponentId, ComponentId>>>
  })
  it('holds for any profile, state and bumped matrix entry', () => {
    fc.assert(
      fc.property(profile, state, comp, fc.constantFrom('qualite_max' as const, 'usage_max' as const, 'withInput' as const), fc.double({ min: 0, max: 1, noNaN: true }), (p, s, c, field, bump) => {
        const cap = CAPABILITY_MATRIX[c]
        const current = cap[field] ?? 0
        const better: CapabilityMatrix = { ...CAPABILITY_MATRIX, [c]: { ...cap, [field]: Math.min(1, current + bump * (1 - current)) } }
        const st = s as GaugeState
        return scoreOf(p, st, better) >= scoreOf(p, st, CAPABILITY_MATRIX)
      }),
      { numRuns: 500 }
    )
  })
})
