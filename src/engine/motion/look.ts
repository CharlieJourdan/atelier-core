// The look of a video's motion graphics (docs/ENGINE-SPEC.md §25.4): the style gives `motion.render` the period, palette and texture of its
// film, so a chart in a film about 1637 is drawn in ink on paper, not as a dashboard. A preset (`modern`, `period`, `newsprint`) or an object
// that starts from one and overrides a few fields. `modern` is the templates' own look, exactly as without a look. The paper looks change the
// templates that have a look choice (kinetic, chart, and the documentary cards, which take their parchment variant); the other overlays keep
// their own `theme`.
import { z } from 'zod'
import { contrast } from './base'
import { FONT } from './doc-common'
import { PARCH } from './doc-parchment'

export const LOOK_PRESETS = ['modern', 'period', 'newsprint'] as const
export const LOOK_TYPES = ['sans', 'condensed', 'serif'] as const
export const LOOK_TEXTURES = ['none', 'paper', 'grain'] as const

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
/** The colours of a paper look: the page, the ink of every line and text, the one accent (stressed words, the story's part), the quiet text. */
export const LookPalette = z.object({ paper: hex, ink: hex, accent: hex, muted: hex }).partial().strict()

export const MotionLookObject = z
  .object({
    preset: z.enum(LOOK_PRESETS),
    palette: LookPalette.optional(),
    /** The face of titles, kinetic words and big numbers: a serif (Instrument Serif), a condensed sans (Oswald) or Inter. */
    type: z.enum(LOOK_TYPES).optional(),
    /** The paper's texture: fibres, stains and grain (`paper`), a fine grain only (`grain`), or a flat page. */
    texture: z.enum(LOOK_TEXTURES).optional()
  })
  .strict()
  .superRefine((l, ctx) => {
    if (l.preset === 'modern' && (l.palette || l.type || l.texture)) ctx.addIssue({ code: 'custom', path: ['preset'], message: 'the modern look draws each template in its own colours; a palette, type or texture needs period or newsprint' })
  })
/** What a style gives `motion.render` (param `look`): a preset name, or a preset with overrides. */
export const MotionLook = z.union([z.enum(LOOK_PRESETS), MotionLookObject])
export type MotionLook = z.input<typeof MotionLook>

/** A paper look, every field decided: what the templates read. */
export interface PaperLook {
  preset: 'period' | 'newsprint'
  paper: string
  /** The paper a little darker (the gradient's far corner) and a little lighter (a label laid on the page). */
  paperDeep: string
  tag: string
  ink: string
  accent: string
  muted: string
  type: (typeof LOOK_TYPES)[number]
  texture: (typeof LOOK_TEXTURES)[number]
}

const PRESETS: Record<PaperLook['preset'], Omit<PaperLook, 'paperDeep' | 'tag'>> = {
  // an engraving or a 17th-century print: iron-gall ink on ivory paper, a deep red-brown, a serif
  period: { preset: 'period', paper: PARCH.paper, ink: PARCH.ink, accent: PARCH.brown, muted: PARCH.muted, type: 'serif', texture: 'paper' },
  // a newspaper page: grey paper, black ink, a press red, condensed headline type
  newsprint: { preset: 'newsprint', paper: '#e4e2dc', ink: '#161616', accent: '#b3261e', muted: '#55524c', type: 'condensed', texture: 'grain' }
}

const toRgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const toHex = (rgb: readonly number[]): string => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
/** `a` mixed toward `b` by k (0..1). */
export const mix = (a: string, b: string, k: number): string => {
  const x = toRgb(a)
  const y = toRgb(b)
  return toHex(x.map((v, i) => v + ((y[i] as number) - v) * k))
}
/** `rgba()` of a colour. */
export const rgba = (h: string, a: number): string => `rgba(${toRgb(h).join(',')},${a})`
/** `colour` pulled toward the ink until it reads on the paper (4.5:1). */
function readable(colour: string, ink: string, paper: string): string {
  let out = colour
  for (let k = 1; k <= 20 && contrast(out, paper) < 4.5; k++) out = mix(colour, ink, k * 0.05)
  return out
}

/** The paper look a style asked for, or null for the templates' own look (no look, or `modern`): then every page is as it always was. */
export function resolveLook(input: MotionLook | undefined): PaperLook | null {
  if (input === undefined) return null
  const l = MotionLook.parse(input)
  const o = typeof l === 'string' ? { preset: l } : l
  if (o.preset === 'modern') return null
  const base = PRESETS[o.preset]
  const pal = 'palette' in o ? (o.palette ?? {}) : {}
  const paper = pal.paper ?? base.paper
  const ink = pal.ink ?? base.ink
  const own = paper === PARCH.paper
  return {
    ...base,
    paper,
    ink,
    paperDeep: own && o.preset === 'period' ? PARCH.paperDeep : mix(paper, ink, 0.07),
    tag: own && o.preset === 'period' ? PARCH.tag : mix(paper, '#ffffff', 0.38),
    accent: readable(pal.accent ?? base.accent, ink, paper),
    muted: pal.muted ?? base.muted,
    type: ('type' in o ? o.type : undefined) ?? base.type,
    texture: ('texture' in o ? o.texture : undefined) ?? base.texture
  }
}

