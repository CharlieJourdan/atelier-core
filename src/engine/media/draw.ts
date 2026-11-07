// Drawn stand-in pictures (docs/ENGINE-SPEC.md §22–§23 Fake): a still (1920×1080, or 1080×1920 for a short) made by ffmpeg from a two-colour
// gradient, the item's subject in large type, its query or prompt in small type and a DÉMO watermark, so a demo film
// shows which picture each shot asked for. Colours come from the item's hash: neighbouring shots look different.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { frameSizeOf, type Aspect } from '../formats/timing'
import type { MediaService } from '../services'
import { filterPath, withShortPaths, wrapText } from './filters'
import { requireFilters } from './tools'

/** Muted documentary palette pairs (start, end) for the gradients. */
export const PALETTE: [string, string][] = [
  ['1d3557', '457b9d'],
  ['2b2d42', '8d99ae'],
  ['3d405b', '81b29a'],
  ['283618', '606c38'],
  ['432818', '99582a'],
  ['22223b', '4a4e69'],
  ['0b3954', '087e8b'],
  ['3c1518', '69140e'],
  ['1b263b', '415a77'],
  ['2f3e46', '52796f']
]

/** The filters a drawing needs: a slim ffmpeg (no freetype) fails here with a clear French message, not mid-run. */
export const DRAW_FILTERS = ['gradients', 'vignette', 'drawtext']

/** Bumped when the drawing changes, so cached drawings are made again. */
export const DRAW_VERSION = 3

export interface DrawRequest {
  out: string
  /** Hex string (an item hash): picks colours and gradient direction. */
  hash: string
  title: string
  detail: string
  /** e.g. « Image de démonstration · plan 3 » */
  footer: string
  font: string
  watermark: boolean
  /** The picture's shape; default `16:9`. A portrait still has its own layout: narrower lines, text kept inside the frame. */
  aspect?: Aspect
}

/** Where and how big the text goes, per shape (all in pixels of the still). */
const LAYOUT = {
  '16:9': { x: 240, titleSize: 88, titleChars: 30, titleDy: -90, detailSize: 34, detailChars: 70, detailDy: 120, footerY: 150, markSize: 150, markRight: 230, markY: 150 },
  '9:16': { x: 90, titleSize: 76, titleChars: 14, titleDy: -120, detailSize: 36, detailChars: 30, detailDy: 90, footerY: 240, markSize: 130, markRight: 90, markY: 150 }
} as const

export async function drawStill(media: MediaService, r: DrawRequest, signal: AbortSignal): Promise<void> {
  await requireFilters(media, DRAW_FILTERS, signal)
  const h = parseInt(r.hash.slice(0, 8), 16)
  const [c0, c1] = PALETTE[h % PALETTE.length] as [string, string]
  const diag = (h >>> 8) % 4
  const aspect = r.aspect ?? '16:9'
  const [W, H] = frameSizeOf(aspect)
  const L = LAYOUT[aspect]
  const [x0, y0, x1, y1] = [
    [0, 0, W, H],
    [W, 0, 0, H],
    [0, H, W, 0],
    [W / 2, 0, W / 2, H]
  ][diag] as number[]
  const dir = path.dirname(r.out)
  const base = path.basename(r.out, path.extname(r.out))
  const titleFile = path.join(dir, `${base}.title.txt`)
  const detailFile = path.join(dir, `${base}.detail.txt`)
  const footerFile = path.join(dir, `${base}.footer.txt`)
  await writeFile(titleFile, wrapText(r.title, L.titleChars, 3).join('\n'), 'utf8')
  await writeFile(detailFile, wrapText(r.detail, L.detailChars, 3).join('\n'), 'utf8')
  await writeFile(footerFile, r.footer, 'utf8')
  await withShortPaths([r.font, titleFile, detailFile, footerFile], async (short) => {
    const font = filterPath(short(r.font))
    const text = (file: string, size: number, colour: string, x: string, y: string): string =>
      `drawtext=fontfile=${font}:textfile=${filterPath(short(file))}:expansion=none:fontsize=${size}:fontcolor=${colour}:line_spacing=${Math.round(size / 5)}:x=${x}:y=${y}`
    const chain = [
      'format=rgb24',
      'vignette=PI/4.5',
      text(titleFile, L.titleSize, 'white', String(L.x), `(h-text_h)/2${L.titleDy < 0 ? '-' : '+'}${Math.abs(L.titleDy)}`),
      text(detailFile, L.detailSize, 'white@0.78', String(L.x + 4), `(h)/2+${L.detailDy}`),
      text(footerFile, 28, 'white@0.6', String(L.x + 4), String(L.footerY))
    ]
    if (r.watermark) chain.push(`drawtext=fontfile=${font}:text=DÉMO:expansion=none:fontsize=${L.markSize}:fontcolor=white@0.16:x=w-text_w-${L.markRight}:y=${L.markY}`)
    await media.run(
      'ffmpeg',
      [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=0x${c0}:c1=0x${c1}:x0=${x0}:y0=${y0}:x1=${x1}:y1=${y1}:nb_colors=2:d=1`,
        '-vf', chain.join(','),
        '-frames:v', '1', '-q:v', '2', r.out
      ],
      { signal }
    )
  })
}
