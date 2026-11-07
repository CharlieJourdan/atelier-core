// The dominant style weighs the channel's best-performing videos more than its latest ones (Yarnhub, 2026-11-06: a trailer and a
// one-off reaction video among the latest outvoted the 3D films its audience watches).
import { describe, expect, it } from 'vitest'
import { pickStyle } from '../../src/main/production/clone/p2-analysis'

describe('pickStyle', () => {
  it('on a tie in videos, the style holding a best-performing video wins, and the decision says the weight', async () => {
    const decisions: { decision: string; why: string }[] = []
    const ctx = {
      decide: (_p: string, decision: string, why: string) => decisions.push({ decision, why }),
      services: { synthesiser: { synthesise: async (_a: unknown, b: { style: string }) => ({ styles: body.styles, chosenStyle: b.style, constants: [], variables: [] }) } }
    }
    const body = { chosenStyle: null, constants: [], variables: [], styles: [
      { id: 's1', description: 'long form explainer, presenter 77 %', videos: ['v2', 'v3'] },
      { id: 's2', description: 'long form 3D animation', videos: ['v1', 'v4'] }
    ] }
    const corpus = { videos: [{ id: 'v1', why: 'latest' }, { id: 'v2', why: 'latest' }, { id: 'v3', why: 'latest' }, { id: 'v4', why: 'top' }] }
    const out = await pickStyle(ctx as never, [] as never, { style: null } as never, body as never, corpus as never)
    expect(out.chosenStyle).toBe('s2')
    expect(decisions.at(-1)!.decision).toBe('style picked s2: dominant')
    expect(decisions.at(-1)!.why).toMatch(/weight 2\.5/)
  })
})
