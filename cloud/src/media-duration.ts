// The real length of an uploaded voice, read by the Cloud itself (decision 0076). A talking-avatar quote is priced on the
// `seconds` the client declares, while the provider renders (and bills) the whole audio: a quote may never declare less
// than the file really lasts. Only WAV is read (the app always sends one, src/engine/presenter/talk.ts and
// nodes/avatar-speak.ts). The length is an upper bound taken from the header and the file size, so a header that declares
// a short `data` chunk, or chunks after it, can only make the file look longer, never shorter.

/** The bytes of a file's start the Cloud reads to find the WAV header (the `data` chunk comes after `fmt `, maybe `LIST`). */
export const WAV_HEAD_BYTES = 64 * 1024

/** PCM, IEEE float and WAVE_FORMAT_EXTENSIBLE: formats whose byte rate follows from rate × channels × sample size. */
const PCM_TAGS = new Set([1, 3, 0xfffe])

/** Seconds of a WAV file of `size` bytes whose first bytes are `head`; null when it is not a PCM WAV this can read. */
export function wavSeconds(head: Uint8Array, size: number): number | null {
  const b = Buffer.from(head.buffer, head.byteOffset, head.byteLength)
  if (b.length < 12 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null
  let byteRate = 0
  for (let at = 12; at + 8 <= b.length; ) {
    const id = b.toString('ascii', at, at + 4)
    const len = b.readUInt32LE(at + 4)
    const body = at + 8
    if (id === 'fmt ') {
      if (body + 16 > b.length) return null
      const tag = b.readUInt16LE(body)
      const channels = b.readUInt16LE(body + 2)
      const rate = b.readUInt32LE(body + 4)
      const bits = b.readUInt16LE(body + 14)
      if (!PCM_TAGS.has(tag) || channels < 1 || rate < 1000 || bits < 8 || bits % 8 !== 0) return null
      byteRate = rate * channels * (bits / 8)
    } else if (id === 'data') {
      if (byteRate === 0) return null
      return Math.max(0, size - body) / byteRate
    }
    at = body + len + (len % 2)
  }
  return null
}
