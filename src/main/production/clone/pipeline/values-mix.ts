// P5 (chantier reverse-pipeline): the director's mix curve and cadence from the MEASURED distributions along the video — every screen
// element's share per part and per tenth (definition `sourcing.distributions`), the mean shot length per part (`editing.shotByPart`).
// « Presenter 70 % in the hook, stills dominate the end » becomes curve rows by fraction of the video, set at their seconds for the
// planned length; the mix's overall shares are those rows' own average, so the engine's fitting (technologies/mix.ts curveRows) keeps
// them as measured. Undefined when nothing was measured: the callers keep their former behaviour. Pure.
import { isDeepStrictEqual } from 'node:util'
import type { DistributionRow, StyleDefinition } from '../../../../shared/clone'
import { CURVE_FIT_S, type CurveRow, type Shares } from '../../../../engine/technologies/mix'

const r2 = (n: number): number => Math.round(n * 100) / 100
const r3 = (n: number): number => Math.round(n * 1000) / 1000
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const said = (f: { source: string }): boolean => f.source !== 'default'

/** The video's length the plan is made for, in seconds (as pipeline/values.ts planSeconds). */
const planSecondsOf = (minutes: number): number => Math.max(30, Math.round(minutes * 60))

/**
 * The hook's share of the video, only from a measure: the hook part's measured share of the runtime, else the measured hook window
 * over the planned length; undefined when neither was measured (the definition's own 15 s default never places a hook).
 */
export function measuredHookShare(def: StyleDefinition, planS: number): number | undefined {
  const hook = said(def.script.parts) ? def.script.parts.value.find((p) => /hook|accroche|intro/i.test(p.name)) : undefined
  if (hook && hook.share > 0 && hook.share < 1) return hook.share
  if (said(def.script.hookWindowS) && def.script.hookWindowS.value > 0) return clamp(def.script.hookWindowS.value / planS, 0, 0.9)
  return undefined
}

/** The end part's measured share of the video (0 when no end part was measured). */
function measuredEndShare(def: StyleDefinition): number {
  if (!said(def.script.parts)) return 0
  const last = def.script.parts.value[def.script.parts.value.length - 1]
  return last && /end|outro|conclu|fin/i.test(last.name) ? last.share : 0
}

const distributionsOf = (def: StyleDefinition): DistributionRow[] => (said(def.sourcing.distributions) ? def.sourcing.distributions.value : [])

/** The engine's mix kinds from one moment's element shares: the same mapping as values.ts mixSharesFrom (filmed and screen stood in by
 *  found footage, 3D by drawn scenes when the channel draws), the generated pictures split by their measured stills vs moving. */
function kindsAt(el: (element: string) => number, opts: { archive: boolean; draws: boolean }): Shares {
  const presenter = clamp(el('presenter'), 0, 1)
  const found = el('origin:found')
  const others: Shares = {
    motion: el('origin:motion') + el('origin:drawn') + (opts.draws ? el('origin:3d') : 0),
    clipAi: el('generated:moving'),
    imageAi: el('generated:still'),
    stock: (opts.archive ? 0 : found) + el('origin:filmed') + el('origin:screen'),
    archive: opts.archive ? found : 0
  }
  const sum = Object.values(others).reduce((a, b) => a + (b ?? 0), 0)
  // the presenter's time is his on-screen time (an inset over a picture counts); the pictures share the rest in their measured ratio
  const out: Shares = sum > 0 ? { presenter } : { presenter: presenter > 0 ? 1 : 0 }
  if (sum > 0) for (const [k, v] of Object.entries(others) as [keyof Shares, number][]) out[k] = (v * (1 - presenter)) / sum
  return normalised(out)
}

/** Shares rounded to 3 decimals, zeros dropped, the rounding drift on the largest so they add to 1 ({} when nothing is there). */
function normalised(s: Shares): Shares {
  const total = Object.values(s).reduce((a, b) => a + (b ?? 0), 0)
  if (total <= 0) return {}
  const out: Shares = {}
  for (const [k, v] of Object.entries(s) as [keyof Shares, number][]) if (v / total >= 0.0005) out[k] = r3(v / total)
  const keys = (Object.keys(out) as (keyof Shares)[]).sort((a, b) => (out[b] ?? 0) - (out[a] ?? 0))
  if (keys[0]) out[keys[0]] = r3((out[keys[0]] ?? 0) + 1 - keys.reduce((a, k) => a + (out[k] ?? 0), 0))
  return out
}

/**
 * The mix curve rows from the measured distributions: a hook row from the hook part's shares (when the hook's length was measured),
 * then one row per tenth of the video from the per-tenth shares — the tenth the hook ends in carries what is left of it once the
 * hook's own time is taken out. Rows by fraction of the video, set at their seconds for `minutes`. Undefined when no distribution
 * was measured.
 */
