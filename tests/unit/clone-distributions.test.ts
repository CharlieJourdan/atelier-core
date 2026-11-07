// Chantier reverse-pipeline: every screen element measured OVER TIME (per part and per tenth, by overlap), the cadence, pace and
// illustration per part, pooled over the corpus, carried into the definition and into the director's mix curve and cadence rows.
// Synthetic videos, no network, no money.
import { describe, expect, it } from 'vitest'
import { withAtPath, type AnalysedShot, type Sourced, type StyleDefinition, type VideoAnalysis } from '../../src/shared/clone'
import { definitionDefaults } from '../../src/main/production/clone/definition-defaults'
import { distributionsOf, illustratesByPartOf, poolDistributions, shotByPartOf, wpmByPartOf } from '../../src/main/production/clone/analysis/distributions'
import { deriveFields } from '../../src/main/production/clone/definition/derive'
import { bedDbFrom, mixCurveFrom, mixFrom, mixOf } from '../../src/main/production/clone/pipeline/values'
import { measuredHookShare, paceRowsFrom } from '../../src/main/production/clone/pipeline/values-mix'
import { settingsFromDefinition } from '../../src/main/production/clone/plan-rules'
import { MixSchema, curveRows, type CurveRow } from '../../src/engine/technologies/mix'
import { DirectorParams, baseCuts } from '../../src/engine/nodes/director-cuts'
import { PaceRows, paceAt } from '../../src/engine/nodes/director-screen'
import { technologyRegistry } from '../../src/engine/technologies/registry'

// ── a 10-minute avatar video: the presenter 80 % of the first minute (the hook), half the body, 10 % of the last third (the end),
// generated stills in the hook, generated clips in the body, archive photos at the end
const D = 600
const PARTS: VideoAnalysis['parts'] = [{ part: 'hook', fromS: 0, toS: 60 }, { part: 'body', fromS: 60, toS: 400 }, { part: 'end', fromS: 400, toS: 600 }]
function shotsOf(): AnalysedShot[] {
  const out: AnalysedShot[] = []
  const add = (lengthS: number, presenter: boolean, kind: AnalysedShot['kind'], origin: AnalysedShot['origin'], camera: AnalysedShot['camera'], illustrates: AnalysedShot['illustrates'] = 'yes'): void => {
    const startS = out.length ? out[out.length - 1]!.startS + out[out.length - 1]!.lengthS : 0
    out.push({
      n: out.length + 1, startS, lengthS, kind: presenter ? 'presenter' : kind, shows: 's', onScreenText: presenter ? '' : 'a label', words: 'some spoken words', illustrates: presenter ? null : illustrates,
      camera: presenter ? 'still' : camera, origin: presenter ? 'presenter' : origin, layout: presenter ? 'full' : 'off', angle: presenter ? 0 : null, frames: [`f${out.length + 1}.jpg`]
    })
  }
  for (let k = 0; k < 6; k++) { add(8, true, 'presenter', 'presenter', 'still'); add(2, false, 'generated', 'generated', 'push-in') }
  for (let k = 0; k < 34; k++) { add(5, true, 'presenter', 'presenter', 'still'); add(5, false, 'generated', 'generated', 'tracking', k % 2 ? 'yes' : 'no') }
  for (let k = 0; k < 20; k++) { add(1, true, 'presenter', 'presenter', 'still'); add(9, false, 'archive-photo', 'found', 'push-in') }
  return out
}
const el = (d: ReturnType<typeof distributionsOf>, name: string) => d.find((x) => x.element === name)!

