// Chantier H (moteur-base-existante, decision 0112): P4/P5 start from a ready base when one fits the channel, every base
// setting checked against the measurements (kept only when measured equal, replaced otherwise, dropped when nothing measured
// it), and build from zero when no base fits. Fakes and fixtures only: no network, no money.
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Round, StyleDefinition, atPath, sourcedFields, withAtPath, type Sourced } from '../../src/shared/clone'
import { AVATAR_MARCEL, READY_BASES, type BaseField, type ReadyBase } from '../../src/main/production/clone/definition/base-registry'
import { BASE_FIT_MIN, matchBase } from '../../src/main/production/clone/definition/base-match'
import { baseNote, startFromBase, toleranceOf, withinTolerance } from '../../src/main/production/clone/definition/base-start'
import { MARCEL, MONDE_POV, YARNHUB } from '../../src/main/production/clone/definition/fixtures/profiles'
import type { ChannelProfile } from '../../src/main/production/clone/definition/fixtures/build'
import { runDefinition, type DefinitionRun } from '../../src/main/production/clone/definition/fixtures/run'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { runClone } from '../../src/main/production/clone/orchestrator'
import type { IntakeAnswers } from '../../src/main/production/clone/p0-intake'
import { checkP4 } from '../../src/main/production/clone/p4-definition'
import { buildPlan, checkP5 } from '../../src/main/production/clone/p5-plan'
import { phaseContext } from '../../src/main/production/clone/context'
import { CloneStore } from '../../src/main/production/clone/store'

/** An avatar channel that is NOT Marcel: another man, his own layouts (inset-heavy), a faster voice, faster cuts, same kind of pictures. */
const OTHER_AVATAR: ChannelProfile = (() => {
  const p = structuredClone(MARCEL)
  p.id = 'garage-avatar'
  p.url = 'https://www.youtube.com/@fake-garage-avatar'
  p.titles = ['Ce que votre garagiste ne vous dit pas', '3 bruits de moteur à ne jamais ignorer']
  p.presenter.identity = { age: 'forties', gender: 'man', face: 'short beard', hair: 'dark, short', wardrobe: 'black mechanic jacket', setting: 'car workshop, lifted car behind', lighting: 'cold neon' }
  p.voice = { kind: 'real', timbre: 'middle-aged male, fast, Parisian French', wpm: 172, pausesPerMinute: 4, meanPauseS: 0.3, energy: 'high' }
  const P = (lengthS: number, layout: 'full' | 'inset' | 'half-left'): ChannelProfile['parts'][number]['cycle'][number] => ({ kind: 'presenter', origin: 'presenter', lengthS, layout, angle: 0, shows: 'mechanic to camera, workshop' })
  const G = (lengthS: number, shows: string, layout?: 'inset' | 'half-left'): ChannelProfile['parts'][number]['cycle'][number] => ({ kind: 'generated', origin: 'generated', lengthS, shows, ...(layout ? { layout, angle: 0 } : {}) })
  p.parts = [
    { part: 'hook', share: 0.06, cycle: [P(3, 'full'), G(2.6, 'engine bay close-up'), G(2.6, 'warning light on a dashboard')] },
    { part: 'promo', share: 0.02, cycle: [{ kind: 'title-card', origin: 'motion', lengthS: 12, shows: 'offer card' }] },
    { part: 'body', share: 0.86, cycle: [G(2.8, 'brake disc', 'inset'), G(3, 'oil dipstick'), G(2.7, 'timing belt', 'inset'), G(2.9, 'tyre tread'), G(3.1, 'spark plug', 'inset'), G(2.6, 'air filter')] },
    { part: 'end', share: 0.06, cycle: [G(3, 'car leaving the workshop', 'inset'), { kind: 'title-card', origin: 'motion', lengthS: 10, shows: 'end card' }] }
  ]
  return p
})()

const ok = (r: DefinitionRun): void => expect(checkP4(r.definition, r.synthesis, r.brief, [], r.analyses).problems).toEqual([])

/** A base made of a definition's measured fields (what a base is: the measured style of a channel done well). */
function baseFrom(def: StyleDefinition, over: Partial<ReadyBase> = {}): ReadyBase {
  const style: Record<string, BaseField> = {}
  for (const { path: p, field } of sourcedFields(def)) if (field.source === 'measured' && !/\.\d+(\.|$)/.test(p)) style[p] = { value: field.value, evidence: field.evidence }
  return { id: 'test-base', pipelineId: 'avatar@1', goodFor: 'test', source: 'test fixture', style, earned: [], proof: null, ...over }
}

