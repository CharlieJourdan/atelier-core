// moteur-briques: the improver stays anchored to the measurements. A measured share pushed far outside what the corpus
// measured (POV, 2026-11-04: the first-person share 0.048 → 0.35 by the gate's improver) is brought back within the
// corpus's spread; only a new analysis can move it further.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPARE_AXES, StyleDefinition, VideoAnalysis, type BlindVerdict, type Change } from '../../src/shared/clone'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { runClone } from '../../src/main/production/clone/orchestrator'
import { anchorChanges, corpusSpread, type FieldSpread } from '../../src/main/production/clone/compare/anchor'

const change = (target: string, before: unknown, after: unknown): Change => ({ cause: 'definition', target, before, after, why: 'judge said so', fixes: ['layout: differs'] })

describe('anchorChanges (pure)', () => {
  const spread = new Map<string, FieldSpread>([
    ['sourcing.povShare', { kind: 'number', spread: { min: 0.01, max: 0.09 } }],
    ['sourcing.originShares', { kind: 'record', keys: new Map([['drawn', { min: 0.4, max: 0.6 }], ['motion', { min: 0.3, max: 0.55 }]]) }]
  ])
  it('brings a number back to the nearest bound and says so', () => {
    const r = anchorChanges([change('sourcing.povShare', 0.048, 0.35)], spread)
    expect(r.changes[0]!.after).toBe(0.09)
    expect(r.changes[0]!.why).toMatch(/held within the corpus's measured spread 0\.01–0\.09/)
    expect(r.held[0]).toMatch(/sourcing\.povShare: 0\.35 → 0\.09/)
  })
  it('holds each share of a record, keeps a change inside the spread, and drops one that would then move nothing', () => {
    const r = anchorChanges([
      change('sourcing.originShares', { drawn: 0.5, motion: 0.49 }, { drawn: 0.7, motion: 0.27 }),
      change('sourcing.povShare', 0.048, 0.06),
      change('sourcing.povShare', 0.09, 0.4),
      change('script.tone', '', 'second person')
    ], spread)
    expect(r.changes.map((c) => c.after)).toEqual([{ drawn: 0.6, motion: 0.3 }, 0.06, 'second person'])
  })
})

describe('anchorChanges on per-part curves and unseen keys (review)', () => {
  const spread = new Map<string, FieldSpread>([
    ['presenter.presenceByPart', { kind: 'record', keys: new Map([['hook', { min: 0.6, max: 0.9 }], ['body', { min: 0.3, max: 0.5 }]]) }],
    ['presenter.layoutCurve', { kind: 'record', keys: new Map([['body.full', { min: 0.1, max: 0.3 }], ['body.off', { min: 0.5, max: 0.8 }]]) }],
    ['motion.densityByPart', { kind: 'record', keys: new Map([['body', { min: 2, max: 4 }]]) }],
    ['sourcing.originShares', { kind: 'record', keys: new Map([['drawn', { min: 0.4, max: 0.6 }], ['motion', { min: 0.3, max: 0.55 }]]) }]
  ])
  it('holds a per-part share, a per-part density and a per-part layout curve in their definition shape', () => {
    const r = anchorChanges([
      change('presenter.presenceByPart', [{ part: 'hook', share: 0.8 }, { part: 'body', share: 0.4 }], [{ part: 'hook', share: 0.8 }, { part: 'body', share: 0.9 }]),
      change('motion.densityByPart', [{ part: 'body', perMinute: 3 }], [{ part: 'body', perMinute: 12 }]),
      change('presenter.layoutCurve', [{ part: 'body', shares: { full: 0.2, off: 0.7 } }], [{ part: 'body', shares: { full: 0.9, off: 0.1 } }])
    ], spread)
    expect(r.changes.map((c) => c.after)).toEqual([
      [{ part: 'hook', share: 0.8 }, { part: 'body', share: 0.5 }],
      [{ part: 'body', perMinute: 4 }],
      [{ part: 'body', shares: { full: 0.3, off: 0.5 } }]
    ])
  })
  it('holds a share the corpus never measured near nothing', () => {
    const r = anchorChanges([change('sourcing.originShares', { drawn: 0.5, motion: 0.5 }, { drawn: 0.5, motion: 0.3, generated: 0.4 })], spread)
    expect(r.changes[0]!.after).toEqual({ drawn: 0.5, motion: 0.3, generated: 0.02 })
  })
})

describe('the improver on a real loop (fakes)', () => {
  it('a P8 change to a measured field never leaves the corpus spread', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-anchor-'))
    const ch = fakeChannel('presenter-motion')
    const { services } = fakeServices(ch)
    let judged = 0
    const verdict = (score: number): BlindVerdict => ({ blind: true, sameChannel: 'no', reason: 'r', judge: 'j', scores: COMPARE_AXES.map((axis) => ({ axis, score, defects: ['differs'] })) })
    services.judge = { blind: async () => verdict([60, 70, 80, 80, 80][Math.min(judged++, 4)]!) }
    services.improver = { propose: async (round, def): Promise<Change[]> => (round.kind === 'cost' ? [] : [change('editing.meanShotS', def.editing.meanShotS.value, 99)]) }
    await runClone({ dataDir, cloneId: 'c1', services, answers: { intent: 'copy-channel', references: [{ url: ch.url, kind: 'channel', axes: [] }], style: null, language: 'fr', sourceLanguage: null, testBudgetUsd: 20, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: ['copie'] } })
    const dir = path.join(dataDir, 'clones', 'c1')
    const analyses = (JSON.parse(readFileSync(path.join(dir, 'p1-corpus.json'), 'utf8')) as { videos: { id: string }[] }).videos
      .map((v) => path.join(dir, `p2-analysis-${v.id}.json`)).filter(existsSync).map((f) => VideoAnalysis.parse(JSON.parse(readFileSync(f, 'utf8'))))
    const s = corpusSpread(analyses).get('editing.meanShotS')
    expect(s?.kind).toBe('number')
    const max = s!.kind === 'number' ? s!.spread.max : 0
    const def = StyleDefinition.parse(JSON.parse(readFileSync(path.join(dir, 'p4-style-definition.json'), 'utf8')))
    expect(def.editing.meanShotS.value).toBeLessThanOrEqual(max)
    expect(readFileSync(path.join(dir, 'decisions.jsonl'), 'utf8')).toMatch(/held to the measurements/)
  })
})
