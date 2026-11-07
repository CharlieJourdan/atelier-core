// The drawing kit of the POV cards (formats/pov.ts, research note style-monde-pov-2026-11 (old repository)): the palettes measured on the reference,
// the stick-figure cast (round black head, thin black limbs, a coloured hoodie), the face close-up with its expressions, the navy
// blueprint card ground, bill confetti and rain. Everything is SVG in a 1920 × 1080 world (a tall page crops its middle). Pure strings.
import type { PovColor, PovExpression, PovFigures, PovHair, PovPalette, PovPerson, PovPose } from '../formats/pov'
import { seeded } from './base'

export const W = 1920
export const H = 1080

export interface Pal {
  skyTop: string
  skyMid: string
  skyLow: string
  sun: string
  wall: string
  wallDark: string
  floor: string
  bld: string
  bldDark: string
  win: string
  card: string
  grid: string
  gold: string
  coral: string
  green: string
  muted: string
  rim: string
  colors: Record<PovColor, string>
}

const CAST = { red: '#e8552f', purple: '#8b5cf6', green: '#3fae5a', blue: '#3b82f6', pink: '#e86fa6', grey: '#8b8fa3', yellow: '#f2c230' }

/** Visual estimates on the reference frames (A, C, D, F, G): dusk violet → orange, night blue, blue monochrome, a warm day. */
export const PALETTES: Record<PovPalette, Pal> = {
  dusk: {
    skyTop: '#1d1530', skyMid: '#5b3f86', skyLow: '#f2a65a', sun: '#ffe2b0', wall: '#3a2a33', wallDark: '#281d25', floor: '#2b2029',
    bld: '#2a2140', bldDark: '#1d1730', win: '#f5c86b', card: '#0e1230', grid: 'rgba(130,150,230,0.075)', gold: '#f5c86b', coral: '#ef6a5b',
    green: '#7fbf8e', muted: '#9aa3c7', rim: '#f6c59b', colors: { hero: CAST.red, ...CAST }
  },
  night: {
    skyTop: '#070a1c', skyMid: '#151b42', skyLow: '#3d3878', sun: '#eceaff', wall: '#1d2139', wallDark: '#13162a', floor: '#15182c',
    bld: '#161a35', bldDark: '#0f1226', win: '#f5c86b', card: '#0b1028', grid: 'rgba(130,150,230,0.07)', gold: '#f5c86b', coral: '#ef6a5b',
    green: '#7fbf8e', muted: '#8f98c4', rim: '#aab4ff', colors: { hero: CAST.red, ...CAST }
  },
  blue: {
    skyTop: '#050d26', skyMid: '#0e2862', skyLow: '#2f62c4', sun: '#d6e6ff', wall: '#0f2352', wallDark: '#0a183c', floor: '#0b1a3e',
    bld: '#0c1d48', bldDark: '#081536', win: '#a8c8ff', card: '#071431', grid: 'rgba(140,180,255,0.08)', gold: '#f5c86b', coral: '#ef6a5b',
    green: '#7fbf8e', muted: '#8fa8d8', rim: '#a8c8ff', colors: { hero: CAST.blue, ...CAST, blue: '#60a5fa' }
  },
  day: {
    skyTop: '#5f9fd6', skyMid: '#a9d3ef', skyLow: '#fbe1ad', sun: '#fff6d0', wall: '#6b5a4c', wallDark: '#54463b', floor: '#4d4038',
    bld: '#5d6584', bldDark: '#474e6a', win: '#ffe6a0', card: '#0e1230', grid: 'rgba(130,150,230,0.075)', gold: '#f5c86b', coral: '#ef6a5b',
    green: '#7fbf8e', muted: '#9aa3c7', rim: '#f6c59b', colors: { hero: CAST.red, ...CAST }
  }
}

export const f1 = (n: number): string => (Math.round(n * 10) / 10).toString()
export const f2 = (n: number): string => n.toFixed(2)

