// P5 (chantier moteur-pipeline, decision 0099): the engine values a Style Definition decides, each a pure function of definition
// fields only. plan-rules.ts SETTING_MAP cites these functions with the fields they read; the compiler (compile.ts) writes them into
// the bricks. Nothing here falls back to a base pipeline's option or brick setting: when a field says nothing (empty, unmeasured),
// the function returns `undefined` and the brick keeps its OWN engine default (never a base pipeline's styling).
import type { StyleDefinition } from '../../../../shared/clone'
import { contrast, luminance } from '../../../../engine/motion/base'
import { PALETTES } from '../../../../engine/motion/pov-kit'
import type { CardStyle } from '../../../../engine/motion/styled'
import { distributionRows, measuredHookShare, measuredMixShares, sharesOfRows } from './values-mix'

const r2 = (n: number): number => Math.round(n * 100) / 100
const r3 = (n: number): number => Math.round(n * 1000) / 1000
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const HEX = /^#[0-9a-fA-F]{6}$/

/** The share of the reference drawn in 2D (with its 3D shots, stood in by drawn scenes when the channel draws). */
export function drawnShareOf(def: StyleDefinition): number {
  const o = def.sourcing.originShares.value
  return (o.drawn ?? 0) + ((o.drawn ?? 0) > 0 ? (o['3d'] ?? 0) : 0)
}

// ---- motion: the channel's card style -----------------------------------------------------------------------------------------------

const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
/** Saturation (HSL) of a colour: the accent is the most saturated colour of the measured palette. */
function saturation(h: string): number {
  const [r, g, b] = rgb(h).map((x) => x / 255) as [number, number, number]
  const hi = Math.max(r, g, b)
  const lo = Math.min(r, g, b)
  const l = (hi + lo) / 2
  return hi === lo ? 0 : (hi - lo) / (1 - Math.abs(2 * l - 1))
}
const mixHex = (a: string, b: string, k: number): string =>
  '#' + rgb(a).map((v, i) => Math.round(v + ((rgb(b)[i] as number) - v) * k).toString(16).padStart(2, '0')).join('')

/** The measured element the cards are drawn after: the most frequent one. */
function mainElement(def: StyleDefinition): StyleDefinition['motion']['elements']['value'][number] | undefined {
  return [...def.motion.elements.value].sort((a, b) => b.perMinute - a.perMinute)[0]
}

/** The face one measured font description names (« serif italic », « rounded sans bold », « bold condensed sans »…). */
export function faceOfFont(font: string): CardStyle['face'] {
  const f = font.toLowerCase()
  if (/condensed|oswald|impact|narrow|bebas/.test(f)) return 'condensed'
  if (/script|cursive|calligraph|handwrit/.test(f) || (/italic/.test(f) && /serif/.test(f) && !/sans/.test(f))) return 'serif-italic'
  if (/serif/.test(f) && !/sans/.test(f)) return 'serif'
  if (/geometric|rounded|montserrat|extra ?bold|black|poppins|gotham/.test(f)) return 'geometric'
  return 'sans'
}

/**
 * The channel's faces from the measured font descriptions: the figures and labels' face, the titles' own face when the reference sets
 * them apart (a font described for « titles » or « headings »), capitals, and a rule under the titles (« underlined »).
 */
export function faceFrom(fonts: readonly string[]): { face: CardStyle['face']; upper: boolean; titleFace?: CardStyle['face']; titleRule?: boolean } {
  const all = fonts.join(' ').toLowerCase()
  const upper = /capital|upper|majuscule/.test(all)
  const isTitle = (f: string): boolean => /title|heading|headline|titre/i.test(f)
  const titleFont = fonts.find(isTitle)
  // the canonical tokens (`capitals`, `underlined`, analysis/canon.ts) say the case and decoration, not a face
  const token = (f: string): boolean => /^(capitals|underlined)$/i.test(f.trim())
  const bodyFont = fonts.find((f) => !isTitle(f) && !token(f)) ?? fonts.find((f) => !token(f)) ?? ''
  const face = faceOfFont(titleFont && bodyFont === titleFont ? all : bodyFont || all)
  const titleFace = titleFont ? faceOfFont(titleFont) : undefined
  const rule = /underlin|soulign/.test(all)
  return { face, upper, ...(titleFace && titleFace !== face ? { titleFace } : {}), ...(rule ? { titleRule: true } : {}) }
}

