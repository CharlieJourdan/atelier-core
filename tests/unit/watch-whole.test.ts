// « Watch a whole video » (chantier regarder-videos): the log's arithmetic, the local reader (fake programs, fake vision model), the
// model's range-by-range reading (fake Cloud), the cache and the order of the legitimate ways. No program, model or network starts.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { coverageLine, logDigest, WholeVideoLog } from '../../src/shared/shot-log'
import { assembleLog, attachWords, cadenceCurve, hookEnd, shotsFromCuts, wordsPerMinute } from '../../src/engine/watch/log'
import { joinShots, planRanges, readByGemini, toLogShot, type WatchRangeFn } from '../../src/engine/watch/gemini'
import { labelPrompt, parseHook, parseLabels, type Labeller } from '../../src/engine/watch/label'
import { readLocalVideo } from '../../src/engine/watch/local'
import { shotFrames, frameAt } from '../../src/engine/watch/sheets'
import { WatchCache, videoKey } from '../../src/engine/watch/cache'
import { downloadArgs, WholeWatcher } from '../../src/main/eyes/whole'
import { geminiWatch, parseShotLog, watchMaxCostUsd } from '../../src/engine/sourcing/watch'
import type { RunFn } from '../../src/engine/sourcing/types'
import type { Shot } from '../../src/engine/sourcing/watch'
import type { AnalysisResult } from '../../src/shared/video-analysis'
import type { ChannelIntelPort } from '../../src/main/eyes/port'

const dirs: string[] = []
const tmp = async (): Promise<string> => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'watch-test-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

const words = (pairs: Array<[number, string]>) => pairs.map(([atS, word]) => ({ atS, word }))

describe('the log arithmetic', () => {
  it('cuts become numbered shots, each with the words said under it', () => {
    const shots = attachWords(shotsFromCuts([2.5, 6], 10), words([[0.2, 'In'], [0.6, '1940,'], [3, 'Hitler'], [7, 'waited.']]))
    expect(shots.map((s) => [s.n, s.startS, s.endS, s.lengthS])).toEqual([[1, 0, 2.5, 2.5], [2, 2.5, 6, 3.5], [3, 6, 10, 4]])
    expect(shots.map((s) => s.words)).toEqual(['In 1940,', 'Hitler', 'waited.'])
  })

  it('the cadence is a curve per window, and the hook ends on the first sentence after its minimum', () => {
    const shots = shotsFromCuts([1, 2, 3, 4, 40, 70], 90)
    const curve = cadenceCurve(shots, [], 90, 30)
    expect(curve.map((p) => p.shots)).toEqual([5, 1, 1])
    const ws = words([[0, 'One'], [5, 'two.'], [16, 'Three'], [18, 'four.'], [19, 'Five']])
    expect(hookEnd(ws, 600)).toBe(19)
    expect(hookEnd([], 600)).toBe(30)
    expect(hookEnd([], 150)).toBe(5)
    expect(wordsPerMinute(words([[0, 'a'], [0.5, 'b'], [1, 'c'], [1.5, 'd'], [2, 'e'], [10, 'f']]))).toBe(180)
  })

  it('assembles stats, hook and cost per minute, and validates against the schema', () => {
    const log = assembleLog({
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      title: 't',
      durationS: 120,
      shots: shotsFromCuts([2, 4, 30, 60, 90], 120),
      words: [],
      coverage: { method: 'download', readS: 120, complete: true, gaps: [], cutsFrom: 'scene-detection', wordsFrom: 'none', missing: [] },
      cost: { usd: 0.02, subscription: true, inputTokens: 1000, outputTokens: 200, ms: 60_000 }
    })
    expect(WholeVideoLog.safeParse(log).success).toBe(true)
    expect(log.stats).toMatchObject({ shots: 6, meanShotS: 20, cutsPerMinute: 2.5 })
    expect(log.hook.shots).toHaveLength(3)
    expect(log.hook.firstCutS).toBe(2)
    expect(log.cost).toMatchObject({ usdPerMinute: 0.01, secondsPerMinute: 30 })
    expect(coverageLine(log.coverage, 6)).toBe('Vidéo lue en entier (2 min 00, 6 plans).')
    expect(logDigest(log)).toContain('WHOLE video')
  })

  it('a partial reading says so plainly, with the part and the reason', () => {
    expect(coverageLine({ method: 'gemini-url', durationS: 600, readS: 300, complete: false, gaps: [{ fromS: 300, toS: 600, why: 'budget de 0.1 $ atteint' }], cutsFrom: 'model', wordsFrom: 'model', missing: [] }, 80)).toBe(
      'Vidéo lue en partie seulement : 5 min 00 sur 10 min 00 (budget de 0.1 $ atteint). Le rythme et la structure ne valent que pour cette partie.'
    )
  })
})