/** The page's CSS for every POV card: the faces, the layers, the text styles. */
export const POV_CSS = `
.pov{position:absolute;inset:0;overflow:hidden;font-family:'Montserrat','Inter',sans-serif;font-weight:800;color:#fff}
.pov svg.world{position:absolute;inset:0;width:100%;height:100%}
.pov .layer{position:absolute;inset:0}
.pov .plate{position:absolute;inset:-4%;filter:blur(11px) brightness(.72) saturate(.95)}
.pov .lbl{position:absolute;text-transform:uppercase;letter-spacing:.09em;white-space:nowrap}
.pov .num{white-space:nowrap;letter-spacing:.01em;line-height:1.2}
.pov .glow{text-shadow:0 0 22px rgba(245,200,107,.55),0 0 4px rgba(245,200,107,.35)}
.pov svg *{transform-box:fill-box;transform-origin:center}`

/** An SVG of the 1920 × 1080 world filling the page (a tall page shows its middle). */
export const world = (inner: string, cls = 'world'): string => `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${inner}</svg>`

/** The navy blueprint ground of a data card: a faint grid, a soft vignette and seeded star specks. */
export function cardGround(p: Pal, seed: string): string {
  const rnd = seeded(`${seed}:stars`)
  const stars = Array.from({ length: 70 }, () => `<circle cx="${f1(rnd() * W)}" cy="${f1(rnd() * H)}" r="${f1(0.8 + rnd() * 1.6)}" fill="#fff" opacity="${f2(0.15 + rnd() * 0.45)}"/>`).join('')
  return `<defs><pattern id="g-${seed}" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="${p.grid}" stroke-width="1.5"/></pattern>
<radialGradient id="v-${seed}" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="${p.card}" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="${p.card}"/><rect width="${W}" height="${H}" fill="url(#g-${seed})"/>${stars}<rect width="${W}" height="${H}" fill="url(#v-${seed})"/>`
}

// ---- the cast ---------------------------------------------------------------------------------------------------------------------------

/** The limbs of a pose, in units of the figure's height (origin: the feet, y up is negative). */
interface Rig {
  armL: [number, number, number, number]
  armR: [number, number, number, number]
  legL: [number, number, number, number]
  legR: [number, number, number, number]
  /** The body's lowest point above the feet (a sitting figure is lower), and a lying figure. */
  lift: number
  lying?: boolean
}
const SHOULDER = -0.66
const HIP = -0.36
function rigOf(pose: PovPose, step = 0): Rig {
  const stand: Rig = { armL: [-0.07, SHOULDER, -0.13, -0.38], armR: [0.07, SHOULDER, 0.13, -0.38], legL: [-0.035, HIP, -0.06, 0], legR: [0.035, HIP, 0.06, 0], lift: 0 }
  switch (pose) {
    case 'walk':
      return step % 2 === 0
        ? { ...stand, armL: [-0.07, SHOULDER, -0.15, -0.42], armR: [0.07, SHOULDER, 0.12, -0.36], legL: [-0.03, HIP, -0.13, 0], legR: [0.03, HIP, 0.12, 0] }
        : { ...stand, armL: [-0.07, SHOULDER, -0.1, -0.38], armR: [0.07, SHOULDER, 0.16, -0.42], legL: [-0.03, HIP, -0.02, 0], legR: [0.03, HIP, 0.03, 0] }
    case 'arm-up':
      return { ...stand, armR: [0.07, SHOULDER, 0.17, -0.98] }
    case 'cheer':
      return { ...stand, armL: [-0.07, SHOULDER, -0.19, -0.98], armR: [0.07, SHOULDER, 0.19, -0.98] }
    case 'phone':
      return { ...stand, armR: [0.07, SHOULDER, 0.09, -0.86] }
    case 'point':
      return { ...stand, armR: [0.07, SHOULDER, 0.36, -0.66] }
    case 'sit':
    case 'type':
      return { armL: [-0.06, SHOULDER + 0.16, 0.2, -0.36], armR: [0.07, SHOULDER + 0.16, 0.24, -0.36], legL: [-0.03, HIP + 0.16, 0.2, -0.2], legR: [0.03, HIP + 0.16, 0.22, 0], lift: 0.16 }
    case 'sleep':
      return { ...stand, lying: true }
    default:
      return stand
  }
}

