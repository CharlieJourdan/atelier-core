// avatar-qualite part 5, record 0058 (Charlie's two references: 41 % of presenter in the first minute of one, 31 % in the
// other): the presenter's curve and runs are measured per channel, from the eyes' presenter spans, with the method of record
// 0055; a channel that has none keeps the pipeline's default (avatar@1: the hook-heavy curve). A short video takes the first
// minutes of the long video's curve (production-17). And run 6's shot 13: the judge's framing is kept when a picture is remade.
import { describe, expect, it } from 'vitest'
import { avatarBase, compileRecipe, fromBase, technologyRegistry } from '../../src/engine/technologies'
import { averageShares, CURVE_FIT_S, curveRows, type CurveRow, type Mix } from '../../src/engine/technologies/mix'
import { compareProfiles, curveFromProfile, measureEditing, type CurvePoint, type ProfileShot } from '../../src/engine/technologies/reference-profile'
import { medianCurve, pipelineForProfile } from '../../src/engine/technologies/fit-gaps'
import { proposePipelines } from '../../src/engine/technologies/propose'
import { styleOps } from '../../src/engine/technologies/likeness'
import type { VideoMeasure } from '../../src/engine/technologies/fit'
import { measureVideo, presenterOf } from '../../src/main/production/estimates/measure'
import { framingOf } from '../../src/engine/nodes/visuals-illustration'
import { SIZE_HEAD } from '../../src/engine/nodes/director-variety'
import type { AnalysisResult } from '../../src/shared/video-analysis'

const reg = technologyRegistry()
const avatarMix = fromBase(avatarBase).mix as Mix

/** The presenter's curve of Charlie's two references, measured on their 427 labelled shots (research notes of the old repository). */
const REF1: CurvePoint[] = [
  { fromS: 0, toS: 30, share: 0.56 }, { fromS: 30, toS: 60, share: 0.27 }, { fromS: 60, toS: 120, share: 0.22 },
  { fromS: 120, toS: 300, share: 0.27 }, { fromS: 300, toS: 600, share: 0.23 }, { fromS: 600, toS: null, share: 0.23 }
]
const REF2: CurvePoint[] = [
  { fromS: 0, toS: 30, share: 0.33 }, { fromS: 30, toS: 60, share: 0.28 }, { fromS: 60, toS: 120, share: 0.17 },
  { fromS: 120, toS: 300, share: 0.27 }, { fromS: 300, toS: 600, share: 0.29 }, { fromS: 600, toS: null, share: 0.23 }
]
const firstMinute = (rows: readonly CurveRow[]): number => averageShares(rows, 60).presenter ?? 0
const at = (rows: readonly CurveRow[], s: number): number => [...rows].reverse().find((r) => r.fromS <= s)?.shares.presenter ?? 0

describe('the presenter curve, measured', () => {
  it('measures the presenter’s share in each window it covers, split screens counted, runs on the full frame only', () => {
    const shots: ProfileShot[] = [
      { start: 0, end: 15, presenter: true },
      { start: 15, end: 30, presenter: false },
      { start: 30, end: 40, presenter: false, withPresenter: true },
      { start: 40, end: 70, presenter: false }
    ]
    const p = measureEditing(shots, [])
    expect(p.presenterCurve).toEqual([
      { fromS: 0, toS: 30, share: 0.5 },
      { fromS: 30, toS: 60, share: 0.33 }
    ])
    expect(p.presenterRunMaxS).toBe(15)
  })

  it('a measured curve survives the fit to the mix: each reference’s first minute within 2 points, on 60 s and on 12 min', () => {
    for (const [ref, minute] of [[REF1, 0.415], [REF2, 0.305]] as const) {
      const curve = curveFromProfile(ref, curveRows(avatarMix, CURVE_FIT_S)) as CurveRow[]
      for (const d of [60, 720]) {
        const rows = curveRows({ ...avatarMix, curve }, d)
        expect(Math.abs(at(rows, 0) - (ref[0] as CurvePoint).share)).toBeLessThanOrEqual(0.02)
        expect(Math.abs(at(rows, 30) - (ref[1] as CurvePoint).share)).toBeLessThanOrEqual(0.02)
        expect(Math.abs(firstMinute(rows) - minute)).toBeLessThanOrEqual(0.02)
      }
    }
    // avatar@1's default (no channel measure): the hook-heavy curve, 54 % then 30 %
    const hook = curveRows(avatarMix, 60)
    expect(at(hook, 0)).toBeGreaterThan(0.5)
  })

  it('the comparison says which window of the curve is off', () => {
    const gaps = compareProfiles({ presenterCurve: REF2 }, { presenterCurve: [{ fromS: 0, toS: 30, share: 0.54 }, { fromS: 30, toS: 60, share: 0.3 }] })
    expect(gaps.map((g) => g.text)).toEqual(['présentateur de 0 à 30 s : 54 % du temps, la référence 33 %'])
  })
})

