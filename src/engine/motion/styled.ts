// The channel-styled card family (chantier moteur-pipeline, decision 0099): the motion cards of a cloned channel drawn in ITS measured
// style — its palette (ground, ink, accent, muted), its type face, its easing, its texture (flat, glass panels, blurred colour plates, a
// night glow, a blurred page behind) and its card coverage (a full-screen card or an overlay on the picture). The templates' own look
// (`modern`: a blue accent on a dark panel) is a base default; a clone never shows it unless its reference measured the same thing. The
// style is DATA the pipeline compiler computes from the Style Definition (src/main/production/clone/pipeline/), never chosen here.
// Pure strings, same runtime and clock as every motion page (runtime.ts).
import { z } from 'zod'
import { contrast, readableOn, type MotionCtx } from './base'
import { RUNTIME_JS } from './runtime'

/** Bump when a styled card's look changes: it is part of the render cache key. */
export const STYLED_VERSION = 2

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/** `serif-italic`: a display serif in italics (Instrument Serif), the « Histoire 1 » titles of a finance channel (moteur-briques). */
export const STYLED_FACES = ['sans', 'condensed', 'serif', 'geometric', 'serif-italic'] as const
export const STYLED_EASINGS = ['out', 'inOut', 'linear', 'back'] as const
export const STYLED_TEXTURES = ['flat', 'glass', 'plates', 'glow', 'page'] as const
/** The templates this family draws (the others keep their own drawing). */
export const STYLED_TEMPLATES = ['title', 'figure', 'list', 'quote', 'lower-third', 'kinetic', 'chart'] as const
export type StyledTemplate = (typeof STYLED_TEMPLATES)[number]

export const CardStyle = z
  .object({
    /** The card's ground (a full-screen card) or panel colour. */
    ground: hex,
    /** Text and lines. */
    ink: hex,
    /** The one stressed colour (numbers, bars, the stressed word). */
    accent: hex,
    /** Quiet text (labels, sources). */
    muted: hex,
    face: z.enum(STYLED_FACES),
    /** Titles and kinetic words in capitals (measured « capitals »). */
    upper: z.boolean().default(false),
    /** The titles' own face when the reference sets them apart from its figures and labels (moteur-briques); absent: `face`. */
    titleFace: z.enum(STYLED_FACES).optional(),
    /** A short accent rule under each title (« a title underlined »), measured. */
    titleRule: z.boolean().optional(),
    easing: z.enum(STYLED_EASINGS),
    texture: z.enum(STYLED_TEXTURES),
    /** true: the card fills the frame (its own ground); false: a panel laid over the picture. */
    fullScreen: z.boolean(),
    /** The measured share of the card's length its elements take to land (0.05–0.5): fast cards land in a few frames. */
    landShare: z.number().min(0.03).max(0.6).default(0.15)
  })
  .strict()
export type CardStyle = z.infer<typeof CardStyle>

export const isStyledTemplate = (t: string): t is StyledTemplate => (STYLED_TEMPLATES as readonly string[]).includes(t)

/** The face's CSS family, weight and style (the bundled faces only: Inter, Oswald, Source Serif 4, Montserrat ExtraBold, Instrument
 *  Serif). */
export function faceOf(s: Pick<CardStyle, 'face'>): { family: string; weight: number; style?: 'italic' } {
  switch (s.face) {
    case 'serif-italic':
      return { family: "'Instrument Serif','Source Serif 4',Georgia,serif", weight: 400, style: 'italic' }
    case 'condensed':
      return { family: "'Oswald','Inter',sans-serif", weight: 700 }
    case 'serif':
      return { family: "'Source Serif 4',Georgia,serif", weight: 600 }
    case 'geometric':
      return { family: "'Montserrat','Inter',sans-serif", weight: 800 }
    default:
      return { family: "'Inter','Segoe UI',Arial,sans-serif", weight: 700 }
  }
}

/** The ink kept readable on the ground (4.5:1): the measured ink when it reads, else the ground pushed until it does. */
export function readableInk(s: Pick<CardStyle, 'ground' | 'ink'>): { ground: string; ink: string } {
  return contrast(s.ink, s.ground) >= 4.5 ? { ground: s.ground, ink: s.ink } : { ground: readableOn(s.ground, s.ink), ink: s.ink }
}

const toRgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
export const rgbaOf = (h: string, a: number): string => `rgba(${toRgb(h).join(',')},${a})`

