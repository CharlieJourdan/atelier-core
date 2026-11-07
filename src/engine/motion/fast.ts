// The fast draw of a graphic (motion-montage, docs/ENGINE-SPEC.md §25.4): the same pages and the same pictures as `renderGraphic`
// (render.ts), made cheaper in three ways that change nothing on screen:
//   1. an opaque card (it draws its own background) is photographed as a JPEG, an overlay with alpha as a quickly encoded PNG, both
//      through the page's DevTools session: a photographic map card costs ≈ 35 ms a frame instead of ≈ 400 ms as a plain PNG;
//   2. a frame whose state did not change (the page's key: every inline style and counted text the runtime wrote) is not photographed
//      again: the previous picture is sent once more (a card that builds then holds costs only its moving frames);
//   3. the frames are split into runs drawn by several pages at once (each page is its own renderer process), each run encoded to its
//      own file, then joined by a stream copy.
// A frame is a function of its time alone (runtime.ts), so a run can start anywhere and the join is exact. Works the same on a CPU-only
// server (the browser's software path, ffmpeg on the CPU). A page without the fast capture (a stub, a sandboxed brick) falls back to the
// classic path.
import { tempTag } from './temp-name'
import { availableParallelism } from 'node:os'
import { rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AbortError } from '../errors'
import { FPS } from '../formats/timing'
import type { BrowserPage, BrowserService, MediaService } from '../services'
import { MOTION_ENCODER, renderGraphic } from './render'

/** Fewest frames a run is worth (opening a page costs about a quarter of a second). */
export const MIN_RUN_FRAMES = 90

/** How many pages draw one graphic at once: a quarter of the machine's threads, 1 to 4. */
export const defaultPages = (): number => Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4)))

/** The runs of `frames` frames for `pages` pages: contiguous, in order, none shorter than MIN_RUN_FRAMES (unless there is only one). */
export function runsOf(frames: number, pages: number): { start: number; count: number }[] {
  const n = Math.max(1, Math.min(pages, Math.floor(frames / MIN_RUN_FRAMES)))
  const size = Math.ceil(frames / n)
  const out: { start: number; count: number }[] = []
  for (let start = 0; start < frames; start += size) out.push({ start, count: Math.min(size, frames - start) })
  return out
}

export interface FastStats {
  frames: number
  /** Frames actually photographed (the rest repeated an unchanged picture). */
  shot: number
  pages: number
}

/** ffmpeg's input arguments for frames piped as JPEG or PNG (`sub` pictures a frame: the stream runs that much faster). */
const pipeInput = (format: 'png' | 'jpeg', sub = 1): string[] => ['-f', 'image2pipe', '-framerate', String(FPS * sub), '-c:v', format === 'jpeg' ? 'mjpeg' : 'png', '-i', '-']

/**
 * Motion blur by sub-frames (a film camera's shutter): frame i is the mean of `sub` pictures taken at i/30 + k/(30·sub), k = 0…sub−1
 * (a shutter open the whole frame). ffmpeg averages each group (`tmix`) and keeps one picture in `sub`. An element that does not move is
 * unchanged by it (its sub-pictures are the same, and are not photographed again).
 */
export const blurFilter = (sub: number): string[] => (sub > 1 ? ['-vf', `tmix=frames=${sub},select='eq(mod(n,${sub}),${sub - 1})',setpts=N/(${FPS}*TB)`, '-r', String(FPS)] : [])

