// IPC contract, module "engines" (decision 0021): the engines registry Atelier Cloud publishes (`GET /v1/engines`),
// read-only. Types: `src/shared/cloud-engines.ts`.
// Every method added here must also be listed in ENGINES_METHODS (tests/unit/ipc.test.ts compares the list with main).
import type { EnginesView } from '../cloud-engines'

export type { EngineInfo, EngineFamily, EnginesView } from '../cloud-engines'

export interface EnginesContract {
  /** The Cloud's engines (id, price in credits per unit, limits, health, who serves it), or why they are not available. */
  'engines.list': { args: []; result: EnginesView }
}

export const ENGINES_METHODS = ['engines.list'] as const satisfies readonly (keyof EnginesContract)[]
