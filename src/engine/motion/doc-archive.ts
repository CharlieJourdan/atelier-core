// The archive card (formats/cards.ts): a found picture, framed one of four ways — the picture over the whole frame (a painting, a
// photograph), a print on a dark board (doc-board.ts), a document on graph paper (doc-paper.ts), an old television. Every frame draws
// its own opaque background; a word punch and white serif lines can sit over any of them.
import type { ArchiveCardProps, CardAssets } from '../formats/cards'
import { esc, isPortrait, pick, typo, type MotionCtx } from './base'
import type { Part } from './cards'
import { boardFrame } from './doc-board'
import {
  FONT,
  PICTURE_CSS,
  aspectOfPicture,
  cameraAttrs,
  captionBox,
  originOf,
  overlays,
  pictureTag,
  type FrameIn,
  type FrameOut
} from './doc-common'
import { DARK_STYLE, PARCH, parchmentCaption, type DocStyle } from './doc-parchment'
import { paperFrame } from './doc-paper'

/** The picture over the whole frame, a slow camera move, a caption box top left, a light vignette and an archive grade. */
function fullFrame({ p, c, picture, look }: FrameIn): FrameOut {
  const parch = look.kind === 'parchment'
  const box = parch ? parchmentCaption : captionBox
  const cap = p.label ? box(p.label, p.sub, pick(c, 60, 48), pick(c, 54, 90), c.width * pick(c, 0.55, 0.88), c) : { css: '', body: '' }
  const shaded = p.lines.length > 0 || p.punch !== undefined
  return {
    css: `
.fullw{position:absolute;inset:0;overflow:hidden;background:#000}
.fullw .zoom{position:absolute;inset:0;transform-origin:${originOf(p.move)}}
.fullw .pic{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;filter:${parch ? 'contrast(1.08) saturate(.7) sepia(.3) brightness(1)' : 'contrast(1.1) saturate(.84) sepia(.1) brightness(.98)'}}
.fullw .vig{position:absolute;inset:0;background:radial-gradient(ellipse 88% 84% at 50% 50%,transparent 56%,${parch ? 'rgba(70,40,10,.46)' : 'rgba(0,0,0,.42)'} 100%)}
.fullw .shade{position:absolute;left:0;right:0;bottom:0;height:46%;background:linear-gradient(to top,rgba(0,0,0,.55),transparent)}
${cap.css}`,
    body: `<div class="fullw"><div class="zoom" ${cameraAttrs(p.move, 0.1, c.durationS)}>${pictureTag(picture, 'pic')}</div><div class="vig"></div>${shaded ? '<div class="shade"></div>' : ''}${cap.body}</div>`,
    linesLeft: pick(c, 80, 60),
    ink: parch ? PARCH.tag : '#fff',
    srcInk: parch ? PARCH.tag : 'rgba(255,255,255,.78)',
    shadow: true,
    ...(parch ? { punch: { bg: look.accent, ink: PARCH.tag, shadow: '0 8px 20px rgba(30,16,4,.5)' }, srcSerif: true } : {})
  }
}

/** An old television: the picture at 4:3 with rounded corners, a faded colour look and a strong inner vignette on black. */
function tvFrame({ p, c, picture }: FrameIn): FrameOut {
  const portrait = isPortrait(c)
  const tw = portrait ? c.width - 2 * 36 : Math.round(c.height * 0.96 * (4 / 3))
  const th = Math.round(tw * 0.75)
  const left = Math.round((c.width - tw) / 2)
  const top = Math.round((c.height - th) / 2)
  const cap = p.label ? captionBox(p.label, p.sub, 36, 34, tw * 0.62, c) : { css: '', body: '' }
  return {
    css: `
.tvw{position:absolute;inset:0;background:#000}
.tv{position:absolute;left:${left}px;top:${top}px;width:${tw}px;height:${th}px;border-radius:${Math.round(th * 0.06)}px;overflow:hidden;background:#050505}
.tv .zoom{position:absolute;inset:0;transform-origin:${originOf(p.move)}}
.tv .pic{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;filter:sepia(.32) saturate(.7) contrast(1.22) brightness(.96) blur(.6px)}
.tv .sl{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.075) 0,rgba(0,0,0,.075) 1px,transparent 1px,transparent 3px)}
.tv .vg{position:absolute;inset:0;border-radius:inherit;background:radial-gradient(ellipse 74% 74% at 50% 50%,transparent 36%,rgba(0,0,0,.55) 74%,rgba(0,0,0,.94) 100%);box-shadow:inset 0 0 ${Math.round(th * 0.09)}px ${Math.round(th * 0.03)}px #000}
${cap.css}`,
    body: `<div class="tvw"><div class="tv"><div class="zoom" ${cameraAttrs(p.move, 0.07, c.durationS)}>${pictureTag(picture, 'pic')}</div><div class="sl"></div><div class="vg"></div>${cap.body}</div></div>`,
    linesLeft: left + 44,
    ink: '#fff',
    srcInk: 'rgba(255,255,255,.7)',
    shadow: true
  }
}

const FRAMES: Record<ArchiveCardProps['frame'], (i: FrameIn) => FrameOut> = { full: fullFrame, board: boardFrame, paper: paperFrame, tv: tvFrame }

/** The page of an archive card. `assets.picture` is the found picture as a data: URI; without one a neutral stand-in is drawn. */
export function archiveCard(p: ArchiveCardProps, c: MotionCtx, assets: CardAssets, look: DocStyle = DARK_STYLE): Part {
  const picture = assets.picture
  const fr = FRAMES[p.frame]({ p, c, picture, aspect: aspectOfPicture(picture), look })
  const ov = overlays({ punch: p.punch, punchAtS: p.punchAtS, lines: p.lines, linesAtS: p.linesAtS, linesLeft: fr.linesLeft, ink: fr.ink, shadow: fr.shadow, ...(fr.punch ? { punchBg: fr.punch.bg, punchInk: fr.punch.ink, punchShadow: fr.punch.shadow } : {}) }, c)
  const src = p.source
    ? `<div class="src" data-fit="11" data-anim="fade" data-at="0.9" data-dur="0.5">${esc(typo(p.source))}</div>`
    : ''
  return {
    css: `${PICTURE_CSS}${fr.css}${ov.css}
.src{position:absolute;right:${pick(c, 64, 48)}px;bottom:${pick(c, 50, 60)}px;max-width:${c.width * 0.6}px;font-family:${fr.srcSerif ? FONT.serif : FONT.sans};font-weight:600;font-size:${pick(c, 18, 17)}px;letter-spacing:.2em;text-transform:uppercase;color:${fr.srcInk};white-space:nowrap;overflow:hidden;text-align:right;${fr.shadow ? 'text-shadow:0 1px 8px rgba(0,0,0,.8);' : ''}}`,
    body: fr.body + ov.body + src
  }
}
