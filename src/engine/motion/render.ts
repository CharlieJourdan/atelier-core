// Draws one graphic (docs/ENGINE-SPEC.md §25 step 4): opens its page in the browser, photographs frame 0..N-1 at 30 fps (the time of
// frame i is exactly i/30 s, so a graphic is the same whenever and in whatever order it is drawn), and pipes the transparent PNGs
// into ffmpeg, which writes an overlay-ready file with an alpha channel (ProRes 4444 in a .mov: lossless enough for flat graphics,
// read by every ffmpeg, importable in an editor). The render lays the file over the film from the frame the plan says.
import { tempTag } from './temp-name'
import { rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { AbortError } from '../errors'
import { FPS } from '../formats/timing'
import type { BrowserSandbox, BrowserService, MediaService } from '../services'

/** ffmpeg arguments that turn the piped PNG frames into the overlay file. */
export const MOTION_ENCODER = ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-qscale:v', '9', '-vendor', 'apl0']
/** Encoders the motion render needs on top of the film's own (ProRes for the overlay file, PNG to read the frames). */
export const MOTION_ENCODERS = ['prores_ks']
/** An opaque full-frame card (the channel promo): H.264, nearly lossless, plays everywhere. */
export const CARD_ENCODER = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']

export async function renderGraphic(o: {
  browser: BrowserService
  media: MediaService
  html: string
  width: number
  height: number
  frames: number
  out: string
  signal: AbortSignal
  onFrame?: (done: number) => void
  /** A page of untrusted content (a custom brick): sandboxed, with its time budgets. */
  sandbox?: BrowserSandbox
  /** Sees each photographed frame (the custom bricks check that something is drawn). */
  onPng?: (index: number, png: Uint8Array) => void
  /** ffmpeg's output arguments; default the overlay's ProRes 4444 with alpha (an opaque card, the promo, uses H.264). */
  encoder?: readonly string[]
}): Promise<{ console: string[]; blocked: string[] }> {
  const page = await o.browser.open({ html: o.html, width: o.width, height: o.height, signal: o.signal, ...(o.sandbox ? { sandbox: o.sandbox } : {}) })
  const tmp = `${o.out}.${tempTag()}.part${path.extname(o.out) || '.mov'}`
  // a frame that fails stops the pipe: its own error is the one to report, not ffmpeg's broken input
  let failed: unknown = null
  try {
    const frames = (async function* (): AsyncGenerator<Uint8Array> {
      try {
        for (let i = 0; i < o.frames; i++) {
          if (o.signal.aborted) throw new AbortError()
          const png = await page.frame(i / FPS)
          o.onPng?.(i, png)
          yield png
          o.onFrame?.(i + 1)
        }
      } catch (e) {
        failed = e
        throw e
      }
    })()
    await o.media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', ...(o.encoder ?? MOTION_ENCODER), '-frames:v', String(o.frames), tmp], {
      signal: o.signal,
      stdin: frames
    }).catch((e: unknown) => {
      throw failed ?? e
    })
    await rename(tmp, o.out)
    return page.problems?.() ?? { console: [], blocked: [] }
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  } finally {
    await page.close().catch(() => undefined)
  }
}
