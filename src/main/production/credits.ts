// Credits on the app side (PLAN-V2-PRODUCTION §1.8, lot P5). Atelier Cloud's wallet is the authority: every paid item
// is one Cloud job that holds its quoted credits, captures what was really used and gives the rest back (cloud/src/
// jobs.ts), and the app copies each job into its local ledger (src/main/cloud/mirror.ts). What this module adds is the
// engine's side of the contract (src/engine/estimate.ts):
//   - `CloudQuoter`: prices a pipeline estimate line by line through `POST /v1/estimates` (no quote stored);
//   - `CreditSpender`: before a paid node starts, prices its estimate, refuses it when it would cross the video's
//     credit cap or when the wallet does not have that many credits left, and tracks the run's committed credits;
//     the node's credits are settled at its reported cost (priced the same way) or released on failure or cancel.
// A Cloud that cannot be reached refuses the node BEFORE anything is asked of a provider: nothing is paid.
import { EstimateResponse, WalletResponse, type Usage } from '../../shared/cloud-api'
import { DEFAULT_ENGINES, engineFamilyOf, type EngineFamily } from '../../shared/cloud-engines'
import { BUSY, type CloudCaller } from '../../engine/cloud-http'
import { EngineError, isAbortError } from '../../engine/errors'
import type { QuoteLine, QuoteRequestItem, Quoter, Reservation, Spender } from '../../engine/estimate'
import type { Cost, Estimate, EstimateUnit } from '../../engine/types'

/** Which Cloud usage prices each estimate unit (the grid's items, cloud/src/pricing.ts USAGE_ITEM). */
export const UNIT_USAGE: Partial<Record<EstimateUnit, Usage>> = {
  chars: 'synthesize',
  images: 'generateImage',
  video_s: 'generateVideo',
  avatar_s: 'talkingAvatar',
  gpu_s: 'submitGpuJob',
  searches: 'searchStock',
  watch_min: 'analyseVideo'
}

export const CLOUD_UNREACHABLE_NOTHING_PAID =
  'Atelier Cloud est injoignable : vérifie que le Cloud tourne et que l’app y est connectée, puis réessaie. Rien n’a été payé.'

/**
 * Reads a Cloud failure as the refusal a paid node gets before it starts: an unreachable Cloud is final (never retried, nothing
 * was spent); a busy one (429, already waited for about 2 minutes) stays « occupé » and transient (production-17).
 */
function beforeStart(e: unknown): never {
  if (isAbortError(e)) throw e
  if (e instanceof EngineError && e.code === 'transient' && !e.message.startsWith(BUSY)) throw new EngineError('missing_tool', CLOUD_UNREACHABLE_NOTHING_PAID)
  throw e
}

/** The engine family each priced unit is made on (the others have no engine: searches, GPU seconds, the eyes). */
const UNIT_FAMILY: Partial<Record<EstimateUnit, EngineFamily>> = { chars: 'voice', images: 'image', video_s: 'clip', avatar_s: 'presenter' }

/**
 * The engine a unit of a node is priced on, exactly as the run's quote reads it (runs/quote.ts `pricesFor`): the engine the
 * node names when it is of the unit's family, else the family's default (the Cloud serves the same defaults). A step so
 * reserves what its own quote line says, never the grid line's worst case (issue #89, decision 0107).
 */
export function engineOfUnit(unit: EstimateUnit, params: unknown): string | undefined {
  const family = UNIT_FAMILY[unit]
  if (!family) return undefined
  const named = typeof params === 'object' && params !== null ? (params as { engine?: unknown }).engine : undefined
  if (typeof named === 'string' && engineFamilyOf(named) === family) return named
  return DEFAULT_ENGINES[family].engine
}

/** Prices units in credits, one line per unit kind; units the grid does not sell (calls, tokens) cost 0. */
async function price(caller: CloudCaller, units: Estimate['units'], signal: AbortSignal, params?: unknown): Promise<number> {
  const items = units.flatMap((u, i) => {
    const usage = UNIT_USAGE[u.unit]
    const engine = engineOfUnit(u.unit, params)
    return usage && u.qty > 0 ? [{ key: String(i), usage, quantity: u.qty, ...(engine ? { engine } : {}) }] : []
  })
  if (items.length === 0) return 0
  const res = await caller.call('POST', '/v1/estimates', EstimateResponse, signal, { items })
  return res.totalCredits
}

