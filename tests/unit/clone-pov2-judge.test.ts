// moteur-pov-2 — the POV gate stopped on « the judge answered broken JSON » although the model, after a broken object, said so
// and wrote its corrected verdict: the judge's answer is read on its last object that parses. Nothing in the verdict changes.
import { describe, expect, it } from 'vitest'
import { COMPARE_AXES } from '../../src/shared/clone'
import { jsonObjects, parseJudge } from '../../src/main/production/clone/compare/judge'

const scores = COMPARE_AXES.map((axis) => ({ axis, score: 80, defects: ['a defect (frame 2)'] }))
const good = JSON.stringify({ sameChannel: 'yes', reason: 'same style', scores })

describe('reading the judge', () => {
  it('a corrected answer after a broken one is read on the corrected one', () => {
    const broken = '{"sameChannel":"yes","scores":[{"layout","score":0,"defects":[]}]}'
    const p = parseJudge(`${broken}\n\nSorry — that was malformed. Here is the full answer:\n${good}`, 'j', 0)
    expect(p.problems).toEqual([])
    expect(p.verdict?.sameChannel).toBe('yes')
  })

  it('only broken JSON is still refused; braces inside strings do not cut an object', () => {
    expect(parseJudge('{"sameChannel":"yes",{"x"}', 'j', 0).problems).toEqual(['the judge answered broken JSON'])
    expect(parseJudge('no json here', 'j', 0).problems).toEqual(['the judge did not answer in JSON'])
    expect(jsonObjects('x {"a":"}{"} y {"b":1}')).toEqual(['{"a":"}{"}', '{"b":1}'])
  })

  it('a low picture axis still turns a « yes » into « no » (the rule is unchanged)', () => {
    const low = JSON.stringify({ sameChannel: 'yes', reason: 'r', scores: scores.map((s) => (s.axis === 'layout' ? { ...s, score: 40 } : s)) })
    expect(parseJudge(`broken {"x" then ${low}`, 'j', 0).verdict?.sameChannel).toBe('no')
  })
})

describe('a changed demo implementation is made again (fakeVersion)', () => {
  it('enters a demo run\'s fingerprint only, so real runs and nodes without it keep their caches', async () => {
    const { nodeFingerprint } = await import('../../src/engine/canonical')
    const base = { type: 'director.pov@1', params: { a: 1 }, inputs: { words: 'x' }, seed: 1 } as never
    const demo = nodeFingerprint({ ...(base as object), impl: 'fake' } as never)
    expect(nodeFingerprint({ ...(base as object), impl: 'fake', fakeVersion: 2 } as never)).not.toBe(demo)
    expect(nodeFingerprint({ ...(base as object), fakeVersion: 2 } as never)).toBe(nodeFingerprint(base))
  })
})
