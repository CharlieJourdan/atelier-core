// What every motion template shares (docs/ENGINE-SPEC.md §25): the page around a template's markup, the frame's safe zones, French
// typography, a colour that keeps its text readable (≥ 4.5:1 against its backing) and a small seeded random for the drawn maps.
import type { Aspect } from '../formats/timing'
import { RUNTIME_JS } from './runtime'

/** Bump when a template's look changes: it is part of the render cache key. */
export const MOTION_VERSION = 1

export interface MotionCtx {
  width: number
  height: number
  /** How long the overlay stays on screen (seconds): the way out starts `OUT_S` before the end. */
  durationS: number
  /** `@font-face` rules (the bundled Inter, embedded), or '' (tests). */
  fontCss: string
}
export const OUT_S = 0.4
export const outAt = (c: MotionCtx): number => Math.max(0.5, c.durationS - OUT_S)
export const isPortrait = (c: MotionCtx): boolean => c.height > c.width
export const aspectOf = (c: MotionCtx): Aspect => (isPortrait(c) ? '9:16' : '16:9')
/** Picks the landscape or the portrait value of a measure. */
export const pick = <T>(c: MotionCtx, landscape: T, portrait: T): T => (isPortrait(c) ? portrait : landscape)

/**
 * The part of the frame a graphic may use, in pixels. The captions sit in the lower part of the frame (a landscape film: from about 77 %
 * of its height; a short: the band at 66–75 %, above the phone's own buttons) and the labels in the upper left corner (below 9 % in a
 * short), so graphics keep out of both and the captions stay readable under any overlay.
 */
export function zone(c: MotionCtx): { left: number; right: number; top: number; bottom: number; width: number; height: number } {
  const portrait = isPortrait(c)
  const left = portrait ? 60 : 100
  const top = Math.round(c.height * (portrait ? 0.12 : 0.1))
  const bottom = Math.round(c.height * (portrait ? 0.65 : 0.76))
  return { left, right: c.width - left, top, bottom, width: c.width - 2 * left, height: bottom - top }
}

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** French typography on existing spaces: none breaks before `: ; ! ? % » €` or after `«`. */
export function typo(s: string): string {
  return s
    .replace(/ +([;!?])/g, '\u202f$1')
    .replace(/ +([:»%€])/g, '\u00a0$1')
    .replace(/(«) +/g, '$1\u00a0')
}

// ---- colour ---------------------------------------------------------------------------------------------------------------------------

const toRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const toHex = (rgb: readonly number[]): string => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG contrast ratio of two colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
/** `bg` made darker (or lighter, for a dark `fg`) in small steps until `fg` reads on it at 4.5:1. */
export function readableOn(bg: string, fg: string): string {
  const darker = luminance(fg) > luminance(bg) || luminance(fg) > 0.5
  let rgb = toRgb(bg)
  for (let i = 0; i < 40 && contrast(toHex(rgb), fg) < 4.5; i++) rgb = rgb.map((v) => (darker ? v * 0.94 : v + (255 - v) * 0.06)) as [number, number, number]
  return toHex(rgb)
}

export interface Theme {
  fg: string
  muted: string
  panel: string
  line: string
  scrim: string
  /** A solid colour of a chip or a bubble: the accent, kept dark enough for white text. */
  chip: string
  chipText: string
  /** The bubbles of the others in a conversation. */
  other: string
  otherText: string
  dark: boolean
}
export function themeOf(accent: string, mode: 'dark' | 'light'): Theme {
  const dark = mode === 'dark'
  return {
    dark,
    fg: dark ? '#FFFFFF' : '#10131A',
    muted: dark ? 'rgba(255,255,255,0.74)' : 'rgba(16,19,26,0.72)',
    panel: dark ? 'rgba(14,17,24,0.86)' : 'rgba(255,255,255,0.92)',
    line: dark ? 'rgba(255,255,255,0.16)' : 'rgba(16,19,26,0.14)',
    scrim: dark ? 'rgba(6,8,12,0.58)' : 'rgba(255,255,255,0.7)',
    chip: readableOn(accent, '#FFFFFF'),
    chipText: '#FFFFFF',
    other: dark ? '#2A2F3B' : '#E3E6ED',
    otherText: dark ? '#FFFFFF' : '#10131A'
  }
}

// ---- a seeded random (the drawn maps look the same every time) ----------------------------------------------------------------------

export function seeded(seed: string): () => number {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A closed, smooth blob around (cx, cy): a stylised stretch of land. */
export function blobPath(rnd: () => number, cx: number, cy: number, r: number, points = 9): string {
  const pts = Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2
    const k = r * (0.62 + rnd() * 0.5)
    return [cx + Math.cos(a) * k * 1.25, cy + Math.sin(a) * k * 0.85] as const
  })
  const mid = (i: number) => {
    const [x1, y1] = pts[i % points] as readonly [number, number]
    const [x2, y2] = pts[(i + 1) % points] as readonly [number, number]
    return [(x1 + x2) / 2, (y1 + y2) / 2] as const
  }
  const [sx, sy] = mid(points - 1)
  let d = `M${sx.toFixed(1)} ${sy.toFixed(1)}`
  for (let i = 0; i < points; i++) {
    const [px, py] = pts[i] as readonly [number, number]
    const [mx, my] = mid(i)
    d += ` Q${px.toFixed(1)} ${py.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`
  }
  return d + 'Z'
}

// ---- the page --------------------------------------------------------------------------------------------------------------------------

/** The whole HTML document of a template: transparent, sized to the frame, with the runtime that moves it. */
export function pageHtml(c: MotionCtx, t: Theme, accent: string, css: string, body: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>motion</title><style>
${c.fontCss}
:root{--accent:${accent};--fg:${t.fg};--muted:${t.muted};--panel:${t.panel};--line:${t.line};--chip:${t.chip};--chip-text:${t.chipText};--scrim:${t.scrim};--other:${t.other};--other-text:${t.otherText}}
html,body{margin:0;padding:0;width:${c.width}px;height:${c.height}px;overflow:hidden;background:transparent}
*{box-sizing:border-box}
body{position:relative;font-family:'Inter','Segoe UI','Helvetica Neue',Arial,sans-serif;font-weight:600;color:var(--fg);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;font-kerning:normal}
[data-anim]{opacity:0;will-change:auto}
.b{font-weight:700}
${css}
</style></head><body>
${body}
<script>${RUNTIME_JS}</script>
</body></html>`
}