export function easingFrom(easing: string): CardStyle['easing'] {
  const e = easing.toLowerCase()
  if (/back|overshoot|bounce|spring/.test(e)) return 'back'
  if (/in-?out/.test(e)) return 'inOut'
  if (/linear|none|cut/.test(e)) return 'linear'
  return 'out'
}

export function textureFrom(texture: string): CardStyle['texture'] {
  const t = texture.toLowerCase()
  if (/glass|frost/.test(t)) return 'glass'
  if (/plate/.test(t)) return 'plates'
  if (/glow|neon/.test(t)) return 'glow'
  if (/page|behind|blurred (picture|footage|frame)/.test(t)) return 'page'
  return 'flat'
}

/**
 * The card style of the channel (motion/styled.ts), or undefined when the definition measured no motion element or no palette:
 * then no card is styled and the brick draws nothing in a look the reference does not have (the compiler leaves motion out).
 */
export function cardStyleFrom(def: StyleDefinition): CardStyle | undefined {
  const palette = def.motion.palette.value.filter((c) => HEX.test(c))
  const el = mainElement(def)
  const shares = def.sourcing.originShares.value
  // the palette is the style; without one nothing is styled. Motion measured on screen with no element detail: neutral easing and
  // a flat texture (the engine's plainest, no look of a base), the palette and face still the channel's
  if (palette.length === 0 || (!el && (shares.motion ?? 0) + (shares.drawn ?? 0) <= 0)) return undefined
  const texture = el ? textureFrom(el.texture) : 'flat'
  const byLum = [...palette].sort((a, b) => luminance(a) - luminance(b))
  const bySat = [...palette].sort((a, b) => saturation(b) - saturation(a))
  // words over a blurred page (the picture is the ground): the ground is the page's dark scrim, never a palette colour; otherwise
  // the ground is the palette's darkest colour
  const ground = texture === 'page' ? '#000000' : byLum[0]!
  const accent = bySat.find((c) => c !== ground) ?? bySat[0]!
  // the ink: the palette colour that reads best on the ground; when none reads (4.5:1), white or black — legibility, not a look
  const ink = [...palette.filter((c) => c !== ground && c !== accent)].sort((a, b) => contrast(b, ground) - contrast(a, ground))[0]
  const inkOk = ink && contrast(ink, ground) >= 4.5 ? ink : contrast('#FFFFFF', ground) >= contrast('#111111', ground) ? '#FFFFFF' : '#111111'
  const muted = ink && ink !== inkOk && contrast(ink, ground) >= 3 ? ink : mixHex(inkOk, ground, 0.45)
  // full-screen cards when the reference gives motion design (or drawn scenes) its own screen time; overlays otherwise
  const fullScreen = texture !== 'page' && (shares.motion ?? 0) + (shares.drawn ?? 0) >= 0.03
  return {
    ground,
    ink: inkOk,
    accent,
    muted,
    ...faceFrom(def.motion.fonts.value),
    easing: el ? easingFrom(el.easing) : 'out',
    texture,
    fullScreen,
    // a card that lasts 2.8 s lands in ≈ 0.4 s, one of 11 s in ≈ 0.9 s (capped by the brick)
    landShare: r3(clamp(1.1 / Math.max(1, el?.durationS ?? 4), 0.05, 0.4))
  }
}

/** The motion brick's share of the screen: what the reference gives motion design (and drawn scenes), within the director's
 *  0.02..0.8 (a reference with rare cards, the Japanese Method's 0.6 %, gets the director's smallest share). */
export function motionShareFrom(def: StyleDefinition): number {
  const s = def.sourcing.originShares.value
  return r3(clamp((s.motion ?? 0) + (s.drawn ?? 0), 0.02, 0.8))
}

// ---- presenter: layouts and angles --------------------------------------------------------------------------------------------------

type Part = StyleDefinition['presenter']['layoutCurve']['value'][number]
const LAYOUT_OF: Record<string, 'full' | 'split' | 'pip' | null> = { full: 'full', 'half-left': 'split', 'half-right': 'split', inset: 'pip', off: null }