describe('distributions of one video', () => {
  it('presenter 80 % in the hook, 10 % in the last third: per part and per tenth, by screen time', () => {
    const d = distributionsOf({ videoId: 'v1', shots: shotsOf(), parts: PARTS, durationS: D })
    const p = el(d, 'presenter')
    expect(p.byPart).toEqual([{ part: 'hook', share: 0.8 }, { part: 'body', share: 0.5 }, { part: 'end', share: 0.1 }])
    expect(p.curve[0]).toBe(0.8)
    expect(p.curve.slice(7)).toEqual([0.1, 0.1, 0.1])
    // the tenth 360–420 s holds 40 s of the body (half presenter) and 20 s of the end (a tenth): 22 / 60
    expect(p.curve[6]).toBeCloseTo(22 / 60, 2)
    expect(p.overall).toBeCloseTo((48 + 170 + 20) / 600, 2)
    // stills dominate the end, clips the body
    expect(el(d, 'still').byPart.find((x) => x.part === 'end')!.share).toBe(0.9)
    expect(el(d, 'generated:moving').byPart.find((x) => x.part === 'body')!.share).toBe(0.5)
    expect(el(d, 'generated:still').byPart.find((x) => x.part === 'hook')!.share).toBe(0.2)
    expect(el(d, 'origin:found').curve[9]).toBe(0.9)
    expect(el(d, 'text').overall).toBeCloseTo(1 - p.overall, 2)
    // evidence: time ranges with frames, and the peak window
    expect(p.evidence.some((e) => e.fromS !== undefined && e.toS !== undefined && e.frames.length > 0)).toBe(true)
    expect(p.evidence.some((e) => (e.note ?? '').includes('tenth 1'))).toBe(true)
  })

  it('a shot straddling a part change counts on both sides, never only where it starts', () => {
    const s = (n: number, startS: number, lengthS: number, presenter: boolean): AnalysedShot => ({ n, startS, lengthS, kind: presenter ? 'presenter' : 'stock-footage', shows: '', onScreenText: '', words: '', illustrates: null, camera: 'still', origin: presenter ? 'presenter' : 'found', layout: presenter ? 'full' : 'off', angle: null, frames: ['f.jpg'] })
    const shots = [s(1, 0, 55, false), s(2, 55, 10, true), s(3, 65, 35, false)]
    const parts: VideoAnalysis['parts'] = [{ part: 'hook', fromS: 0, toS: 60 }, { part: 'body', fromS: 60, toS: 100 }]
    const p = el(distributionsOf({ videoId: 'v', shots, parts, durationS: 100 }), 'presenter')
    expect(p.byPart).toEqual([{ part: 'hook', share: round(5 / 60) }, { part: 'body', share: round(5 / 40) }])
    // the mean shot length per part counts the straddling shot by its share in each part
    expect(shotByPartOf(shots, parts)).toEqual([{ part: 'hook', meanShotS: round2(60 / 1.5) }, { part: 'body', meanShotS: round2(40 / 1.5) }])
  })

  it('words per minute per part from the word timings; illustration per part only where it was read', () => {
    const words = Array.from({ length: 200 }, (_, i) => {
      // 3 words a second over the first 60 s, then 2 a second
      const start = i < 180 ? i / 3 : 60 + (i - 180) / 2
      return { word: 'w', start, end: start + 0.3 }
    })
    const parts: VideoAnalysis['parts'] = [{ part: 'hook', fromS: 0, toS: 60 }, { part: 'body', fromS: 60, toS: 600 }]
    const wpm = wpmByPartOf(words, parts)
    expect(wpm[0]).toEqual({ part: 'hook', wpm: expect.any(Number) })
    expect(wpm[0]!.wpm).toBeGreaterThan(wpm[1]!.wpm)
    expect(wpm[0]!.wpm).toBeCloseTo(180, -1)
    const ill = illustratesByPartOf(shotsOf(), PARTS)
    expect(ill).toEqual([{ part: 'hook', share: 1 }, { part: 'body', share: 0.5 }, { part: 'end', share: 1 }])
    const unread = shotsOf().map((s) => ({ ...s, illustrates: null }))
    expect(illustratesByPartOf(unread, PARTS).every((p) => p.share === null)).toBe(true)
  })
})

const round = (n: number): number => Math.round(n * 1000) / 1000
const round2 = (n: number): number => Math.round(n * 100) / 100

/** One analysis with the distributions of `shots` (only what the pooling and derive read). */
function analysisOf(id: string, shots: AnalysedShot[], parts = PARTS, durationS = D): VideoAnalysis {
  const ev = [{ video: id, atS: 0, frames: ['f.jpg'] }]
  const m = { value: 0, evidence: ev }
  return {
    schema: 'atelier.clone.video-analysis/1', cloneId: 'c', createdAt: 'now', videoId: id, url: id, title: id,
    coverage: { durationS, readS: durationS, complete: true, gaps: [], unreadAxes: [], said: null }, parts, shots, denseFrames: [],
    presenter: { kind: 'avatar', identity: null, angles: [], layoutByPart: [], presenceByPart: [], entries: [], exits: [] },
    voice: { kind: 'synthetic', timbre: '', wordsPerMinute: { value: 150, evidence: ev }, pausesPerMinute: m, meanPauseS: m, energy: 'medium', wpmByPart: [{ part: 'hook', wpm: 180 }, { part: 'body', wpm: 150 }] },
    motion: { elements: [], palette: [], fonts: [] },
    editing: { cutTypes: { hard: shots.length - 1 }, meanShotS: m, medianShotS: m, p90ShotS: m, shotCurve: [{ fromS: 0, toS: durationS, meanShotS: 5 }], holdsOver5S: 0, transitions: [], originShares: {}, colour: '', shotByPart: shotByPartOf(shots, parts), illustratesByPart: illustratesByPartOf(shots, parts) },
    sound: { music: { present: false, genre: '', levelUnderVoiceDb: null, changesAtS: [] }, sfx: [], loudnessLufs: m },
    script: { structure: ['hook'], hookPattern: '', promise: '', payoff: '', chapters: [], cta: '', sentenceWordsMean: m, tone: '', devices: [] },
    packaging: { title: id, titlePattern: '', thumbnail: { path: null, pattern: '' } },
    distributions: distributionsOf({ videoId: id, shots, parts, durationS }),
    unmeasured: ['editing.cutTypes: scene detection counts the cuts; their kind is only seen where frames are dense (transitions)'],
    costUsd: 0
  }
}

