// The chart card (formats/cards.ts `chart`, motion-montage): animated data in the look of the bars card (kicker, title, SOURCE line, the dark
// warped grid or the parchment). A line (or an area) that draws itself left to right with a value riding its head, a donut whose slices sweep
// on their words, or one to four big counters side by side. Every time is in the spec (`atS`); nothing is guessed from the data.
import { DOC_PALETTE, type ChartCardProps } from '../formats/cards'
import { esc, isPortrait, pick, typo, type MotionCtx } from './base'
import type { Part } from './cards'
import { FONT, f2 } from './doc-common'
import { header } from './doc-data'
import { DARK_STYLE, PARCH, parchmentHeader, type DocStyle } from './doc-parchment'
import { facesOf, lookTexture, rgba, vignetteOf, type PaperLook } from './look'

// ---- numbers -----------------------------------------------------------------------------------------------------------------------------

/** A number written in French (12 000, 3,5). */
export const fmt = (v: number, dec: number): string => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v).replace(/[\u202f\u00a0]/g, '\u00a0')
const decimalsOf = (v: number): number => Math.min(3, (String(Math.abs(v)).split('.')[1] ?? '').length)
/** A unit goes before the number when it is a currency sign of the Anglo world ($, £, ¥, ₹), after it (a thin gap) otherwise. */
export const unitBefore = (unit: string | undefined): boolean => !!unit && /^[$£¥₹]$/.test(unit)
/** A value as the tag and the ticks write it: the unit on its side of the number. */
export const withUnit = (num: string, unit: string | undefined): string => (!unit ? num : unitBefore(unit) ? `${unit}${num}` : `${num}\u00a0${unit}`)

/** The axis of a line chart: a round step, the range widened to it (an area starts at zero, a line too unless its values are close together), a headroom for the tag. */
export function niceScale(min: number, max: number, zeroBase: boolean, want = 4): { lo: number; hi: number; step: number; ticks: number[] } {
  let lo = zeroBase ? Math.min(0, min) : min
  let hi = max
  if (hi - lo < 1e-9) hi = lo + 1
  const raw = (hi - lo) / want
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  lo = Math.floor(lo / step + 1e-9) * step
  hi = Math.ceil(hi / step - 1e-9) * step
  if (hi - max < 0.14 * (hi - lo)) hi += step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e9) / 1e9)
  return { lo, hi, step, ticks }
}

// ---- the look ------------------------------------------------------------------------------------------------------------------------------

interface Ink {
  /** The line, the text, the muted text, the hairlines and the fills (base part, accent part). */
  line: string
  text: string
  muted: string
  grid: string
  axis: string
  fillBase: string
  fillAccent: string
  accent: string
  /** The face of the numbers and the face of the labels. */
  numFace: string
  labFace: string
  numWeight: number
  /** The tag's background and text. */
  tagBg: string
  tagText: string
  /** A paper look (look.ts): the chart is engraved, ink lines and hatched fills on the look's paper. */
  engraved?: PaperLook
}
function inkOf(look: DocStyle): Ink {
  if (look.kind === 'parchment') {
    return { line: PARCH.ink, text: PARCH.ink, muted: PARCH.muted, grid: 'rgba(43,33,24,.2)', axis: 'rgba(43,33,24,.6)', fillBase: '#d8c59c', fillAccent: '#d9b497', accent: look.accent, numFace: FONT.serif, labFace: FONT.serif, numWeight: 600, tagBg: look.accent, tagText: PARCH.tag }
  }
  return { line: '#ece7dc', text: '#fff', muted: '#a7a198', grid: 'rgba(255,255,255,.1)', axis: 'rgba(255,255,255,.4)', fillBase: '#2d2926', fillAccent: '#3f2420', accent: DOC_PALETTE.red, numFace: FONT.cond, labFace: FONT.sans, numWeight: 600, tagBg: DOC_PALETTE.red, tagText: '#fff' }
}