describe('ready bases: the registry and the match', () => {
  it('the avatar base carries only measured fields of Marcel, never what the user says', () => {
    expect(READY_BASES.map((b) => b.id)).toContain('avatar-marcel')
    const paths = Object.keys(AVATAR_MARCEL.style)
    expect(paths.length).toBeGreaterThan(40)
    for (const p of ['presenter.mode', 'presenter.presenterRef', 'voice.mode', 'voice.voiceRef', 'voice.language', 'cost.usdPerMinute']) expect(paths).not.toContain(p)
    for (const p of paths) expect(AVATAR_MARCEL.style[p]!.evidence.length).toBeGreaterThan(0)
  })

  it('an avatar-like channel fits the avatar base, with a score and why', async () => {
    const r = await runDefinition(OTHER_AVATAR)
    const m = matchBase(r.definition, READY_BASES)
    expect(m.base?.id).toBe('avatar-marcel')
    expect(m.candidates[0]!.score).toBeGreaterThanOrEqual(BASE_FIT_MIN)
    expect(m.candidates[0]!.why.join(' ')).toMatch(/origins of the pictures/)
  })

  it('a full-animation channel (no presenter, drawn) and an all-3D one fit no base: built from zero, and the record says why', async () => {
    for (const p of [MONDE_POV, YARNHUB]) {
      const r = await runDefinition(p)
      expect(r.definition.baseStart?.from).toBe('zero')
      expect(r.definition.baseStart?.candidates[0]).toMatchObject({ id: 'avatar-marcel', fits: false, score: 0 })
      expect(r.definition.baseStart?.candidates[0]!.why[0]).toMatch(/no presenter|drawn or 3D/)
      // nothing from a base anywhere
      expect(sourcedFields(r.definition).filter((f) => (f.field.note ?? '').startsWith('base '))).toEqual([])
      ok(r)
    }
  })
})

describe('P4 starts from the avatar base and checks every setting', () => {
  it('another avatar channel: character, layouts, voice and rhythm replaced by the measurement; equal settings kept with evidence', async () => {
    const r = await runDefinition(OTHER_AVATAR)
    const s = r.definition.baseStart!
    expect(s).toMatchObject({ from: 'base', baseId: 'avatar-marcel', pipelineId: 'avatar@2' })
    const replaced = s.replaced.map((x) => x.field)
    for (const f of ['presenter.identity', 'presenter.layoutCurve', 'voice.timbre', 'voice.wordsPerMinute', 'script.wordsPerMinute', 'editing.meanShotS', 'editing.hookMeanShotS']) expect(replaced).toContain(f)
    // the replaced fields hold THIS channel's measurement, never Marcel's
    expect((r.definition.presenter.identity.value as { wardrobe: string }).wardrobe).toBe('black mechanic jacket')
    expect(r.definition.voice.wordsPerMinute.value).toBe(172)
    // what is equal is kept (no music, no burnt-in captions, hard cuts) and says so, with this channel's own evidence first
    const kept = s.kept.map((x) => x.field)
    for (const f of ['sound.music', 'captions.burnIn', 'editing.transitions']) expect(kept).toContain(f)
    const music = r.definition.sound.music as Sourced
    expect(music.evidence.length).toBeGreaterThan(0)
    expect(music.evidence.every((e) => e.video?.startsWith('garage-avatar'))).toBe(true)
    expect(music.note).toMatch(/^base avatar-marcel: measured equal/)
    // every base setting got a decision
    expect(s.kept.length + s.replaced.length + s.dropped.length + s.earned.length).toBe(Object.keys(AVATAR_MARCEL.style).length)
    expect(s.savings.fieldsChecked).toBe(Object.keys(AVATAR_MARCEL.style).length)
    // not his channel: the presenter is a look-alike placeholder of THIS channel's type, never Marcel
    expect(r.definition.presenter.mode.value).toBe('look-alike-placeholder')
    expect(r.definition.presenter.placeholder.value?.type.wardrobe).toBe('black mechanic jacket')
    ok(r)
  })

  it('Marcel himself: every base setting is measured equal, nothing replaced; his own presenter and voice', async () => {
    const r = await runDefinition(MARCEL, { ownChannel: true })
    const s = r.definition.baseStart!
    expect(s.from).toBe('base')
    expect(s.replaced).toEqual([])
    expect(s.kept.length).toBeGreaterThan(40)
    expect(r.definition.presenter.mode.value).toBe('own')
    expect(r.definition.voice.mode.value).toBe('user-clone')
    ok(r)
  })

  it('an unproven base changes no value: the definition is exactly the from-zero one plus its record', async () => {
    const r = await runDefinition(OTHER_AVATAR)
    const strip = (d: StyleDefinition): unknown => sourcedFields({ ...d, baseStart: null }).map((f) => [f.path, f.field.value, f.field.source])
    const ctxFree = startFromBase({ ...r.definition, baseStart: null }, [])
    expect(ctxFree.record.from).toBe('zero')
    expect(strip(r.definition)).toEqual(strip(ctxFree.definition))
  })
})

