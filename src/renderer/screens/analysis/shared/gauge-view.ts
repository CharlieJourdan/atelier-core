// Pure helpers of the reproducibility gauge component: the colour band of a score and the arc geometry.
import { tierOf, type Tier } from '../../../../shared/gauge'

export type GaugeTone = 'ok' | 'info' | 'warn' | 'err'

const TONE_BY_TIER: Readonly<Record<Tier, GaugeTone>> = { reproductible: 'ok', adaptations: 'info', partiel: 'warn', special: 'err' }

/** Colour band of a note: 80 and above green, 50 to 79 blue, 30 to 49 amber, below 30 red (the tiers of PLAN-V2-PRODUCTION §2.3). */
export function gaugeTone(score: number): GaugeTone {
  return TONE_BY_TIER[tierOf(score)]
}

/** The gauge is a 240 degree arc opening at the bottom. */
export const ARC_START_DEG = 150
export const ARC_SWEEP_DEG = 240

const rad = (deg: number): number => (deg * Math.PI) / 180

export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  return { x: +(cx + r * Math.cos(rad(deg))).toFixed(2), y: +(cy + r * Math.sin(rad(deg))).toFixed(2) }
}

/** SVG path of the arc from the start of the gauge over `fraction` (0..1) of its sweep. */
export function arcPath(cx: number, cy: number, r: number, fraction: number): string {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
  const start = polar(cx, cy, r, ARC_START_DEG)
  const end = polar(cx, cy, r, ARC_START_DEG + ARC_SWEEP_DEG * f)
  const large = ARC_SWEEP_DEG * f > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`
}