/** The background layer of a texture (behind the panel). Full screen: the ground and its texture; overlay: only what the texture puts behind. */
function backdrop(s: CardStyle): string {
  const ground = s.fullScreen ? `background:${s.ground};` : ''
  switch (s.texture) {
    case 'glass':
      return `.bg{position:absolute;inset:0;${ground}}
.bg::before{content:'';position:absolute;left:-10%;top:-20%;width:70%;height:90%;border-radius:50%;background:radial-gradient(circle,${rgbaOf(s.accent, 0.28)},transparent 70%)}
.bg::after{content:'';position:absolute;right:-12%;bottom:-25%;width:65%;height:85%;border-radius:50%;background:radial-gradient(circle,${rgbaOf(s.muted, 0.18)},transparent 70%)}`
    case 'plates':
      return `.bg{position:absolute;inset:0;${ground}}
.bg::before{content:'';position:absolute;left:6%;top:12%;width:46%;height:60%;border-radius:48px;background:${rgbaOf(s.accent, 0.22)};filter:blur(60px)}
.bg::after{content:'';position:absolute;right:4%;bottom:6%;width:42%;height:54%;border-radius:48px;background:${rgbaOf(s.muted, 0.26)};filter:blur(70px)}`
    case 'glow':
      return `.bg{position:absolute;inset:0;${ground}background-image:radial-gradient(ellipse 60% 55% at 50% 45%,${rgbaOf(s.accent, 0.3)},transparent 70%)${s.fullScreen ? `,linear-gradient(180deg,${s.ground},${rgbaOf(s.muted, 0.6)})` : ''}}`
    case 'page':
      // a blurred page behind the words (the picture stays under it, darkened)
      return `.bg{position:absolute;inset:0;${ground}background-color:${s.fullScreen ? s.ground : rgbaOf('#000000', 0.38)};backdrop-filter:blur(18px)}`
    default:
      return `.bg{position:absolute;inset:0;${ground}}`
  }
}

/** The panel a card's content sits on (glass: frosted, with a fine border; others: none on a full-screen card, a plain one over a picture). */
export function panelCss(s: CardStyle): string {
  if (s.texture === 'glass') return `background:${rgbaOf(s.ink, 0.07)};border:1px solid ${rgbaOf(s.ink, 0.18)};border-radius:28px;box-shadow:0 20px 60px rgba(0,0,0,.28)`
  // a full-screen card is its own ground; words over a blurred page sit on the page itself
  if (s.fullScreen || s.texture === 'page') return 'background:transparent'
  return `background:${rgbaOf(s.ground, 0.9)};border-radius:22px;box-shadow:0 16px 50px rgba(0,0,0,.3)`
}

/** The `data-anim` an element lands with, in the measured easing (`back` = a small overshoot: the pop). */
export function landAnim(s: CardStyle, kind: 'rise' | 'fade' | 'left' = 'rise'): string {
  if (s.easing === 'back') return `data-anim="${kind === 'fade' ? 'fade' : 'pop'}" data-ease="back"`
  return `data-anim="${kind}" data-ease="${s.easing}"`
}

/** How long an element takes to land, from the card's length and the measured landing share. */
export const landS = (s: CardStyle, c: MotionCtx): number => Math.min(0.9, Math.max(0.12, c.durationS * s.landShare))

/** The whole page of a styled card. */
export function styledPage(c: MotionCtx, s: CardStyle, css: string, body: string): string {
  const { ground, ink } = readableInk(s)
  const face = faceOf(s)
  const tface = faceOf({ face: s.titleFace ?? s.face })
  // the titles in their own face (and a short accent rule under them) when the reference measured it
  const titles = `.ttl,.hd,.ct,.kw .ln,.lt .nm{font-family:var(--tface);font-weight:var(--tweight);font-style:var(--tstyle)}${
    s.titleRule ? `
.ttl::after,.hd::after,.ct::after{content:'';display:block;width:72px;height:4px;margin-top:16px;border-radius:2px;background:var(--accent)}` : ''
  }`
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>styled</title><style>
${c.fontCss}
:root{--ground:${ground};--ink:${ink};--accent:${s.accent};--muted:${s.muted};--face:${face.family};--weight:${face.weight};--tface:${tface.family};--tweight:${tface.weight};--tstyle:${tface.style ?? 'normal'}}
html,body{margin:0;padding:0;width:${c.width}px;height:${c.height}px;overflow:hidden;background:transparent}
*{box-sizing:border-box}
body{position:relative;font-family:var(--face);font-weight:var(--weight);font-style:${face.style ?? 'normal'};color:var(--ink);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
[data-anim]{opacity:0;will-change:auto}
.up{text-transform:${s.upper ? 'uppercase' : 'none'}}
.panel{${panelCss(s)}}
${titles}
${backdrop(s)}
${css}
</style></head><body>
<div class="bg"${s.fullScreen ? '' : ` data-anim="fade" data-at="0" data-dur="${landS(s, c).toFixed(2)}"`}></div>
${body}
<script>${RUNTIME_JS}</script>
</body></html>`
}

/** Does this style need the display serif (Instrument Serif) on its page? */
export const needsDisplaySerif = (s: CardStyle | undefined): boolean => s !== undefined && (s.face === 'serif-italic' || s.titleFace === 'serif-italic')