function hairOf(hair: PovHair, cx: number, cy: number, r: number, fill: string): string {
  switch (hair) {
    case 'curly':
      return Array.from({ length: 9 }, (_, i) => {
        const a = Math.PI * (1.05 + (i / 8) * 0.9)
        return `<circle cx="${f1(cx + Math.cos(a) * r * 0.98)}" cy="${f1(cy + Math.sin(a) * r * 0.98)}" r="${f1(r * 0.36)}" fill="#0b0b10"/>`
      }).join('')
    case 'bun':
      return `<circle cx="${f1(cx - r * 0.35)}" cy="${f1(cy - r * 1.05)}" r="${f1(r * 0.42)}" fill="#0b0b10"/>`
    case 'long':
      return `<path d="M${f1(cx - r)} ${f1(cy)} Q${f1(cx - r * 1.25)} ${f1(cy + r * 1.6)} ${f1(cx - r * 0.5)} ${f1(cy + r * 1.7)} L${f1(cx - r * 0.6)} ${f1(cy)}Z" fill="#0b0b10"/>`
    case 'spiky':
      return `<path d="${Array.from({ length: 11 }, (_, i) => {
        const a = Math.PI * (1.12 + (i / 10) * 0.76)
        const k = i % 2 === 0 ? 1.0 : 1.22
        return `${i === 0 ? 'M' : 'L'}${f1(cx + Math.cos(a) * r * k)} ${f1(cy + Math.sin(a) * r * k)}`
      }).join(' ')}Z" fill="#0b0b10"/>`
    case 'cap':
      return `<path d="M${f1(cx - r)} ${f1(cy - r * 0.15)} A${f1(r)} ${f1(r)} 0 0 1 ${f1(cx + r)} ${f1(cy - r * 0.15)} L${f1(cx + r * 1.7)} ${f1(cy - r * 0.05)} L${f1(cx + r * 1.7)} ${f1(cy + r * 0.12)} L${f1(cx - r)} ${f1(cy + r * 0.05)}Z" fill="${fill}"/>`
    default:
      return ''
  }
}

/** One figure of the cast standing on `groundY`, `h` pixels tall (its head about 1/5 of it). `step` alternates a walk's legs.
 *  `look` is the cast's measured drawing (moteur-pov-2): thin all-black silhouettes where only the coloured ones wear a colour, a
 *  light rim outline, faces with a mouth; absent, the kit's own clothed figures. */
export function figure(p: Pick<PovPerson, 'color' | 'pose' | 'hair'>, pal: Pal, x: number, groundY: number, h: number, step = 0, look?: PovFigures): string {
  const black = figureBody(p, pal, x, groundY, h, step, look, null)
  if (!look?.rim) return black
  // the rim: the same figure a little wider in the light behind, the black one over it
  return `<g opacity=".7">${figureBody(p, pal, x, groundY, h, step, look, Math.max(1.5, h * 0.006))}</g>${black}`
}

