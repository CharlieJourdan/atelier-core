// reverse-pipeline (decision 0110): every step of a clone is autonomous — no human approval inside the loop except money beyond
// the test budget. The free gate passed, the first paid round starts straight away; a video the eyes cannot read is set aside;
// the improver's proposals are saved as proposals (never as measurements); a brick change is recorded as « brick to fix »,
// never counted as applied; the P9 judge order is random with its key saved; the judge hears the music of both films; a
// measured brick the plan leaves out is said with why; the intake only requires what has no safe default.
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Brief, COMPARE_AXES, Corpus, PipelinePlan, Round, StyleDefinition, VideoAnalysis, type BlindVerdict, type Change, type IntakeState } from '../../src/shared/clone'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { CloneEngine } from '../../src/main/production/clone/engine'
import { runClone } from '../../src/main/production/clone/orchestrator'
import type { IntakeAnswers } from '../../src/main/production/clone/p0-intake'
import { applyChanges } from '../../src/main/production/clone/p8-improve'
import { runP9 } from '../../src/main/production/clone/p9-example'
import { mixReason } from '../../src/main/production/clone/p5-plan'
import { BRICK_TO_FIX, IMPROVER_NOTE, userChose } from '../../src/main/production/clone/compare/improver'
import { musicHeard, oursMusic, referenceMusic } from '../../src/main/production/clone/compare/services'
import { intakeAnswers, intakeTurn, startIntake } from '../../src/main/production/clone/intake/conversation'
import { phaseContext } from '../../src/main/production/clone/context'
import type { CloneServices } from '../../src/main/production/clone/services'
import { ARTEFACTS, CloneStore } from '../../src/main/production/clone/store'
import { DEFINITION_DEFAULTS_FOR_TESTS } from './clone-compare-fixtures'

const answers = (url: string, budget = 10): IntakeAnswers => ({
  intent: 'copy-channel', references: [{ url, kind: 'channel', axes: [] }], style: null, language: 'fr', sourceLanguage: null,
  testBudgetUsd: budget, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: ['copie cette chaîne']
})
const pass: BlindVerdict = { blind: true, sameChannel: 'yes', reason: 'r', judge: 'j', scores: COMPARE_AXES.map((axis) => ({ axis, score: 85, defects: ['small'] })) }
const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), 'clone-auto-'))

describe('no pause before the first paid round', () => {
  it('the free gate passed, the paid round starts straight away; an old brief asking for the pause parses and is ignored', async () => {
    const dataDir = tmp()
    const ch = fakeChannel('presenter-motion')
    const count = { paid: 0, demos: 0, gateAfterDemo: false }
    const services = (): CloneServices => {
      const { services } = fakeServices(ch)
      const produce = services.runs.produce
      let demo = false
      return {
        ...services,
        runs: { produce: async (...a) => { if (count.demos > 0 && count.paid === 0) count.gateAfterDemo = true; count.paid++; return produce(...a) } },
        demo: { produce: async (plan, def, passage, dir) => { count.demos++; demo = true; return produce(plan, def, passage, dir, 0) } },
        judge: { blind: async (items, dir, o) => { if (demo) { demo = false; return pass } return services.judge.blind(items, dir, o) } }
      }
    }
    const engine = new CloneEngine({ dataDir, services, notify: () => {}, now: () => new Date('2026-11-06T10:00:00Z') })
    // a brief written by the older engine (moteur-pov-2) still carries `reviewBeforePaid`
    const state = { draft: { intent: 'copy-channel', references: [{ url: ch.url, kind: 'channel', axes: [] }], style: null, language: 'fr', sourceLanguage: null, testBudgetUsd: 10, humanInputs: null, ownChannel: false }, said: ['copie'], asked: null, reviewBeforePaid: true } as unknown as IntakeState
    const { cloneId } = engine.start(state)
    await engine.settled(cloneId)
    expect(engine.state(cloneId)).toEqual({ kind: 'done', outcome: 'cloned' })
    expect(count.demos).toBeGreaterThan(0)
    expect(count.gateAfterDemo).toBe(true)
    const dir = path.join(dataDir, 'clones', cloneId)
    expect(readdirSync(dir).some((f) => f.startsWith('review-'))).toBe(false)
    const saved = JSON.parse(readFileSync(path.join(dir, 'p0-brief.json'), 'utf8')) as Record<string, unknown>
    expect('reviewBeforePaid' in saved).toBe(false)
    expect(Brief.safeParse({ ...saved, reviewBeforePaid: true }).success).toBe(true)
  })
})

