// controles-bloquants (decision 0102): before any paid render of a clone (a P6 round, the P9 example) a FREE demo of the definition is
// judged blind; a refused demo is improved for free and made again; nothing is paid while the style is wrong. On fakes.
import { mkdtempSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPARE_AXES, type BlindVerdict } from '../../src/shared/clone'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { runClone } from '../../src/main/production/clone/orchestrator'
import type { IntakeAnswers } from '../../src/main/production/clone/p0-intake'
import { GATE_TRIES, gateVerdict } from '../../src/main/production/clone/style-gate'
import { judgePrompt } from '../../src/main/production/clone/compare/judge'
import { GateResult } from '../../src/main/production/clone/style-gate'
import { readFileSync } from 'node:fs'
import type { CloneServices } from '../../src/main/production/clone/services'

const answers = (url: string, budget = 10): IntakeAnswers => ({
  intent: 'copy-channel', references: [{ url, kind: 'channel', axes: [] }], style: null, language: 'fr', sourceLanguage: null,
  testBudgetUsd: budget, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: ['copie cette chaîne']
})

const verdict = (score: number, over: Partial<Record<(typeof COMPARE_AXES)[number], number>> = {}): BlindVerdict => ({
  blind: true, sameChannel: 'no', reason: 'r', judge: 'j',
  scores: COMPARE_AXES.map((axis) => ({ axis, score: over[axis] ?? score, defects: ['differs'] }))
})

describe('the gate verdict (pure)', () => {
  it('passes when every axis a demo shows is at 70 or more, whatever the axes a demo fakes', () => {
    expect(gateVerdict(verdict(75, { identity: 10, illustration: 20, voice: 5, sound: 0, script: 10, palette: 30 })).pass).toBe(true)
  })
  it('refuses when one shown axis is under 70, saying which and why', () => {
    const g = gateVerdict(verdict(80, { layout: 40 }))
    expect(g.pass).toBe(false)
    expect(g.why[0]).toMatch(/^layout 40 < 70: differs/)
  })
})

function setup(demoScore: ((demos: number) => number) | null, o: { unmarked?: boolean } = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-gate-'))
  const ch = fakeChannel('presenter-motion')
  const { services, state } = fakeServices(ch)
  const count = { paid: 0, demos: 0, unmarked: 0 }
  const judged: { frames: string[]; placeholderWords: boolean }[] = []
  const paidProduce = services.runs.produce
  let judgingDemo = false
  const s: CloneServices = {
    ...services,
    runs: { produce: async (...a) => { count.paid++; return paidProduce(...a) } },
    ...(demoScore
      ? {
          demo: {
            produce: async (plan, def, passage, dir) => {
              count.demos++
              judgingDemo = true
              return paidProduce(plan, def, passage, dir, 0)
            },
            ...(o.unmarked
              ? {
                  unmarked: async (plan, def, passage, dir) => {
                    count.unmarked++
                    judgingDemo = true
                    return paidProduce(plan, def, passage, dir, 0)
                  }
                }
              : {})
          }
        }
      : {}),
    judge: {
      blind: async (items, dir, jo) => {
        judged.push({ frames: items.flatMap((i) => i.frames), placeholderWords: jo?.placeholderWords === true })
        if (judgingDemo && demoScore) {
          judgingDemo = false
          return verdict(demoScore(count.demos))
        }
        return services.judge.blind(items, dir)
      }
    }
  }
  return { dataDir, ch, s, count, state, judged }
}

describe('free demo first, then paid', () => {
  it('a demo the judge refuses is improved for free; the paid rounds start only once a demo passes', async () => {
    // first demo 60 (refused), the improver changes the definition, the second demo 80 (passes)
    const t = setup((n) => (n === 1 ? 60 : 80))
    const report = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.s, answers: answers(t.ch.url) })
    expect(report.outcome).toBe('cloned')
    expect(t.count.demos).toBeGreaterThanOrEqual(2)
    expect(t.count.paid).toBeGreaterThan(0)
    const files = readdirSync(path.join(t.dataDir, 'clones', 'c1'))
    expect(files).toContain('gate-v01.json')
    expect(files).toContain('gate-v02.json')
  })
  it('a style the demos never get right pays nothing', async () => {
    const t = setup(() => 40)
    const report = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.s, answers: answers(t.ch.url) })
    expect(report.outcome).toBe('example-refused')
    expect(t.count.paid).toBe(0)
    expect(t.count.demos).toBe(GATE_TRIES)
  })
  it('a resumed clone does not judge the same definition twice', async () => {
    const t = setup(() => 90)
    await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.s, answers: answers(t.ch.url) })
    const demos = t.count.demos
    await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.s, answers: answers(t.ch.url) })
    expect(t.count.demos).toBe(demos)
  })
})

