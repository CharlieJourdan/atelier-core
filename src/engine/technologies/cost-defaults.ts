// The estimator's volume assumptions and the screen-time shares it prices (decision 0023), in a leaf module so the nodes that
// forecast their own work before it exists (director.plan) read the very same numbers as the pipeline estimate (cost.ts).
import { budgetShares } from '../nodes/director-budget'
import { averageShares, curveRows, type Mix, type Shares } from './mix'

/** Our volume assumptions (docs/specs/pipeline-avatar.md §2, §5; decision 0030 settles the voice volume). Not prices. */
export const COST_DEFAULTS = {
  regenRate: 0.05,
  maxRegenRate: 0.15,
  /** Audio kept on each side of a presenter stretch (avatar §2.5). */
  handleS: 0.2,
  /** The silence between two stretches of one presenter call (avatar §2.5 b). */
  gapS: 0.1,
  /**
   * « Continuous » presenter: seconds generated per second shown when the presenter is also generated under the short cutaways
   * of its sections. 23.9 s for 15.6 s shown per finished minute (26 %): Charlie's provider study of 2026-10-31, to measure on
   * the production-10 ladder.
   */
  continuousRatio: 23.9 / 15.6,
  shotLengthS: { presenter: 4, clipAi: 3.7, imageAi: 3.4 },
  /**
   * Share of the presenter's time shown beside a picture (half-screen or inset), by the layouts the pipeline allows: Charlie's
   * Headcast reference 1 has 16.1 % half-screen and 5 % inset of 25.5 % presenter (avatar-reglages-voix: ≈ 0.8 with both).
   */
  besideShare: { all: 0.8, split: 0.6, pip: 0.2 },
  clipShotsPerGeneration: 1,
  /** A clip billed per second is billed for at least this long (Veo makes 4, 6 or 8 s). */
  clipMinBilledS: 4,
  /**
   * The cheap clip rules (vrais-tests Part C, measured on Charlie's Headcast reference, 2026-11-01): 101 of its 159 B-roll shots show
   * something moving (the director makes the others stills with a camera move: « motion only where it is seen »); 17 pairs of
   * consecutive shots on one continuous action (34 of the 101 motion shots); 22 of the 67 unpaired motion shots last 3 s or less
   * (the short engine, billed per second at their exact length, ≈ 3 s).
   */
  motionShare: 101 / 159,
  sameActionPairShare: 34 / 101,
  shortShareOfSingles: 22 / 67,
  shortBilledS: 3,
  /** A short shot's price over one main clip's (Grok 1.5 Lite 3 s 0.05 $ / Veo 3.1 Lite relaxed 0.075 $, read 2026-11-01): the run's
   *  forecast counts short shots in main-engine clips with it (the quote prices video on the main engine). */
  shortCallRatio: 0.05 / 0.075,
  /**
   * What a real run bills over what the forecast counts (issue #108, decision 0078: quote = capture). Measured on the two real
   * 3-minute « Avatar » runs of production-equipe (2026-11-03): clips 155 and 142 credits for a 115 quote (× 1.35 and × 1.23),
   * stills 35 and 31 for 24 (× 1.46 and × 1.29). The shots of a short hook-heavy video are shorter than the reference's, so the
   * director plans more of them (28 generated clips and 56 pictures for the 17 and 42 forecast), and each clip is billed whole.
   * Applied to the generated clip seconds and to the pictures, by the run quote and by the estimator alike (they agree).
   */
  measured: { clipSeconds: 1.29, images: 1.33, minutes: 3 },
  /** French narration at 176 words per minute (the Headcast measure, avatar §2.3). */
  voiceCharsPerMinute: 900,
  thumbnails: 3
} as const

/**
 * A measured factor at the length of a video: the excess is the hook-heavy opening's (shorter shots, more clips), so it fully
 * applies to the measured 3 minutes and fades for longer videos, which the beta Cloud's real quote of a 16.6-minute script
 * (878 credits) shows still agree with the plain forecast.
 */
export function measuredFactor(factor: number, minutes: number): number {
  return 1 + (factor - 1) * Math.min(1, COST_DEFAULTS.measured.minutes / Math.max(minutes, 0.01))
}

/** The mix a pipeline without one is estimated with: the base « Avatar » mix with a presenter, else stills and stock. */
const ASSUMED: Record<'presenter' | 'pictures', Shares> = {
  presenter: { presenter: 0.26, clipAi: 0.21, imageAi: 0.53 },
  pictures: { imageAi: 0.4, stock: 0.6 }
}

/** The screen-time shares over the video: the mix after its curve (the mix itself over a long video; a short one gets the
 *  long video's first rows: on hook-heavy, more clips). */
export function estimateShares(mix: Mix | null, hasPresenter: boolean, minutes: number): { shares: Shares; assumed: boolean } {
  if (!mix) return { shares: ASSUMED[hasPresenter ? 'presenter' : 'pictures'], assumed: true }
  const t = minutes * 60
  // a budgeted mix: the curve its budget makes for this length (nodes/director-budget.ts)
  const budgeted = budgetShares(mix, hasPresenter, minutes)
  if (budgeted) return { shares: budgeted, assumed: false }
  return { shares: averageShares(curveRows(mix, t), t), assumed: false }
}
