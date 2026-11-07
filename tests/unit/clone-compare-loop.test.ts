// Chantier D (moteur-comparaison): the P6→P8 loop through the orchestrator on fakes — it stops on a plateau, rolls back a
// regressing round, runs cost rounds only after the quality plateau and keeps them only while no axis drops, and every
// round is saved with its comparison. Then the REAL compare services (frames, curves, review, blind judge, improver) on a
// fake ffmpeg: matched frames, contact sheet, curves and the judge's prompt and verdict saved per round.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPARE_AXES, Round, StyleDefinition, type BlindVerdict, type Change } from '../../src/shared/clone'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { runClone } from '../../src/main/production/clone/orchestrator'
import type { IntakeAnswers } from '../../src/main/production/clone/p0-intake'
import { checkP7 } from '../../src/main/production/clone/p7-compare'
import { CloneStore } from '../../src/main/production/clone/store'
import { compareServices } from '../../src/main/production/clone/compare/services'
import type { RunFn } from '../../src/engine/sourcing/types'

const answers = (url: string, budget = 20): IntakeAnswers => ({
  intent: 'copy-channel', references: [{ url, kind: 'channel', axes: [] }], style: null, language: 'fr', sourceLanguage: null,
  testBudgetUsd: budget, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: ['copie cette chaîne']
})

const verdictOf = (score: number, same = score >= 75): BlindVerdict => ({
  blind: true, sameChannel: same ? 'yes' : 'no', reason: `scored ${score}`, judge: 'scripted',
  scores: COMPARE_AXES.map((axis) => ({ axis, score, defects: score < 100 ? [`${axis} differs`] : [] }))
})

/** A world whose judge answers a scripted score per round and whose improver proposes one change per quality round. */
function world(scores: number[], o: { cost?: boolean; budget?: number; costRead?: boolean } = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-loop-'))
  const ch = fakeChannel('presenter-motion')
  const { services } = fakeServices(ch)
  let judged = 0
  services.judge = { blind: async () => verdictOf(scores[Math.min(judged++, scores.length - 1)]!) }
  services.improver = {
    propose: async (round, def): Promise<Change[]> => {
      if (round.kind === 'cost') return o.cost ? [{ cause: 'rule', target: 'cost.ceilingUsdPerMinute', before: round.production.usdPerMinute, after: 0.3, why: 'cheaper voice', fixes: ['cost: 0.5 $/min'] }] : []
      return [{ cause: 'definition', target: 'editing.meanShotS', before: def.editing.meanShotS.value, after: Math.round((def.editing.meanShotS.value - 0.2) * 10) / 10, why: 'cuts faster', fixes: ['cadence: differs'] }]
    }
  }
  const dir = path.join(dataDir, 'clones', 'c1')
  const rounds = (): Round[] => { const out: Round[] = []; for (let i = 1; existsSync(path.join(dir, `p6-round-${String(i).padStart(2, '0')}.json`)); i++) out.push(Round.parse(JSON.parse(readFileSync(path.join(dir, `p6-round-${String(i).padStart(2, '0')}.json`), 'utf8')))); return out }
  // a reader of the cheaper ceiling stands in for a future compiler that picks engines under it (none reads it today)
  const costReaders = o.costRead ? new Set(['cost.ceilingUsdPerMinute']) : undefined
  return { dataDir, ch, services, dir, rounds, run: () => runClone({ dataDir, cloneId: 'c1', services, answers: answers(ch.url, o.budget ?? 20), ...(costReaders ? { costReaders } : {}) }) }
}

