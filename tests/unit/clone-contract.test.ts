// The cloning engine's contract (decision 0095): each phase's exit check refuses an incomplete output, and the rule
// « bricks from bases, style from the definition » holds in code (plan-rules.ts).
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPARE_AXES, REQUIRED_CURVES, atPath, withAtPath, type Brief, type Sourced, type Feasibility, type Round, type StyleDefinition } from '../../src/shared/clone'
import { BASE_PIPELINES } from '../../src/engine/technologies/bases'
import { definitionDefaults } from '../../src/main/production/clone/definition-defaults'
import { phaseContext } from '../../src/main/production/clone/context'
import { fakeChannel, fakeCorpus } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { deterministicSynthesis } from '../../src/main/production/clone/fakes/synthesis'
import { checkP0, runP0 } from '../../src/main/production/clone/p0-intake'
import { checkP1 } from '../../src/main/production/clone/p1-corpus'
import { checkP2Video } from '../../src/main/production/clone/p2-analysis'
import { checkP3, runP3 } from '../../src/main/production/clone/p3-feasibility'
import { checkP4, runP4 } from '../../src/main/production/clone/p4-definition'
import { buildPlan, checkP5 } from '../../src/main/production/clone/p5-plan'
import { checkP7 } from '../../src/main/production/clone/p7-compare'
import { checkP9 } from '../../src/main/production/clone/p9-example'
import { baseDefaults, settingProblems, settingsFromDefinition } from '../../src/main/production/clone/plan-rules'
import { CloneStore } from '../../src/main/production/clone/store'

async function world(kind: 'presenter-motion' | 'full-3d' = 'presenter-motion', own = false) {
  const ch = fakeChannel(kind)
  const { services } = fakeServices(ch, { ownClones: own })
  const store = new CloneStore(mkdtempSync(path.join(os.tmpdir(), 'clone-contract-')), 'c1')
  const ctx = phaseContext(store, services, 10)
  const brief: Brief = await runP0(ctx, {
    intent: own ? 'own-channel' : 'copy-channel', references: [{ url: ch.url, kind: 'channel', axes: [] }], style: null, language: 'fr',
    sourceLanguage: null, testBudgetUsd: 10, humanInputs: { face: false, voice: false, footage: false }, ownChannel: own, said: []
  })
  const videos = fakeCorpus(ch)
  const analyses = videos.map((v) => ch.analyse(v, 'p2'))
  const synthesis = { schema: 'atelier.clone.synthesis/1' as const, cloneId: 'c1', createdAt: 'now', ...deterministicSynthesis(analyses) }
  const feasibility: Feasibility = await runP3(ctx, brief, synthesis, analyses)
  const def: StyleDefinition = await runP4(ctx, brief, synthesis, feasibility)
  return { ch, ctx, brief, videos, analyses, synthesis, feasibility, def }
}

