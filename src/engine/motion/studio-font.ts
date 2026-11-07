// The glyph outlines of a TrueType font (the motion studio's extruded type, formats/studio.ts): our own small reader of the `glyf` tables
// of the bundled OFL fonts (resources/fonts), simple and composite glyphs (accented capitals are composites), no hinting, no kerning.
// A glyph is written as a compact path in em units (y up): `M x y`, `L x y`, `Q cx cy x y`, `Z`, which the page turns into three.js
// shapes. Pure: the same font and characters always give the same text.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { EngineError } from '../errors'

import type { StudioGlyph, StudioGlyphSet } from '../formats/studio'

export type Glyph = StudioGlyph
export type GlyphSet = StudioGlyphSet

interface Font {
  upm: number
  ascent: number
  numGlyphs: number
  loca: number[]
  glyf: number
  advances: number[]
  cmap: Map<number, number>
  buf: Buffer
}

function tables(b: Buffer): Map<string, number> {
  const n = b.readUInt16BE(4)
  const out = new Map<string, number>()
  for (let i = 0; i < n; i++) out.set(b.toString('latin1', 12 + i * 16, 16 + i * 16), b.readUInt32BE(12 + i * 16 + 8))
  return out
}

function parseCmap(b: Buffer, at: number): Map<number, number> {
  const map = new Map<number, number>()
  const n = b.readUInt16BE(at + 2)
  let f4 = -1
  let f12 = -1
  for (let i = 0; i < n; i++) {
    const pid = b.readUInt16BE(at + 4 + i * 8)
    const eid = b.readUInt16BE(at + 6 + i * 8)
    const off = at + b.readUInt32BE(at + 8 + i * 8)
    const fmt = b.readUInt16BE(off)
    if (fmt === 12 && (pid === 3 || pid === 0)) f12 = off
    if (fmt === 4 && ((pid === 3 && eid === 1) || pid === 0)) f4 = off
  }
  if (f12 >= 0) {
    const groups = b.readUInt32BE(f12 + 12)
    for (let g = 0; g < groups; g++) {
      const s = b.readUInt32BE(f12 + 16 + g * 12)
      const e = b.readUInt32BE(f12 + 20 + g * 12)
      const id = b.readUInt32BE(f12 + 24 + g * 12)
      for (let c = s; c <= e && c < 0x3000; c++) map.set(c, id + c - s)
    }
    return map
  }
  if (f4 < 0) throw new EngineError('missing_tool', 'this font has no Unicode character map')
  const segX2 = b.readUInt16BE(f4 + 6)
  const ends = f4 + 14
  const starts = ends + segX2 + 2
  const deltas = starts + segX2
  const ranges = deltas + segX2
  for (let s = 0; s < segX2 / 2; s++) {
    const end = b.readUInt16BE(ends + s * 2)
    const start = b.readUInt16BE(starts + s * 2)
    const delta = b.readInt16BE(deltas + s * 2)
    const ro = b.readUInt16BE(ranges + s * 2)
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let g: number
      if (ro === 0) g = (c + delta) & 0xffff
      else {
        const gi = b.readUInt16BE(ranges + s * 2 + ro + (c - start) * 2)
        g = gi === 0 ? 0 : (gi + delta) & 0xffff
      }
      if (g) map.set(c, g)
    }
  }
  return map
}

function parseFont(buf: Buffer): Font {
  const t = tables(buf)
  const need = (k: string): number => {
    const v = t.get(k)
    if (v === undefined) throw new EngineError('missing_tool', `this font has no ${k} table (TrueType outlines are needed)`)
    return v
  }
  const head = need('head')
  const upm = buf.readUInt16BE(head + 18)
  const longLoca = buf.readInt16BE(head + 50) === 1
  const numGlyphs = buf.readUInt16BE(need('maxp') + 4)
  const hhea = need('hhea')
  const ascent = buf.readInt16BE(hhea + 4)
  const nh = buf.readUInt16BE(hhea + 34)
  const hmtx = need('hmtx')
  const advances: number[] = []
  for (let i = 0; i < numGlyphs; i++) advances.push(buf.readUInt16BE(hmtx + Math.min(i, nh - 1) * 4))
  const lo = need('loca')
  const loca: number[] = []
  for (let i = 0; i <= numGlyphs; i++) loca.push(longLoca ? buf.readUInt32BE(lo + i * 4) : buf.readUInt16BE(lo + i * 2) * 2)
  return { upm, ascent, numGlyphs, loca, glyf: need('glyf'), advances, cmap: parseCmap(buf, need('cmap')), buf }
}

type Pt = { x: number; y: number; on: boolean }

