// The document card (formats/cards.ts `document`, motion-montage): a page that shows what the narration says. A typed letter, a newspaper
// column, a typed report or a parchment, set in the page (or a scanned picture of a document), on a dark slate desk or on parchment.
// Marks land on the phrases on their words: a marker sweeps behind it, an ink line is drawn under it, a hand-drawn circle or box goes
// round it, a line strikes it out; the camera (runtime `data-follow`) flies from the wide view to each mark. A phrase's place is only
// known after layout, so the marks are `<path>`s the runtime measures and draws at init (`data-around`, `data-box`).
import { docText, phraseSpan, type CardAssets, type DocumentCardProps } from '../formats/cards'
import { esc, isPortrait, pick, typo, type MotionCtx } from './base'
import type { Part } from './cards'
import { DARK_CSS, FONT, aspectOfPicture, f2, fitBox, pictureTag, warpedGrid, PICTURE_CSS } from './doc-common'
import { DARK_STYLE, PARCH, PAPER_CSS, paperBackdrop, type DocStyle } from './doc-parchment'

type Paper = DocumentCardProps['paper']
type MarkStyle = DocumentCardProps['marks'][number]['style']

const TYPEWRITER = "'Courier New','Courier Prime','Liberation Mono','Cousine','DejaVu Sans Mono',monospace"

/** What a paper looks like: its colour and ink, the face of its body and its measures (average glyph width and line height, in em). */
interface PaperLook {
  bg: string
  ink: string
  muted: string
  face: string
  cw: number
  lh: number
  weight: number
  /** The faint shade at the sheet's edges. */
  edge: string
}
const PAPERS: Record<Paper, PaperLook> = {
  letter: { bg: '#f6f0e1', ink: '#27231f', muted: '#7b705f', face: TYPEWRITER, cw: 0.6, lh: 1.55, weight: 400, edge: 'rgba(120,96,50,.2)' },
  typed: { bg: '#f1eee5', ink: '#1c1b19', muted: '#6f6a5f', face: TYPEWRITER, cw: 0.6, lh: 1.5, weight: 400, edge: 'rgba(90,84,70,.2)' },
  newspaper: { bg: '#e1dccb', ink: '#1f1d1a', muted: '#6a6556', face: FONT.serif, cw: 0.47, lh: 1.36, weight: 400, edge: 'rgba(80,70,45,.28)' },
  parchment: { bg: '#e8d6ad', ink: PARCH.ink, muted: PARCH.muted, face: FONT.serif, cw: 0.47, lh: 1.5, weight: 400, edge: 'rgba(112,74,30,.4)' }
}

/** The `read` camera's even push, a second (NXIJ shots 111, 233, 372: 0.6–0.7 %). */
const READ_PUSH = 0.007

/** How a mark is drawn: its stroke, its opacity, how long the pen takes and its ease. */
function markLook(style: MarkStyle, look: DocStyle, paper: Paper, chars: number): { stroke: string; width: number; opacity: number; dur: number; ease: string; cap: string } {
  const marker = paper === 'parchment' ? '#d6a21c' : '#f2d14b'
  switch (style) {
    case 'band':
      return { stroke: '#d3402c', width: 20, opacity: 0.42, dur: Math.min(1.2, 0.5 + chars * 0.008), ease: 'linear', cap: 'butt' }
    case 'highlight':
      return { stroke: marker, width: 20, opacity: 0.62, dur: Math.min(1.3, 0.4 + chars * 0.012), ease: 'linear', cap: 'butt' }
    case 'underline':
      return { stroke: look.accent, width: 4.5, opacity: 1, dur: Math.min(1, 0.4 + chars * 0.01), ease: 'linear', cap: 'round' }
    case 'strike':
      return { stroke: look.accent, width: 4.5, opacity: 1, dur: 0.45, ease: 'linear', cap: 'round' }
    case 'circle':
      return { stroke: look.accent, width: 4.2, opacity: 1, dur: 0.75, ease: 'inOut', cap: 'round' }
    case 'box':
      return { stroke: look.accent, width: 4, opacity: 1, dur: 0.7, ease: 'inOut', cap: 'round' }
  }
}

/** The paper's grain: fibres and soft stains from fixed-seed noise, laid over the sheet with `multiply`. */
const grain = (w: number, h: number): string => `<svg class="grain" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>
<filter id="dgs" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".006 .009" numOctaves="3" seed="9" result="a"/><feColorMatrix in="a" values="0 0 0 0 .5  0 0 0 0 .36  0 0 0 0 .16  1.9 0 0 0 -.72"/></filter>
<filter id="dgf" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".8 .5" numOctaves="2" seed="4" result="b"/><feColorMatrix in="b" values="0 0 0 0 .32  0 0 0 0 .24  0 0 0 0 .13  1.6 0 0 0 -.7"/></filter>
</defs><rect width="100%" height="100%" filter="url(#dgs)" opacity=".14"/><rect width="100%" height="100%" filter="url(#dgf)" opacity=".2"/></svg>`

