// Lot Z1: the local credits wallet (CreditsPort): never negative, idempotency (replay, conflict), hold → capture /
// release, simulated purchases recorded as such, balance = sums of the entries.
import { describe, expect, it } from 'vitest'
import { CREDIT_PACKS, IdempotencyConflict, InsufficientCredits, LocalWallet, creditsForUnits, creditsPerUnit } from '../../src/main/credits'
import { openDatabase } from '../../src/main/db'

const wallet = (): { w: LocalWallet; changes: () => number } => {
  let n = 0
  const w = new LocalWallet(openDatabase(':memory:'), () => new Date('2026-10-20T10:00:00Z'), () => n++)
  return { w, changes: () => n }
}

/** Balance recomputed from the entries list, independently of the wallet's SQL. */
function fromEntries(w: LocalWallet): { total: number; held: number } {
  let total = 0
  let held = 0
  for (const e of w.entries(500)) {
    if (e.kind === 'grant' || e.kind === 'adjust') total += e.amount
    if (e.kind === 'capture') {
      total -= e.amount
      held -= e.amount
    }
    if (e.kind === 'hold') held += e.amount
    if (e.kind === 'release') held -= e.amount
  }
  return { total, held }
}

describe('local wallet', () => {
  it('grants, holds, captures part and releases the rest; balance is the sum of the entries', () => {
    const { w, changes } = wallet()
    w.grant({ amount: 1000, idempotencyKey: 'g1' })
    const h = w.hold({ amount: 300, idempotencyKey: 'h1', runId: 7 })
    expect(w.balance()).toEqual({ available: 700, held: 300, total: 1000, simulated: 0, example: 0 })
    w.capture({ holdId: h.holdId, amount: 120, idempotencyKey: 'c1' })
    expect(w.remaining(h.holdId)).toBe(180)
    const r = w.release({ holdId: h.holdId, idempotencyKey: 'r1' })
    expect(r.amount).toBe(180)
    expect(r.runId).toBe(7) // inherited from the hold
    expect(w.balance()).toEqual({ available: 880, held: 0, total: 880, simulated: 0, example: 0 })
    const sums = fromEntries(w)
    expect(sums).toEqual({ total: w.balance().total, held: w.balance().held })
    expect(changes()).toBe(4)
    expect(w.entries().map((e) => e.kind)).toEqual(['release', 'capture', 'hold', 'grant'])
  })

  it('never goes negative: a hold larger than the available balance is refused, a capture cannot exceed its hold', () => {
    const { w } = wallet()
    w.grant({ amount: 100, idempotencyKey: 'g' })
    const h = w.hold({ amount: 80, idempotencyKey: 'h' })
    expect(() => w.hold({ amount: 21, idempotencyKey: 'h2' })).toThrow(InsufficientCredits)
    expect(() => w.hold({ amount: 21, idempotencyKey: 'h3' })).toThrow('Crédits insuffisants')
    w.hold({ amount: 20, idempotencyKey: 'h4' })
    expect(w.balance().available).toBe(0)
    expect(() => w.capture({ holdId: h.holdId, amount: 81, idempotencyKey: 'c' })).toThrow('plus que 80')
    expect(() => w.capture({ holdId: 999, amount: 1, idempotencyKey: 'c2' })).toThrow('introuvable')
    expect(() => w.grant({ amount: -5, idempotencyKey: 'neg' })).toThrow('Montant')
    expect(() => w.grant({ amount: 1.5, idempotencyKey: 'frac' })).toThrow('Montant')
    expect(() => w.grant({ amount: 5, idempotencyKey: '' })).toThrow('idempotence')
    expect(w.balance().available).toBeGreaterThanOrEqual(0)
  })

  it('replaying an idempotency key returns the first result; another movement under the same key is refused', () => {
    const { w, changes } = wallet()
    const g1 = w.grant({ amount: 500, idempotencyKey: 'same' })
    const g2 = w.grant({ amount: 500, idempotencyKey: 'same' })
    expect(g2).toEqual(g1)
    expect(w.balance().total).toBe(500)
    expect(changes()).toBe(1)
    expect(() => w.grant({ amount: 501, idempotencyKey: 'same' })).toThrow(IdempotencyConflict)
    expect(() => w.hold({ amount: 500, idempotencyKey: 'same' })).toThrow(IdempotencyConflict)
    const h = w.hold({ amount: 200, idempotencyKey: 'hold' })
    expect(w.hold({ amount: 200, idempotencyKey: 'hold' }).holdId).toBe(h.holdId)
    const c = w.capture({ holdId: h.holdId, amount: 50, idempotencyKey: 'cap' })
    expect(w.capture({ holdId: h.holdId, amount: 50, idempotencyKey: 'cap' })).toEqual(c)
    expect(() => w.capture({ holdId: h.holdId, amount: 60, idempotencyKey: 'cap' })).toThrow(IdempotencyConflict)
    const r = w.release({ holdId: h.holdId, idempotencyKey: 'rel' })
    expect(w.release({ holdId: h.holdId, idempotencyKey: 'rel' })).toEqual(r)
    expect(w.balance()).toMatchObject({ total: 450, held: 0, available: 450 })
  })

  it('a simulated purchase is a grant recorded as such (never money), and counted apart in the balance', () => {
    const { w } = wallet()
    expect(w.packs().map((p) => [p.id, p.credits, p.priceEur])).toEqual([
      ['pack-500', 500, 5],
      ['pack-2000', 2000, 20],
      ['pack-10000', 10000, 100]
    ])
    expect(CREDIT_PACKS.every((p) => Math.abs(p.credits * 0.01 - p.priceEur) < 1e-9)).toBe(true) // 1 credit = 0,01 €
    const e = w.simulatePurchase('pack-2000', 'buy-1')
    expect(e).toMatchObject({ kind: 'grant', amount: 2000, source: 'simulated_purchase' })
    expect(e.note).toContain('aucun paiement')
    expect(w.simulatePurchase('pack-2000', 'buy-1').id).toBe(e.id) // double click
    expect(w.balance()).toEqual({ available: 2000, held: 0, total: 2000, simulated: 2000, example: 0 })
    expect(() => w.simulatePurchase('pack-1', 'buy-2')).toThrow('Pack de crédits inconnu')
  })

  it('prices units like the Cloud grid v1: Claude free, at least 1 credit per priced line', () => {
    expect(creditsForUnits([{ unit: 'calls', qty: 10 }], 'claude')).toBe(0)
    expect(creditsForUnits([{ unit: 'tokens', qty: 100_000 }])).toBe(0)
    expect(creditsForUnits([{ unit: 'chars', qty: 1 }])).toBe(1)
    expect(creditsForUnits([{ unit: 'chars', qty: 1000 }])).toBe(Math.ceil(1000 * creditsPerUnit('chars')))
    expect(creditsForUnits([{ unit: 'images', qty: 10 }])).toBe(25) // 10 × 2.415 → 25
    expect(creditsForUnits([{ unit: 'chars', qty: 0 }])).toBe(0)
  })
})
