// The second look of the documentary cards, « parchemin » (spec `theme: 'light'`): an old-atlas / archive-book page. Aged paper with a faint
// fibre and stain texture that never changes over time, iron-gall ink, a red-brown accent, Source Serif 4 for every text. The dark look
// (DARK_CSS, Oswald, the red) is the default and is not touched by anything here. `docStyleOf` picks the look from the spec; the cards read
// `look.kind` and call the helpers below for the parts they draw differently.
import { DOC_PALETTE } from '../formats/cards'
import { contrast, esc, pick, typo, type MotionCtx } from './base'
import type { Part } from './cards'
import { FONT } from './doc-common'

export const PARCH = {
  paper: '#efe4cc',
  paperDeep: '#e2d2b0',
  /** The paper under a label or a caption laid on the page: a little lighter than the page. */
  tag: '#f6edd6',
  ink: '#2b2118',
  muted: '#6f5f4a',
  /** Iron-gall red-brown. */
  brown: '#9b2d20',
  ochre: '#a9792a'
} as const

/** Which of the two looks a card is drawn in, and the accent colour of that look. */
export interface DocStyle {
  kind: 'dark' | 'parchment'
  accent: string
}
export const DARK_STYLE: DocStyle = { kind: 'dark', accent: DOC_PALETTE.red }
export const PARCHMENT_STYLE: DocStyle = { kind: 'parchment', accent: PARCH.brown }

/** The accent a spec carries when its author never chose one (formats/motion.ts `common`): it is not an accent, the look keeps its own. */
const SCHEMA_ACCENT = '#3b82f6'

const toRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const toHex = (rgb: readonly number[]): string => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
/** `hex` pulled toward the ink in small steps until it reads on the paper (4.5:1). */
function inked(hex: string): string {
  const ink = toRgb(PARCH.ink)
  let rgb = toRgb(hex)
  for (let i = 0; i < 20 && contrast(toHex(rgb), PARCH.paper) < 4.5; i++) rgb = rgb.map((v, j) => v + ((ink[j] as number) - v) * 0.1) as [number, number, number]
  return toHex(rgb)
}

/** The look of a spec: `theme: 'dark'` (the default) is the dark cards as they always were; `'light'` is the parchment, in the spec's accent
 *  when it chose one that is neither the schema's default blue nor the dark look's red, else in the red-brown. */
export function docStyleOf(theme: 'dark' | 'light', accent: string): DocStyle {
  if (theme !== 'light') return DARK_STYLE
  const a = accent.toLowerCase()
  return a === SCHEMA_ACCENT || a === DOC_PALETTE.red.toLowerCase() ? PARCHMENT_STYLE : { kind: 'parchment', accent: inked(accent) }
}

/** The parchment look in a style's accent (motion look, look.ts): the red-brown as is, another colour pulled toward the ink until it reads. */
export const parchmentStyleOf = (accent: string): DocStyle => (accent.toLowerCase() === PARCH.brown ? PARCHMENT_STYLE : { kind: 'parchment', accent: inked(accent) })

// ---- the paper ----------------------------------------------------------------------------------------------------------------------------

/** The texture of the paper as a transparent SVG of the frame's size (fibres, stains and grain from fractal noise with fixed seeds), to be laid
 *  with `mix-blend-mode:multiply`. The same page always gives the same texture. */
export function paperTexture(c: MotionCtx, cls = 'ptex'): string {
  const w = c.width
  const h = c.height
  return `<svg class="${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>
<filter id="pst" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0042 .0065" numOctaves="4" seed="7" result="a"/><feColorMatrix in="a" values="0 0 0 0 .52  0 0 0 0 .34  0 0 0 0 .14  2.1 0 0 0 -.78"/></filter>
<filter id="pfb" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".25 .5" numOctaves="3" seed="3" result="b"/><feColorMatrix in="b" values="0 0 0 0 .4  0 0 0 0 .27  0 0 0 0 .13  2.6 0 0 0 -1.15"/></filter>
<filter id="pgr" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="5" result="c"/><feColorMatrix in="c" values="0 0 0 0 .3  0 0 0 0 .2  0 0 0 0 .1  1.5 0 0 0 -.62"/></filter>
</defs><rect width="100%" height="100%" filter="url(#pst)" opacity=".22"/><rect width="100%" height="100%" filter="url(#pfb)" opacity=".16"/><rect width="100%" height="100%" filter="url(#pgr)" opacity=".16"/></svg>`
}

/** The paper itself: the warm gradient, the texture and a soft darker vignette at the edges (opaque from the first frame). */
export const PAPER_CSS = `
.pbg{position:absolute;inset:0;background:linear-gradient(165deg,${PARCH.paper} 0%,${PARCH.paperDeep} 100%)}
.ptex{position:absolute;left:0;top:0;pointer-events:none;mix-blend-mode:multiply}
.pvig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 82% 80% at 50% 48%,transparent 52%,rgba(112,74,30,.3) 100%)}`
export const paperBackdrop = (c: MotionCtx): string => `<div class="pbg"></div>${paperTexture(c)}<div class="pvig"></div>`

// ---- the data cards (bars, timeline) ----------------------------------------------------------------------------------------------------

