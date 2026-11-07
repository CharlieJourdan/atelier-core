// What every phase receives (decision 0095): the clone's store, the injected services, the budget, and two ways to record
// what happened (spend ledger, decision log). Phases never touch the network or the disk outside the store.
import type { Spend } from '../../../shared/clone'
import type { CloneServices } from './services'
import type { CloneStore } from './store'

export interface PhaseContext {
  cloneId: string
  store: CloneStore
  services: CloneServices
  /** The test budget the brief accepted (dollars); 0 before P0. */
  budgetUsd: number
  spend(s: Spend): void
  decide(phase: string, decision: string, why: string): void
  /** Budget left (never negative). */
  remainingUsd(): number
  /** True when a file (relative to the clone folder) exists. */
  exists(rel: string): boolean
}

export function phaseContext(store: CloneStore, services: CloneServices, budgetUsd: number): PhaseContext {
  return {
    cloneId: store.cloneId,
    store,
    services,
    budgetUsd,
    spend: (s) => store.spend(s),
    decide: (phase, decision, why) => store.decide({ at: services.now(), phase, decision, why }),
    remainingUsd: () => Math.max(0, budgetUsd - store.spent()),
    exists: (rel) => store.has(rel)
  }
}

/** The common head of an artefact written now. */
export function artefactHead<N extends string>(ctx: PhaseContext, name: N): { schema: `atelier.clone.${N}/1`; cloneId: string; createdAt: string } {
  return { schema: `atelier.clone.${name}/1`, cloneId: ctx.cloneId, createdAt: ctx.services.now() }
}