const measured = <T>(value: T): Sourced<T> => ({ value, source: 'measured', evidence: [{ video: 'v1', atS: 0, frames: ['f.jpg'] }] })
function definition(): StyleDefinition {
  return { schema: 'atelier.clone.style-definition/1', cloneId: 'c', createdAt: 'now', version: 1, channel: { name: 'x', url: 'x', ownChannel: false, language: 'fr', styleId: null }, ...definitionDefaults(), analysisMeasures: [] } as StyleDefinition
}
function measuredDefinition(): StyleDefinition {
  let d = definition()
  d = withAtPath(d, 'sourcing.distributions', measured(poolDistributions([analysisOf('v1', shotsOf()), analysisOf('v2', shotsOf()), analysisOf('v3', shotsOf())])))
  d = withAtPath(d, 'script.parts', measured([{ name: 'hook', share: 0.1, intent: '' }, { name: 'body', share: 0.567, intent: '' }, { name: 'end', share: 0.333, intent: '' }]))
  d = withAtPath(d, 'script.hookWindowS', measured(60))
  return d
}
const near = (rows: readonly CurveRow[], fromS: number) => [...rows].reverse().find((r) => r.fromS <= fromS)!.shares

describe('the corpus and the definition', () => {
  it('pools the videos into the median per part and per tenth, and derive puts every per-part measure in the definition', () => {
    const odd = shotsOf().map((s) => (s.startS < 60 ? { ...s, layout: 'off' as const, origin: 'found' as const, kind: 'stock-footage' as const } : s))
    const corpus = [analysisOf('v1', shotsOf()), analysisOf('v2', shotsOf()), analysisOf('v3', odd)]
    const pooled = poolDistributions(corpus)
    const p = pooled.find((x) => x.element === 'presenter')!
    // the median of 0.8, 0.8 and 0: one odd video does not move it
    expect(p.byPart.find((x) => x.part === 'hook')!.share).toBe(0.8)
    expect(p.curve[0]).toBe(0.8)
    expect(p.curve).toHaveLength(10)
    const fields = new Map(deriveFields(corpus).map((f) => [f.field, f]))
    expect(fields.get('sourcing.distributions')!.value).toEqual(pooled)
    expect(fields.get('sourcing.distributions')!.evidence.length).toBeGreaterThan(0)
    expect(fields.get('editing.shotByPart')!.value).toEqual([{ part: 'hook', meanShotS: 5 }, { part: 'body', meanShotS: 5 }, { part: 'end', meanShotS: 5 }])
    expect(fields.get('script.illustratesByPart')!.value).toEqual([{ part: 'hook', share: 1 }, { part: 'body', share: 0.5 }, { part: 'end', share: 1 }])
    // cut kinds the analyses did not see are not measured
    expect(fields.has('editing.cutTypes')).toBe(false)
  })

  it('a video whose distributions were not measured does not vote', () => {
    const blind = { ...analysisOf('v3', shotsOf()), unmeasured: ['distributions: no file, the pictures were not seen'] }
    expect(poolDistributions([blind])).toEqual([])
    expect(deriveFields([blind]).some((f) => f.field === 'sourcing.distributions')).toBe(false)
  })
})