interface Sheet {
  w: number
  h: number
  /** The sheet's inner html (text or picture), its css and the ids of the elements marks are measured on. */
  html: string
  css: string
}

/** The font size (px) at which `len` characters fill about 70 % of a box: the page then shrinks it by measurement if it still overflows. */
export function bodySize(len: number, boxW: number, boxH: number, k: PaperLook): number {
  const fs = Math.sqrt((0.7 * boxW * boxH) / (Math.max(40, len) * k.cw * k.lh))
  return Math.max(20, Math.min(44, Math.round(fs)))
}

/** The typed sheet: heading, date, body (the one text node the marks are measured on), source. */
function textSheet(p: DocumentCardProps, c: MotionCtx, k: PaperLook): Sheet {
  const portrait = isPortrait(c)
  const news = p.paper === 'newspaper'
  const w = portrait ? 880 : news ? 1260 : 1000
  const maxH = portrait ? 1380 : 980
  const padX = pick(c, news ? 64 : 76, 64)
  const padY = pick(c, 58, 64)
  const body = docText(p.text as string)
  const headH = p.heading ? (news ? pick(c, 170, 190) : pick(c, 92, 100)) : 0
  const dateH = p.date ? 46 : 0
  const srcH = p.source ? 60 : 0
  const chrome = 2 * padY + headH + dateH + srcH + 30
  const boxW = w - 2 * padX
  const cols = news && !portrait ? 2 : 1
  const colW = (boxW - (cols - 1) * 44) / cols
  const size = bodySize(body.length, boxW - (cols - 1) * 44, maxH - chrome, k)
  // the sheet is as tall as its text needs (a little more than the estimate: the page shrinks the text by measurement if it still overflows)
  const lines = Math.ceil((Math.ceil((body.length * k.cw * size * 1.08) / colW)) / cols)
  const h = Math.round(Math.min(maxH, Math.max(maxH * 0.5, chrome + lines * size * k.lh * 1.06 + 20)))
  const letter = p.paper === 'letter'
  const heading = p.heading
    ? `<div class="dhead" data-fit="20" data-lines="${news ? 2 : 1}" data-anim="rise" data-at="0.35" data-dur="0.5" data-dy="14">${esc(typo(p.heading))}</div>`
    : ''
  const date = p.date ? `<div class="ddate" data-fit="14" data-anim="fade" data-at="0.5" data-dur="0.5">${esc(typo(p.date))}</div>` : ''
  const source = p.source ? `<div class="dsrc" data-fit="12" data-anim="fade" data-at="0.8" data-dur="0.5">${esc(typo(p.source))}</div>` : ''
  const headCss = news
    ? `.dhead{font-family:${FONT.cond};font-weight:700;text-transform:uppercase;text-align:center;font-size:${pick(c, 76, 64)}px;line-height:1.06;letter-spacing:.02em;height:${headH - 24}px;overflow:hidden;display:flex;align-items:center;justify-content:center;border-bottom:5px double ${k.ink};margin-bottom:18px;padding-bottom:12px}`
    : p.paper === 'parchment'
      ? `.dhead{font-family:${FONT.serif};font-weight:600;text-transform:uppercase;text-align:center;font-size:${pick(c, 44, 40)}px;letter-spacing:.14em;line-height:1.2;white-space:nowrap;overflow:hidden;padding-bottom:16px;margin-bottom:12px;border-bottom:2px solid ${k.ink}}`
      : letter
        ? `.dhead{font-family:${FONT.serif};font-weight:600;text-transform:uppercase;text-align:center;font-size:${pick(c, 38, 36)}px;letter-spacing:.2em;line-height:1.2;white-space:nowrap;overflow:hidden;padding-bottom:16px;margin-bottom:12px;border-bottom:1px solid ${k.ink}}`
        : `.dhead{font-family:${TYPEWRITER};font-weight:700;text-transform:uppercase;text-align:left;font-size:${pick(c, 40, 36)}px;letter-spacing:.08em;line-height:1.2;white-space:nowrap;overflow:hidden;padding-bottom:14px;margin-bottom:12px;border-bottom:3px solid ${k.ink}}`
  return {
    w,
    h,
    html: `<div class="din" style="left:${padX}px;top:${padY}px;width:${boxW}px;height:${h - 2 * padY}px">${heading}${date}<div class="dbody" id="dt" data-fit="15" data-anim="fade" data-at="0.45" data-dur="0.6" style="font-size:${size}px">${esc(body)}</div>${source}</div>`,
    css: `
.din{position:absolute;display:flex;flex-direction:column;color:${k.ink}}
${headCss}
.ddate{font-family:${k.face};font-size:${pick(c, 24, 24)}px;letter-spacing:.06em;color:${k.muted};text-align:${letter ? 'right' : 'left'};white-space:nowrap;overflow:hidden;height:${dateH - 6}px;margin-bottom:6px;${news ? 'text-transform:uppercase;text-align:center;' : ''}}
.dbody{flex:1;min-height:0;overflow:hidden;font-family:${k.face};font-weight:${k.weight};line-height:${k.lh};letter-spacing:${k.face === TYPEWRITER ? '.01em' : '0'};color:${k.ink};${cols > 1 ? `column-count:${cols};column-gap:44px;column-rule:1px solid rgba(31,29,26,.3);column-fill:balance;` : ''}${k.face === TYPEWRITER ? 'text-shadow:0 0 .6px rgba(28,27,25,.55);' : ''}}
.dsrc{font-family:${FONT.serif};font-style:italic;font-size:${pick(c, 22, 22)}px;letter-spacing:.08em;font-variant-caps:all-small-caps;color:${k.muted};text-align:right;white-space:nowrap;overflow:hidden;height:${Math.max(0, srcH - 8)}px;padding-top:10px}`
  }
}

