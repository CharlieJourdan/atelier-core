// Credits of a non-demo run (lot Z1, PLAN-V2-PRODUCTION §1.8): at each engine start the quote's unspent part is HELD
// in the wallet; each node's real cost is CAPTURED from that hold (paid executors through the engine's `Spender`,
// local nodes calling a paid provider through the cost they report); when the attempt ends (done, failed, cancelled,
// app restart) the rest is RELEASED. Demo runs never touch the wallet. Every movement carries an idempotency key built
// from the run, node and fingerprint, so a replay never debits twice.
import type { Reservation, Spender } from '../../../engine/estimate'
import { EngineError } from '../../../engine/errors'
import type { Cost } from '../../../engine/types'
import type { Db } from '../../db'
import { InsufficientCredits, type CreditsPort } from '../../credits/port'
import { creditsForUnits, type UnitPrices } from '../../credits/prices'

export const priced = (c: Cost | undefined, prices?: UnitPrices | null): number => (c ? creditsForUnits(c.units, c.provider, prices) : 0)

export class RunMoney {
  /** node id + fingerprint already captured through the Spender (the `done` event then captures nothing more). */
  private readonly settled = new Set<string>()

  constructor(
    private readonly credits: CreditsPort,
    private readonly db: Db,
    private readonly runId: number,
    readonly holdId: number,
    private readonly onChange: () => void,
    /** The prices the run was quoted with (the hold), so a capture prices the same units the same way. */
    private readonly prices: UnitPrices | null = null
  ) {}

  /** The engine's wallet for paid executors (`cloud`, `gpu`): refuses a node the hold cannot cover. */
  spender(): Spender {
    return {
      reserve: (req): Promise<Reservation> => {
        const need = creditsForUnits(req.estimate.units, req.estimate.provider, this.prices)
        if (this.credits.remaining(this.holdId) < need) {
          return Promise.reject(new EngineError('budget', 'Crédits insuffisants pour cette étape : la réservation de la vidéo est épuisée.'))
        }
        return Promise.resolve({
          settle: (cost: Cost | undefined) => {
            this.capture(req.nodeId, req.fingerprint, cost ? priced(cost, this.prices) : need)
            this.settled.add(`${req.nodeId}:${req.fingerprint}`)
            return Promise.resolve()
          },
          release: () => Promise.resolve() // nothing was taken: the run's hold keeps it until the attempt ends
        })
      }
    }
  }

  /** A node finished with a reported cost (a local node calling a paid provider). */
  nodeDone(nodeId: string, fingerprint: string, cost: Cost | undefined): void {
    if (this.settled.has(`${nodeId}:${fingerprint}`)) return
    const amount = priced(cost, this.prices)
    if (amount > 0) this.capture(nodeId, fingerprint, amount)
  }

  private capture(nodeId: string, fingerprint: string, amount: number): void {
    const left = this.credits.remaining(this.holdId)
    const take = Math.min(amount, left)
    if (take <= 0) return
    const key = `run-${this.runId}-capture-${this.holdId}-${nodeId}-${fingerprint}`
    // an idempotent replay writes nothing in the wallet, so the counters must not move either
    const replay = this.credits.hasKey(key)
    try {
      // the hold id is part of the key: a retry opens a new hold and captures the same node again against it
      this.credits.capture({
        holdId: this.holdId,
        amount: take,
        idempotencyKey: key,
        note: `Fabrication ${this.runId}, étape ${nodeId}`
      })
    } catch (e) {
      if (e instanceof InsufficientCredits) return
      throw e
    }
    if (replay) return
    this.db.prepare('UPDATE video_run_nodes SET credits = credits + ? WHERE run_id = ? AND node_id = ?').run(take, this.runId, nodeId)
    this.db.prepare('UPDATE video_runs SET spent_credits = spent_credits + ? WHERE id = ?').run(take, this.runId)
    this.onChange()
  }
}

/** Gives back what the run's current hold has left (idempotent: one release per hold). */
export function releaseHold(credits: CreditsPort, db: Db, runId: number, holdId: number | null): void {
  if (holdId === null) return
  try {
    credits.release({ holdId, idempotencyKey: `run-${runId}-release-${holdId}`, note: `Fin de la fabrication ${runId}` })
  } catch {
    // the hold is gone (example cleared…): nothing to give back
  }
  db.prepare('UPDATE video_runs SET hold_id = NULL WHERE id = ? AND hold_id = ?').run(runId, holdId)
}
