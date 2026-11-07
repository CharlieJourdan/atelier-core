// `eyes.look`, the eyes as a tool without any paid key: on a tiny ffmpeg-made clip (a hard cut from red to blue), frames
// evenly spaced plus the scene change, written under the workspace, with duration / fps / size; a run's transcript from its
// word timings; a YouTube link without the Cloud's video analysis gives facts and thumbnails only (and says so), with it
// the Cloud's analysis. Through the toolbox, the analyst's FakeProvider call gets the frames as images. Needs ffmpeg.
import { trackTemp } from '../setup/track-temp'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { FakeProvider } from '../../src/main/llm/fake'
import { eyesLook, inside, pickTimes, transcriptOf, youtubeId, type LookDeps } from '../../src/main/orchestra/eyes-look'
import { MEDIA, NO_FFMPEG, hasFfmpeg } from './engine-node-helpers'
import { agentBySlug, drain, rig } from './orchestra-helpers'

const ANALYSIS = {
  summary: 'A cold open, then the story.',
  hook: { text: 'Nobody came back.', endsAtS: 8, technique: 'mystery' },
  structure: [{ fromS: 0, toS: 8, kind: 'hook' as const, summary: 'cold open' }],
  pacing: { cutsPerMinute: 14, tempo: 'medium' as const, notes: '' },
  shotTypes: ['archive'],
  onScreenText: [],
  music: { present: true, mood: 'tense', notes: '' },
  callsToAction: []
}

describe('eyes.look pure parts', () => {
  it('picks half evenly spaced frames and the rest at scene changes, never two within 0.75 s, and fills its budget', () => {
    expect(pickTimes(10, [], 4)).toEqual([1.25, 3.75, 6.25, 8.75])
    const t = pickTimes(10, [2, 2.2, 5.1, 9.0], 6)
    expect(t).toHaveLength(6)
    expect(t).toEqual([...t].sort((a, b) => a - b))
    for (let i = 1; i < t.length; i++) expect(t[i]! - t[i - 1]!).toBeGreaterThanOrEqual(0.75)
    expect(t.some((x) => Math.abs(x - 5.1) < 0.2)).toBe(true)
    expect(pickTimes(3, [], 40)).toHaveLength(16) // the budget: at most 16 frames per call
  })

  it('reads YouTube ids, keeps team files inside the team folder, writes transcripts by ten seconds', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=abc123XYZ_9')).toBe('abc123XYZ_9')
    expect(youtubeId('https://youtu.be/abc123XYZ_9')).toBe('abc123XYZ_9')
    expect(youtubeId('https://www.youtube.com/shorts/abc123XYZ_9')).toBe('abc123XYZ_9')
    expect(youtubeId('https://example.com/watch?v=x')).toBeNull()
    expect(() => inside('/team', '../secret.txt')).toThrow(/cannot leave/)
    expect(() => inside('/team', '/etc/passwd')).toThrow(/relative/)
    const words = [
      { word: 'Nobody', start: 0, end: 0.4 },
      { word: 'came', start: 0.4, end: 0.7 },
      { word: 'back.', start: 0.7, end: 1 },
      { word: 'Then', start: 11, end: 11.3 }
    ]
    expect(transcriptOf(words)).toBe('[0:00] Nobody came back.\n[0:11] Then')
  })

  it('a YouTube link without the Cloud’s video analysis: facts and thumbnails only, and it says so', async () => {
    const deps: LookDeps = {
      media: null,
      outDir: '/x',
      teamDir: '/x',
      youtube: {
        ready: async () => false,
        analyse: async () => {
          throw new Error('must not be called')
        },
        facts: () => ({ title: 'Le vol 19', views: 120_000, durationS: 640, publishedAt: '2026-09-01T00:00:00Z' })
      },
      signal: new AbortController().signal,
      stamp: 's'
    }
    const r = await eyesLook({ url: 'https://www.youtube.com/watch?v=abc123XYZ_9' }, deps)
    expect(r.images).toEqual([])
    expect(r.text).toMatch(/video analysis is off on Atelier Cloud/)
    expect(r.text).toContain('https://i.ytimg.com/vi/abc123XYZ_9/maxresdefault.jpg')
    expect(r.text).toContain('Le vol 19 · 120000 views · 640 s')
    // with the Cloud's analysis on, the link goes through it (capped at 15 minutes)
    let asked = 0
    const on = await eyesLook(
      { url: 'https://youtu.be/abc123XYZ_9' },
      { ...deps, youtube: { ...deps.youtube!, ready: async () => true, analyse: async (_u, minutes) => ((asked = minutes), { analysis: ANALYSIS, demo: false }) } }
    )
    expect(asked).toBeCloseTo(640 / 60)
    expect(on.text).toContain('Hook (until 8 s, mystery): Nobody came back.')
    await expect(eyesLook({ file: 'a.mp4', url: 'https://youtu.be/x' }, deps)).rejects.toThrow(/exactly one source/)
  })
})

