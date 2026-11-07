// The lint of a custom brick's preview (docs/ENGINE-SPEC.md §25.2): from what the sandboxed page showed at each still (its text boxes, the
// share of the frame that is drawn) and what it reported (console errors, blocked requests), the pass / fail rules an agent reads before it
// proposes a brick: empty frames, text that overflows its box or the frame, text outside the safe area (the caption band and the edges),
// text too small to read on a phone, text that does not stand out from its backing (contrast under 4.5:1) or has no backing and no shadow over
// footage, a script error, a request for the network. Pure: the same facts give the same verdict.
import type { PageInspection, TextBox } from '../services'
import { zone } from './base'

export type LintRule = 'empty' | 'overflow' | 'safe-area' | 'small-text' | 'contrast' | 'console' | 'network'
export interface LintIssue {
  rule: LintRule
  /** The still it was seen at (share of the duration, 0..1), absent for the whole page. */
  at?: number
  message: string
}

export interface StillFacts {
  /** Share of the duration (0..1) and the time (s) of the still. */
  share: number
  t: number
  /** Share of the frame that is drawn (0..1). */
  coverage: number
  inspection: PageInspection | null
}

/** Below this share of drawn pixels a frame is empty. */
export const EMPTY_BELOW = 0.002
/** Text is checked once it is this visible. */
const VISIBLE = 0.5

type Rgba = [number, number, number, number]
export function parseColor(css: string): Rgba | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i.exec(css)
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return [Number(m[1]), Number(m[2]), Number(m[3]), alpha]
  }
  const h = /^#([0-9a-f]{6})$/i.exec(css.trim())
  if (h) return [parseInt(h[1]!.slice(0, 2), 16), parseInt(h[1]!.slice(2, 4), 16), parseInt(h[1]!.slice(4, 6), 16), 1]
  return null
}
const over = (top: Rgba, under: [number, number, number]): [number, number, number] => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])) as [number, number, number]
const lum = (c: readonly number[]): number => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrastOf = (a: readonly number[], b: readonly number[]): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
/** Footage under a translucent backing: a mid grey (the worst case is in between black and white). */
const FOOTAGE: [number, number, number] = [119, 119, 119]

const pct = (share: number): string => `${Math.round(share * 100)} %`
const quoted = (b: TextBox): string => `« ${b.text.slice(0, 40)} »`

function textIssues(b: TextBox, s: StillFacts, frame: { width: number; height: number }): LintIssue[] {
  const out: LintIssue[] = []
  const at = s.share
  const safe = zone({ width: frame.width, height: frame.height, durationS: 1, fontCss: '' })
  if (b.clipped) out.push({ rule: 'overflow', at, message: `text ${quoted(b)} overflows its box at ${pct(at)}: shorten it, let it wrap, or use data-fit` })
  if (b.x < safe.left - 1 || b.y < safe.top - 1 || b.x + b.w > safe.right + 1 || b.y + b.h > safe.bottom + 1) {
    out.push({ rule: 'safe-area', at, message: `text ${quoted(b)} leaves the safe area at ${pct(at)} (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)} px; the area is ${safe.left}–${safe.right} × ${safe.top}–${safe.bottom}, the captions live below)` })
  }
  const minPx = Math.round(Math.min(frame.width, frame.height) * 0.022)
  if (b.fontPx < minPx) out.push({ rule: 'small-text', at, message: `text ${quoted(b)} is ${Math.round(b.fontPx)} px: under ${minPx} px it does not read on a phone` })
  const fg = parseColor(b.color)
  if (fg) {
    if (b.backing === null) {
      if (!b.shadow) out.push({ rule: 'contrast', at, message: `text ${quoted(b)} has no backing and no shadow: over footage it will not read (give it a panel or a text-shadow)` })
    } else if (b.backing !== 'image') {
      const bg = parseColor(b.backing)
      if (bg) {
        const base = over(bg, FOOTAGE)
        const ratio = contrastOf(over(fg, base), base)
        if (ratio < 4.5) out.push({ rule: 'contrast', at, message: `text ${quoted(b)} stands at ${ratio.toFixed(1)}:1 on its backing (4.5:1 at least)` })
      }
    }
  }
  return out
}

/** Every problem of a preview, the same problem said once (at its first still). Empty = it passes. */
export function lintBrick(o: { stills: readonly StillFacts[]; width: number; height: number; console: readonly string[]; blocked: readonly string[] }): LintIssue[] {
  const out: LintIssue[] = []
  const inner = o.stills.filter((s) => s.share > 0.01 && s.share < 0.99)
  if (o.stills.length > 0 && o.stills.every((s) => s.coverage < EMPTY_BELOW)) out.push({ rule: 'empty', message: 'the brick draws nothing: every still is empty' })
  else for (const s of inner) if (s.coverage < EMPTY_BELOW) out.push({ rule: 'empty', at: s.share, message: `the frame at ${pct(s.share)} is empty` })
  const said = new Set<string>()
  for (const s of o.stills) {
    for (const b of s.inspection?.texts ?? []) {
      if (b.opacity < VISIBLE || b.w <= 0 || b.h <= 0) continue
      for (const i of textIssues(b, s, o)) {
        const key = `${i.rule}|${b.text}`
        if (said.has(key)) continue
        said.add(key)
        out.push(i)
      }
    }
  }
  for (const c of [...new Set(o.console)].slice(0, 8)) out.push({ rule: 'console', message: `console: ${c}` })
  for (const u of [...new Set(o.blocked)].slice(0, 8)) out.push({ rule: 'network', message: `blocked request to ${u}: bricks have no network (embed a picture as an image field)` })
  return out
}