async function drawRun(o: {
  page: BrowserPage
  media: MediaService
  start: number
  count: number
  format: 'png' | 'jpeg'
  quality: number
  encoder: readonly string[]
  out: string
  signal: AbortSignal
  onFrame?: () => void
  /** Pictures per frame for the motion blur (1: none). */
  sub: number
}): Promise<number> {
  const capture = o.page.capture as NonNullable<BrowserPage['capture']>
  let shot = 0
  let failed: unknown = null
  const frames = (async function* (): AsyncGenerator<Uint8Array> {
    let key: string | undefined
    let last: Uint8Array | null = null
    try {
      for (let i = o.start; i < o.start + o.count; i++) {
        for (let k = 0; k < o.sub; k++) {
          if (o.signal.aborted) throw new AbortError()
          const t = i / FPS + k / (FPS * o.sub)
          const c: { key: string; image: Uint8Array | null } = await capture.call(o.page, t, { format: o.format, quality: o.quality, ...(key !== undefined && last ? { lastKey: key } : {}) })
          key = c.key
          if (c.image) {
            last = c.image
            shot++
          }
          yield last as Uint8Array
        }
        o.onFrame?.()
      }
    } catch (e) {
      failed = e
      throw e
    }
  })()
  // yuv420p from mjpeg comes in full range: the encoder converts it like the PNG path (the output's tags are the encoder's own)
  await o.media
    .run('ffmpeg', ['-v', 'error', '-y', ...pipeInput(o.format, o.sub), ...blurFilter(o.sub), ...o.encoder, '-frames:v', String(o.count), o.out], { signal: o.signal, stdin: frames })
    .catch((e: unknown) => {
      throw failed ?? e
    })
  return shot
}

/**
 * Draws a graphic like `renderGraphic` (same file, same frames), faster. `opaque`: the page draws its own background everywhere (a card),
 * so its frames go as JPEG at `quality`; otherwise PNG with alpha. Returns what it did (frames photographed, pages used).
 */
export async function renderFast(o: {
  browser: BrowserService
  media: MediaService
  html: string
  width: number
  height: number
  frames: number
  out: string
  signal: AbortSignal
  encoder?: readonly string[]
  opaque?: boolean
  quality?: number
  pages?: number
  /** Motion blur: pictures averaged per frame (1 = none; 3 = a shutter of three sub-frames). */
  motionBlur?: number
  onFrame?: (done: number) => void
}): Promise<FastStats> {
  const encoder = o.encoder ?? MOTION_ENCODER
  const format = o.opaque ? 'jpeg' : 'png'
  const quality = o.quality ?? 92
  const runs = runsOf(o.frames, o.pages ?? defaultPages())
  const ext = path.extname(o.out) || '.mov'
  // a browser without the fast capture (a stub, another host): the classic path, one page
  if (!o.browser.fastCapture) {
    await renderGraphic({ ...o, encoder, ...(o.onFrame ? { onFrame: o.onFrame } : {}) })
    return { frames: o.frames, shot: o.frames, pages: 1 }
  }
  const pages: BrowserPage[] = []
  let done = 0
  const tick = (): void => o.onFrame?.(++done)
  const tag = tempTag()
  const parts = runs.map((_, i) => `${o.out}.${tag}.run${i}${ext}`)
  try {
    for (let i = 0; i < runs.length; i++) pages.push(await o.browser.open({ html: o.html, width: o.width, height: o.height, signal: o.signal }))
    if (pages.some((p) => !p.capture)) throw new Error('a page of this browser has no fast capture')
    const shots = await Promise.all(
      runs.map((r, i) =>
        drawRun({ page: pages[i] as BrowserPage, media: o.media, start: r.start, count: r.count, format, quality, encoder, sub: Math.max(1, Math.round(o.motionBlur ?? 1)), out: runs.length === 1 ? `${o.out}.${tag}.part${ext}` : (parts[i] as string), signal: o.signal, onFrame: tick })
      )
    )
    const tmp = `${o.out}.${tag}.part${ext}`
    if (runs.length > 1) {
      const list = `${o.out}.${tag}.runs.txt`
      await writeFile(list, parts.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n')
      try {
        const faststart = encoder.includes('+faststart') ? ['-movflags', '+faststart'] : []
        await o.media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', ...faststart, tmp], { signal: o.signal })
      } finally {
        await rm(list, { force: true })
      }
    }
    await rename(tmp, o.out)
    return { frames: o.frames, shot: shots.reduce((a, b) => a + b, 0), pages: runs.length }
  } catch (e) {
    await rm(`${o.out}.${tag}.part${ext}`, { force: true })
    throw e
  } finally {
    await Promise.all(pages.map((p) => p.close().catch(() => undefined)))
    await Promise.all(parts.map((p) => rm(p, { force: true })))
  }
}
