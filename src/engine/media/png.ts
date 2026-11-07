// A small PNG reader and writer for the frames the headless browser photographs (8-bit greyscale, RGB, grey+alpha or RGBA, not
// interlaced: what Chromium writes). The custom bricks need it to tell an empty frame from a drawn one (docs/ENGINE-SPEC.md §25.2) without a
// round trip through ffmpeg; the writer makes the test frames of the fake browsers.
import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

export interface Picture {
  width: number
  height: number
  /** width × height × 4 bytes, row by row. */
  rgba: Uint8Array
}

const be32 = (b: Uint8Array, at: number): number => ((b[at] as number) << 24) | ((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number)

/** Decodes a PNG into RGBA. Throws on anything it does not read (16-bit, palette, interlaced). */
export function decodePng(data: Uint8Array): Picture {
  if (data.length < 33 || !SIGNATURE.every((v, i) => data[i] === v)) throw new Error('not a PNG')
  let at = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat: Uint8Array[] = []
  while (at + 8 <= data.length) {
    const len = be32(data, at) >>> 0
    const type = String.fromCharCode(...data.subarray(at + 4, at + 8))
    const body = data.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = be32(body, 0) >>> 0
      height = be32(body, 4) >>> 0
      const depth = body[8]
      channels = CHANNELS[body[9] as number] ?? 0
      if (depth !== 8 || channels === 0 || body[12] !== 0) throw new Error('unsupported PNG (8-bit grey, RGB or RGBA, not interlaced, only)')
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    at += 12 + len
  }
  if (!width || !height) throw new Error('PNG without a header')
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const prev = new Uint8Array(stride)
  const line = new Uint8Array(stride)
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1)
    const filter = raw[off]
    for (let x = 0; x < stride; x++) {
      const v = raw[off + 1 + x] as number
      const a = x >= channels ? (line[x - channels] as number) : 0
      const b = prev[x] as number
      const c = x >= channels ? (prev[x - channels] as number) : 0
      let out: number
      if (filter === 0) out = v
      else if (filter === 1) out = v + a
      else if (filter === 2) out = v + b
      else if (filter === 3) out = v + ((a + b) >> 1)
      else {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      line[x] = out & 255
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = (y * width + x) * 4
      if (channels >= 3) {
        rgba[d] = line[s] as number
        rgba[d + 1] = line[s + 1] as number
        rgba[d + 2] = line[s + 2] as number
        rgba[d + 3] = channels === 4 ? (line[s + 3] as number) : 255
      } else {
        rgba[d] = rgba[d + 1] = rgba[d + 2] = line[s] as number
        rgba[d + 3] = channels === 2 ? (line[s + 1] as number) : 255
      }
    }
    prev.set(line)
  }
  return { width, height, rgba }
}

/** The share of the frame (0..1) whose pixels are visible (alpha above `alphaMin`), sampled every `step` pixels. */
export function coverage(p: Picture, alphaMin = 8, step = 2): number {
  let seen = 0
  let on = 0
  for (let y = 0; y < p.height; y += step) {
    for (let x = 0; x < p.width; x += step) {
      seen++
      if ((p.rgba[(y * p.width + x) * 4 + 3] as number) > alphaMin) on++
    }
  }
  return seen === 0 ? 0 : on / seen
}

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (const v of b) c = (CRC[(c ^ v) & 255] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, crc])
}

/** Encodes RGBA pixels as a PNG (filter 0): the frames of the fake browsers, and test pictures. */
export function encodePng(p: Picture): Uint8Array {
  const raw = Buffer.alloc((p.width * 4 + 1) * p.height)
  for (let y = 0; y < p.height; y++) Buffer.from(p.rgba.buffer, p.rgba.byteOffset + y * p.width * 4, p.width * 4).copy(raw, y * (p.width * 4 + 1) + 1)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(p.width, 0)
  ihdr.writeUInt32BE(p.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))])
}

/** A transparent picture with one opaque rectangle (a fake drawn frame); `rect` null = fully transparent. */
export function testPicture(width: number, height: number, rect: { x: number; y: number; w: number; h: number } | null): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  if (rect) {
    for (let y = rect.y; y < Math.min(height, rect.y + rect.h); y++) {
      for (let x = rect.x; x < Math.min(width, rect.x + rect.w); x++) rgba.set([240, 240, 240, 255], (y * width + x) * 4)
    }
  }
  return encodePng({ width, height, rgba })
}
