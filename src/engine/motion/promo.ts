// The channel promo's page (promo-motion, research note promo-motion-2026-11 (old repository)): a full-frame card rebuilt piece by piece from the
// reference channel's own promo — a warm background light, the offer's picture sliding in from the side (a product, or a screenshot of
// the site in a browser window that the camera pushes into while a pointer clicks), the condensed headline, a serif line, a QR card with
// its caption, the site's address in big letters and a « lien en haut de la description » line. Every piece comes out of a soft blur
// at the time the reference shows it (the timings below are measured on it, frame by frame), then the card holds. Laid out on a
// 1920×1080 frame and scaled to the frame's width (16:9 only). Pure: the same card and pictures always give the same page.
import { promoLink, type PromoCard } from '../formats/promo'
import { qrMatrix } from '../media/qr'
import { esc, pageHtml, themeOf, typo, type MotionCtx } from './base'

/** Bump when the promo's look changes: it is part of its clip's cache key. */
export const PROMO_VERSION = 1

/** The reference's entrances, seconds from the start of the card (measured on the reference, 25 fps). */
export const PROMO_TIMELINE = {
  visual: { at: 0.28, dur: 1.0 },
  headline: { at: 0.7, dur: 0.62 },
  subline: { at: 1.3, dur: 0.48 },
  site: { at: 1.28, dur: 0.62 },
  linkLine: { at: 1.9, dur: 0.6 },
  qr: { at: 1.86, dur: 0.72 },
  qrCaption: { at: 2.86, dur: 0.5 },
  logo: { at: 0.5, dur: 0.7 },
  /** A screenshot: the push in, the pointer's travel and its click. */
  zoom: { at: 1.4, dur: 5.5 },
  pointer: { at: 2.3, dur: 1.2, click: 3.75 }
} as const

/** The pictures of the card, as `data:` URIs (the page reads no file). */
export interface PromoAssets {
  visual: string | null
  logo: string | null
}

const f = (n: number): string => n.toFixed(2)

/**
 * The background's light: from the warm centre to the edges along an ellipse of 800 × 400 px around (970, 500), as the share of the way
 * from the glow colour to the edge colour at each distance (fitted on the reference's empty first frame: 2.2 levels off on average),
 * and a second, softer light low on the right (the reference's corner is about 13 levels warmer than the first light alone).
 */
const GLOW: readonly [r: number, toEdge: number][] = [
  [0, 0],
  [0.2, 0.19],
  [0.4, 0.33],
  [0.6, 0.45],
  [0.8, 0.62],
  [1, 0.79],
  [1.3, 0.88],
  [1.7, 1]
]

