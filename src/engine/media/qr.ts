// QR codes for the sponsor slot (docs/specs/pipeline-avatar.md §2.13): our own encoder of the public QR Code standard (ISO/IEC
// 18004), byte mode, error correction level M, versions 1 to 10 (up to 213 bytes: any sponsor link). The matrix is drawn as a
// PNG (dark modules on white, the standard 4-module quiet zone) that the render scales without smoothing. No dependency, no
// network: the code is the same bytes for the same link. A link longer than version 10 holds is refused, never cut.
import { encodePng } from './png'

/** Level M, per version: total codewords, error-correction codewords per block, and the blocks' data lengths. */
const VERSIONS: readonly { total: number; ec: number; blocks: readonly number[] }[] = [
  { total: 26, ec: 10, blocks: [16] },
  { total: 44, ec: 16, blocks: [28] },
  { total: 70, ec: 26, blocks: [44] },
  { total: 100, ec: 18, blocks: [32, 32] },
  { total: 134, ec: 24, blocks: [43, 43] },
  { total: 172, ec: 16, blocks: [27, 27, 27, 27] },
  { total: 196, ec: 18, blocks: [31, 31, 31, 31] },
  { total: 242, ec: 22, blocks: [38, 38, 39, 39] },
  { total: 292, ec: 22, blocks: [36, 36, 36, 37, 37] },
  { total: 346, ec: 26, blocks: [43, 43, 43, 43, 44] }
]
const ALIGNMENT: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
/** Format bits of level M (the two bits before the mask). */
const LEVEL_M = 0

/** The longest text (UTF-8 bytes) a code of this encoder holds. */
export const QR_MAX_BYTES = 213

/** Product in GF(256) with the QR polynomial x⁸ + x⁴ + x³ + x² + 1. */
function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

/** The Reed-Solomon generator of `degree` (coefficients, highest first, the leading 1 left out). */
function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0)
  out[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j] as number, root)
      if (j + 1 < degree) out[j] = (out[j] as number) ^ (out[j + 1] as number)
    }
    root = gfMul(root, 2)
  }
  return out
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const out = new Array<number>(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ (out.shift() as number)
    out.push(0)
    divisor.forEach((c, i) => (out[i] = (out[i] as number) ^ gfMul(c, factor)))
  }
  return out
}

/** The data codewords: byte mode, the count, the bytes, the terminator, then the pad bytes. */
function dataCodewords(bytes: Uint8Array, version: number, capacity: number): number[] {
  const bits: number[] = []
  const put = (value: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  put(0b0100, 4)
  put(bytes.length, version <= 9 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, capacity * 8 - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  const out: number[] = []
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0))
  for (let pad = 0xec; out.length < capacity; pad ^= 0xec ^ 0x11) out.push(pad)
  return out
}

/** Data and error-correction codewords, interleaved block by block (the order they are drawn). */
function codewords(data: readonly number[], v: (typeof VERSIONS)[number]): number[] {
  const divisor = rsDivisor(v.ec)
  const blocks: number[][] = []
  let at = 0
  for (const n of v.blocks) {
    blocks.push(data.slice(at, at + n))
    at += n
  }
  const ecs = blocks.map((b) => rsRemainder(b, divisor))
  const out: number[] = []
  const longest = Math.max(...v.blocks)
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i] as number)
  for (let i = 0; i < v.ec; i++) for (const e of ecs) out.push(e[i] as number)
  return out
}

const MASKS: readonly ((y: number, x: number) => boolean)[] = [
  (y, x) => (y + x) % 2 === 0,
  (y) => y % 2 === 0,
  (_y, x) => x % 3 === 0,
  (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0
]

class Grid {
  readonly size: number
  readonly dark: boolean[][]
  readonly fixed: boolean[][]
  constructor(size: number) {
    this.size = size
    this.dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
    this.fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  }
  set(x: number, y: number, dark: boolean): void {
    ;(this.dark[y] as boolean[])[x] = dark
    ;(this.fixed[y] as boolean[])[x] = true
  }
}

function drawFunctionPatterns(g: Grid, version: number): void {
  const n = g.size
  for (let i = 0; i < n; i++) {
    g.set(6, i, i % 2 === 0)
    g.set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < n && y >= 0 && y < n) g.set(x, y, d !== 2 && d !== 4)
      }
    }
  }
  const pos = ALIGNMENT[version - 1] as readonly number[]
  const last = pos.length - 1
  pos.forEach((y, i) =>
    pos.forEach((x, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    })
  )
  drawFormat(g, 0)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1
      const a = n - 11 + (i % 3)
      const b = Math.floor(i / 3)
      g.set(a, b, dark)
      g.set(b, a, dark)
    }
  }
}