/** The templates a look changes (a graphic of another template keeps its cache key). */
export const LOOK_TEMPLATES: ReadonlySet<string> = new Set(['kinetic', 'chart', 'archive', 'map', 'bars', 'timeline', 'document'])

// ---- type --------------------------------------------------------------------------------------------------------------------------------

/** Instrument Serif (OFL): a display serif cut from 17th–18th-century type, for titles, kinetic words and big numbers. */
export const DISPLAY_SERIF = "'Instrument Serif','Source Serif 4','Times New Roman',Georgia,serif"
/** The display face (titles, words, numbers), its weight, and the text face (labels, sources) of a look. */
export function facesOf(l: PaperLook): { display: string; weight: number; text: string } {
  if (l.type === 'serif') return { display: DISPLAY_SERIF, weight: 400, text: FONT.serif }
  if (l.type === 'condensed') return { display: FONT.cond, weight: 700, text: FONT.serif }
  return { display: FONT.sans, weight: 700, text: FONT.sans }
}

// ---- texture ------------------------------------------------------------------------------------------------------------------------------

/**
 * The texture of a look's paper as a transparent SVG that fills its box (width and height 100 %), to lay with `mix-blend-mode:multiply`:
 * fibres, stains and grain (`paper`, warm), a fine neutral grain (`grain`), or nothing. Fixed seeds: the same page, the same texture.
 * `id` keeps the filters of two textures in one page apart.
 */
export function lookTexture(l: PaperLook, cls: string, id: string): string {
  if (l.texture === 'none') return ''
  if (l.texture === 'grain') {
    return `<svg class="${cls}" width="100%" height="100%"><defs><filter id="${id}g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="5" result="c"/><feColorMatrix in="c" values="0 0 0 0 .2  0 0 0 0 .2  0 0 0 0 .2  1.6 0 0 0 -.66"/></filter>
<filter id="${id}m" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".006 .009" numOctaves="3" seed="11" result="d"/><feColorMatrix in="d" values="0 0 0 0 .3  0 0 0 0 .3  0 0 0 0 .3  1.6 0 0 0 -.62"/></filter></defs><rect width="100%" height="100%" filter="url(#${id}g)" opacity=".2"/><rect width="100%" height="100%" filter="url(#${id}m)" opacity=".12"/></svg>`
  }
  return `<svg class="${cls}" width="100%" height="100%"><defs>
<filter id="${id}s" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0042 .0065" numOctaves="4" seed="7" result="a"/><feColorMatrix in="a" values="0 0 0 0 .52  0 0 0 0 .34  0 0 0 0 .14  2.1 0 0 0 -.78"/></filter>
<filter id="${id}f" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".25 .5" numOctaves="3" seed="3" result="b"/><feColorMatrix in="b" values="0 0 0 0 .4  0 0 0 0 .27  0 0 0 0 .13  2.6 0 0 0 -1.15"/></filter>
<filter id="${id}g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="5" result="c"/><feColorMatrix in="c" values="0 0 0 0 .3  0 0 0 0 .2  0 0 0 0 .1  1.5 0 0 0 -.62"/></filter>
</defs><rect width="100%" height="100%" filter="url(#${id}s)" opacity=".22"/><rect width="100%" height="100%" filter="url(#${id}f)" opacity=".16"/><rect width="100%" height="100%" filter="url(#${id}g)" opacity=".16"/></svg>`
}

/** The darker edges of a sheet (a warm brown on paper, a grey on newsprint; none on a flat page). */
export const vignetteOf = (l: PaperLook): string =>
  l.texture === 'none' ? 'none' : `radial-gradient(ellipse 82% 80% at 50% 48%,transparent 52%,${l.texture === 'paper' ? 'rgba(112,74,30,.3)' : rgba(l.ink, 0.16)} 100%)`

/** A whole sheet of the look's paper over the frame (gradient, texture, vignette): the backdrop of a solid slate. */
export function paperSheet(l: PaperLook, cls: string): { css: string; body: string } {
  return {
    css: `
.${cls}{position:absolute;inset:0;overflow:hidden;background:linear-gradient(165deg,${l.paper} 0%,${l.paperDeep} 100%)}
.${cls} .ltx{position:absolute;left:0;top:0;width:100%;height:100%;mix-blend-mode:multiply}
.${cls} .lvg{position:absolute;inset:0;background:${vignetteOf(l)}}`,
    body: `${lookTexture(l, 'ltx', `${cls}t`)}<div class="lvg"></div>`
  }
}