/** The QR code as an SVG of dark squares (crisp at any size), its quiet zone left to the white card. */
export function qrSvg(link: string, side: number): string {
  const m = qrMatrix(link)
  const n = m.length
  let d = ''
  m.forEach((row, y) => row.forEach((on, x) => (d += on ? `M${x} ${y}h1v1h-1z` : '')))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path fill="#111" d="${d}"/></svg>`
}

/** An entrance: the element comes out of a blur while it fades in, rising or sliding from a side. */
function enter(anim: string, t: { at: number; dur: number }, o: { blur: number; dx?: number; dy?: number; ease?: string }): string {
  return `data-anim="${anim}" data-at="${f(t.at)}" data-dur="${f(t.dur)}" data-blur="${o.blur}" data-dx="${o.dx ?? 0}" data-dy="${o.dy ?? 0}" data-ease="${o.ease ?? 'inOut'}"`
}

/** The pointer of a screenshot: an arrow drawn in SVG. */
const POINTER = `<svg width="46" height="58" viewBox="0 0 23 29"><path d="M1 1 L1 24 L7 18.5 L11 27.5 L14.6 26 L10.7 17 L18.5 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`

export function promoHtml(card: PromoCard, c: MotionCtx, assets: PromoAssets): string {
  if (c.height > c.width) throw new Error('promo: the card is laid out for a 16:9 frame (a short has no promo layout yet)')
  const u = c.width / 1920
  // the address group (site, link line, QR card, caption) moves together when the card sets its moment
  const late = (card.linkAtS ?? PROMO_TIMELINE.site.at) - PROMO_TIMELINE.site.at
  const later = (t: { at: number; dur: number }): { at: number; dur: number } => ({ at: t.at + late, dur: t.dur })
  const T = { ...PROMO_TIMELINE, site: later(PROMO_TIMELINE.site), linkLine: later(PROMO_TIMELINE.linkLine), qr: later(PROMO_TIMELINE.qr), qrCaption: later(PROMO_TIMELINE.qrCaption) }
  const k = card.colors
  const right = card.side === 'right'
  const screen = card.visual.kind === 'screen' && assets.visual !== null
  const product = card.visual.kind === 'product' && assets.visual !== null
  // the columns of the reference: the picture on one side (60 px from the edge), the QR card on the other, the text between
  const visualBox = screen ? { w: 800, h: 500, top: 80 } : { w: 432, h: 626, top: 40 }
  const visualX = right ? 1920 - (screen ? 60 : 30) - visualBox.w : screen ? 60 : 30
  const qrX = right ? 45 : 1398
  const textX = screen ? (right ? 520 : 900) : product || right ? 580 : 60
  const textW = screen ? 460 : card.qr ? 760 : 1200
  const focus = card.visual.focus
  const link = promoLink(card)
  const qrSide = 386
  const visual = product
    ? `<div class="vis" ${enter(right ? 'blurright' : 'blurleft', T.visual, { blur: 14, dx: 70, ease: 'out' })}><img src="${assets.visual}" alt=""></div>`
    : screen
      ? `<div class="vis scr" ${enter(right ? 'blurright' : 'blurleft', T.visual, { blur: 14, dx: 70, ease: 'out' })}>
<div class="bar"><i></i><i></i><i></i><span>${esc(card.site.replace(/^https?:\/\//, ''))}</span></div>
<div class="shot"><img data-zoom data-at="${f(T.zoom.at)}" data-dur="${f(T.zoom.dur)}" data-z0="1" data-z1="1.22" src="${assets.visual}" alt="">
<div class="ptr" data-move="${Math.round(visualBox.w * 0.92)},${Math.round((visualBox.h - 46) * 0.95)},${Math.round(visualBox.w * focus.x)},${Math.round((visualBox.h - 46) * focus.y)}" data-at="${f(T.pointer.at)}" data-dur="${f(T.pointer.dur)}" data-click="${f(T.pointer.click)}">${POINTER}</div></div>
</div>`
      : ''
  const css = `
body{background:${k.bg}}
.stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(${u});transform-origin:0 0;overflow:hidden}
.drift{position:absolute;inset:0;transform-origin:50% 50%}
.bg{position:absolute;inset:0;background:radial-gradient(ellipse 430px 340px at 1720px 960px, ${k.glow}5C 0%, ${k.glow}2E 50%, ${k.glow}00 100%),radial-gradient(ellipse 1360px 680px at 970px 500px, ${GLOW.map(([r, m]) => `${mix(k.glow, k.bg, m)} ${f((r / 1.7) * 100)}%`).join(', ')})}
.vis{position:absolute;left:${visualX}px;top:${visualBox.top}px;width:${visualBox.w}px;height:${visualBox.h}px}
.vis img{width:100%;height:100%;object-fit:contain;display:block}
.scr{border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.scr .bar{height:46px;background:#ECE7E2;display:flex;align-items:center;gap:9px;padding:0 18px;font:600 19px 'Inter',sans-serif;color:#5b524a}
.scr .bar i{width:13px;height:13px;border-radius:50%;background:#cfc6bd}
.scr .bar span{margin-left:14px;padding:5px 16px;border-radius:8px;background:#fff}
.scr .shot{position:relative;height:${visualBox.h - 46}px;overflow:hidden}
.scr .shot img{object-fit:cover;object-position:${f(focus.x * 100)}% ${f(focus.y * 100)}%;transform-origin:${f(focus.x * 100)}% ${f(focus.y * 100)}%}
.ptr{position:absolute;left:0;top:0;width:46px;height:58px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.45))}
.logo{position:absolute;left:${textX}px;top:40px;height:84px}
.logo img{height:100%;width:auto;display:block}
.txt{position:absolute;left:${textX}px;top:${assets.logo ? 140 : 128}px;width:${textW}px}
.hl{font-family:'Oswald',sans-serif;font-weight:700;font-size:90px;line-height:96px;text-transform:uppercase;color:${k.text};text-wrap:balance}
.sl{margin-top:24px;font-family:'Source Serif 4',serif;font-weight:400;font-size:44.5px;line-height:50px;text-wrap:pretty;color:${k.muted}}
.qr{position:absolute;left:${qrX}px;top:73px;width:477px;height:479px;border-radius:34px;background:#fff;box-shadow:0 0 46px rgba(255,248,240,.22);display:flex;align-items:center;justify-content:center}
.qr svg{display:block}
.cap{position:absolute;left:${qrX - 2}px;top:584px;width:481px;font-family:'Oswald',sans-serif;font-weight:600;font-size:44px;line-height:47.5px;text-align:center;text-transform:uppercase;color:${k.text}}
.site{position:absolute;left:44px;top:752px;width:${card.qr && !right ? 1320 : 1830}px;font-family:'Oswald',sans-serif;font-weight:700;font-size:143px;line-height:150px;color:${k.site};white-space:nowrap;overflow:hidden;letter-spacing:-.004em}
.lk{position:absolute;left:52px;top:909px;display:flex;align-items:center;gap:34px;font-family:'Oswald',sans-serif;font-weight:600;font-size:63px;line-height:66px;color:${k.text};text-transform:uppercase;letter-spacing:0;white-space:nowrap}
.lk svg{display:block}`
  // once every piece has landed the card never stands still (equipe-3-chaines: a held card is a frozen picture, decision 0102):
  // the whole card pushes in slowly, the reference's 9 % camera, to the end of the clip
  const settle = Math.max(...[T.visual, T.headline, T.subline, T.site, T.linkLine, T.qr, T.qrCaption, T.logo].map((t) => t.at + t.dur))
  const drift = c.durationS - settle > 1 ? `data-zoom data-at="${f(settle)}" data-dur="${f(c.durationS - settle)}" data-z0="1" data-z1="1.09" data-ease="linear"` : ''
  const arrow = `<svg width="52" height="56" viewBox="0 0 24 26"><path d="M12 2 V23 M3 14 L12 23 L21 14" fill="none" stroke="${k.text}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  const body = `<div class="stage"><div class="drift" ${drift}>
<div class="bg"></div>
${visual}
${assets.logo ? `<div class="logo" ${enter('reveal', T.logo, { blur: 10 })}><img src="${assets.logo}" alt=""></div>` : ''}
<div class="txt">
<div class="hl" data-fit="44" data-lines="2" ${enter('blur', T.headline, { blur: 12, dy: 22 })}>${esc(typo(card.headline))}</div>
${card.subline ? `<div class="sl" data-fit="24" data-lines="2" ${enter('blur', T.subline, { blur: 8, dy: 14 })}>${esc(typo(card.subline))}</div>` : ''}
</div>
${card.qr ? `<div class="qr" ${enter('blur', T.qr, { blur: 16, dy: 0, ease: 'out' })}>${qrSvg(link, qrSide)}</div>` : ''}
${card.qr && card.qrCaption ? `<div class="cap" data-fit="22" data-lines="3" ${enter('blur', T.qrCaption, { blur: 8, dy: 10 })}>${esc(typo(card.qrCaption))}</div>` : ''}
<div class="site" data-fit="60" ${enter('blur', T.site, { blur: 12, dy: 18, ease: 'out' })}>${esc(card.site.replace(/^https?:\/\//, ''))}</div>
${card.linkLine ? `<div class="lk" ${enter('blur', T.linkLine, { blur: 8, dy: 8 })}>${arrow}<span>${esc(typo(card.linkLine))}</span></div>` : ''}
</div></div>`
  return pageHtml(c, themeOf('#DDAF79', 'dark'), k.site, css, body)
}

/** `a` blended toward `b` by `k` (0 = a, 1 = b). */
function mix(a: string, b: string, k: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const x = rgb(a)
  const y = rgb(b)
  return '#' + x.map((v, i) => Math.round(v + ((y[i] as number) - v) * k).toString(16).padStart(2, '0')).join('')
}
