// The editing bricks' drawings (production-9), made by ffmpeg with our own font, no browser and no picture to fetch: the chapter mark
// that pops at the top right when a numbered part starts (Charlie, 10-31: « les chapitres en haut à droite qui pop »), and the
// sponsor's card (product, pitch, link) laid over the picture during a mention. Both are PNGs with transparency; the QR code is its
// own PNG (media/qr.ts), placed by the render. Text is always drawn from a text file (filters.ts).
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CHAPTER_LOOKS, CHAPTER_POSITIONS } from '../../shared/brick-styles'
import type { MediaService } from '../services'
import { ffColour, filterPath, withShortPaths, wrapText } from './filters'

/** Where a chapter mark sits, and how it looks (the `edit` style's settings, pipeline-avatar §2.12). */
export { CHAPTER_LOOKS, CHAPTER_POSITIONS }
export type ChapterPosition = (typeof CHAPTER_POSITIONS)[number]
export type ChapterLook = (typeof CHAPTER_LOOKS)[number]

export const MARK_FILTERS = ['drawtext', 'geq', 'alphamerge', 'overlay']

export interface Fonts {
  bold: string
  semi: string
}

/** A soft-edged rounded rectangle as an alpha mask (`opacity` 0..1), `w`×`h`, radius `r`. */
const roundMask = (w: number, h: number, r: number, opacity = 1): string =>
  `color=c=black:s=${w}x${h}:d=1,format=gray,geq=lum='clip(${(255 * opacity).toFixed(1)}*(${r}+0.5-hypot(max(max(${r}-X,X-${w - 1 - r}),0),max(max(${r}-Y,Y-${h - 1 - r}),0))),0,${Math.round(255 * opacity)})'`

const text = (font: string, file: string, size: number, colour: string, x: string, y: string, spacing = 0): string =>
  `drawtext=fontfile=${filterPath(font)}:textfile=${filterPath(file)}:expansion=none:fontsize=${size}:fontcolor=${colour}:line_spacing=${spacing}:x=${x}:y=${y}`

/** About how wide a line of Inter is, in pixels (wide on purpose: a mark never cuts its text). */
export const textWidth = (s: string, size: number, bold = true): number => Math.ceil([...s].length * size * (bold ? 0.58 : 0.52)) + 4

/** Black on a light accent, white on a dark one. */
function inkOn(accent: string): string {
  const n = parseInt(accent.replace('#', ''), 16)
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
  return lum > 150 ? '0x111111' : 'white'
}

export interface ChapterMark {
  /** The number shown (and an optional word before it: « Astuce 2 »). */
  label: string
  title: string
  look: ChapterLook
  position: ChapterPosition
  accent: string
  /** The film's frame, `[width, height]`. */
  frame: readonly [number, number]
}

/** The mark's size and where it goes on the frame (pixels). */
export function chapterBox(m: ChapterMark, titleLine: string): { w: number; h: number; x: number; y: number; badge: number; size: number } {
  const [W, H] = m.frame
  const portrait = H > W
  const size = portrait ? 38 : 36
  const h = m.position === 'bottom-band' ? Math.round(size * 2.6) : Math.round(size * 2.3)
  const badge = Math.max(h, textWidth(m.label, size) + 40)
  const titleW = titleLine ? textWidth(titleLine, size, false) + 56 : 0
  const margin = Math.round(W * (portrait ? 0.05 : 0.035))
  const w = m.position === 'bottom-band' ? W : Math.min(W - 2 * margin, badge + titleW)
  const top = portrait ? Math.max(180, Math.round(H * 0.08)) : margin
  const x = m.position === 'top-right' ? W - margin - w : m.position === 'bottom-band' ? 0 : margin
  const y = m.position === 'lower-third' ? Math.round(H * 0.72) : m.position === 'bottom-band' ? Math.round(H * (portrait ? 0.7 : 0.78)) : top
  return { w, h, x, y, badge, size }
}

