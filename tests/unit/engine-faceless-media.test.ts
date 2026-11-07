// The faceless formats' media nodes, with real ffmpeg and tiny fake media: `background.clips` (the user's clips, as long as the
// voice), `card.intro` (the intro card PNG) and `qc.check` (free checks on a film). No network, no Claude, no Cloud.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { seededRandom } from '../../src/engine/errors'
import { probe, type StreamInfo } from '../../src/engine/media/probe'
import { measureLoudness } from '../../src/engine/media/probe'
import { BackgroundParams, backgroundClips, listClips, planPieces, pieceArgs } from '../../src/engine/nodes/background-clips'
import { CardParams, cardHeight, cardIntro, cardSeconds } from '../../src/engine/nodes/card-intro'
import {
  QcParams,
  durationCheck,
  loudnessCheck,
  parseBlack,
  parseFreeze,
  parseLoudness,
  parseSilence,
  stretchCheck,
  qcCheck,
  type QcReport
} from '../../src/engine/nodes/qc-check'
import { MEDIA, NO_FULL_FFMPEG, art, hasFullFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

const media = MEDIA as NonNullable<typeof MEDIA>
const signal = new AbortController().signal
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
function work(label: string): string {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}
const ffmpeg = (args: string[]): Promise<unknown> => media.run('ffmpeg', ['-v', 'error', '-y', ...args], { signal })
const ENC = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an']

// ---- planPieces (pure) ----------------------------------------------------------------------------------------------

describe('background.clips: planning the pieces', () => {
  const clips = [
    { file: 'a.mp4', durationS: 12 },
    { file: 'b.mp4', durationS: 30 },
    { file: 'c.mp4', durationS: 8 }
  ]

  it('covers exactly the frames asked, inside each clip, with no sliver at the end', () => {
    for (const seed of [0, 1, 2, 99]) {
      const frames = 1234
      const pieces = planPieces(clips, frames, seededRandom(seed), 4, 9)
      expect(pieces.reduce((n, p) => n + p.frames, 0)).toBe(frames)
      for (const p of pieces) {
        const clip = clips.find((c) => c.file === p.file)!
        expect(p.frames).toBeGreaterThan(0)
        expect(p.startS).toBeGreaterThanOrEqual(0)
        expect(p.startS + p.frames / 30).toBeLessThanOrEqual(clip.durationS)
      }
      // a piece is never a sliver, except when it is the only one that fits
      expect(pieces.filter((p, i) => p.frames < 18 && i < pieces.length - 1)).toEqual([])
    }
  })

  it('is deterministic for a seed, differs between seeds, and never repeats a clip back to back', () => {
    const run = (seed: number) => planPieces(clips, 1500, seededRandom(seed), 4, 9)
    expect(run(5)).toEqual(run(5))
    expect(run(5)).not.toEqual(run(6))
    for (const seed of [0, 3, 8]) {
      const p = run(seed)
      for (let i = 1; i < p.length; i++) expect(p[i]?.file).not.toBe(p[i - 1]?.file)
    }
  })

  it('loops a clip shorter than the film by taking it again, and refuses an empty list', () => {
    const one = planPieces([{ file: 'short.mp4', durationS: 3 }], 30 * 10, seededRandom(1), 4, 9)
    expect(one.length).toBeGreaterThanOrEqual(4)
    expect(one.every((p) => p.file === 'short.mp4' && p.frames <= 89)).toBe(true)
    expect(one.reduce((n, p) => n + p.frames, 0)).toBe(300)
    expect(() => planPieces([], 30, seededRandom(1), 4, 9)).toThrow(/aucun clip/)
  })

  it('cuts one piece into the segments’ own encoding: cover-cropped 1920×1080 at 30 fps, silent', () => {
    const args = pieceArgs({ file: 'C:\\clips\\my clip.mp4', startS: 1.5, frames: 90 }, 'out.mp4')
    const vf = args[args.indexOf('-vf') + 1] as string
    expect(vf).toContain('scale=1920:1080:force_original_aspect_ratio=increase')
    expect(vf).toContain('crop=1920:1080')
    expect(args).toEqual(expect.arrayContaining(['-an', '-frames:v', '90', '-ss', '1.500']))
    // the path is an argument of its own (no shell, no filter graph)
    expect(args[args.indexOf('-i') + 1]).toBe('C:\\clips\\my clip.mp4')
  })

  it('params: an absolute folder only, and the piece lengths in order', () => {
    expect(BackgroundParams.safeParse({ folder: 'clips' }).success).toBe(false)
    expect(BackgroundParams.safeParse({ minPieceS: 9, maxPieceS: 4 }).success).toBe(false)
    expect(BackgroundParams.parse({})).toMatchObject({ minPieceS: 4, maxPieceS: 9 })
  })
})

// ---- background.clips (real ffmpeg) ---------------------------------------------------------------------------------

describe.skipIf(!hasFullFfmpeg)(`background.clips (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  /** A folder with three tiny clips of different looks (and files that are not clips). */
  async function clipsFolder(dir: string): Promise<string> {
    const folder = path.join(dir, 'gameplay')
    mkdirSync(folder, { recursive: true })
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=3', ...ENC, path.join(folder, 'a.mp4')])
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=3.5', '-vf', 'hue=h=120', ...ENC, path.join(folder, 'b.MP4')])
    await ffmpeg(['-f', 'lavfi', '-i', 'smptebars=s=160x90:r=30:d=2', ...ENC, path.join(folder, 'c.mkv')])
    writeFileSync(path.join(folder, 'notes.txt'), 'not a clip')
    writeFileSync(path.join(folder, 'broken.mp4'), 'not a video at all')
    return folder
  }
  const voice = (seconds: number) => art('audio.voice', { files: ['voice.wav'], meta: { durationS: seconds } })

  it('makes one silent 1920×1080 30 fps layer of exactly the voice’s frames, skipping what is not a clip', { timeout: 120_000 }, async () => {
    const dir = work('bg')
    const folder = await clipsFolder(dir)
    expect((await listClips(folder)).map((f) => path.basename(f))).toEqual(['a.mp4', 'b.MP4', 'broken.mp4', 'c.mkv'])
    const ctx = makeCtx(testServices(dir))
    const out = await backgroundClips.run(ctx, { voice: voice(7.2) }, BackgroundParams.parse({ folder, minPieceS: 2, maxPieceS: 3 }))
    const file = out.layer?.files?.[0] as string
    const info = await probe(media, file, signal, true)
    const v = info.streams.find((s) => s.codec_type === 'video') as StreamInfo
    expect(v).toMatchObject({ width: 1920, height: 1080, codec_name: 'h264', pix_fmt: 'yuv420p', r_frame_rate: '30/1', color_space: 'bt709' })
    expect(Number(v.nb_read_frames)).toBe(216)
    expect(info.streams.filter((s) => s.codec_type === 'audio')).toHaveLength(0)
    const meta = out.layer?.meta as { frames: number; clips: number; pieces: { clip: string; frames: number }[] }
    expect(meta).toMatchObject({ frames: 216, clips: 3 })
    expect(meta.pieces.reduce((n, p) => n + p.frames, 0)).toBe(216)
    expect(meta.pieces.map((p) => p.clip).every((c) => ['a.mp4', 'b.MP4', 'c.mkv'].includes(c))).toBe(true)
    // the unreadable file was named in a warning, not a failure
    expect(ctx.reports.some((r) => r.kind === 'log' && r.level === 'warn' && /broken\.mp4/.test(r.text))).toBe(true)
  })

  it('the same seed gives the same pieces, another seed other pieces; a short folder loops', { timeout: 180_000 }, async () => {
    const dir = work('bg-seed')
    const folder = await clipsFolder(dir)
    const params = BackgroundParams.parse({ folder, minPieceS: 1, maxPieceS: 2 })
    const piecesOf = async (seed: number, seconds = 6): Promise<string> => {
      const out = await backgroundClips.run(makeCtx(testServices(dir), { seed }), { voice: voice(seconds) }, params)
      return JSON.stringify((out.layer?.meta as { pieces: unknown }).pieces)
    }
    expect(await piecesOf(3)).toBe(await piecesOf(3))
    expect(await piecesOf(3)).not.toBe(await piecesOf(4))
    // 12 s from clips of 2 to 3.5 s: every clip is used more than once, the film is still exact
    const long = await backgroundClips.run(makeCtx(testServices(dir)), { voice: voice(12) }, params)
    const info = await probe(media, long.layer?.files?.[0] as string, signal, true)
    expect(Number((info.streams.find((s) => s.codec_type === 'video') as StreamInfo).nb_read_frames)).toBe(360)
  })

  it('takes the clips of a `footage` input too, and explains a missing, empty or unreadable folder in French', { timeout: 120_000 }, async () => {
    const dir = work('bg-input')
    const folder = await clipsFolder(dir)
    const services = testServices(dir)
    const given = path.join(folder, 'a.mp4')
    const out = await backgroundClips.run(makeCtx(services), { voice: voice(3), footage: art('media.clip[]', { files: [given] }) }, BackgroundParams.parse({}))
    expect((out.layer?.meta as { clips: number }).clips).toBe(1)
    await expect(backgroundClips.run(makeCtx(services), { voice: voice(3) }, BackgroundParams.parse({ folder: path.join(dir, 'nope') }))).rejects.toThrow(/dossier de gameplay est introuvable/)
    const empty = path.join(dir, 'empty')
    mkdirSync(empty)
    await expect(backgroundClips.run(makeCtx(services), { voice: voice(3) }, BackgroundParams.parse({ folder: empty }))).rejects.toThrow(/Aucun clip/)
    await expect(backgroundClips.run(makeCtx(services), { voice: voice(3) }, BackgroundParams.parse({}))).rejects.toThrow(/dossier de clips/)
    const junk = path.join(dir, 'junk')
    mkdirSync(junk)
    writeFileSync(path.join(junk, 'x.mp4'), 'nothing')
    await expect(backgroundClips.run(makeCtx(services), { voice: voice(3) }, BackgroundParams.parse({ folder: junk }))).rejects.toThrow(/lisible/)
  })
})

// ---- card.intro -----------------------------------------------------------------------------------------------------

describe('card.intro: how long it stays', () => {
  const words = (ends: number[]) => ends.map((end, i) => ({ w: `m${i}`, start: end - 0.3, end, sentence: i < 3 ? 0 : 1, paragraph: 0 }))
  it('the first sentence, kept between 2.5 and 6 seconds; 3 without word times; the drawing’s seconds win', () => {
    expect(cardSeconds(null, undefined)).toBe(3)
    expect(cardSeconds(words([0.5, 1, 1.5, 4, 5]), undefined)).toBe(2.5)
    expect(cardSeconds(words([1, 2, 3.4, 4, 5]), undefined)).toBe(3.7)
    expect(cardSeconds(words([2, 4, 9, 10, 11]), undefined)).toBe(6)
    expect(cardSeconds(words([1, 2, 3, 4, 5]), 8)).toBe(8)
  })
  it('grows with the number of title lines', () => {
    expect(cardHeight(4)).toBeGreaterThan(cardHeight(1))
    expect(CardParams.parse({})).toMatchObject({ channel: 'Ma chaîne' })
  })
})

describe.skipIf(!hasFullFfmpeg)(`card.intro (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  const outline = (title: string) =>
    art('json.outline', {
      value: {
        language: 'fr',
        title,
        shape: 'essay',
        kind: 'story',
        promise: 'p',
        hook: 'h',
        beats: [{ index: 0, purpose: 'a', summary: 'b', wordBudget: 10, tags: [], anchor: '', marks: [] }],
        chapters: [],
        planted: [],
        dropped: []
      } as never
    })
  const pixel = async (file: string, x: number, y: number): Promise<number[]> =>
    [...(await media.run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y},format=rgba`, '-f', 'rawvideo', '-'], { signal })).stdout]

  it('draws a rounded transparent card with the title, sized to its lines, for the first sentence', { timeout: 60_000 }, async () => {
    const dir = work('card')
    const services = testServices(dir)
    const out = await cardIntro.run(makeCtx(services), { outline: outline('Mon voisin a fait une chose incroyable') }, CardParams.parse({ channel: 'Histoires Vraies' }))
    const file = out.card?.files?.[0] as string
    expect(file).toMatch(/\.png$/)
    // a still has no duration (`probe` wants one): ask ffprobe for its stream
    const shown = await media.run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', file], { signal })
    const v = (JSON.parse(shown.stdout.toString('utf8')) as { streams: StreamInfo[] }).streams[0] as StreamInfo
    expect(v).toMatchObject({ width: 1440, height: cardHeight(2), pix_fmt: 'rgba' })
    // the corner is see-through, the inside is white and opaque
    expect((await pixel(file, 0, 0))[3]).toBe(0)
    expect(await pixel(file, 720, 20)).toEqual([255, 255, 255, 255])
    expect(out.card?.meta).toMatchObject({ startS: 0, endS: 3, width: 1440, title: 'Mon voisin a fait une chose incroyable', channel: 'Histoires Vraies' })
  })

  it('takes the title from the params first, then the outline, then the script’s first sentence; refuses to draw with none', { timeout: 60_000 }, async () => {
    const dir = work('card-title')
    const services = testServices(dir)
    const run = (inputs: Record<string, ReturnType<typeof art>>, p: object = {}) => cardIntro.run(makeCtx(services), inputs, CardParams.parse(p))
    expect((await run({ outline: outline('Du plan') }, { title: 'Des params' })).card?.meta?.title).toBe('Des params')
    expect((await run({ outline: outline('Du plan') })).card?.meta?.title).toBe('Du plan')
    expect((await run({ script: art('text.script', { value: 'Une première phrase. Et une seconde.' }) })).card?.meta?.title).toBe('Une première phrase.')
    await expect(run({})).rejects.toThrow(/pas de titre/)
    // a very long title is cut to 4 lines, not allowed to run off the card
    const long = await run({ outline: outline('mot '.repeat(80).trim()) })
    expect(long.card?.meta?.height).toBe(cardHeight(4))
  })
})

// ---- qc.check -------------------------------------------------------------------------------------------------------

describe('qc.check: reading ffmpeg’s detectors', () => {
  it('black stretches, frozen and silent ones (an open one runs to the end), loudness', () => {
    expect(parseBlack('[blackdetect @ 0x1] black_start:0 black_end:1.5 black_duration:1.5\n[blackdetect @ 0x1] black_start:7.2 black_end:9 black_duration:1.8')).toEqual([
      { start: 0, end: 1.5 },
      { start: 7.2, end: 9 }
    ])
    const freeze = '[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 2.5\n[freezedetect @ 0x1] lavfi.freezedetect.freeze_duration: 4\n[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 6.5\n[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 8'
    expect(parseFreeze(freeze, 10)).toEqual([{ start: 2.5, end: 6.5 }, { start: 8, end: 10 }])
    expect(parseSilence('[silencedetect @ 0x2] silence_start: -0.00125\n[silencedetect @ 0x2] silence_end: 3.5 | silence_duration: 3.5\n[silencedetect @ 0x2] silence_start: 9', 12)).toEqual([
      { start: 0, end: 3.5 },
      { start: 9, end: 12 }
    ])
    expect(parseLoudness('blah\n{\n\t"input_i" : "-14.25",\n\t"input_tp" : "-1.62"\n}')).toEqual({ integrated: -14.25, truePeak: -1.62 })
    expect(parseLoudness('{ "input_i" : "-inf", "input_tp" : "-inf" }')).toEqual({ integrated: -70, truePeak: -70 })
    expect(() => parseLoudness('nothing')).toThrow(/gave no result/)
  })

  it('a stretch fails from its limit, warns from the warning limit, and says where it starts', () => {
    const found = [{ start: 1, end: 2.8 }, { start: 5, end: 9.5 }]
    expect(stretchCheck('freeze', found, { noun: 'image figée', none: 'Aucune', failS: 4, warnS: 1.5 })).toMatchObject({ status: 'fail', at: 5, findings: [{ start: 5, end: 9.5 }] })
    expect(stretchCheck('freeze', [found[0] as { start: number; end: number }], { noun: 'image figée', none: 'Aucune', failS: 4, warnS: 1.5 })).toMatchObject({ status: 'warn', at: 1 })
    expect(stretchCheck('black', [], { noun: 'passage noir', none: 'Aucun', failS: 0.5 })).toMatchObject({ status: 'ok', detail: 'Aucun passage noir d’au moins 0.5 s.' })
  })

  it('loudness and duration verdicts', () => {
    const p = QcParams.parse({})
    expect(loudnessCheck({ integrated: -14.4, truePeak: -2 }, p).status).toBe('ok')
    expect(loudnessCheck({ integrated: -14.4, truePeak: -0.2 }, p).status).toBe('warn')
    expect(loudnessCheck({ integrated: -20, truePeak: -5 }, p)).toMatchObject({ status: 'fail', detail: expect.stringContaining('-20') })
    const film = (durationS: number, frames: number | null = null) => ({ durationS, frames })
    expect(durationCheck(film(15, 450), p, 450).status).toBe('ok')
    expect(durationCheck(film(15, 451), p, 450).status).toBe('ok') // one frame more or less is fine
    expect(durationCheck(film(15, 460), p, 450)).toMatchObject({ status: 'fail', detail: expect.stringContaining('450 images') })
    expect(durationCheck(film(15), QcParams.parse({ expectedS: 60, durationTolerance: 0.1 }), null).status).toBe('fail')
    expect(durationCheck(film(75), QcParams.parse({ maxS: 60 }), null)).toMatchObject({ status: 'fail', detail: expect.stringContaining('maximum') })
    expect(durationCheck(film(5), QcParams.parse({ minS: 10 }), null).status).toBe('fail')
  })
})

describe.skipIf(!hasFullFfmpeg)(`qc.check on real films (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  /** A 1920×1080 film of `seconds` that moves all the time, with a steady tone, mastered to −14 LUFS. */
  async function goodFilm(dir: string, seconds: number): Promise<string> {
    const raw = path.join(dir, 'raw.mp4')
    await ffmpeg(['-f', 'lavfi', '-i', `testsrc2=s=1920x1080:r=30:d=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', raw])
    const gain = -14 - (await measureLoudness(media, raw, signal)).integrated
    const film = path.join(dir, 'good.mp4')
    await ffmpeg(['-i', raw, '-c:v', 'copy', '-af', `volume=${gain.toFixed(2)}dB`, '-c:a', 'aac', film])
    return film
  }

  it('a sound film passes every check', { timeout: 120_000 }, async () => {
    const dir = work('qc-good')
    const film = await goodFilm(dir, 6)
    const out = await qcCheck.run(makeCtx(testServices(dir)), { video: art('video.final', { files: [film] }) }, QcParams.parse({}))
    const report = out.report?.value as unknown as QcReport
    expect(report.checks.map((c) => [c.id, c.status])).toEqual([
      ['black', 'ok'],
      ['silence', 'ok'],
      ['freeze', 'ok'],
      ['loudness', 'ok'],
      ['duration', 'ok'],
      ['format', 'ok']
    ])
    expect(report).toMatchObject({ schema: 'atelier.qc/1', pass: true, score: 100, needsReview: false, frames: [], patches: [] })
    expect(out.report?.meta).toMatchObject({ pass: true, score: 100, needsReview: false, failed: [] })
  })

  it('a film with black, silence, a frozen picture, the wrong size and length fails each check, flags itself, and does not throw', { timeout: 180_000 }, async () => {
    const dir = work('qc-bad')
    const still = path.join(dir, 'still.png')
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=640x360', '-frames:v', '1', still])
    const parts = [
      ['-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=2'],
      ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=2'],
      ['-loop', '1', '-framerate', '30', '-i', still, '-t', '5']
    ]
    const names: string[] = []
    for (const [i, a] of parts.entries()) {
      const f = path.join(dir, `part-${i}.mp4`)
      await ffmpeg([...a, '-r', '30', ...ENC, f])
      names.push(f)
    }
    writeFileSync(path.join(dir, 'list.txt'), names.map((n) => `file '${n.replace(/\\/g, '/')}'`).join('\n'))
    const video = path.join(dir, 'video.mp4')
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-c', 'copy', video])
    // 2 s of tone, 4 s of silence, 3 s of a much quieter tone
    const sound = path.join(dir, 'sound.wav')
    await ffmpeg([
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3,volume=0.01',
      '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]', '-map', '[a]', sound
    ])
    const film = path.join(dir, 'bad.mp4')
    await ffmpeg(['-i', video, '-i', sound, '-c:v', 'copy', '-c:a', 'aac', '-shortest', film])

    const ctx = makeCtx(testServices(dir))
    const out = await qcCheck.run(ctx, { video: art('video.final', { files: [film] }) }, QcParams.parse({ expectedS: 20 }))
    const report = out.report?.value as unknown as QcReport
    const by = Object.fromEntries(report.checks.map((c) => [c.id, c]))
    expect(report.pass).toBe(false)
    expect(report.score).toBe(40)
    expect(report.needsReview).toBe(true)
    expect(report.checks.map((c) => c.status)).toEqual(['fail', 'fail', 'fail', 'fail', 'fail', 'fail'])
    expect(by.black?.findings[0]).toMatchObject({ start: 0 })
    expect(by.black?.findings[0]?.end).toBeCloseTo(2, 0)
    expect(by.silence?.findings[0]?.start).toBeCloseTo(2, 0)
    expect(by.freeze?.findings[0]?.start).toBeGreaterThan(3.5)
    expect(by.format?.detail).toMatch(/640×360/)
    expect(by.duration?.detail).toMatch(/attendait/)
    expect(out.report?.meta).toMatchObject({ pass: false, needsReview: true })
    expect((out.report?.meta?.failed as string[]).sort()).toEqual(['black', 'duration', 'format', 'freeze', 'loudness', 'silence'])
    expect(ctx.reports.some((r) => r.kind === 'log' && r.level === 'warn' && /^qc:/.test(r.text))).toBe(true)
  })

  it('a film with no sound track is reported, not crashed on', { timeout: 60_000 }, async () => {
    const dir = work('qc-mute')
    const film = path.join(dir, 'mute.mp4')
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=3', ...ENC, film])
    const out = await qcCheck.run(makeCtx(testServices(dir)), { video: art('video.final', { files: [film] }) }, QcParams.parse({}))
    const report = out.report?.value as unknown as QcReport
    expect(report.pass).toBe(false)
    expect(report.checks.find((c) => c.id === 'format')?.detail).toMatch(/pas de son/)
  })
})
