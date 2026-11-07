// The board frame of an archive card: the picture as a white-bordered print, tilted a little, dropped on a dark warm slate, its label on
// a torn strip under it (or, with a quote, the print on the left and the quote on the right between two thin red rules).
import { DOC_PALETTE } from '../formats/cards'
import { esc, isPortrait, pick, seeded, typo } from './base'
import { FONT, cameraAttrs, fitBox, originOf, pictureTag, tiltOf, type FrameIn, type FrameOut } from './doc-common'
import { PARCH, paperBackdrop, PAPER_CSS } from './doc-parchment'

/** The ragged outline of a torn strip: a polygon whose top and bottom edges wander by a few percent, the same for the same label. */
export function tornClip(seed: string): string {
  const rnd = seeded('torn|' + seed)
  const xs = Array.from({ length: 26 }, (_, i) => (i / 25) * 100)
  const top = xs.map((x) => `${x.toFixed(1)}% ${(rnd() * 9).toFixed(1)}%`)
  const bottom = [...xs].reverse().map((x) => `${x.toFixed(1)}% ${(100 - rnd() * 9).toFixed(1)}%`)
  return `polygon(${[...top, ...bottom].join(',')})`
}

const NOISE = (w: number, h: number): string =>
  `<svg class="noise" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><filter id="nz" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="4" result="a"/><feColorMatrix in="a" values="0 0 0 0 1  0 0 0 0 .96  0 0 0 0 .9  1.4 0 0 0 -.45"/></filter><filter id="cl" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".006 .008" numOctaves="4" seed="11" result="b"/><feColorMatrix in="b" values="0 0 0 0 .9  0 0 0 0 .85  0 0 0 0 .8  1.6 0 0 0 -.62"/></filter><rect width="100%" height="100%" filter="url(#cl)" opacity=".075"/><rect width="100%" height="100%" filter="url(#nz)" opacity=".13"/></svg>`

