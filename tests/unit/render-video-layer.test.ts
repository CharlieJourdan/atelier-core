// Video in the render (docs/ENGINE-SPEC.md §28.1): a generated clip or an avatar is a base-track segment made from the clip
// (scaled to fill, cropped, 30 fps, no sound, slowed up to 1.3x, then the last frame held, never looped, cut when too long); an
// avatar in picture-in-picture is laid over the joined film. Real ffmpeg on tiny clips made here, ffprobe and pixel checks.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Artefact } from '../../src/engine'
import { EDITPLAN_SCHEMA, type EditPlan, type Shot } from '../../src/engine/formats/editplan'
import { probe, type StreamInfo } from '../../src/engine/media/probe'
import { renderAssemble, RenderParams } from '../../src/engine/nodes/render-assemble'
import { pipBox } from '../../src/engine/render/final'
import { MAX_SLOWDOWN, renderSegment, segmentArgs, segmentKey, segmentSpecs, type SegmentSpec } from '../../src/engine/render/segments'
import { MEDIA, NO_FULL_FFMPEG, art, hasFullFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

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
const ffmpeg = (args: string[]): Promise<unknown> => media.run('ffmpeg', ['-v', 'error', '-y', ...args], { signal })

/** A tiny clip: `source` is a lavfi video source, with a sine sound when `sound` (to prove the render drops it). */
async function clip(file: string, source: string, o: { sound?: boolean } = {}): Promise<string> {
  await ffmpeg(['-f', 'lavfi', '-i', source, ...(o.sound ? ['-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000:duration=5', '-c:a', 'aac', '-shortest'] : []), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file])
  return file
}
async function still(file: string, hue = 0): Promise<string> {
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=1', '-vf', `hue=h=${hue}`, '-frames:v', '1', '-q:v', '3', file])
  return file
}
const streamOf = async (file: string): Promise<{ v: StreamInfo; audio: number }> => {
  const p = await probe(media, file, signal, true)
  return { v: p.streams.find((s) => s.codec_type === 'video') as StreamInfo, audio: p.streams.filter((s) => s.codec_type === 'audio').length }
}
/** The mean colour of a region of the frame at `t` seconds: `crop` is w:h:x:y. */
async function colour(file: string, t: number, crop: string): Promise<[number, number, number]> {
  const out = (await media.run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${crop},scale=1:1:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { signal })).stdout
  return [out[0] as number, out[1] as number, out[2] as number]
}
const isRed = ([r, g, b]: number[]): boolean => (r as number) > 150 && (g as number) < 90 && (b as number) < 90
const isGreen = ([r, g, b]: number[]): boolean => (g as number) > 120 && (r as number) < 90 && (b as number) < 90
const isBlue = ([r, g, b]: number[]): boolean => (b as number) > 150 && (r as number) < 90 && (g as number) < 110
/** Mean absolute difference of two frames of a clip (0-255), at times `a` and `b`. */
async function frameDiff(file: string, a: number, b: number): Promise<number> {
  const grab = async (t: number): Promise<Buffer> => (await media.run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=96:54,format=gray', '-f', 'rawvideo', '-'], { signal })).stdout
  const [x, y] = [await grab(a), await grab(b)]
  let d = 0
  for (let i = 0; i < Math.min(x.length, y.length); i++) d += Math.abs((x[i] as number) - (y[i] as number))
  return d / Math.min(x.length, y.length)
}

describe.skipIf(!hasFullFfmpeg)(`a video shot as a segment (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  const spec = (image: string, c: SegmentSpec['clip'], frames: number, size?: readonly [number, number]): SegmentSpec => ({
    shotId: 's',
    frames,
    image,
    ...(c ? { clip: c } : {}),
    motion: undefined,
    dipIn: false,
    dipOut: false,
    grade: 'none',
    ...(size ? { size } : {})
  })

  it('cuts a clip that is longer than the shot, scales and crops it to the frame, conforms it to 30 fps and drops its sound', { timeout: 120_000 }, async () => {
    const dir = work('seg-cut')
    const c = await clip(path.join(dir, 'long.mp4'), 'testsrc2=s=640x360:d=3:r=25', { sound: true })
    const cache = path.join(dir, 'cache')
    await mkdir(cache)
    const r = await renderSegment(media, spec(await still(path.join(dir, 'p.jpg')), { file: c, durationS: 3 }, 30), cache, signal)
    const s = await streamOf(r.file)
    expect(s.v).toMatchObject({ width: 1920, height: 1080, codec_name: 'h264', r_frame_rate: '30/1', pix_fmt: 'yuv420p', color_space: 'bt709' })
    expect(Number(s.v.nb_read_frames)).toBe(30)
    expect(s.audio).toBe(0)
  })

  it('a vertical film crops the clip to 1080x1920', { timeout: 120_000 }, async () => {
    const dir = work('seg-tall')
    const c = await clip(path.join(dir, 'wide.mp4'), 'testsrc2=s=640x360:d=2:r=30')
    const cache = path.join(dir, 'cache')
    await mkdir(cache)
    const r = await renderSegment(media, spec(await still(path.join(dir, 'p.jpg')), { file: c, durationS: 2 }, 30, [1080, 1920]), cache, signal)
    expect((await streamOf(r.file)).v).toMatchObject({ width: 1080, height: 1920 })
  })

  it(`slows a clip down to fit a shot up to ${MAX_SLOWDOWN} times longer, and holds the last frame beyond that (never loops)`, { timeout: 120_000 }, async () => {
    const dir = work('seg-hold')
    const cache = path.join(dir, 'cache')
    await mkdir(cache)
    const pic = await still(path.join(dir, 'p.jpg'))
    // 1.7 s of moving picture in a 2 s shot (x1.18): slowed, it moves until the end of the shot
    const near = await clip(path.join(dir, 'near.mp4'), 'testsrc2=s=640x360:d=1.7:r=30')
    const slowed = await renderSegment(media, spec(pic, { file: near, durationS: 1.7 }, 60), cache, signal)
    expect(Number((await streamOf(slowed.file)).v.nb_read_frames)).toBe(60)
    expect(await frameDiff(slowed.file, 1.5, 1.95)).toBeGreaterThan(0.3)
    // 1 s of moving picture in a 2 s shot (x2): played at its pace, then its last frame is held
    const short = await clip(path.join(dir, 'short.mp4'), 'testsrc2=s=640x360:d=1:r=30')
    const held = await renderSegment(media, spec(pic, { file: short, durationS: 1 }, 60), cache, signal)
    expect(Number((await streamOf(held.file)).v.nb_read_frames)).toBe(60)
    expect(await frameDiff(held.file, 0.2, 0.8)).toBeGreaterThan(0.3) // it moved
    expect(await frameDiff(held.file, 1.3, 1.95)).toBeLessThan(0.3) // then it holds, it does not start over
    expect(await frameDiff(held.file, 0.05, 1.95)).toBeGreaterThan(0.3) // and it did not loop back to its start
  })

  it('is keyed by the clip’s bytes, and a video before a dissolve makes a cut', { timeout: 120_000 }, async () => {
    const dir = work('seg-key')
    const a = await clip(path.join(dir, 'a.mp4'), 'color=c=red:s=320x180:d=2:r=30')
    const b = await clip(path.join(dir, 'b.mp4'), 'color=c=blue:s=320x180:d=2:r=30')
    const pic = await still(path.join(dir, 'p.jpg'))
    expect(await segmentKey(spec(pic, { file: a, durationS: 2 }, 30))).not.toBe(await segmentKey(spec(pic, { file: b, durationS: 2 }, 30)))
    expect(await segmentKey(spec(pic, { file: a, durationS: 2 }, 30))).not.toBe(await segmentKey(spec(pic, undefined, 30)))
    // the clip is the input: no looped picture in the arguments of a video segment, and no camera move
    const args = segmentArgs(spec(pic, { file: a, durationS: 2 }, 30), 'out.mp4')
    expect(args).not.toContain('-loop')
    expect(args.join(' ')).not.toContain('perspective')
    const shot = (id: string, from: number, to: number, o: Partial<Shot> = {}): Shot => ({ id, track: 'base', startFrame: from, endFrame: to, kind: 'image.gen', role: 'base', beat: 0, transitionIn: 'cut', genItem: `i-${id}`, ...o }) as Shot
    const base = [shot('s1', 0, 30), shot('s2', 30, 60, { transitionIn: 'dissolve', kind: 'video.gen' }), shot('s3', 60, 90, { transitionIn: 'dissolve' })]
    const specs = segmentSpecs(base, (s) => `${s.id}.jpg`, 'none', undefined, (s) => (s.id === 's2' ? { file: a, durationS: 2 } : undefined))
    expect(specs[1]?.dissolveFrom).toBeDefined() // a video after a picture: the picture is held, the video comes in
    expect(specs[1]?.clip).toEqual({ file: a, durationS: 2 })
    expect(specs[2]?.dissolveFrom).toBeUndefined() // a picture after a video: there is no picture of the video to hold
    expect(specs[0]?.clip).toBeUndefined()
  })
})

// ---- the film: a generated clip, a full-frame avatar, an avatar in picture in picture -----------------------------------

const FRAMES = 180
const shot = (id: string, a: number, b: number, o: Partial<Shot> = {}): Shot => ({ id, track: 'base', startFrame: a, endFrame: b, kind: 'image.gen', role: 'scene', beat: 0, transitionIn: 'cut', genItem: `i-${id}`, ...o }) as Shot

function filmPlan(): EditPlan {
  const base: Shot[] = [
    shot('s1', 0, 45, { motion: { kind: 'push', from: 1, to: 1.1 } }),
    shot('s2', 45, 90, { kind: 'video.gen', transitionIn: 'dissolve' }),
    shot('s3', 90, 135, { kind: 'avatar', layout: 'full', genItem: 'avatar-hook', transitionIn: 'dissolve' }),
    shot('s4', 135, 180, { motion: { kind: 'pull', from: 1.1, to: 1 } })
  ]
  const pip: Shot = { id: 'av-out', track: 'overlay', startFrame: 140, endFrame: 175, kind: 'avatar', layout: 'pip', genItem: 'avatar-out', role: 'scene', beat: 0, transitionIn: 'cut' }
  return {
    schema: EDITPLAN_SCHEMA,
    fps: 30,
    size: [1920, 1080],
    frames: FRAMES,
    tracks: { base: base.map((s) => s.id), overlay: [pip.id], labels: [] },
    captionsPreset: 'highlight',
    shots: [...base, pip],
    chapters: [],
    diagnostics: []
  }
}

describe.skipIf(!hasFullFfmpeg)(`render.assemble with video layers (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  it('places a generated clip and a full-frame avatar as shots, and an avatar in picture in picture over the base', { timeout: 300_000 }, async () => {
    const dir = work('film')
    const services = testServices(dir)
    const plan = filmPlan()
    const pictures: string[] = []
    for (const [i, id] of ['s1', 's2', 's4'].entries()) pictures.push(await still(path.join(dir, `pic-${id}.jpg`), i * 70))
    // the pictures of s1, s2 (the clip's own first frame) and s4; the full avatar has none
    const images: Artefact = art('media.image[]', {
      files: pictures,
      value: [{ itemId: 'i-s1', file: 0, demo: true }, { itemId: 'i-s2', file: 1, demo: true }, { itemId: 'i-s4', file: 2, demo: true }] as never,
      meta: { demo: true }
    })
    const red = await clip(path.join(dir, 'video.mp4'), 'color=c=red:s=320x180:d=2:r=25', { sound: true })
    const green = await clip(path.join(dir, 'avatar-hook.mp4'), 'color=c=green:s=320x180:d=2:r=25', { sound: true })
    const blue = await clip(path.join(dir, 'avatar-out.mp4'), 'color=c=blue:s=320x180:d=2:r=25', { sound: true })
    const clips = art('media.clip[]', { files: [red], value: [{ itemId: 'i-s2', file: 0, durationS: 2 }] as never, meta: { count: 1, demo: true } })
    const avatar = art('media.clip[]', {
      files: [green, blue],
      value: [{ itemId: 'avatar-hook', file: 0, durationS: 2 }, { itemId: 'avatar-out', file: 1, durationS: 2 }] as never,
      meta: { count: 2, demo: true }
    })
    const voice = path.join(dir, 'voice.flac')
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=6', '-af', 'volume=0.4,pan=mono|c0=c0', '-c:a', 'flac', voice])
    const params = RenderParams.parse({ preset: 'ultrafast', crf: 24, workers: 2 })
    const inputs = (extra: Record<string, Artefact> = {}): Record<string, Artefact> => ({
      plan: art('json.editplan', { value: plan as never }),
      images,
      voice: art('audio.voice', { files: [voice], meta: { demo: true } }),
      ...extra
    })

    const out = await renderAssemble.run(makeCtx(services), inputs({ clips, avatar }), params)
    const file = out.video?.files?.[0] as string
    expect(out.video?.meta).toMatchObject({ segments: 4, held: [], videoShots: 2, avatarPip: 1, demo: true })
    const info = await probe(media, file, signal, true)
    const v = info.streams.find((s) => s.codec_type === 'video') as StreamInfo
    expect(v).toMatchObject({ width: 1920, height: 1080, codec_name: 'h264' })
    expect(Math.abs(Number(v.nb_read_frames) - FRAMES)).toBeLessThanOrEqual(1)
    // one audio stream: the film’s voice; the sound of the clips never reaches it
    expect(info.streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1)
    expect(Math.abs(info.durationS - 6)).toBeLessThan(0.1)

    // s2 (1.5-3 s) is the generated clip, s3 (3-4.5 s) the full-frame avatar: whole frames of their colours
    expect(isRed(await colour(file, 2.25, '1920:1080:0:0'))).toBe(true)
    expect(isGreen(await colour(file, 3.75, '1920:1080:0:0'))).toBe(true)
    expect(isRed(await colour(file, 0.7, '1920:1080:0:0'))).toBe(false)
    // s4 (4.5-6 s) has the avatar in a square at the bottom right from 4.67 s to 5.83 s, and nothing elsewhere
    const box = pipBox([1920, 1080])
    const inside = `${box.side - 80}:${box.side - 80}:${box.x + 40}:${box.y + 40}`
    expect(isBlue(await colour(file, 5.2, inside))).toBe(true)
    expect(isBlue(await colour(file, 5.2, '300:300:100:100'))).toBe(false)
    expect(isBlue(await colour(file, 4.55, inside))).toBe(false) // before it comes in
    expect(isBlue(await colour(file, 5.95, inside))).toBe(false) // after it leaves

    // the same film again is all cached, and the render without clips holds neighbours (never black) and says so
    const again = await renderAssemble.run(makeCtx(services), inputs({ clips, avatar }), params)
    expect(again.video?.meta).toMatchObject({ segments: 4, segmentsCached: 4, videoShots: 2, avatarPip: 1 })
    const without = await renderAssemble.run(makeCtx(services), inputs(), params)
    expect(without.video?.meta).toMatchObject({ held: ['s3'] })
    expect((without.video?.meta as Record<string, unknown>).videoShots).toBeUndefined()
    expect((without.video?.meta as Record<string, unknown>).avatarPip).toBeUndefined()
    expect(isRed(await colour(without.video?.files?.[0] as string, 2.25, '1920:1080:0:0'))).toBe(false) // s2 falls back to its picture
  })

  it('a film made of pictures only gets exactly the meta it always had', { timeout: 240_000 }, async () => {
    const dir = work('film-plain')
    const plan = filmPlan()
    const plain: EditPlan = { ...plan, shots: plan.shots.filter((s) => s.track === 'base').map((s) => ({ ...s, kind: 'image.gen' as const, layout: undefined, genItem: `i-${s.id}` })), tracks: { ...plan.tracks, overlay: [] } }
    const files: string[] = []
    for (let i = 0; i < 4; i++) files.push(await still(path.join(dir, `p${i}.jpg`), i * 60))
    const voice = path.join(dir, 'voice.flac')
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=6', '-c:a', 'flac', voice])
    const images = art('media.image[]', { files, value: files.map((_, i) => ({ itemId: `i-s${i + 1}`, file: i, demo: false })) as never, meta: { demo: false } })
    const out = await renderAssemble.run(makeCtx(testServices(dir)), { plan: art('json.editplan', { value: plain as never }), images, voice: art('audio.voice', { files: [voice] }) }, RenderParams.parse({ preset: 'ultrafast', crf: 24, workers: 2 }))
    expect(Object.keys(out.video?.meta ?? {}).sort()).toEqual(
      ['captionsBurned', 'crf', 'demo', 'durationS', 'fps', 'frames', 'height', 'held', 'limited', 'masterGainDb', 'mixLufsBefore', 'preset', 'segments', 'segmentsCached', 'watermark', 'width'].sort()
    )
  })
})