describe('the rule « no base setting without measured proof »', () => {
  it('a base value nothing measured here is dropped: the definition keeps its own default', async () => {
    const r = await runDefinition(OTHER_AVATAR)
    const zero = { ...r.definition, baseStart: null }
    expect(zero.sound.musicLevelUnderVoiceDb.source).toBe('default')
    const base = baseFrom(zero, { style: { ...baseFrom(zero).style, 'sound.musicLevelUnderVoiceDb': { value: -30, evidence: [{ frames: [], note: 'base ref' }] } } })
    const { definition, record } = startFromBase(zero, [base])
    expect(record.dropped).toContain('sound.musicLevelUnderVoiceDb')
    expect(definition.sound.musicLevelUnderVoiceDb).toMatchObject({ value: -24, source: 'default' })
  })

  it('a proven base keeps its value only within the measurement tolerance; beyond it the measurement replaces it', async () => {
    const r = await runDefinition(OTHER_AVATAR)
    const zero = { ...r.definition, baseStart: null }
    const proof = { rounds: 3, sameChannel: true, usdPerMinute: 0.55, makeMinutesPerMinute: 8, where: 'test' }
    const style = baseFrom(zero).style
    const near: ReadyBase = baseFrom(zero, { proof, style: { ...style, 'script.wordsPerMinute': { value: 175, evidence: [{ frames: [], note: 'base ref' }] } } })
    const a = startFromBase(zero, [near])
    expect(a.definition.script.wordsPerMinute.value).toBe(175) // 172 measured, 175 proven: within 5 %
    expect(a.record.kept.find((k) => k.field === 'script.wordsPerMinute')).toMatchObject({ value: 175, base: 175, measured: 172, proven: true })
    expect(checkP4(a.definition, r.synthesis, r.brief, [], r.analyses, [near]).problems).toEqual([])
    const far: ReadyBase = baseFrom(zero, { proof, style: { ...style, 'script.wordsPerMinute': { value: 191, evidence: [{ frames: [], note: 'base ref' }] } } })
    const b = startFromBase(zero, [far])
    expect(b.definition.script.wordsPerMinute.value).toBe(172)
    expect(b.record.replaced).toContainEqual({ field: 'script.wordsPerMinute', base: 191, measured: 172 })
  })

  it('P4\'s check refuses a base value slipped in without its record, a kept field not measured here, a kept value beyond tolerance', async () => {
    const r = await runDefinition(OTHER_AVATAR)
    const d = r.definition
    // a base value written over an unmeasured field, carrying the base's evidence but no record
    const slipped = withAtPath(d, 'captions.maxWordsPerCue', { value: 3, source: 'measured', evidence: [{ frames: [], note: 'from the base' }], note: baseNote('avatar-marcel', 'kept') } satisfies Sourced)
    expect(checkP4(slipped, r.synthesis, r.brief, [], r.analyses).problems.join('\n')).toMatch(/captions.maxWordsPerCue carries a base's evidence without a kept or earned record/)
    // a kept record on a field this channel did not measure
    const unmeasured = { ...slipped, baseStart: { ...d.baseStart!, kept: [...d.baseStart!.kept, { field: 'captions.maxWordsPerCue', value: 3, base: 3, measured: 3, proven: true }] } }
    expect(checkP4(unmeasured, r.synthesis, r.brief, [], r.analyses).problems.join('\n')).toMatch(/captions.maxWordsPerCue keeps the base's setting but this channel did not measure it/)
    // a « kept » base value far from the measurement
    const wpm = { ...d, baseStart: { ...d.baseStart!, kept: [...d.baseStart!.kept, { field: 'script.wordsPerMinute', value: 191, base: 191, measured: 172, proven: true }] } }
    const forged = withAtPath(wpm, 'script.wordsPerMinute', { value: 191, source: 'measured', evidence: d.script.wordsPerMinute.evidence } satisfies Sourced)
    const problems = checkP4(forged, r.synthesis, r.brief, [], r.analyses).problems.join('\n')
    expect(problems).toMatch(/script.wordsPerMinute differs from the measured value/)
    expect(problems).toMatch(/script.wordsPerMinute keeps the base's setting although it was measured differently/)
  })

  it('an improvement another channel’s base earned applies only where this channel measures the same « before », never to who is on screen; a forged one is refused', async () => {
    const r = await runDefinition(OTHER_AVATAR)
    const zero = { ...r.definition, baseStart: null }
    const proof = { rounds: 2, sameChannel: true, usdPerMinute: 0.55, makeMinutesPerMinute: 8, where: 'test' }
    // the avatar base's own rounds (Marcel's channel): its transitions fix, its cut-pace fix and an identity « fix »
    const marcel: ReadyBase = { ...AVATAR_MARCEL, proof, earned: [
      { round: 1, target: 'editing.transitions', before: ['hard cut'], after: ['hard cut', 'dip'], why: 'the reference dips into its promo card', sheet: 'p7-r1.jpg' },
      { round: 2, target: 'editing.meanShotS', before: 3.86, after: 3.6, why: 'cuts a little faster', sheet: 'p7-r2.jpg' },
      { round: 2, target: 'presenter.identity', before: zero.presenter.identity.value, after: { ...(zero.presenter.identity.value as object), hair: 'grey' }, why: 'forged', sheet: 'x' }
    ] }
    const { definition, record } = startFromBase(zero, [marcel])
    expect(record.earned.map((e) => e.field)).toEqual(['editing.transitions']) // same « before » here (hard cuts)
    expect(definition.editing.transitions.value).toEqual(['hard cut', 'dip'])
    expect(definition.editing.meanShotS.value).toBe(zero.editing.meanShotS.value) // measured 2.8-ish here, not 3.86: not applied
    expect(definition.presenter.identity.value).toEqual(zero.presenter.identity.value) // never earnable
    expect(definition.version).toBe(zero.version + 1)
    expect(checkP4(definition, r.synthesis, r.brief, [], r.analyses, [marcel]).problems).toEqual([])
    // a record that claims an improvement the base never earned
    const forged = { ...definition, baseStart: { ...record, earned: [{ ...record.earned[0]!, after: ['wipe'] }] } }
    const forgedDef = withAtPath(forged, 'editing.transitions', { ...(definition.editing.transitions as Sourced), value: ['wipe'] })
    expect(checkP4(forgedDef, r.synthesis, r.brief, [], r.analyses, [marcel]).problems.join(' | ')).toMatch(/not one base avatar-marcel earned/)
    // a base the engine does not ship
    expect(checkP4(definition, r.synthesis, r.brief, [], r.analyses, []).problems.join(' | ')).toMatch(/not a ready base/)
  })

  it('tolerances: numbers within the field\'s tolerance, everything else exactly', () => {
    expect(withinTolerance(172, 175, toleranceOf('script.wordsPerMinute'))).toBe(true)
    expect(withinTolerance(172, 191, toleranceOf('script.wordsPerMinute'))).toBe(false)
    expect(withinTolerance({ full: 0.2, off: 0.8 }, { full: 0.22, off: 0.78 }, toleranceOf('presenter.layoutCurve'))).toBe(true)
    expect(withinTolerance({ full: 0.2, off: 0.8 }, { inset: 0.2, off: 0.8 }, toleranceOf('presenter.layoutCurve'))).toBe(false)
    expect(withinTolerance(1, 2, toleranceOf('presenter.angleCount'))).toBe(false)
    expect(withinTolerance('serif', 'sans', toleranceOf('motion.fonts'))).toBe(false)
  })
})

describe('P5 starts from the base pipeline\'s bricks', () => {
  it('records which of avatar@1\'s bricks the measurement keeps, adds and drops; a from-zero plan has none', async () => {
    const r = await runDefinition(OTHER_AVATAR)
    const ctx = phaseContext(new CloneStore(mkdtempSync(path.join(os.tmpdir(), 'base-p5-')), 'c1'), fakeServices(fakeChannel('presenter-motion')).services, 1)
    const plan = buildPlan(ctx, r.brief, r.definition, r.feasibility)
    expect(plan.startedFrom).toMatchObject({ baseId: 'avatar-marcel', pipelineId: 'avatar@2' })
    expect(plan.startedFrom!.keptBricks).toEqual(expect.arrayContaining(['voice.tts', 'avatar.speak', 'render.assemble']))
    expect(checkP5(plan, r.definition).problems).toEqual([])
    const pov = await runDefinition(MONDE_POV)
    expect(buildPlan(ctx, pov.brief, pov.definition, pov.feasibility).startedFrom).toBeUndefined()
  })
})

const answers = (url: string): IntakeAnswers => ({
  intent: 'copy-channel', references: [{ url, kind: 'channel', axes: [] }], style: null, language: 'fr', sourceLanguage: null,
  testBudgetUsd: 10, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: ['copie cette chaîne']
})

async function fakeClone(bases: readonly ReadyBase[]) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'base-start-e2e-'))
  const ch = fakeChannel('presenter-motion')
  const { services, state } = fakeServices(ch)
  const report = await runClone({ dataDir, cloneId: 'c1', services: { ...services, readyBases: bases }, answers: answers(ch.url) })
  const dir = path.join(dataDir, 'clones', 'c1')
  const rounds = new CloneStore(dataDir, 'c1').list('p6-round-').map((f) => Round.parse(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))))
  const def = StyleDefinition.parse(JSON.parse(readFileSync(path.join(dir, 'p4-style-definition.json'), 'utf8')))
  const spent = new CloneStore(dataDir, 'c1').spent()
  return { report, state, rounds, def, spent, makeSeconds: rounds.reduce((t, x) => t + x.production.makeSeconds, 0) }
}

