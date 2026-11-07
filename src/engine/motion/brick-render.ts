// Drawing a custom brick (docs/ENGINE-SPEC.md §25.2), always in a sandboxed page of the host's browser service: for a film (`drawBrick`, used
// by `motion.render`: the overlay file, like our templates, with a check that something is drawn) and for the agent that writes it
// (`previewBrick`: stills at given moments, laid-out text measured, a short clip over a neutral grey, and the lint). A brick that throws, overruns
// its time budget or draws nothing fails with a permanent error that names it; the preview reports the same problems to the agent instead of
// throwing, so it can fix them.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AbortError, EngineError, isAbortError } from '../errors'
import { resolveValues, staticProblems, customTemplate, type Brick, type BrickValues } from '../formats/brick'
import { FPS } from '../formats/timing'
import { coverage, decodePng } from '../media/png'
import type { BrowserSandbox, BrowserService, MediaService } from '../services'
import type { MotionCtx } from './base'
import { EMPTY_BELOW, lintBrick, type LintIssue, type StillFacts } from './brick-lint'
import { brickPage } from './brick-page'
import { renderGraphic } from './render'

/** Time budgets of a brick's page: to load and start, and per frame (set the time and photograph). */
export const BRICK_SANDBOX: BrowserSandbox = { loadMs: 8000, frameMs: 2500 }
/** Frames checked for drawn pixels while a film's overlay is made (every Nth, plus the middle one). */
const CHECK_EVERY = 15

export const brickLabel = (b: Pick<Brick, 'id' | 'name' | 'version'>): string => `« ${b.name} » (${customTemplate(b.id)} v${b.version})`

/** A brick's problem as a permanent error that names it (French: the person may read it). */
export function brickError(b: Pick<Brick, 'id' | 'name' | 'version'>, why: string): EngineError {
  return new EngineError('bad_input', `La brique ${brickLabel(b)} n’a pas pu être dessinée : ${why}`)
}

/** The overlay file of one brick in a film: ProRes 4444 with alpha, `frames` frames at 30 fps, drawn in a sandboxed page. */
export async function drawBrick(o: {
  brick: Brick
  values: BrickValues
  ctx: MotionCtx
  look: { accent: string; theme: 'dark' | 'light' }
  browser: BrowserService
  media: MediaService
  frames: number
  out: string
  signal: AbortSignal
  sandbox?: BrowserSandbox
}): Promise<{ console: string[]; blocked: string[] }> {
  const bad = staticProblems(o.brick)
  if (bad.length > 0) throw brickError(o.brick, bad.join(' ; '))
  const html = brickPage(o.brick, o.values, o.ctx, o.look)
  const mid = Math.floor(o.frames / 2)
  let drawn = 0
  try {
    const found = await renderGraphic({
      browser: o.browser,
      media: o.media,
      html,
      width: o.ctx.width,
      height: o.ctx.height,
      frames: o.frames,
      out: o.out,
      signal: o.signal,
      sandbox: o.sandbox ?? BRICK_SANDBOX,
      onPng: (i, png) => {
        if (i !== mid && i % CHECK_EVERY !== 0) return
        drawn = Math.max(drawn, coverage(decodePng(png)))
      }
    })
    if (drawn < EMPTY_BELOW) {
      await rm(o.out, { force: true })
      throw brickError(o.brick, 'elle ne dessine rien (toutes les images vérifiées sont vides)')
    }
    return found
  } catch (e) {
    // the page's own failures (it threw, overran its budget, never started) are the brick's: permanent, named. A crashed browser or ffmpeg
    // is the machine's: thrown as it is, so the node retries with a fresh page.
    if (e instanceof EngineError && e.code === 'bad_input' && !e.message.startsWith('La brique')) throw brickError(o.brick, e.message)
    throw e
  }
}

export interface BrickStill {
  /** Share of the duration (0..1) and its time (s). */
  share: number
  t: number
  /** The transparent frame as the browser drew it. */
  png: string
  /** The same over a neutral grey, 768 px wide: what the agent and Charlie look at (null without ffmpeg). */
  jpeg: string | null
  coverage: number
}

export interface BrickPreview {
  stills: BrickStill[]
  /** A short MP4 over a neutral grey (null when not asked or not made). */
  clip: string | null
  lint: LintIssue[]
  console: string[]
  blocked: string[]
  /** The page failed (threw, overran, never started): the reason; the lint says it too. */
  error: string | null
  seconds: number
  ms: number
}

const GREY = '0x2b2f38'

