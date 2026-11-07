// equipe-3-chaines: `brain-run order` follows Charlie's order under ONE cap for the whole order, and stops loudly.
import { describe, expect, it } from 'vitest'
interface Mod {
  judgeOrder(orders: unknown[], spentUsd: number, maxUsd: number): { stop: string | null }
  orderCommand(brain: unknown, o: unknown, deps: unknown): Promise<unknown>
}
// a plain .mjs script (no type declarations): imported through a variable so tsc does not resolve it
const modPath = '../../scripts/brain-run-order.mjs'
const { judgeOrder, orderCommand } = (await import(modPath)) as Mod

const o = (id: number, status: string, notifiedAt: string | null) => ({ id, status, notifiedAt })

describe('brain-run order', () => {
  it('done when every ordered video was told; spend over the cap stops it first', () => {
    expect(judgeOrder([o(1, 'producing', null)], 0, 6).stop).toBeNull()
    expect(judgeOrder([o(1, 'ready', 'x'), o(2, 'ready', 'y')], 3, 6).stop).toBe('ok')
    expect(judgeOrder([o(1, 'ready', 'x'), o(2, 'failed', 'y')], 3, 6).stop).toBe('runFailed')
    expect(judgeOrder([o(1, 'producing', null)], 6.01, 6).stop).toBe('overSpend')
  })

  it('a direct real order needs the per-video cap, never above the whole cap', async () => {
    class UsageError extends Error {}
    const deps = { EXIT: {}, creditsToUsd: (c: number) => c / 100, UsageError, readText: () => 'msg' }
    const brain = { rate: async () => 1, call: async () => [] }
    await expect(orderCommand(brain, { messageFile: 'f', maxUsd: 6, direct: true, demo: false, eachUsd: null, pollS: 0, waitMin: 1 }, deps)).rejects.toThrow(/--each-usd/u)
    await expect(orderCommand(brain, { messageFile: 'f', maxUsd: 6, direct: true, demo: false, eachUsd: 7, pollS: 0, waitMin: 1 }, deps)).rejects.toThrow(/ne peut pas dépasser/u)
  })
})