function figureBody(p: Pick<PovPerson, 'color' | 'pose' | 'hair'>, pal: Pal, x: number, groundY: number, h: number, step: number, look: PovFigures | undefined, rim: number | null): string {
  const rig = rigOf(p.pose, step)
  const dressed = !look || look.body === 'clothed' || look.colour === 'all' || p.color === 'hero'
  const ink = rim !== null ? pal.rim : '#0b0b10'
  const col = rim !== null ? pal.rim : dressed ? pal.colors[p.color] : '#0b0b10'
  const sw = Math.max(2.5, h * 0.03) + (rim ?? 0) * 2
  const y = (v: number): number => groundY + v * h
  if (rig.lying) {
    const r = h * 0.1 + (rim ?? 0)
    return `<g><circle cx="${f1(x - h * 0.42)}" cy="${f1(groundY - r)}" r="${f1(r)}" fill="${ink}"/><rect x="${f1(x - h * 0.32)}" y="${f1(groundY - r * 1.6)}" width="${f1(h * 0.36)}" height="${f1(r * 1.6)}" rx="${f1(r * 0.5)}" fill="${col}"/><line x1="${f1(x + h * 0.04)}" y1="${f1(groundY - r * 0.8)}" x2="${f1(x + h * 0.42)}" y2="${f1(groundY - r * 0.6)}" stroke="${ink}" stroke-width="${f1(sw)}" stroke-linecap="round"/></g>`
  }
  const lift = rig.lift
  const headR = h * 0.105
  const headY = y(-1 + headR / h + lift)
  const neck = y(-0.77 + lift)
  const line = (l: [number, number, number, number]): string =>
    `<line x1="${f1(x + l[0] * h)}" y1="${f1(y(l[1]))}" x2="${f1(x + l[2] * h)}" y2="${f1(y(l[3]))}" stroke="${ink}" stroke-width="${f1(sw)}" stroke-linecap="round"/>`
  const e = rim ?? 0
  // a silhouette's trunk is thin and tapers into the legs (the reference's figures); a clothed one wears a hoodie
  const torso = look?.body === 'silhouette' && !dressed
    ? `<path d="M${f1(x - h * 0.03 - e)} ${f1(neck - e)} L${f1(x + h * 0.03 + e)} ${f1(neck - e)} L${f1(x + h * 0.02 + e)} ${f1(y(-0.36 + lift) + e)} L${f1(x - h * 0.02 - e)} ${f1(y(-0.36 + lift) + e)}Z" fill="${col}" stroke="${col}" stroke-width="${f1(h * 0.012)}" stroke-linejoin="round"/>`
    : look?.body === 'silhouette'
      // the one dressed figure of a silhouette cast wears a hoodie: shoulders, a hood behind the head, ending at the hips
      ? `<path d="M${f1(x - h * 0.07 - e)} ${f1(neck + h * 0.03)} Q${f1(x - h * 0.075 - e)} ${f1(neck - e)} ${f1(x - h * 0.03)} ${f1(neck - e)} L${f1(x + h * 0.03)} ${f1(neck - e)} Q${f1(x + h * 0.075 + e)} ${f1(neck - e)} ${f1(x + h * 0.07 + e)} ${f1(neck + h * 0.03)} L${f1(x + h * 0.06 + e)} ${f1(y(-0.34 + lift) + e)} L${f1(x - h * 0.06 - e)} ${f1(y(-0.34 + lift) + e)}Z" fill="${col}"/><ellipse cx="${f1(x - h * 0.02)}" cy="${f1(neck - h * 0.01)}" rx="${f1(h * 0.06 + e)}" ry="${f1(h * 0.03 + e)}" fill="${col}"/>`
      : `<rect x="${f1(x - h * 0.085 - e)}" y="${f1(neck - e)}" width="${f1(h * 0.17 + 2 * e)}" height="${f1(h * 0.42 + 2 * e)}" rx="${f1(h * 0.05)}" fill="${col}"/>`
  const head = `<circle cx="${f1(x)}" cy="${f1(headY)}" r="${f1(headR + e)}" fill="${ink}"/>`
  // a hoodie's sleeves: the upper half of each arm in its colour, a little thicker (silhouette cast, the one dressed figure)
  const sleeve = (l: [number, number, number, number]): string =>
    `<line x1="${f1(x + l[0] * h)}" y1="${f1(y(l[1]))}" x2="${f1(x + ((l[0] + l[2]) / 2) * h)}" y2="${f1(y((l[1] + l[3]) / 2))}" stroke="${col}" stroke-width="${f1(sw * 2.4)}" stroke-linecap="round"/>`
  const sleeves = look?.body === 'silhouette' && dressed && rim === null ? `${sleeve(rig.armL)}${sleeve(rig.armR)}` : ''
  if (rim !== null) return `<g>${line(rig.legL)}${line(rig.legR)}${torso}${line(rig.armL)}${line(rig.armR)}${head}</g>`
  // the reference's faces stay small and understated: dot eyes, a small mouth (independent judge: « googly eyes »)
  const eyeR = headR * (look?.faces === 'expressive' ? 0.12 : 0.16)
  const eyes = `<circle cx="${f1(x + headR * 0.22)}" cy="${f1(headY - headR * 0.08)}" r="${f1(eyeR)}" fill="#fff"/><circle cx="${f1(x + headR * 0.62)}" cy="${f1(headY - headR * 0.08)}" r="${f1(eyeR)}" fill="#fff"/>`
  // an expressive face: a mouth (a smile, an open « o » when cheering, a flat line when pointing) and pupils that look ahead
  const mouth = look?.faces !== 'expressive'
    ? ''
    : p.pose === 'cheer'
      ? `<ellipse cx="${f1(x + headR * 0.42)}" cy="${f1(headY + headR * 0.45)}" rx="${f1(headR * 0.14)}" ry="${f1(headR * 0.18)}" fill="#fff"/>`
      : p.pose === 'point'
        ? `<line x1="${f1(x + headR * 0.24)}" y1="${f1(headY + headR * 0.45)}" x2="${f1(x + headR * 0.6)}" y2="${f1(headY + headR * 0.45)}" stroke="#fff" stroke-width="${f1(headR * 0.08)}" stroke-linecap="round"/>`
        : `<path d="M${f1(x + headR * 0.18)} ${f1(headY + headR * 0.36)} Q${f1(x + headR * 0.42)} ${f1(headY + headR * 0.62)} ${f1(x + headR * 0.66)} ${f1(headY + headR * 0.36)}" fill="none" stroke="#fff" stroke-width="${f1(headR * 0.08)}" stroke-linecap="round"/>`
  const pupils = ''
  const phone = p.pose === 'phone' ? `<rect x="${f1(x + h * 0.06)}" y="${f1(y(-0.9))}" width="${f1(h * 0.05)}" height="${f1(h * 0.09)}" rx="3" fill="#cfe6ff" opacity=".95"/>` : ''
  return `<g>${line(rig.legL)}${line(rig.legR)}${torso}${line(rig.armL)}${line(rig.armR)}${sleeves}${phone}${head}${hairOf(p.hair, x, headY, headR, pal.colors.yellow)}${eyes}${pupils}${mouth}</g>`
}