/** One part's on-screen layout shares (full / split / pip) among the presenter's time, or null when he is off all along. */
function sharesOf(p: Part | undefined): { full: number; split: number; pip: number } | null {
  if (!p) return null
  const s = { full: 0, split: 0, pip: 0 }
  for (const [k, v] of Object.entries(p.shares)) {
    const l = LAYOUT_OF[k]
    if (l && v) s[l] += v
  }
  const t = s.full + s.split + s.pip
  if (t <= 0) return null
  const out = { full: r3(s.full / t), split: r3(s.split / t), pip: 0 }
  out.pip = r3(1 - out.full - out.split)
  return out
}

/** The video's length the plan is made for, in seconds (the passage of P6 or the example of P9 both scale on it). */
export const planSeconds = (minutes: number): number => Math.max(30, Math.round(minutes * 60))

/**
 * The reference videos' length, in minutes, from two measures: the hook window (seconds) is the hook part's share of the video. (On the
 * acceptance channels: Marcel 49 s / 6.4 % = 12.8 min, his videos run 13; Monde en POV 25 s / 3 % = 13.9, they run 9–15.) Within 0.5–30.
 */
export function referenceMinutesFrom(def: StyleDefinition): number {
  const hook = def.script.parts.value.find((p) => /hook|accroche|intro/i.test(p.name))
  const s = hook && hook.share > 0 ? def.script.hookWindowS.value / hook.share : 600
  return r2(clamp(s / 60, 0.5, 30))
}

/** The share of the video the end part takes (its measured share in the script grammar; 0 when no end part was measured). */
function endShareOf(def: StyleDefinition): number {
  const parts = def.script.parts.value
  const last = parts[parts.length - 1]
  return last && /end|outro|conclu|fin/i.test(last.name) ? last.share : 0
}

/**
 * director.plan's `presenterLayouts` from the measured per-part layout curve: full frame through the hook, the body's shares after
 * it, the end's shares in its last seconds; the side of a split as measured. undefined when the presenter has no layout curve.
 */
export function presenterLayoutsFrom(def: StyleDefinition, minutes = referenceMinutesFrom(def)): Record<string, unknown> | undefined {
  const curve = def.presenter.layoutCurve.value
  const body = sharesOf(curve.find((p) => p.part === 'body')) ?? sharesOf(curve.find((p) => p.part !== 'hook'))
  if (!body) return undefined
  const hook = sharesOf(curve.find((p) => p.part === 'hook'))
  const hookS = Math.max(0, def.script.hookWindowS.value)
  const sides = curve.flatMap((p) => Object.keys(p.shares).filter((k) => k.startsWith('half-') && (p.shares as Record<string, number>)[k]! > 0))
  const side = sides.includes('half-left') && sides.includes('half-right') ? 'alternate' : sides.includes('half-right') ? 'right' : sides.length ? 'left' : undefined
  const end = sharesOf(curve.find((p) => p.part === 'end'))
  const endS = Math.round(endShareOf(def) * planSeconds(minutes))
  return {
    fromS: hook && hook.full < 0.99 ? 0 : hookS,
    ...body,
    ...(side ? { presenterSide: side } : {}),
    ...(end && endS >= 5 ? { outro: { lastS: clamp(endS, 5, 300), ...end } } : {})
  }
}

/** The layouts the director may use: the measured configurations' layouts (full / split / pip). */
export function layoutsFrom(def: StyleDefinition): ('full' | 'split' | 'pip')[] | undefined {
  const ls = [...new Set(def.presenter.configurations.value.map((c) => LAYOUT_OF[c.layout]).filter((l): l is 'full' | 'split' | 'pip' => !!l))]
  return ls.length ? ls.sort() : undefined
}

/** avatar.speak's framing: the measured angles switched (`multi`), or the one angle. */
export const framingFrom = (def: StyleDefinition): 'single' | 'multi' => (def.presenter.angleCount.value > 1 ? 'multi' : 'single')

/** avatar.speak's `presenter`: the placeholder's portrait and one picture per measured angle, as references the run resolves
 *  (`placeholder:<ref>/<angle>`), or undefined for the user's own presenter (the channel's style carries his pictures). */
