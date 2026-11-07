// equipe-3-chaines: the final pass reads the render's own checks (never measures them twice), splits real errors from remarks,
// and its blind judge never stops an order.
import { describe, expect, it } from 'vitest'
import type { Defect } from '../../src/engine/review/types'
import { finalPass, judgeMoments, verdictLines } from '../../src/main/orchestra/orders/final-pass'

const left: Defect[] = [
  { kind: 'audio_dropout', severity: 'fail', atS: 28.4, endS: 28.9, detail: 'la voix se coupe dans « chaudière »' },
  { kind: 'audio_dropout', severity: 'fail', atS: 28.6, endS: 28.9, detail: 'la même coupure, vue deux fois' },
  { kind: 'off_subject', severity: 'warn', atS: 63, endS: 66, detail: 'une cuisine pour « la chaudière »' }
]

const deps = (over: Partial<Parameters<typeof finalPass>[0]> = {}) =>
  finalPass({
    run: async () => ({ stdout: '', stderr: '' }),
    workDir: () => 'C:/nowhere',
    review: async () => ({ left }),
    isBlocking: (d) => d.kind === 'audio_dropout',
    film: () => null,
    reference: () => null,
    words: () => '',
    ask: null,
    ...over
  })

describe('the final pass of an ordered video', () => {
  it('real errors from the render’s report (one per kind and second), the rest as remarks; no film: no judge, said', async () => {
    const r = await deps().check({ orderId: 1, runId: 7, channelId: 1, title: 't', real: true })
    expect(r.blocking).toEqual([{ kind: 'audio_dropout', atS: 28.4, what: '0:28.4 la voix se coupe dans « chaudière »', step: 'voice' }])
    expect(r.review).toEqual(['1:03.0 une cuisine pour « la chaudière »'])
    expect(r.judgeSkipped).toBe('le film n’est pas trouvé')
  })

  it('no review report is said, never read as « no error »', async () => {
    const r = await deps({ review: async () => null }).check({ orderId: 1, runId: 7, channelId: 1, title: 't', real: true })
    expect(r.blocking).toEqual([])
    expect(r.checked).toBe(false)
    expect(r.review[0]).toMatch(/pas laissé de rapport de revue/u)
  })

  it('a demo order is never judged by the paid model, even with a film and a reference', async () => {
    let asked = 0
    const r = await deps({
      film: () => ({ file: __filename, durationS: 60 }),
      reference: () => __filename,
      ask: async () => {
        asked++
        return { text: '{}', costUsd: 0.02, model: 'm' }
      }
    }).check({ orderId: 1, runId: 7, channelId: 1, title: 't', real: false })
    expect(asked).toBe(0)
    expect(r.judgeSkipped).toMatch(/démo/u)
    expect(r.costUsd).toBe(0)
  })

  it('the judge looks at the same moments of both films, away from their ends', () => {
    const m = judgeMoments(124, 760, 12)
    expect(m).toHaveLength(12)
    expect(m[0]).toBeCloseTo(5, 0)
    expect(m.at(-1)).toBeLessThan(124)
  })

  it('the verdict as Charlie reads it: the mean, the reason and the defects said about ours, unblinded', () => {
    const v = verdictLines(
      {
        blind: true,
        sameChannel: 'no',
        reason: 'B has a different set than A',
        judge: 'sonnet',
        scores: [
          { axis: 'layout', score: 60, defects: ['B keeps the presenter full screen where A splits'] },
          { axis: 'voice', score: 90, defects: [] }
        ]
      },
      { A: 'reference', B: 'ours' }
    )
    expect(v).toEqual({ sameChannel: 'no', score: 75, reason: 'ours has a different set than the reference', defects: ['layout (60) : ours keeps the presenter full screen where the reference splits'] })
  })
})
