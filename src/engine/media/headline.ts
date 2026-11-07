// A thumbnail's headline, laid out by us (docs/ENGINE-SPEC.md §29 step 5): the picture is cover-cropped to 1280×720, a dark
// scrim (or a solid band) is laid behind the text, and the headline is drawn in the heavy Inter face with a thick outline, in
// capitals on at most two lines, as large as the width allows. Deterministic: the same inputs give the same pixels. The
// image models are told to draw NO text (they spell badly); the words are always ours.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { MediaService } from '../services'
import { filterPath, withShortPaths, wrapText } from './filters'
import { PALETTE } from './draw'
import { requireFilters } from './tools'

export const THUMB_W = 1280
export const THUMB_H = 720
/** Filters the headline needs (a slim ffmpeg without freetype fails here with a clear French message). */
export const HEADLINE_FILTERS = ['drawtext', 'drawbox']
export const HEADLINE_LAYOUTS = ['scrim', 'band'] as const
export type HeadlineLayout = (typeof HEADLINE_LAYOUTS)[number]
export type HeadlinePosition = 'top' | 'middle' | 'bottom'

/** Side margin of the text block; the block is at most THUMB_W - 2 × this wide. */
const MARGIN_X = 80
const MARGIN_Y = 52
/** Width of an Inter Bold capital as a share of the font size, kept on the safe side (the real average is about 0.66). */
const CAP_WIDTH = 0.72
const MIN_SIZE = 72
const MAX_SIZE = 150
/** Two lines are capped lower so the block stays under about half of the picture. */
const MAX_SIZE_TWO_LINES = 128

export interface HeadlineBlock {
  lines: string[]
  size: number
  /** The text block's height in pixels. */
  height: number
}

/** Capitals on one line, or two lines balanced at a space; the font size is the largest that fits the width. */
export function layoutHeadline(text: string): HeadlineBlock {
  const caps = text.toUpperCase().replace(/\s+/g, ' ').trim()
  const limit = THUMB_W - 2 * MARGIN_X
  const sizeFor = (lines: string[]): number => Math.floor(limit / (Math.max(...lines.map((l) => l.length), 1) * CAP_WIDTH))
  let lines = [caps]
  if (caps.length > 14 || sizeFor(lines) < 110) {
    // balanced split: the cut nearest the middle
    const words = caps.split(' ')
    if (words.length >= 2) {
      let best = 1
      let gap = Infinity
      for (let i = 1; i < words.length; i++) {
        const left = words.slice(0, i).join(' ').length
        const right = words.slice(i).join(' ').length
        if (Math.abs(left - right) < gap) {
          gap = Math.abs(left - right)
          best = i
        }
      }
      lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')]
    }
  }
  if (lines.length > 2) lines = wrapText(caps, Math.ceil(caps.length / 2), 2)
  const size = Math.max(MIN_SIZE, Math.min(lines.length > 1 ? MAX_SIZE_TWO_LINES : MAX_SIZE, sizeFor(lines)))
  return { lines, size, height: Math.round(lines.length * size * 1.12) }
}

export interface HeadlineRequest {
  /** The art (any size); omitted: a drawn gradient background (demo and tests) chosen by `hash`. */
  src?: string
  out: string
  /** Hex string: picks the demo background. */
  hash: string
  text: string
  position: HeadlinePosition
  layout: HeadlineLayout
  font: string
  watermark: boolean
}

export async function composeThumbnail(media: MediaService, r: HeadlineRequest, signal: AbortSignal): Promise<HeadlineBlock> {
  await requireFilters(media, r.src ? HEADLINE_FILTERS : [...HEADLINE_FILTERS, 'gradients'], signal)
  const block = layoutHeadline(r.text)
  const dir = path.dirname(r.out)
  const base = path.basename(r.out, path.extname(r.out))
  const textFile = path.join(dir, `${base}.headline.txt`)
  await writeFile(textFile, block.lines.join('\n'), 'utf8')
  const y0 = r.position === 'top' ? MARGIN_Y : r.position === 'middle' ? Math.round((THUMB_H - block.height) / 2) : THUMB_H - MARGIN_Y - block.height
  const pad = 26
  const chain: string[] = r.src ? [`scale=${THUMB_W}:${THUMB_H}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${THUMB_W}:${THUMB_H}`, 'format=rgb24'] : ['format=rgb24', 'vignette=PI/4.5']
  // behind the words: a dark scrim across the picture, or a solid band of the brand yellow with black words
  const band = r.layout === 'band'
  chain.push(`drawbox=x=0:y=${Math.max(0, y0 - pad)}:w=iw:h=${block.height + 2 * pad}:color=${band ? '0xFFD400@1' : '0x000000@0.58'}:t=fill`)
  const h = parseInt(r.hash.slice(0, 8), 16)
  const [c0, c1] = PALETTE[h % PALETTE.length] as [string, string]
  const input = r.src
    ? ['-i', r.src]
    : ['-f', 'lavfi', '-i', `gradients=s=${THUMB_W}x${THUMB_H}:c0=0x${c0}:c1=0x${c1}:x0=0:y0=0:x1=${THUMB_W}:y1=${THUMB_H}:nb_colors=2:d=1`]
  await withShortPaths([r.font, textFile], async (short) => {
    const font = filterPath(short(r.font))
    chain.push(
      `drawtext=fontfile=${font}:textfile=${filterPath(short(textFile))}:expansion=none:fontsize=${block.size}:fontcolor=${band ? '0x111111' : 'white'}:line_spacing=${Math.round(block.size * 0.12)}` +
        `:borderw=${band ? 0 : Math.max(6, Math.round(block.size / 12))}:bordercolor=black@0.95:x=(w-text_w)/2:y=${y0}`
    )
    if (r.watermark) chain.push(`drawtext=fontfile=${font}:text=DÉMO:expansion=none:fontsize=110:fontcolor=white@0.16:x=w-text_w-40:y=30`)
    await media.run('ffmpeg', ['-v', 'error', '-y', ...input, '-vf', chain.join(','), '-frames:v', '1', r.out], { signal })
  })
  return block
}