export function presenterRefFrom(def: StyleDefinition): { id: string; portrait: string; angles: { framing: 'wide' | 'medium' | 'close'; file: string }[]; registrations: Record<string, string> } | undefined {
  const ref = def.presenter.presenterRef.value
  const spec = def.presenter.placeholder.value
  if (!ref || !spec || def.presenter.mode.value !== 'look-alike-placeholder') return undefined
  const seen = new Set<string>(['medium'])
  const angles = spec.angles.filter((a) => !seen.has(a.framing) && seen.add(a.framing)).slice(0, 6)
  return { id: ref.slice(0, 100), portrait: `${ref}/portrait.png`, angles: angles.map((a) => ({ framing: a.framing, file: `${ref}/angle-${a.angle}.png` })), registrations: {} }
}

// ---- the mix of screen time -----------------------------------------------------------------------------------------------------------

type Shares = Partial<Record<'presenter' | 'clipAi' | 'imageAi' | 'stock' | 'archive' | 'userFootage' | 'motion', number>>

/** The screen-time shares of the engine's mix from the measured origins: a filmed slot is stood in by FOUND footage, 3D by drawn
 *  scenes when the channel draws (else nothing), generated pictures move only when the reference's camera moves. */
export function mixSharesFrom(def: StyleDefinition): Shares {
  const o = def.sourcing.originShares.value
  const moving = def.editing.cameraMoves.value.some((m) => !/still|none|static/i.test(m))
  const archive = /archive|period|histor/i.test(def.sourcing.illustrationStyle.value)
  // the presenter's share is his measured time on screen (every layout but off), never less than the shots labelled « presenter »;
  // what it adds comes out of the filmed share first (his other angles were read « filmed »: Finary 30 % vs 55 % on screen)
  const talk = def.presenter.talkSecondsPerMinute.source !== 'default' ? clamp(def.presenter.talkSecondsPerMinute.value / 60, 0, 1) : 0
  const presenter = Math.max(o.presenter ?? 0, talk)
  const lift = presenter - (o.presenter ?? 0)
  const filmed = Math.max(0, (o.filmed ?? 0) - lift)
  const raw: Shares = {
    presenter,
    motion: (o.motion ?? 0) + (o.drawn ?? 0) + ((o.drawn ?? 0) > 0 ? (o['3d'] ?? 0) : 0),
    clipAi: moving ? (o.generated ?? 0) : 0,
    imageAi: moving ? 0 : (o.generated ?? 0),
    stock: (archive ? 0 : (o.found ?? 0)) + filmed + (o.screen ?? 0),
    archive: archive ? (o.found ?? 0) : 0
  }
  const total = Object.values(raw).reduce((a, b) => a + (b ?? 0), 0)
  // nothing measured: no mix (the director's own), never a mix no field says
  if (total <= 0) return {}
  const out: Shares = {}
  for (const [k, v] of Object.entries(raw) as [keyof Shares, number][]) if (v > 0) out[k] = r3(v / total)
  // rounding: the largest share takes the remainder so the row adds to 1
  const keys = Object.keys(out) as (keyof Shares)[]
  const big = keys.sort((a, b) => (out[b] ?? 0) - (out[a] ?? 0))[0]!
  out[big] = r3((out[big] ?? 0) + 1 - keys.reduce((a, k) => a + (out[k] ?? 0), 0))
  return out
}

/**
 * The mix's curve over time. From the MEASURED distributions of every element along the video (values-mix.ts distributionRows: the
 * hook's and each tenth's shares of the presenter, the generated clips and stills, found footage, motion design) when the definition
 * has them; otherwise from the presenter's measured presence per part (hook, body, end), the other kinds sharing the rest in their
 * overall proportions. A flat curve when neither was measured. A hook row only from a measured hook (never the 15 s default).
 */