describe.skipIf(!hasFfmpeg)(`eyes.look on a real clip (${hasFfmpeg ? 'ffmpeg' : NO_FFMPEG})`, () => {
  const dir = trackTemp(mkdtempSync(path.join(tmpdir(), 'atelier-eyes-look-')))
  const clip = path.join(dir, 'clip.mp4')

  beforeAll(async () => {
    // 1.5 s of red then 1.5 s of blue: one hard cut at 1.5 s
    await MEDIA!.run(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1.5:r=25', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1.5:r=25', '-filter_complex', '[0][1]concat=n=2:v=1:a=0', '-pix_fmt', 'yuv420p', clip],
      { signal: new AbortController().signal }
    )
    writeFileSync(path.join(dir, 'clip.srt'), '1\n00:00:00,000 --> 00:00:01,000\nNobody came back.\n')
  }, 60_000)

  it('takes N frames under the workspace, with the facts and the transcript beside the file', async () => {
    const out = path.join(dir, 'workspace', 'eyes')
    const r = await eyesLook({ file: clip, frames: 4 }, { media: MEDIA, outDir: out, teamDir: dir, signal: new AbortController().signal, stamp: 'look-1' })
    expect(r.images).toHaveLength(4)
    for (const im of r.images) {
      expect(existsSync(im.path)).toBe(true)
      expect(path.relative(out, im.path).startsWith('..')).toBe(false)
      expect(im.mimeType).toBe('image/jpeg')
    }
    // the hard cut is one of the frames
    expect(r.images.some((im) => Math.abs(im.atS - 1.5) < 0.2)).toBe(true)
    expect(r.text).toMatch(/3\.0 s, 320×240, 25 fps, 1 scene change/)
    expect(r.text).toContain('Transcript:\nNobody came back.')
  }, 60_000)

  it('through the analyst’s technologies: frames attached as images, paths under the runtime’s workspace', async () => {
    const provider = new FakeProvider((req) =>
      req.prompt.includes('Regarde')
        ? { text: 'Vu.\n```atelier\n{"actions":[{"type":"done","result":"Deux plans fixes, une coupe franche."}]}\n```', toolCalls: [{ name: 'eyes_look', args: { file: clip, pass: 'quick', frames: 3 } }] }
        : 'ok'
    )
    const r = rig({ providerFor: () => provider, core: { orchestra: { services: { media: () => MEDIA } } } })
    const analyst = agentBySlug(r, `competitor-analyst-${r.channels[0]}`)
    r.core.orchestra.enqueue({ assigneeId: analyst.id, kind: 'look', title: 'Regarde la vidéo exemple' })
    await drain(r)
    const res = provider.toolResults[0] as unknown as { name: string; text: string; isError: boolean; images?: { mimeType: string; data: string }[] }
    expect(res).toMatchObject({ name: 'eyes_look', isError: false })
    expect(res.images).toHaveLength(3)
    expect(res.images![0]!.mimeType).toBe('image/jpeg')
    expect(Buffer.from(res.images![0]!.data, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])) // JPEG
    const paths = [...res.text.matchAll(/: (\S+\.jpg)$/gm)].map((m) => m[1]!)
    expect(paths).toHaveLength(3)
    for (const p of paths) {
      expect(existsSync(p)).toBe(true)
      expect(path.relative(path.join(r.dataDir, 'eyes'), p).startsWith('..')).toBe(false)
    }
  }, 60_000)
})
