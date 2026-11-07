// The local credits wallet (lot Z1): `CreditsPort` over the `credit_entries` table. One BEGIN IMMEDIATE transaction
// per movement (check + write), idempotency keys UNIQUE in the table. Balance = sums over the entries:
//   total = grants + adjusts − captures;  held = holds − captures − releases;  available = total − held.
// Example-workspace grants (example = 1) are never spendable: they are left out of total/available and only
// reported in `example`, so deleting the example can never make the balance negative.
import { transaction, type Db } from '../db'
import type { CreditEntry, CreditEntryKind, CreditPack, CreditsBalance, CreditSource } from '../../shared/runs'
import { IdempotencyConflict, InsufficientCredits, type CreditsPort, type HoldResult } from './port'

/** Packs on sale (1 credit = 0,01 €). Buying is simulated in v2. */
export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: 'pack-500', credits: 500, priceEur: 5, label: '500 crédits' },
  { id: 'pack-2000', credits: 2000, priceEur: 20, label: '2 000 crédits' },
  { id: 'pack-10000', credits: 10000, priceEur: 100, label: '10 000 crédits' }
]

interface Row {
  id: number
  kind: CreditEntryKind
  amount: number
  run_id: number | null
  hold_id: number | null
  idempotency_key: string
  source: CreditSource
  note: string | null
  created_at: string
  example: number
}

const toEntry = (r: Row): CreditEntry => ({
  id: r.id,
  kind: r.kind,
  amount: r.amount,
  runId: r.run_id,
  holdId: r.hold_id,
  source: r.source,
  note: r.note,
  createdAt: r.created_at,
  example: r.example === 1
})

const KEY_MAX = 200

function checkKey(key: unknown): string {
  if (typeof key !== 'string' || key.trim() === '' || key.length > KEY_MAX) {
    throw new Error('Clé d’idempotence invalide.')
  }
  return key
}

function checkAmount(amount: unknown, allowZero = false): number {
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || (!allowZero && amount === 0) || amount > 1e9) {
    throw new Error('Montant de crédits invalide : un nombre entier positif est attendu.')
  }
  return amount
}