describe('the contact sheets and the labels', () => {
  it('two frames a shot, at a quarter and three quarters of it', () => {
    expect(frameAt(0, 100)).toBe(1)
    expect(frameAt(1.5, 100)).toBe(4)
    expect(shotFrames({ startS: 2, endS: 6 }, 100)).toEqual([7, 11])
    expect(shotFrames({ startS: 49, endS: 51 }, 100)).toEqual([100, 100])
  })

  it('the prompt lists every shot with its times and words; labels are read by number, a bad row dropped', () => {
    const shots = attachWords(shotsFromCuts([3], 6), words([[1, 'Bonjour']]))
    const p = labelPrompt([{ file: 'a.jpg', shots: [1, 2] }], shots, { cols: 6 })
    expect(p).toContain('#1 0:00.0–0:03.0 (3.0 s) words: « Bonjour »')
    expect(p).toContain('#2 0:03.0–0:06.0 (3.0 s) words: (none)')
    const labels = parseLabels('Sure: {"shots":[{"n":1,"kind":"map","shows":"Europe","text":"1940","illustrates":"yes","camera":"push-in"},{"n":"x"},{"n":2,"kind":"spaceship","camera":"warp"}]}')
    expect(labels.get(1)).toEqual({ kind: 'map', shows: 'Europe', onScreenText: '1940', illustrates: 'yes', camera: 'push-in' })
    expect(labels.get(2)).toMatchObject({ kind: 'other', camera: 'unknown', illustrates: null })
    expect(labels.size).toBe(2)
    expect(parseHook('{"firstImage":"a burning map","notes":"fast"}')).toEqual({ firstImage: 'a burning map', notes: 'fast' })
    expect(parseHook('no json')).toBeNull()
  })
})

