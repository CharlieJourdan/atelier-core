// The proof of generated video and of the talking presenter, as a test (the same run as `npm run engine:avatar-demo`): the editor's
// drawing with an avatar step and a video step, compiled by `pipelineFromDrawing`, made into a real ~20 s MP4 in demo mode (the
// deterministic tone voice, drawn pictures, a drawn clip and a drawn presenter), twice: the presenter full frame, then in
// picture-in-picture. Real ffmpeg, no network.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { probe, type StreamInfo } from '../../src/engine/media/probe'
import { AVATAR_DEMO_DRAWING, runAvatarDemo, type AvatarDemoResult } from '../../src/engine/pipelines/avatar-demo'
import { pipelineFromDrawing } from '../../src/engine/pipelines/from-drawing'
import { pipBox } from '../../src/engine/render/final'
import { MEDIA, NO_FULL_FFMPEG, RESOURCES, hasFullFfmpeg, tempDir } from './engine-node-helpers'

const media = MEDIA as NonNullable<typeof MEDIA>
const signal = new AbortController().signal

describe('the avatar drawing compiles', () => {
  it('to the chain with a presenter node wired to the director, the voice and the render, and nothing left out', () => {
    const c = pipelineFromDrawing(AVATAR_DEMO_DRAWING, { minutes: 0.33 })
    expect(c.notes.filter((n) => n.code === 'not_executable')).toEqual([])
    expect(c.mapping['v-avatar']).toBe('avatar')
    expect(c.pipeline.nodes.map((n) => n.id)).toEqual(['research', 'script', 'voice', 'beats', 'director', 'visuals', 'avatar', 'captions', 'sound', 'render', 'qc'])
  })
})

describe.skipIf(!hasFullFfmpeg)(`a film with a generated clip and a presenter on its hook, end to end (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  const tmp = tempDir('avatar-film')
  const base = { resourcesDir: RESOURCES, services: { speech: undefined } }
  let full: AvatarDemoResult
  let pip: AvatarDemoResult

  beforeAll(async () => {
    full = await runAvatarDemo({ ...base, dataDir: `${tmp.dir}/full` })
    pip = await runAvatarDemo({ ...base, dataDir: `${tmp.dir}/pip`, layout: 'pip' })
  }, 400_000)
  afterAll(() => tmp.cleanup())

  const grab = async (file: string, t: number, crop: string): Promise<Buffer> =>
    (await media.run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${crop},scale=480:-1,format=gray`, '-f', 'rawvideo', '-'], { signal })).stdout
  const diff = (a: Buffer, b: Buffer): number => {
    let s = 0
    for (let i = 0; i < Math.min(a.length, b.length); i++) s += Math.abs((a[i] as number) - (b[i] as number))
    return s / Math.max(1, Math.min(a.length, b.length))
  }
  const BODY = '1500:620:0:150'

  it('runs every node, with a presenter on the hook and one generated clip, priced in the list', () => {
    expect(full.errors).toEqual([])
    expect(full.status).toBe('done')
    expect(full.ran).toEqual(expect.arrayContaining(['visuals', 'avatar', 'render', 'qc']))
    const hook = full.plan?.shots.find((s) => s.kind === 'avatar')
    expect(hook).toMatchObject({ track: 'base', layout: 'full', startFrame: 0 })
    expect(full.plan?.shots.filter((s) => s.kind === 'video.gen')).toHaveLength(1)
    const items = full.genlist?.items ?? []
    expect(items.filter((i) => i.kind === 'video.gen')).toHaveLength(1)
    expect(items.filter((i) => i.kind === 'avatar')).toHaveLength(1)
    expect(full.genlist?.totals.byKind).toMatchObject({ avatar: 1, 'video.gen': 1 })
    // the clips the film was made from: one generated clip, one presenter
    expect(full.clips.files).toHaveLength(1)
    expect(full.avatar.files).toHaveLength(1)
    expect(full.avatar.value).toMatchObject([{ itemId: 'avatar-hook', layout: 'full', demo: true }])
  })

  it('is a 1920x1080, 30 fps film of about 20 s with the voice’s length and one audio stream', async () => {
    const info = await probe(media, full.video as string, signal, true)
    const v = info.streams.find((s) => s.codec_type === 'video') as StreamInfo
    expect(v).toMatchObject({ width: 1920, height: 1080, codec_name: 'h264', r_frame_rate: '30/1' })
    expect(info.streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1)
    expect(Math.abs(info.durationS - 20)).toBeLessThanOrEqual(6)
    expect(Math.abs(Number(v.nb_read_frames) - Math.round(info.durationS * 30))).toBeLessThanOrEqual(1)
  })

  it('shows the presenter’s clip during the hook and the generated clip during its shot, which moves', { timeout: 120_000 }, async () => {
    const hook = full.plan?.shots.find((s) => s.kind === 'avatar')
    const clipShot = full.plan?.shots.find((s) => s.kind === 'video.gen')
    if (!hook || !clipShot) throw new Error('no avatar or video shot')
    const avatarClip = full.avatar.files[0] as string
    const videoClip = full.clips.files[0] as string
    const tHook = Math.min(2.5, hook.endFrame / 30 - 0.6)
    expect(diff(await grab(full.video as string, tHook, BODY), await grab(avatarClip, tHook, BODY))).toBeLessThan(14)
    expect(diff(await grab(full.video as string, hook.endFrame / 30 + 1.2, BODY), await grab(avatarClip, tHook, BODY))).toBeGreaterThan(25)
    const s0 = clipShot.startFrame / 30
    expect(diff(await grab(full.video as string, s0 + 1, BODY), await grab(videoClip, 1, BODY))).toBeLessThan(14)
    expect(diff(await grab(full.video as string, s0 + 0.2, BODY), await grab(full.video as string, s0 + 1.7, BODY))).toBeGreaterThan(1)
  })

  it('the quality check passes (the clips and the presenter freeze and cut nothing it checks)', () => {
    expect((full.qc as { pass?: boolean } | null)?.pass).toBe(true)
    expect(full.gates).toEqual([])
  })

  it('in picture-in-picture the presenter is an overlay shot over an unchanged base track, in a square at the bottom right', { timeout: 120_000 }, async () => {
    expect(pip.status).toBe('done')
    const shot = pip.plan?.shots.find((s) => s.kind === 'avatar')
    expect(shot).toMatchObject({ track: 'overlay', layout: 'pip', startFrame: 0 })
    expect(pip.plan?.tracks.overlay).toEqual([shot?.id])
    expect(pip.plan?.shots.filter((s) => pip.plan?.tracks.base.includes(s.id)).some((s) => s.kind === 'avatar')).toBe(false)
    const box = pipBox([1920, 1080])
    const inner = box.side - 60
    const square = `${inner}:${inner}:${box.x + 30}:${box.y + 30}`
    const side = Math.round((1080 * inner) / box.side)
    const offset = Math.round((1080 * 30) / box.side)
    const centre = `${side}:${side}:${420 + offset}:${offset}`
    const clip = pip.avatar.files[0] as string
    const mid = ((shot?.endFrame ?? 0) / 30) / 2
    expect(diff(await grab(pip.video as string, mid, square), await grab(clip, mid, centre))).toBeLessThan(14)
    expect(diff(await grab(pip.video as string, (shot?.endFrame ?? 0) / 30 + 1.2, square), await grab(clip, mid, centre))).toBeGreaterThan(25)
  })
})