export function boardFrame({ p, c, picture, aspect, look }: FrameIn): FrameOut {
  const parch = look.kind === 'parchment'
  const D = c.durationS
  const portrait = isPortrait(c)
  const quote = p.quote !== undefined
  const tilt = tiltOf(p.label ?? p.quote ?? 'board', 3)
  // the picture's size inside its white border (the border is ~2 % of the print), and where the print sits
  const maxW = quote ? (portrait ? c.width * 0.66 : c.width * 0.31) : pick(c, c.width * 0.6, c.width * 0.8)
  const maxH = quote ? (portrait ? c.height * 0.3 : c.height * 0.6) : pick(c, c.height * 0.58, c.height * 0.5)
  const inner = fitBox(aspect, maxW, maxH)
  const border = Math.max(10, Math.round(Math.max(inner.w, inner.h) * 0.022))
  const ow = inner.w + 2 * border
  const oh = inner.h + 2 * border
  const tagRoom = !quote && p.label ? 44 : 0
  const cx = quote ? (portrait ? c.width / 2 : c.width * 0.25) : c.width / 2
  const cy = quote ? (portrait ? c.height * 0.27 : c.height * 0.48) : pick(c, c.height * 0.5, c.height * 0.4) - tagRoom / 2 + 4
  const left = Math.round(cx - ow / 2)
  const top = Math.round(cy - oh / 2)
  const pushAmt = 0.06
  const tagTilt = (-tilt * 0.6 + (seeded('tag|' + (p.label ?? ''))() - 0.5) * 2).toFixed(1)

  const tag =
    !quote && p.label
      ? `<div class="tagpos"><div class="tagw" data-anim="rise" data-at="0.7" data-dur="0.4" data-dy="16"><div class="tag" style="transform:rotate(${tagTilt}deg)"><div class="tt" data-fit="18">${esc(typo(p.label))}</div>${p.sub ? `<div class="ts" data-fit="12">${esc(typo(p.sub))}</div>` : ''}</div></div></div>`
      : ''
  const print = `<div class="dropw" style="left:${left}px;top:${top}px;width:${ow}px;height:${oh}px" data-anim="drop" data-at="0.15" data-dur="0.45" data-dy="120"><div class="tilt" style="transform:rotate(${tilt}deg)"><div class="print" style="padding:${border}px">${pictureTag(picture, 'pimg')}</div>${tag}</div></div>`

  // the quote beside the print: two thin red rules around white serif, the label as the attribution
  const qx = portrait ? 60 : Math.round(c.width * 0.47)
  const qw = portrait ? c.width - 120 : Math.round(c.width * 0.42)
  const qy = portrait ? Math.round(c.height * 0.5) : 0
  const qh = portrait ? Math.round(c.height * 0.4) : c.height
  const quoted = p.quote ? (/^[“"«]/.test(p.quote) ? p.quote : `“${p.quote}”`) : ''
  const quoteBlock = quote
    ? `<div class="qwrap" style="left:${qx}px;top:${qy}px;width:${qw}px;height:${qh}px"><div class="rule" data-anim="grow" data-at="0.55" data-dur="0.6"></div><div class="qt" data-fit="24" data-anim="rise" data-at="0.8" data-dur="0.6" data-dy="18">${esc(typo(quoted))}</div><div class="rule" data-anim="grow" data-at="0.75" data-dur="0.6"></div>${p.label ? `<div class="qa" data-anim="fade" data-at="1.5" data-dur="0.5"><span class="qn">${esc(typo(p.label))}</span>${p.sub ? `<span class="qs">${esc(typo(p.sub))}</span>` : ''}</div>` : ''}</div>`
    : ''

  return {
    css: `
.boardw{position:absolute;inset:0;overflow:hidden;background:${parch ? PARCH.paper : `radial-gradient(ellipse 82% 78% at 50% 42%,#37332f 0%,${DOC_PALETTE.slate} 52%,${DOC_PALETTE.slateDeep} 100%)`}}
.boardw .noise{position:absolute;left:0;top:0;pointer-events:none}
.boardw .stage{position:absolute;inset:0;transform-origin:${originOf(p.move)}}
.dropw{position:absolute}
.tilt{position:absolute;inset:0}
.print{position:absolute;inset:0;background:${parch ? '#f8f1de' : '#f3efe6'};box-shadow:${parch ? '0 14px 28px rgba(72,46,16,.3),0 3px 8px rgba(72,46,16,.28),inset 0 0 0 1px rgba(72,46,16,.14)' : '0 26px 52px rgba(0,0,0,.55),0 6px 14px rgba(0,0,0,.45),inset 0 0 0 1px rgba(0,0,0,.08)'}}
.pimg{display:block;width:100%;height:100%;object-fit:cover;filter:${parch ? 'contrast(1.05) saturate(.7) sepia(.28)' : 'contrast(1.06) saturate(.88) sepia(.06)'}}
.tagpos{position:absolute;left:0;right:0;bottom:-${tagRoom - 6}px;display:flex;justify-content:center}
.tagw{filter:${parch ? 'drop-shadow(0 4px 5px rgba(72,46,16,.38))' : 'drop-shadow(0 5px 6px rgba(0,0,0,.5))'};max-width:${Math.round(ow * 1.08)}px}
.tag{background:${parch ? PARCH.tag : '#f4f1ea'};color:${parch ? PARCH.ink : '#0d0c0b'};clip-path:${tornClip(p.label ?? '')};padding:${pick(c, 13, 12)}px ${pick(c, 34, 28)}px ${pick(c, 15, 13)}px;text-align:center;max-width:${Math.round(ow * 1.08)}px}
.tag .tt{font-family:${FONT.serif};font-weight:600;font-size:${pick(c, 30, 28)}px;line-height:1.2;white-space:nowrap;overflow:hidden;padding-bottom:1px}
.tag .ts{font-family:${FONT.serif};font-style:italic;font-size:${pick(c, 18, 17)}px;color:${parch ? PARCH.muted : '#55514a'};line-height:1.3;margin-top:1px;white-space:nowrap;overflow:hidden}
.qwrap{position:absolute;display:flex;flex-direction:column;justify-content:center}
.qwrap .rule{height:${parch ? 2 : 3}px;background:${parch ? look.accent : DOC_PALETTE.red};transform-origin:left center;flex:none}
.qt{font-family:${FONT.serif};font-weight:400;font-size:${pick(c, 44, 42)}px;line-height:1.32;color:${parch ? PARCH.ink : '#fff'};padding:${pick(c, 36, 28)}px 0 ${pick(c, 36, 28)}px;max-height:${Math.round(qh * (portrait ? 0.78 : 0.62))}px;overflow:hidden}
.qa{margin-top:${pick(c, 28, 22)}px;display:flex;flex-direction:column;gap:6px}
.qn{font-family:${FONT.serif};font-weight:600;font-size:${pick(c, 28, 26)}px;letter-spacing:.14em;text-transform:uppercase;color:${parch ? PARCH.ink : '#e9e4da'}}
.qs{font-family:${FONT.serif};font-style:italic;font-size:${pick(c, 23, 21)}px;color:${parch ? PARCH.muted : DOC_PALETTE.muted}}${parch ? PAPER_CSS : ''}`,
    body: `<div class="boardw">${parch ? paperBackdrop(c) : NOISE(c.width, c.height)}<div class="stage" ${cameraAttrs(p.move, pushAmt, D)}>${print}${quoteBlock}</div></div>`,
    linesLeft: pick(c, 80, 60),
    ink: parch ? PARCH.ink : '#fff',
    srcInk: parch ? PARCH.muted : DOC_PALETTE.muted,
    shadow: !parch,
    ...(parch ? { punch: { bg: look.accent, ink: PARCH.tag, shadow: '0 8px 18px rgba(72,46,16,.38)' }, srcSerif: true } : {})
  }
}