describe('the demo the gate judges (moteur-briques, after the POV runs of 2026-11-04)', () => {
  it('the judge sees an unmarked demo and is told card words are placeholders; what is saved for the user stays the marked demo', async () => {
    const t = setup(() => 90, { unmarked: true })
    await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.s, answers: answers(t.ch.url) })
    expect(t.count.unmarked).toBe(t.count.demos)
    const gate = GateResult.parse(JSON.parse(readFileSync(path.join(t.dataDir, 'clones', 'c1', 'gate-v01.json'), 'utf8')))
    // the gate's saved demo and side-by-sides are the marked render; the judge's frames come from the unmarked one apart
    expect(gate.demoPath).toBe('gate-v01/ours.mp4')
    expect(gate.pairs.every((p) => !p.ours.includes('/judge/'))).toBe(true)
    const demoJudging = t.judged[0]!
    expect(demoJudging.placeholderWords).toBe(true)
    expect(demoJudging.frames.some((f) => f.startsWith('gate-v01/judge/'))).toBe(true)
  })
  it('a refused demo is measured on the film the frames service matched last (the real service keeps only that one)', async () => {
    const t = setup((n) => (n === 1 ? 60 : 90), { unmarked: true })
    let last = ''
    const { frames, curves } = t.s
    t.s.frames = { matched: async (r, pr, dir) => { last = pr.videoPath; return frames.matched(r, pr, dir) } }
    t.s.curves = { compare: async (a, pr) => { if (pr.videoPath !== last) throw new Error('the reference passage is cut by frames.matched first (P7 order)'); return curves.compare(a, pr) } }
    const report = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.s, answers: answers(t.ch.url) })
    expect(report.outcome).toBe('cloned')
    expect(t.count.demos).toBeGreaterThanOrEqual(2)
  })
  it('the paid rounds and the example are judged on their real wording', async () => {
    const t = setup(() => 90, { unmarked: true })
    await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.s, answers: answers(t.ch.url) })
    const paidJudgings = t.judged.filter((j) => !j.frames.some((f) => f.startsWith('gate-')))
    expect(paidJudgings.length).toBeGreaterThan(0)
    expect(paidJudgings.every((j) => !j.placeholderWords)).toBe(true)
  })
  it('the judge prompt says so only when asked, and never which excerpt is ours', () => {
    const items = [{ label: 'A', video: 'a.mp4', frames: ['a1.jpg'] }, { label: 'B', video: 'b.mp4', frames: ['b1.jpg'] }]
    const strict = judgePrompt(items, {})
    const demo = judgePrompt(items, {}, { placeholderWords: true })
    expect(strict).not.toMatch(/placeholder/i)
    expect(demo).toMatch(/placeholder/i)
    expect(demo).toMatch(/type, placement, size, font, colour and timing/)
    expect(demo).not.toMatch(/\bours\b|reference|demo/i)
  })
  it('a budget too short for a paid round still gets the free verdict, then stops before paying and says what it needs', async () => {
    const t = setup(() => 90)
    const report = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.s, answers: answers(t.ch.url, 0.6) })
    expect(t.count.demos).toBe(1)
    expect(t.count.paid).toBe(0)
    expect(report.outcome).toBe('stopped-budget')
    const decisions = readFileSync(path.join(t.dataDir, 'clones', 'c1', 'decisions.jsonl'), 'utf8')
    expect(decisions).toMatch(/"phase":"gate","decision":"v1 before p6: pass"/)
    expect(decisions).toMatch(/"phase":"budget","decision":"stop","why":"needs \d+\.\d\d \$, \d+\.\d\d \$ left"/)
    expect(decisions.indexOf('"phase":"gate"')).toBeLessThan(decisions.indexOf('"phase":"budget"'))
  })
})

describe('a gate with no money left for its judge', () => {
  // on the fakes, P2 costs 0.25 $ and a round 1 $: 0.28 $ leaves 0.03 $ (under a gate's calls), 0.5 $ leaves 0.25 $
  it('does not call the judge when its calls no longer fit: the clone stops on its budget before any gate', async () => {
    const t = setup(() => 90)
    const report = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.s, answers: answers(t.ch.url, 0.28) })
    expect(report.outcome).toBe('stopped-budget')
    expect(t.count.demos).toBe(0)
    expect(t.judged).toHaveLength(0)
    expect(readFileSync(path.join(t.dataDir, 'clones', 'c1', 'decisions.jsonl'), 'utf8')).not.toMatch(/"phase":"gate"/)
  })
  it('judges for free while they fit, then stops before paying', async () => {
    const t = setup(() => 90)
    const report = await runClone({ dataDir: t.dataDir, cloneId: 'c1', services: t.s, answers: answers(t.ch.url, 0.5) })
    expect(report.outcome).toBe('stopped-budget')
    expect(t.count.demos).toBe(1)
    expect(t.count.paid).toBe(0)
  })
})

describe('the unmarked judge copy (render.assemble watermark)', () => {
  it('turns the film mark off in the recipe only, and the brick passes it to the render node', async () => {
    const { withoutWatermark } = await import('../../src/main/production/clone/compare/runner')
    const { renderAssemble } = await import('../../src/engine/technologies/catalog-make')
    const recipe = { bricks: [{ tech: 'script.write@2', settings: {} }, { tech: 'render.assemble@1', settings: { crf: 18 } }] }
    const out = withoutWatermark(recipe) as typeof recipe
    expect(out.bricks[1]!.settings).toEqual({ crf: 18, watermark: 'off' })
    expect(recipe.bricks[1]!.settings).toEqual({ crf: 18 })
    expect(renderAssemble.overridable.recipe).toContain('watermark')
    const params = renderAssemble.params.parse({ watermark: 'off' })
    expect((renderAssemble.nodeParams(params, {} as never) as { render: { watermark?: string } }).render.watermark).toBe('off')
    expect((renderAssemble.nodeParams(renderAssemble.params.parse({}), {} as never) as { render: { watermark?: string } }).render.watermark).toBeUndefined()
  })
})

describe('the film mark', () => {
  it('off drops it only in a demo run; a real film with a demo part keeps it', async () => {
    const { filmWatermark } = await import('../../src/engine/nodes/render-assemble')
    expect(filmWatermark('off', false, true)).toBe(false)
    expect(filmWatermark('off', true, true)).toBe(true)
    expect(filmWatermark('auto', false, true)).toBe(true)
    expect(filmWatermark('auto', true, false)).toBe(false)
    expect(filmWatermark('on', true, false)).toBe(true)
  })
})
