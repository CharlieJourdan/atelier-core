// Animated overlays in the render (docs/ENGINE-SPEC.md §25, §28): `render.assemble` lays each `motion.render` file over the base track from its
// first frame to its last, under the captions. Real ffmpeg, pixel checks on tiny hand-made overlays (a blue rectangle, a half-transparent green
// sheet): the frame before, the first and last frames, the frame after, the blending of a transparent overlay, and the captions that stay on top
// of an overlay that covers them. Skipped, with the reason, where ffmpeg lacks what the render needs (or ProRes).
import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Artefact } from '../../src/engine'
import { EDITPLAN_SCHEMA, type EditPlan, type Shot } from '../../src/engine/formats/editplan'
import { probe } from '../../src/engine/media/probe'
import { renderAssemble, RenderParams } from '../../src/engine/nodes/render-assemble'
import { cardGraph, motionGraph } from '../../src/engine/render/final'
import { FFMPEG_PATH, MEDIA, NO_FULL_FFMPEG, art, hasFullFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

const media = MEDIA as NonNullable<typeof MEDIA>
const signal = new AbortController().signal
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
const work = (label: string): string => {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}
const hasProres = ((): boolean => {
  if (!FFMPEG_PATH) return false
  const r = spawnSync(FFMPEG_PATH, ['-hide_banner', '-v', 'error', '-encoders'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  return /\bprores_ks\b/.test(r.stdout ?? '')
})()
const ffmpeg = (args: string[]): Promise<unknown> => media.run('ffmpeg', ['-v', 'error', '-y', ...args], { signal })
const PRORES = ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0']

/** A transparent overlay the size of the frame holding a `w`×`h` rectangle of `colour` at (x, y), for `frames` frames. */
async function rectangle(file: string, o: { colour: string; w: number; h: number; x: number; y: number; frames: number; size?: [number, number] }): Promise<string> {
  const [W, H] = o.size ?? [1920, 1080]
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=${o.colour}:s=${o.w}x${o.h}:r=30:d=${o.frames / 30}`, '-vf', `format=rgba,pad=${W}:${H}:${o.x}:${o.y}:color=black@0`, ...PRORES, file])
  return file
}
/** The mean colour of a region at frame `k` of a 30 fps video (`crop` is w:h:x:y). */
async function colour(file: string, k: number, crop: string): Promise<[number, number, number]> {
  const out = (await media.run('ffmpeg', ['-v', 'error', '-ss', ((k - 0.4) / 30).toFixed(4), '-i', file, '-frames:v', '1', '-vf', `crop=${crop},scale=1:1:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { signal })).stdout
  return [out[0] as number, out[1] as number, out[2] as number]
}
const near = ([r, g, b]: number[], want: [number, number, number], tol = 14): boolean => Math.abs((r as number) - want[0]) <= tol && Math.abs((g as number) - want[1]) <= tol && Math.abs((b as number) - want[2]) <= tol
const RED: [number, number, number] = [255, 0, 0]
const BLUE: [number, number, number] = [0, 0, 255]

const FRAMES = 180
const base: Shot = { id: 's1', track: 'base', startFrame: 0, endFrame: FRAMES, kind: 'stock.photo', genItem: 'i-s1', transitionIn: 'cut', role: 'base', beat: 0 }
const planOf = (size: [number, number] = [1920, 1080]): EditPlan => ({
  schema: EDITPLAN_SCHEMA,
  fps: 30,
  size: size as never,
  frames: FRAMES,
  tracks: { base: ['s1'], overlay: [], labels: [] },
  captionsPreset: 'highlight',
  shots: [base],
  chapters: [],
  diagnostics: []
})

describe('the filter graph of an overlay', () => {
  it('shifts the file to its first frame and shows it for exactly its frames, half a frame early on both sides', () => {
    expect(motionGraph({ startFrame: 45, endFrame: 105 }, 3, '[0:v]', '[mot0]')).toBe(
      "[3:v]setpts=PTS-STARTPTS+1.5000/TB,format=rgba[mo3];[0:v][mo3]overlay=x=0:y=0:eof_action=pass:enable='gte(t,1.4833)*lt(t,3.4833)'[mot0]"
    )
    // chained: each overlay is laid over the one before it
    expect(motionGraph({ startFrame: 0, endFrame: 30 }, 4, '[mot0]', '[mot1]')).toContain('[mot0][mo4]overlay')
  })

  it('the card still goes over whatever it is given (the picture, or the overlays)', () => {
    expect(cardGraph({ startS: 0, endS: 3 }, 2)).toContain('[0:v][card]overlay')
    expect(cardGraph({ startS: 0, endS: 3 }, 2, [1920, 1080], '[mot1]')).toContain('[mot1][card]overlay')
  })
})

describe.skipIf(!hasFullFfmpeg || !hasProres)(`render.assemble with animated overlays (${hasFullFfmpeg && hasProres ? 'ffmpeg' : !hasFullFfmpeg ? NO_FULL_FFMPEG : 'this ffmpeg has no prores_ks'})`, () => {
  async function setup(dir: string, size: [number, number] = [1920, 1080]) {
    const red = path.join(dir, 'red.png')
    await ffmpeg(['-f', 'lavfi', '-i', `color=c=red:s=${size[0]}x${size[1]}`, '-frames:v', '1', red])
    const voice = path.join(dir, 'voice.flac')
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=6', '-af', 'volume=0.4', '-c:a', 'flac', voice])
    const images = art('media.image[]', { files: [red], value: [{ itemId: 'i-s1', file: 0, demo: false }] as never, meta: { demo: false } })
    return { images, voice: art('audio.voice', { files: [voice] }) }
  }
  const params = RenderParams.parse({ preset: 'ultrafast', crf: 18, workers: 1 })
  const motion = (files: string[], rows: { shotId: string; startFrame: number; endFrame: number }[], meta: Record<string, number> = { width: 1920, height: 1080 }): Artefact =>
    art('media.graphic[]', { files, value: rows.map((r, i) => ({ ...r, file: i, template: 'title' })) as never, meta: { count: files.length, alpha: true, ...meta } })

  it('shows an overlay exactly from its first frame to its last, blends a transparent one, and leaves the rest of the picture alone', { timeout: 240_000 }, async () => {
    const dir = work('overlay')
    const { images, voice } = await setup(dir)
    const blue = await rectangle(path.join(dir, 'blue.mov'), { colour: 'blue', w: 600, h: 300, x: 400, y: 300, frames: 60 })
    const green = await ffmpeg(['-f', 'lavfi', '-i', 'color=c=green:s=1920x1080:r=30:d=1', '-vf', 'format=rgba,colorchannelmixer=aa=0.5', ...PRORES, path.join(dir, 'green.mov')]).then(() => path.join(dir, 'green.mov'))
    const out = await renderAssemble.run(
      makeCtx(testServices(dir)),
      {
        plan: art('json.editplan', { value: planOf() as never }),
        images,
        voice,
        motion: motion([blue, green], [{ shotId: 'm1', startFrame: 45, endFrame: 105 }, { shotId: 'm2', startFrame: 120, endFrame: 150 }])
      },
      params
    )
    const file = out.video?.files?.[0] as string
    expect(out.video?.meta).toMatchObject({ motionOverlays: 2, frames: FRAMES })
    const info = await probe(media, file, signal, true)
    expect(info.streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1)
    const inside = '400:200:500:400' // inside the rectangle (400..1000 × 300..600)
    const outside = '300:200:1300:400'
    // the frame before it comes: the picture; its first frame: the rectangle; its last frame: the rectangle; the frame after: the picture
    expect(near(await colour(file, 44, inside), RED)).toBe(true)
    expect(near(await colour(file, 45, inside), BLUE)).toBe(true)
    expect(near(await colour(file, 75, inside), BLUE)).toBe(true)
    expect(near(await colour(file, 104, inside), BLUE)).toBe(true)
    expect(near(await colour(file, 105, inside), RED)).toBe(true)
    // the rest of the frame is the picture the whole time (the overlay is transparent there)
    for (const k of [44, 45, 75, 104, 105]) expect(near(await colour(file, k, outside), RED), `frame ${k} outside`).toBe(true)
    // a half-transparent sheet blends with the picture under it, only for its own frames
    const blend = '200:200:100:100'
    expect(near(await colour(file, 119, blend), RED)).toBe(true)
    expect(near(await colour(file, 120, blend), [128, 64, 0], 22)).toBe(true)
    expect(near(await colour(file, 149, blend), [128, 64, 0], 22)).toBe(true)
    expect(near(await colour(file, 150, blend), RED)).toBe(true)
  })

  it('the captions are drawn over an overlay that covers them, and an overlay made for another frame size is refused', { timeout: 240_000 }, async () => {
    const dir = work('captions')
    const { images, voice } = await setup(dir)
    // a sheet of solid green over the middle of the frame, from 1 s to 4 s; white letters over it from 0 to 6 s
    const sheet = await rectangle(path.join(dir, 'sheet.mov'), { colour: 'green', w: 1400, h: 500, x: 260, y: 290, frames: 90 })
    const ass = path.join(dir, 'captions.ass')
    await writeFile(
      ass,
      [
        '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Cap,Inter,220,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1', '',
        '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:00.00,0:00:06.00,Cap,,0,0,0,,MMMM'
      ].join('\n')
    )
    const subs = art('subs.track', { files: [ass], meta: {} })
    const out = await renderAssemble.run(
      makeCtx(testServices(dir)),
      { plan: art('json.editplan', { value: planOf() as never }), images, voice, subs, motion: motion([sheet], [{ shotId: 'm1', startFrame: 30, endFrame: 120 }]) },
      params
    )
    const file = out.video?.files?.[0] as string
    // the middle of the frame: with the sheet on, the letters are still white (not green, not hidden by it); with no sheet, red behind white
    const white = async (k: number): Promise<number> => {
      const px = (await media.run('ffmpeg', ['-v', 'error', '-ss', ((k - 0.4) / 30).toFixed(4), '-i', file, '-frames:v', '1', '-vf', 'crop=1000:300:460:390', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { signal })).stdout
      let n = 0
      for (let i = 0; i < px.length; i += 3) if ((px[i] as number) > 235 && (px[i + 1] as number) > 235 && (px[i + 2] as number) > 235) n++
      return n
    }
    const green = async (k: number): Promise<number> => (await colour(file, k, '100:100:300:310'))[1]
    expect(await green(75)).toBeGreaterThan(100) // the sheet is there (a corner of it, away from the letters)
    expect(await green(15)).toBeLessThan(10) // and not before
    expect(await white(15)).toBeGreaterThan(8000) // letters without the sheet
    expect(await white(75)).toBeGreaterThan(8000) // letters over the sheet: the captions are on top
    // the size of the overlay must be the frame's
    const wrong = motion([sheet], [{ shotId: 'm1', startFrame: 30, endFrame: 120 }], { width: 1080, height: 1920 })
    await expect(renderAssemble.run(makeCtx(testServices(dir)), { plan: art('json.editplan', { value: planOf() as never }), images, voice, motion: wrong }, params)).rejects.toMatchObject({ code: 'bad_input' })
  })

  it('an overlay with no file, or a record that does not read, is left out with a warning: the film is made without it', { timeout: 240_000 }, async () => {
    const dir = work('missing')
    const { images, voice } = await setup(dir)
    const ctx = makeCtx(testServices(dir))
    const noFile = art('media.graphic[]', { files: [], value: [{ shotId: 'm1', file: 0, startFrame: 30, endFrame: 90, template: 'title' }] as never, meta: { width: 1920, height: 1080 } })
    const out = await renderAssemble.run(ctx, { plan: art('json.editplan', { value: planOf() as never }), images, voice, motion: noFile }, params)
    expect(out.video?.meta).not.toHaveProperty('motionOverlays')
    expect(ctx.reports.some((r) => r.kind === 'log' && r.level === 'warn' && /animation m1 has no usable file/.test(r.text))).toBe(true)
    const bad = art('media.graphic[]', { files: [], value: [{ nope: 1 }] as never, meta: {} })
    const ctx2 = makeCtx(testServices(dir))
    await renderAssemble.run(ctx2, { plan: art('json.editplan', { value: planOf() as never }), images, voice, motion: bad }, params)
    expect(ctx2.reports.some((r) => r.kind === 'log' && /record does not read/.test(r.text))).toBe(true)
  })
})