/** The ink of a paper look: everything in its ink, the area hatched (`#lhb`, `#lha`), the numbers in its display face. */
function inkOfPaper(l: PaperLook): Ink {
  const f = facesOf(l)
  return { line: l.ink, text: l.ink, muted: l.muted, grid: rgba(l.ink, 0.3), axis: l.ink, fillBase: 'url(#lhb)', fillAccent: 'url(#lha)', accent: l.accent, numFace: f.display, labFace: f.text, numWeight: f.weight, tagBg: l.tag, tagText: l.ink, engraved: l }
}
/** Diagonal hatching in the ink (and denser in the accent) as SVG patterns, for the engraved area. */
const hatchDefs = (l: PaperLook): string =>
  `<defs><pattern id="lhb" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="${rgba(l.ink, 0.05)}"/><line x1="0" y1="0" x2="0" y2="9" stroke="${l.ink}" stroke-width="1.7" stroke-opacity=".75"/></pattern><pattern id="lha" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${rgba(l.accent, 0.1)}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${l.accent}" stroke-width="1.8"/></pattern></defs>`

/** The paper look's sheet and head over the parchment header: its paper and inks, its title face, its texture (the parchment's is the `paper` one). */
function paperHeadCss(l: PaperLook, c: MotionCtx): string {
  const f = facesOf(l)
  return `
.pbg{background:linear-gradient(165deg,${l.paper} 0%,${l.paperDeep} 100%)}
.doc{background:${l.paper};color:${l.ink}}
.doc .kick{color:${l.accent}}
.doc .ttl{color:${l.ink};font-family:${f.display};font-weight:${f.weight};font-size:${pick(c, 70, 72)}px;line-height:1.1;letter-spacing:.005em}
.doc .srcl{color:${l.muted}}
.pvig{background:${vignetteOf(l)}}
.cgr{position:absolute;left:0;top:0;width:100%;height:100%;mix-blend-mode:multiply;pointer-events:none}${l.texture === 'paper' ? '' : '\n.ptex{display:none}'}${
    // a print's plate mark: a thin double ink rule around the sheet
    l.preset === 'period' ? `\n.doc::after{content:"";position:absolute;inset:${pick(c, 40, 30)}px;pointer-events:none;border:1.5px solid ${rgba(l.ink, 0.8)};outline:1px solid ${rgba(l.ink, 0.5)};outline-offset:6px}` : ''
  }`
}

// ---- line and area ------------------------------------------------------------------------------------------------------------------------