export function distributionRows(def: StyleDefinition, minutes: number): CurveRow[] | undefined {
  const dist = distributionsOf(def)
  if (dist.length === 0) return undefined
  const planS = planSecondsOf(minutes)
  const opts = { archive: /archive|period|histor/i.test(def.sourcing.illustrationStyle.value), draws: dist.some((d) => d.element === 'origin:drawn' && d.overall > 0) }
  const hookShare = measuredHookShare(def, planS)
  const hookOf = (d: DistributionRow): number | undefined => d.byPart.find((p) => p.part === 'hook')?.share
  const hasHook = hookShare !== undefined && dist.some((d) => hookOf(d) !== undefined)
  const rows: { frac: number; el: (e: string) => number }[] = []
  const find = (e: string): DistributionRow | undefined => dist.find((d) => d.element === e)
  if (hasHook) rows.push({ frac: 0, el: (e) => hookOf(find(e) ?? { element: e, overall: 0, byPart: [], curve: [] }) ?? find(e)?.overall ?? 0 })
  const tenths = Math.max(...dist.map((d) => d.curve.length))
  for (let k = 0; k < tenths; k++) {
    const a = k / tenths
    const b = (k + 1) / tenths
    const h = hasHook ? hookShare! : 0
    if (b <= h + 1e-9) continue
    const from = Math.max(a, h)
    rows.push({
      frac: from,
      el: (e) => {
        const d = find(e)
        const c = d?.curve[k] ?? d?.overall ?? 0
        if (from <= a || !d) return c
        // the tenth's share less the hook's part of it: what the rest of that tenth shows
        return clamp((c * (b - a) - (hookOf(d) ?? c) * (from - a)) / (b - from), 0, 1)
      }
    })
  }
  const out: CurveRow[] = []
  for (const r of rows) {
    const fromS = out.length === 0 ? 0 : Math.round(r.frac * planS)
    if (out.length > 0 && fromS <= out[out.length - 1]!.fromS) continue
    const shares = kindsAt(r.el, opts)
    // a tenth that shows what the one before it shows adds no row
    if (Object.keys(shares).length && !(out.length && isDeepStrictEqual(out[out.length - 1]!.shares, shares))) out.push({ fromS, shares })
  }
  return out.length ? out : undefined
}

/** The overall shares the rows give over the length the engine fits a curve on (max of the video and CURVE_FIT_S, the last row running
 *  to its end): with them as the mix's shares, the engine's fitting leaves the measured rows as they are. */
export function sharesOfRows(rows: readonly CurveRow[], minutes: number): Shares {
  const fitS = Math.max(planSecondsOf(minutes), CURVE_FIT_S)
  const out: Shares = {}
  rows.forEach((r, i) => {
    const span = Math.max(0, Math.min(fitS, rows[i + 1]?.fromS ?? fitS) - r.fromS)
    for (const [k, v] of Object.entries(r.shares) as [keyof Shares, number][]) out[k] = (out[k] ?? 0) + (v * span) / fitS
  })
  return normalised(out)
}

/** The rows' kinds, overall: what the mix asks of the bricks (presenter, clips, stills, found footage, motion). Undefined without rows. */
export function measuredMixShares(def: StyleDefinition, minutes: number): Shares | undefined {
  const rows = distributionRows(def, minutes)
  return rows ? sharesOfRows(rows, minutes) : undefined
}

/**
 * director.plan's `paceRows` from the measured mean shot length per part: each part's mean over the video's mean, from where the part
 * starts (the hook from 0 when its length was measured, the body after it, the end over its measured share). Undefined when the
 * cadence was not measured part by part.
 */
export function paceRowsFrom(def: StyleDefinition, minutes: number): { fromS: number; factor: number }[] | undefined {
  if (!said(def.editing.shotByPart) || def.editing.shotByPart.value.length === 0) return undefined
  const byPart = def.editing.shotByPart.value
  const at = (part: string): number | undefined => byPart.find((p) => p.part === part)?.meanShotS
  const overall = said(def.editing.meanShotS) && def.editing.meanShotS.value > 0 ? def.editing.meanShotS.value : byPart.reduce((a, p) => a + p.meanShotS, 0) / byPart.length
  const factor = (s: number): number => r2(clamp(s / Math.max(overall, 0.01), 0.3, 3))
  const planS = planSecondsOf(minutes)
  const hook = measuredHookShare(def, planS)
  const hookS = hook !== undefined && at('hook') !== undefined ? Math.round(hook * planS) : 0
  const body = at('body') ?? overall
  const rows: { fromS: number; factor: number }[] = hookS > 0 ? [{ fromS: 0, factor: factor(at('hook')!) }, { fromS: hookS, factor: factor(body) }] : [{ fromS: 0, factor: factor(body) }]
  const endS = Math.round(planS * (1 - measuredEndShare(def)))
  if (at('end') !== undefined && endS > rows[rows.length - 1]!.fromS + 1 && endS < planS) rows.push({ fromS: endS, factor: factor(at('end')!) })
  return rows
}
