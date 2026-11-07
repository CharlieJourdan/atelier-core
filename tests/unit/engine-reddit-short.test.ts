// The proof of the faceless formats, as a test (the same run as `npm run engine:reddit-demo`): the editor's Reddit drawing,
// compiled by `pipelineFromDrawing` (a short: 9:16, shorts captions), made into a real ~15 s MP4 with a person's script, a folder of gameplay clips, an
// intro card and burned captions, then checked by `qc.check`. Demo mode with the deterministic tone voice; real ffmpeg.
import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runRedditShort, type RedditShortResult } from '../../src/engine/pipelines/reddit-short-demo'
import { probe, type StreamInfo } from '../../src/engine/media/probe'
import type { QcReport } from '../../src/engine/nodes/qc-check'
import { MEDIA, NO_FULL_FFMPEG, RESOURCES, ROOT, hasFullFfmpeg, tempDir } from './engine-node-helpers'

const media = MEDIA as NonNullable<typeof MEDIA>
const signal = new AbortController().signal
const ENC = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an']

describe.skipIf(!hasFullFfmpeg)(`a Reddit story short, end to end (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  const tmp = tempDir('reddit')
  const clips = path.join(tmp.dir, 'gameplay')
  const base = { resourcesDir: RESOURCES, clipsDir: clips, channel: 'Histoires Vraies', minutes: 0.25, services: { speech: undefined } }
  let first: RedditShortResult

  beforeAll(async () => {
    mkdirSync(clips, { recursive: true })
    copyFileSync(path.join(ROOT, 'resources', 'fake-media', 'sample.mp4'), path.join(clips, 'a-sample.mp4'))
    await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=7', '-vf', 'hue=h=120', ...ENC, path.join(clips, 'b-green.mp4')], { signal })
    await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'life=s=640x360:r=30:mold=10:ratio=0.12:death_color=#C83232:life_color=#00ff00,scale=1280:720:flags=neighbor', '-t', '7', ...ENC, path.join(clips, 'c-life.mp4')], { signal })
    first = await runRedditShort({ ...base, dataDir: path.join(tmp.dir, 'run1') })
  }, 300_000)
  afterAll(() => tmp.cleanup())

  it('compiles the drawing to the nodes the film needs and nothing else: no generated pictures', () => {
    expect(first.errors).toEqual([])
    expect(first.status).toBe('done')
    expect(Object.keys(first.states).sort()).toEqual(['background', 'beats', 'captions', 'card', 'director', 'qc', 'render', 'research', 'script', 'voice'])
    for (const state of Object.values(first.states)) expect(state).toBe('done')
    expect(first.ran).not.toContain('visuals')
    expect(first.compiled.notes.filter((n) => n.code === 'not_executable')).toEqual([])
    // the drawing is a short: the compiled pipeline is 9:16, the captions are the shorts style
    expect(first.compiled.pipeline.format).toMatchObject({ kind: 'youtube_short', aspect: '9:16' })
  })

  it('makes a 1080×1920 (9:16) film of about 15 s with the voice’s length and one audio stream', { timeout: 60_000 }, async () => {
    const info = await probe(media, first.video as string, signal, true)
    const v = info.streams.find((s) => s.codec_type === 'video') as StreamInfo
    expect(v).toMatchObject({ width: 1080, height: 1920, codec_name: 'h264', r_frame_rate: '30/1' })
    expect(info.streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1)
    expect(Math.abs(info.durationS - 15)).toBeLessThanOrEqual(3)
    expect(Math.abs(Number(v.nb_read_frames) - Math.round(info.durationS * 30))).toBeLessThanOrEqual(1)
    // the background is exactly as long as the film, made of pieces of the folder's clips
    expect(first.background).toMatchObject({ frames: Number(v.nb_read_frames), clips: 3, width: 1080, height: 1920 })
    const pieces = (first.background?.pieces ?? []) as { clip: string; frames: number }[]
    expect(pieces.reduce((n, p) => n + p.frames, 0)).toBe(first.background?.frames)
  })

  it('lays the intro card over the first sentence only, and burns the captions', { timeout: 120_000 }, async () => {
    const card = first.card as { endS: number; title: string; channel: string }
    expect(card).toMatchObject({ channel: 'Histoires Vraies' })
    expect(card.endS).toBeGreaterThanOrEqual(2.5)
    expect(card.endS).toBeLessThanOrEqual(6)
    // compared with the background alone: the card changes the upper third while it is shown, and not after; the shorts
    // captions change the band above the bottom UI zone and leave that zone (the lowest 20 %) alone
    const grab = async (file: string, t: number, crop: string): Promise<Buffer> =>
      (await media.run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${crop},scale=480:-1,format=gray`, '-f', 'rawvideo', '-'], { signal })).stdout
    const diff = (a: Buffer, b: Buffer): number => {
      let s = 0
      for (let i = 0; i < Math.min(a.length, b.length); i++) s += Math.abs((a[i] as number) - (b[i] as number))
      return s / Math.max(1, Math.min(a.length, b.length))
    }
    const film = first.video as string
    const bg = first.backgroundFile as string
    const MIDDLE = '960:700:60:200'
    const during = diff(await grab(film, 1.2, MIDDLE), await grab(bg, 1.2, MIDDLE))
    const after = diff(await grab(film, card.endS + 1.5, MIDDLE), await grab(bg, card.endS + 1.5, MIDDLE))
    expect(during).toBeGreaterThan(15)
    expect(after).toBeLessThan(3)
    let captions = 0
    let uiZone = 0
    for (const t of [7, 9, 11]) {
      captions = Math.max(captions, diff(await grab(film, t, '1080:420:0:1000'), await grab(bg, t, '1080:420:0:1000')))
      uiZone = Math.max(uiZone, diff(await grab(film, t, '1080:384:0:1536'), await grab(bg, t, '1080:384:0:1536')))
    }
    expect(captions).toBeGreaterThan(3)
    expect(uiZone).toBeLessThan(Math.min(2, captions / 3))
  })

  it('the free quality check passed, and did not stop the run', () => {
    const qc = first.qc as unknown as QcReport
    expect(qc.checks.map((c) => [c.id, c.status])).toEqual([
      ['black', 'ok'],
      ['silence', 'ok'],
      ['freeze', 'ok'],
      ['loudness', 'ok'],
      ['duration', 'ok'],
      ['format', 'ok'],
      // qualite-montage: the edit review that rides on the film (nothing left on this short)
      ['edit', 'ok']
    ])
    expect(qc.pass).toBe(true)
    expect(first.gates).toEqual([])
  })

  it('the same seed picks the same pieces of gameplay, another seed other ones', { timeout: 300_000 }, async () => {
    const piecesOf = (r: RedditShortResult): string => JSON.stringify(r.background?.pieces)
    const same = await runRedditShort({ ...base, dataDir: path.join(tmp.dir, 'run2') })
    const other = await runRedditShort({ ...base, dataDir: path.join(tmp.dir, 'run3'), seed: 7 })
    expect(piecesOf(same)).toBe(piecesOf(first))
    expect(piecesOf(other)).not.toBe(piecesOf(first))
    expect(other.status).toBe('done')
  })
})