/** A crowd of small dark figures (a hall, a stadium, a street), seeded. */
export function crowd(n: number, pal: Pal, groundY: number, h: number, seed: string, x0 = 0.18, x1 = 0.92): string {
  const rnd = seeded(`${seed}:crowd`)
  return Array.from({ length: n }, (_, i) => {
    const x = (x0 + (x1 - x0) * ((i + rnd() * 0.8) / n)) * W
    const hh = h * (0.85 + rnd() * 0.3)
    const gy = groundY + rnd() * h * 0.25
    return `<g opacity="${f2(0.55 + rnd() * 0.35)}"><circle cx="${f1(x)}" cy="${f1(gy - hh + hh * 0.1)}" r="${f1(hh * 0.1)}" fill="#0b0b10"/><rect x="${f1(x - hh * 0.08)}" y="${f1(gy - hh * 0.78)}" width="${f1(hh * 0.16)}" height="${f1(hh * 0.5)}" rx="${f1(hh * 0.05)}" fill="${pal.bldDark}"/><line x1="${f1(x)}" y1="${f1(gy - hh * 0.3)}" x2="${f1(x)}" y2="${f1(gy)}" stroke="#0b0b10" stroke-width="${f1(hh * 0.05)}"/></g>`
  }).join('')
}

// ---- the face close-up ------------------------------------------------------------------------------------------------------------------

