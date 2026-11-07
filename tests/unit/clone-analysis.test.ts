// Chantier moteur-analyse: P1 corpus picks, P2 measures (shots, speech, loudness, music bed, pitch, landing, captions),
// the look and script parsers, the assembly into the contract's VideoAnalysis, its exit checks, and the cross-video
// synthesis (styles, constants vs variations, fields of the Style Definition, mix by axes). Synthetic inputs, no network.
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { VideoAnalysis, atPath, isSourced, type Corpus, type CorpusVideo } from '../../src/shared/clone'
import type { WholeVideoLog } from '../../src/shared/shot-log'
import { definitionDefaults } from '../../src/main/production/clone/definition-defaults'
import { assembleAnalysis, type AssembleInput } from '../../src/main/production/clone/analysis/assemble'
import { medianPitchHz, musicLevel, parseEbur128, PITCH_RATE, timbreFromPitch } from '../../src/main/production/clone/analysis/audio'
import { shotFrameTime } from '../../src/main/production/clone/analysis/frames'
import { parseJsonObject, parseShotLooks, ScriptRead, shotLookPrompt, type ShotLook } from '../../src/main/production/clone/analysis/look'
import { captionShare, cutSnapShare, denseTimes, landingOffsets, shotStats, speechStats, type Word } from '../../src/main/production/clone/analysis/measures'
import { EXTRACTORS, agreement, mixSynthesis, realSynthesis } from '../../src/main/production/clone/analysis/synthesis'
import { guessLanguage } from '../../src/main/production/clone/analysis/eyes'
import { checkP1, pickCorpus, channelNameOf } from '../../src/main/production/clone/p1-corpus'
import { checkP2, checkP2Video, framesOnDisk, runP2 } from '../../src/main/production/clone/p2-analysis'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { CloneStore } from '../../src/main/production/clone/store'
import { phaseContext } from '../../src/main/production/clone/context'
import type { ChannelVideo } from '../../src/main/production/clone/services'

