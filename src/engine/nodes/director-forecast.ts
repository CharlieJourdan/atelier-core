// What `director.plan` will ask the nodes after it to make, said before it has run (`NodeDef.forecast`): the list's meta
// (`items`, `avatarSeconds`, `videoSeconds`…) that the pictures, the clips and the presenter estimate their bill from. Without
// it a run's quote knows nothing of them until the director has planned, so the presenter and the clips would be quoted 0.
// It reads the pipeline's mix and the very numbers of the cost estimator (technologies/cost-defaults.ts), so the quote of a run
// and the estimate of its pipeline agree: the presenter's seconds with their handles, the clips' generations (one per
// `clipShotsPerGeneration` shots), the stills (one per picture shot, one per generation: each clip starts from a still).
import { COST_DEFAULTS, estimateShares, measuredFactor } from '../technologies/cost-defaults'
import type { Json } from '../types'
import type { DirectorParams } from './director-cuts'

/** A generated clip longer than this takes a second call (Veo makes up to 8 s). */
const CALL_MAX_S = 8

const r2 = (x: number): number => Math.round(x * 100) / 100

/** The list's meta for a video of `minutes`, or null when the director has no mix (the rhythm director: nothing is forecast). */
/** `videoMinutes`: the whole video's length when `minutes` is only a part of it (the measured excess depends on the video's). */
export function forecastGenlist(minutes: number, p: DirectorParams, videoMinutes = minutes): Record<string, Json> | null {
  if (!p.screen) return null
  const mix = p.screen.mix
  const { shares } = estimateShares(mix, p.avatar !== undefined, minutes)
  const D = minutes * 60
  const len = { ...COST_DEFAULTS.shotLengthS, ...(mix.shotLengthS ?? {}) }
  const perGen = p.clipShotsPerGeneration ?? COST_DEFAULTS.clipShotsPerGeneration
  const presenter = p.avatar !== undefined ? (shares.presenter ?? 0) : 0
  const presenterItems = (D * presenter) / len.presenter
  // once then cut: two handles and the silence between stretches (production-10; the « continuous » presenter is the avatar
  // brick's setting, unknown here: its quote stays the cut one, the estimate shows the difference)
  const presenterSeconds = D * presenter * (1 + (2 * COST_DEFAULTS.handleS + COST_DEFAULTS.gapS) / len.presenter)
  // « motion only where it is seen » (vrais-tests): the clip shots that show nothing moving are stills, as the estimator counts them
  const clipShare = p.clipMotionOnly ? Math.min(shares.clipAi ?? 0, COST_DEFAULTS.motionShare * ((shares.clipAi ?? 0) + (shares.imageAi ?? 0))) : (shares.clipAi ?? 0)
  const clipShots = (D * clipShare) / len.clipAi
  // the share of the clip shots served two by two (all of them with 2 shots per generation, unless the pair share says less; on
  // one continuous action only, as many as the reference shows)
  const asked = perGen >= 2 ? (p.clipPairShare ?? 1) : 0
  const paired = p.clipPairSameAction ? Math.min(asked, COST_DEFAULTS.sameActionPairShare) : asked
  const generations = clipShots * (1 - paired / 2)
  const found = (D * ((shares.stock ?? 0) + (shares.archive ?? 0))) / len.imageAi
  // a presenter in half-screen or inset shows a still beside him (the estimator's `besideShare`, avatar-reglages-voix)
  // unset: the director's own default (director-screen.ts: full frame and half-screen)
  const layouts = p.screen.layouts ?? ['full', 'split']
  const besideShare = layouts.includes('split') ? (layouts.includes('pip') ? COST_DEFAULTS.besideShare.all : COST_DEFAULTS.besideShare.split) : layouts.includes('pip') ? COST_DEFAULTS.besideShare.pip : 0
  const stills = (D * ((shares.imageAi ?? 0) + (shares.clipAi ?? 0) - clipShare)) / len.imageAi + presenterItems * besideShare
  // the pictures a run really makes are more than the ones counted (each generation also starts from one): measured (issue #108)
  const retakeStills = (stills + generations) * (measuredFactor(COST_DEFAULTS.measured.images, videoMinutes) - 1)
  // a per-call clip engine is priced per shot-length second (src/main/production/estimates/book.ts `nodeUnitPrices`), so a
  // generation costs its calls × that length whatever the shots it serves
  // short single shots on the per-second engine (vrais-tests) count as a fraction of a main clip
  const shortGens = p.clipShortEngine ? clipShots * (1 - paired) * COST_DEFAULTS.shortShareOfSingles : 0
  const calls = (generations - shortGens) * Math.max(1, Math.ceil((generations > 0 ? (len.clipAi * clipShots) / generations : len.clipAi) / CALL_MAX_S - 1e-9)) + shortGens * COST_DEFAULTS.shortCallRatio
  return {
    items: r2(presenterItems + clipShots + stills + retakeStills + found),
    stock: r2(found),
    ...(presenterItems > 0 ? { avatarItems: r2(presenterItems), avatarSeconds: r2(presenterSeconds) } : {}),
    ...(generations > 0
      ? { videoItems: r2(generations), videoSeconds: r2(calls * COST_DEFAULTS.shotLengthS.clipAi * measuredFactor(COST_DEFAULTS.measured.clipSeconds, videoMinutes)), ...(clipShots > generations ? { sharedItems: r2(clipShots - generations) } : {}) }
      : {})
  }
}
