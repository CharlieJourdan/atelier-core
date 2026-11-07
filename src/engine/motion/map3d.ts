// The 3D map card (formats/map3d.ts): a full-frame, opaque map drawn by MapLibre GL JS (BSD-3-Clause, inlined) on a tilted, lit terrain,
// with the look measured on the reference (research note maps-reference-2026-11 (old repository)): a dark Blue Marble with its relief, thin white borders,
// regions whose outline comes first and fill after, red routes drawn on the ground with a travelling head, red pins whose dark tag is wiped
// open, spaced italic names, fact boxes at the lower right, a hazy horizon, a heavy vignette and a red-kicker title at the top left. The
// HTML and CSS are here; the script that draws frame t is motion/map3d-runtime.ts; the data comes from motion/map3d-data.ts.
import { FPS } from '../formats/timing'
import type { Map3dAssets, Map3dProps } from '../formats/map3d'
import { esc, type MotionCtx } from './base'
import type { Part } from './cards'
import { MAP3D_JS } from './map3d-runtime'
import { drawSeconds, lineKm, timesOf } from './map3d-plan'

const f = (n: number): string => n.toFixed(2)
/** A JSON text safe inside a <script> element (no `</script>`, no `<!--`). */
const BS = String.fromCharCode(92)
export const scriptJson = (v: unknown): string => JSON.stringify(v).replace(/</g, `${BS}u003c`).replace(/[\u2028\u2029]/g, (ch) => `${BS}u${ch.charCodeAt(0).toString(16)}`)

/** The two looks: the paint values the page's style reads (measured on the reference frames for `satellite`). */
export const MAP3D_LOOK = {
  satellite: {
    sea: '#071426',
    bright: 0.8,
    dark: 0.0,
    sat: -0.12,
    contrast: 0.04,
    land: '#000000',
    shadow: 'rgba(0,0,8,0.55)',
    highlight: 'rgba(255,250,235,0.10)',
    shade: 0.45,
    border: '#ffffff',
    borderOpacity: 0.42,
    borderWidth: 0.9,
    regionLine: 1.6,
    route: '#e8392a',
    routeWidth: 2.6,
    fog: true,
    skyColor: '#3a4652',
    horizon: '#6a7682',
    fogColor: '#5f6b77',
    fogGround: 0.6,
    clouds: 0.5,
    text: 'rgba(255,255,255,.78)',
    paper: false
  },
  parchment: {
    sea: '#c8b78f',
    bright: 1,
    dark: 0,
    sat: 0,
    contrast: 0,
    land: '#e6d6b0',
    shadow: 'rgba(80,52,20,0.55)',
    highlight: 'rgba(255,248,225,0.35)',
    shade: 0.5,
    border: '#5a4128',
    borderOpacity: 0.7,
    borderWidth: 1,
    regionLine: 1.8,
    route: '#9c2a1c',
    routeWidth: 2.8,
    fog: true,
    skyColor: '#d9c8a2',
    horizon: '#e4d6b4',
    fogColor: '#d8c7a0',
    fogGround: 0.5,
    clouds: 0,
    text: 'rgba(43,30,18,.85)',
    paper: true
  }
} as const

/** The tones of a region (fill and its alpha, the outline, the side of a raised country), measured on the reference's red and gold. */
export const MAP3D_TONES = {
  red: { fill: '#6c1609', alpha: 0.5, line: '#e0402c', side: '#8f2618' },
  gold: { fill: '#8f8234', alpha: 0.5, line: '#ecd487', side: '#a88533' },
  pale: { fill: '#ffffff', alpha: 0.18, line: '#ffffff', side: '#c9c9c9' }
} as const

