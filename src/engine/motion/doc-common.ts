// What the documentary cards share (doc-cards.ts): the three faces, a deterministic hash, a picture's size read from its bytes, the
// stand-in for a missing picture, the word punch and the white serif lines, and the hand-warped grid of the dark cards.
import { DOC_PALETTE, type ArchiveCardProps } from '../formats/cards'
import { esc, pick, seeded, typo, type MotionCtx } from './base'
import type { Part } from './cards'
import type { DocStyle } from './doc-parchment'

export const FONT = {
  sans: "'Inter','Segoe UI','Helvetica Neue',Arial,sans-serif",
  cond: "'Oswald','Arial Narrow','Segoe UI',sans-serif",
  serif: "'Source Serif 4','Times New Roman',Georgia,serif"
}

export const f2 = (n: number): string => n.toFixed(2)
export const px = (n: number): string => `${Math.round(n)}px`

/** A small stable number (0..1) from a text: the same label always tilts the same way. */
export function unit(s: string, salt = ''): number {
  return seeded(s + '|' + salt)()
}
/** A tilt in degrees within ±`max`, from the text. */
export const tiltOf = (s: string, max = 3): number => Math.round((unit(s, 'tilt') * 2 - 1) * max * 10) / 10

// ---- the picture ------------------------------------------------------------------------------------------------------------------

/** The width and height of a `data:image/(jpeg|png);base64,…` picture from its header, or null (unknown, or not an image). */
export function pictureSize(uri: string | undefined): { w: number; h: number } | null {
  const m = /^data:image\/(jpeg|jpg|png);base64,/i.exec(uri ?? '')
  if (!uri || !m) return null
  const b = Buffer.from(uri.slice(m[0].length, m[0].length + 400_000), 'base64')
  if (/png/i.test(m[1] as string)) return b.length >= 24 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1] as number
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
    i += 2 + b.readUInt16BE(i + 2)
  }
  return null
}
/** The picture's aspect (w / h): its own, or the 3:2 of a photograph while it is unknown. */
export const aspectOfPicture = (uri: string | undefined): number => {
  const s = pictureSize(uri)
  return s && s.w > 0 && s.h > 0 ? s.w / s.h : 3 / 2
}
/** The largest w × h of a given aspect inside a box. */
export function fitBox(aspect: number, maxW: number, maxH: number): { w: number; h: number } {
  const w = Math.min(maxW, maxH * aspect)
  return { w: Math.round(w), h: Math.round(w / aspect) }
}

/** The picture as an <img> (cover) of class `cls`, or a neutral placeholder of the same class while there is none (tests, a failed fetch). */
export function pictureTag(uri: string | undefined, cls: string, attrs = ''): string {
  if (uri) return `<img class="${cls}" ${attrs} alt="" src="${uri}">`
  return `<div class="${cls} ph" ${attrs}><svg viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice"><circle cx="86" cy="26" r="9" fill="#cfc8bb" opacity=".55"/><path d="M0 80 L0 58 L30 34 L52 54 L74 40 L120 66 L120 80Z" fill="#cfc8bb" opacity=".4"/></svg></div>`
}
export const PICTURE_CSS = `
.ph{background:linear-gradient(135deg,#8d867b,#5b554d);overflow:hidden}
.ph svg{display:block;width:100%;height:100%}`

// ---- the slow camera ----------------------------------------------------------------------------------------------------------------

/** The scale ends and the point the scale holds still for a camera move: push and pull are a zoom; left and right a zoom pinned to a side. */
export function cameraOf(move: 'push' | 'pull' | 'left' | 'right', amount: number): { z0: number; z1: number; origin: string } {
  if (move === 'pull') return { z0: 1 + amount, z1: 1, origin: '50% 50%' }
  if (move === 'left') return { z0: 1, z1: 1 + amount * 0.8, origin: '100% 50%' }
  if (move === 'right') return { z0: 1, z1: 1 + amount * 0.8, origin: '0% 50%' }
  return { z0: 1, z1: 1 + amount, origin: '50% 50%' }
}
/** The attributes that make an element take that move over the whole card (steady: a linear rate). */
export function cameraAttrs(move: 'push' | 'pull' | 'left' | 'right', amount: number, durationS: number): string {
  const k = cameraOf(move, amount)
  return `data-zoom data-at="0" data-dur="${f2(durationS)}" data-z0="${k.z0.toFixed(4)}" data-z1="${k.z1.toFixed(4)}" data-ease="linear"`
}
export const originOf = (move: 'push' | 'pull' | 'left' | 'right'): string => cameraOf(move, 0).origin