function features(e: PovExpression, cx: number, cy: number, r: number): string {
  const ex = r * 0.34
  const eyY = cy - r * 0.12
  const white = (d: string, w = r * 0.07): string => `<path d="${d}" fill="none" stroke="#fff" stroke-width="${f1(w)}" stroke-linecap="round" stroke-linejoin="round"/>`
  const eye = (x: number, rr = r * 0.12, pupil = true): string =>
    `<circle cx="${f1(x)}" cy="${f1(eyY)}" r="${f1(rr)}" fill="#fff"/>${pupil ? `<circle cx="${f1(x + rr * 0.15)}" cy="${f1(eyY + rr * 0.1)}" r="${f1(rr * 0.42)}" fill="#0b0b10"/>` : ''}`
  const ring = (x: number): string => `<circle cx="${f1(x)}" cy="${f1(eyY)}" r="${f1(r * 0.15)}" fill="none" stroke="#fff" stroke-width="${f1(r * 0.05)}"/><circle cx="${f1(x)}" cy="${f1(eyY)}" r="${f1(r * 0.055)}" fill="#fff"/>`
  const brow = (x: number, tilt: number, lift = 0): string => white(`M${f1(x - r * 0.13)} ${f1(eyY - r * (0.27 + lift) + tilt * r)} L${f1(x + r * 0.13)} ${f1(eyY - r * (0.27 + lift) - tilt * r)}`, r * 0.06)
  const mY = cy + r * 0.38
  const mouth = (d: string): string => white(d)
  const L = cx - ex
  const R = cx + ex
  switch (e) {
    case 'smile':
      return `${eye(L, r * 0.11, false)}${eye(R, r * 0.11, false)}${mouth(`M${f1(cx - r * 0.24)} ${f1(mY - r * 0.04)} Q${f1(cx)} ${f1(mY + r * 0.2)} ${f1(cx + r * 0.24)} ${f1(mY - r * 0.04)}`)}`
    case 'laugh':
      return `${white(`M${f1(L - r * 0.12)} ${f1(eyY + r * 0.03)} Q${f1(L)} ${f1(eyY - r * 0.12)} ${f1(L + r * 0.12)} ${f1(eyY + r * 0.03)}`)}${white(`M${f1(R - r * 0.12)} ${f1(eyY + r * 0.03)} Q${f1(R)} ${f1(eyY - r * 0.12)} ${f1(R + r * 0.12)} ${f1(eyY + r * 0.03)}`)}<path d="M${f1(cx - r * 0.28)} ${f1(mY - r * 0.08)} Q${f1(cx)} ${f1(mY + r * 0.36)} ${f1(cx + r * 0.28)} ${f1(mY - r * 0.08)}Z" fill="#fff"/>`
    case 'worried':
      return `${eye(L)}${eye(R)}${brow(L, 0.06)}${brow(R, -0.06)}${mouth(`M${f1(cx - r * 0.2)} ${f1(mY)} q${f1(r * 0.07)} ${f1(-r * 0.07)} ${f1(r * 0.13)} 0 t${f1(r * 0.13)} 0 t${f1(r * 0.13)} 0`)}`
    case 'shock':
      return `${ring(L)}${ring(R)}${brow(L, 0.03, 0.07)}${brow(R, -0.03, 0.07)}<ellipse cx="${f1(cx)}" cy="${f1(mY + r * 0.04)}" rx="${f1(r * 0.08)}" ry="${f1(r * 0.11)}" fill="#fff"/>`
    case 'angry':
      return `${eye(L, r * 0.1)}${eye(R, r * 0.1)}${brow(L, -0.08, -0.04)}${brow(R, 0.08, -0.04)}${mouth(`M${f1(cx - r * 0.12)} ${f1(mY)} L${f1(cx + r * 0.12)} ${f1(mY)}`)}`
    case 'determined':
      return `${eye(L, r * 0.11)}${eye(R, r * 0.11)}${brow(L, -0.04)}${brow(R, 0.04)}${mouth(`M${f1(cx - r * 0.1)} ${f1(mY)} L${f1(cx + r * 0.1)} ${f1(mY)}`)}`
    case 'sad':
      return `${eye(L)}${eye(R)}${brow(L, 0.07)}${brow(R, -0.07)}${mouth(`M${f1(cx - r * 0.2)} ${f1(mY + r * 0.08)} Q${f1(cx)} ${f1(mY - r * 0.12)} ${f1(cx + r * 0.2)} ${f1(mY + r * 0.08)}`)}`
    case 'sly':
      return `${eye(L, r * 0.11)}${eye(R, r * 0.11)}${brow(L, -0.05)}${brow(R, 0.02, 0.08)}${mouth(`M${f1(cx - r * 0.18)} ${f1(mY + r * 0.02)} Q${f1(cx + r * 0.05)} ${f1(mY + r * 0.12)} ${f1(cx + r * 0.22)} ${f1(mY - r * 0.06)}`)}`
    case 'tired':
      return `${white(`M${f1(L - r * 0.12)} ${f1(eyY)} L${f1(L + r * 0.12)} ${f1(eyY)}`)}${white(`M${f1(R - r * 0.12)} ${f1(eyY)} L${f1(R + r * 0.12)} ${f1(eyY)}`)}${mouth(`M${f1(cx - r * 0.12)} ${f1(mY)} L${f1(cx + r * 0.12)} ${f1(mY)}`)}`
    default:
      return `${eye(L)}${eye(R)}${mouth(`M${f1(cx - r * 0.1)} ${f1(mY)} L${f1(cx + r * 0.1)} ${f1(mY)}`)}`
  }
}

