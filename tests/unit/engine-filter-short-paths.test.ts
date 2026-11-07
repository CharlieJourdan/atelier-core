// production-17 item 5: a filter (libass's `ass`, FreeType's `fontfile`) opens its file through the C library, which on Windows
// stops at MAX_PATH (260); a deep artefact path failed a real render (« Could not create a libass track »). withShortPaths copies
// a long path to a short temp folder for the length of one ffmpeg run, and leaves a short one alone.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FILTER_PATH_MAX, filterPath, withShortPaths } from '../../src/engine/media/filters'
import { hasFullFfmpeg, MEDIA, NO_FULL_FFMPEG, RESOURCES, tempDir } from './engine-node-helpers'

/** One white caption in Inter Bold over the first two seconds of a 640×360 frame. */
const ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Default,Inter,48,&H00FFFFFF,&H00000000,&H00000000,1,0,1,0,0,2,20,20,40

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,Bonjour à tous
`

/** A folder under `root` whose path is at least `length` characters long. */
function deepDir(root: string, length: number): string {
  let dir = root
  for (let i = 0; dir.length < length; i++) dir = path.join(dir, `deeply-nested-artefact-folder-${i}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('withShortPaths', () => {
  it('copies a ~300-character file path to a short one with the same bytes, removed afterwards', async () => {
    const t = tempDir('short-paths')
    try {
      const file = path.join(deepDir(t.dir, 280), 'captions.ass')
      const bytes = Buffer.from('[Script Info]\nTitle: l’été, [x]\n', 'utf8')
      writeFileSync(file, bytes)
      expect(file.length).toBeGreaterThan(290)
      let seen = ''
      const got = await withShortPaths([file], async (short) => {
        seen = short(file)
        expect(seen).not.toBe(file)
        expect(seen.length).toBeLessThan(FILTER_PATH_MAX)
        expect(path.extname(seen)).toBe('.ass')
        expect(readFileSync(seen).equals(bytes)).toBe(true)
        return 42
      })
      expect(got).toBe(42)
      expect(existsSync(seen)).toBe(false)
      expect(existsSync(path.dirname(seen))).toBe(false)
      // the original is untouched
      expect(readFileSync(file).equals(bytes)).toBe(true)
    } finally {
      t.cleanup()
    }
  })

  it('leaves a short path alone, skips null entries and copies nothing', async () => {
    const t = tempDir('short-paths')
    try {
      const file = path.join(t.dir, 'a.ttf')
      writeFileSync(file, 'font')
      await withShortPaths([file, null, undefined, file], async (short) => {
        expect(short(file)).toBe(file)
      })
    } finally {
      t.cleanup()
    }
  })

  it('copies a long folder (libass `fontsdir`) with its files', async () => {
    const t = tempDir('short-paths')
    try {
      const fonts = path.join(deepDir(t.dir, 260), 'fonts')
      mkdirSync(fonts)
      writeFileSync(path.join(fonts, 'Inter-Bold.ttf'), 'bold')
      writeFileSync(path.join(fonts, 'Inter-SemiBold.ttf'), 'semi')
      let seen = ''
      await withShortPaths([fonts], async (short) => {
        seen = short(fonts)
        expect(seen.length).toBeLessThan(FILTER_PATH_MAX)
        expect(readdirSync(seen).sort()).toEqual(['Inter-Bold.ttf', 'Inter-SemiBold.ttf'])
        expect(readFileSync(path.join(seen, 'Inter-SemiBold.ttf'), 'utf8')).toBe('semi')
      })
      expect(existsSync(seen)).toBe(false)
    } finally {
      t.cleanup()
    }
  })

  it('removes the copies when the run fails, and refuses a path it was not given', async () => {
    const t = tempDir('short-paths')
    try {
      const file = path.join(deepDir(t.dir, 280), 'x.ass')
      writeFileSync(file, 'x')
      let seen = ''
      await expect(
        withShortPaths([file], async (short) => {
          seen = short(file)
          throw new Error('ffmpeg failed')
        })
      ).rejects.toThrow('ffmpeg failed')
      expect(seen).not.toBe('')
      expect(existsSync(seen)).toBe(false)
      await expect(withShortPaths([], async (short) => short(file))).rejects.toMatchObject({ code: 'internal' })
    } finally {
      t.cleanup()
    }
  })
})

describe('the ass filter on a deeply nested subtitle file', () => {
  it.skipIf(!hasFullFfmpeg)(`burns the captions from the short copy (${hasFullFfmpeg ? 'ffmpeg found' : NO_FULL_FFMPEG})`, async () => {
    const media = MEDIA
    if (!media) return
    const t = tempDir('short-paths-ass')
    try {
      const file = path.join(deepDir(t.dir, 280), 'captions.ass')
      writeFileSync(file, ASS, 'utf8')
      expect(file.length).toBeGreaterThan(290)
      const fonts = path.join(RESOURCES, 'fonts')
      const lit = await withShortPaths([file, fonts], async (short) => {
        const r = await media.run(
          'ffmpeg',
          ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=2', '-vf', `ass=${filterPath(short(file))}:fontsdir=${filterPath(short(fonts))}`, '-ss', '0.5', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
          { signal: new AbortController().signal }
        )
        return r.stdout.filter((v) => v > 40).length
      })
      // white words on a black frame: some pixels are lit
      expect(lit).toBeGreaterThan(200)
    } finally {
      t.cleanup()
    }
  }, 60_000)
})