describe('P8 loop on fakes', () => {
  it('stops when two rounds no longer improve any axis, every round saved with its comparison', async () => {
    const w = world([70, 80, 80, 80])
    await w.run()
    const r = w.rounds()
    // round 3 and round 4 improve nothing: stop after round 4
    expect(r.map((x) => x.decision)).toEqual(['continue', 'continue', 'continue', 'stop-plateau'])
    const exists = (rel: string): boolean => existsSync(path.join(w.dir, rel))
    for (const x of r) { expect(checkP7(x, exists).ok).toBe(true); expect(exists(x.comparison!.sheet)).toBe(true) }
  })

  it('rolls back a round that regresses, and never tries the same change again', async () => {
    const w = world([80, 70, 80, 80])
    await w.run()
    const r = w.rounds()
    expect(r[1]!.regressedAxes.length).toBe(COMPARE_AXES.length)
    expect(r[1]!.changes[0]).toMatchObject({ target: 'editing.meanShotS', before: r[0]!.changes[0]!.after, after: r[0]!.changes[0]!.before })
    expect(r[1]!.changes[0]!.fixes[0]).toMatch(/rollback of round 1/)
    // round 3 is made with round 1's definition again
    const v = (n: number): StyleDefinition => StyleDefinition.parse(JSON.parse(readFileSync(path.join(w.dir, `p4-style-definition.v${n}.json`), 'utf8')))
    expect(v(r[2]!.definitionVersion).editing.meanShotS.value).toBe(v(1).editing.meanShotS.value)
    expect(r[2]!.changes.some((c) => c.target === 'editing.meanShotS' && c.after === r[0]!.changes[0]!.after)).toBe(false)
  })

  it('skips the cost round with its reason saved when nothing reads the cheaper target (never claims one)', async () => {
    const w = world([70, 80, 80, 80, 80, 80], { cost: true })
    await w.run()
    const r = w.rounds()
    expect(r.some((x) => x.kind === 'cost')).toBe(false)
    expect(r.flatMap((x) => x.changes).some((c) => c.target.startsWith('cost.'))).toBe(false)
    expect(r.at(-1)!.decision).toBe('stop-plateau')
    const log = new CloneStore(w.dataDir, 'c1').decisions()
    const skipped = log.find((d) => d.phase === 'p8' && d.decision.endsWith('cost round skipped'))
    expect(skipped?.why).toMatch(/nothing reads cost\.ceilingUsdPerMinute/)
    expect(skipped?.why).toMatch(/\$\/min/)
  })

  it('runs a cost round after the quality plateau and keeps it when every axis holds (once a reader takes the target)', async () => {
    const w = world([70, 80, 80, 80, 80, 80], { cost: true, costRead: true })
    await w.run()
    const r = w.rounds()
    expect(r[3]!.changes.map((c) => c.target)).toEqual(['cost.ceilingUsdPerMinute'])
    expect(r[3]!.decision).toBe('continue')
    expect(r[4]!.kind).toBe('cost')
    expect(r.at(-1)!.decision).toMatch(/^stop-/)
    for (const x of r) expect(x.production.usdPerMinute).toBeGreaterThan(0)
  })

  it('rolls a cost round back when an axis drops', async () => {
    const w = world([70, 80, 80, 80, 60], { cost: true, costRead: true })
    await w.run()
    const r = w.rounds()
    const last = r.at(-1)!
    expect(last.kind).toBe('cost')
    expect(last.decision).toBe('stop-plateau')
    expect(last.changes[0]).toMatchObject({ target: 'cost.ceilingUsdPerMinute', after: r.at(-2)!.changes[0]!.before })
    // the definition's cost target (a default P4 set) is never overwritten by a cost round: the ceiling is a rule
    const def = StyleDefinition.parse(JSON.parse(readFileSync(path.join(w.dir, 'p4-style-definition.json'), 'utf8')))
    expect(def.cost.usdPerMinute.source).toBe('default')
    expect(def.cost.usdPerMinute.value).toBe(StyleDefinition.parse(JSON.parse(readFileSync(path.join(w.dir, 'p4-style-definition.v1.json'), 'utf8'))).cost.usdPerMinute.value)
  })

  it('a clone stopped on its budget and resumed with more goes on improving (not straight to the example)', async () => {
    const w = world([60, 65, 70, 75, 80, 85], { budget: 3.2 })
    await w.run()
    const before = w.rounds()
    const stopped = before.at(-1)!
    expect(stopped.decision).toBe('stop-budget')
    expect(stopped.changes.length).toBeGreaterThan(0)
    // the user resumes with more budget (what CloneEngine.resume writes: the brief's test budget)
    const briefFile = path.join(w.dir, 'p0-brief.json')
    writeFileSync(briefFile, JSON.stringify({ ...JSON.parse(readFileSync(briefFile, 'utf8')), testBudgetUsd: 20 }))
    // what the stopped clone left (the beta clone of 2026-11-04 had gone on to a refused P9 and its report)
    writeFileSync(path.join(w.dir, 'p10-report.json'), JSON.stringify({ ...JSON.parse(readFileSync(path.join(w.dir, 'p10-report.json'), 'utf8')), outcome: 'example-refused' }))
    const report = await runClone({ dataDir: w.dataDir, cloneId: 'c1', services: w.services, answers: answers(w.ch.url, 20) })
    expect(existsSync(path.join(w.dir, `p10-report.before-resume-r${stopped.n}.json`))).toBe(true)
    expect(report.rounds).toBeGreaterThan(before.length)
    const after = w.rounds()
    expect(after.length).toBeGreaterThan(before.length)
    expect(after[before.length - 1]!.decision).toBe('continue')
    const def = StyleDefinition.parse(JSON.parse(readFileSync(path.join(w.dir, 'p4-style-definition.json'), 'utf8')))
    expect(def.version).toBeGreaterThan(stopped.definitionVersion)
  })

  it('a budget stop that was also a plateau is not resumed into another paid round', async () => {
    const w = world([60, 60, 60, 60, 60, 60], { budget: 4 })
    await w.run()
    const before = w.rounds()
    const stopped = before.at(-1)!
    expect(stopped.decision).toBe('stop-budget')
    // the last two rounds improved nothing: P8 would have stopped on the plateau with money
    expect(stopped.improvedAxes).toEqual([])
    expect(before.at(-2)!.improvedAxes).toEqual([])
    const briefFile = path.join(w.dir, 'p0-brief.json')
    writeFileSync(briefFile, JSON.stringify({ ...JSON.parse(readFileSync(briefFile, 'utf8')), testBudgetUsd: 20 }))
    await runClone({ dataDir: w.dataDir, cloneId: 'c1', services: w.services, answers: answers(w.ch.url, 20) })
    expect(w.rounds().length).toBe(before.length)
    expect(w.rounds().at(-1)!.decision).toBe('stop-budget')
  })

  it('stops on the budget', async () => {
    const w = world([60, 65, 70, 75, 80, 85], { budget: 3.2 })
    const report = await w.run()
    expect(['stopped-budget', 'example-refused', 'cloned']).toContain(report.outcome)
    expect(w.rounds().some((x) => x.decision === 'stop-budget') || report.outcome === 'stopped-budget').toBe(true)
  })
})

