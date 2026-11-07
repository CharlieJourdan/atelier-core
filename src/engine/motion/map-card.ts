// The map card (formats/cards.ts, research note style-markets-of-the-past-2026-11 (old repository)): a full-frame, opaque, dark satellite map. The Earth picture and
// every vector (borders, countries shaded, routes) live in a "world" layer that the runtime's camera (`data-cam`, runtime.ts) pushes from the first
// view to the last; the texts, pins and callouts ride their world points without being scaled (`data-cp`), so they stay sharp and the same size.
// What the page needs from the Earth (the picture, the paths in pixels) is prepared by geo.ts `prepareMapAssets`; the page itself touches no file.
// A route is a journey that draws itself along its smoothed curve (geo.ts `routeCurve`) with a small head riding the drawn end.
import type { CardAssets, MapAssets, MapCardProps } from '../formats/cards'
import { DOC_PALETTE } from '../formats/cards'
import { esc, type MotionCtx } from './base'
import type { Part } from './cards'
import { DARK_STYLE, paperTexture, type DocStyle } from './doc-parchment'
import { curveLength, pointAlong } from './geo'
import { PLATE, mapParchmentCss, parchRegion, parchRoute, parchTones, parchWash } from './map-parchment'

const f = (n: number): string => n.toFixed(2)
const SERIF = `'Source Serif 4','Iowan Old Style','Georgia',serif`
const CONDENSED = `'Oswald','Arial Narrow','Impact',sans-serif`

/** The tones of a shaded country: its fill and its brighter outline. */
const TONES = {
  red: { fill: 'rgba(213,65,47,.40)', line: 'rgba(240,112,92,.92)' },
  gold: { fill: 'rgba(201,162,74,.45)', line: 'rgba(236,208,128,.95)' },
  pale: { fill: 'rgba(255,255,255,.18)', line: 'rgba(255,255,255,.7)' }
} as const

/** The camera of runtime.ts (centre straight, scale geometric), to know where a pin is on screen at the start, the middle and the end of the move. */
function cameraAt(a: MapAssets['start'], b: MapAssets['end'], pw: number, ph: number, k: number): { s: number; tx: number; ty: number } {
  const s0 = pw / a.w
  const s1 = pw / b.w
  const s = s0 * (s1 / s0) ** k
  const cx = a.x + a.w / 2 + (b.x + b.w / 2 - a.x - a.w / 2) * k
  const cy = a.y + (a.w * ph) / pw / 2 + (b.y + (b.w * ph) / pw / 2 - a.y - (a.w * ph) / pw / 2) * k
  return { s, tx: pw / 2 - cx * s, ty: ph / 2 - cy * s }
}

/** When the parts of a card with no time of their own appear: in order, from just after the title, spread over the first ~40 % of the card. */
function schedule(count: number, durationS: number): (i: number) => number {
  const first = 0.9
  const span = Math.max(0.5 * count, durationS * 0.4 - first)
  return (i) => first + (count > 1 ? (i * span) / count : 0)
}

/** The time of each part of a card: its own, or its place in the order of the parts that carry none (regions, routes, pins). */
function partTimes(p: MapCardProps, durationS: number): (kind: 'r' | 'u' | 'p', i: number, own: number | undefined) => number {
  const loose = [...p.regions.map((r, i) => ({ kind: 'r' as const, i, at: r.atS })), ...p.routes.map((r, i) => ({ kind: 'u' as const, i, at: r.atS })), ...p.pins.map((r, i) => ({ kind: 'p' as const, i, at: r.atS }))].filter((x) => x.at === undefined)
  const next = schedule(loose.length, durationS)
  return (kind, i, own) => own ?? next(loose.findIndex((x) => x.kind === kind && x.i === i))
}

/** A route's curve in world pixels (flat x, y…): the prepared one, or the straight line of older assets. */
export const routePoints = (g: MapAssets['routes'][number]): number[] => (g.pts && g.pts.length >= 4 ? g.pts : [g.x1, g.y1, g.x2, g.y2])

/** How long a route of `len` pixels on a 1080p frame draws by default: a calm pace, ≈ 2.5 s for a short hop, up to 6 s across a continent. */
export const routeSeconds = (len: number): number => Math.min(6, Math.max(2.5, 1.6 + len / 380))

/**
 * When each route starts drawing and how long it draws (seconds of the card): its line, its head and the moving map's camera all use
 * these. The time is the route's own `drawS`, else from its length on the page (a calm pace: ≈ 2.5 s for a short hop, up to 6 s across a
 * continent at any frame size).
 */