describe('downloads the platform refused (the reverse proofs, 2026-11-06)', () => {
  it('a refused download is not set aside for good; too few videos read stops P2 resumably, and a resume reads them', async () => {
    const dataDir = tmp()
    const ch = fakeChannel('presenter-motion')
    const { services } = fakeServices(ch)
    const analyse = services.eyes.analyse
    let blocked = true
    let calls = 0
    services.eyes = { analyse: async (v, dir) => { if (blocked && ++calls > 1) throw new Error('yt-dlp exited 1: ERROR: [youtube] x: Sign in to confirm you’re not a bot.'); return analyse(v, dir) } }
    await expect(runClone({ dataDir, cloneId: 'c1', services, answers: answers(ch.url) })).rejects.toMatchObject({ name: 'ExitRefused', phase: 'p2' })
    const store = new CloneStore(dataDir, 'c1')
    expect(store.decisions().at(-1)).toMatchObject({ phase: 'p2', decision: 'stop' })
    expect(store.decisions().some((d) => /not read now/.test(d.decision))).toBe(true)
    expect(readdirSync(store.dir).some((f) => f.startsWith('p2-set-aside-'))).toBe(false)
    // the platform lets the downloads through again: the same clone goes on from what it saved
    blocked = false
    const report = await runClone({ dataDir, cloneId: 'c1', services, answers: answers(ch.url) })
    expect(report.outcome).toBe('cloned')
  })
})

describe('one refused download among enough read videos', () => {
  it('is left out (said), the checks count without it, and the clone goes on (Yarnhub, 2026-11-06)', async () => {
    const dataDir = tmp()
    const ch = fakeChannel('presenter-motion')
    const { services } = fakeServices(ch)
    const analyse = services.eyes.analyse
    let calls = 0
    services.eyes = { analyse: async (v, dir) => { if (++calls === 2) throw new Error('ERROR: [youtube] x: Sign in to confirm you’re not a bot.'); return analyse(v, dir) } }
    const report = await runClone({ dataDir, cloneId: 'c1', services, answers: answers(ch.url) })
    expect(report.outcome).toBe('cloned')
    expect(new CloneStore(dataDir, 'c1').decisions().some((d) => /not read now/.test(d.decision) && /left out/.test(d.why))).toBe(true)
  })
})

describe('P2 sets a throwing video aside (W3)', () => {
  it('one analysis that throws (a cost cap) is set aside and P2 goes on with the others', async () => {
    const dataDir = tmp()
    const ch = fakeChannel('presenter-motion')
    const { services } = fakeServices(ch)
    const analyse = services.eyes.analyse
    let calls = 0
    let bad = ''
    services.eyes = { analyse: async (v, dir) => { if (++calls === 2) { bad = v.id; throw Object.assign(new Error('cost cap reached'), { costUsd: 0.12 }) } return analyse(v, dir) } }
    const report = await runClone({ dataDir, cloneId: 'c1', services, answers: answers(ch.url) })
    expect(report.outcome).toBe('cloned')
    const store = new CloneStore(dataDir, 'c1')
    expect(store.has(`p2-set-aside-${bad}.json`)).toBe(true)
    expect(store.decisions().some((d) => d.decision === `${bad} set aside` && /cost cap reached/.test(d.why))).toBe(true)
    // what the failed call cost is in the ledger
    expect(readFileSync(store.file('spend.jsonl'), 'utf8')).toMatch(new RegExp(`p2 analyse ${bad} \\(failed\\)`))
  })

  it('every analysis throwing fails P2 clearly', async () => {
    const dataDir = tmp()
    const ch = fakeChannel('presenter-motion')
    const { services } = fakeServices(ch)
    services.eyes = { analyse: async () => { throw new Error('download refused') } }
    await expect(runClone({ dataDir, cloneId: 'c1', services, answers: answers(ch.url) })).rejects.toMatchObject({ name: 'ExitRefused', phase: 'p2' })
    const store = new CloneStore(dataDir, 'c1')
    expect(store.decisions().at(-1)).toMatchObject({ phase: 'p2', decision: 'refused' })
    expect(store.decisions().at(-1)!.why).toMatch(/no corpus video could be analysed: .*download refused/)
  })
})

