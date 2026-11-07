// The camera on a still (docs/ENGINE-SPEC.md §28.1, motion-montage): the classic moves (push, pull, drift left / right), a pan through
// keys (a route followed across a map, a zoom onto a region), punch-ins on the beat of the voice, and a 2.5D parallax (a near layer cut
// out of the picture moving faster than the far one). Everything is ffmpeg's `perspective` filter with expressions of the output frame
// number `on`: a smooth sub-pixel transform, no integer crop jitter, on any CPU (no GPU, no browser). Expressions are written without
// commas (a comma splits a filter graph): min, max and clamp are spelled with abs().
import type { Motion, Shot } from '../formats/editplan'
import { FPS } from '../formats/timing'

type Punch = NonNullable<Shot['punches']>[number]

const n4 = (x: number): string => x.toFixed(4)
/** ffmpeg's clip() with its commas escaped for a filter graph (`\,`): the graph's own parser would split on a bare comma. */
const clipE = (x: string, lo: string, hi: string): string => `clip(${x}\\,${lo}\\,${hi})`

/** Eased progress 0→1 between frames `a` and `b` of the shot, at output frame `on` + `offset` (a cosine ease: eased at both ends). */
export function stepExpr(a: number, b: number, offset = 0): string {
  const span = Math.max(1, b - a)
  return `(0.5-0.5*cos(PI*${clipE(`(on+${offset}-${n4(a)})/${n4(span)}`, '0', '1')}))`
}

/** Seconds a gliding move takes to reach its speed, and to stop. */
export const GLIDE_RAMP_S = 0.7

/**
 * Progress 0→1 over frames 0..n−1 at an even speed with eased ends (a trapezoid of speed: it accelerates over `GLIDE_RAMP_S`, glides,
 * slows over the same time), at output frame `on` + `offset`. Unlike `stepExpr` over a whole shot, a long shot keeps moving in its middle.
 */
export function glideExpr(n: number, offset = 0): string {
  const span = Math.max(1, n - 1)
  const r = Math.min(0.25, (GLIDE_RAMP_S * FPS) / span)
  const x = `((on+${offset})/${n4(span)})`
  const a = clipE(x, '0', n4(r))
  const b = `(${clipE(x, n4(r), n4(1 - r))}-${n4(r)})`
  const c = `(${clipE(x, n4(1 - r), '1')}-${n4(1 - r)})`
  // the speed's integral: a ramp up (a²/2r), the glide (b), a ramp down (c − c²/2r), scaled so the whole is 1
  return `(${n4(1 / (1 - r))}*(${a}*${a}/${n4(2 * r)}+${b}+${c}-${c}*${c}/${n4(2 * r)}))`
}

/** A whole-shot move's progress: gliding (`ease: 'glide'`), even from first frame to last (`linear`), or eased over the whole shot. */
const moveExpr = (m: Motion, n: number, offset = 0): string =>
  m.ease === 'glide' ? glideExpr(n, offset) : m.ease === 'linear' ? clipE(`(on+${offset})/${n4(Math.max(1, n - 1))}`, '0', '1') : stepExpr(0, n - 1, offset)

/** Frames a punch takes to jump in, and to come back out. */
export const PUNCH_IN_FRAMES = 3
export const PUNCH_OUT_FRAMES = 5

/** The factor the punches add to the zoom at frame `on` (1 when none): each jumps in on its time and, with `holdS`, comes back. */
export function punchExpr(punches: readonly Punch[] | undefined, offset = 0): string {
  if (!punches?.length) return '1'
  return punches
    .map((p) => {
      const a = p.atS * FPS
      const inE = stepExpr(a, a + PUNCH_IN_FRAMES, offset)
      const out = p.holdS === undefined ? '0' : stepExpr(a + p.holdS * FPS, a + p.holdS * FPS + PUNCH_OUT_FRAMES, offset)
      return `(1+${n4(p.zoom - 1)}*${inE}*(1-${out}))`
    })
    .join('*')
}

export interface CameraExpr {
  /** Zoom (1 = the picture fills the frame). */
  z: string
  /** Centre of the view, 0..1 of the picture. */
  cx: string
  cy: string
}