// ---- word punch and lines ---------------------------------------------------------------------------------------------------------------

export interface OverlayOpts {
  punch?: string
  punchAtS?: number
  lines: readonly string[]
  linesAtS?: number
  /** Where the lines start from the left, and the text colour of the lines (a light card needs dark ink). */
  linesLeft: number
  ink: string
  shadow: boolean
  /** The word box's colours and shadow (the parchment look draws it in its brown on cream); the dark cards' red on white by default. */
  punchBg?: string
  punchInk?: string
  punchShadow?: string
}

/** The red word box (lower third, centred) and the lines (bottom left) that every frame of an archive card can carry. */
export function overlays(o: OverlayOpts, c: MotionCtx): { css: string; body: string } {
  const D = c.durationS
  const size = pick(c, 54, 50)
  const lineSize = pick(c, 54, 48)
  const punchTop = Math.round(c.height * pick(c, 0.655, 0.6))
  const css = `
.punchw{position:absolute;left:0;right:0;top:${punchTop}px;display:flex;justify-content:center;pointer-events:none}
.punch{display:block;max-width:${c.width - 2 * pick(c, 120, 60)}px;overflow:hidden;white-space:nowrap;background:${o.punchBg ?? DOC_PALETTE.red};color:${o.punchInk ?? '#fff'};font-family:${FONT.serif};font-weight:600;font-size:${size}px;letter-spacing:.05em;text-transform:uppercase;line-height:1.1;padding:${pick(c, 16, 14)}px ${pick(c, 36, 28)}px ${pick(c, 18, 16)}px;box-shadow:${o.punchShadow ?? '0 10px 26px rgba(0,0,0,.45)'}}
.lines{position:absolute;left:${o.linesLeft}px;bottom:${pick(c, 72, 140)}px;max-width:${c.width - o.linesLeft - 60}px;font-family:${FONT.serif};font-weight:600;font-size:${lineSize}px;line-height:1.2;color:${o.ink};${o.shadow ? 'text-shadow:0 2px 14px rgba(0,0,0,.85),0 1px 3px rgba(0,0,0,.9);' : ''}}
.lines div{white-space:nowrap}`
  const lineAt = o.linesAtS ?? D * 0.3
  const lines = o.lines.length
    ? `<div class="lines">${o.lines.map((t, i) => `<div data-anim="rise" data-at="${f2(lineAt + i * 0.55)}" data-dur="0.5" data-dy="16">${esc(typo(t))}</div>`).join('')}</div>`
    : ''
  const punch = o.punch
    ? `<div class="punchw"><div class="punch" data-fit="24" data-anim="pop" data-at="${f2(o.punchAtS ?? D * 0.4)}" data-dur="0.35">${esc(typo(o.punch))}</div></div>`
    : ''
  return { css, body: lines + punch }
}

// ---- the dark warped grid (data cards) ---------------------------------------------------------------------------------------------------