describe('the improver\'s changes are what they are', () => {
  const round = { n: 3, comparison: { sheet: 'p7-round-03/comparison.json' } } as unknown as Round
  it('a change citing the reference\'s measure is measured with that evidence; a proposal is saved as the improver\'s, open to later rounds', () => {
    const def = DEFINITION_DEFAULTS_FOR_TESTS()
    const ev = [{ video: 'v1', fromS: 10, toS: 40, frames: ['p7-round-03/ref-0.jpg'], note: 'shot-curve measured on the reference passage' }]
    const changes: Change[] = [
      { cause: 'definition', target: 'editing.meanShotS', before: def.editing.meanShotS.value, after: 2.4, why: 'the reference passage measures 2.4', fixes: ['cadence'], evidence: ev },
      { cause: 'definition', target: 'voice.wordsPerMinute', before: def.voice.wordsPerMinute.value, after: 171, why: 'a model thinks faster', fixes: ['voice'] }
    ]
    const next = applyChanges(def, changes, round)
    expect(next.editing.meanShotS).toMatchObject({ value: 2.4, source: 'measured', evidence: ev })
    expect(next.voice.wordsPerMinute.source).toBe('user')
    expect(next.voice.wordsPerMinute.evidence).toEqual([])
    expect(next.voice.wordsPerMinute.note).toMatch(new RegExp(`^${IMPROVER_NOTE} 3: a model thinks faster`))
    expect(StyleDefinition.safeParse(next).success).toBe(true)
    // a later round may change the improver's proposal again; what the user chose stays his
    expect(userChose(next.voice.wordsPerMinute)).toBe(false)
    expect(userChose({ value: 171, source: 'user', evidence: [], note: 'he said so' })).toBe(true)
  })

  it('a round whose only changes are bricks to fix is not a paid round more: recorded, never applied', async () => {
    const dataDir = tmp()
    const ch = fakeChannel('presenter-motion')
    const { services } = fakeServices(ch)
    services.improver = { propose: async (r) => (r.kind === 'cost' ? [] : [{ cause: 'brick', target: 'director', before: null, after: [1], why: `${BRICK_TO_FIX} director must honour motion.densityByPart`, fixes: ['motion: fewer cards'] }]) }
    await runClone({ dataDir, cloneId: 'c1', services, answers: answers(ch.url, 20) })
    const store = new CloneStore(dataDir, 'c1')
    const rounds = store.list('p6-round-').map((f) => store.load(f, Round)!)
    expect(rounds).toHaveLength(1)
    expect(rounds[0]!.decision).toBe('stop-nothing-to-fix')
    expect(rounds[0]!.changes[0]!.why).toMatch(/^brick to fix \(not applied\)/)
    expect(StyleDefinition.parse(JSON.parse(readFileSync(store.file(ARTEFACTS.definition), 'utf8'))).version).toBe(rounds[0]!.definitionVersion)
  })
})

describe('the P9 example is judged in a random order, its key saved', () => {
  it('both orders happen and the key says which is which', async () => {
    const dataDir = tmp()
    const ch = fakeChannel('presenter-motion')
    const { services } = fakeServices(ch)
    const report = await runClone({ dataDir, cloneId: 'c1', services, answers: answers(ch.url, 50) })
    expect(report.outcome).toBe('cloned')
    const store = new CloneStore(dataDir, 'c1')
    const ctx = phaseContext(store, services, 50)
    const plan = store.load(ARTEFACTS.plan, PipelinePlan)!
    const def = store.load(ARTEFACTS.definition, StyleDefinition)!
    const corpus = store.load(ARTEFACTS.corpus, Corpus)!
    const analyses = corpus.videos.flatMap((v) => store.load(ARTEFACTS.analysis(v.id), VideoAnalysis) ?? [])
    const a = await runP9(ctx, plan, def, corpus, analyses, 0)
    const b = await runP9(ctx, plan, def, corpus, analyses, 1)
    expect(a.blindKey).toEqual({ A: 'reference', B: 'ours' })
    expect(b.blindKey).toEqual({ A: 'ours', B: 'reference' })
    const seen = new Set<string>()
    for (let i = 0; i < 24 && seen.size < 2; i++) seen.add((await runP9(ctx, plan, def, corpus, analyses)).blindKey['A']!)
    expect(seen).toEqual(new Set(['reference', 'ours']))
  }, 60_000)
})

