// Chantier D (moteur-comparaison): the pieces of P6–P8 on fakes — curves, matched moments, the blind judge (blind, every
// axis with its defects, paid once), the render review, the cause finder (definition vs calibration vs brick), the
// cache keys and the real runner (calibrated recipe, saved production, no double payment). No network, no money.
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPARE_AXES, REQUIRED_CURVES, type Corpus, type PipelinePlan, type Round, type StyleDefinition, type VideoAnalysis } from '../../src/shared/clone'
import { fakeChannel, fakeCorpus } from '../../src/main/production/clone/fakes/channels'
import { calibrationTarget, loadCalibration, withFactor } from '../../src/main/production/clone/compare/calibration'
import { brickKeys, rerunPlan } from '../../src/main/production/clone/compare/cache'
import { compareCurves, paletteDistance, shotHistogram, tvDistance, type FileMeasures } from '../../src/main/production/clone/compare/curves'
import { matchedMoments, oursAt } from '../../src/main/production/clone/compare/frames'
import { axisDefects, curveChanges, parseFixes, unblind } from '../../src/main/production/clone/compare/improver'
import { blindJudge, judgePrompt, parseJudge } from '../../src/main/production/clone/compare/judge'
import { dominantColours, parseLoudness, scriptPace } from '../../src/main/production/clone/compare/measure'
import { parseHoles, renderDefects } from '../../src/main/production/clone/compare/review'
import { calibrate, planRunner, type Producer } from '../../src/main/production/clone/compare/runner'
import { checkP6, pickPassage, passageChanges } from '../../src/main/production/clone/p6-reproduce'
import { checkP8 } from '../../src/main/production/clone/p8-improve'
import { DEFINITION_DEFAULTS_FOR_TESTS } from './clone-compare-fixtures'

const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), 'clone-compare-'))
const ch = fakeChannel('presenter-motion')
const video = fakeCorpus(ch)[0]!
const analysis: VideoAnalysis = ch.analyse(video, 'p2-frames/v1')
const passage = { videoId: video.id, fromS: 0, toS: 120 }
const production = { passage, videoPath: 'p6-round-01/ours.mp4', scriptPath: 'p6-round-01/script.txt', durationS: 120, costUsd: 1, makeSeconds: 240, usdPerMinute: 0.5, makeSecondsPerMinute: 120, runs: ['r1'] }
const cuts = (every: number, upTo: number): number[] => Array.from({ length: Math.floor(upTo / every) - 1 }, (_, i) => Math.round((i + 1) * every * 100) / 100)
const measures = (o: Partial<FileMeasures> = {}): FileMeasures => ({ cutsS: cuts(2.7, 120), durationS: 120, loudnessLufs: -14, palette: [{ hex: '#0b1f3a', share: 0.6 }, { hex: '#f5b700', share: 0.4 }], wordsPerMinute: 165, ...o })

describe('P7 curves', () => {
  it('measures every required curve, 0 when ours matches, more when it drifts', () => {
    const timeline = analysis.shots.filter((s) => s.startS < 120).map((s) => ({ startS: s.startS, lengthS: Math.min(s.lengthS, 120 - s.startS), origin: s.origin, layout: s.layout, motion: s.origin === 'motion' }))
    const same = compareCurves({ analysis, production: { ...production, timeline }, ours: measures(), reference: measures() })
    for (const name of REQUIRED_CURVES) expect(same.find((c) => c.name === name), name).toBeDefined()
    for (const c of same) expect(c.distance, c.name).toBeLessThan(0.05)
    const off = compareCurves({ analysis, production, ours: measures({ cutsS: cuts(5, 120), loudnessLufs: -22, wordsPerMinute: 130, palette: [{ hex: '#ff0000', share: 1 }] }), reference: measures() })
    const d = Object.fromEntries(off.map((c) => [c.name, c.distance]))
    expect(d['shot-length']).toBeGreaterThan(0.3)
    expect(d['pace']).toBeGreaterThan(0.15)
    expect(d['loudness']).toBeCloseTo(0.8, 5)
    expect(d['palette']).toBeGreaterThan(0.3)
    // no timeline: layout, presence and motion are said « not measured on ours », never invented
    expect(off.find((c) => c.name === 'layout-share')).toMatchObject({ distance: 1, ours: [] })
    expect(off.find((c) => c.name === 'presence')?.note).toMatch(/not measured on ours/)
  })

  it('distribution helpers are honest distances', () => {
    expect(shotHistogram([0.5, 1.5, 2.5, 4, 6, 9])).toEqual([0.167, 0.167, 0.167, 0.167, 0.167, 0.167])
    expect(tvDistance([1, 0], [0, 1])).toBe(1)
    expect(paletteDistance([{ hex: '#000000', share: 1 }], [{ hex: '#000000', share: 1 }])).toBe(0)
    expect(paletteDistance([{ hex: '#000000', share: 1 }], [])).toBe(1)
  })
})

