// The map card in its parchment look (doc-parchment.ts, spec `theme: 'light'`): the Earth picture as an old print (sepia, washed toward the
// paper), countries in a translucent ink wash with a coloured band along their border and an ink outline, routes as dashed ink paths drawing themselves along the way,
// pins as small ink circles with serif labels on paper tags, a double-rule frame like an atlas plate and the title in a cartouche. The layout,
// the camera and the times are the dark map's (map-card.ts); only the look changes. Pure strings.
import type { MapCardProps } from '../formats/cards'
import { PARCH, type DocStyle } from './doc-parchment'

const SERIF = `'Source Serif 4','Iowan Old Style','Georgia',serif`
const f = (n: number): string => n.toFixed(2)

/** The three tones of a shaded country on the parchment: the wash over the paper, the band along the border and the ink of the outline. */
export function parchTones(accent: string): Record<MapCardProps['regions'][number]['tone'], { wash: string; band: string; line: string }> {
  return {
    red: { wash: `${accent}30`, band: `${accent}88`, line: PARCH.ink },
    gold: { wash: 'rgba(196,146,44,.30)', band: 'rgba(176,126,28,.62)', line: PARCH.ink },
    pale: { wash: 'rgba(250,243,224,.5)', band: 'rgba(43,33,24,.2)', line: PARCH.ink }
  }
}

/** The CSS laid after the dark map's, overriding what changes (the same class names). `px` scales a measure to the frame. */
export function mapParchmentCss(px: (n: number) => string, look: DocStyle): string {
  return `
body{background:${PARCH.paper}}
.mbg{background:linear-gradient(165deg,${PARCH.paper} 0%,${PARCH.paperDeep} 100%)}
.pclip{position:absolute;inset:0;clip-path:inset(${px(28)})}
.world img{filter:sepia(1) saturate(.6) contrast(1.02) brightness(1.5)}
.pw1{position:absolute;background:rgba(240,228,198,.62)}
.pw2{position:absolute;background:${PARCH.paper};mix-blend-mode:multiply}
.brd{stroke:rgba(43,33,24,.62);stroke-linecap:round}
.ptex{position:absolute;left:0;top:0;pointer-events:none;mix-blend-mode:multiply}
.pr1{position:absolute;inset:${px(17)};border:${px(3)} solid ${PARCH.ink};pointer-events:none}
.pr2{position:absolute;inset:${px(27)};border:1px solid ${PARCH.ink};pointer-events:none}
.ct{text-shadow:0 0 7px rgba(246,237,214,.95),0 0 3px rgba(246,237,214,.95),0 0 1px rgba(246,237,214,.9)}
.nm{color:rgba(43,33,24,.74);font-weight:600}
.rl{color:${PARCH.ink};font-weight:600}
.dot{background:${PARCH.ink};box-shadow:0 0 0 ${px(2.5)} ${PARCH.tag},0 0 0 ${px(3.5)} ${PARCH.ink}}
.stem{background:${PARCH.ink};width:${px(1.5)};margin-left:${px(-0.75)}}
.box{background:${PARCH.tag};border:1px solid ${PARCH.ink};border-left:${px(3)} solid ${look.accent};box-shadow:0 ${px(5)} ${px(12)} rgba(60,36,10,.3)}
.box .lb{color:${PARCH.ink};font-weight:600}
.box .nt{color:${PARCH.muted}}
.rh b{background:radial-gradient(circle,rgba(246,237,214,.95) 0%,rgba(246,237,214,.7) 34%,rgba(246,237,214,0) 70%)}
.rh i{background:${PARCH.ink};box-shadow:0 0 0 ${px(2.5)} ${PARCH.tag},0 0 0 ${px(3.5)} ${PARCH.ink}}
.vig{background:radial-gradient(ellipse at 50% 48%,rgba(0,0,0,0) 56%,rgba(112,74,30,.34) 100%)}
.corner{display:none}
.hd{left:${px(66)};top:${px(66)};width:max-content;max-width:${px(820)};background:rgba(246,237,214,.97);border:${px(2.5)} solid ${PARCH.ink};padding:${px(13)} ${px(26)} ${px(15)};box-shadow:0 0 0 ${px(4)} rgba(246,237,214,.97),0 0 0 ${px(5)} ${PARCH.ink},0 ${px(10)} ${px(22)} rgba(60,36,10,.34)}
.kick{font-family:${SERIF};font-weight:600;font-size:${px(15)};letter-spacing:.3em;color:${look.accent};text-shadow:none;margin-bottom:${px(7)};padding-bottom:${px(6)};border-bottom:1px solid rgba(43,33,24,.4)}
.ttl{font-family:${SERIF};font-weight:600;font-size:${px(34)};letter-spacing:.07em;color:${PARCH.ink};text-shadow:none}`
}

/** A shaded country: a light wash, a band of the tone along the inside of its border (the border stroke clipped to the shape) and the ink outline. */
export function parchRegion(i: number, d: string, tone: { wash: string; band: string; line: string }, at: number): string {
  return `<g data-anim="fade" data-at="${f(at)}" data-dur="0.9"><clipPath id="rc${i}"><path d="${d}"/></clipPath><path class="rw" d="${d}" style="fill:${tone.wash};stroke:none"/><path class="rb" data-sw="11" clip-path="url(#rc${i})" d="${d}" style="fill:none;stroke:${tone.band};stroke-linejoin:round"/><path class="reg" data-sw="1.5" d="${d}" style="fill:none;stroke:${tone.line}"/></g>`
}

/**
 * A route: a pale halo and a dashed ink line, both drawn on along the curve `line` from its start (the dashes show through a mask that is
 * drawn on), with the dark map's ease so the head (an ink dot, map-card.ts) rides the drawn end.
 */
export function parchRoute(i: number, line: string, t: number, d: number, size: { w: number; h: number }): string {
  const draw = `pathLength="1" data-draw data-at="${f(t)}" data-dur="${f(d)}" data-ease="sine"`
  return `<defs><mask id="rm${i}" maskUnits="userSpaceOnUse" x="${-size.w}" y="${-size.h}" width="${3 * size.w}" height="${3 * size.h}"><path class="rt" ${draw} data-sw="10" style="stroke:#fff;stroke-dasharray:1 1" d="${line}"/></mask></defs>
<path class="rt" ${draw} data-sw="7" style="stroke:rgba(246,237,214,.6);stroke-dasharray:1 1" d="${line}"/>
<path class="rt" pathLength="1" data-sw="2.8" mask="url(#rm${i})" style="stroke:${PARCH.ink};stroke-linecap:butt;stroke-dasharray:.0125 .0095" d="${line}"/>`
}

/** The washes laid over the Earth picture: a pale veil, then the paper multiplied over it (so the seas read as pale as the page). */
export const parchWash = (r: { x: number; y: number; w: number; h: number }): string => {
  const at = `left:${f(r.x)}px;top:${f(r.y)}px;width:${f(r.w)}px;height:${f(r.h)}px`
  return `<div class="pw1" style="${at}"></div><div class="pw2" style="${at}"></div>`
}

/** The atlas plate: a thick outer rule and a thin inner one. */
export const PLATE = '<div class="pr1"></div><div class="pr2"></div>'