describe('the judge hears the music of both films', () => {
  it('the same words for both sides: none, present with its level, or present', () => {
    expect(musicHeard(false, -18)).toBe('none')
    expect(musicHeard(true, -18.04)).toBe('present, -18 dB against the voice')
    expect(musicHeard(true, null)).toBe('present')
    expect(musicHeard(null, null)).toBeNull()
    const a = { sound: { music: { present: true, genre: 'lofi', levelUnderVoiceDb: { value: -21.3, evidence: [] }, changesAtS: [] } } } as unknown as VideoAnalysis
    expect(referenceMusic(a)).toBe('present, -21.3 dB against the voice')
    const plan = { bricks: [{ node: 'sound.music', fromBase: null, role: 'music' }], settings: [{ key: 'sound.music.bedDb', value: -20, fields: ['sound.musicLevelUnderVoiceDb'] }] } as unknown as PipelinePlan
    const dir = tmp()
    const review = path.join(dir, 'engine-review.json')
    writeFileSync(review, JSON.stringify({ musicDb: -2 }))
    expect(oursMusic(plan, review)).toBe('present, -22 dB against the voice')
    expect(oursMusic(plan, path.join(dir, 'absent.json'))).toBe('present, -20 dB against the voice')
    expect(oursMusic({ ...plan, bricks: [] }, null)).toBe('none')
    expect(existsSync(review)).toBe(true)
  })
})

describe('P5 never drops a measured brick silently', () => {
  it('says why the composition leaves a picture or motion brick out, and keeps it when nothing stands in', () => {
    const def = DEFINITION_DEFAULTS_FOR_TESTS()
    const brief = { references: [{ url: 'https://www.youtube.com/@x', kind: 'channel' as const, axes: [] }] }
    expect(mixReason('motion.render', 'motion', def, brief)).toMatch(/no card style was measured/)
    expect(mixReason('clip.make', 'illustration', def, brief)).toBeNull()
    const mixed = { references: [{ url: 'a', kind: 'channel' as const, axes: ['voice' as const] }, { url: 'b', kind: 'channel' as const, axes: ['script' as const] }] }
    expect(mixReason('motion.render', 'motion', def, mixed)).toMatch(/the motion axis is not taken/)
  })
})

describe('the intake only requires what has no safe default', () => {
  it('a link, a language and a budget start a clone: inputs default to placeholders, axes to all; the budget stays required', () => {
    let s = startIntake()
    for (const m of ['copie https://www.youtube.com/@finary', 'en français']) s = intakeTurn(s, m).state
    const noBudget = intakeTurn(s, 'ok')
    expect(noBudget.ready).toBe(false)
    expect(noBudget.missing).toEqual(['testBudgetUsd'])
    const t = intakeTurn(s, '5 $')
    expect(t.ready).toBe(true)
    // the optional question is still asked, with its default said
    expect(t.question).toBe('clone.intake.q.humanInputs')
    expect(intakeAnswers(t.state).humanInputs).toEqual({ face: false, voice: false, footage: false })
    let m = startIntake()
    for (const x of ['je veux mélanger', 'https://www.youtube.com/@a https://www.youtube.com/@b', 'en français', '6 $']) m = intakeTurn(m, x).state
    expect(intakeTurn(m, 'ok').ready).toBe(true)
    expect(intakeAnswers(m).references.every((r) => r.axes.length === 0)).toBe(true)
  })
})