describe('P7 matched moments and instruments', () => {
  it('pairs the hook densely, each part change, never fewer than 6, all inside the passage', () => {
    const t = matchedMoments(passage, analysis)
    expect(t.length).toBeGreaterThanOrEqual(6)
    expect(t.filter((x) => x < 15).length).toBeGreaterThanOrEqual(2)
    expect(t.some((x) => x >= 21 && x <= 22)).toBe(true) // hook → body at 20 s
    expect(t.every((x) => x >= 0 && x <= 120)).toBe(true)
    expect(oursAt(60, passage, 90)).toBe(45) // same fraction of a shorter render
  })

  it('parses loudness, holes, colours and pace', () => {
    expect(parseLoudness('{ "input_i" : "-15.31", "input_tp" : "-1.0" }')).toBe(-15.31)
    expect(parseLoudness('"input_i" : "-inf"')).toBeNull()
    const h = parseHoles('silence_start: 10.5\nsilence_end: 13.0 | silence_duration: 2.5\nfreeze_start: 40\nfreeze_end: 47')
    expect(h).toEqual({ silences: [{ fromS: 10.5, toS: 13 }], freezes: [{ fromS: 40, toS: 47 }] })
    const px = new Uint8Array([...Array(30).fill([10, 20, 60]).flat(), ...Array(10).fill([250, 180, 0]).flat()])
    expect(dominantColours(px)[0]).toMatchObject({ share: 0.75 })
    expect(scriptPace(Array(200).fill('mot').join(' '), 60)).toBe(200)
  })
})

describe('P7 blind judge', () => {
  const items = [{ label: 'A', video: 'https://youtu.be/x#t=0,120', frames: ['p7-round-01/ref-01.jpg'] }, { label: 'B', video: 'p6-round-01/ours.mp4', frames: ['p7-round-01/ours-01.jpg'] }]
  const answer = (o: { missing?: boolean; bare?: boolean } = {}): string => JSON.stringify({
    sameChannel: 'no', reason: 'B cuts slower and its palette is warmer',
    scores: COMPARE_AXES.filter((a) => !(o.missing && a === 'captions')).map((axis) => ({ axis, score: axis === 'cadence' ? 55 : 90, defects: o.bare ? [] : [`${axis} differs on frame 3`] }))
  })

  it('never knows which item is the reference and is told to list defects', () => {
    const p = judgePrompt(items, { A: { transcript: 'un', wordsPerMinute: 219, loudnessLufs: -14, cutsPerMinute: 22, music: null }, B: { transcript: 'deux', wordsPerMinute: 190, loudnessLufs: -16, cutsPerMinute: 17, music: null } })
    expect(p).not.toMatch(/\breference\b|\bours\b|reproduc|youtu\.be|\.mp4/i)
    expect(p).toMatch(/SAME YouTube channel/)
    for (const a of COMPARE_AXES) expect(p).toContain(`- ${a}:`)
  })

  it('refuses a score without its defects and an unscored axis', () => {
    expect(parseJudge(answer({ bare: true }), 'j', 0).problems.join()).toMatch(/cadence scored 55 without its defects/)
    expect(parseJudge(answer({ missing: true }), 'j', 0).problems.join()).toMatch(/axis captions not scored/)
    expect(parseJudge('no json', 'j', 0).problems.join()).toMatch(/JSON/)
    expect(parseJudge(answer(), 'j', 0.02).verdict).toMatchObject({ blind: true, sameChannel: 'no', costUsd: 0.02 })
  })

  it('pays once: the saved verdict is reused, a bad answer is retried and its cost kept', async () => {
    const dir = tmp()
    const folder = { abs: path.join(dir, 'p7-round-01'), rel: 'p7-round-01' }
    await import('node:fs').then((fs) => fs.mkdirSync(folder.abs, { recursive: true }))
    const asked: string[] = []
    const replies = [answer({ bare: true }), answer()]
    const judge = blindJudge({
      ask: async ({ prompt }) => { asked.push(prompt); return { text: replies[asked.length - 1]!, costUsd: 0.01, model: 'fake-judge' } },
      strip: async (_f, out) => out,
      heard: async () => ({ transcript: 'mots', wordsPerMinute: 200, loudnessLufs: -14, cutsPerMinute: 20, music: null })
    })
    const v = await judge.blind(items, folder)
    expect(asked).toHaveLength(2)
    expect(v.costUsd).toBeCloseTo(0.02, 5)
    const again = await judge.blind(items, folder)
    expect(asked).toHaveLength(2)
    expect(again).toEqual(v)
    expect(readdirSync(folder.abs).some((f) => f.endsWith('.intent.json'))).toBe(true)
  })
})