// ── a synthetic 120 s video: a presenter (two framings) alternating with motion charts and found footage
const DURATION = 120
const SHOT = 4
const words: Word[] = Array.from({ length: 300 }, (_, i) => {
  // 2.5 words/s, a 0.5 s pause every 10 words
  const start = i * 0.36 + Math.floor(i / 10) * 0.5
  return { word: i % 10 === 9 ? 'growth.' : i === 42 ? '46' : 'money', start, end: start + 0.3 }
})
function log(): WholeVideoLog {
  const shots = Array.from({ length: DURATION / SHOT }, (_, i) => ({
    n: i + 1, startS: i * SHOT, endS: (i + 1) * SHOT, lengthS: SHOT,
    kind: (['presenter', 'chart', 'stock-footage', 'presenter'] as const)[i % 4]!,
    shows: `shot ${i + 1}`, onScreenText: i === 4 ? '46 Mds' : i % 4 === 1 ? 'money money growth' : '', words: 'money money money growth',
    illustrates: (i % 4 === 2 ? 'no' : 'yes') as 'yes' | 'no', camera: (i % 4 === 1 ? 'animated' : 'still') as 'animated' | 'still'
  }))
  return {
    version: 1, url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Why money grows', readAt: 'now',
    coverage: { method: 'download', durationS: DURATION, readS: DURATION, complete: true, gaps: [], cutsFrom: 'scene-detection', wordsFrom: 'whisper', missing: [] },
    shots, hook: { endS: 12, shots: shots.slice(0, 3), firstCutS: 4, meanShotS: 4, paceVsBody: 1, words: '' },
    cadence: [], stats: { shots: shots.length, meanShotS: 4, medianShotS: 4, cutsPerMinute: 15, wordsPerMinute: 150, kinds: {} },
    cost: { usd: 0.02, subscription: true, inputTokens: 0, outputTokens: 0, ms: 0, usdPerMinute: 0, secondsPerMinute: 0 }
  }
}
const video: CorpusVideo = { id: 'v1', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Why money grows', publishedAt: null, views: null, durationS: DURATION, why: 'latest', note: 'latest #1' }
function looks(): Map<number, ShotLook> {
  const m = new Map<number, ShotLook>()
  for (let n = 1; n <= DURATION / SHOT; n++) {
    const k = (n - 1) % 4
    m.set(n, k === 0 ? { layout: 'full', framing: 'medium', view: 'front', origin: 'presenter', motion: null }
      : k === 3 ? { layout: 'half-left', framing: 'close', view: 'left', origin: 'presenter', motion: 'number' }
        : k === 1 ? { layout: 'off', framing: null, view: null, origin: 'motion', motion: 'chart' }
          : { layout: 'off', framing: null, view: null, origin: 'found', motion: null })
  }
  return m
}
const script: ScriptRead = {
  hookEndS: 12, promo: [{ fromS: 60, toS: 72, what: 'sponsor' }], endFromS: 104, structure: ['hook', 'promise', 'three points', 'payoff', 'cta'],
  hookPattern: 'shock number then question', promise: 'you will know where money grows', payoff: 'the answer with a figure', chapters: [],
  cta: 'subscribe and download the app', tone: 'direct, friendly', devices: ['running numbers', 'rhetorical questions'], titlePattern: 'question title', voiceKind: 'real', voiceClue: 'breaths'
}
function input(over: Partial<AssembleInput> = {}): AssembleInput {
  const frames = new Map<number, string>()
  for (const s of log().shots) frames.set(shotFrameTime(s), `p2-v1/frames/t${Math.round(shotFrameTime(s) * 10)}.jpg`)
  for (const t of denseTimes(12, [12, 60, 72, 104], DURATION)) frames.set(t, `p2-v1/frames/t${Math.round(t * 10)}.jpg`)
  return {
    cloneId: 'c1', createdAt: 'now', video, log: log(), words, pitchHz: 118,
    loudness: { points: [], integratedLufs: -14.2, lraLu: 6 }, music: { present: true, underVoiceDb: -18.5, pauseLufs: -33, speechLufs: -14.5, samples: [3.9, 7.9, 11.9] },
    looks: looks(),
    global: { identity: { age: '35-45', gender: 'man', face: 'short beard', hair: 'short brown', wardrobe: 'navy blazer', setting: 'studio', lighting: 'soft', shots: [1, 5] }, presenterKind: 'real', palette: ['#0B1F3A', '#F5B700'], fonts: ['Bold sans'], texture: 'flat', easing: 'snappy ease-out', colour: 'clean', transitions: ['hard'], thumbnailPattern: 'face + number' },
    script, frames, thumbnail: 'p2-v1/thumbnail.jpg', costUsd: 0, ...over
  }
}

describe('P2 measures', () => {
  it('shot stats, curve, holds and the longest shot', () => {
    const st = shotStats([{ n: 1, startS: 0, lengthS: 2 }, { n: 2, startS: 2, lengthS: 8 }, { n: 3, startS: 10, lengthS: 2 }], 12)
    expect(st.meanS).toBe(4)
    expect(st.medianS).toBe(2)
    expect(st.holdsOver5S).toBe(1)
    expect(st.longest).toEqual({ n: 2, lengthS: 8 })
    expect(st.curve.length).toBeGreaterThan(0)
  })
  it('speech pace and pauses from word timings, null when too few words', () => {
    const sp = speechStats(words)!
    expect(sp.words).toBe(300)
    expect(sp.wordsPerMinute).toBeGreaterThan(140)
    expect(sp.wordsPerMinute).toBeLessThan(160)
    expect(sp.meanPauseS).toBeCloseTo(0.56, 1)
    expect(speechStats(words.slice(0, 5))).toBeNull()
  })
  it('landing offsets match on-screen tokens to spoken words; captions and cut snapping are shares', () => {
    const shots = [{ n: 1, startS: 15, lengthS: 4, onScreenText: '46 Mds', words: 'x' }]
    const off = landingOffsets(shots, words)
    expect(off).toHaveLength(1)
    expect(off[0]!.offsetS).toBeCloseTo(15 - words[42]!.start, 2)
    expect(captionShare([{ n: 1, startS: 0, lengthS: 2, onScreenText: 'the money grows', words: 'the money grows fast' }, { n: 2, startS: 2, lengthS: 2, onScreenText: '', words: 'nothing said here' }])).toBe(0.5)
    expect(cutSnapShare([{ n: 1, startS: 0, lengthS: 3.85 }, { n: 2, startS: 3.85, lengthS: 2 }], words)).toBe(1)
  })
  it('dense times cover the hook and ±2 s of each part change every 0.5 s', () => {
    const t = denseTimes(3, [50], 100)
    expect(t.filter((x) => x <= 3)).toHaveLength(7)
    expect(t.filter((x) => x >= 48 && x <= 52)).toHaveLength(9)
  })
})

describe('P2 sound', () => {
  it('parses the ebur128 log and measures the bed in the pauses', () => {
    const lines = Array.from({ length: 1200 }, (_, k) => {
      const t = k / 10
      const inPause = words.some((w, i) => i > 0 && t > words[i - 1]!.end + 0.05 && t < w.start)
      return `[Parsed_ebur128_0 @ 0] t: ${t.toFixed(1)}   TARGET:-23 LUFS    M: ${inPause ? '-34.0' : '-15.0'} S: -16.0     I: -15.0 LUFS       LRA:   2.0 LU`
    })
    const log = parseEbur128(`${lines.join('\n')}\n[Parsed_ebur128_0 @ 0] Summary:\n  Integrated loudness:\n    I:         -14.6 LUFS\n  Loudness range:\n    LRA:         5.1 LU\n`)
    expect(log.integratedLufs).toBe(-14.6)
    expect(log.lraLu).toBe(5.1)
    const m = musicLevel(log, words)!
    expect(m.present).toBe(true)
    expect(m.underVoiceDb).toBe(-19)
  })
  it('measures the pitch of a voiced signal and names its range', () => {
    const pcm = new Int16Array(PITCH_RATE * 120)
    for (let k = 0; k < pcm.length; k++) pcm[k] = Math.round(8000 * Math.sin((2 * Math.PI * 120 * k) / PITCH_RATE) + 3000 * Math.sin((2 * Math.PI * 240 * k) / PITCH_RATE))
    const hz = medianPitchHz(pcm, words)!
    expect(Math.abs(hz - 120)).toBeLessThan(4)
    expect(timbreFromPitch(hz)).toMatch(/low pitch.*male-range/)
    expect(timbreFromPitch(null)).toMatch(/not measured/)
  })
  it('guesses the spoken language for the recogniser', () => {
    expect(guessLanguage("c'est pour vous que les gens dans la rue")).toBe('fr')
    expect(guessLanguage('this is the way you are going with that')).toBe('en')
  })
})

describe('P2 look and script parsers', () => {
  it('parses look rows, drops malformed ones and never invents a value', () => {
    const r = parseShotLooks('1|full|medium|front|presenter|-\n2|off|-|-|motion|chart\n3|sideways|-|-|found|-\nnot a row\n#4|inset|close|left|presenter|number')
    expect(r.looks.size).toBe(3)
    expect(r.dropped).toBe(1)
    expect(r.looks.get(2)).toEqual({ layout: 'off', framing: null, view: null, origin: 'motion', motion: 'chart' })
    expect(r.looks.get(4)!.layout).toBe('inset')
  })
  it('the look prompt lists every shot of its sheets; the script answer is schema-checked', () => {
    const p = shotLookPrompt([{ file: 'x', rel: 'p2-v1/sheets/sheet_001.jpg', shots: [1, 2] }], log().shots)
    expect(p).toMatch(/#1 0:00.0/)
    expect(p).toMatch(/#2 /)
    expect(parseJsonObject(`ok ${JSON.stringify(script)} done`, ScriptRead)?.hookEndS).toBe(12)
    expect(parseJsonObject('{"hookEndS": "soon"}', ScriptRead)).toBeNull()
  })
})

describe('P2 assembly', () => {
  it('builds a complete VideoAnalysis that passes checkP2Video, with parts, presenter census, voice and motion', () => {
    const a = VideoAnalysis.parse(assembleAnalysis(input()))
    expect(checkP2Video(a)).toEqual({ ok: true, problems: [] })
    expect(a.parts.map((p) => p.part)).toEqual(['hook', 'body', 'promo', 'body', 'end'])
    expect(a.presenter.kind).toBe('real')
    expect(a.presenter.angles).toHaveLength(2)
    expect(a.presenter.layoutByPart.find((l) => l.part === 'body')!.shares.full).toBeGreaterThan(0.2)
    expect(a.presenter.entries.length).toBeGreaterThan(5)
    expect(a.voice.timbre).toMatch(/118 Hz/)
    expect(a.voice.wordsPerMinute.value).toBeGreaterThan(140)
    expect(a.editing.originShares.presenter).toBeCloseTo(0.5, 1)
    expect(a.editing.longestShotS!.value).toBe(4)
    expect(a.motion.elements.map((e) => e.type).sort()).toEqual(['chart', 'number'])
    expect(a.sound.music.levelUnderVoiceDb!.value).toBe(-18.5)
    expect(a.coverage.complete).toBe(true)
    expect(a.unmeasured!.some((u) => u.startsWith('sound.music.genre'))).toBe(true)
    expect(a.denseFrames.some((d) => Math.abs(d.atS - 60) <= 2)).toBe(true)
  })
  it('says what it could not read: no words, no script, no look rows', () => {
    const a = VideoAnalysis.parse(assembleAnalysis(input({ words: null, script: null, looks: new Map() })))
    expect(a.coverage.complete).toBe(false)
    expect(a.coverage.unreadAxes).toEqual(expect.arrayContaining(['look', 'script', 'words']))
    expect(a.coverage.said).toMatch(/not read/)
    expect(checkP2Video(a).ok).toBe(true)
  })
  it('whisper heard nothing but the shot log carries the words: the pace is counted from them, said, pauses unmeasured (Reddit Chroniques)', () => {
    const base = input()
    const spoken = base.log.shots.filter((s) => s.words.trim().length > 0)
    const words = spoken.reduce((t, s) => t + s.words.trim().split(/\s+/).length, 0)
    const seconds = spoken.reduce((t, s) => t + s.lengthS, 0)
    const a = VideoAnalysis.parse(assembleAnalysis(input({ words: [] })))
    expect(words).toBeGreaterThanOrEqual(20)
    {
      expect(a.voice.wordsPerMinute.value).toBe(Math.round((words / seconds) * 60))
      expect(a.voice.wordsPerMinute.evidence[0]!.note).toMatch(/shot log .*whisper large-v3 heard nothing/)
      expect(a.unmeasured!.some((u) => u.startsWith('voice.wordsPerMinute'))).toBe(false)
    }
    expect(a.unmeasured!.some((u) => u.startsWith('voice.pausesPerMinute'))).toBe(true)
  })
  it('drawn faces the look calls a presenter stay drawings when the shot log saw illustrations (Le Monde en POV)', () => {
    const drawnLog = log()
    // most « presenter » shots logged as drawings, one of them as a screen capture: the character is a drawing everywhere
    let k = 0
    drawnLog.shots = drawnLog.shots.map((x) => ({ ...x, kind: x.kind === 'presenter' ? (k++ === 0 ? 'screen-capture' as const : 'illustration' as const) : x.kind }))
    const a = assembleAnalysis(input({ log: drawnLog, global: { ...input().global!, identity: null, presenterKind: 'avatar' } }))
    expect(a.presenter.kind).toBe('none')
    expect(a.shots.every((x) => x.origin !== 'presenter' && x.layout === 'off')).toBe(true)
    expect(checkP2Video(a).ok).toBe(true)
  })
  it('a drawn recurring character is not a presenter, even when the looks call its close-ups « presenter » (Le Monde en POV v4)', () => {
    // the shot looks call the hero's face close-ups « presenter, full », the global look « avatar »; the second look said the face
    // is drawn: no presenter, and its check passes
    const fig = { body: 'silhouette' as const, rim: true, faces: 'expressive' as const, colour: 'hero' as const }
    for (const global of [
      { ...input().global!, identity: null, presenterKind: 'avatar' as const, figures: fig, drawnPresenter: true },
      { ...input().global!, identity: null, presenterKind: null, drawnPresenter: true }
    ]) {
      const a = assembleAnalysis(input({ global }))
      expect(a.presenter.kind).toBe('none')
      expect(a.shots.every((x) => x.origin !== 'presenter' && x.layout === 'off')).toBe(true)
      expect(a.unmeasured?.join(' ')).toMatch(/drawn character/)
      expect(checkP2Video(a).ok, checkP2Video(a).problems.join('; ')).toBe(true)
    }
    // a real presenter the look described stays one, characters drawn or not; drawn figures in the cards and a presenter no look
    // described (Finary v3) keep the presenter too (the video is then set aside by its check, never silently made presenter-less)
    expect(assembleAnalysis(input({ global: { ...input().global!, figures: fig } })).presenter.kind).not.toBe('none')
    expect(assembleAnalysis(input({ global: { ...input().global!, identity: null, presenterKind: 'real', figures: fig } })).presenter.kind).toBe('real')
  })
  it('the second look covers every presenter kind and can say the face is drawn', async () => {
    const { withIdentity } = await import('../../src/main/production/clone/analysis/eyes')
    const { identityShots, IdentityRead } = await import('../../src/main/production/clone/analysis/look')
    const g = { ...input().global!, identity: null, presenterKind: 'avatar' as const }
    expect(withIdentity(g, IdentityRead.parse({ identity: null, presenterKind: null, drawn: true }))).toMatchObject({ identity: null, presenterKind: null, drawnPresenter: true })
    // no shot the looks call « presenter »: the shots someone is on screen in are looked at
    const onScreen = new Map([...looks()].map(([n, l]) => [n, { ...l, origin: l.origin === 'presenter' ? ('filmed' as const) : l.origin }]))
    expect(identityShots(onScreen).length).toBeGreaterThan(0)
  })
  it('a channel without a person has no presenter at all', () => {
    const none = new Map([...looks()].map(([n, l]) => [n, { ...l, layout: 'off' as const, framing: null, view: null, origin: l.origin === 'presenter' ? 'drawn' as const : l.origin }]))
    const a = assembleAnalysis(input({ looks: none, global: { ...input().global!, identity: null, presenterKind: null } }))
    expect(a.presenter).toMatchObject({ kind: 'none', identity: null, angles: [], layoutByPart: [] })
    expect(checkP2Video(a).ok).toBe(true)
  })
  it('refuses a bare-note evidence and checks the frames on disk with the dense windows', () => {
    const a = assembleAnalysis(input())
    const bad = { ...a, sound: { ...a.sound, loudnessLufs: { value: -14, evidence: [{ frames: [], note: 'trust me' }] } } }
    expect(checkP2Video(bad).problems.join()).toMatch(/only a note/)
    const dir = mkdtempSync(path.join(os.tmpdir(), 'p2-frames-'))
    const exists = (rel: string): boolean => existsSync(path.join(dir, rel))
    expect(framesOnDisk(a, exists).problems.join()).toMatch(/missing on disk/) // nothing written: refused
    mkdirSync(path.join(dir, 'p2-v1', 'frames'), { recursive: true })
    writeFileSync(path.join(dir, a.shots[0]!.frames[0]!), 'x')
    expect(framesOnDisk(a, exists).problems.join()).toMatch(/missing on disk/)
  })
})

const analysis = (id: string, over: (a: VideoAnalysis) => VideoAnalysis = (a) => a): VideoAnalysis => over({ ...VideoAnalysis.parse(assembleAnalysis(input())), videoId: id })

describe('P2 synthesis', () => {
  it('every extractor names a Style Definition field', () => {
    const d = definitionDefaults()
    for (const x of EXTRACTORS) expect(isSourced(atPath(d, x.field)), x.field).toBe(true)
  })
  it('numbers agree within ±25 % of the median; texts by shared words; shares by their largest key', () => {
    expect(agreement('number', [10, 11, 9, 30]).frequency).toBe(0.75)
    expect(agreement('text', ['direct friendly tone', 'friendly direct tone', 'cold and slow']).frequency).toBeCloseTo(0.67, 1)
    expect(agreement('shares', [{ a: 0.7, b: 0.3 }, { a: 0.6, b: 0.4 }, { b: 0.9, a: 0.1 }]).agree).toEqual([0, 1])
  })
  it('one style: constants with frequencies and evidence, checkP2 passes, values in the definition shape', () => {
    const analyses = ['v1', 'v2', 'v3', 'v4', 'v5'].map((id) => analysis(id, (a) => (id === 'v5' ? { ...a, voice: { ...a.voice, wordsPerMinute: { ...a.voice.wordsPerMinute, value: 300 } } } : a)))
    const body = realSynthesis(analyses, null)
    expect(body.styles).toHaveLength(1)
    const wpm = body.constants.find((c) => c.field === 'voice.wordsPerMinute')!
    expect(wpm.frequency).toBe(0.8)
    expect(wpm.videos).not.toContain('v5')
    const curve = body.constants.find((c) => c.field === 'presenter.layoutCurve')!.value as { part: string; shares: Record<string, number> }[]
    expect(curve.find((p) => p.part === 'body')!.shares.full).toBeGreaterThan(0)
    expect((body.constants.find((c) => c.field === 'presenter.configurations')!.value as unknown[]).length).toBe(2)
    const corpus: Corpus = { schema: 'atelier.clone.corpus/1', cloneId: 'c1', createdAt: 'now', mode: 'channel', channelVideoCount: 9, videos: analyses.map((a) => ({ ...video, id: a.videoId })) }
    expect(checkP2(analyses, { schema: 'atelier.clone.synthesis/1', cloneId: 'c1', createdAt: 'now', ...body }, corpus)).toEqual({ ok: true, problems: [] })
    expect(body.constants.find((c) => c.field === 'sound.musicLevelUnderVoiceDb')!.evidence[0]!.frames.length).toBeGreaterThan(0)
  })
  it('a count of angles stays whole: 3 and 4 angles agree on 4, never 3.5 (Yarnhub refused at P4)', () => {
    const withAngles = (id: string, n: number): VideoAnalysis => analysis(id, (a) => {
      const one = a.presenter.angles[0]!
      return { ...a, presenter: { ...a.presenter, angles: Array.from({ length: n }, (_, k) => ({ ...one, id: `a${k}` })) } }
    })
    const body = realSynthesis([withAngles('v1', 3), withAngles('v2', 4), withAngles('v3', 3), withAngles('v4', 4)], null)
    const count = body.constants.find((c) => c.field === 'presenter.angleCount')
    expect(count).toBeDefined()
    expect(Number.isInteger(count!.value)).toBe(true)
    expect(count!.value).toBe(4)
  })
  it('a minority variant is kept apart; no dominant style → the synthesis leaves the pick to P2 (which never asks)', () => {
    const short = (id: string): VideoAnalysis => analysis(id, (a) => ({ ...a, editing: { ...a.editing, originShares: { '3d': 0.9, motion: 0.1 } }, presenter: { ...a.presenter, kind: 'none' } }))
    const body = realSynthesis([analysis('v1'), analysis('v2'), analysis('v3'), analysis('v4'), short('v5')], null)
    expect(body.styles).toHaveLength(2)
    expect(body.chosenStyle).toBe('s1')
    expect(body.constants.every((c) => !c.videos.includes('v5'))).toBe(true)
    const split = realSynthesis([analysis('v1'), analysis('v2'), short('v3'), short('v4')], null)
    expect(split.chosenStyle).toBeNull()
    const corpus: Corpus = { schema: 'atelier.clone.corpus/1', cloneId: 'c1', createdAt: 'now', mode: 'channel', channelVideoCount: 4, videos: ['v1', 'v2', 'v3', 'v4'].map((id) => ({ ...video, id, durationS: null })) }
    const p = checkP2([analysis('v1'), analysis('v2'), short('v3'), short('v4')], { schema: 'atelier.clone.synthesis/1', cloneId: 'c1', createdAt: 'now', ...split }, corpus).problems
    // decision 0110: an unresolved choice is no longer a question for the user (P2's pickStyle resolves it before the check);
    // a synthesis left unresolved is a plain refusal
    expect(p).toHaveLength(1)
    expect(p[0]).toMatch(/^several styles found and none chosen/)
    expect(realSynthesis([analysis('v1'), analysis('v2'), short('v3'), short('v4')], { style: 'a 3D animation film' }).chosenStyle).toBe(split.styles.find((s) => s.description.includes('3D'))!.id)
    // the user answered the question with a style's id (the progress screen's buttons): chosen exactly
    expect(realSynthesis([analysis('v1'), analysis('v2'), short('v3'), short('v4')], { style: split.styles[1]!.id }).chosenStyle).toBe(split.styles[1]!.id)
  })
  it('a mix takes each axis from the reference that names it', () => {
    const a = [analysis('v1'), analysis('v2')].map((x) => ({ ...x, reference: 0 }))
    const b = [analysis('v3'), analysis('v4')].map((x) => ({ ...x, reference: 1, voice: { ...x.voice, energy: 'low' as const } }))
    const body = mixSynthesis([...a, ...b], { style: null, references: [{ url: 'a', kind: 'channel', axes: ['script'] }, { url: 'b', kind: 'channel', axes: ['voice'] }] })
    expect(body.constants.find((c) => c.field === 'voice.energy')!.value).toBe('low')
    expect(body.constants.find((c) => c.field === 'script.tone')!.videos).toEqual(['v1', 'v2'])
    expect(body.constants.some((c) => c.field.startsWith('editing.'))).toBe(false)
  })
})

describe('P1 corpus', () => {
  const v = (i: number, durationS: number, views: number): ChannelVideo => ({ url: `https://www.youtube.com/watch?v=${String(i).padStart(11, 'x')}`, title: `t${i}`, publishedAt: null, views, durationS })
  it('keeps the long-form main format, fills to five and adds one short as a style variant', () => {
    const all = [v(1, 45, 9e6), v(2, 50, 8e6), v(3, 1200, 10), v(4, 1100, 20), v(5, 1300, 5e5), v(6, 900, 4e5), v(7, 1000, 30), v(8, 40, 1e6), v(9, 44, 1e6)]
    const c = pickCorpus(all)
    expect(c.filter((x) => x.why !== 'style-variant').every((x) => (x.durationS ?? 0) >= 180)).toBe(true)
    expect(c.filter((x) => x.why !== 'style-variant')).toHaveLength(5)
    expect(c.find((x) => x.why === 'style-variant')!.durationS).toBe(45)
    expect(c.every((x) => x.note.length > 0)).toBe(true)
  })
  it('a mix reads every reference; a single video stays alone', () => {
    const brief = { references: [{ url: 'https://www.youtube.com/@a', kind: 'channel', axes: [] }, { url: 'https://www.youtube.com/watch?v=b', kind: 'video', axes: ['voice'] }] } as never
    const corpus: Corpus = { schema: 'atelier.clone.corpus/1', cloneId: 'c', createdAt: 'n', mode: 'channel', channelVideoCount: 5, videos: [1, 2, 3, 4, 5].map((i) => ({ ...video, id: `v${i}`, url: `u${i}`, reference: 0 })) }
    expect(checkP1(corpus, brief).problems.join()).toMatch(/reference 2/)
    expect(channelNameOf('https://www.youtube.com/@Finary/videos')).toBe('Finary')
  })
})

describe('P2 loop', () => {
  it('stops before a video when the disk is under the floor or the quote passes the budget left', async () => {
    const ch = fakeChannel('presenter-motion')
    const dir = mkdtempSync(path.join(os.tmpdir(), 'p2-loop-'))
    const corpus: Corpus = { schema: 'atelier.clone.corpus/1', cloneId: 'c1', createdAt: 'n', mode: 'channel', channelVideoCount: 9, videos: pickCorpus(ch.videos) }
    const brief = { references: [{ url: ch.url, kind: 'channel', axes: [] }], style: null } as never
    const low = fakeServices(ch).services
    await expect(runP2(phaseContext(new CloneStore(dir, 'a'), { ...low, disk: { freeGb: async () => 9 } }, 5), corpus, brief)).rejects.toThrow(/disk under the floor/)
    const quoted = fakeServices(ch).services
    const eyes = Object.assign({}, quoted.eyes, { quoteUsd: async () => 3 })
    await expect(runP2(phaseContext(new CloneStore(dir, 'b'), { ...quoted, eyes }, 2), corpus, brief)).rejects.toThrow(/quoted 3.00/)
    const ok = await runP2(phaseContext(new CloneStore(dir, 'c'), { ...quoted, eyes }, 50), corpus, brief)
    expect(ok.analyses).toHaveLength(corpus.videos.length)
  })
  it('one video whose analysis fails its check is set aside, said, and the clone goes on; too many stop it', async () => {
    const ch = fakeChannel('presenter-motion')
    const dir = mkdtempSync(path.join(os.tmpdir(), 'p2-aside-'))
    const corpus: Corpus = { schema: 'atelier.clone.corpus/1', cloneId: 'c1', createdAt: 'n', mode: 'channel', channelVideoCount: 9, videos: pickCorpus(ch.videos) }
    const brief = { references: [{ url: ch.url, kind: 'channel', axes: [] }], style: null } as never
    const s = fakeServices(ch).services
    const broken = (ids: readonly string[]) => Object.assign({}, s.eyes, {
      analyse: async (v: CorpusVideo, d: never) => {
        const a = await s.eyes.analyse(v, d)
        return ids.includes(v.id) ? { ...a, presenter: { ...a.presenter, kind: 'avatar' as const, identity: null } } : a
      }
    })
    const bad = corpus.videos[1]!.id
    const ctx = phaseContext(new CloneStore(dir, 'a'), { ...s, eyes: broken([bad]) }, 50)
    const r = await runP2(ctx, corpus, brief)
    expect(r.analyses.map((a) => a.videoId)).not.toContain(bad)
    expect(r.analyses).toHaveLength(corpus.videos.length - 1)
    expect(ctx.store.decisions().some((d) => d.decision === `${bad} set aside` && /identity/.test(d.why))).toBe(true)
    expect(checkP2(r.analyses, r.synthesis, corpus, [bad]).ok).toBe(true)
    expect(checkP2(r.analyses, r.synthesis, corpus).ok).toBe(false)
    // most of the corpus failing still stops the clone
    const all = corpus.videos.map((v) => v.id)
    await expect(runP2(phaseContext(new CloneStore(dir, 'b'), { ...s, eyes: broken(all) }, 50), corpus, brief)).rejects.toThrow(/identity/)
  })
})

describe('the real eyes service on fake programs', () => {
  it.each([[false], [true]])('prepare → looks → finish: a whole analysis with its frames on disk, dense windows on every part change, scratch deleted (global pass missed the presenter: %s)', async (missed) => {
    const { AnalysisEyes } = await import('../../src/main/production/clone/analysis/eyes')
    const fs = await import('node:fs')
    const root = mkdtempSync(path.join(os.tmpdir(), 'p2-eyes-'))
    const run = async (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
      const out = args[args.length - 1]!
      if (cmd === 'yt-dlp' && args.includes('--write-thumbnail')) fs.writeFileSync(`${args[args.indexOf('-o') + 1]}.jpg`, 'jpg')
      else if (cmd === 'yt-dlp') fs.writeFileSync(path.join(path.dirname(args[args.indexOf('-o') + 1]!), 'v.mp4'), 'video')
      else if (args.includes('ebur128=framelog=verbose')) {
        const lines = Array.from({ length: DURATION * 10 }, (_, k) => `[Parsed_ebur128_0 @ 0] t: ${(k / 10).toFixed(1)}  TARGET:-23 LUFS    M:${words.some((w, i) => i > 0 && k / 10 > words[i - 1]!.end + 0.05 && k / 10 < w.start) ? '-35.0' : '-15.0'} S:-16.0`)
        return { stdout: '', stderr: `${lines.join('\n')}\nSummary:\n    I:         -14.8 LUFS\n    LRA:         4.0 LU\n` }
      } else if (args.includes('s16le')) {
        const pcm = new Int16Array(PITCH_RATE * DURATION)
        for (let k = 0; k < pcm.length; k++) pcm[k] = Math.round(9000 * Math.sin((2 * Math.PI * 200 * k) / PITCH_RATE))
        fs.writeFileSync(out, Buffer.from(pcm.buffer))
      } else if (out.endsWith('f_%05d.jpg')) for (let k = 1; k <= DURATION * 2; k++) fs.writeFileSync(out.replace('%05d', String(k).padStart(5, '0')), 'f')
      else if (out !== '-') fs.writeFileSync(out, 'x')
      return { stdout: '', stderr: '' }
    }
    const looker = async (r: { prompt: string }): Promise<{ text: string; inputTokens: number; outputTokens: number; usd: number; subscription: boolean }> => {
      const text = r.prompt.startsWith('You look at the shots')
        ? [...r.prompt.matchAll(/^ {2}#(\d+) /gm)].map((m) => { const n = Number(m[1]); const l = looks().get(n)!; return `${n}|${l.layout}|${l.framing ?? '-'}|${l.view ?? '-'}|${l.origin}|${l.motion ?? '-'}` }).join('\n')
        : r.prompt.startsWith('Transcript') ? JSON.stringify(script)
        // a global pass whose sample showed no presenter: the second look on his own shots describes him (Finary v3)
        : /talks to the viewer/.test(r.prompt) ? JSON.stringify({ identity: input().global!.identity, presenterKind: 'real' })
        : JSON.stringify(missed ? { ...input().global, identity: null, presenterKind: null } : input().global)
      return { text, inputTokens: 1, outputTokens: 1, usd: 0.01, subscription: true }
    }
    const eyes = new AnalysisEyes({
      watch: async () => log(), run, looker, lookerOnSubscription: true, scratchDir: path.join(root, 'scratch'), cloneId: 'c1', now: () => 'now',
      asr: { transcribe: async () => ({ words: words.map((w) => ({ word: w.word, start: w.start, end: w.end })) }) },
      cached: async () => true
    })
    expect(await eyes.quoteUsd(video)).toBe(0)
    const dir = { abs: path.join(root, 'p2-v1'), rel: 'p2-v1' }
    fs.mkdirSync(dir.abs, { recursive: true })
    const a = VideoAnalysis.parse(await eyes.analyse(video, dir))
    const exists = (rel: string): boolean => fs.existsSync(path.join(root, rel))
    expect(checkP2Video(a)).toEqual({ ok: true, problems: [] })
    expect(framesOnDisk(a, exists)).toEqual({ ok: true, problems: [] })
    expect(exists(a.shots[0]!.frames[0]!)).toBe(true)
    expect(fs.existsSync(path.join(dir.abs, '_frames'))).toBe(false)
    expect(fs.readdirSync(path.join(root, 'scratch'))).toEqual([])
    expect(a.sound.loudnessLufs.value).toBe(-14.8)
    expect(a.sound.music.levelUnderVoiceDb!.value).toBe(-20)
    expect(a.voice.timbre).toMatch(/200 Hz/)
    expect(a.packaging.thumbnail.path).toBe('p2-v1/thumbnail.jpg')
    expect(a.costUsd).toBe(0)
    expect(a.presenter.identity?.age).toBe('35-45')
    expect(a.presenter.kind).toBe('real')
  })
})

describe('the real eyes service when the platform refuses the download', () => {
  it('keeps the whole-video log, says plainly what was not read, and passes the exit check', async () => {
    const { AnalysisEyes } = await import('../../src/main/production/clone/analysis/eyes')
    const fs = await import('node:fs')
    const root = mkdtempSync(path.join(os.tmpdir(), 'p2-refused-'))
    const run = async (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
      if (cmd === 'yt-dlp' && args.includes('--write-thumbnail')) { fs.writeFileSync(`${args[args.indexOf('-o') + 1]}.jpg`, 'jpg'); return { stdout: '', stderr: '' } }
      throw new Error('yt-dlp exited 1: Sign in to confirm you are not a bot')
    }
    const looker = async (r: { prompt: string }): Promise<{ text: string; inputTokens: number; outputTokens: number; usd: number; subscription: boolean }> =>
      ({ text: r.prompt.startsWith('Transcript') ? JSON.stringify(script) : JSON.stringify(input().global), inputTokens: 1, outputTokens: 1, usd: 0, subscription: true })
    const eyes = new AnalysisEyes({ watch: async () => log(), run, looker, scratchDir: path.join(root, 'scratch'), cloneId: 'c1', now: () => 'now', asr: { transcribe: async () => { throw new Error('never called') } } })
    const dir = { abs: path.join(root, 'p2-v1'), rel: 'p2-v1' }
    fs.mkdirSync(dir.abs, { recursive: true })
    const a = VideoAnalysis.parse(await eyes.analyse(video, dir))
    expect(a.coverage.complete).toBe(false)
    expect(a.coverage.unreadAxes).toEqual(expect.arrayContaining(['frames', 'words', 'sound']))
    expect(a.coverage.said).toMatch(/not a bot/)
    expect(a.shots).toHaveLength(DURATION / SHOT)
    expect(checkP2Video(a)).toEqual({ ok: true, problems: [] })
    expect(framesOnDisk(a, (rel) => fs.existsSync(path.join(root, rel))).ok).toBe(true)
  })
})

describe('a link reading that does not cover the file', () => {
  it('is read again locally from the downloaded copy', async () => {
    const { AnalysisEyes } = await import('../../src/main/production/clone/analysis/eyes')
    const fs = await import('node:fs')
    const root = mkdtempSync(path.join(os.tmpdir(), 'p2-reread-'))
    const calls: { file?: string }[] = []
    const partial = { ...log(), coverage: { ...log().coverage, method: 'gemini-url' as const, cutsFrom: 'model' as const, durationS: 60, readS: 60 }, shots: log().shots.slice(0, 15) }
    const run = async (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
      if (cmd === 'ffprobe') return { stdout: `${DURATION}
`, stderr: '' }
      if (cmd === 'yt-dlp' && !args.includes('--write-thumbnail')) fs.writeFileSync(path.join(path.dirname(args[args.indexOf('-o') + 1]!), 'v.mp4'), 'v')
      return { stdout: '', stderr: '' }
    }
    const eyes = new AnalysisEyes({
      watch: async (i) => { calls.push(i); if (i.file) throw new Error('second reading asked'); return partial }, run, looker: null, scratchDir: path.join(root, 's'), cloneId: 'c', now: () => 'n',
      asr: { transcribe: async () => ({ words: [] }) }
    })
    const dir = { abs: path.join(root, 'p2-v1'), rel: 'p2-v1' }
    fs.mkdirSync(dir.abs, { recursive: true })
    await expect(eyes.prepare(video, dir)).rejects.toThrow(/second reading asked/)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.file).toMatch(/v\.mp4$/)
    expect(fs.readdirSync(path.join(root, 's'))).toEqual([])
  })
})

describe('synthesis votes', () => {
  it('a video whose look or sound was not read does not vote on those fields', async () => {
    const { readable } = await import('../../src/main/production/clone/analysis/synthesis')
    const a = analysis('v1', (x) => ({ ...x, coverage: { ...x.coverage, complete: false, unreadAxes: ['look', 'sound'], said: 'no file' } }))
    expect(readable(a, 'presenter.layoutCurve')).toBe(false)
    expect(readable(a, 'sound.loudnessLufs')).toBe(false)
    expect(readable(a, 'editing.meanShotS')).toBe(true)
    expect(readable(a, 'script.tone')).toBe(true)
  })
})

describe('the elements over time (reverse-pipeline)', () => {
  it('the assembled analysis measures every element per part and per tenth, the cadence, pace and illustration per part', () => {
    const a = VideoAnalysis.parse(assembleAnalysis(input()))
    const names = a.distributions!.map((d) => d.element)
    // found footage moves: no still in this video, and an element with no screen time is not listed
    expect(names).not.toContain('still')
    expect(names).toEqual(expect.arrayContaining(['presenter', 'origin:presenter', 'origin:motion', 'origin:found', 'moving', 'motion-design', 'text']))
    const p = a.distributions!.find((d) => d.element === 'presenter')!
    expect(p.curve).toHaveLength(10)
    expect(p.overall).toBeCloseTo(0.5, 1)
    expect(p.byPart.map((x) => x.part)).toEqual(['hook', 'body', 'promo', 'end'])
    expect(a.editing.shotByPart!.find((x) => x.part === 'hook')!.meanShotS).toBe(4)
    expect(a.voice.wpmByPart!.length).toBeGreaterThan(0)
    expect(a.editing.illustratesByPart!.find((x) => x.part === 'body')!.share).toBeGreaterThan(0)
  })
  it('a shot reader that cannot say the illustration leaves it unmeasured (Gemini), and cut kinds never become a constant', () => {
    const l = log()
    const gemini = assembleAnalysis(input({ log: { ...l, coverage: { ...l.coverage, missing: ['illustrates'] }, shots: l.shots.map((s) => ({ ...s, illustrates: null })) } }))
    expect(gemini.unmeasured!.some((u) => u.startsWith('editing.illustratesShare:'))).toBe(true)
    expect(gemini.editing.illustratesShare).toBeUndefined()
    expect(gemini.editing.illustratesByPart).toBeUndefined()
    const body = realSynthesis(['v1', 'v2', 'v3'].map((id) => analysis(id)), null)
    expect(body.constants.some((c) => c.field === 'editing.cutTypes')).toBe(false)
    expect(body.variations.some((v) => v.field === 'editing.cutTypes')).toBe(false)
  })
  it('the synthesis pools the distributions of the agreeing videos; a far-off video does not agree', () => {
    const odd = analysis('v4', (x) => ({ ...x, distributions: x.distributions!.map((d) => (d.element === 'presenter' ? { ...d, overall: 1, curve: d.curve.map(() => 1) } : d.element === 'origin:found' ? { ...d, overall: 0, curve: d.curve.map(() => 0) } : d)) }))
    const body = realSynthesis([analysis('v1'), analysis('v2'), analysis('v3'), odd], null)
    const c = body.constants.find((x) => x.field === 'sourcing.distributions')!
    expect(c.videos).toEqual(['v1', 'v2', 'v3'])
    expect(c.frequency).toBe(0.75)
    const p = (c.value as { element: string; curve: number[]; byPart: { part: string; share: number }[] }[]).find((d) => d.element === 'presenter')!
    expect(p.curve).toEqual(analysis('v1').distributions!.find((d) => d.element === 'presenter')!.curve)
    for (const f of ['editing.shotByPart', 'voice.wpmByPart', 'script.illustratesByPart']) expect(body.constants.some((x) => x.field === f), f).toBe(true)
    // the definition's own shape (style-definition.ts DistributionRow), no evidence inside the value
    expect(Object.keys(p).sort()).toEqual(['byPart', 'curve', 'element', 'overall'])
  })
})

describe('review fixes', () => {
  it('a mix passes checkP2 with a real chosen style', () => {
    const a = [analysis('v1'), analysis('v2'), analysis('v3')].map((x) => ({ ...x, reference: 0 }))
    const b = [analysis('v4'), analysis('v5')].map((x) => ({ ...x, reference: 1 }))
    const body = mixSynthesis([...a, ...b], { style: null, references: [{ url: 'a', kind: 'channel', axes: ['script'] }, { url: 'b', kind: 'channel', axes: ['voice'] }] })
    const corpus: Corpus = { schema: 'atelier.clone.corpus/1', cloneId: 'c1', createdAt: 'now', mode: 'channel', channelVideoCount: 9, videos: [...a, ...b].map((x) => ({ ...video, id: x.videoId, reference: x.reference })) }
    expect(checkP2([...a, ...b], { schema: 'atelier.clone.synthesis/1', cloneId: 'c1', createdAt: 'now', ...body }, corpus)).toEqual({ ok: true, problems: [] })
  })
  it('the end part runs to the end of the video even with a read after it', () => {
    const a = assembleAnalysis(input({ script: { ...script, endFromS: 100, promo: [{ fromS: 104, toS: 110, what: 'merch' }] } }))
    expect(a.parts[a.parts.length - 1]).toEqual({ part: 'end', fromS: 100, toS: DURATION })
  })
  it('a guessed presenter kind and an unmatched landing offset do not vote', () => {
    const noKind = analysis('v1', (x) => ({ ...x, unmeasured: [...(x.unmeasured ?? []), 'presenter.kind: assumed'] }))
    const body = realSynthesis([noKind, noKind, noKind].map((x, i) => ({ ...x, videoId: `v${i + 1}` })), null)
    expect(body.constants.some((c) => c.field === 'presenter.kind')).toBe(false)
  })
  it('a small channel is filled with the other format instead of being refused', () => {
    const v = (i: number, durationS: number): ChannelVideo => ({ url: `https://www.youtube.com/watch?v=${String(i).padStart(11, 'y')}`, title: `t${i}`, publishedAt: null, views: i, durationS })
    const c = pickCorpus([v(1, 900), v(2, 800), v(3, 700), v(4, 40), v(5, 45), v(6, 50)])
    expect(c).toHaveLength(5)
    expect(c.filter((x) => x.why === 'style-variant')).toHaveLength(2)
  })
  it('the recogniser language covers more than French and English', () => {
    expect(guessLanguage('el problema es que los precios para una casa con jardín')).toBe('es')
    expect(guessLanguage('und das ist nicht ein Problem mit der Wohnung')).toBe('de')
  })
})