/** The contours of glyph `g` (font units), composites resolved (one level of transform per component). */
function contours(f: Font, g: number, depth = 0): Pt[][] {
  if (g >= f.numGlyphs || depth > 6) return []
  const start = f.loca[g] as number
  if ((f.loca[g + 1] as number) <= start) return []
  const b = f.buf
  let p = f.glyf + start
  const n = b.readInt16BE(p)
  p += 10
  if (n >= 0) {
    const ends: number[] = []
    for (let i = 0; i < n; i++) ends.push(b.readUInt16BE(p + i * 2))
    p += n * 2
    p += 2 + b.readUInt16BE(p)
    const count = n ? (ends[n - 1] as number) + 1 : 0
    const flags: number[] = []
    while (flags.length < count) {
      const fl = b.readUInt8(p++)
      flags.push(fl)
      if (fl & 8) {
        const r = b.readUInt8(p++)
        for (let k = 0; k < r; k++) flags.push(fl)
      }
    }
    const xs: number[] = []
    let v = 0
    for (const fl of flags) {
      if (fl & 2) v += b.readUInt8(p++) * (fl & 16 ? 1 : -1)
      else if (!(fl & 16)) {
        v += b.readInt16BE(p)
        p += 2
      }
      xs.push(v)
    }
    const ys: number[] = []
    v = 0
    for (const fl of flags) {
      if (fl & 4) v += b.readUInt8(p++) * (fl & 32 ? 1 : -1)
      else if (!(fl & 32)) {
        v += b.readInt16BE(p)
        p += 2
      }
      ys.push(v)
    }
    const out: Pt[][] = []
    let s = 0
    for (const e of ends) {
      const c: Pt[] = []
      for (let i = s; i <= e; i++) c.push({ x: xs[i] as number, y: ys[i] as number, on: ((flags[i] as number) & 1) === 1 })
      out.push(c)
      s = e + 1
    }
    return out
  }
  // a composite: components placed by an offset and an optional scale
  const out: Pt[][] = []
  for (;;) {
    const fl = b.readUInt16BE(p)
    const gi = b.readUInt16BE(p + 2)
    p += 4
    const words = (fl & 1) !== 0
    const dx = words ? b.readInt16BE(p) : b.readInt8(p)
    const dy = words ? b.readInt16BE(p + 2) : b.readInt8(p + 1)
    p += words ? 4 : 2
    const f2 = (at: number): number => b.readInt16BE(p + at) / 16384
    let [a, bb, c, d] = [1, 0, 0, 1]
    if (fl & 8) {
      a = d = f2(0)
      p += 2
    } else if (fl & 0x40) {
      ;[a, d] = [f2(0), f2(2)]
      p += 4
    } else if (fl & 0x80) {
      ;[a, bb, c, d] = [f2(0), f2(2), f2(4), f2(6)]
      p += 8
    }
    const xy = (fl & 2) !== 0
    for (const k of contours(f, gi, depth + 1)) out.push(k.map((q) => ({ x: a * q.x + c * q.y + (xy ? dx : 0), y: bb * q.x + d * q.y + (xy ? dy : 0), on: q.on })))
    if (!(fl & 0x20)) break
  }
  return out
}

const r = (v: number): string => String(Math.round(v * 10000) / 10000)

/** A contour of quadratic on/off points as a path (implied on-points between two off-points). */
function pathOf(cs: Pt[][], upm: number): string {
  const parts: string[] = []
  const s = (q: { x: number; y: number }): string => `${r(q.x / upm)} ${r(q.y / upm)}`
  for (const c of cs) {
    if (c.length < 2) continue
    // start on an on-curve point (or the middle of the first two off-points)
    const i0 = c.findIndex((q) => q.on)
    let first: { x: number; y: number }
    let pts: Pt[]
    if (i0 < 0) {
      const a = c[0] as Pt
      const b2 = c[1] as Pt
      first = { x: (a.x + b2.x) / 2, y: (a.y + b2.y) / 2 }
      pts = [...c.slice(1), a]
    } else {
      first = c[i0] as Pt
      pts = [...c.slice(i0 + 1), ...c.slice(0, i0)]
    }
    parts.push(`M ${s(first)}`)
    let ctrl: Pt | null = null
    for (const q of [...pts, { ...first, on: true }]) {
      if (q.on) {
        parts.push(ctrl ? `Q ${s(ctrl)} ${s(q)}` : `L ${s(q)}`)
        ctrl = null
      } else if (ctrl) {
        const mid = { x: (ctrl.x + q.x) / 2, y: (ctrl.y + q.y) / 2 }
        parts.push(`Q ${s(ctrl)} ${s(mid)}`)
        ctrl = q
      } else ctrl = q
    }
    parts.push('Z')
  }
  return parts.join(' ')
}

/** The studio's faces: file and family (all OFL, resources/fonts). */
export const STUDIO_FACES = {
  wide: 'Montserrat-ExtraBold.ttf',
  sans: 'Inter-Bold.ttf',
  semi: 'Inter-SemiBold.ttf',
  condensed: 'Oswald-Bold.ttf',
  serif: 'SourceSerif4-Regular.ttf'
} as const
export type StudioFace = keyof typeof STUDIO_FACES

const fontCache = new Map<string, Promise<Font>>()
function loadFont(file: string): Promise<Font> {
  let p = fontCache.get(file)
  if (!p) {
    p = readFile(file).then(parseFont)
    p.catch(() => fontCache.delete(file))
    fontCache.set(file, p)
  }
  return p
}

/** The outlines of `chars` in `face` (a character the font lacks is drawn as nothing, with the width of a space). */
export async function glyphsOf(fontsDir: string, face: StudioFace, chars: Iterable<string>): Promise<GlyphSet> {
  const f = await loadFont(path.join(fontsDir, STUDIO_FACES[face]))
  const glyphs: Record<string, Glyph> = {}
  const space = f.cmap.get(32)
  const spaceAdv = (space !== undefined ? (f.advances[space] as number) : f.upm * 0.25) / f.upm
  for (const ch of new Set(chars)) {
    const code = ch.codePointAt(0) as number
    // a narrow no-break space is drawn as a thin gap
    if (code === 0x202f || code === 0xa0 || code === 0x2009) {
      glyphs[ch] = { adv: code === 0xa0 ? spaceAdv : spaceAdv * 0.8, d: '' }
      continue
    }
    const g = f.cmap.get(code)
    if (g === undefined) {
      glyphs[ch] = { adv: spaceAdv, d: '' }
      continue
    }
    glyphs[ch] = { adv: Math.round(((f.advances[g] as number) / f.upm) * 10000) / 10000, d: pathOf(contours(f, g), f.upm) }
  }
  return { face, ascent: f.ascent / f.upm, glyphs }
}