describe('the channel’s own curve and runs (else the pipeline’s)', () => {
  const channel = (curve: CurvePoint[] | null, run: number | null): VideoMeasure[] =>
    [0.27, 0.25, 0.26].map((presenterShare) => ({ minutes: 12, presenterShare, presenterCurve: curve, presenterRunMaxS: run }))

  it('a channel measured like reference 2 gets its curve and its runs: 31 % in the first minute of its short videos', () => {
    const doc = pipelineForProfile(fromBase(avatarBase), channel(REF2, 7), reg)
    expect(Array.isArray(doc.mix?.curve)).toBe(true)
    expect(Math.abs(firstMinute(curveRows(doc.mix as Mix, 60)) - 0.305)).toBeLessThanOrEqual(0.02)
    expect(doc.bricks.find((b) => b.tech.startsWith('director.plan@'))?.settings.presenterRunMaxS).toBe(7)
    const c = compileRecipe(doc, reg)
    expect(c.ok).toBe(true)
    // the proposal's variants carry them (as edit operations the owner sees)
    const p = proposePipelines({ videos: channel(REF2, 7) }, reg)
    for (const v of p.variants) {
      expect(Array.isArray(v.doc.mix?.curve)).toBe(true)
      expect(v.ops).toEqual(expect.arrayContaining([{ op: 'setSetting', brick: 'director.plan', key: 'presenterRunMaxS', value: 7 }]))
    }
  })

  it('a channel whose videos do not measure the presenter keeps avatar@1’s default curve and runs', () => {
    const doc = pipelineForProfile(fromBase(avatarBase), channel(null, null), reg)
    expect(doc.mix?.curve).toBe('hook-heavy')
    expect(doc.bricks.find((b) => b.tech.startsWith('director.plan@'))?.settings.presenterRunMaxS).toBe(8.5)
    expect(medianCurve(channel(null, null))).toEqual([])
  })

  it('« Créer une pipeline » does not put the named curve back over a measured one', () => {
    const refs = channel(REF2, 7).map((v) => ({ ...v, curve: 'hook-heavy' as const }))
    const shaped = pipelineForProfile(fromBase(avatarBase), refs, reg)
    expect(styleOps(shaped, refs, reg).some((o) => o.op === 'setCurve')).toBe(false)
    expect(styleOps(shaped, channel(null, null).map((v) => ({ ...v, curve: 'flat' as const })), reg).some((o) => o.op === 'setCurve')).toBe(true)
  })
})

describe('the eyes read the presenter', () => {
  const analysis = (presenter: AnalysisResult['presenter']): AnalysisResult => ({
    summary: 's',
    hook: { text: 'h', endsAtS: 10, technique: 'story' },
    structure: [{ fromS: 0, toS: 120, kind: 'body', summary: 'b' }],
    pacing: { cutsPerMinute: 18, tempo: 'fast', notes: '' },
    shotTypes: ['talking head', 'b-roll'],
    onScreenText: [],
    music: { present: false, mood: '', notes: '' },
    callsToAction: [],
    ...(presenter ? { presenter } : {})
  })

  it('from its presenter spans, a video gives its curve and its longest full-frame run', () => {
    const an = analysis([
      { fromS: 0, toS: 6, layout: 'full' },
      { fromS: 11, toS: 18, layout: 'full' },
      { fromS: 18, toS: 20, layout: 'full' },
      { fromS: 40, toS: 50, layout: 'split' },
      { fromS: 90, toS: 96, layout: 'inset' }
    ])
    const m = presenterOf(an, 120)
    expect(m.presenterRunMaxS).toBe(9)
    expect(m.presenterCurve?.map((p) => p.share)).toEqual([0.5, 0.33, 0.1])
    const record = { channelId: 1, sourceKey: 0, videoId: 'v', url: 'u', title: 't', durationS: 720, outlier: false, analysis: an, demo: false, analysedAt: '' }
    expect(measureVideo(record).presenterCurve?.[0]).toEqual({ fromS: 0, toS: 30, share: 0.5 })
  })

  it('an older analysis (no spans) measures nothing; an empty list is a video without presenter', () => {
    expect(presenterOf(analysis(undefined), 120)).toEqual({})
    expect(presenterOf(analysis([]), 120).presenterCurve?.every((p) => p.share === 0)).toBe(true)
  })
})

describe('run 6, shot 13: a remade picture keeps the judge’s framing', () => {
  it('the judge’s « close to the corner » is a close-up, never the director’s wide shot', () => {
    expect(framingOf('Steady phone photo at eye level, close to the inside corner of two matte white limewashed bedroom walls')).toBe('close-up')
    expect(framingOf('Steady phone photo, first-person view of gloved hands holding a wide brush')).toBe('close-up')
    expect(framingOf('Macro of grey mould dots')).toBe('extreme close-up')
    expect(framingOf('The whole room seen from the door')).toBe('wide shot')
    expect(framingOf('A sack of lime on a step')).toBe('medium shot')
  })

  it('the size at the head of a prompt is recognised again (its pattern had lost its escapes)', () => {
    expect('Close-up of a hand on the wall'.replace(SIZE_HEAD, '')).toBe('a hand on the wall')
    expect('medium shot of a sack'.replace(SIZE_HEAD, '')).toBe('a sack')
  })

  it('avatar@1’s clips never bring hands into a picture that has none', () => {
    const r = compileRecipe(fromBase(avatarBase), reg)
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    const motion = (r.pipeline.nodes.find((n) => n.id === 'clips')?.params as { motion?: string }).motion
    expect(motion).toMatch(/nobody and nothing enters the frame, no hands appear/)
  })
})