describe('P7 render review', () => {
  it('lists held shots, a slow hook, voice holes, loudness and pace against the definition', () => {
    const def = DEFINITION_DEFAULTS_FOR_TESTS()
    const m = measures({ cutsS: [9, 20, 23, 26], durationS: 60, loudnessLufs: -20, wordsPerMinute: 120 })
    const d = renderDefects(m, { silences: [{ fromS: 30, toS: 34 }], freezes: [] }, def, 120)
    const text = d.map((x) => x.description).join(' | ')
    expect(text).toMatch(/held/)
    expect(text).toMatch(/hook cuts every/)
    expect(text).toMatch(/voice hole of 4 s/)
    expect(text).toMatch(/loudness -20 LUFS/)
    expect(text).toMatch(/render lasts 60 s for a 120 s passage/)
    expect(d.find((x) => x.description.startsWith('voice hole'))?.weight).toBeGreaterThanOrEqual(0.8)
  })
})

describe('P8 cause finder', () => {
  const round = (curves: { name: string; axis: 'cadence' | 'voice'; reference: number[]; ours: number[]; distance: number }[]): Round => ({
    schema: 'atelier.clone.round/1', cloneId: 'c1', createdAt: 'now', n: 1, stage: 'compared', definitionVersion: 1, production,
    comparison: {
      pairs: Array.from({ length: 6 }, (_, i) => ({ atS: i, reference: `r${i}.jpg`, ours: `o${i}.jpg`, sideBySide: `p${i}.jpg` })), blindKey: { A: 'reference', B: 'ours' }, curves, defects: [{ axis: 'voice', atS: null, description: 'voice too slow', weight: 0.5 }], sheet: 's.json',
      verdict: { blind: true, sameChannel: 'no', scores: COMPARE_AXES.map((axis) => ({ axis, score: 70, defects: [`${axis} off`] })), reason: 'r', judge: 'j' }
    },
    changes: [], improvedAxes: [], regressedAxes: [], decision: null
  })

  it('changes the definition when it says something else than the reference', () => {
    const def = DEFINITION_DEFAULTS_FOR_TESTS()
    const r = round([{ name: 'pace', axis: 'voice', reference: [219], ours: [150], distance: 0.31 }])
    const c = curveChanges(r, def, null, {})
    expect(c[0]).toMatchObject({ cause: 'definition', target: 'voice.wordsPerMinute', after: 219 })
    expect(c[0]!.fixes.join()).toMatch(/voice: voice too slow/)
    expect(checkP8({ ...r, stage: 'improved', decision: 'continue', changes: c }, def).ok).toBe(true)
  })

  it('calibrates the brick when the definition already says the reference value', () => {
    const def = DEFINITION_DEFAULTS_FOR_TESTS({ 'voice.wordsPerMinute': 219, 'script.wordsPerMinute': 219 })
    const r = round([{ name: 'pace', axis: 'voice', reference: [219], ours: [190], distance: 0.13 }])
    const c = curveChanges(r, def, null, withFactor({}, 'voice.tts', 'voice.wordsPerMinute', 1.05, 'earlier'))
    expect(c[0]).toMatchObject({ cause: 'rule', target: calibrationTarget('voice.tts', 'voice.wordsPerMinute'), before: 1.05 })
    expect(c[0]!.after).toBeCloseTo(1.05 * (219 / 190), 3)
  })

  it('keeps only model fixes aimed at real, non-user definition fields', () => {
    const def = DEFINITION_DEFAULTS_FOR_TESTS()
    const text = JSON.stringify({ changes: [
      { target: 'captions.burnIn', after: true, why: 'the reference burns captions', fixes: ['captions: none on ours'] },
      { target: 'nothing.here', after: 1, why: 'x', fixes: ['x'] },
      { target: 'captions.maxWordsPerCue', after: 'three', why: 'wrong type', fixes: ['x'] }
    ] })
    expect(parseFixes(text, def).map((c) => c.target)).toEqual(['captions.burnIn'])
    // a list of strings stays a list of strings (real round 2 proposed font objects)
    expect(parseFixes(JSON.stringify({ changes: [{ target: 'motion.fonts', after: [{ family: 'sans' }], why: 'x', fixes: ['palette: x'] }] }), def)).toEqual([])
  })

  it('turns the judge\'s anonymous items back into the reference and ours for the fixer', () => {
    expect(unblind("A's scenes are warmer than B; Bezos and AB stay", { A: 'ours', B: 'reference' })).toBe("ours's scenes are warmer than the reference; Bezos and AB stay")
    const r = round([])
    const flipped = { ...r, comparison: { ...r.comparison!, blindKey: { A: 'ours' as const, B: 'reference' as const }, verdict: { ...r.comparison!.verdict, scores: COMPARE_AXES.map((axis) => ({ axis, score: 70, defects: ['A is warmer than B'] })) } } }
    expect(axisDefects(flipped, 'palette')[0]).toBe('palette: ours is warmer than the reference')
  })
})

