// P9 / P10 and the progress view: the full example only after the blind « same channel » verdict, the report's content on
// every outcome (frames, proposals, measured cost and time), the checks that refuse a dishonest report, and the progress
// derived from the saved artefacts (resumable). All on fakes.
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Report } from '../../src/shared/clone';
import { COMPARE_AXES, Example, PipelinePlan } from '../../src/shared/clone'
import { fakeChannel, type FakeChannelKind } from '../../src/main/production/clone/fakes/channels'
import { fakeServices, type FakeOptions } from '../../src/main/production/clone/fakes/services'
import { cloneProgress } from '../../src/main/production/clone/intake/progress'
import { DiskLow, runClone } from '../../src/main/production/clone/orchestrator'
import type { IntakeAnswers } from '../../src/main/production/clone/p0-intake'
import { checkP9 } from '../../src/main/production/clone/p9-example'
import { checkP10, ingredientOptions } from '../../src/main/production/clone/p10-report'
import { CloneStore } from '../../src/main/production/clone/store'

const answers = (url: string, over: Partial<IntakeAnswers> = {}): IntakeAnswers => ({
  intent: 'copy-channel', references: [{ url, kind: 'channel', axes: [] }], style: null, language: 'fr', sourceLanguage: null,
  testBudgetUsd: 10, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: ['copie cette chaîne'], ...over
})

async function run(kind: FakeChannelKind = 'presenter-motion', o: FakeOptions = {}, over: Partial<IntakeAnswers> = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-report-'))
  const ch = fakeChannel(kind)
  const { services, state } = fakeServices(ch, o)
  const report = await runClone({ dataDir, cloneId: 'c1', services, answers: answers(ch.url, over) })
  const dir = path.join(dataDir, 'clones', 'c1')
  const load = <T>(name: string, schema: { parse(v: unknown): T }): T => schema.parse(JSON.parse(readFileSync(path.join(dir, name), 'utf8')))
  return { dataDir, dir, report, state, load, store: new CloneStore(dataDir, 'c1') }
}

describe('P10 report', () => {
  it('a cloned report carries the example, frames, a score per axis, the inputs with their stand-ins and measured cost and time', async () => {
    const t = await run()
    const r = t.report
    expect(r.outcome).toBe('cloned')
    expect(r.framesFrom).toBe('example')
    expect(r.sideBySide.length).toBeGreaterThanOrEqual(6)
    expect(r.axisScores.map((s) => s.axis).sort()).toEqual([...COMPARE_AXES].sort())
    expect(r.usdPerMinute).toBeGreaterThan(0)
    expect(r.makeMinutesPerMinute).toBeGreaterThan(0)
    expect(r.humanInputs[0]!.placeholder).toMatch(/placeholder/)
    const asExample = r.proposals.find((p) => p.title === 'clone.proposal.asExample')!
    expect(asExample).toMatchObject({ usdPerMinute: r.usdPerMinute, makeMinutesPerMinute: r.makeMinutesPerMinute })
    expect(asExample.previewPath).toBe(r.sideBySide[0]!.ours)
    expect(r.proposals.some((p) => p.title === 'clone.proposal.slot:presenter')).toBe(true)
    expect(checkP10(r, Example.parse(t.load('p9-example.json', Example)), t.load('p5-pipeline-plan.json', PipelinePlan)).ok).toBe(true)
  })

  it('when the judge refuses, no full example is made, nothing is spent on it, and the last round\'s frames are shown', async () => {
    const t = await run('presenter-motion', { neverSame: true })
    expect(t.report.outcome).toBe('example-refused')
    expect(t.report.example).toBeNull()
    expect(t.report.framesFrom).toBe('last-round')
    expect(t.report.sideBySide.length).toBeGreaterThanOrEqual(6)
    expect(readFileSync(path.join(t.dir, 'spend.jsonl'), 'utf8')).not.toMatch(/p9 example/)
    expect(readFileSync(path.join(t.dir, 'decisions.jsonl'), 'utf8')).toMatch(/"phase":"p9","decision":"no example"/)
    const ex = t.load('p9-example.json', Example)
    expect(ex.costUsd).toBe(0)
    expect(checkP9(ex, (rel) => existsSync(path.join(t.dir, rel))).problems.join()).toMatch(/did not say « same channel »/)
  })

  it('a budget stop after some rounds still shows the rounds\' side-by-side frames', async () => {
    const t = await run('presenter-motion', {}, { testBudgetUsd: 3 })
    expect(t.report.outcome).toBe('stopped-budget')
    expect(t.report.rounds).toBeGreaterThan(0)
    expect(t.report.framesFrom).toBe('last-round')
    expect(t.report.sideBySide.length).toBeGreaterThanOrEqual(6)
    expect(t.report.spentUsd).toBeLessThanOrEqual(3)
  })

  it('a not reproducible clone reports its alert and alternatives as proposals that keep the channel, with honest unknown costs', async () => {
    const t = await run('full-3d')
    const r = t.report
    expect(r.outcome).toBe('not-reproducible')
    expect(r.proposals.length).toBe(r.alternatives.length)
    for (const p of r.proposals) expect(p).toMatchObject({ usdPerMinute: null, makeMinutesPerMinute: null, previewPath: null })
    expect(r.usdPerMinute).toBeNull()
  })

  it('the check refuses a dishonest report', async () => {
    const t = await run()
    const ex = t.load('p9-example.json', Example)
    const plan = t.load('p5-pipeline-plan.json', PipelinePlan)
    const bad = (over: Partial<Report>): string => checkP10({ ...t.report, ...over }, ex, plan).problems.join(' | ')
    expect(bad({ usdPerMinute: null })).toMatch(/measured cost/)
    expect(bad({ framesFrom: 'example', example: null })).toMatch(/not shown|without an example/)
    expect(bad({ humanInputs: [] })).toMatch(/not listed/)
    expect(bad({ humanInputs: [{ slot: 'presenter', what: 'x', placeholder: null }] })).toMatch(/not described/)
    expect(checkP10({ ...t.report, outcome: 'stopped-budget', rounds: 2, sideBySide: [], framesFrom: 'none', example: null }, null, plan).problems.join()).toMatch(/side-by-side/)
  })
})

