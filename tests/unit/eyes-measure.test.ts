// Issue #93: the eyes COUNT cuts and words a minute instead of trusting the model's guess (src/engine/sourcing/measure-video.ts,
// src/main/eyes/refine.ts, src/main/cloud/intel.ts). Real ffmpeg on a synthetic video; nothing touches the network.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cutsFromScores, detectCuts, measureFile, parseSceneScores, shotMeasure, speechMeasure, wordsFromJson3 } from '../../src/engine/sourcing/measure-video'
import { spawnRun } from '../../src/engine/sourcing/providers/ytdlp'
import type { RunFn } from '../../src/engine/sourcing/types'
import { CloudChannelIntel } from '../../src/main/cloud/intel'
import { applyLocalMeasures, fetchArgs, localRefiner } from '../../src/main/eyes/refine'
import type { AnalysisResult } from '../../src/shared/video-analysis'

const analysis: AnalysisResult = {
  summary: 's',
  hook: { text: 'h', endsAtS: 5, technique: 't' },
  structure: [],
  pacing: { cutsPerMinute: 13, tempo: 'medium', notes: 'guess' },
  shotTypes: [],
  onScreenText: [],
  music: { present: false, mood: '', notes: '' },
  callsToAction: [],
  measures: { presenterShare: 0, layouts: [], pictures: { aiImage: 1, aiClip: 0, stock: 0, archive: 0, motion: 0 }, shotS: 4.5, look: 'illustrated', captions: 'none', labelsPerMinute: 0, wordsPerMinute: 135, offer: null }
}

