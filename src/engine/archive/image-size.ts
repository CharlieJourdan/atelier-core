// Reads the size of a picture from the first bytes of its file (JPEG, PNG, WebP): the Internet Archive and the Met do not say
// how big their files are, and the search must not hand out a thumbnail.

export interface ImageSize {
  width: number
  height: number
  mime: string
}

export function imageSize(b: Uint8Array): ImageSize | undefined {
  if (b.length < 24) return undefined
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  // PNG: signature, then IHDR width/height
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: dv.getUint32(16), height: dv.getUint32(20), mime: 'image/png' }
  // JPEG: walk the markers up to a start-of-frame
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const marker = b[i + 1]!
      if (marker === 0xff) {
        i++
        continue
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      const len = dv.getUint16(i + 2)
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5), mime: 'image/jpeg' }
      i += 2 + len
    }
    return undefined
  }
  // WebP: RIFF....WEBP then VP8 / VP8L / VP8X
  const tag = (o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!)
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP' && b.length >= 30) {
    const fmt = tag(12)
    if (fmt === 'VP8X') return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)), mime: 'image/webp' }
    if (fmt === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff, mime: 'image/webp' }
    if (fmt === 'VP8L') {
      const bits = dv.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, mime: 'image/webp' }
    }
  }
  return undefined
}