describe('P6 passage and the real runner', () => {
  const corpus = { videos: [video] } as unknown as Corpus
  it('moves across the part and layout changes, 60–180 s, the same every round', () => {
    const p = pickPassage(corpus, [analysis])
    expect(p.toS - p.fromS).toBeGreaterThanOrEqual(120)
    expect(p.toS - p.fromS).toBeLessThanOrEqual(180)
    expect(passageChanges(analysis).some((t) => t > 0 && t <= p.toS)).toBe(true)
    expect(pickPassage(corpus, [analysis])).toEqual(p)
  })

  it('refuses a render far from its passage', () => {
    const r = { schema: 'atelier.clone.round/1' as const, cloneId: 'c1', createdAt: 'now', n: 1, stage: 'produced' as const, definitionVersion: 1, production: { ...production, durationS: 40, usdPerMinute: 1.5, makeSecondsPerMinute: 360 }, comparison: null, changes: [], improvedAxes: [], regressedAxes: [], decision: null }
    expect(checkP6(r, () => true, 600).problems.join()).toMatch(/render of 40s for a passage of 120s/)
  })

  it('applies calibration to the recipe, saves the production, never pays twice, records re-runs', async () => {
    const dataDir = tmp()
    const cloneDir = path.join(dataDir, 'clones', 'c1')
    const fs = await import('node:fs')
    const plan: PipelinePlan = {
      schema: 'atelier.clone.pipeline-plan/1', cloneId: 'c1', createdAt: 'now', definitionVersion: 1,
      bricks: [{ node: 'script.write@2', fromBase: 'pov@1', role: 'script' }, { node: 'voice.tts@1', fromBase: 'pov@1', role: 'voice' }],
      settings: [{ key: 'voice.tts.wpm', value: 200, fields: ['voice.wordsPerMinute'] }], slots: [], missingBricks: [],
      recipe: { bricks: [{ tech: 'script.write@2', settings: { wpm: 200 } }, { tech: 'voice.tts@1', settings: { wpm: 200 } }] }
    }
    const cal = withFactor({}, 'voice.tts', 'voice.wordsPerMinute', 1.1, 'test')
    expect((calibrate(plan.recipe, plan, cal) as { bricks: { settings: { wpm: number } }[] }).bricks.map((b) => b.settings.wpm)).toEqual([200, 220])
    fs.mkdirSync(path.join(dataDir, 'clones'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'clones', 'calibration.json'), JSON.stringify(cal))
    expect(loadCalibration(dataDir)['voice.tts:voice.wordsPerMinute']?.factor).toBe(1.1)
    const src = path.join(dataDir, 'render.mp4')
    fs.writeFileSync(src, 'video')
    let calls = 0
    const producer: Producer = { produce: async (o) => { calls++; expect(o.idea).toMatch(/OUR OWN script/); return { runId: `run-${calls}`, spentUsd: 0.9, videoFile: src, durationS: 118, scriptText: 'notre script', nodes: [{ id: 'script', state: calls > 1 ? 'cached' : 'done' }, { id: 'voice', state: 'done' }], timeline: null } } }
    const runs = planRunner({ producer, dataDir, analysis: () => analysis, now: (() => { let t = 0; return () => (t += 60_000) })() })
    const def = DEFINITION_DEFAULTS_FOR_TESTS()
    const dir1 = { abs: path.join(cloneDir, 'p6-round-01'), rel: 'p6-round-01' }
    fs.mkdirSync(dir1.abs, { recursive: true })
    const p1 = await runs.produce(plan, def, passage, dir1, 5)
    expect(p1).toMatchObject({ videoPath: 'p6-round-01/ours.mp4', durationS: 118, costUsd: 0.9, makeSeconds: 60 })
    expect(JSON.parse(readFileSync(path.join(dir1.abs, 'recipe.json'), 'utf8')).bricks[1].settings.wpm).toBe(220)
    expect(await runs.produce(plan, def, passage, dir1, 5)).toEqual(p1)
    expect(calls).toBe(1)
    const dir2 = { abs: path.join(cloneDir, 'p6-round-02'), rel: 'p6-round-02' }
    fs.mkdirSync(dir2.abs, { recursive: true })
    const p2 = await runs.produce(plan, def, passage, dir2, 5)
    expect(p2.bricks).toMatchObject({ rerun: ['voice'], reused: ['script'] })
    expect(existsSync(path.join(dir2.abs, 'script.txt'))).toBe(true)
  })

  it('cache keys: the first changed brick and every later one re-run', () => {
    const plan = { bricks: [{ node: 'script.write@2' }, { node: 'voice.tts@1' }, { node: 'director.pov@1' }], settings: [{ key: 'director.pov.shotS', value: 2.7, fields: ['editing.meanShotS'] }] } as unknown as PipelinePlan
    const k1 = brickKeys(plan)
    const k2 = brickKeys({ ...plan, settings: [{ key: 'director.pov.shotS', value: 2.4, fields: ['editing.meanShotS'] }] })
    expect(rerunPlan(plan, k2, k1)).toEqual({ rerun: ['director.pov@1'], reused: ['script.write@2', 'voice.tts@1'] })
    expect(rerunPlan(plan, k1, k1).rerun).toEqual([])
    expect(rerunPlan(plan, k1, null).rerun).toHaveLength(3)
  })
})