describe('counted measures', () => {
  it('cuts come from the scene score with a refractory gap, shot lengths from the cuts', () => {
    const rows: [number, number][] = [[0.04, 0.9], [2, 0.05], [2.5, 0.2], [2.6, 0.5], [5, 0.09], [7.5, 0.02]]
    expect(cutsFromScores(rows)).toEqual([2.5, 5]) // 0.04 is the opening frame, 2.6 is the same cut, 2 is under the score
    expect(parseSceneScores('pts_time:2.5\nlavfi.scene_score=0.21\npts_time:3.0\nlavfi.scene_score=0.01')).toEqual([[2.5, 0.21], [3, 0.01]])
    expect(shotMeasure([2.5, 5], 10)).toMatchObject({ shots: 3, meanS: 3.33, cutsPerMinute: 12, tempo: 'fast' })
    expect(shotMeasure([], 3)).toBeNull()
  })

  it('speech rate is words over speaking time, long pauses left out; too few words is no measure', () => {
    const words = Array.from({ length: 200 }, (_, i) => ({ atS: i * 0.3 + (i >= 100 ? 30 : 0), word: 'mot' }))
    // 200 words over 89.7 s first to last, minus one 30.3 s silence = 59.4 s of speech
    expect(speechMeasure(words)).toMatchObject({ words: 200, wordsPerMinute: 202 })
    expect(speechMeasure(words.slice(0, 10))).toBeNull()
  })

  it('reads the words of auto captions from json3', () => {
    const raw = JSON.stringify({ events: [{ tStartMs: 1000, segs: [{ utf8: 'bon' }, { utf8: ' jour', tOffsetMs: 400 }] }, { tStartMs: 3000 }] })
    expect(wordsFromJson3(raw)).toEqual([{ atS: 1, word: 'bon' }, { atS: 1.4, word: 'jour' }])
    expect(wordsFromJson3('not json')).toEqual([])
  })

  it('replaces the guess of the model with the counted numbers, and leaves it alone when nothing was counted', () => {
    const shots = shotMeasure([2.5, 5], 10)!
    const out = applyLocalMeasures(analysis, { shots, speech: { words: 200, speakingS: 60, wordsPerMinute: 219 }, wordsFrom: 'captions' })
    expect(out.measures).toMatchObject({ shotS: 3.33, wordsPerMinute: 219 })
    expect(out.pacing).toMatchObject({ cutsPerMinute: 12, tempo: 'fast' })
    expect(applyLocalMeasures(analysis, { shots: null, speech: null, wordsFrom: null })).toBe(analysis)
  })

  it('finds the real cuts of a video (3 colour blocks, cuts at 3 s and 6 s)', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'measure-test-'))
    try {
      const file = path.join(dir, 'v.mp4')
      execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=24:d=3', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=3', '-f', 'lavfi', '-i', 'color=c=lime:s=320x180:r=24:d=4', '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0', '-pix_fmt', 'yuv420p', file])
      const cuts = await detectCuts(file, spawnRun)
      expect(cuts).toHaveLength(2)
      expect(cuts[0]).toBeCloseTo(3, 0)
      expect(cuts[1]).toBeCloseTo(6, 0)
      const m = await measureFile(file, spawnRun, { captionWords: Array.from({ length: 60 }, (_, i) => ({ atS: i * 0.25, word: 'w' })) })
      expect(m.shots).toMatchObject({ shots: 3, meanS: 3.33 })
      expect(m.speech?.wordsPerMinute).toBe(244)
      expect(m.wordsFrom).toBe('captions')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the refiner', () => {
  it('only reads: no cookies, no login, the link after `--`', () => {
    const args = fetchArgs('https://youtu.be/x', '/tmp/d', 300)
    expect(args.join(' ')).not.toMatch(/cookies|--username|--password|--netrc|--exec/)
    expect(args.slice(-2)).toEqual(['--', 'https://youtu.be/x'])
  })

  // issue #101: the counted download kept only the picture (`bestvideo`), so the audio extraction failed silently and whisper heard
  // nothing. The fake yt-dlp below honours the format it is asked: it writes a sound track only when the format asks for one.
  it('the download keeps the audio track: whisper hears the words (#101)', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'measure-audio-'))
    try {
      const heard: string[] = []
      const run: RunFn = async (cmd, args, o) => {
        if (cmd === 'yt-dlp') {
          const format = args[args.indexOf('-f') + 1] ?? ''
          const out = (args[args.indexOf('-o') + 1] ?? '').replace('%(ext)s', 'mp4')
          const withSound = format.split('/').some((alt) => alt.includes('+ba') || alt.startsWith('ba') || alt.startsWith('b['))
          const sound = withSound ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6'] : []
          await spawnRun('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=6', ...sound, '-pix_fmt', 'yuv420p', out], o)
          return { stdout: '', stderr: '' }
        }
        if (cmd === 'python') {
          // the fake whisper: it hears words only on a sound file that exists and is not empty
          const audio = args[args.indexOf('-c') + 2] as string
          const size = existsSync(audio) ? statSync(audio).size : 0
          heard.push(`${size}`)
          return { stdout: size > 1000 ? JSON.stringify(Array.from({ length: 30 }, (_, i) => [i * 0.2, 'mot'])) : '[]', stderr: '' }
        }
        return spawnRun(cmd, args, o)
      }
      const m = await localRefiner({ run, tmpDir: dir })('https://youtu.be/x', 0.1, new AbortController().signal)
      expect(m?.wordsFrom).toBe('whisper')
      expect(m?.speech?.wordsPerMinute).toBeGreaterThan(100)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null, never an error, when the video cannot be fetched (YouTube blocks the network)', async () => {
    const refine = localRefiner({ run: async () => Promise.reject(new Error('Sign in to confirm you are not a bot')) })
    await expect(refine('https://youtu.be/x', 1, new AbortController().signal)).resolves.toBeNull()
  })

  it('the intel of the app applies the counted numbers to a real reading, not to a demonstration; its key carries the day', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'measure-intel-'))
    try {
      const now = new Date().toISOString()
      const keys: string[] = []
      const make = (demo: boolean) => {
        const fetchImpl = (async (url: string, init?: RequestInit) => {
          const body = init?.body ? JSON.parse(String(init.body)) : {}
          if (url.endsWith('/v1/quotes')) return new Response(JSON.stringify({ id: `qq${keys.length}`, usage: 'analyseVideo', gridVersion: 1, creditValueEur: 0.01, lines: [], totalCredits: 1, referenceEur: null, demo, createdAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString() }), { status: 200 })
          keys.push(body.idempotencyKey)
          return new Response(JSON.stringify({ id: 'j', usage: 'analyseVideo', state: 'succeeded', quoteId: 'q', credits: 1, attempts: 1, error: null, result: { analysis }, artefacts: [], demo, createdAt: now, updatedAt: now }), { status: 200 })
        }) as unknown as typeof fetch
        const api = { session: { connected: () => true, baseUrl: () => 'http://c.test', token: async () => 't' } }
        const counted = { shots: shotMeasure([2.5, 5], 10), speech: { words: 200, speakingS: 60, wordsPerMinute: 219 }, wordsFrom: 'captions' as const }
        return new CloudChannelIntel(api as never, { record: () => undefined } as never, { fetchImpl, pollMs: 5, stateDir: dir, now: () => new Date('2026-11-03T10:00:00Z'), refine: async () => counted })
      }
      const real = await make(false).analyseVideo('https://youtu.be/x', 5, new AbortController().signal, 'l')
      expect(real.analysis.measures).toMatchObject({ shotS: 3.33, wordsPerMinute: 219 })
      const demo = await make(true).analyseVideo('https://youtu.be/y', 5, new AbortController().signal, 'l')
      expect(demo.analysis.measures).toMatchObject({ shotS: 4.5, wordsPerMinute: 135 })
      expect(keys[0]).toMatch(/^analyse-[0-9a-f]{24}-5-2026-11-03$/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
