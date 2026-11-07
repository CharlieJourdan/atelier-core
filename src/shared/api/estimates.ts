// IPC contract, module "estimates" (decision 0023): what a pipeline costs per finished minute and per video (min / avg /
// max, per brick, the LLM line by the team's backend, the Δ cost of each option choice) and its fit % to a channel. Pure
// computation in main from the Cloud's prices (or the copy kept from the last time). Types: `src/shared/estimates.ts`.
// Every method added here must also be listed in ESTIMATES_METHODS (tests/unit/ipc.test.ts compares the list with main).
import type { RecipeDocument } from '../recipes'
import type { EstimateCardsView, PipelineEstimateView } from '../estimates'

export type * from '../estimates'

export interface EstimatesContract {
  /** The estimate of a pipeline document as edited (not saved), and its fit to a channel (null: no fit). */
  'estimates.pipeline': { args: [doc: RecipeDocument, channelId?: number | null]; result: PipelineEstimateView }
  /** Credits per minute and fit % of every base pipeline and of the team's pipelines (the cards). */
  'estimates.cards': { args: [channelId?: number | null]; result: EstimateCardsView }
}

export const ESTIMATES_METHODS = ['estimates.pipeline', 'estimates.cards'] as const satisfies readonly (keyof EstimatesContract)[]
