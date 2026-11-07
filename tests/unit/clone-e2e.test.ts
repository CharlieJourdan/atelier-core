// The cloning engine end to end on fakes (decision 0095, docs/METHODE-REVERSE-PIPELINE.md): a « presenter + motion »
// channel goes P0→P10 and leaves every artefact, a SAVED comparison per round and a report; an all-3D channel stops after
// P3 with the alert and alternatives faithful to it; a run resumes from its saved artefacts; budget and disk stop it.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Round, StyleDefinition, PipelinePlan, Report } from '../../src/shared/clone'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices, type FakeOptions } from '../../src/main/production/clone/fakes/services'
import { DiskLow, runClone } from '../../src/main/production/clone/orchestrator'
import type { IntakeAnswers } from '../../src/main/production/clone/p0-intake'
import { checkP7 } from '../../src/main/production/clone/p7-compare'
import { settingProblems } from '../../src/main/production/clone/plan-rules'
import { BASE_PIPELINES } from '../../src/engine/technologies/bases'

const answers = (url: string, over: Partial<IntakeAnswers> = {}): IntakeAnswers => ({
  intent: 'copy-channel', references: [{ url, kind: 'channel', axes: [] }], style: null, language: 'fr', sourceLanguage: null,
  testBudgetUsd: 10, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: ['copie cette chaîne'], ...over
})

function setup(kind: 'presenter-motion' | 'full-3d', o: FakeOptions = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-e2e-'))
  const ch = fakeChannel(kind)
  const { services, state } = fakeServices(ch, o)
  const dir = path.join(dataDir, 'clones', 'c1')
  const json = <T>(name: string, schema: { parse(v: unknown): T }): T => schema.parse(JSON.parse(readFileSync(path.join(dir, name), 'utf8')))
  return { dataDir, ch, services, state, dir, json }
}

