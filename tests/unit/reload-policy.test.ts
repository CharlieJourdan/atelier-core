import { describe, expect, it } from 'vitest'
import { createReloadPolicy, FALLBACK_PAGE } from '../../src/main/platform/reload-policy'

describe('reload policy', () => {
  it('reloads a few times, then stops (no loop), then allows again once the minute has passed', () => {
    const p = createReloadPolicy(3, 60_000)
    expect([0, 1000, 2000].map((t) => p.allow(t))).toEqual([true, true, true])
    expect(p.allow(3000)).toBe(false)
    expect(p.allow(59_000)).toBe(false)
    expect(p.allow(61_000)).toBe(true)
  })
  it('the fallback page is French and shows no code', () => {
    expect(FALLBACK_PAGE).toContain('Tes données sont gardées')
    expect(FALLBACK_PAGE).not.toMatch(/ERR_|Error|undefined/)
  })
})