/** The 15 format bits (level and mask, BCH-protected), both copies, and the dark module. */
function drawFormat(g: Grid, mask: number): void {
  const n = g.size
  const data = (LEVEL_M << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((data << 10) | rem) ^ 0x5412
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) g.set(8, i, bit(i))
  g.set(8, 7, bit(6))
  g.set(8, 8, bit(7))
  g.set(7, 8, bit(8))
  for (let i = 9; i < 15; i++) g.set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) g.set(n - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) g.set(8, n - 15 + i, bit(i))
  g.set(8, n - 8, true)
}

/** The codewords in the zigzag order of the standard, two columns at a time, skipping the vertical timing column. */
function drawCodewords(g: Grid, words: readonly number[]): void {
  const n = g.size
  let i = 0
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? n - 1 - vert : vert
        if (!(g.fixed[y] as boolean[])[x] && i < words.length * 8) {
          ;(g.dark[y] as boolean[])[x] = (((words[i >>> 3] as number) >>> (7 - (i & 7))) & 1) === 1
          i++
        }
      }
    }
  }
}

function applyMask(g: Grid, mask: number): void {
  const f = MASKS[mask] as (y: number, x: number) => boolean
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!(g.fixed[y] as boolean[])[x] && f(y, x)) (g.dark[y] as boolean[])[x] = !(g.dark[y] as boolean[])[x]
}

/** The standard's penalty (lower is easier to read): runs, 2×2 blocks, finder look-alikes, dark balance. */
function penalty(m: readonly (readonly boolean[])[]): number {
  const n = m.length
  let score = 0
  const line = (get: (i: number) => boolean): void => {
    let run = 1
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) run++
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
    const s = Array.from({ length: n }, (_, i) => (get(i) ? '1' : '0')).join('')
    for (const p of ['10111010000', '00001011101']) for (let k = s.indexOf(p); k >= 0; k = s.indexOf(p, k + 1)) score += 40
  }
  for (let y = 0; y < n; y++) line((x) => (m[y] as boolean[])[x] as boolean)
  for (let x = 0; x < n; x++) line((y) => (m[y] as boolean[])[x] as boolean)
  let dark = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = (m[y] as boolean[])[x] as boolean
      if (c) dark++
      if (y + 1 < n && x + 1 < n && c === (m[y] as boolean[])[x + 1] && c === (m[y + 1] as boolean[])[x] && c === (m[y + 1] as boolean[])[x + 1]) score += 3
    }
  }
  const total = n * n
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}

/** The QR matrix of `text` (true = dark module), the smallest version that holds it, the best of the eight masks. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text)
  // the count field: 8 bits up to version 9, 16 from version 10
  const version = VERSIONS.findIndex((v, i) => 4 + (i + 1 <= 9 ? 8 : 16) + bytes.length * 8 <= (v.total - v.ec * v.blocks.length) * 8) + 1
  if (version === 0) throw new Error(`le lien est trop long pour un QR code (${bytes.length} octets, ${QR_MAX_BYTES} au plus)`)
  const v = VERSIONS[version - 1] as (typeof VERSIONS)[number]
  const words = codewords(dataCodewords(bytes, version, v.total - v.ec * v.blocks.length), v)
  let best: { score: number; dark: boolean[][] } | null = null
  for (let mask = 0; mask < 8; mask++) {
    const g = new Grid(17 + 4 * version)
    drawFunctionPatterns(g, version)
    drawCodewords(g, words)
    applyMask(g, mask)
    drawFormat(g, mask)
    const score = penalty(g.dark)
    if (!best || score < best.score) best = { score, dark: g.dark }
  }
  return (best as { dark: boolean[][] }).dark
}

/** The code as a PNG: `scale` pixels per module, a white 4-module quiet zone around it, opaque. */
export function qrPng(text: string, scale = 8): Uint8Array {
  const m = qrMatrix(text)
  const quiet = 4
  const side = (m.length + quiet * 2) * scale
  const rgba = new Uint8Array(side * side * 4).fill(255)
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m.length; x++) {
      if (!(m[y] as boolean[])[x]) continue
      for (let dy = 0; dy < scale; dy++) {
        const row = ((y + quiet) * scale + dy) * side
        for (let dx = 0; dx < scale; dx++) rgba.fill(0, (row + (x + quiet) * scale + dx) * 4, (row + (x + quiet) * scale + dx) * 4 + 3)
      }
    }
  }
  return encodePng({ width: side, height: side, rgba })
}