describe('clone engine, end to end on fakes', () => {
  it('a presenter + motion channel goes P0→P10 with every artefact and a saved comparison per round', async () => {
    const t = setup('presenter-motion')
    const report = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.services, answers: answers(t.ch.url) })

    expect(report.outcome).toBe('cloned')
    expect(report.verdict).toBe('reproducible-with-human-inputs')
    expect(report.example).not.toBeNull()
    expect(report.humanInputs.map((h) => h.slot)).toEqual(['presenter'])
    expect(report.humanInputs[0]!.placeholder).toMatch(/placeholder/)
    for (const f of ['p0-brief.json', 'p1-corpus.json', 'p2-synthesis.json', 'p3-feasibility.json', 'p4-style-definition.json', 'p4-style-definition.v1.json', 'p5-pipeline-plan.json', 'p9-example.json', 'p10-report.json', 'decisions.jsonl', 'spend.jsonl']) {
      expect(existsSync(path.join(t.dir, f)), f).toBe(true)
    }
    for (let i = 1; i <= 5; i++) expect(existsSync(path.join(t.dir, `p2-analysis-v${i}.json`))).toBe(true)

    // Rounds: v1 judged « not same », improved twice, then nothing left to fix; each comparison saved with its frames.
    const rounds = ['p6-round-01.json', 'p6-round-02.json', 'p6-round-03.json'].map((f) => t.json(f, Round))
    expect(rounds.map((r) => r.definitionVersion)).toEqual([1, 2, 3])
    expect(rounds.map((r) => r.comparison?.verdict.sameChannel)).toEqual(['no', 'yes', 'yes'])
    expect(rounds.map((r) => r.decision)).toEqual(['continue', 'continue', 'stop-nothing-to-fix'])
    const exists = (rel: string): boolean => existsSync(path.join(t.dir, rel))
    for (const r of rounds) {
      expect(checkP7(r, exists).ok).toBe(true)
      expect(exists(r.comparison!.sheet)).toBe(true)
    }
    expect(rounds[0]!.changes[0]!.target).toBe('editing.meanShotS') // a field the synthesis measured: P8 may change it
    expect(existsSync(path.join(t.dir, 'p4-style-definition.v3.json'))).toBe(true)

    // The definition carries the measured presenter (two angles, look-alike placeholder: not his channel).
    const def = t.json('p4-style-definition.json', StyleDefinition)
    expect(def.version).toBe(3)
    expect(def.presenter.kind).toMatchObject({ value: 'real', source: 'measured' })
    expect(def.presenter.angleCount.value).toBe(2)
    expect(def.presenter.mode.value).toBe('look-alike-placeholder')
    expect(def.sound.music).toMatchObject({ value: true, source: 'measured' })

    // The plan holds the rule: no base default that was not measured.
    const plan = t.json('p5-pipeline-plan.json', PipelinePlan)
    expect(plan.definitionVersion).toBe(3)
    expect(settingProblems(plan, def, BASE_PIPELINES)).toEqual([])
    expect(plan.settings.find((s) => s.key === 'presenterShots')?.value).toBe('multi')

    expect(report.spentUsd).toBeLessThanOrEqual(10)
    expect(report.spentUsd).toBeGreaterThan(0)
    expect(Report.parse(t.json('p10-report.json', Report)).outcome).toBe('cloned')
  })

  it('an all-3D channel stops after P3 with the alert and alternatives faithful to it', async () => {
    const t = setup('full-3d')
    const report = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.services, answers: answers(t.ch.url) })
    expect(report.outcome).toBe('not-reproducible')
    expect(report.verdict).toBe('not-reproducible')
    expect(report.alert).toMatch(/3d/)
    expect(report.alternatives.length).toBeGreaterThan(0)
    for (const a of report.alternatives) {
      expect(a.keeps).toEqual({ topic: true, tone: true, structure: true, palette: true })
      expect(a.borrowsLookFrom).toBeNull()
    }
    expect(report.example).toBeNull()
    expect(t.state.produced).toBe(0)
    expect(existsSync(path.join(t.dir, 'p4-style-definition.json'))).toBe(false)
  })

  it('resumes from the saved artefacts without redoing finished phases', async () => {
    const t = setup('presenter-motion')
    const first = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.services, answers: answers(t.ch.url) })
    const produced = t.state.produced
    const again = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.services, answers: answers(t.ch.url) })
    expect(t.state.produced).toBe(produced)
    expect(again.outcome).toBe(first.outcome)
  })

  it('the user own channel gets his own presenter and voice', async () => {
    const t = setup('presenter-motion', { ownClones: true })
    const report = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.services, answers: answers(t.ch.url, { intent: 'own-channel', ownChannel: true }) })
    const def = t.json('p4-style-definition.json', StyleDefinition)
    expect(def.presenter.mode.value).toBe('own')
    expect(def.presenter.presenterRef.value).toBe('own-avatar-1')
    expect(def.voice.mode.value).toBe('user-clone')
    expect(report.humanInputs[0]!.placeholder).toBeNull()
  })

  it('never shows an example the blind judge did not pass', async () => {
    const t = setup('presenter-motion', { neverSame: true })
    const report = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.services, answers: answers(t.ch.url) })
    expect(report.outcome).toBe('example-refused')
    expect(report.example).toBeNull()
    expect(existsSync(path.join(t.dir, 'p9-example.json'))).toBe(true)
  })

  it('stops within the budget', async () => {
    const t = setup('presenter-motion', { usdPerMinute: 4 })
    const report = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.services, answers: answers(t.ch.url, { testBudgetUsd: 9 }) })
    expect(report.outcome).toBe('stopped-budget')
    expect(report.spentUsd).toBeLessThanOrEqual(9)
  })

  it('stops cleanly when the disk is under 15 GB', async () => {
    const t = setup('presenter-motion', { freeGb: 12 })
    await expect(runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.services, answers: answers(t.ch.url) })).rejects.toBeInstanceOf(DiskLow)
    expect(readFileSync(path.join(t.dir, 'decisions.jsonl'), 'utf8')).toMatch(/"phase":"disk"/)
  })
})