export function mixCurveFrom(def: StyleDefinition, minutes = referenceMinutesFrom(def)): 'flat' | { fromS: number; shares: Shares }[] {
  const measured = distributionRows(def, minutes)
  if (measured) return measured
  const base = mixSharesFrom(def)
  const presence = def.presenter.presenceByPart.value
  if (!base.presenter || presence.length === 0) return 'flat'
  const others = Object.entries(base).filter(([k]) => k !== 'presenter') as [keyof Shares, number][]
  const otherSum = others.reduce((a, [, v]) => a + v, 0)
  const row = (p: number): Shares => {
    const s: Shares = { presenter: r3(p) }
    if (otherSum > 0) for (const [k, v] of others) s[k] = r3(((1 - p) * v) / otherSum)
    else s.presenter = 1
    const sum = Object.values(s).reduce((a, b) => a + (b ?? 0), 0)
    const big = (Object.keys(s) as (keyof Shares)[]).sort((a, b) => (s[b] ?? 0) - (s[a] ?? 0))[0]!
    s[big] = r3((s[big] ?? 0) + 1 - sum)
    return s
  }
  const at = (part: string): number | undefined => presence.find((p) => p.part === part)?.share
  const total = planSeconds(minutes)
  // the hook's end only from a measure: the measured window, else the measured hook part's share of the planned length
  const share = measuredHookShare(def, total)
  const hookAt = def.script.hookWindowS.source !== 'default' ? def.script.hookWindowS.value : share !== undefined ? Math.round(share * total) : undefined
  const hookS = hookAt !== undefined ? Math.min(total - 1, Math.max(1, hookAt)) : undefined
  const rows = hookS !== undefined
    ? [{ fromS: 0, shares: row(at('hook') ?? base.presenter) }, { fromS: hookS, shares: row(at('body') ?? base.presenter) }]
    : [{ fromS: 0, shares: row(at('body') ?? base.presenter) }]
  const endS = Math.round(total * (1 - endShareOf(def)))
  if (at('end') !== undefined && endS > (hookS ?? 0) + 1 && endS < total) rows.push({ fromS: endS, shares: row(at('end')!) })
  return rows
}

/** recipe.mix: the overall shares and the curve. With measured distributions, the shares are the measured rows' own average (the
 *  engine's fitting then keeps the rows as measured); else values' mixSharesFrom. Null when nothing was measured. */
export function mixFrom(def: StyleDefinition, minutes = referenceMinutesFrom(def)): (Shares & { curve: ReturnType<typeof mixCurveFrom> }) | null {
  const rows = distributionRows(def, minutes)
  if (rows) {
    const shares = sharesOfRows(rows, minutes)
    return Object.keys(shares).length ? { ...shares, curve: rows } : null
  }
  const base = mixSharesFrom(def)
  return Object.keys(base).length ? { ...base, curve: mixCurveFrom(def, minutes) } : null
}

/** The kinds the bricks must make: the measured rows' shares when the distributions were measured, else mixSharesFrom. */
export function mixOf(def: StyleDefinition): Shares {
  return measuredMixShares(def, referenceMinutesFrom(def)) ?? mixSharesFrom(def)
}

// ---- editing, sound, voice, look ------------------------------------------------------------------------------------------------------

/** Cuts a minute from the measured mean shot (director.plan's `cpm`, 4–40). */
export const cpmFrom = (def: StyleDefinition): number => r2(clamp(60 / Math.max(0.5, def.editing.meanShotS.value), 4, 40))

/** The director's lead on the word: the measured landing before the word (illustrationLeadS < 0), within 0..0.5 s. */
export const cutLeadFrom = (def: StyleDefinition): number => r2(clamp(-def.editing.illustrationLeadS.value, 0, 0.5))

/** The drawn-scene palette of director.pov nearest to the measured palette (the drawn kit's palettes are measured sets). */
export function povPaletteFrom(def: StyleDefinition): keyof typeof PALETTES | undefined {
  const palette = def.motion.palette.value.filter((c) => HEX.test(c))
  if (palette.length === 0) return undefined
  const dist = (a: string, b: string): number => rgb(a).reduce((s, v, i) => s + (v - (rgb(b)[i] as number)) ** 2, 0)
  let best: { k: keyof typeof PALETTES; d: number } | undefined
  for (const k of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
    const p = PALETTES[k]
    const set = [p.card, p.skyTop, p.skyMid, p.skyLow, p.gold, p.coral, p.colors.hero]
    const d = palette.reduce((s, c) => s + Math.min(...set.map((x) => dist(c, x))), 0)
    if (!best || d < best.d) best = { k, d }
  }
  return best?.k
}

