// Issue #97: a cheap pipeline (≈ 0.4 credit a minute ≈ 0.004 €) read « 0,00 € / min ». Every euro amount of the estimate views goes
// through eurOf, which now says « < 0,01 » for a tiny non-zero price and keeps « 0,00 » for a real zero.
import { describe, expect, it } from 'vitest'
import { eurOf, signedEur } from '../../src/renderer/screens/production/recettes/estimate-format'

describe('eurOf', () => {
  it('a price under one cent is « < 0,01 », not « 0,00 »', () => {
    expect(eurOf(0.4, 0.01)).toBe('< 0,01')
    expect(eurOf(0.001, 1)).toBe('< 0,01')
  })
  it('keeps two decimals from one cent up, and a true zero stays 0,00', () => {
    expect(eurOf(0.41, 1)).toBe('0,41')
    expect(eurOf(1, 0.01)).toBe('0,01')
    expect(eurOf(574, 0.01)).toBe('5,74')
    expect(eurOf(0, 0.01)).toBe('0,00')
  })
  it('the signed change keeps its rule', () => {
    expect(signedEur(0.1, 0.01)).toBe('+0 €/min')
  })
})
