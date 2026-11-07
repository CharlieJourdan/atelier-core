// The credits wallet as the app sees it (PLAN-V2-PRODUCTION §4.4). Lot Z1 implements it locally (`LocalWallet`, table
// `credit_entries`). Hand-off to lot P5: the Cloud's wallet is the source of truth; P5 writes a `CloudWallet`
// implementing this same interface over Atelier Cloud's HTTP API (`src/shared/cloud-api.ts`: balance, ledger, hold,
// capture, release, each with its idempotency key), and the core picks it when the app is connected. Callers
// (`ProductionRuns`, the credits IPC) must not depend on anything else. Rules every implementation keeps:
// - never negative: a hold is refused when available < amount; a capture never exceeds what its hold has left;
// - one idempotency key per movement: replaying a key returns the first result, a different movement under the same
//   key is refused;
// - the check and the write are one transaction;
// - purchases are SIMULATED in v2 (`simulatePurchase`): a grant recorded as such, never real money.
import type { CreditEntry, CreditPack, CreditsBalance, CreditSource } from '../../shared/runs'

export interface HoldResult {
  /** Id of the hold entry: what capture and release refer to. */
  holdId: number
  amount: number
}

export interface CreditsPort {
  balance(): CreditsBalance
  /** Newest first. */
  entries(limit?: number): CreditEntry[]
  grant(input: { amount: number; idempotencyKey: string; source?: CreditSource; note?: string; example?: boolean }): CreditEntry
  /** Reserves credits for a run; refused (French error) when the available balance is short. */
  hold(input: { amount: number; idempotencyKey: string; runId?: number; note?: string }): HoldResult
  /** Takes `amount` of an open hold (the real cost of a node). */
  capture(input: { holdId: number; amount: number; idempotencyKey: string; note?: string }): CreditEntry
  /** Gives back what the hold has left; returns the released entry (amount may be 0). */
  release(input: { holdId: number; idempotencyKey: string; note?: string }): CreditEntry
  /** What a hold has left to capture or release. */
  remaining(holdId: number): number
  /** Whether a movement with this idempotency key is already recorded (a replay would write nothing). */
  hasKey(idempotencyKey: string): boolean
  packs(): CreditPack[]
  /** A pack "bought" without money: a grant with source `simulated_purchase`. */
  simulatePurchase(packId: string, idempotencyKey: string): CreditEntry
}

/** Thrown when an idempotency key is reused for a different movement. */
export class IdempotencyConflict extends Error {
  override name = 'IdempotencyConflict'
}

/** Thrown when the wallet is short (a hold or capture would go negative). */
export class InsufficientCredits extends Error {
  override name = 'InsufficientCredits'
}