function lineChart(p: ChartCardProps, c: MotionCtx, ink: Ink, area: boolean): { css: string; body: string } {
  const pts = p.points as NonNullable<ChartCardProps['points']>
  const n = pts.length
  const m = pick(c, 120, 64)
  const values = pts.map((q) => q.value)
  const lo0 = Math.min(...values)
  const hi0 = Math.max(...values)
  const sc = niceScale(lo0, hi0, area || (lo0 >= 0 && lo0 < 0.6 * hi0))
  const L = m + pick(c, 120, 96)
  const R = c.width - m - pick(c, 40, 20)
  const T = Math.round(c.height * pick(c, 0.36, 0.38))
  const B = Math.round(c.height * pick(c, 0.84, 0.82))
  const xs = pts.map((_, i) => L + ((R - L) * i) / (n - 1))
  const ys = pts.map((q) => B - ((q.value - sc.lo) / (sc.hi - sc.lo)) * (B - T))
  const at = p.atS ?? 1
  const draw = p.drawS
  // arc-length times: the head crosses each point at at + draw * (length so far / total length)
  const seg = pts.slice(1).map((_, i) => Math.hypot((xs[i + 1] as number) - (xs[i] as number), (ys[i + 1] as number) - (ys[i] as number)))
  const total = seg.reduce((a, b) => a + b, 0)
  const cum = [0]
  seg.forEach((s, i) => cum.push((cum[i] as number) + s))
  const tAt = (i: number): number => at + (draw * (cum[i] as number)) / total
  const a = p.accentFrom
  const pathOf = (from: number, to: number): string => pts.slice(from, to + 1).map((_, k) => `${k ? 'L' : 'M'}${(xs[from + k] as number).toFixed(1)} ${(ys[from + k] as number).toFixed(1)}`).join(' ')
  const sw = ink.engraved ? pick(c, 4, 5) : pick(c, 7, 8)
  const lineCss = (col: string): string => `fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" pathLength="1" style="stroke-dasharray:1 1"`
  const parts: string[] = []
  if (a === undefined) parts.push(`<path ${lineCss(ink.line)} data-draw data-at="${f2(at)}" data-dur="${f2(draw)}" data-ease="linear" d="${pathOf(0, n - 1)}"/>`)
  else {
    const cut = Math.min(a, n - 1)
    if (cut > 0) parts.push(`<path ${lineCss(ink.line)} data-draw data-at="${f2(at)}" data-dur="${f2(tAt(cut) - at)}" data-ease="linear" d="${pathOf(0, cut)}"/>`)
    if (cut < n - 1) parts.push(`<path ${lineCss(ink.accent)} data-draw data-at="${f2(tAt(cut))}" data-dur="${f2(at + draw - tAt(cut))}" data-ease="linear" d="${pathOf(cut, n - 1)}"/>`)
  }
  // the area: one opaque trapezoid per segment, wiped in exactly while the head crosses it
  const fills = area
    ? seg
        .map((_, i) => {
          const x0 = xs[i] as number
          const x1 = (xs[i + 1] as number) + (i < seg.length - 1 ? 0.8 : 0)
          return `<path d="M${x0.toFixed(1)} ${B} L${x0.toFixed(1)} ${(ys[i] as number).toFixed(1)} L${x1.toFixed(1)} ${(ys[i + 1] as number).toFixed(1)} L${x1.toFixed(1)} ${B}Z" fill="${a !== undefined && i >= a ? ink.fillAccent : ink.fillBase}" data-anim="wipe" data-at="${f2(tAt(i))}" data-dur="${f2(tAt(i + 1) - tAt(i))}" data-ease="linear"/>`
        })
        .join('')
    : ''
  const en = ink.engraved
  // an engraved dot is an open ring of ink on the paper
  const dotPaint = (hot: boolean): string =>
    en ? `r="${pick(c, 7, 8)}" fill="${en.paper}" stroke="${hot ? ink.accent : ink.line}" stroke-width="3"` : `r="${pick(c, 8, 9)}" fill="${hot ? ink.accent : ink.line}" stroke="${ink.tagText === '#fff' ? '#1a1715' : PARCH.paper}" stroke-width="3"`
  const dots =
    n <= 14
      ? pts.map((_, i) => `<circle cx="${(xs[i] as number).toFixed(1)}" cy="${(ys[i] as number).toFixed(1)}" ${dotPaint(a !== undefined && i >= a)} data-anim="pop" data-at="${f2(tAt(i))}" data-dur="0.3" style="transform-box:fill-box;transform-origin:center"/>`).join('')
      : ''
  const grid = sc.ticks.map((v) => {
    const y = B - ((v - sc.lo) / (sc.hi - sc.lo)) * (B - T)
    return `<line x1="${L}" x2="${R + 10}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${v === sc.lo ? ink.axis : ink.grid}" stroke-width="${v === sc.lo ? 2.5 : 1.6}"${en && v !== sc.lo ? ' stroke-dasharray="2 7"' : ''}/>`
  })
  const tickDec = sc.step < 1 ? Math.min(2, Math.ceil(-Math.log10(sc.step) - 1e-9)) : 0
  const yLabels = sc.ticks
    .map((v) => {
      const y = B - ((v - sc.lo) / (sc.hi - sc.lo)) * (B - T)
      return `<div class="yl" style="right:${c.width - L + 16}px;top:${(y - 20).toFixed(1)}px" data-anim="fade" data-at="0.5" data-dur="0.4">${esc(withUnit(fmt(v, tickDec), p.unit))}</div>`
    })
    .join('\n')
  // the x ticks: every point if they fit, else every k-th; each fades in as the head passes it
  const fontPx = pick(c, 24, 24)
  const widest = Math.max(...pts.map((q) => q.label.length)) * fontPx * 0.58 + 16
  const stride = Math.max(1, Math.ceil(widest / ((R - L) / (n - 1))))
  const shown = pts.map((_, i) => i % stride === 0 || (i === n - 1 && (n - 1) % stride >= stride / 2))
  const xLabels = pts
    .map((q, i) => (shown[i] ? `<div class="xl" style="left:${((xs[i] as number) - 90).toFixed(1)}px;top:${B + 16}px" data-anim="fade" data-at="${f2(tAt(i) - 0.1)}" data-dur="0.35">${esc(typo(q.label))}</div>` : ''))
    .join('\n')
  // the tag riding the head, counting the value under it; the last value stays, big, when the line is done
  const dec = Math.max(...values.map(decimalsOf), 0)
  const last = pts[n - 1] as (typeof pts)[number]
  const trace = pts.map((_, i) => `${(xs[i] as number).toFixed(1)},${(ys[i] as number).toFixed(1)}`).join(',')
  const tag = `<div class="tag" data-trace="${trace}" data-trace-vals="${values.join(',')}" data-dec="${dec}" data-at="${f2(at)}" data-dur="${f2(draw)}" data-ease="linear"><div class="tbub">${p.unit && unitBefore(p.unit) ? `<span class="tu">${esc(p.unit)}</span>` : ''}<span data-trace-val data-text></span>${p.unit && !unitBefore(p.unit) ? `<span class="tu">&nbsp;${esc(p.unit)}</span>` : ''}</div></div>`
  const endAt = at + draw
  const bigText = last.display ?? withUnit(fmt(last.value, dec), p.unit)
  const big = `<div class="big" data-fit="40" data-anim="pop" data-at="${f2(endAt + 0.1)}" data-dur="0.5">${esc(typo(bigText))}</div><div class="bigl" data-fit="14" data-anim="rise" data-at="${f2(endAt + 0.3)}" data-dur="0.4" data-dy="10">${esc(typo(last.label))}</div>`
    return {
    css: `
.gl,.pl{position:absolute;left:0;top:0}
.yl{position:absolute;height:40px;line-height:40px;font-family:${ink.labFace};font-weight:600;font-size:${pick(c, 24, 24)}px;letter-spacing:.04em;color:${ink.muted};white-space:nowrap;text-align:right;font-variant-numeric:lining-nums tabular-nums}
.xl{position:absolute;width:180px;text-align:center;font-family:${ink.labFace};font-weight:600;font-size:${fontPx}px;letter-spacing:.08em;text-transform:uppercase;color:${ink.muted};white-space:nowrap}
.tag{position:absolute;left:0;top:0;opacity:0}
.tbub{position:absolute;left:0;top:0;transform:translate(-50%,-138%);background:${ink.tagBg};color:${ink.tagText};border-radius:${pick(c, 14, 14)}px;padding:${pick(c, 8, 8)}px ${pick(c, 22, 20)}px ${pick(c, 10, 10)}px;font-family:${ink.numFace};font-weight:${ink.numWeight};font-size:${pick(c, 44, 46)}px;line-height:1.1;letter-spacing:.02em;white-space:nowrap;font-variant-numeric:lining-nums tabular-nums;box-shadow:0 8px 22px rgba(0,0,0,.35)}
.tbub::after{content:"";position:absolute;left:50%;bottom:-9px;width:18px;height:18px;margin-left:-9px;background:${ink.tagBg};transform:rotate(45deg);border-radius:3px}
.tu{font-size:.62em;opacity:.9}
.big{position:absolute;right:${m}px;top:${pick(c, 200, 270)}px;max-width:${pick(c, 760, c.width - 2 * m)}px;font-family:${ink.numFace};font-weight:${ink.numWeight};font-size:${pick(c, 120, 128)}px;line-height:1.05;letter-spacing:.01em;color:${ink.accent};white-space:nowrap;overflow:hidden;text-align:right;padding:0 4px 8px;font-variant-numeric:lining-nums tabular-nums}
.bigl{position:absolute;right:${m}px;top:${pick(c, 200, 270) + pick(c, 126, 138)}px;font-family:${ink.labFace};font-weight:600;font-size:${pick(c, 24, 25)}px;letter-spacing:.2em;text-transform:uppercase;color:${ink.muted};white-space:nowrap;overflow:hidden;max-width:${pick(c, 700, c.width - 2 * m)}px;text-align:right}${en ? engravedLineCss(en, ink, c) : ''}`,
    body: `<svg class="gl" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}" data-anim="fade" data-at="0.35" data-dur="0.5">${grid.join('')}</svg>
<svg class="pl" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}" style="overflow:visible">${en ? hatchDefs(en) : ''}${fills}${parts.join('')}${dots}</svg>
${yLabels}\n${xLabels}\n${tag}\n${big}`
  }
}