/** A still over the grey, scaled down to `width` (JPEG). */
async function jpegOf(media: MediaService, png: string, out: string, w: number, h: number, width: number, signal: AbortSignal): Promise<void> {
  await media.run(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${GREY}:s=${w}x${h}:d=1`, '-i', png, '-filter_complex', `[0:v][1:v]overlay=0:0:format=auto,scale=${width}:-2`, '-frames:v', '1', '-q:v', '4', out],
    { signal }
  )
}

/**
 * The preview the agent asks for: `shares` stills (0 %, 50 %, 100 % by default) with the text measured at each, then a clip of the whole
 * brick (`clip`), the console and the blocked requests, and the lint. Values = the brick's sample with `values` over it. Throws only when the
 * browser is missing (or on a cancel); every problem of the brick itself is in the answer.
 */
export async function previewBrick(o: {
  brick: Brick
  values?: Record<string, unknown>
  size: [number, number]
  look: { accent: string; theme: 'dark' | 'light' }
  fontCss: string
  browser: BrowserService
  media: MediaService | null
  outDir: string
  signal: AbortSignal
  shares?: number[]
  clip?: boolean
  seconds?: number
  sandbox?: BrowserSandbox
}): Promise<BrickPreview> {
  const started = Date.now()
  const b = o.brick
  const [width, height] = o.size
  const seconds = Math.min(b.seconds.max, Math.max(b.seconds.min, o.seconds ?? b.use?.seconds ?? Math.min(4, b.seconds.max)))
  const empty = (error: string, lint: LintIssue[]): BrickPreview => ({ stills: [], clip: null, lint, console: [], blocked: [], error, seconds, ms: Date.now() - started })
  const bad = staticProblems(b)
  if (bad.length > 0) return empty(bad.join(' ; '), bad.map((m) => ({ rule: 'console', message: m })))
  const resolved = resolveValues(b, { ...b.sample, ...(o.values ?? {}) })
  if (!resolved.ok) return empty(resolved.problems.join(' ; '), resolved.problems.map((m) => ({ rule: 'console', message: m })))
  const ctx: MotionCtx = { width, height, durationS: seconds, fontCss: o.fontCss }
  const html = brickPage(b, resolved.values, ctx, o.look)
  const sandbox = o.sandbox ?? BRICK_SANDBOX
  const frames = Math.max(1, Math.round(seconds * FPS))
  await mkdir(o.outDir, { recursive: true })
  const stills: BrickStill[] = []
  const facts: StillFacts[] = []
  let found = { console: [] as string[], blocked: [] as string[] }
  let error = null as string | null
  const page = await o.browser.open({ html, width, height, signal: o.signal, sandbox }).catch((e: unknown) => {
    if (isAbortError(e) || (e instanceof EngineError && e.code === 'missing_tool')) throw e
    error = (e as Error).message
    return null
  })
  if (page) {
    try {
      for (const share of o.shares ?? [0, 0.5, 1]) {
        if (o.signal.aborted) throw new AbortError()
        const t = Math.min(share * seconds, (frames - 1) / FPS)
        const png = await page.frame(t)
        const inspection = page.inspect ? await page.inspect() : null
        const file = path.join(o.outDir, `still-${String(Math.round(share * 100)).padStart(3, '0')}.png`)
        await writeFile(file, png)
        const cov = coverage(decodePng(png))
        stills.push({ share, t, png: file, jpeg: null, coverage: cov })
        facts.push({ share, t, coverage: cov, inspection })
      }
    } catch (e) {
      if (isAbortError(e) || (e instanceof EngineError && e.code === 'missing_tool')) throw e
      error = (e as Error).message
    } finally {
      found = page.problems?.() ?? found
      await page.close().catch(() => undefined)
    }
  }
  if (o.media) for (const s of stills) {
    const jpeg = s.png.replace(/\.png$/, '.jpg')
    await jpegOf(o.media, s.png, jpeg, width, height, 768, o.signal)
    s.jpeg = jpeg
  }
  let clip: string | null = null
  if (o.clip !== false && o.media && error === null) {
    const tmp = path.join(o.outDir, 'clip.mov')
    try {
      await renderGraphic({ browser: o.browser, media: o.media, html, width, height, frames, out: tmp, signal: o.signal, sandbox })
      clip = path.join(o.outDir, 'clip.mp4')
      await o.media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${GREY}:s=${width}x${height}:r=${FPS}`, '-i', tmp, '-filter_complex', `[0:v][1:v]overlay=0:0:shortest=1:format=auto,scale=${Math.min(width, 960)}:-2,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-movflags', '+faststart', '-frames:v', String(frames), clip], { signal: o.signal })
    } catch (e) {
      if (isAbortError(e) || (e instanceof EngineError && e.code === 'missing_tool')) throw e
      error = (e as Error).message
      clip = null
    } finally {
      await rm(tmp, { force: true })
    }
  }
  const lint = lintBrick({ stills: facts, width, height, console: found.console, blocked: found.blocked })
  if (error !== null) lint.unshift({ rule: 'console', message: `the page failed: ${error}` })
  return { stills, clip, lint, console: found.console, blocked: found.blocked, error, seconds, ms: Date.now() - started }
}