/** The camera of a move as expressions of `on`: `n` = frames of the whole move, `offset` = frames already played. */
export function cameraExpr(m: Motion | undefined, n: number, offset = 0): CameraExpr {
  const mm: Motion = m ?? { kind: 'push', from: 1.02, to: 1.02 }
  if (mm.kind === 'pan' && mm.keys && mm.keys.length >= 2) {
    const keys = [...mm.keys].sort((a, b) => a.atS - b.atS)
    const k0 = keys[0] as (typeof keys)[number]
    // the zoom is interpolated in log space (a zoom feels even), the centre straight
    let lz = n4(Math.log(k0.zoom))
    let cx = n4(k0.x)
    let cy = n4(k0.y)
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1] as (typeof keys)[number]
      const b = keys[i] as (typeof keys)[number]
      // a key's `ease: 'linear'` makes the move that ends at it even (keys sampled along a path glide through), else eased at both ends
      const e = b.ease === 'linear' ? clipE(`(on+${offset}-${n4(a.atS * FPS)})/${n4(Math.max(1, (b.atS - a.atS) * FPS))}`, '0', '1') : stepExpr(a.atS * FPS, b.atS * FPS, offset)
      lz += `+${n4(Math.log(b.zoom) - Math.log(a.zoom))}*${e}`
      cx += `+${n4(b.x - a.x)}*${e}`
      cy += `+${n4(b.y - a.y)}*${e}`
    }
    return { z: `exp(${lz})`, cx: `(${cx})`, cy: `(${cy})` }
  }
  const e = moveExpr(mm, n, offset)
  if (mm.kind === 'left' || mm.kind === 'right') {
    const zoom = Math.max(mm.from, mm.to, 1.08)
    const travel = (1 - 1 / zoom) * 0.42 // stay inside the picture
    const sign = mm.kind === 'left' ? 1 : -1
    return { z: n4(zoom), cx: `(0.5+${n4(sign * travel)}*(0.5-${e}))`, cy: '0.5' }
  }
  const z = `(${n4(mm.from)}+${n4(mm.to - mm.from)}*${e})`
  if (!mm.focus || mm.kind === 'parallax') return { z, cx: '0.5', cy: '0.5' }
  // towards the subject: its centre comes to the middle as the camera goes in (the view is kept inside the picture by perspectiveOf)
  const fx = mm.focus.x + mm.focus.w / 2
  const fy = mm.focus.y + mm.focus.h / 2
  const k = mm.to >= mm.from ? e : `(1-${e})`
  return { z, cx: `(0.5+${n4((fx - 0.5) * 0.8)}*${k})`, cy: `(0.5+${n4((fy - 0.5) * 0.8)}*${k})` }
}

/** The largest zoom a move reaches (punches included): above ~1.5 the picture is prepared larger so the zoom stays sharp. */
export function maxZoom(m: Motion | undefined, punches?: readonly Punch[]): number {
  const own = m?.kind === 'pan' && m.keys ? Math.max(...m.keys.map((k) => k.zoom)) : Math.max(m?.from ?? 1, m?.to ?? 1)
  return own * (punches ?? []).reduce((acc, p) => acc * p.zoom, 1)
}

/**
 * The `perspective` filter of a camera: the view of zoom z centred on (cx, cy) of the picture, kept inside it (a centre too near an edge
 * slides back in), `extra` multiplies the zoom (the punches).
 */
export function perspectiveOf(c: CameraExpr, extra = '1'): string {
  const z = extra === '1' ? c.z : `(${c.z}*${extra})`
  const half = `(0.5/${z})`
  // the centre clamped to [half, 1 − half]: the view never leaves the picture
  const cx = clipE(c.cx, half, `1-${half}`)
  const cy = clipE(c.cy, half, `1-${half}`)
  const x0 = `(W*(${cx}-${half}))`
  const x1 = `(W*(${cx}+${half}))`
  const y0 = `(H*(${cy}-${half}))`
  const y1 = `(H*(${cy}+${half}))`
  return `perspective=x0=${x0}:y0=${y0}:x1=${x1}:y1=${y0}:x2=${x0}:y2=${y1}:x3=${x1}:y3=${y1}:interpolation=cubic:eval=frame`
}

/** The camera filter of a still: its move, its punches. */
export function cameraFilter(m: Motion | undefined, n: number, offset = 0, punches?: readonly Punch[]): string {
  return perspectiveOf(cameraExpr(m, n, offset), punchExpr(punches, offset))
}

// ---- 2.5D parallax ------------------------------------------------------------------------------------------------------------------------

/** How much the far layer of a parallax zooms over the shot (the near one moves `depth` times more). */
export const PARALLAX_FAR = 0.05

/**
 * A soft elliptic mask of the subject (`focus`, 0..1 of the frame) for a frame of `size`, computed once (`geq` on one frame, then
 * looped): white inside, a soft edge of about a fifth of the ellipse.
 */
export function ellipseMask(focus: NonNullable<Motion['focus']>, size: readonly [number, number]): string {
  const [w, h] = size
  const cx = (focus.x + focus.w / 2) * w
  const cy = (focus.y + focus.h / 2) * h
  const rx = (focus.w / 2) * w
  const ry = (focus.h / 2) * h
  const d = `(pow((X-${cx.toFixed(1)})/${rx.toFixed(1)}\\,2)+pow((Y-${cy.toFixed(1)})/${ry.toFixed(1)}\\,2))`
  return `color=c=black:s=${w}x${h}:d=1,format=gray,geq=lum='255*clip((1.15-${d})/0.35\\,0\\,1)',loop=loop=-1:size=1:start=0`
}