export type { StyleDefinition }

describe('P8 resume safety and judge noise', () => {
  it('a move within the judge noise is neither an improvement nor a regression', async () => {
    const { axisDelta } = await import('../../src/main/production/clone/p8-improve')
    const s = (n: number) => COMPARE_AXES.map((axis) => ({ axis, score: n, defects: ['x'] }))
    expect(axisDelta(s(84), s(80))).toEqual({ improved: [], regressed: [] })
    expect(axisDelta(s(90), s(80)).improved).toHaveLength(COMPARE_AXES.length)
    expect(axisDelta(s(70), s(80)).regressed).toHaveLength(COMPARE_AXES.length)
  })

  it('a P8 re-run after a crash never multiplies a calibration factor twice', async () => {
    const { applyRules } = await import('../../src/main/production/clone/p8-improve')
    const dataDir = tmp()
    const change = { cause: 'rule' as const, target: calibrationTarget('voice.tts', 'voice.wordsPerMinute'), before: 1, after: 1.1, why: 'slow', fixes: ['voice: slow'] }
    const r = { cloneId: 'c1', n: 2 } as Round
    applyRules(dataDir, [change], r)
    applyRules(dataDir, [{ ...change, before: 1.1, after: 1.21 }], r)
    expect(loadCalibration(dataDir)['voice.tts:voice.wordsPerMinute']?.factor).toBe(1.1)
  })
})