export function routeTimes(p: MapCardProps, a: MapAssets, c: { width: number; height: number; durationS: number }): { start: number; dur: number }[] {
  const timeOf = partTimes(p, Math.max(1, c.durationS))
  const k = Math.min(c.width, c.height) / 1080
  return p.routes.map((r, i) => {
    const g = a.routes[i]
    const len = g ? curveLength(routePoints(g)) / k : 0
    return { start: timeOf('u', i, r.atS) + 0.15, dur: r.drawS ?? routeSeconds(len) }
  })
}

interface Callout {
  flip: boolean
  stem: number
  w: number
  h: number
}

export function mapCard(p: MapCardProps, c: MotionCtx, cardAssets: CardAssets, look: DocStyle = DARK_STYLE): Part {
  const parch = look.kind === 'parchment'
  const a = cardAssets.map
  const k = Math.min(c.width, c.height) / 1080
  const px = (n: number): string => `${f(n * k)}px`
  const W = c.width
  const H = c.height
  const dur = Math.max(1, c.durationS)

  // ---- timing: the parts that carry no time of their own, in order (regions, routes, pins) after the title
  const timeOf = partTimes(p, dur)

  // ---- the title block, top left
  const head = `<div class="hd" data-anim="rise" data-at="0.25" data-dy="${f(10 * k)}" data-dur="0.7">
${p.kicker ? `<div class="kick">${esc(p.kicker)}</div>` : ''}<div class="ttl" data-fit="14">${esc(p.title)}</div></div>`
  const darkCss = `
body{background:#050a12}
.mbg{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,#0f2742 0%,#081525 60%,#04090f 100%)}
.world{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
.world img{position:absolute;display:block;max-width:none;filter:brightness(.8) contrast(1.08) saturate(.92)}
.world svg{position:absolute;left:0;top:0;overflow:visible}
.brd{fill:none;stroke:rgba(255,255,255,.4);stroke-linejoin:round}
.reg{stroke-linejoin:round}
.rt{fill:none;stroke-linecap:round}
.at{position:absolute;left:0;top:0;width:0;height:0;will-change:transform}
.at [data-anim]{will-change:opacity,transform}
.ct{position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;text-transform:uppercase;font-family:${SERIF};font-weight:400;letter-spacing:.3em;padding-left:.3em;text-shadow:0 1px 8px rgba(0,0,0,.75),0 0 3px rgba(0,0,0,.6)}
.nm{font-size:${px(17)};color:rgba(255,255,255,.7)}
.rl{font-size:${px(22)};color:rgba(255,255,255,.88)}
.dot{position:absolute;left:${px(-5.5)};top:${px(-5.5)};width:${px(11)};height:${px(11)};border-radius:50%;background:${DOC_PALETTE.red};box-shadow:0 0 0 ${px(2)} rgba(0,0,0,.45)}
.stem{position:absolute;bottom:0;width:${px(2)};margin-left:${px(-1)};background:rgba(240,112,92,.95);transform-origin:50% 100%}
.box{position:absolute;background:rgba(5,6,8,.9);border:1px solid rgba(255,255,255,.14);border-left:${px(3)} solid ${DOC_PALETTE.red};padding:${px(8)} ${px(14)} ${px(9)} ${px(12)}}
.box .lb{font-family:${SERIF};font-weight:400;font-size:${px(22)};line-height:${px(27)};color:#fff;white-space:nowrap}
.box .nt{margin-top:${px(2)};font-family:${SERIF};font-style:italic;font-weight:400;font-size:${px(15)};line-height:${px(20)};color:${DOC_PALETTE.muted}}
.rh{position:absolute;left:0;top:0;width:0;height:0}
.rh b{position:absolute;left:${px(-26)};top:${px(-26)};width:${px(52)};height:${px(52)};border-radius:50%;background:radial-gradient(circle,rgba(255,150,122,.75) 0%,rgba(226,74,54,.42) 32%,rgba(226,74,54,.12) 58%,rgba(226,74,54,0) 72%)}
.rh i{position:absolute;left:${px(-7)};top:${px(-7)};width:${px(14)};height:${px(14)};border-radius:50%;background:#e24a36;box-shadow:0 0 0 ${px(2.5)} rgba(255,240,232,.92),0 0 ${px(6)} rgba(0,0,0,.6)}
.vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 46%,rgba(0,0,0,0) 50%,rgba(0,0,0,.55) 100%)}
.corner{position:absolute;left:0;top:0;width:${px(1100)};height:${px(460)};background:radial-gradient(ellipse 100% 100% at 0 0,rgba(2,5,9,.74) 0%,rgba(2,5,9,.5) 40%,rgba(2,5,9,0) 100%)}
.hd{position:absolute;left:${px(60)};top:${px(46)};width:${px(820)}}
.kick{font-family:${parch ? SERIF : CONDENSED};font-weight:600;font-size:${px(16)};letter-spacing:.2em;text-transform:uppercase;color:${DOC_PALETTE.red};margin-bottom:${px(6)};text-shadow:0 1px 6px rgba(0,0,0,.6)}
.ttl{font-family:${parch ? SERIF : CONDENSED};font-weight:600;font-size:${px(30)};line-height:1.15;letter-spacing:.05em;text-transform:uppercase;color:#fff;white-space:nowrap;overflow:hidden;text-shadow:0 1px 8px rgba(0,0,0,.7)}`
  const css = parch ? darkCss + mapParchmentCss(px, look) : darkCss
  const frame = `<div class="mbg"></div>`
  if (!a) return { css, body: `${frame}${parch ? paperTexture(c) : ''}<div class="vig"></div><div class="corner"></div>${head}` }

  const cam = (pct: number) => cameraAt(a.start, a.end, W, H, pct)
  const cams = [cam(0), cam(0.5), cam(1)]
  const screenAt = (pt: { x: number; y: number }) => cams.map((m) => ({ x: m.tx + pt.x * m.s, y: m.ty + pt.y * m.s }))

  // ---- the world layer: picture, countries shaded, borders, routes
  const rect = a.imageRect ?? a.start
  const picture = a.image ? `<img src="${a.image}" alt="" style="left:${f(rect.x)}px;top:${f(rect.y)}px;width:${f(rect.w)}px;height:${f(rect.h)}px">` : ''
  const detail = a.detail ? `<img src="${a.detail.image}" alt="" data-anim="fade" data-at="${f(dur * 0.5)}" data-dur="${f(dur * 0.35)}" data-ease="linear" style="left:${f(a.detail.x)}px;top:${f(a.detail.y)}px;width:${f(a.detail.w)}px;height:${f(a.detail.h)}px">` : ''
  const regions = p.regions
    .map((r, i) => {
      if (parch) return parchRegion(i, a.regions[i] ?? '', parchTones(look.accent)[r.tone], timeOf('r', i, r.atS))
      const tone = TONES[r.tone]
      return `<g data-anim="fade" data-at="${f(timeOf('r', i, r.atS))}" data-dur="0.9"><path class="reg" data-sw="1.7" d="${a.regions[i] ?? ''}" style="fill:${tone.fill};stroke:${tone.line}"/></g>`
    })
    .join('\n')
  // routes: the curve drawn on from its start (the same points, length and ease as its head, so the head rides the drawn end)
  const times = routeTimes(p, a, c)
  const curves = p.routes.map((_, i) => routePoints(a.routes[i] as MapAssets['routes'][number]))
  const routes = p.routes
    .map((_, i) => {
      const { start, dur: d } = times[i] as { start: number; dur: number }
      const pts = curves[i] as number[]
      let line = ''
      for (let j = 0; j + 1 < pts.length; j += 2) line += `${j ? 'L' : 'M'}${(pts[j] as number).toFixed(1)} ${(pts[j + 1] as number).toFixed(1)}`
      if (parch) return parchRoute(i, line, start, d, { w: W, h: H })
      const draw = `pathLength="1" data-draw data-at="${f(start)}" data-dur="${f(d)}" data-ease="sine"`
      return `<path class="rt" ${draw} data-sw="7" style="stroke:rgba(0,0,0,.32);stroke-dasharray:1 1" d="${line}"/>
<path class="rt" ${draw} data-sw="3" style="stroke:#e24a36;stroke-dasharray:1 1" d="${line}"/>`
    })
    .join('\n')
  const world = `<div class="world" data-cl>
${picture}${detail}${parch ? parchWash(rect) : ''}
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path class="brd" data-sw="0.9" d="${a.borders}"/>
${regions}
${routes}</svg></div>`

  // ---- texts and pins riding their world points
  const rider = (pt: { x: number; y: number }, inner: string, extra = ''): string => `<div class="at" data-cp="${f(pt.x)} ${f(pt.y)}"${extra}>${inner}</div>`
  const spaced = p.names.map((n, i) => rider(a.names[i] as { x: number; y: number }, `<div data-anim="fade" data-at="${f(n.atS ?? 0.7 + i * 0.12)}" data-dur="${n.atS === undefined ? 1 : 0.5}"><div class="ct nm">${esc(n.text)}</div></div>`)).join('\n')
  const labels = p.regions
    .map((r, i) => (r.label && a.labels?.[i] ? rider(a.labels[i] as { x: number; y: number }, `<div data-anim="fade" data-at="${f(timeOf('r', i, r.atS) + 0.5)}" data-dur="0.9"><div class="ct rl">${esc(r.label)}</div></div>`) : ''))
    .join('\n')

  const placed: { x: number; y: number; w: number; h: number }[][] = [[], [], []]
  const callout = (label: string, note: string | undefined, at: { x: number; y: number }, base: number): Callout => {
    const w = Math.max(label.length * 11.8 + 30, note ? Math.min(330, note.length * 7.4 + 30) : 0) * k
    const h = (8 + 27 + (note ? 2 + 20 * Math.min(2, Math.ceil((note.length * 7.4) / 300)) : 0) + 9) * k
    const scr = screenAt(at)
    const flip = (scr[0] as { x: number }).x > W * 0.68 || (scr[2] as { x: number }).x > W * 0.68
    let stem = base * k
    for (let level = 0; level < 4; level++) {
      stem = (base + level * (h / k + 14)) * k
      const clash = scr.some((s, m) => {
        const r = { x: flip ? s.x - w : s.x, y: s.y - stem - h, w, h }
        return (placed[m] as typeof placed[0]).some((o) => r.x < o.x + o.w + 8 && r.x + r.w + 8 > o.x && r.y < o.y + o.h + 8 && r.y + r.h + 8 > o.y)
      })
      if (!clash) break
    }
    scr.forEach((s, m) => (placed[m] as typeof placed[0]).push({ x: flip ? s.x - w : s.x, y: s.y - stem - h, w, h }))
    return { flip, stem, w, h }
  }
  const pins = p.pins
    .map((pin, i) => {
      const at = a.pins[i] as { x: number; y: number }
      const t0 = timeOf('p', i, pin.atS)
      const co = callout(pin.label, pin.note, at, 52)
      const side = co.flip ? `right:0` : `left:0`
      return rider(
        at,
        `<div data-anim="pop" data-at="${f(t0)}" data-dur="0.4"><div class="dot"></div></div>
<div class="stem" data-anim="growy" data-at="${f(t0 + 0.15)}" data-dur="0.35" style="height:${f(co.stem)}px"></div>
<div class="box" data-anim="rise" data-at="${f(t0 + 0.4)}" data-dur="0.5" data-dy="${f(8 * k)}" style="${side};bottom:${f(co.stem)}px;${co.flip ? (parch ? `border-left:1px solid #2b2118;border-right:${px(3)} solid ${look.accent};` : `border-left:1px solid rgba(255,255,255,.14);border-right:${px(3)} solid ${DOC_PALETTE.red};`) : ''}"><div class="lb">${esc(pin.label)}</div>${pin.note ? `<div class="nt" style="width:${f(Math.min(330, pin.note.length * 7.4 + 6) * k)}px;max-width:${px(300)}">${esc(pin.note)}</div>` : ''}</div>`
      )
    })
    .join('\n')

  // routes: the start dot, the head riding the drawn end (a dot in a soft halo that fades when it arrives: the dot stays as the end), the
  // label at the middle of the way when it has arrived
  const tips = p.routes
    .map((r, i) => {
      const { start: t, dur: d } = times[i] as { start: number; dur: number }
      const pts = curves[i] as number[]
      const from = { x: pts[0] as number, y: pts[1] as number }
      const begin = rider(from, `<div data-anim="pop" data-at="${f(t - 0.15)}" data-dur="0.35"><div class="dot"${parch ? '' : ' style="background:#e24a36"'}></div></div>`)
      const path = pts.map((v) => v.toFixed(1)).join(' ')
      const head = rider(from, `<div class="rh"><b data-anim="fade" data-at="${f(t)}" data-dur="0.3" data-out="${f(t + d)}" data-out-dur="0.9" data-dy="0"></b><i></i></div>`, ` data-cpath="${path}" data-at="${f(t)}" data-dur="${f(d)}" data-ease="sine"`)
      const mid = pointAlong(pts, 0.5)
      const label = r.label
        ? rider(mid, `<div data-anim="fade" data-at="${f(t + d)}" data-dur="0.6"><div class="box" style="left:${px(10)};top:${px(8)};border-left-width:${px(3)}"><div class="lb" style="font-size:${px(18)};line-height:${px(22)}">${esc(r.label)}</div></div></div>`)
        : ''
      return `${begin}\n${head}\n${label}`
    })
    .join('\n')

  const body = `${frame}
<div data-cam="${[a.start.x, a.start.y, a.start.w, a.end.x, a.end.y, a.end.w].map(f).join(' ')}" data-pw="${W}" data-ph="${H}" data-at="0" data-dur="${f(dur)}" data-ease="sine"></div>
${parch ? `<div class="pclip">${world}</div>${paperTexture(c)}${PLATE}` : world}
${spaced}
${labels}
${tips}
${pins}
<div class="vig"></div>
<div class="corner"></div>
${head}`
  return { css, body }
}