describe('exit checks', () => {
  it('P0 refuses a translation without a source language', async () => {
    const w = await world()
    expect(checkP0(w.brief).ok).toBe(true)
    expect(checkP0({ ...w.brief, intent: 'translate' }).problems.join()).toMatch(/source language/)
  })

  it('P1 refuses a channel corpus too small to see the style', async () => {
    const w = await world()
    const corpus = { schema: 'atelier.clone.corpus/1' as const, cloneId: 'c1', createdAt: 'now', mode: 'channel' as const, channelVideoCount: 9, videos: w.videos.slice(0, 2) }
    expect(checkP1(corpus, w.brief).problems.join()).toMatch(/needs 5/)
    expect(checkP1({ ...corpus, channelVideoCount: 2 }, w.brief).ok).toBe(true)
  })

  it('P2 refuses a video read only partly without saying so', async () => {
    const w = await world()
    const a = w.analyses[0]!
    expect(checkP2Video(a).ok).toBe(true)
    const partly = { ...a, coverage: { ...a.coverage, readS: 120, complete: false, gaps: [{ fromS: 120, toS: 300, why: 'download stopped' }], said: null } }
    expect(checkP2Video(partly).problems.join()).toMatch(/without saying so/)
    expect(checkP2Video({ ...partly, coverage: { ...partly.coverage, said: 'only the first two minutes could be read' } }).ok).toBe(true)
    const passedOff = { ...a, coverage: { ...a.coverage, readS: 120 } }
    expect(checkP2Video(passedOff).problems.join()).toMatch(/marked complete/)
  })

  it('P3 refuses an alternative that borrows another look or drops the channel palette', async () => {
    const w = await world('full-3d')
    expect(w.feasibility.verdict).toBe('not-reproducible')
    expect(checkP3(w.feasibility).ok).toBe(true)
    const alt = w.feasibility.alternatives[0]!
    const borrowed = { ...w.feasibility, alternatives: [{ ...alt, borrowsLookFrom: 'markets-of-the-past' }] }
    expect(checkP3(borrowed).problems.join()).toMatch(/borrows the look/)
    const dropped = { ...w.feasibility, alternatives: [{ ...alt, keeps: { ...alt.keeps, palette: false } }] }
    expect(checkP3(dropped).problems.join()).toMatch(/palette/)
    expect(checkP3({ ...w.feasibility, verdict: 'partly' }).problems.join()).toMatch(/does not follow/)
  })

  it('P4 refuses a field marked default although the analysis measured it', async () => {
    const w = await world()
    expect(checkP4(w.def, w.synthesis, w.brief).ok).toBe(true)
    const lazy = withAtPath(w.def, 'editing.meanShotS', { value: 4, source: 'default', evidence: [] })
    expect(checkP4(lazy, w.synthesis, w.brief).problems.join()).toMatch(/editing.meanShotS is marked default although the analysis measured it/)
  })

  it('P4 refuses the user own presenter on a third party channel, and too few angles', async () => {
    const w = await world()
    const third = withAtPath(w.def, 'presenter.mode', { value: 'own', source: 'user', evidence: [], note: 'x' })
    expect(checkP4(third, w.synthesis, w.brief).problems.join()).toMatch(/never the third party/)
    const oneAngle = withAtPath(w.def, 'presenter.configurations', { ...w.def.presenter.configurations, value: w.def.presenter.configurations.value.filter((c) => c.angle === 0) })
    expect(checkP4(oneAngle, w.synthesis, { ...w.brief }).problems.join()).toMatch(/1 presenter angles configured, 2 measured/)
  })

  it('P3 refuses elements that do not cover the whole video, and an impossible element without its cost', async () => {
    const w = await world('full-3d')
    const dropped = { ...w.feasibility, elements: w.feasibility.elements.filter((e) => e.how !== 'impossible') }
    expect(checkP3(dropped).problems.join()).toMatch(/an element is missing/)
    const free = { ...w.feasibility, elements: w.feasibility.elements.map((e) => (e.missing ? { ...e, missing: { ...e.missing, buildCostUsd: null, importCostUsd: null } } : e)) }
    expect(checkP3(free).problems.join()).toMatch(/without the cost/)
  })

  it('P4 refuses a definition of defaults, and a look-alike on the user own channel', async () => {
    const w = await world()
    expect(checkP4(w.def, { ...w.synthesis, constants: [] }, w.brief).problems.join()).toMatch(/editing.meanShotS was not measured/)
    expect(checkP4(w.def, w.synthesis, { ...w.brief, ownChannel: true }).problems.join()).toMatch(/his own channel: his existing presenter/)
    const own = await world('presenter-motion', true)
    expect(checkP4(own.def, own.synthesis, own.brief).ok).toBe(true)
  })

  it('P7 refuses a comparison that is not saved, and a score without its defects', () => {
    const pairs = Array.from({ length: 6 }, (_, i) => ({ atS: i, reference: `r${i}.jpg`, ours: `o${i}.jpg`, sideBySide: `p${i}.jpg` }))
    const round: Round = {
      schema: 'atelier.clone.round/1', cloneId: 'c1', createdAt: 'now', n: 1, stage: 'compared', definitionVersion: 1,
      production: { passage: { videoId: 'v1', fromS: 0, toS: 120 }, videoPath: 'ours.mp4', scriptPath: 's.txt', durationS: 120, costUsd: 1, makeSeconds: 60, usdPerMinute: 0.5, makeSecondsPerMinute: 30, runs: [] },
      comparison: {
        pairs, blindKey: { A: 'ours', B: 'reference' },
        curves: REQUIRED_CURVES.map((name) => ({ axis: 'cadence' as const, name, reference: [1], ours: [2], distance: 1 })), defects: [],
        verdict: { blind: true, sameChannel: 'yes', scores: COMPARE_AXES.map((axis) => ({ axis, score: axis === 'layout' ? 80 : 100, defects: [] })), reason: 'r', judge: 'j' }, sheet: 'sheet.json'
      },
      changes: [], improvedAxes: [], regressedAxes: [], decision: null
    }
    const none = checkP7(round, () => false).problems.join()
    expect(none).toMatch(/sheet.json not saved/)
    expect(none).toMatch(/frame r0.jpg not saved/)
    expect(checkP7(round, () => true).problems.join()).toMatch(/layout scored 80 without its defects/)
    const fixed = { ...round, comparison: { ...round.comparison!, verdict: { ...round.comparison!.verdict, scores: COMPARE_AXES.map((axis) => ({ axis, score: 100, defects: [] })) } } }
    expect(checkP7(fixed, () => true).ok).toBe(true)
    const oneCurve = { ...fixed, comparison: { ...fixed.comparison, curves: fixed.comparison.curves.slice(0, 1) } }
    expect(checkP7(oneCurve, () => true).problems.join()).toMatch(/curve layout-share not compared/)
    const notMixed = { ...fixed, comparison: { ...fixed.comparison, blindKey: { A: 'ours' as const } } }
    expect(checkP7(notMixed, () => true).problems.join()).toMatch(/does not mix/)
    expect(checkP7({ ...round, comparison: null }, () => true).problems.join()).toMatch(/did not happen/)
  })

  it('P9 refuses to show an example whose blind verdict is not « same channel »', () => {
    const ex = {
      schema: 'atelier.clone.example/1' as const, cloneId: 'c1', createdAt: 'now', definitionVersion: 1, videoPath: 'e.mp4', durationS: 300, costUsd: 2, makeSeconds: 600,
      review: [] as { axis: 'identity'; atS: null; description: string; weight: number }[],
      pairs: Array.from({ length: 6 }, (_, i) => ({ atS: i, reference: `r${i}.jpg`, ours: `o${i}.jpg`, sideBySide: `p${i}.jpg` })),
      blindKey: { A: 'reference' as const, B: 'ours' as const },
      verdict: { blind: true as const, sameChannel: 'no' as const, scores: COMPARE_AXES.map((axis) => ({ axis, score: 50, defects: ['other man'] })), reason: 'not the same presenter', judge: 'j' }
    }
    expect(checkP9(ex, () => true).problems.join()).toMatch(/never shown/)
    const same = { ...ex, verdict: { ...ex.verdict, sameChannel: 'yes' as const } }
    expect(checkP9(same, () => true).ok).toBe(true)
    expect(checkP9({ ...same, review: [{ axis: 'identity', atS: null, description: 'another man', weight: 0.9 }] }, () => true).problems.join()).toMatch(/blocking defect/)
  })
})