const SOURCE_RE = /^source\s*:/i
/** The paper, the thin double rule under the head, and the kicker, the title and the source at the top (the places of the dark header). */
export function parchmentHeader(c: MotionCtx, look: DocStyle, kicker: string | undefined, title: string, source: string | undefined, rule = true): Part {
  const m = pick(c, 120, 64)
  const kTop = pick(c, 96, 130)
  const tTop = kTop + (kicker ? pick(c, 42, 44) : 0)
  const srcLine = source ? (SOURCE_RE.test(source) ? source : `SOURCE: ${source}`) : ''
  const ruleTop = tTop + pick(c, 84, 88)
  return {
    css: `${PAPER_CSS}
.doc{position:absolute;inset:0;overflow:hidden;background:${PARCH.paper};color:${PARCH.ink};font-family:${FONT.serif}}
.doc .kick{position:absolute;left:${m}px;top:${kTop}px;font-weight:600;font-size:${pick(c, 22, 24)}px;letter-spacing:.26em;text-transform:uppercase;color:${look.accent};white-space:nowrap;overflow:hidden;max-width:${c.width - 2 * m}px}
.doc .ttl{position:absolute;left:${m}px;top:${tTop}px;font-weight:600;font-size:${pick(c, 58, 64)}px;line-height:1.15;letter-spacing:.01em;color:${PARCH.ink};white-space:nowrap;overflow:hidden;max-width:${pick(c, c.width - 2 * m - 420, c.width - 2 * m)}px;padding-bottom:6px}
.doc .srcl{position:absolute;right:${m}px;top:${pick(c, kTop - 2, 62)}px;font-style:italic;font-weight:400;font-size:${pick(c, 22, 21)}px;letter-spacing:.06em;font-variant-caps:all-small-caps;color:${PARCH.muted};white-space:nowrap;overflow:hidden;max-width:${pick(c, 420, c.width - 2 * m)}px}
.doc .hr{position:absolute;left:${m}px;width:${c.width - 2 * m}px;transform-origin:left center}
.doc .hr.d{height:5px;border-top:2px solid ${PARCH.ink};border-bottom:1px solid ${PARCH.ink}}
.doc .hr.s{height:1px;background:rgba(43,33,24,.34)}`,
    body: `<div class="doc"><div class="pbg"></div>${paperTexture(c)}<div class="pvig"></div>
${kicker ? `<div class="kick" data-fit="14" data-anim="rise" data-at="0.2" data-dur="0.4" data-dy="14">${esc(typo(kicker))}</div>` : ''}
<div class="ttl" data-fit="26" data-anim="rise" data-at="0.3" data-dur="0.5" data-dy="18">${esc(typo(title))}</div>
${srcLine ? `<div class="srcl" data-fit="12" data-anim="fade" data-at="0.4" data-dur="0.5">${esc(typo(srcLine))}</div>` : ''}
${rule ? `<div class="hr d" style="top:${ruleTop}px" data-anim="wipe" data-at="0.35" data-dur="0.7" data-ease="linear"></div>` : ''}`
    // the closing tag of .doc is added by the card, after its own parts
  }
}

/** The hatched ink of a bar (thin diagonal strokes inside a thin ink outline), or a solid wash in the accent with light strokes for the accent row. */
export const hatchedBar = (accent: boolean, look: DocStyle): string =>
  accent
    ? `background:repeating-linear-gradient(135deg,rgba(246,237,214,.42) 0 1.3px,transparent 1.3px 6px),${look.accent};border:1.5px solid ${PARCH.ink}`
    : `background:repeating-linear-gradient(135deg,${PARCH.ink} 0 1.4px,transparent 1.4px 6px),rgba(43,33,24,.1);border:1.5px solid ${PARCH.ink}`

// ---- the archive frames -------------------------------------------------------------------------------------------------------------------

/** The caption box of a picture on the parchment: a paper label with a thin ink double outline, ink serif title, muted italic second line. */
export function parchmentCaption(label: string, sub: string | undefined, left: number, top: number, maxW: number, c: MotionCtx): Part {
  return {
    css: `
.cap{position:absolute;left:${left}px;top:${top}px;max-width:${maxW}px;background:rgba(246,237,214,.95);border:1px solid ${PARCH.ink};outline:1px solid rgba(43,33,24,.55);outline-offset:3px;padding:${pick(c, 14, 12)}px ${pick(c, 26, 20)}px ${pick(c, 17, 14)}px;box-shadow:0 8px 20px rgba(40,24,6,.34)}
.cap .t{font-family:${FONT.serif};font-weight:600;font-size:${pick(c, 34, 32)}px;line-height:1.2;color:${PARCH.ink};white-space:nowrap;overflow:hidden;padding-bottom:2px}
.cap .s{font-family:${FONT.serif};font-style:italic;font-weight:400;font-size:${pick(c, 21, 19)}px;line-height:1.3;color:${PARCH.muted};margin-top:3px;white-space:nowrap;overflow:hidden}`,
    body: `<div class="cap" data-anim="wipe" data-at="0.25" data-dur="0.55"><div class="t" data-fit="20">${esc(typo(label))}</div>${sub ? `<div class="s" data-fit="13">${esc(typo(sub))}</div>` : ''}</div>`
  }
}