export function map3dCard(p: Map3dProps, c: MotionCtx, a: Map3dAssets | undefined, accent = '#d5412f'): Part {
  const W = c.width
  const H = c.height
  const k = Math.min(W, H) / 1080
  const px = (n: number): string => `${f(n * k)}px`
  const look = MAP3D_LOOK[p.look]
  const red = p.look === 'satellite' ? '#d5412f' : accent
  const serif = `'Source Serif 4','Georgia',serif`
  const sans = `'Barlow','Oswald','Arial Narrow',sans-serif`
  const css = `
${a?.fontCss ?? ''}
body{background:${look.sea}}
#map{position:absolute;left:0;top:0;width:${W}px;height:${H}px}
#ov{position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none}
.vig{position:absolute;inset:0;background:radial-gradient(ellipse 72% 72% at 44% 40%,rgba(0,0,0,0) 42%,rgba(0,0,0,${look.paper ? '.28' : '.78'}) 100%)}
.corner{position:absolute;left:0;top:0;width:${px(1150)};height:${px(420)};background:radial-gradient(ellipse 100% 100% at 0 0,rgba(0,0,0,${look.paper ? '.10' : '.28'}) 0%,rgba(0,0,0,0) 100%)}
.hd{position:absolute;left:${px(75)};top:${px(76)};width:${px(900)}}
.kick{font-family:${sans};font-weight:600;font-size:${px(17)};letter-spacing:.24em;text-transform:uppercase;color:${red};margin-bottom:${px(9)}}
.ttl{font-family:${sans};font-weight:600;font-size:${px(31)};line-height:1.1;letter-spacing:.055em;color:${look.paper ? '#2b1e12' : '#f4f2ee'};white-space:nowrap;text-shadow:0 1px 6px rgba(0,0,0,${look.paper ? '0' : '.55'})}
.ll{position:absolute;left:0;top:0;width:0;height:0;opacity:0;will-change:transform,opacity}
.nm{position:absolute;white-space:nowrap;font-family:${look.paper ? serif : sans};font-style:italic;font-weight:500;font-size:${px(17)};letter-spacing:.38em;padding-left:.38em;text-transform:uppercase;color:${look.text};text-shadow:0 1px 4px rgba(0,0,0,${look.paper ? '0' : '.6'})}
.nm.big{font-size:${px(19)}}
.pin .dt{position:absolute;left:${px(-6)};top:${px(-6)};width:${px(12)};height:${px(12)};border-radius:50%;background:#ff5a45;box-shadow:0 0 ${px(6)} ${px(2)} rgba(255,70,50,.75),0 0 0 ${px(1.5)} rgba(255,255,255,.55) inset}
.pin .ld{position:absolute;top:${px(-0.75)};height:${px(1.5)};width:${px(18)};background:rgba(235,235,235,.75);transform-origin:0 50%}
.pin.side-r .ld{left:0}
.pin.side-l .ld{left:${px(-18)};transform-origin:100% 50%}
.pin.side-u .ld,.pin.side-d .ld{display:none}
.tg{position:absolute;white-space:nowrap;background:rgba(14,15,17,.86);border-left:${px(3)} solid ${red};padding:${px(5)} ${px(11)} ${px(4)} ${px(10)};font-family:${sans};font-weight:600;font-size:${px(17)};letter-spacing:.09em;text-transform:uppercase;color:#f1efe9}
.pin.side-l .tg{border-left:0;border-right:${px(3)} solid ${red}}
.tg .nt{display:block;margin-top:${px(2)};font-family:${serif};font-style:italic;font-weight:400;font-size:${px(15)};letter-spacing:0;text-transform:none;color:#b9b4ab}
.hdx{position:absolute;left:0;top:0;width:0;height:0;opacity:0}
.hdx i{position:absolute;left:${px(-13)};top:${px(-7)};width:0;height:0;border-style:solid;border-width:${px(7)} 0 ${px(7)} ${px(15)};border-color:transparent transparent transparent ${look.route};filter:drop-shadow(0 0 ${px(4)} rgba(255,60,40,.8))}
.facts{position:absolute;right:${px(150)};bottom:${px(205)};display:flex;flex-direction:column;align-items:flex-start;gap:${px(12)}}
.fact{background:rgba(10,10,10,.74);padding:${px(6)} ${px(16)} ${px(5)};font-family:${serif};font-weight:400;font-size:${px(40)};letter-spacing:.01em;text-transform:uppercase;color:#f3f1ec;white-space:nowrap}
#m3s{display:none}`
  const head = `<div class="hd" data-keep data-anim="fade" data-at="0.1" data-dur="0.4">${p.kicker ? `<div class="kick">${esc(p.kicker)}</div>` : ''}<div class="ttl">${esc(p.title)}</div></div>`
  if (!a) return { css, body: `<div class="vig"></div><div class="corner"></div>${head}` }

  const times = timesOf(p, c.durationS)
  const draw = p.routes.map((r, i) => drawSeconds(r, lineKm(a.routes[i] ?? [])))
  const ll = (lon: number, lat: number): string => `${lon.toFixed(5)},${lat.toFixed(5)}`
  // the labels that ride the map, in order of importance (pins, region labels, names)
  const pins = p.pins
    .map((pin, i) => `<div class="ll pin" data-kind="pin" data-pri="${i}" data-at="${f(times.pins[i] ?? 0)}" data-ll="${ll(pin.lon, pin.lat)}"><div class="ld"></div><div class="dt"></div><div class="tg">${esc(pin.label)}${pin.note ? `<span class="nt">${esc(pin.note)}</span>` : ''}</div></div>`)
    .join('\n')
  const regionLabels = p.regions
    .map((r, i) => {
      const at = a.labels[i]
      if (!r.label || !at) return ''
      // the region's box: a label wider than its region on screen goes under it (the reference's « SWITZERLAND »)
      const pts = (a.regions[i] ?? []).flat(2)
      const bb = [Math.min(...pts.map((q) => q[0] as number)), Math.min(...pts.map((q) => q[1] as number)), Math.max(...pts.map((q) => q[0] as number)), Math.max(...pts.map((q) => q[1] as number))]
      return `<div class="ll" data-kind="label" data-pri="${100 + i}" data-at="${f((times.regions[i] ?? 0) + 0.5)}" data-ll="${ll(at[0], at[1])}" data-bb="${bb.map((v) => v.toFixed(3)).join(',')}"><div class="nm big">${esc(r.label)}</div></div>`
    })
    .join('\n')
  const names = p.names.map((n, i) => `<div class="ll" data-kind="name" data-pri="${200 + i}" data-at="${f(times.names[i] ?? 0)}" data-ll="${ll(n.lon, n.lat)}"><div class="nm">${esc(n.text)}</div></div>`).join('\n')
  const heads = p.routes.map((_, i) => `<div class="hdx" data-head="${i}"><i></i></div>`).join('')
  const facts = p.facts.length
    ? `<div class="facts" data-keep>${p.facts.map((x, i) => `<div class="fact" data-anim="fade" data-at="${f(times.facts[i] ?? 0)}" data-dur="0.35">${esc(x.text)}</div>`).join('')}</div>`
    : ''
  const data = {
    fps: FPS,
    width: W,
    height: H,
    look,
    tones: MAP3D_TONES,
    exaggeration: p.exaggeration,
    terrainOnSoftware: a.terrainOnSoftware === true,
    maxzoom: a.maxzoom,
    tiles: a.tiles,
    borders: a.borders,
    shapes: a.regions,
    land: a.land ?? null,
    regions: p.regions.map((r) => ({ tone: r.tone, raise: r.raise })),
    routes: a.routes,
    frames: a.frames,
    box: a.box,
    times: { regions: times.regions, routes: times.routes, draw }
  }
  const body = `<div id="map"></div>
<div id="ov"><div class="vig"></div><div class="corner"></div>
${regionLabels}
${names}
${heads}
${pins}
${facts}
${head}
<div id="m3s" style="--m3d:0"></div></div>
<script type="application/json" id="m3d">${scriptJson(data)}</script>
<script>var ML_MAIN = ${scriptJson(a.lib.main)};
var ML_WORKER = ${scriptJson(a.lib.worker)};</script>
<script>${MAP3D_JS}</script>`
  return { css, body }
}