/** Fake programs: a 20 s 16:9 video with cuts at 5 s and 12 s, whisper words, frames and sheets written as empty files. */
function fakePrograms(o: { whisper?: boolean } = {}): { run: RunFn; calls: string[] } {
  const calls: string[] = []
  const run: RunFn = async (cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`)
    const joined = args.join(' ')
    if (cmd === 'ffprobe' && joined.includes('format=duration')) return { stdout: '20.0\n', stderr: '' }
    if (cmd === 'ffprobe') return { stdout: '1280,720\n', stderr: '' }
    if (cmd === 'ffmpeg' && joined.includes('scene_score')) {
      const rows: string[] = []
      for (let i = 0; i < 480; i++) {
        const t = i / 24
        rows.push(`frame:${i} pts:${i} pts_time:${t.toFixed(4)}`, `lavfi.scene_score=${Math.abs(t - 5) < 0.02 || Math.abs(t - 12) < 0.02 ? '0.6' : '0.01'}`)
      }
      return { stdout: rows.join('\n'), stderr: '' }
    }
    if (cmd === 'ffmpeg' && joined.includes('f_%05d.jpg')) {
      const dir = path.dirname(args[args.length - 1] as string)
      for (let k = 1; k <= 40; k++) await writeFile(path.join(dir, `f_${String(k).padStart(5, '0')}.jpg`), '')
      return { stdout: '', stderr: '' }
    }
    if (cmd === 'ffmpeg' && joined.includes('tile=')) {
      await writeFile(args[args.length - 1] as string, '')
      return { stdout: '', stderr: '' }
    }
    if (cmd === 'ffmpeg') return { stdout: '', stderr: '' }
    if (cmd === 'python') return { stdout: o.whisper === false ? '[]' : JSON.stringify([[0.5, 'Voici'], [1, 'la'], [1.5, 'Suisse.'], [6, 'Les'], [13, 'Alpes.']]), stderr: '' }
    throw new Error(`unexpected program ${cmd}`)
  }
  return { run, calls }
}

const fakeLabeller = (): { labeller: Labeller; prompts: string[]; images: string[][] } => {
  const prompts: string[] = []
  const images: string[][] = []
  return {
    prompts,
    images,
    labeller: async (r) => {
      prompts.push(r.prompt)
      images.push(r.images)
      if (r.prompt.includes('first image')) return { text: '{"firstImage":"a map","notes":"the key image on the first word"}', inputTokens: 900, outputTokens: 40, usd: 0.001, subscription: true }
      const ns = [...r.prompt.matchAll(/^ {2}#(\d+) /gm)].map((m) => Number(m[1]))
      return { text: JSON.stringify({ shots: ns.map((n) => ({ n, kind: 'map', shows: `shot ${n}`, text: '', illustrates: 'yes', camera: 'still' })) }), inputTokens: 3000, outputTokens: 300, usd: 0.004, subscription: true }
    }
  }
}

describe('reading a local file', () => {
  it('counts the cuts, hears the words, labels every shot on contact sheets in one batched call, and reads the hook densely', async () => {
    const p = fakePrograms()
    const l = fakeLabeller()
    const log = await readLocalVideo('C:/videos/ref.mp4', { url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Ref', method: 'download', run: p.run, labeller: l.labeller, tmpDir: await tmp() })
    expect(log.shots.map((s) => [s.startS, s.endS])).toEqual([[0, 5], [5, 12], [12, 20]])
    expect(log.shots.map((s) => s.words)).toEqual(['Voici la Suisse.', 'Les', 'Alpes.'])
    expect(log.shots.every((s) => s.kind === 'map' && s.illustrates === 'yes')).toBe(true)
    expect(log.coverage).toMatchObject({ method: 'download', complete: true, cutsFrom: 'scene-detection', wordsFrom: 'whisper', missing: [] })
    expect(log.hook).toMatchObject({ firstImage: 'a map', notes: 'the key image on the first word' })
    expect(l.prompts).toHaveLength(2)
    expect(l.images[0]).toHaveLength(1)
    expect(log.cost).toMatchObject({ usd: 0.005, subscription: true, inputTokens: 3900, outputTokens: 340 })
    expect(p.calls.filter((c) => c.includes('scene_score'))).toHaveLength(1)
  })

  it('without whisper it takes the captions, and without a vision model it says the labels are missing', async () => {
    const log = await readLocalVideo('C:/videos/ref.mp4', { url: 'u', title: 'Ref', method: 'local-file', run: fakePrograms({ whisper: false }).run, captionWords: words([[0.4, 'Bonjour'], [6, 'toi.']]), tmpDir: await tmp() })
    expect(log.coverage.wordsFrom).toBe('captions')
    expect(log.coverage.missing).toEqual(['labels (no vision model)'])
    expect(log.shots[0]?.words).toBe('Bonjour')
  })
})

const shot = (startS: number, endS: number, extra: Partial<Shot> = {}): Shot => ({ startS, endS, shows: 's', kind: 'archive-film', text: 'none', logo: 'none', ai: false, edited: false, subtitles: false, quality: 4, ...extra })

describe('reading a link with the model, range by range', () => {
  it('plans a dense hook range then 4-minute ranges over the whole video', () => {
    expect(planRanges(600)).toEqual([{ startS: 0, endS: 60, fps: 2 }, { startS: 60, endS: 300 }, { startS: 300, endS: 540 }, { startS: 540, endS: 600 }])
    expect(planRanges(45)).toEqual([{ startS: 0, endS: 45, fps: 2 }])
  })

  it('joins the ranges into one log of the whole video with the dense fields', async () => {
    const asked: Array<{ startS: number; endS: number; fps?: number }> = []
    const watch: WatchRangeFn = async (r) => {
      asked.push({ startS: r.startS, endS: r.endS, ...(r.fps ? { fps: r.fps } : {}) })
      const shots = [shot(r.startS, r.startS + 20, { onText: 'X', says: 'one two three', camera: 'pan' }), shot(r.startS + 20, r.endS)]
      return { shots, costUsd: 0.01, ms: 5, inputTokens: 1000, outputTokens: 100, dense: true }
    }
    const log = await readByGemini({ url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 't', durationS: 300, watch, maxUsd: 1, maxCost: () => 0.02 })
    expect(asked).toEqual([{ startS: 0, endS: 60, fps: 2 }, { startS: 60, endS: 300 }])
    expect(log.coverage).toMatchObject({ method: 'gemini-url', complete: true, readS: 300, cutsFrom: 'model', wordsFrom: 'model', missing: ['illustrates'] })
    expect(log.shots).toHaveLength(4)
    expect(log.shots[0]).toMatchObject({ onScreenText: 'X', words: 'one two three', camera: 'pan', kind: 'archive-film' })
    expect(log.cost).toMatchObject({ usd: 0.02, subscription: false })
  })

  it('stops at the budget and says which part was not read; an older Cloud without the dense mode is said too', async () => {
    const watch: WatchRangeFn = async (r) => ({ shots: [shot(r.startS, r.endS)], costUsd: 0.03, ms: 1, inputTokens: 1, outputTokens: 1, dense: false })
    const log = await readByGemini({ url: 'u', title: 't', durationS: 600, watch, maxUsd: 0.05, maxCost: () => 0.025 })
    expect(log.coverage.complete).toBe(false)
    expect(log.coverage.readS).toBe(60)
    expect(log.coverage.gaps[0]).toMatchObject({ fromS: 60, why: 'budget de 0.05 $ atteint' })
    expect(log.coverage.missing).toEqual(['verbatim text', 'words', 'camera', 'illustrates'])
  })

  it('finds the end of a video of unknown length, and a range that fails is a gap', async () => {
    const watch: WatchRangeFn = async (r) => {
      if (r.startS === 60) throw new Error('HTTP 500')
      return { shots: [shot(r.startS, Math.min(r.endS, r.startS + 40))], costUsd: 0, ms: 1, inputTokens: 1, outputTokens: 1, dense: true }
    }
    const short = await readByGemini({ url: 'u', title: 't', watch, maxUsd: 1, maxCost: () => 0 })
    expect(short.coverage).toMatchObject({ durationS: 40, complete: true })
    const failing = await readByGemini({ url: 'u', title: 't', durationS: 200, watch, maxUsd: 1, maxCost: () => 0 })
    expect(failing.coverage.complete).toBe(false)
    expect(failing.coverage.gaps[0]?.why).toContain('HTTP 500')
  })

  it('trims the overlap where two ranges meet and maps the kinds', () => {
    const joined = joinShots([[toLogShot(shot(0, 61))], [toLogShot(shot(60, 70, { kind: 'photo-still' }))]])
    expect(joined.map((s) => [s.startS, s.endS, s.kind])).toEqual([[0, 61, 'archive-film'], [61, 70, 'archive-photo']])
  })
})

describe('the Gemini dense mode', () => {
  it('keeps the verbatim text, the words and the camera of a dense answer, and prices a denser frame rate higher', () => {
    const shots = parseShotLog(JSON.stringify({ shots: [{ start: '0:01', end: '0:03', shows: 'a', kind: 'graphic', text: 'large', logo: 'none', ai: false, edited: false, subtitles: false, quality: 4, onText: 'EUROPE', says: 'In 1940', camera: 'zoom-warp' }] }), { startS: 0, endS: 60 })
    expect(shots[0]).toMatchObject({ onText: 'EUROPE', says: 'In 1940', camera: 'unknown' })
    expect(watchMaxCostUsd('gemini-3.1-flash-lite', 60, { fps: 2, dense: true })).toBeGreaterThan(watchMaxCostUsd('gemini-3.1-flash-lite', 60))
  })

  it('sends the fps in the clipping metadata', async () => {
    let body = ''
    const fetch = (async (_u: unknown, init?: RequestInit) => {
      body = String(init?.body)
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"shots":[]}' }] } }] }), { status: 200 })
    }) as typeof globalThis.fetch
    await geminiWatch({ url: 'https://www.youtube.com/watch?v=abc', startS: 0, endS: 60, dense: true, fps: 2 }, { apiKey: 'k', fetch })
    expect(JSON.parse(body).contents[0].parts[0].videoMetadata).toEqual({ startOffset: '0s', endOffset: '60s', fps: 2 })
  })
})

describe('the watcher: cache and the order of the legitimate ways', () => {
  it('a normal download carries no cookies, no login and no user config', () => {
    const a = downloadArgs('https://www.youtube.com/watch?v=abcdefghijk', 'D:/t')
    expect(a).toContain('--ignore-config')
    expect(a.join(' ')).not.toMatch(/cookies|username|password|po_token|extractor-args|impersonate|proxy/)
  })

  it('a refused download goes to the model reading; the result is cached and the second call costs nothing', async () => {
    const dir = await tmp()
    let ranges = 0
    const run: RunFn = async (cmd) => {
      if (cmd === 'yt-dlp') throw new Error('Sign in to confirm you’re not a bot')
      throw new Error(`unexpected ${cmd}`)
    }
    const watchRange: WatchRangeFn = async (r) => {
      ranges++
      return { shots: [shot(r.startS, r.endS)], costUsd: 0.001, ms: 1, inputTokens: 1, outputTokens: 1, dense: true }
    }
    const w = new WholeWatcher({ cacheDir: path.join(dir, 'cache'), run, watchRange: () => watchRange, maxCost: () => 0.01, tmpDir: dir })
    const first = await w.watch({ url: 'https://www.youtube.com/watch?v=abcdefghijk', durationS: 90 })
    expect(first.cached).toBe(false)
    expect(first.tried[0]).toContain('téléchargement normal refusé')
    expect(first.log.coverage.method).toBe('gemini-url')
    expect(first.line).toBe('Vidéo lue en entier (1 min 30, 2 plans).')
    const again = await w.watch({ url: 'https://youtu.be/abcdefghijk' })
    expect(again.cached).toBe(true)
    expect(ranges).toBe(2)
    expect(await new WatchCache(path.join(dir, 'cache')).get(videoKey('https://www.youtube.com/shorts/abcdefghijk'))).not.toBeNull()
  })

  it('without any way, it says each reason plainly', async () => {
    const dir = await tmp()
    const w = new WholeWatcher({ cacheDir: dir, run: async () => Promise.reject(new Error('HTTP Error 403')), watchRange: () => null, tmpDir: dir })
    await expect(w.watch({ url: 'https://www.youtube.com/watch?v=abcdefghijk' })).rejects.toThrow(/téléchargement normal refusé.*HTTP Error 403.*Atelier Cloud n’est pas connecté/)
  })

  it('a cache file that no longer matches the schema is read again, never trusted', async () => {
    const dir = await tmp()
    await writeFile(path.join(dir, 'abcdefghijk.json'), '{"version":1}')
    expect(await new WatchCache(dir).get('abcdefghijk')).toBeNull()
    expect(JSON.parse(await readFile(path.join(dir, 'abcdefghijk.json'), 'utf8'))).toEqual({ version: 1 })
  })
})

describe('the clone flow uses the whole video, or says it could not', () => {
  const analysisOf = (): AnalysisResult => ({
    summary: 'Une histoire.',
    hook: { text: 'h', endsAtS: 5, technique: 'question' },
    structure: [],
    pacing: { cutsPerMinute: 8, tempo: 'medium', notes: '' },
    shotTypes: [],
    onScreenText: [],
    music: { present: false, mood: '', notes: '' },
    callsToAction: [],
    measures: { presenterShare: 0, hookPresenterShare: 0, layouts: [], pictures: { aiImage: 0, aiClip: 0, stock: 0, archive: 1, motion: 0 }, shotS: 7.5, look: 'archive', captions: 'none', labelsPerMinute: 0, wordsPerMinute: 135, offer: null }
  })
  const intel = (whole: boolean): ChannelIntelPort => ({
    connected: () => true,
    channelData: async () => Promise.reject(new Error('unused')),
    analyseVideo: async () => ({ analysis: analysisOf(), demo: false }),
    ...(whole
      ? {
          watchWhole: async (url: string) => {
            const log = assembleLog({ url, title: 't', durationS: 120, shots: shotsFromCuts([3, 6, 9, 12], 120), words: [], coverage: { method: 'download', readS: 120, complete: true, gaps: [], cutsFrom: 'scene-detection', wordsFrom: 'none', missing: [] }, cost: { usd: 0, subscription: true, inputTokens: 0, outputTokens: 0, ms: 1 } })
            return { log, line: coverageLine(log.coverage, log.stats.shots) }
          }
        }
      : {})
  })

  it('the counted mean shot of the whole video replaces the guess, and the reading is said', async () => {
    const { measureReferences } = await import('../../src/main/production/style-agent/references')
    const [ref] = await measureReferences([{ url: 'https://www.youtube.com/watch?v=abcdefghijk', kind: 'video' }], intel(true), new AbortController().signal)
    expect(ref?.coverage).toEqual(['Vidéo lue en entier (2 min 00, 5 plans).'])
    expect(ref?.logs?.[0]).toContain('WHOLE video')
    expect(ref?.measures[0]?.minutes).toBe(2)
    const [partial] = await measureReferences([{ url: 'https://www.youtube.com/watch?v=abcdefghijk', kind: 'video' }], intel(false), new AbortController().signal)
    expect(partial?.coverage?.[0]).toMatch(/^Vidéo regardée sur ses 5 premières minutes seulement/)
  })
})

describe('a label batch that fails', () => {
  it('leaves those shots as gaps of the reading: the log says partial, never « read in full »', async () => {
    const l: Labeller = async (r) => {
      if (r.prompt.includes('first image')) return { text: '{"firstImage":"a map"}', inputTokens: 1, outputTokens: 1, usd: 0, subscription: true }
      throw new Error('vision model down')
    }
    const log = await readLocalVideo('C:/v.mp4', { url: 'u', title: 't', method: 'download', run: fakePrograms().run, labeller: l, tmpDir: await tmp() })
    expect(log.coverage.complete).toBe(false)
    expect(log.coverage.gaps.length).toBeGreaterThan(0)
    expect(log.coverage.missing.some((m) => m.startsWith('labels of'))).toBe(true)
    const { unlabelledGaps } = await import('../../src/engine/watch/local')
    expect(unlabelledGaps([{ n: 1, startS: 0, endS: 5 }, { n: 2, startS: 5, endS: 9 }, { n: 3, startS: 9, endS: 12 }], new Set([1, 2]))).toEqual([{ fromS: 0, toS: 9, why: expect.any(String) }])
  })
})

describe('caption changes counted as cuts', () => {
  it('a shot the model marks as the same take joins the one before, with both words and texts', async () => {
    const { mergeContinued } = await import('../../src/engine/watch/label')
    const shots = attachWords(shotsFromCuts([1, 2, 4], 6), words([[0.2, 'Mes'], [1.2, 'parents'], [2.5, 'avaient'], [4.5, 'raison.']])).map((s, i) => ({ ...s, onScreenText: ['Mes', 'parents', 'avaient', 'raison.'][i] as string }))
    const merged = mergeContinued(shots, new Set([2, 3, 1]))
    expect(merged.map((s) => [s.n, s.startS, s.endS, s.words, s.onScreenText])).toEqual([[1, 0, 4, 'Mes parents avaient', 'Mes / parents / avaient'], [2, 4, 6, 'raison.', 'raison.']])
  })

  it('a long caption-only run in the labeller answer is merged in the local reading', async () => {
    const l: Labeller = async (r) => {
      const ns = [...r.prompt.matchAll(/^ {2}#(\d+) /gm)].map((m) => Number(m[1]))
      return { text: JSON.stringify({ shots: ns.map((n) => ({ n, kind: 'stock-footage', shows: 'x', text: '', illustrates: 'partly', camera: 'still', cont: n === 2 })) }), inputTokens: 1, outputTokens: 1, usd: 0, subscription: true }
    }
    const log = await readLocalVideo('C:/v.mp4', { url: 'u', title: 't', method: 'download', run: fakePrograms().run, labeller: l, tmpDir: await tmp() })
    expect(log.shots.map((s) => [s.startS, s.endS])).toEqual([[0, 12], [12, 20]])
    expect(log.stats.shots).toBe(2)
  })
})

describe('the families of a long video', () => {
  it('add their share of time without rounding each small shot to nothing', () => {
    const shots = shotsFromCuts(Array.from({ length: 399 }, (_, i) => (i + 1) * 4.5), 1800).map((s, i) => ({ ...s, kind: i % 2 ? ('map' as const) : ('archive-film' as const) }))
    const log = assembleLog({ url: 'u', title: 't', durationS: 1800, shots, words: [], coverage: { method: 'download', readS: 1800, complete: true, gaps: [], cutsFrom: 'scene-detection', wordsFrom: 'none', missing: [] }, cost: { usd: 0, subscription: true, inputTokens: 0, outputTokens: 0, ms: 1 } })
    expect(log.stats.kinds).toEqual({ 'archive-film': 0.5, map: 0.5 })
  })
})
