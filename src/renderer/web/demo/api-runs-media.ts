// Demo media for the production fixtures (api-runs*.ts): no binary file ships with the demo, so pictures are drawn as SVG
// (a gradient and a title) and sounds are synthesised as small WAV files, both made in the browser on demand. Nothing is
// fetched: the demo stays offline.

const enc = new TextEncoder()

/** A stable hue (0..359) from any text, so the same video always gets the same colours. */
export function hueOf(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return h
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Splits a title into at most three lines of ~`width` characters. */
function lines(text: string, width: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/)) {
    if (cur && (cur + ' ' + word).length > width) {
      out.push(cur)
      cur = word
    } else cur = cur ? `${cur} ${word}` : word
  }
  if (cur) out.push(cur)
  if (out.length > 3) return [...out.slice(0, 2), `${out.slice(2).join(' ').slice(0, width - 1)}…`]
  return out
}

/** A 16:9 (or 9:16) picture: gradient, soft shapes, the title and a small caption. */
export function posterSvg(title: string, caption: string, opts: { seed?: string; portrait?: boolean } = {}): string {
  const w = opts.portrait ? 720 : 1280
  const h = opts.portrait ? 1280 : 720
  const hue = hueOf(opts.seed ?? title)
  const hue2 = (hue + 48) % 360
  const size = opts.portrait ? 64 : 72
  const rows = lines(title, opts.portrait ? 14 : 22)
  const top = h / 2 - ((rows.length - 1) * size * 1.15) / 2
  const text = rows
    .map((r, i) => `<text x="${w / 2}" y="${top + i * size * 1.15}" text-anchor="middle" font-size="${size}" font-weight="700">${esc(r)}</text>`)
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 62% 22%)"/>` +
    `<stop offset="1" stop-color="hsl(${hue2} 70% 42%)"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<circle cx="${w * 0.82}" cy="${h * 0.2}" r="${h * 0.28}" fill="hsl(${hue2} 80% 70%)" opacity="0.18"/>` +
    `<circle cx="${w * 0.12}" cy="${h * 0.9}" r="${h * 0.34}" fill="hsl(${hue} 80% 60%)" opacity="0.14"/>` +
    `<g fill="#fff" font-family="Georgia, serif">${text}</g>` +
    `<text x="${w / 2}" y="${h - 48}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="26" fill="#fff" opacity="0.75">${esc(caption)}</text>` +
    `</svg>`
  )
}

export const svgDataUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
export const svgBytes = (svg: string): Uint8Array => enc.encode(svg)
export const textBytes = (text: string): Uint8Array => enc.encode(text)

const RATE = 8000

/**
 * A small mono 8-bit WAV. `voice`: a hum broken into syllables (sounds like someone speaking far away); `music`: a slow
 * three-note pad. At most `maxS` seconds are synthesised, whatever the length the fixture claims.
 */
export function toneWav(seconds: number, kind: 'voice' | 'music', maxS = 24): Uint8Array {
  const n = Math.round(Math.min(Math.max(seconds, 1), maxS) * RATE)
  const buf = new Uint8Array(44 + n)
  const view = new DataView(buf.buffer)
  const str = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i)
  }
  str(0, 'RIFF')
  view.setUint32(4, 36 + n, true)
  str(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  str(36, 'data')
  view.setUint32(40, n, true)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    let v: number
    if (kind === 'voice') {
      const syllable = Math.max(0, Math.sin(t * Math.PI * 4.2)) * (0.6 + 0.4 * Math.sin(t * 1.3))
      const pause = Math.sin(t * 0.9) > -0.85 ? 1 : 0
      const pitch = 150 + 30 * Math.sin(t * 2.1)
      v = syllable * pause * (Math.sin(2 * Math.PI * pitch * t) * 0.6 + Math.sin(4 * Math.PI * pitch * t) * 0.25)
    } else {
      const chord = Math.floor(t / 3) % 3
      const base = [220, 196, 174.6][chord] ?? 220
      v = (Math.sin(2 * Math.PI * base * t) + Math.sin(2 * Math.PI * base * 1.25 * t) * 0.7 + Math.sin(2 * Math.PI * base * 1.5 * t) * 0.5) / 2.2
    }
    const fade = Math.min(1, t * 2, (n / RATE - t) * 2)
    buf[44 + i] = Math.round(128 + v * fade * 70)
  }
  return buf
}

/** The size the fixture claims for a file (what the package lists show), from its kind and the video's length. */
export function claimedSize(name: string, durationS: number): number {
  if (/\.mp4$/.test(name)) return Math.round(durationS * 610_000)
  if (/\.wav$/.test(name)) return Math.round(durationS * 88_200)
  if (/\.(png|jpg)$/.test(name)) return 1_480_000
  if (/\.srt$/.test(name)) return Math.round(durationS * 42)
  return 2_400
}