/** A fake ffmpeg/ffprobe: writes the files it is asked for and prints what the instruments parse. */
function fakeFfmpeg(): RunFn {
  return async (cmd, args) => {
    const out = args[args.length - 1]!
    if (cmd === 'ffprobe') return { stdout: '120.0\n', stderr: '' }
    if (args.some((a) => a.includes('scene_score'))) {
      const every = args.some((a) => a.includes('ours')) ? 3.6 : 2.7
      const lines: string[] = []
      for (let t = 0; t < 120; t += 0.5) lines.push(`frame:0 pts:0 pts_time:${t}`, `lavfi.scene_score=${Math.abs((t % every) - 0) < 0.25 && t > 0 ? 0.5 : 0.01}`)
      return { stdout: lines.join('\n'), stderr: '' }
    }
    if (args.some((a) => a.startsWith('loudnorm'))) return { stdout: '', stderr: '{ "input_i" : "-15.0" }' }
    if (args.some((a) => a.startsWith('silencedetect'))) return { stdout: '', stderr: '' }
    if (args.some((a) => a.includes('rgb24'))) { writeFileSync(out, Buffer.from(Array(16 * 9 * 3 * 4).fill(0).map((_, i) => (i % 3 === 2 ? 80 : 20)))); return { stdout: '', stderr: '' } }
    writeFileSync(out, 'jpg-or-mp4')
    return { stdout: '', stderr: '' }
  }
}

describe('P7 real compare services on a fake ffmpeg', () => {
  it('saves matched frames, the contact sheet, curves, defects and the blind verdict per round', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-real-p7-'))
    const ch = fakeChannel('presenter-motion')
    const { services } = fakeServices(ch)
    const cloneDir = path.join(dataDir, 'clones', 'c1')
    const refFile = path.join(dataDir, 'reference.mp4')
    writeFileSync(refFile, 'video')
    const prompts: string[] = []
    const analysis = (id: string) => { const f = path.join(cloneDir, `p2-analysis-${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null }
    const real = compareServices({
      run: fakeFfmpeg(), cloneDir, dataDir, referenceFile: async () => refFile, analysis, plan: () => null,
      judgeAsk: async ({ prompt, images }) => {
        prompts.push(prompt)
        expect(images).toHaveLength(2)
        return { text: JSON.stringify({ sameChannel: prompts.length > 1 ? 'yes' : 'no', reason: 'cadence', scores: COMPARE_AXES.map((axis) => ({ axis, score: prompts.length > 1 ? 90 : 70, defects: [`${axis}: frame 2 differs`] })) }), costUsd: 0.01, model: 'fake-judge' }
      }
    })
    Object.assign(services, real)
    const report = await runClone({ dataDir, cloneId: 'c1', services, answers: answers(ch.url) })
    expect(report.outcome).not.toBe('stopped-budget')
    const r1 = Round.parse(JSON.parse(readFileSync(path.join(cloneDir, 'p6-round-01.json'), 'utf8')))
    const exists = (rel: string): boolean => existsSync(path.join(cloneDir, rel))
    expect(checkP7(r1, exists).ok).toBe(true)
    expect(r1.comparison!.contactSheet).toBe('p7-round-01/contact-sheet.jpg')
    expect(r1.comparison!.curves.find((c) => c.name === 'shot-length')!.distance).toBeGreaterThan(0)
    expect(r1.comparison!.verdict.judge).toBe('fake-judge')
    // the cause finder turned the measured cadence gap into a definition change aimed at the reference's value
    expect(r1.changes.some((c) => c.target === 'editing.meanShotS' && c.cause === 'definition')).toBe(true)
    const sheet = JSON.parse(readFileSync(path.join(cloneDir, r1.comparison!.sheet), 'utf8')) as { blindKey: Record<string, string>; items: { label: string }[] }
    expect(Object.values(sheet.blindKey).sort()).toEqual(['ours', 'reference'])
    expect(prompts[0]).not.toMatch(/\bours\b|\breference\b/i)
    const spend = readFileSync(path.join(cloneDir, 'spend.jsonl'), 'utf8')
    expect(spend).toMatch(/blind judge/)
  })
})