export class CloudQuoter implements Quoter {
  constructor(private readonly caller: CloudCaller) {}

  async quote(items: QuoteRequestItem[], signal = new AbortController().signal): Promise<{ lines: QuoteLine[] }> {
    const lines: QuoteLine[] = []
    try {
      for (const it of items) lines.push({ nodeId: it.nodeId, credits: await price(this.caller, it.units, signal) })
    } catch (e) {
      beforeStart(e)
    }
    return { lines }
  }
}

export interface CreditSpenderOptions {
  caller: CloudCaller
  /** The video's cap in credits (`budget.capCredits`); null = no cap beyond the wallet. */
  capCredits?: number | null
  /** Credits the video already spent or holds (a resumed run, earlier runs of the same video): they count in the cap. */
  alreadyCommitted?: number
  /**
   * The run's price promise (decision 0078): everything this run reserves and settles stays within `ceilingCredits`
   * (`captureCeiling(quote)`), `spentCredits` of it already spent by earlier attempts. A step beyond it is refused before it starts.
   */
  run?: { ceilingCredits: number; spentCredits: number }
}

/** One per run: the credits a run commits never cross its cap (R12.5) nor the wallet. */
export class CreditSpender implements Spender {
  private readonly open = new Map<string, number>()
  private settled: number

  constructor(private readonly o: CreditSpenderOptions) {
    this.settled = Math.max(0, o.alreadyCommitted ?? 0)
  }

  /** Credits of the video so far: settled nodes plus open reservations. */
  committed(): number {
    return this.settled + this.openCredits()
  }

  private openCredits(): number {
    let n = 0
    for (const c of this.open.values()) n += c
    return n
  }

  /** What THIS run reserved or settled (without the earlier runs of the video the cap also counts). */
  private runCommitted(): number {
    return this.settled - Math.max(0, this.o.alreadyCommitted ?? 0) + this.openCredits()
  }

  async reserve(req: { runId: string; nodeId: string; idempotencyKey: string; estimate: Estimate; params?: unknown }): Promise<Reservation> {
    const signal = new AbortController().signal
    let credits = 0
    let available = 0
    try {
      credits = await price(this.o.caller, req.estimate.units, signal, req.params)
      available = (await this.o.caller.call('GET', '/v1/wallet', WalletResponse, signal)).available
    } catch (e) {
      beforeStart(e)
    }
    const cap = this.o.capCredits ?? null
    if (cap !== null && this.committed() + credits > cap) {
      throw new EngineError('budget', `Cette étape (≈ ${credits} crédits) dépasserait le plafond de la vidéo (${cap} crédits).`)
    }
    const run = this.o.run
    if (run && credits > 0 && Math.max(0, run.spentCredits) + this.runCommitted() + credits > run.ceilingCredits) {
      throw new EngineError('budget', `Cette étape (≈ ${credits} crédits) dépasserait le plafond du devis de cette fabrication (${run.ceilingCredits} crédits).`)
    }
    if (credits > available) {
      throw new EngineError('budget', `Crédits insuffisants pour cette étape : il en faut ≈ ${credits}, il en reste ${available}.`)
    }
    const key = req.idempotencyKey
    this.open.set(key, (this.open.get(key) ?? 0) + credits)
    let closed = false
    return {
      settle: async (cost: Cost | undefined) => {
        if (closed) return
        // the node's real use, priced like its estimate; without a report the reservation stands
        let real = credits
        if (cost) real = await price(this.o.caller, cost.units, signal, req.params)
        closed = true
        this.open.delete(key)
        this.settled += real
      },
      release: () => {
        if (!closed) {
          closed = true
          this.open.delete(key)
        }
        return Promise.resolve()
      }
    }
  }
}

/** The app is not connected to a Cloud: a paid node is refused with a clear message, before anything starts. */
export const notConnectedSpender: Spender = {
  reserve: () =>
    Promise.reject(new EngineError('missing_tool', 'L’app n’est pas connectée à Atelier Cloud : connecte-la dans Réglages. Rien n’a été payé.'))
}