/** Draws one chapter mark to `out` (a PNG with transparency); returns its box on the frame. */
export async function drawChapterMark(media: MediaService, m: ChapterMark, fonts: Fonts, dir: string, out: string, signal: AbortSignal): Promise<{ x: number; y: number; w: number; h: number }> {
  const portrait = m.frame[1] > m.frame[0]
  const titleLine = m.title ? (wrapText(m.title, portrait ? 26 : 40, 1)[0] ?? '') : ''
  const b = chapterBox(m, titleLine)
  const base = path.basename(out, '.png')
  const labelFile = path.join(dir, `${base}.label.txt`)
  const titleFile = path.join(dir, `${base}.title.txt`)
  await Promise.all([writeFile(labelFile, m.label, 'utf8'), writeFile(titleFile, titleLine || ' ', 'utf8')])
  const r = m.look === 'pill' ? Math.round(b.h / 2) : 6
  const panel = m.look === 'pill' ? '0x111111' : ffColour(m.accent)
  const badgeColour = m.look === 'pill' ? ffColour(m.accent) : '0x111111'
  const badgeInk = m.look === 'pill' ? inkOn(m.accent) : ffColour(m.accent)
  const titleInk = m.look === 'pill' ? 'white' : inkOn(m.accent)
  const midY = `(${b.h}-text_h)/2`
  await withShortPaths([fonts.bold, labelFile, ...(titleLine ? [fonts.semi, titleFile] : [])], async (short) => {
    const graph = [
      `color=c=${panel}:s=${b.w}x${b.h}:d=1,format=rgb24[p]`,
      `${roundMask(b.w, b.h, m.position === 'bottom-band' ? 0 : r, m.look === 'pill' ? 0.88 : 1)}[pm]`,
      '[p][pm]alphamerge,format=rgba[panel]',
      `color=c=${badgeColour}:s=${b.badge}x${b.h}:d=1,format=rgb24[b]`,
      `${roundMask(b.badge, b.h, m.position === 'bottom-band' ? 0 : r)}[bm]`,
      '[b][bm]alphamerge,format=rgba[badge]',
      [
        '[panel][badge]overlay=0:0:format=auto',
        text(short(fonts.bold), short(labelFile), b.size, badgeInk, `(${b.badge}-text_w)/2`, midY),
        ...(titleLine ? [text(short(fonts.semi), short(titleFile), b.size, titleInk, String(b.badge + 28), midY)] : []),
        'format=rgba[out]'
      ].join(',')
    ].join(';')
    await media.run('ffmpeg', ['-v', 'error', '-y', '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-pix_fmt', 'rgba', out], { signal })
  })
  return { x: b.x, y: b.y, w: b.w, h: b.h }
}

export interface SponsorCard {
  /** The small line above the name (« Partenaire »). */
  kicker: string
  name: string
  pitch: string
  link: string
  accent: string
  frame: readonly [number, number]
  /** The part of the frame the QR code takes (the text keeps clear of it). */
  qr?: { x: number; y: number; w: number; h: number } | null
}

/**
 * The sponsor's card: the whole frame darkened (the picture barely shows through, the presenter keeps talking under it), a short accent
 * bar, the kicker, the product's name in large type, the pitch and the link, set on the left and centred in height.
 */