/** The engraved line chart's tag (an ink-framed paper label on a hairline), labels and big value. */
function engravedLineCss(l: PaperLook, ink: Ink, c: MotionCtx): string {
  return `
.yl,.xl{font-weight:400}
.xl{letter-spacing:.12em}
.tbub{background:${l.tag};color:${l.ink};border:1.5px solid ${l.ink};outline:1px solid ${rgba(l.ink, 0.5)};outline-offset:3px;border-radius:0;box-shadow:0 6px 14px rgba(40,24,6,.2);padding:${pick(c, 4, 4)}px ${pick(c, 20, 18)}px ${pick(c, 8, 8)}px;font-size:${pick(c, 50, 52)}px}
.tbub::after{bottom:-25px;width:1.5px;height:22px;margin-left:-.75px;background:${l.ink};transform:none;border-radius:0}
.big{font-size:${pick(c, 136, 140)}px}
.bigl{font-weight:400;font-style:italic;text-transform:none;letter-spacing:.03em;font-size:${pick(c, 32, 32)}px;color:${ink.muted}}`
}

// ---- donut -----------------------------------------------------------------------------------------------------------------------------------

function donutChart(p: ChartCardProps, c: MotionCtx, ink: Ink, look: DocStyle): { css: string; body: string } {
  const slices = p.slices as NonNullable<ChartCardProps['slices']>
  const portrait = isPortrait(c)
  const m = pick(c, 120, 64)
  const total = slices.reduce((a, s) => a + s.value, 0)
  const pct = slices.map((s) => (s.value / total) * 100)
  const dec = pct.every((v) => Math.abs(v - Math.round(v)) < 0.05) ? 0 : 1
  const R = portrait ? 330 : Math.min(Math.round(c.height * 0.3), 320)
  const th = Math.round(R * 0.26)
  const rm = R - th / 2
  const cx = portrait ? c.width / 2 : m + R + 50
  const cy = portrait ? Math.round(c.height * 0.4) : Math.round(c.height * 0.62)
  const times = slices.map((s, i) => s.atS ?? 0.9 + (i * Math.max(0.5, (c.durationS * 0.6 - 0.9))) / Math.max(1, slices.length - 1))
  // greys from light to dark for the slices that are not the story; the story's slice in the accent
  const greys = look.kind === 'parchment' ? ['#2b2118', '#5c4b38', '#8a7556', '#b3a07c', '#cdbd9a', '#dccfb2'] : ['#ece7dc', '#bdb7ab', '#948e83', '#756f66', '#5e5851', '#4b4641']
  let g = 0
  const colours = slices.map((s) => (s.accent ? ink.accent : (greys[g++] as string)))
  const gap = 0.028
  let a0 = -Math.PI / 2
  const arcs = slices.map((s, i) => {
    const span = (s.value / total) * Math.PI * 2
    const start = a0 + (slices.length > 1 ? gap / 2 : 0)
    const end = a0 + span - (slices.length > 1 ? gap / 2 : 0)
    a0 += span
    const pt = (a: number): string => `${(cx + Math.cos(a) * rm).toFixed(1)} ${(cy + Math.sin(a) * rm).toFixed(1)}`
    const dur = Math.min(1.4, 0.45 + 1.3 * (s.value / total))
    return `<path d="M${pt(start)} A${rm} ${rm} 0 ${end - start > Math.PI ? 1 : 0} 1 ${pt(end)}" fill="none" stroke="${colours[i]}" stroke-width="${th}" stroke-linecap="butt" pathLength="1" style="stroke-dasharray:1 1" data-draw data-at="${f2(times[i] as number)}" data-dur="${f2(dur)}" data-ease="inOut"/>`
  })
  const track = `<circle cx="${cx}" cy="${cy}" r="${rm}" fill="none" stroke="${look.kind === 'parchment' ? 'rgba(43,33,24,.1)' : 'rgba(255,255,255,.06)'}" stroke-width="${th}" data-anim="fade" data-at="0.4" data-dur="0.5"/>`
  // the legend: a swatch, the label and the share, counting up
  const lx = portrait ? m : cx + R + 140
  const lw = c.width - m - lx
  const pitch = portrait ? 104 : 108
  const ly0 = portrait ? cy + R + 90 : Math.round(cy - (pitch * slices.length) / 2) + 8
  const rows = slices
    .map((s, i) => {
      const y = ly0 + i * pitch
      const hot = s.accent
      return `<div class="lg" style="left:${lx}px;top:${y}px;width:${lw}px" data-anim="rise" data-at="${f2(times[i] as number)}" data-dur="0.45" data-dy="14"><i style="background:${colours[i]}"></i><span class="ll" data-fit="16" style="color:${hot ? ink.accent : ink.text}">${esc(typo(s.label))}</span><span class="lp" style="color:${hot ? ink.accent : ink.text}"><span data-count data-from="0" data-to="${pct[i]!.toFixed(3)}" data-dec="${dec}" data-at="${f2((times[i] as number) + 0.1)}" data-dur="${f2(Math.min(1.4, 0.45 + 1.3 * (s.value / total)))}"></span><span class="lpu">&nbsp;%</span></span></div>`
    })
    .join('\n')
  // the middle: the share of the slice the story is about (the last accent one), once it has swept
  const hotIdx = slices.reduce((best, s, i) => (s.accent && (best < 0 || (times[i] as number) >= (times[best] as number)) ? i : best), -1)
  const centre =
    hotIdx >= 0
      ? `<div class="mid" style="left:${cx - rm + th}px;top:${cy - 90}px;width:${2 * (rm - th)}px"><div class="mn" data-fit="40" data-anim="pop" data-at="${f2((times[hotIdx] as number) + 0.5)}" data-dur="0.45">${esc(fmt(pct[hotIdx] as number, dec))}<span class="mu">&nbsp;%</span></div></div>`
      : ''
  return {
    css: `
.dn{position:absolute;left:0;top:0}
.lg{position:absolute;display:flex;align-items:center;gap:${pick(c, 26, 22)}px;height:${pitch - 16}px;border-bottom:1.5px solid ${ink.grid}}
.lg i{display:block;width:${pick(c, 34, 30)}px;height:${pick(c, 34, 30)}px;flex:none;border-radius:${look.kind === 'parchment' ? 2 : 6}px}
.ll{flex:1;min-width:0;font-family:${ink.labFace};font-weight:600;font-size:${pick(c, 32, 30)}px;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;overflow:hidden}
.lp{flex:none;font-family:${ink.numFace};font-weight:${ink.numWeight};font-size:${pick(c, 66, 62)}px;line-height:1;white-space:nowrap;font-variant-numeric:lining-nums tabular-nums;text-align:right}
.lpu{font-size:.6em;opacity:.85}
.mid{position:absolute;height:180px;display:flex;align-items:center;justify-content:center}
.mn{font-family:${ink.numFace};font-weight:${ink.numWeight};font-size:${Math.round(R * 0.5)}px;line-height:1.05;color:${ink.accent};white-space:nowrap;max-width:100%;overflow:hidden;font-variant-numeric:lining-nums tabular-nums;padding-bottom:6px}
.mu{font-size:.5em}`,
    body: `<svg class="dn" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}">${track}${arcs.join('')}</svg>\n${rows}\n${centre}`
  }
}