describe('the director’s mix curve from the measured distributions', () => {
  it('reproduces « presenter 80 % in the hook, stills at the end », and the engine keeps the rows as measured', () => {
    const d = measuredDefinition()
    const rows = mixCurveFrom(d) as CurveRow[]
    expect(rows[0]).toEqual({ fromS: 0, shares: { presenter: 0.8, imageAi: 0.2 } })
    expect(near(rows, 100)).toEqual({ presenter: 0.5, clipAi: 0.5 })
    // the last third: the presenter 10 %, found stills 90 %
    expect(near(rows, 500)).toEqual({ stock: 0.9, presenter: 0.1 })
    const mix = MixSchema.parse(mixFrom(d))
    const fitted = curveRows(mix, 600)
    for (const r of rows) for (const [k, v] of Object.entries(r.shares)) expect(near(fitted, r.fromS)[k as 'presenter'], `${r.fromS} ${k}`).toBeCloseTo(v, 2)
    // the bricks follow the measured kinds (generated clips in the body: the clip brick)
    expect(mixOf(d).clipAi).toBeGreaterThan(0)
    // every row is a valid engine row; the recipe.mix setting carries them
    expect(settingsFromDefinition(d).find((s) => s.key === 'recipe.mix')!.value).toEqual(mixFrom(d))
  })

  it('without distributions: the presenter-presence curve as before, and no hook row from the unmeasured 15 s default', () => {
    let d = definition()
    d = withAtPath(d, 'sourcing.originShares', measured({ presenter: 0.5, found: 0.5 }))
    d = withAtPath(d, 'presenter.presenceByPart', measured([{ part: 'hook', share: 0.9 }, { part: 'body', share: 0.4 }]))
    expect(measuredHookShare(d, 600)).toBeUndefined()
    const rows = mixCurveFrom(d, 10) as CurveRow[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.shares.presenter).toBe(0.4)
    // a measured hook window places the hook row
    const hooked = mixCurveFrom(withAtPath(d, 'script.hookWindowS', measured(20)), 10) as CurveRow[]
    expect(hooked.map((r) => [r.fromS, r.shares.presenter])).toEqual([[0, 0.9], [20, 0.4]])
  })

  it('no music bed level when the reference has no music', () => {
    const d = definition()
    expect(bedDbFrom(d)).toBeNull()
    expect(bedDbFrom(withAtPath(d, 'sound.music', measured(true)))).toBe(-24)
  })
})

describe('the cadence part by part', () => {
  it('the measured shot length per part becomes director.plan pace rows from each part on', () => {
    let d = measuredDefinition()
    d = withAtPath(d, 'editing.shotByPart', measured([{ part: 'hook', meanShotS: 2 }, { part: 'body', meanShotS: 4 }, { part: 'end', meanShotS: 8 }]))
    d = withAtPath(d, 'editing.meanShotS', measured(4))
    const rows = paceRowsFrom(d, 10)!
    expect(rows).toEqual([{ fromS: 0, factor: 0.5 }, { fromS: 60, factor: 1 }, { fromS: 400, factor: 2 }])
    expect(PaceRows.safeParse(rows).success).toBe(true)
    expect(settingsFromDefinition(d).find((s) => s.key === 'director.plan.paceRows')!.value).toEqual(rows)
    expect(paceRowsFrom(definition(), 10)).toBeUndefined()
    // the technology passes them to the director node
    const tech = technologyRegistry().get('director.plan@1')!
    const params = tech.nodeParams!({ paceRows: rows } as never, { aspect: '16:9', short: false, minutes: 10 } as never) as Record<string, Record<string, unknown>>
    expect(params['director']!['paceRows']).toEqual(rows)
  })

  it('the rhythm director cuts shorter shots where the rows say so (default off: the intro pace as before)', () => {
    const wordStarts = Array.from({ length: 480 }, (_, i) => i * 0.25)
    const p = DirectorParams.parse({ cpm: 12, minShotS: 1, maxShotS: 12, paceRows: [{ fromS: 0, factor: 0.5 }, { fromS: 40, factor: 2 }] })
    const cuts = baseCuts([], 120, p, wordStarts)
    const lengths = (from: number, to: number): number[] => cuts.slice(1).map((c, i) => [cuts[i]!, c] as const).filter(([a]) => a >= from && a < to).map(([a, b]) => b - a)
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean(lengths(0, 38))).toBeCloseTo(2.5, 0)
    expect(mean(lengths(42, 100))).toBeGreaterThan(8)
    // without rows: the hook's intro pace (5 s / 1.4) then the plain 5 s
    const plain = baseCuts([], 120, DirectorParams.parse({ cpm: 12, minShotS: 1, maxShotS: 12 }), wordStarts)
    const plainLengths = plain.slice(1).map((c, i) => [plain[i]!, c] as const)
    expect(mean(plainLengths.filter(([a]) => a < 55).map(([a, b]) => b - a))).toBeCloseTo(5 / 1.4, 0)
    expect(mean(plainLengths.filter(([a]) => a >= 60 && a < 95).map(([a, b]) => b - a))).toBeCloseTo(5, 0)
    expect(paceAt(undefined, 10)).toBe(1)
    expect(paceAt(p.paceRows, 39.9)).toBe(0.5)
    expect(paceAt(p.paceRows, 40)).toBe(2)
  })
})