/** The face close-up: the head filling ≈ 55 % of the height, its rim ring, the shoulders in the hoodie's colour; the expressions swap. */
export function faceSvg(o: { color: PovColor; hair: PovHair; moods: { expression: PovExpression; atS?: number | undefined }[]; pal: Pal; durationS: number }): string {
  const cx = W / 2
  const r = H * 0.29
  const cy = H * 0.57
  const col = o.pal.colors[o.color]
  const times = o.moods.map((m, i) => (i === 0 ? 0 : (m.atS ?? (o.durationS * i) / o.moods.length)))
  const moods = o.moods
    .map((m, i) => {
      const from = times[i] as number
      const to = times[i + 1]
      return `<g data-anim="fade" data-at="${f2(from)}" data-dur="0.06"${to !== undefined ? ` data-out="${f2(to)}" data-out-dur="0.06"` : ''}>${features(m.expression, cx, cy, r)}</g>`
    })
    .join('')
  return `<ellipse cx="${f1(cx)}" cy="${f1(H + r * 0.35)}" rx="${f1(r * 1.3)}" ry="${f1(r * 0.9)}" fill="${col}"/>
<g data-anim="pop" data-at="0" data-dur="0.25"><circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r + 10)}" fill="none" stroke="${o.pal.rim}" stroke-width="9" opacity=".95"/>
<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r + 30)}" fill="none" stroke="${o.pal.rim}" stroke-width="3" opacity=".22"/>
<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="#0b0b10"/>${hairOf(o.hair, cx, cy, r, o.pal.colors.yellow)}${moods}</g>`
}

// ---- bills ------------------------------------------------------------------------------------------------------------------------------

const bill = (x: number, y: number, w: number, rot: number, p: Pal): string =>
  `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)})"><rect x="${f1(-w / 2)}" y="${f1(-w * 0.22)}" width="${f1(w)}" height="${f1(w * 0.44)}" rx="2" fill="${p.green}"/><rect x="${f1(-w * 0.12)}" y="${f1(-w * 0.22)}" width="${f1(w * 0.24)}" height="${f1(w * 0.44)}" fill="#e8f2e0" opacity=".85"/></g>`

/** 8–12 bills bursting from (cx, cy) at `atS`, flying out and fading in ≈ 1.2 s (HTML layer: each bill moves on its own). */
export function confetti(cx: number, cy: number, atS: number, p: Pal, seed: string, n = 10): string {
  const rnd = seeded(`${seed}:confetti`)
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5
    const d = 260 + rnd() * 260
    const dx = Math.cos(a) * d
    const dy = Math.sin(a) * d * 0.7 + 120
    return `<div style="position:absolute;left:${f1((cx / W) * 100)}%;top:${f1((cy / H) * 100)}%" data-move="0,0,${f1(dx)},${f1(dy)}" data-at="${f2(atS)}" data-dur="1.3"><div data-anim="fade" data-at="${f2(atS)}" data-dur="0.1" data-out="${f2(atS + 0.9)}" data-out-dur="0.4"><svg width="70" height="40" viewBox="-35 -20 70 40" style="overflow:visible">${bill(0, 0, 44, rnd() * 360, p)}</svg></div></div>`
  }).join('')
}

/** Bills (or confetti) raining over a scene for its whole length, seeded. */
export function rain(kind: 'bills' | 'confetti', durationS: number, p: Pal, seed: string): string {
  const rnd = seeded(`${seed}:rain`)
  const n = Math.min(60, Math.round(16 * Math.max(1, durationS)))
  const cols = [p.gold, p.coral, p.green, '#8ab4ff', '#ffffff']
  return Array.from({ length: n }, (_, i) => {
    const x = rnd() * W
    const t0 = (i / n) * Math.max(0.5, durationS - 0.6) - 0.4
    const fall = 1.6 + rnd() * 0.8
    const piece = kind === 'bills' ? bill(0, 0, 40, rnd() * 360, p) : `<rect x="-7" y="-4" width="14" height="8" fill="${cols[i % cols.length]}" transform="rotate(${f1(rnd() * 360)})"/>`
    return `<div style="position:absolute;left:${f1((x / W) * 100)}%;top:-6%" data-move="0,0,${f1((rnd() - 0.5) * 160)},${f1(H * 1.15)}" data-at="${f2(Math.max(0, t0))}" data-dur="${f2(fall)}"><svg width="60" height="40" viewBox="-30 -20 60 40" style="overflow:visible">${piece}</svg></div>`
  }).join('')
}

export { bill }
