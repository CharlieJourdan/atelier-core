// Types shared by main and the renderer for the cost estimate and the fit % of a pipeline (decision 0023,
// docs/specs/production-model.md §8, §9, §12). The numbers are credits (1 credit = `creditEur` €); the renderer never imports
// the engine: main builds these views from `src/engine/technologies/cost.ts` and `fit.ts`, and the render time from its
// duration model (`src/main/production/estimates/duration.ts`, timings in `render-times.ts`).
import type { RenderTimeView } from './render-times'

export interface EstimateRange {
  min: number
  avg: number
  max: number
}

export const ESTIMATE_LINES = ['presenter', 'clips', 'images', 'voice', 'music', 'thumbnails', 'llm'] as const
export type EstimateLineId = (typeof ESTIMATE_LINES)[number]

/** One line of « Où va l'argent », in credits. */
export interface EstimateLineView {
  id: EstimateLineId
  /** The brick that spends it (technology name); null for the LLM line. */
  brick: string | null
  /** The engine priced for min and avg, then its fallbacks. */
  engines: string[]
  perMinute: EstimateRange
  perVideo: EstimateRange
  /** Engines of the line the Cloud gives no price for (counted 0). */
  unpriced: string[]
}

export type LlmBackendName = 'subscription' | 'credits' | 'api-key'

export const FIT_DIMENSION_IDS = ['presenter', 'kinds', 'rhythm', 'script', 'look', 'text', 'sponsor'] as const
export type FitDimensionId = (typeof FIT_DIMENSION_IDS)[number]

/** A change that closes a fit gap (mirrors `FitCloser` of src/engine/technologies/fit-gaps.ts). */
export type FitCloserView =
  | { kind: 'option'; option: string; value: string | number | boolean }
  | { kind: 'mix'; shares: Record<string, number> }
  | { kind: 'rhythm'; shotLengthS: { presenter?: number; clipAi?: number; imageAi?: number } }
  | { kind: 'look'; style: string }
  | { kind: 'speed'; speed: number }
  | { kind: 'minutes'; minutes: number }

export interface FitGapView {
  dimension: FitDimensionId
  score: number
  scoreAfter: number | null
  closer: FitCloserView | null
  /** Change of the average credits per finished minute the closer makes. */
  costDelta: number | null
}

export type FitView =
  | { state: 'no-channel' }
  | { state: 'not-enough-videos' | 'nothing-measured'; channelId: number; videos: number }
  | {
      state: 'ok'
      channelId: number
      percent: number
      videos: number
      /** An analysis came from the Cloud's demonstration provider: an example, not a reading. */
      demo: boolean
      dimensions: { id: FitDimensionId; weight: number; score: number | null }[]
      gaps: FitGapView[]
    }

export interface PipelineEstimateView {
  /** False when no price is known (the Cloud was never reached): `reason` says why. */
  available: boolean
  reason: string | null
  /** When the prices were read, and whether from the Cloud now or the copy kept from the last time. */
  prices: { at: string; source: 'live' | 'cache' } | null
  /** Value of one credit in euros. */
  creditEur: number
  minutes: number
  perMinute: EstimateRange
  perVideo: EstimateRange
  lines: EstimateLineView[]
  /** The pipeline has no mix: the director's defaults were assumed. */
  assumedMix: boolean
  llm: {
    backend: LlmBackendName
    tasks: string[]
    /** What the LLM work of one video costs on « crédits Atelier » (avg, credits): the saving of connecting Claude Code. */
    onCreditsPerVideo: number
    /** What it costs on the user's API key (avg, euros per video). */
    apiKeyEurPerVideo: number
    included: boolean
  }
  /** Per option, per value: the change of the average credits per finished minute (`+0.05` for a slider). */
  optionDeltas: Record<string, Record<string, number>>
  /** Provider plans the chosen engines spend (US $ a month, HeyGen's plan): fixed, never in the price per minute. */
  fixedMonthly: { engine: string; label: string; usd: number }[]
  /** The average render time of one video: the pipeline's own length first, then the usual lengths (known without prices). */
  renderTimes: RenderTimeView[]
  fit: FitView
}

/** What a pipeline card shows: credits per finished minute and the fit % to the channel in view. */
export interface PipelineCardEstimate {
  perMinute: EstimateRange
  /** What one video of the pipeline's own length costs (the quote's number: the one-off lines included); absent: perMinute x minutes. */
  perVideo?: EstimateRange
  fit: number | null
  /** The average render time of one video of the pipeline's own length. */
  renderTime: RenderTimeView | null
}

export interface EstimateCardsView {
  available: boolean
  reason: string | null
  creditEur: number
  /** By base pipeline id (`avatar@1`). */
  bases: Record<string, PipelineCardEstimate>
  /** By the team's pipeline id. */
  recipes: Record<number, PipelineCardEstimate>
}