/** One grid line as a smooth path: points every `step` px along it, each a few px off its true place. */
function wavy(rnd: () => number, x0: number, y0: number, x1: number, y1: number, step: number, amp: number): string {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const n = Math.max(2, Math.round(len / step))
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const k = i / n
    const edge = i === 0 || i === n ? 0 : 1
    // a small push perpendicular to the line (and a little along it)
    const nx = (y1 - y0) / len
    const ny = -(x1 - x0) / len
    const a = (rnd() * 2 - 1) * amp * edge
    return [x0 + (x1 - x0) * k + nx * a, y0 + (y1 - y0) * k + ny * a] as const
  })
  let d = `M${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [px1, py1] = pts[i] as readonly [number, number]
    const [px2, py2] = pts[i + 1] as readonly [number, number]
    d += ` Q${px1.toFixed(1)} ${py1.toFixed(1)} ${((px1 + px2) / 2).toFixed(1)} ${((py1 + py2) / 2).toFixed(1)}`
  }
  const last = pts[pts.length - 1] as readonly [number, number]
  return d + ` L${last[0].toFixed(1)} ${last[1].toFixed(1)}`
}

/** The hand-warped grid of the dark cards, as an SVG of the frame's size (cells of about 170 px, white at 8 %). */
export function warpedGrid(c: MotionCtx, seed: string): string {
  const rnd = seeded('grid|' + seed)
  const cell = pick(c, 170, 150)
  const paths: string[] = []
  for (let x = cell * 0.55; x < c.width + cell; x += cell) paths.push(wavy(rnd, x, -20, x + (rnd() - 0.5) * 14, c.height + 20, 130, 9))
  for (let y = cell * 0.4; y < c.height + cell; y += cell) paths.push(wavy(rnd, -20, y, c.width + 20, y + (rnd() - 0.5) * 14, 130, 9))
  return `<svg class="grid" viewBox="0 0 ${c.width} ${c.height}" width="${c.width}" height="${c.height}" fill="none" stroke="rgba(255,255,255,.11)" stroke-width="1.8" stroke-linecap="round">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`
}

/** The dark warm background of the data cards: a solid colour from the first frame, with a warm glow high on the left and a vignette. */
export const DARK_CSS = `
.doc{position:absolute;inset:0;overflow:hidden;background:linear-gradient(165deg,#1d1a18 0%,#14110f 100%);color:${DOC_PALETTE.text};font-family:${FONT.sans}}
.doc .glow{position:absolute;inset:0;background:radial-gradient(ellipse 70% 60% at 18% 8%,rgba(150,85,60,.16),transparent 70%),radial-gradient(ellipse 120% 100% at 50% 50%,transparent 55%,rgba(0,0,0,.4) 100%)}
.doc .grid{position:absolute;left:0;top:0}`

// ---- what a frame of an archive card gets and gives ---------------------------------------------------------------------------------------

export interface FrameIn {
  p: ArchiveCardProps
  c: MotionCtx
  picture: string | undefined
  /** The picture's w / h. */
  aspect: number
  /** The look the card is drawn in (dark unless the spec asks for the parchment). */
  look: DocStyle
}
/** A frame's CSS and markup, and how its lines and its source are to be drawn over it. */
export interface FrameOut extends Part {
  linesLeft: number
  /** Ink of the lines and of the source: light over a picture or a slate, dark over paper. */
  ink: string
  srcInk: string
  shadow: boolean
  /** The colours of the word box (overlays) and whether the source is set in the serif: the parchment look sets both. */
  punch?: { bg: string; ink: string; shadow: string }
  srcSerif?: boolean
}

/** The caption box of a picture (a black box, a white serif title, an italic grey second line) at (left, top). */
export function captionBox(label: string, sub: string | undefined, left: number, top: number, maxW: number, c: MotionCtx): { css: string; body: string } {
  return {
    css: `
.cap{position:absolute;left:${left}px;top:${top}px;max-width:${maxW}px;background:rgba(0,0,0,.82);padding:${pick(c, 14, 12)}px ${pick(c, 24, 20)}px ${pick(c, 17, 14)}px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.cap .t{font-family:${FONT.serif};font-weight:400;font-size:${pick(c, 34, 32)}px;line-height:1.2;color:#fff;white-space:nowrap;overflow:hidden;padding-bottom:2px}
.cap .s{font-family:${FONT.serif};font-style:italic;font-weight:400;font-size:${pick(c, 20, 19)}px;line-height:1.3;color:#b9b3a9;margin-top:3px;white-space:nowrap;overflow:hidden}`,
    body: `<div class="cap" data-anim="wipe" data-at="0.25" data-dur="0.55"><div class="t" data-fit="20">${esc(typo(label))}</div>${sub ? `<div class="s" data-fit="13">${esc(typo(sub))}</div>` : ''}</div>`
  }
}