// ---- counters ---------------------------------------------------------------------------------------------------------------------------

function countersChart(p: ChartCardProps, c: MotionCtx, ink: Ink, look: DocStyle): { css: string; body: string } {
  const list = p.counters as NonNullable<ChartCardProps['counters']>
  const n = list.length
  const portrait = isPortrait(c)
  const m = pick(c, 120, 64)
  const times = list.map((x, i) => x.atS ?? 0.9 + (i * Math.max(0.5, c.durationS * 0.55 - 0.9)) / Math.max(1, n - 1))
  // one size for all the numbers: the biggest that lets the widest one fit its column (Oswald digits are about 0.5 em wide)
  const colWidth = portrait ? c.width - 2 * m : (c.width - 2 * m) / n
  const widest = Math.max(...list.map((x) => withUnit(fmt(x.value, x.dec ?? decimalsOf(x.value)), x.unit).length))
  const size = Math.round(Math.min(portrait ? [220, 190, 170, 150][n - 1]! : [330, 270, 230, 190][n - 1]!, (colWidth - 60) / (widest * 0.5 + 0.3)))
  const items = list.map((x, i) => {
    const dec = x.dec ?? decimalsOf(x.value)
    const colW = portrait ? c.width - 2 * m : (c.width - 2 * m) / n
    const left = portrait ? m : m + colW * i
    const rowH = portrait ? Math.round((c.height * 0.62) / n) : 0
    const top = portrait ? Math.round(c.height * 0.3) + rowH * i : Math.round(c.height * 0.45)
    const pre = unitBefore(x.unit) ? `<span class="cu">${esc(x.unit as string)}</span>` : ''
    const suf = x.unit && !unitBefore(x.unit) ? `<span class="cu">&nbsp;${esc(x.unit)}</span>` : ''
    const t = times[i] as number
    return `<div class="col" style="left:${left}px;top:${top}px;width:${colW}px;${portrait ? `height:${rowH}px` : ''}">
<div class="cbar" data-anim="grow" data-at="${f2(t)}" data-dur="0.5"></div>
<div class="cnum" data-fit="48"><span class="gh">${pre}${esc(fmt(x.value, dec))}${suf}</span><span class="lv">${pre}<span data-count data-from="0" data-to="${x.value}" data-dec="${dec}" data-at="${f2(t + 0.1)}" data-dur="1.4"></span>${suf}</span></div>
<div class="clab" data-fit="${portrait ? 20 : 18}" data-lines="2" data-anim="rise" data-at="${f2(t + 0.35)}" data-dur="0.45" data-dy="12">${esc(typo(x.label))}</div>
</div>${i < n - 1 && !portrait ? `<div class="sep" style="left:${(left + colW).toFixed(0)}px;top:${top - 40}px" data-anim="growy" data-at="${f2(t + 0.2)}" data-dur="0.5"></div>` : ''}`
  })
  return {
    css: `
.col{position:absolute;display:flex;flex-direction:column;align-items:center;padding:0 24px}
.cbar{width:${pick(c, 96, 90)}px;height:8px;background:${ink.accent};transform-origin:left center;margin-bottom:${pick(c, 26, 14)}px;flex:none;${look.kind === 'parchment' ? 'border-radius:0' : 'border-radius:4px'}}
.cnum{position:relative;font-family:${ink.numFace};font-weight:${ink.numWeight};font-size:${size}px;line-height:1.05;color:${ink.text};white-space:nowrap;width:max-content;max-width:100%;overflow:hidden;padding-bottom:8px;font-variant-numeric:lining-nums tabular-nums;letter-spacing:-.005em;flex:none}
.cnum .gh{visibility:hidden}
.cnum .lv{position:absolute;left:0;top:0;white-space:nowrap}
.cu{font-size:.46em;color:${ink.accent};font-weight:${ink.numWeight}}
.clab{font-family:${ink.labFace};font-weight:600;font-size:${pick(c, 32, 34)}px;line-height:1.25;letter-spacing:.12em;text-transform:uppercase;color:${ink.muted};text-align:center;max-width:100%;max-height:${Math.round(pick(c, 32, 34) * 1.25 * 2 + 6)}px;overflow:hidden;margin-top:${pick(c, 14, 8)}px}
.sep{position:absolute;width:2px;height:${Math.round(size * 1.05 + 150)}px;background:${ink.grid};transform-origin:center top}${
      ink.engraved
        ? `
.cbar{height:8px;background:none;border-top:2.5px solid ${ink.accent};border-bottom:1px solid ${ink.accent}}
.clab{font-weight:400;letter-spacing:.16em}
.sep{width:1px;background:${rgba(ink.engraved.ink, 0.4)}}`
        : ''
    }`,
    body: items.join('\n')
  }
}

/** The chart card. `paper` (a motion look, look.ts): drawn engraved on that paper (`look` is then its parchment style). */
export function chartCard(p: ChartCardProps, c: MotionCtx, look: DocStyle = DARK_STYLE, paper: PaperLook | null = null): Part {
  const ink = paper ? inkOfPaper(paper) : inkOf(look)
  const head = look.kind === 'parchment' || paper ? parchmentHeader(c, look, p.kicker, p.title, p.source, false) : header(c, p.title, p.kicker, p.title, p.source)
  const part =
    p.kind === 'donut' ? donutChart(p, c, ink, look) : p.kind === 'counters' ? countersChart(p, c, ink, look) : lineChart(p, c, ink, p.kind === 'area')
  if (paper) {
    const grain = paper.texture === 'paper' ? '' : lookTexture(paper, 'cgr', 'cg')
    return { css: `${head.css}${paperHeadCss(paper, c)}${part.css}`, body: `${head.body}${grain}\n${part.body}\n</div>` }
  }
  return { css: `${head.css}${part.css}`, body: `${head.body}\n${part.body}\n</div>` }
}
