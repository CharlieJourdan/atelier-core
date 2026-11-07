// Terrain tiles made light for the 3D map page (motion/map3d-data.ts): a Terrarium PNG (elevation = R·256 + G + B/256 − 32768 metres) is
// decoded, the sea floor is set to sea level (the imagery already shows the depths; a raised terrain must not dig the sea), heights are
// rounded to `step` metres, and the tile is written again as an RGB PNG with the « Up » filter. A sea tile becomes a few hundred bytes and a
// land tile about half its size. A small PNG reader/writer (8-bit RGB / RGBA, not interlaced: what the tile servers send), Node's zlib only.
import { deflateSync, inflateSync } from 'node:zlib'

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf: Uint8Array): number {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = (CRC[(c ^ (buf[i] as number)) & 0xff] as number) ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** An 8-bit RGB or RGBA picture's pixels (`channels` bytes each, row after row). */
export interface Pixels {
  width: number
  height: number
  channels: 3 | 4
  data: Uint8Array
}

/** Reads an 8-bit, not interlaced, RGB or RGBA PNG. Throws on anything else. */
export function decodePng(png: Uint8Array): Pixels {
  const b = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  if (!b.subarray(0, 8).equals(SIG)) throw new Error('not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  let channels: 3 | 4 = 3
  const idat: Buffer[] = []
  while (pos < b.length) {
    const len = b.readUInt32BE(pos)
    const type = b.toString('latin1', pos + 4, pos + 8)
    const body = b.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const depth = body[8]
      const colour = body[9]
      if (depth !== 8 || (colour !== 2 && colour !== 6) || body[12] !== 0) throw new Error(`unsupported PNG (depth ${depth}, colour ${colour}, interlace ${body[12]})`)
      channels = colour === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const data = new Uint8Array(width * height * channels)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)] as number
    const src = y * (stride + 1) + 1
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x] as number
      const a = x >= channels ? (data[row + x - channels] as number) : 0
      const up = y > 0 ? (data[row - stride + x] as number) : 0
      const ul = y > 0 && x >= channels ? (data[row - stride + x - channels] as number) : 0
      let out = v
      if (f === 1) out = v + a
      else if (f === 2) out = v + up
      else if (f === 3) out = v + ((a + up) >> 1)
      else if (f === 4) {
        const p = a + up - ul
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - ul)
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul)
      }
      data[row + x] = out & 0xff
    }
  }
  return { width, height, channels, data }
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, crc])
}

/** Writes an 8-bit RGB PNG, every row « Up »-filtered (smooth elevations compress best that way). */
export function encodePngRgb(width: number, height: number, rgb: Uint8Array): Buffer {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 2
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = ((rgb[y * stride + x] as number) - (y > 0 ? (rgb[(y - 1) * stride + x] as number) : 0)) & 0xff
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))])
}

/** Terrarium elevation of one pixel (metres). */
export const terrarium = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768

/** A Terrarium tile with the sea floor at 0 m and heights rounded to `step` metres, as a lighter PNG. */
export function lightenDem(png: Uint8Array, step = 5): Buffer {
  const px = decodePng(png)
  const n = px.width * px.height
  const out = new Uint8Array(n * 3)
  for (let i = 0; i < n; i++) {
    const o = i * px.channels
    const e = Math.max(0, Math.round(terrarium(px.data[o] as number, px.data[o + 1] as number, px.data[o + 2] as number) / step) * step)
    const v = e + 32768
    out[i * 3] = Math.floor(v / 256)
    out[i * 3 + 1] = v % 256
    out[i * 3 + 2] = 0
  }
  return encodePngRgb(px.width, px.height, out)
}
