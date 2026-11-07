import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { joinedInput } from '../../src/engine/render/final'
import type { MediaService } from '../../src/engine/services'

/** A media service whose ffprobe says each segment lasts `durations[file]` seconds; ffmpeg calls are recorded. */
function fakeMedia(durations: Record<string, number>, calls: string[][]): MediaService {
  return {
    run: async (tool: string, args: string[]) => {
      calls.push([tool, ...args])
      const file = args[args.length - 1] as string
      return { stdout: Buffer.from(JSON.stringify({ format: { duration: String(durations[path.basename(file)] ?? 0) }, streams: [] })), stderr: Buffer.alloc(0) }
    }
  } as unknown as MediaService
}

describe('joinedInput (no joined copy of the segments)', () => {
  it('reads the concat list itself when the segment lengths add up', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ji-'))
    try {
      const calls: string[][] = []
      const r = await joinedInput(fakeMedia({ 'a.mp4': 2, 'b.mp4': 1 }, calls), [path.join(dir, 'a.mp4'), path.join(dir, 'b.mp4')], 90, dir, new AbortController().signal)
      expect(r.file).toBeNull()
      expect(r.args.slice(0, 4)).toEqual(['-f', 'concat', '-safe', '0'])
      expect((await readFile(r.args[5] as string, 'utf8')).split('\n')).toHaveLength(2)
      expect(calls.every(([tool]) => tool === 'ffprobe')).toBe(true) // nothing was written
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to the joined file when the lengths do not add up', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ji-'))
    try {
      const calls: string[][] = []
      const media = fakeMedia({ 'a.mp4': 2, 'b.mp4': 1, 'joined.mp4': 3 }, calls)
      const r = await joinedInput(media, [path.join(dir, 'a.mp4'), path.join(dir, 'b.mp4')], 120, dir, new AbortController().signal)
      expect(r.file).not.toBeNull()
      expect(r.args[0]).toBe('-i')
      expect(calls.some(([tool]) => tool === 'ffmpeg')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