/** The scanned picture as the sheet: the picture itself, fitted in the frame (a stand-in without one), under the same shadow. */
function pictureSheet(c: MotionCtx, picture: string | undefined): Sheet {
  const box = fitBox(aspectOfPicture(picture), pick(c, c.width * 0.66, c.width * 0.88), pick(c, c.height * 0.92, c.height * 0.76))
  return {
    w: box.w,
    h: box.h,
    html: pictureTag(picture, 'dpic'),
    css: `${PICTURE_CSS}
.dpic{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;filter:contrast(1.05) saturate(.9)}`
  }
}

/** The document card's page. `assets.picture` is the scan (a data: URI) of a card without `text`. */
export function documentCard(p: DocumentCardProps, c: MotionCtx, assets: CardAssets, look: DocStyle = DARK_STYLE): Part {
  const parch = look.kind === 'parchment'
  const D = c.durationS
  const portrait = isPortrait(c)
  const scan = p.text === undefined
  const k = PAPERS[p.paper]
  const sheet = scan ? pictureSheet(c, assets.picture) : textSheet(p, c, k)
  const left = Math.round((c.width - sheet.w) / 2)
  const top = Math.round((c.height - sheet.h) / 2)
  const text = scan ? '' : docText(p.text as string)

  // the marks: a path each, measured and drawn by the runtime; the camera focuses on the same boxes
  const paths = p.marks
    .map((m, i) => {
      const span = scan ? null : phraseSpan(text, m.phrase ?? '')
      if (!scan && !span) return ''
      const look2 = markLook(m.style, look, p.paper, m.phrase?.length ?? 24)
      const where = scan
        ? `data-box="${[(m.rect?.x ?? 0) * sheet.w, (m.rect?.y ?? 0) * sheet.h, (m.rect?.w ?? 0) * sheet.w, (m.rect?.h ?? 0) * sheet.h].map((v) => v.toFixed(1)).join(' ')}"`
        : `data-around="dt" data-from="${(span as [number, number])[0]}" data-to="${(span as [number, number])[1]}"`
      return `<path pathLength="1" fill="none" ${where} data-shape="${m.style === 'band' ? 'highlight' : m.style}" data-seed="${11 + i * 7}" data-draw data-at="${f2(m.atS)}" data-dur="${f2(look2.dur)}" data-ease="${look2.ease}" data-focus-at="${f2(m.atS)}" style="stroke:${look2.stroke};stroke-opacity:${look2.opacity};stroke-width:${look2.width * (portrait ? 1.15 : 1)}px;stroke-linecap:${look2.cap};stroke-linejoin:round;stroke-dasharray:1 1"/>`
    })
    .join('\n')
  const tracked = p.marks.length > 0 && p.camera === 'follow'
  // the reference's reading frame: the page at reading size, its first mark a little above the middle, one even slow push
  const reading = p.camera === 'read'
  const first = p.marks[0]?.rect
  const readZ = reading ? Math.min(2.4, Math.max(1, (c.width * 0.94) / sheet.w)) : 1
  const readY = first ? (0.5 - (first.y + first.h / 2)) * sheet.h * readZ - c.height * 0.04 : 0
  const room = Math.max(0, (sheet.h * readZ - c.height) / 2)
  const frame = reading ? `transform:translateY(${Math.max(-room, Math.min(room, readY)).toFixed(1)}px) scale(${readZ.toFixed(4)})` : ''
  const camAttrs = tracked
    ? `data-follow="${pick(c, 1.35, 1.15)}" data-pw="${c.width}" data-ph="${c.height}"`
    : reading
      ? `data-zoom data-at="0" data-dur="${f2(D)}" data-z0="1" data-z1="${(1 + READ_PUSH * D).toFixed(4)}" data-ease="linear"`
      : p.camera === 'push' || (p.camera === 'follow' && p.marks.length === 0)
        ? `data-zoom data-at="0" data-dur="${f2(D)}" data-z0="1" data-z1="1.1" data-ease="linear"`
        : ''
  // the page goes pale around its key line: a veil over the sheet, the line's own strip of the picture kept above it, bright
  const bands = scan
    ? p.marks
        .filter((m) => m.style === 'band' && m.rect)
        .map((m) => {
          const r = m.rect as NonNullable<typeof m.rect>
          const pad = 0.004
          return `<div class="veil" data-anim="fade" data-at="${f2(Math.max(0, m.atS - 0.35))}" data-dur="0.35"></div><div class="bandw" style="clip-path:inset(${((r.y - pad) * 100).toFixed(2)}% ${((1 - r.x - r.w - pad) * 100).toFixed(2)}% ${((1 - r.y - r.h - pad) * 100).toFixed(2)}% ${((r.x - pad) * 100).toFixed(2)}%)" data-anim="fade" data-at="${f2(Math.max(0, m.atS - 0.35))}" data-dur="0.35">${pictureTag(assets.picture, 'dpic bright')}</div>`
        })
        .join('')
    : ''
  const sheetShadow = parch ? '0 26px 54px rgba(72,46,16,.38),0 3px 10px rgba(72,46,16,.3)' : '0 34px 70px rgba(0,0,0,.6),0 5px 16px rgba(0,0,0,.45)'
  const seed = text.slice(0, 20) || 'scan'
  const desk = parch ? paperBackdrop(c) : ''
  const css = `${parch ? PAPER_CSS : DARK_CSS}
.doc{position:absolute;inset:0;overflow:hidden;${parch ? `background:${PARCH.paper};color:${PARCH.ink};` : ''}}
.cam{position:absolute;left:0;top:0;width:${c.width}px;height:${c.height}px;transform-origin:50% 50%}
.dsheet{position:absolute;left:${left}px;top:${top}px;width:${sheet.w}px;height:${sheet.h}px;background:${scan ? '#fff' : k.bg};box-shadow:${sheetShadow}}
.dsheet .shade{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 90% 88% at 50% 50%,transparent 58%,${scan ? 'rgba(60,40,10,.22)' : k.edge} 100%)}
.grain{position:absolute;left:0;top:0;pointer-events:none;mix-blend-mode:multiply}
.dsheet svg.mk{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;mix-blend-mode:multiply}
.dsheet .veil{position:absolute;inset:0;background:rgba(232,232,228,.62)}
.dsheet .bandw{position:absolute;inset:0}
.dsheet .bright{filter:contrast(1.3) brightness(1.2)}
.dlit{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 70% 62% at 36% 30%,rgba(255,244,222,.08),transparent 70%),radial-gradient(ellipse 120% 105% at 50% 50%,transparent 58%,${parch ? 'rgba(80,50,15,.28)' : 'rgba(0,0,0,.45)'} 100%)}
${sheet.css}`
  const body = `<div class="doc">${desk}
<div class="camf" style="position:absolute;inset:0;${frame}"><div class="cam" ${camAttrs}>${parch ? '' : `<div class="gridw" data-anim="fade" data-at="0.05" data-dur="0.55">${warpedGrid(c, seed)}</div>`}
<div class="dsheet" ${reading ? '' : 'data-anim="rise" data-at="0.1" data-dur="0.7" data-dy="46"'}>${sheet.html}${scan ? '' : grain(sheet.w, sheet.h)}${bands}<div class="shade"></div><svg class="mk" width="${sheet.w}" height="${sheet.h}" viewBox="0 0 ${sheet.w} ${sheet.h}">${paths}</svg></div>
</div></div>
<div class="dlit"></div></div>`
  return { css, body }
}