describe('P10 ingredients, technologies, what cannot be done', () => {
  it('lists the realistic ways to provide each ingredient, fewer for his own channel', async () => {
    const t = await run()
    const g = t.report.ingredients.find((x) => x.slot === 'presenter')!
    expect(g.options).toEqual(['generate', 'import'])
    expect(g.current).toBe('generate')
    expect(t.report.technologies.length).toBeGreaterThan(0)
    expect(t.report.technologies[0]).toHaveProperty('role')
    const own = await run('presenter-motion', { ownClones: true }, { intent: 'own-channel', ownChannel: true })
    const og = own.report.ingredients.find((x) => x.slot === 'presenter')!
    expect(og.options).toEqual(['clone', 'import'])
    expect(og.current).toBe('clone')
    expect(ingredientOptions('footage', false)).toEqual(['find', 'import'])
    expect(ingredientOptions('footage', true)).toEqual(['import'])
    expect(ingredientOptions('voice', false)).not.toContain('find')
  })
  it('says plainly what cannot be reproduced, with its share of the screen', async () => {
    const t = await run('full-3d')
    expect(t.report.cannot.length).toBeGreaterThan(0)
    expect(t.report.cannot[0]!.share).toBeGreaterThan(0.5)
    expect(t.report.cannot[0]!.buildCostUsd).toBe(400)
    const ok = await run()
    expect(ok.report.cannot).toEqual([])
  })
  it('a refused example is not shown as a finished step', async () => {
    const t = await run('presenter-motion', { neverSame: true })
    expect(cloneProgress(t.store, { active: false }).steps.find((s) => s.step === 'example')!.status).not.toBe('done')
  })
})

describe('progress', () => {
  it('a finished clone shows every stage done, with frames and facts', async () => {
    const t = await run()
    const p = cloneProgress(t.store, { active: false })
    expect(p.steps.map((s) => s.status)).toEqual(Array(9).fill('done'))
    expect(p.steps.find((s) => s.step === 'watch')!.frames.length).toBeGreaterThan(0)
    expect(p.steps.find((s) => s.step === 'rounds')!.frames.length).toBeGreaterThan(0)
    expect(p.steps.find((s) => s.step === 'can')!.facts[0]!.vars['share']).toBeTypeOf('number')
    expect(p.now.key).toBe('clone.progress.fact.finished')
    expect(p.spentUsd).toBe(t.report.spentUsd)
    expect(p.budgetUsd).toBe(10)
  })

  it('after a restart mid-way it shows where it is from the saved files alone, and resumes', async () => {
    const t = await run()
    const copy = mkdtempSync(path.join(os.tmpdir(), 'clone-resume-'))
    cpSync(path.join(t.dataDir, 'clones'), path.join(copy, 'clones'), { recursive: true })
    for (const f of ['p10-report.json', 'p9-example.json', 'p6-round-03.json']) rmSync(path.join(copy, 'clones', 'c1', f))
    const store = new CloneStore(copy, 'c1')
    const mid = cloneProgress(store, { active: true })
    const status = Object.fromEntries(mid.steps.map((s) => [s.step, s.status]))
    expect(status).toMatchObject({ intake: 'done', watch: 'done', pipeline: 'done', rounds: 'running', example: 'waiting', report: 'waiting' })
    expect(mid.now).toMatchObject({ key: 'clone.progress.fact.now.rounds', vars: { n: 3 } })
    expect(cloneProgress(store, { active: false }).steps.find((s) => s.step === 'rounds')!.status).toBe('waiting')
    // the real orchestrator picks up from the same files
    const ch = fakeChannel('presenter-motion')
    const again = await runClone({ dataDir: copy, cloneId: 'c1', services: fakeServices(ch).services, answers: answers(ch.url) })
    expect(again.outcome).toBe('cloned')
    expect(cloneProgress(store, { active: false }).steps.every((s) => s.status === 'done')).toBe(true)
  })

  it('a not reproducible clone skips what it never does; a full disk shows why it stopped, in words', async () => {
    const t = await run('full-3d')
    const p = cloneProgress(t.store, { active: false })
    expect(Object.fromEntries(p.steps.map((s) => [s.step, s.status]))).toMatchObject({ can: 'done', definition: 'skipped', pipeline: 'skipped', rounds: 'skipped', example: 'skipped', report: 'done' })

    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-disk-'))
    const ch = fakeChannel('presenter-motion')
    await expect(runClone({ dataDir, cloneId: 'c1', services: fakeServices(ch, { freeGb: 12 }).services, answers: answers(ch.url) })).rejects.toBeInstanceOf(DiskLow)
    const stopped = cloneProgress(new CloneStore(dataDir, 'c1'), { active: false })
    expect(stopped.stoppedBecause).toEqual({ key: 'clone.progress.stopped.disk', vars: { free: '12' } })
    expect(stopped.steps[0]!.status).toBe('stopped')
  })

  it('a half-written artefact does not take the view down', async () => {
    const t = await run()
    const file = path.join(t.dir, 'p3-feasibility.json')
    expect(readdirSync(t.dir)).toContain('p3-feasibility.json')
    rmSync(file)
    const p = cloneProgress(t.store, { active: false })
    expect(p.steps.find((s) => s.step === 'can')!.status).not.toBe('done')
  })
})