/** The colour grade of filmed or found pictures, from the measured colour words; undefined for a drawn channel (no grade). */
export function gradeFrom(def: StyleDefinition): 'none' | 'warm' | 'cool' | 'film' | 'archive' | undefined {
  const o = def.sourcing.originShares.value
  if ((o.drawn ?? 0) + (o.motion ?? 0) >= 0.5) return undefined
  const c = `${def.editing.colour.value} ${def.sourcing.grade.value}`.toLowerCase()
  if (/black.and.white|b&w|monochrome|noir et blanc|sepia|archive/.test(c)) return 'archive'
  if (/film grain|grain|cinematic/.test(c)) return 'film'
  if (/warm|golden|orange|chaud/.test(c)) return 'warm'
  if (/cool|cold|teal|blue|froid/.test(c)) return 'cool'
  return 'none'
}

/** edit.fx's kit from the measured transitions: the drawn kit (blur smear, dip) only for a drawn channel whose reference has those
 *  transitions; undefined (no edit.fx brick) for hard cuts only or any other transition no kit was measured for. */
export function editKitFrom(def: StyleDefinition): 'pov2d' | undefined {
  const t = def.editing.transitions.value.join(' ').toLowerCase()
  return drawnShareOf(def) >= 0.5 && /blur|smear|dip|whip/.test(t) ? 'pov2d' : undefined
}

/** The longest pause kept in the voice: twice the measured mean pause, within the brick's 0.2–3 s. */
export const maxPauseFrom = (def: StyleDefinition): number => r2(clamp(def.voice.meanPauseS.value * 2, 0.2, 3))

/** The voice to speak with: the definition's reference when it names an engine voice (a placeholder or the user's own clone ref
 *  is resolved by the channel's style at run time: `$style.voice`). */
export function voiceFrom(def: StyleDefinition): string | undefined {
  const v = def.voice.voiceRef.value
  return v && !/^(placeholder|own-)/.test(v) && v.length <= 100 ? v : undefined
}

/** The language the video is written and voiced in (the definition's voice language, else the channel's). */
export const languageFrom = (def: StyleDefinition): string | null => {
  const l = (def.voice.language.value || def.channel.language || '').trim()
  return /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(l) ? l : null
}

/** The music bed's level under the voice, within the brick's −40..0 dB; null when the reference has no music (no bed to set). */
export const bedDbFrom = (def: StyleDefinition): number | null => (def.sound.music.value ? r2(clamp(def.sound.musicLevelUnderVoiceDb.value, -40, 0)) : null)

/** script.write@2's call to action: none, or at the end (the measured CTA). */
export const ctaModeFrom = (def: StyleDefinition): 'none' | 'end' => (def.script.cta.value.trim() ? 'end' : 'none')

/** The drawn places' depth (moteur-briques): `deep` when at least a quarter of the measured pictures have depth of field. */
export function povDepthFrom(def: StyleDefinition): 'deep' | undefined {
  // a quarter of the pictures with depth of field is already the channel's look (a flat channel measures ~0)
  return def.sourcing.depthShare.value >= 0.25 ? 'deep' : undefined
}

/** The first-person hand shots' share for the drawn director, when the reference has some (≥ 2 % of its screen time). */
export function handShareFrom(def: StyleDefinition): number | undefined {
  const v = def.sourcing.povShare.value
  return v >= 0.02 ? r3(clamp(v, 0, 0.8)) : undefined
}

/** The drawn cards' type from the measured fonts (face, capitals, an underline) and the palette's accent; undefined when no
 *  font was measured (the kit keeps its own). */
export function povTypeFrom(def: StyleDefinition): { face: CardStyle['face']; upper: boolean; titleRule: boolean; accent?: string } | undefined {
  const fonts = def.motion.fonts.value.filter((f) => f.trim())
  if (fonts.length === 0) return undefined
  const f = faceFrom(fonts)
  const accent = cardStyleFrom(def)?.accent
  return { face: f.titleFace ?? f.face, upper: f.upper, titleRule: f.titleRule === true, ...(accent ? { accent } : {}) }
}

/** The look every generated picture carries: the reference's measured line, only when it generates (≥ 2 % of its screen time). */
export function generatedLookFrom(def: StyleDefinition): { style: string; suffix: string } | undefined {
  const line = def.sourcing.generatedLook.value.trim()
  if (!line || (def.sourcing.originShares.value.generated ?? 0) < 0.02) return undefined
  return { style: 'clone-measured', suffix: line.slice(0, 1000) }
}
