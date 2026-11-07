// IPC contract, module "production": read-only history of the renders made by the old engine (table `engine_jobs`).

export interface PastRenderRow {
  id: number
  /** Where it ran: 'local' or 'h1'. */
  target: string
  title: string
  videoId: number
  deliverableId: number
  state: string
  error: string | null
  estimateUsd: number
  measuredUsd: number | null
  versionId: number | null
  createdAt: string
  updatedAt: string
}

export interface ProductionContract {
  /** Old renders, newest first (of one video when `videoId` is given). Read-only. */
  'production.pastRenders': { args: [videoId?: number]; result: PastRenderRow[] }
}

export const PRODUCTION_METHODS = ['production.pastRenders'] as const satisfies readonly (keyof ProductionContract)[]