/**
 * The filter graph of a parallax still: `[in]` the picture prepared to the frame, `mask` the near layer's mask source (a graph label of a
 * gray picture, or none: the focus ellipse), `[out]` the result. The far layer zooms slowly and goes a touch soft; the near layer, cut by
 * the mask, zooms `depth` times faster and drifts a little towards the frame's centre: the subject comes out of its background.
 */
export function parallaxGraph(o: { input: string; output: string; m: Motion; n: number; size: readonly [number, number]; maskLabel?: string; grade?: string; punches?: readonly Punch[] }): string {
  if (o.m.pop) return popGraph(o)
  const depth = o.m.depth ?? 2.2
  const z0 = Math.max(1.02, o.m.from)
  const far: Motion = { kind: 'push', from: z0, to: z0 + PARALLAX_FAR, ...(o.m.ease ? { ease: o.m.ease } : {}) }
  const focus = o.m.focus ?? { x: 0.3, y: 0.2, w: 0.4, h: 0.65 }
  const fx = focus.x + focus.w / 2
  const fy = focus.y + focus.h / 2
  const e = moveExpr(o.m, o.n)
  const near: CameraExpr = {
    z: `(${n4(z0)}+${n4(PARALLAX_FAR * depth)}*${e})`,
    // the near layer drifts towards the subject's centre a little while it grows, so it seems to come forward
    cx: `(0.5+${n4((fx - 0.5) * 0.25)}*${e})`,
    cy: `(0.5+${n4((fy - 0.5) * 0.25)}*${e})`
  }
  const punch = punchExpr(o.punches)
  const grade = o.grade ? `,${o.grade}` : ''
  const mask = o.maskLabel ?? '[pmask]'
  const maskSrc = o.maskLabel ? '' : `${ellipseMask(focus, o.size)}[pmask];`
  return (
    `${maskSrc}[${o.input}]split[pfar][pnear0];` +
    `[pfar]${perspectiveOf(cameraExpr(far, o.n), punch)},gblur=sigma=1.4${grade}[pfarv];` +
    `[pnear0]format=yuva444p[pnear1];[pnear1]${mask}alphamerge,${perspectiveOf(near, punch)}${grade}[pnearv];` +
    `[pfarv][pnearv]overlay=0:0:format=auto,format=yuv444p[${o.output}]`
  )
}

/** The depth pop's moves: the background pulls back from 1.06 to 1, the subject grows by 9 % (cosine eased). */
export const POP = { farFrom: 1.06, farTo: 1, grow: 0.09 } as const

/**
 * A « depth pop » (a variant of the parallax): the subject, cut out, grows towards the viewer while the background behind it pulls back,
 * dimmer, softer and less saturated; a soft shadow under the subject sets it off. Best with a cut-out `mask`; the focus ellipse works too.
 */
function popGraph(o: { input: string; output: string; m: Motion; n: number; size: readonly [number, number]; maskLabel?: string; grade?: string; punches?: readonly Punch[] }): string {
  const focus = o.m.focus ?? { x: 0.3, y: 0.2, w: 0.4, h: 0.65 }
  const e = moveExpr(o.m, o.n)
  const far: CameraExpr = { z: `(${n4(POP.farFrom)}+${n4(POP.farTo - POP.farFrom)}*${e})`, cx: '0.5', cy: '0.5' }
  // the subject grows about its own centre: the view's centre moves towards it as the zoom grows
  const fx = focus.x + focus.w / 2
  const fy = focus.y + focus.h / 2
  const g = `(${n4(POP.grow)}*${e})`
  const near: CameraExpr = { z: `(1+${g})`, cx: `(${n4(fx)}+(0.5-${n4(fx)})/(1+${g}))`, cy: `(${n4(fy)}+(0.5-${n4(fy)})/(1+${g}))` }
  const punch = punchExpr(o.punches)
  const grade = o.grade ? `,${o.grade}` : ''
  const mask = o.maskLabel ?? '[pmask]'
  const maskSrc = o.maskLabel ? '' : `${ellipseMask(focus, o.size)}[pmask];`
  return (
    `${maskSrc}[${o.input}]split[pfar][pnear0];` +
    `[pfar]${perspectiveOf(far, punch)},eq=brightness=-0.07:saturation=0.75,gblur=sigma=3${grade}[pfarv];` +
    `[pnear0]format=yuva444p[pnear1];[pnear1]${mask}alphamerge,${perspectiveOf(near, punch)}${grade}[pnearv];` +
    // the shadow: the subject's alpha, blurred, dark, a little lower, under the subject
    `[pnearv]split[pn1][pn2];[pn2]lutyuv=y=16:u=128:v=128:a='val*0.55',gblur=sigma=18:planes=8[psh];` +
    `[pfarv]format=yuva444p[pf];[pf][psh]overlay=0:14:format=auto[pfs];` +
    `[pfs][pn1]overlay=0:0:format=auto,format=yuv444p[${o.output}]`
  )
}