describe('time and cost saved, measured on fakes (P0→P10)', () => {
  it('a channel like a proven base clones in fewer rounds, for less money and making time, to the same verdict', async () => {
    const zero = await fakeClone([])
    expect(zero.report.outcome).toBe('cloned')
    expect(zero.def.baseStart?.from).toBe('zero')
    // the base: this kind of channel done well before, its rounds saved (the fake improver's own fix: hook cuts 4 s → 3.7 s)
    const first = zero.rounds[0]!
    const fix = first.changes.find((c) => c.target === 'editing.meanShotS')!
    // the base's style is the measured one (before its rounds), as its P4 measured it
    const style = { ...baseFrom(zero.def).style, 'editing.meanShotS': { value: fix.before, evidence: zero.def.editing.meanShotS.evidence } }
    const base = baseFrom(zero.def, {
      id: 'presenter-motion-proven',
      style,
      proof: { rounds: zero.rounds.length, sameChannel: true, usdPerMinute: 0.5, makeMinutesPerMinute: 4, where: 'fake rounds' },
      earned: [{ round: first.n, target: 'editing.meanShotS', before: fix.before, after: fix.after, why: fix.why, sheet: first.comparison!.sheet }]
    })
    const fromBase = await fakeClone([base])
    expect(fromBase.report.outcome).toBe('cloned')
    expect(fromBase.def.baseStart).toMatchObject({ from: 'base', baseId: 'presenter-motion-proven' })
    expect(fromBase.def.baseStart!.earned.map((e) => e.field)).toEqual(['editing.meanShotS'])
    const saved = {
      renders: [zero.state.produced, fromBase.state.produced],
      judged: [zero.state.judged, fromBase.state.judged],
      usd: [Math.round(zero.spent * 100) / 100, Math.round(fromBase.spent * 100) / 100],
      makeSeconds: [zero.makeSeconds, fromBase.makeSeconds]
    }
    console.log('base start savings on fakes (zero, base):', JSON.stringify(saved))
    expect(fromBase.state.produced).toBeLessThan(zero.state.produced)
    expect(fromBase.state.judged).toBeLessThan(zero.state.judged)
    expect(fromBase.spent).toBeLessThan(zero.spent)
    expect(fromBase.makeSeconds).toBeLessThan(zero.makeSeconds)
    // same final quality: the last round's blind verdict says « same channel » in both
    expect(zero.rounds.at(-1)!.comparison!.verdict.sameChannel).toBe('yes')
    expect(fromBase.rounds.at(-1)!.comparison!.verdict.sameChannel).toBe('yes')
    expect(atPath(fromBase.def, 'editing.meanShotS')).toBeDefined()
  })
})