export class LocalWallet implements CreditsPort {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    private readonly onChange: () => void = () => undefined
  ) {}

  balance(): CreditsBalance {
    const r = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN kind IN ('grant','adjust') AND example = 0 THEN amount WHEN kind = 'capture' THEN -amount ELSE 0 END), 0) AS total,
           COALESCE(SUM(CASE WHEN kind = 'hold' THEN amount WHEN kind IN ('capture','release') THEN -amount ELSE 0 END), 0) AS held,
           COALESCE(SUM(CASE WHEN kind = 'grant' AND source = 'simulated_purchase' THEN amount ELSE 0 END), 0) AS simulated,
           COALESCE(SUM(CASE WHEN kind = 'grant' AND example = 1 THEN amount ELSE 0 END), 0) AS example
         FROM credit_entries`
      )
      .get() as { total: number; held: number; simulated: number; example: number }
    return { available: r.total - r.held, held: r.held, total: r.total, simulated: r.simulated, example: r.example }
  }

  entries(limit = 100): CreditEntry[] {
    const n = typeof limit === 'number' && Number.isInteger(limit) ? Math.min(500, Math.max(1, limit)) : 100
    return (this.db.prepare('SELECT * FROM credit_entries ORDER BY id DESC LIMIT ?').all(n) as unknown as Row[]).map(toEntry)
  }

  remaining(holdId: number): number {
    const r = this.db
      .prepare(
        `SELECT h.amount - COALESCE((SELECT SUM(amount) FROM credit_entries c WHERE c.hold_id = h.id AND c.kind IN ('capture','release')), 0) AS left
         FROM credit_entries h WHERE h.id = ? AND h.kind = 'hold'`
      )
      .get(holdId) as { left: number } | undefined
    if (!r) throw new Error('Réservation de crédits introuvable.')
    return r.left
  }

  grant(input: { amount: number; idempotencyKey: string; source?: CreditSource; note?: string; example?: boolean }): CreditEntry {
    const amount = checkAmount(input.amount)
    const source = input.source ?? 'local'
    return this.write(checkKey(input.idempotencyKey), { kind: 'grant', amount, source, note: input.note ?? null, example: input.example === true }, () => undefined)
  }

  hold(input: { amount: number; idempotencyKey: string; runId?: number; note?: string }): HoldResult {
    const amount = checkAmount(input.amount)
    const e = this.write(checkKey(input.idempotencyKey), { kind: 'hold', amount, runId: input.runId ?? null, note: input.note ?? null }, () => {
      const b = this.balance()
      if (b.available < amount) {
        throw new InsufficientCredits(`Crédits insuffisants : ${amount} nécessaires, ${b.available} disponibles.`)
      }
    })
    return { holdId: e.id, amount: e.amount }
  }

  capture(input: { holdId: number; amount: number; idempotencyKey: string; note?: string }): CreditEntry {
    const amount = checkAmount(input.amount, true)
    return this.write(checkKey(input.idempotencyKey), { kind: 'capture', amount, holdId: input.holdId, note: input.note ?? null }, () => {
      const left = this.remaining(input.holdId)
      if (amount > left) throw new InsufficientCredits(`La réservation n’a plus que ${left} crédits : impossible d’en prendre ${amount}.`)
    })
  }

  release(input: { holdId: number; idempotencyKey: string; note?: string }): CreditEntry {
    let amount = 0
    return this.write(
      checkKey(input.idempotencyKey),
      { kind: 'release', amount: 0, holdId: input.holdId, note: input.note ?? null, amountFromCheck: () => amount },
      () => {
        amount = this.remaining(input.holdId)
      }
    )
  }

  hasKey(idempotencyKey: string): boolean {
    return this.db.prepare('SELECT 1 FROM credit_entries WHERE idempotency_key = ?').get(checkKey(idempotencyKey)) !== undefined
  }

  packs(): CreditPack[] {
    return CREDIT_PACKS.map((p) => ({ ...p }))
  }

  simulatePurchase(packId: string, idempotencyKey: string): CreditEntry {
    const pack = CREDIT_PACKS.find((p) => p.id === packId)
    if (!pack) throw new Error('Pack de crédits inconnu.')
    return this.grant({
      amount: pack.credits,
      idempotencyKey,
      source: 'simulated_purchase',
      note: `Achat simulé : ${pack.label} (${pack.priceEur} €), aucun paiement`
    })
  }

  /**
   * One movement in one transaction. A known key: the same movement returns the first entry (replay), another
   * movement is refused. `check` runs inside the transaction before the insert (and throws to refuse).
   */
  private write(
    key: string,
    m: {
      kind: CreditEntryKind
      amount: number
      runId?: number | null
      holdId?: number | null
      source?: CreditSource
      note: string | null
      example?: boolean
      amountFromCheck?: () => number
    },
    check: () => void
  ): CreditEntry {
    const entry = transaction(this.db, () => {
      const prev = this.db.prepare('SELECT * FROM credit_entries WHERE idempotency_key = ?').get(key) as Row | undefined
      if (prev) {
        const same =
          prev.kind === m.kind &&
          (m.amountFromCheck ? true : prev.amount === m.amount) &&
          (prev.hold_id ?? null) === (m.holdId ?? null) &&
          (m.source === undefined || prev.source === m.source) &&
          (m.runId === undefined || (prev.run_id ?? null) === (m.runId ?? null))
        if (!same) throw new IdempotencyConflict('Cette opération de crédits a déjà été faite avec d’autres valeurs (clé d’idempotence réutilisée).')
        return { entry: toEntry(prev), fresh: false }
      }
      if (m.holdId !== undefined && m.holdId !== null) {
        const h = this.db.prepare("SELECT run_id FROM credit_entries WHERE id = ? AND kind = 'hold'").get(m.holdId) as { run_id: number | null } | undefined
        if (!h) throw new Error('Réservation de crédits introuvable.')
        m.runId ??= h.run_id
      }
      check()
      const amount = m.amountFromCheck ? m.amountFromCheck() : m.amount
      const res = this.db
        .prepare(
          `INSERT INTO credit_entries (kind, amount, run_id, hold_id, idempotency_key, source, note, created_at, example)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(m.kind, amount, m.runId ?? null, m.holdId ?? null, key, m.source ?? 'local', m.note, this.now().toISOString(), m.example ? 1 : 0)
      const row = this.db.prepare('SELECT * FROM credit_entries WHERE id = ?').get(Number(res.lastInsertRowid)) as unknown as Row
      return { entry: toEntry(row), fresh: true }
    })
    if (entry.fresh) this.onChange()
    return entry.entry
  }
}