describe('the rule: bricks from bases, style from the Style Definition', () => {
  it('a measured definition yields a plan with no base default unless measured equal', async () => {
    const w = await world()
    const plan = buildPlan(w.ctx, w.brief, w.def, w.feasibility)
    expect(checkP5(plan, w.def).ok).toBe(true)
    const defaults = baseDefaults(BASE_PIPELINES)
    for (const s of plan.settings) {
      const baseValues = defaults.get(s.key) ?? []
      if (!baseValues.some((b) => JSON.stringify(b) === JSON.stringify(s.value))) continue
      // equal to a base default: only allowed when every field it comes from was measured (or is the definition's own default)
      for (const f of s.fields) {
        const field = atPath(w.def, f) as Sourced
        const own = atPath(definitionDefaults(), f) as Sourced
        const ok = field.source !== 'default' || JSON.stringify(field.value) === JSON.stringify(own.value)
        expect(ok, `${s.key} = ${JSON.stringify(s.value)} from ${f} (${field.source})`).toBe(true)
      }
    }
    // the measured values, not the bases' (avatar@1: music 'none', presenterShots 'single', presenterLayouts 'all')
    const get = (k: string): unknown => plan.settings.find((s) => s.key === k)?.value
    expect(get('music')).toBe('light electronic')
    expect(get('presenterShots')).toBe('multi')
    expect(get('presenterLayouts')).toEqual(['full', 'half-left', 'inset'])
    // bricks may come from bases, never options
    expect(plan.bricks.map((b) => b.node)).toContain('motion.render')
  })

  it('refuses a setting copied from a base default the analysis did not measure, and a plan without its settings', async () => {
    const w = await world()
    const plan = buildPlan(w.ctx, w.brief, w.def, w.feasibility)
    expect(checkP5({ ...plan, settings: [] }, w.def).problems.join()).toMatch(/setting music is missing/)
    const copied = { ...plan, settings: plan.settings.map((s) => (s.key === 'music' ? { ...s, value: 'none' } : s)) }
    expect(settingProblems(copied, w.def, BASE_PIPELINES).join()).toMatch(/music = "none" is not the definition's value/)
    const extra = { ...plan, settings: [...plan.settings, { key: 'quality.images', value: 'eco', fields: ['sourcing.grade'] }] }
    expect(settingProblems(extra, w.def, BASE_PIPELINES).join()).toMatch(/quality.images is not computed from the Style Definition/)
  })

  it('refuses a base default smuggled into the definition as « default »', async () => {
    const w = await world()
    // music left « default » but switched on with a base-looking genre: not the definition's own default, refused
    const smuggled = withAtPath(w.def, 'sound.musicGenre', { value: 'none', source: 'default', evidence: [] })
    const unmeasured = withAtPath(smuggled, 'sound.music', { value: true, source: 'default', evidence: [] })
    const problems = settingProblems({ settings: settingsFromDefinition(unmeasured) }, unmeasured, BASE_PIPELINES).join()
    expect(problems).toMatch(/sound.music is marked default but is not the definition's own default/)
    expect(problems).toMatch(/is a base pipeline default not measured on the reference/)
  })

  it('accepts an untouched definition default equal to a base default (nothing was measured)', async () => {
    const w = await world()
    // captions were not measured: the definition's own default (false) equals avatar@1's default and is allowed
    expect(w.def.captions.burnIn.source).toBe('default')
    expect(settingProblems({ settings: settingsFromDefinition(w.def) }, w.def, BASE_PIPELINES)).toEqual([])
  })
})