export async function drawSponsorCard(media: MediaService, c: SponsorCard, fonts: Fonts, dir: string, out: string, signal: AbortSignal): Promise<void> {
  const [W, H] = c.frame
  const portrait = H > W
  const x = Math.round(W * (portrait ? 0.08 : 0.085))
  // the text column stops before the QR code when the code sits beside it
  const qrLeft = c.qr && c.qr.x > W / 2 && (!portrait || c.qr.y < H * 0.62) ? c.qr.x - Math.round(W * 0.04) : W - x
  const columnPx = Math.max(W * 0.4, qrLeft - x)
  const nameSize = portrait ? 84 : 96
  const pitchSize = portrait ? 42 : 44
  const name = wrapText(c.name, Math.max(8, Math.floor(columnPx / (nameSize * 0.6))), 2)
  const pitch = c.pitch ? wrapText(c.pitch, Math.max(12, Math.floor(columnPx / (pitchSize * 0.56))), 3) : []
  const files = { kicker: path.join(dir, 'card.kicker.txt'), name: path.join(dir, 'card.name.txt'), pitch: path.join(dir, 'card.pitch.txt'), link: path.join(dir, 'card.link.txt') }
  await Promise.all([
    writeFile(files.kicker, c.kicker.toUpperCase(), 'utf8'),
    writeFile(files.name, name.join('\n'), 'utf8'),
    writeFile(files.pitch, pitch.join('\n') || ' ', 'utf8'),
    writeFile(files.link, c.link || ' ', 'utf8')
  ])
  const nameLine = Math.round(nameSize * 1.12)
  const pitchLine = Math.round(pitchSize * 1.3)
  const block = 34 + 30 + name.length * nameLine + 26 + pitch.length * pitchLine + (c.link ? 30 + 46 : 0)
  const top = Math.round((portrait ? H * 0.36 : H / 2) - block / 2)
  const yKicker = top + 34 + 30
  const yName = yKicker + 34 + 28
  const yPitch = yName + name.length * nameLine + 26
  const yLink = yPitch + pitch.length * pitchLine + 30
  const accent = ffColour(c.accent)
  await withShortPaths([fonts.bold, fonts.semi, ...Object.values(files)], async (short) => {
    const graph = [
      `color=c=0x0B0B0F:s=${W}x${H}:d=1,format=rgb24[bg]`,
      `color=c=black:s=${W}x${H}:d=1,format=gray,geq=lum='clip(228+20*(X/W),0,248)'[m]`,
      '[bg][m]alphamerge,format=rgba[scrim]',
      [
        '[scrim]drawbox=x=' + x + ':y=' + top + ':w=' + (portrait ? 120 : 140) + ':h=10:color=' + accent + ':t=fill',
        text(short(fonts.bold), short(files.kicker), portrait ? 30 : 32, accent, String(x), String(yKicker)),
        text(short(fonts.bold), short(files.name), nameSize, 'white', String(x), String(yName), nameLine - nameSize),
        ...(pitch.length > 0 ? [text(short(fonts.semi), short(files.pitch), pitchSize, '0xD6D6DE', String(x), String(yPitch), pitchLine - pitchSize)] : []),
        ...(c.link ? [text(short(fonts.semi), short(files.link), portrait ? 38 : 40, accent, String(x), String(yLink))] : []),
        'format=rgba[out]'
      ].join(',')
    ].join(';')
    await media.run('ffmpeg', ['-v', 'error', '-y', '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-pix_fmt', 'rgba', out], { signal })
  })
}

/** Where the QR code goes, its side rounded down to whole pixels per module (`modules` with the quiet zone). */
export function qrBox(position: string, size: number, frame: readonly [number, number], modules: number): { x: number; y: number; w: number; h: number; scale: number } {
  const [W, H] = frame
  const portrait = H > W
  const want = Math.round(Math.min(W, H) * (portrait ? Math.min(0.5, size * 1.6) : size))
  const scale = Math.max(2, Math.floor(want / modules))
  const side = scale * modules
  const margin = Math.round(W * (portrait ? 0.06 : 0.045))
  const right = W - margin - side
  // a phone keeps its bottom 22 % for its own buttons and captions
  const bottom = portrait ? Math.round(H * 0.78) - side : H - margin - side
  const top = portrait ? Math.max(180, Math.round(H * 0.08)) : margin
  const pos: Record<string, { x: number; y: number }> = {
    'bottom-right': { x: right, y: bottom },
    'top-right': { x: right, y: top },
    'bottom-left': { x: margin, y: bottom },
    'top-left': { x: margin, y: top },
    'center-right': { x: right, y: Math.round((H - side) / 2) }
  }
  const p = pos[position] ?? (pos['bottom-right'] as { x: number; y: number })
  return { ...p, w: side, h: side, scale }
}
