// Fake channels for the cloning engine's tests (decision 0095): a « presenter + motion design » channel (a real filmed
// presenter with two angles and per-part layouts, motion cards, found footage) and an « all 3D » channel that cannot be
// reproduced. Each builds whole-video analyses with evidence, deterministic. No network, no money.
import type { AnalysedShot, Corpus, CorpusVideo, Layout, MediaOrigin, VideoAnalysis } from '../../../../shared/clone'
import type { ChannelVideo } from '../services'

export type FakeChannelKind = 'presenter-motion' | 'full-3d'

export interface FakeChannel {
  kind: FakeChannelKind
  url: string
  videos: ChannelVideo[]
  analyse(video: CorpusVideo, frameDir: string): VideoAnalysis
}

const DURATION_S = 300
const SHOT_S = 4

/** One shot pattern per channel: what each shot shows, in a repeating cycle. */
const CYCLES: Record<FakeChannelKind, { kind: AnalysedShot['kind']; origin: MediaOrigin; layout: Layout; angle: number | null }[]> = {
  'presenter-motion': [
    { kind: 'presenter', origin: 'presenter', layout: 'full', angle: 0 },
    { kind: 'motion-graphic', origin: 'motion', layout: 'off', angle: null },
    { kind: 'presenter', origin: 'presenter', layout: 'half-left', angle: 1 },
    { kind: 'chart', origin: 'motion', layout: 'inset', angle: 0 },
    { kind: 'stock-footage', origin: 'found', layout: 'off', angle: null }
  ],
  'full-3d': [
    { kind: 'generated', origin: '3d', layout: 'off', angle: null },
    { kind: 'generated', origin: '3d', layout: 'off', angle: null },
    { kind: 'generated', origin: '3d', layout: 'off', angle: null },
    { kind: 'map', origin: 'motion', layout: 'off', angle: null },
    { kind: 'generated', origin: '3d', layout: 'off', angle: null }
  ]
}

export function fakeChannel(kind: FakeChannelKind): FakeChannel {
  const url = `https://www.youtube.com/@fake-${kind}`
  const videos: ChannelVideo[] = Array.from({ length: 9 }, (_, i) => ({
    url: `https://www.youtube.com/watch?v=fake${kind === 'full-3d' ? '3d' : 'pm'}${i}`,
    title: `Fake ${kind} video ${i}`,
    publishedAt: `2026-10-${String(20 - i).padStart(2, '0')}`,
    views: ((i * 7919) % 13) * 10_000,
    durationS: DURATION_S
  }))
  return { kind, url, videos, analyse: (video, frameDir) => analysis(kind, video, frameDir) }
}

function analysis(kind: FakeChannelKind, video: CorpusVideo, frameDir: string): VideoAnalysis {
  const cycle = CYCLES[kind]
  const frame = (atS: number): string => `${frameDir}/f${String(Math.round(atS * 10)).padStart(5, '0')}.jpg`
  const ev = (atS: number) => [{ video: video.id, atS, frames: [frame(atS)] }]
  const shots: AnalysedShot[] = Array.from({ length: DURATION_S / SHOT_S }, (_, i) => {
    const c = cycle[i % cycle.length]!
    return {
      n: i + 1, startS: i * SHOT_S, lengthS: SHOT_S, kind: c.kind, shows: `${c.kind} ${i}`, onScreenText: '', words: `words of shot ${i + 1}`,
      illustrates: 'yes', camera: c.kind === 'presenter' ? 'still' : 'animated', origin: c.origin, layout: c.layout, angle: c.angle,
      frames: [frame(i * SHOT_S + SHOT_S / 2)]
    }
  })
  const share = (origin: MediaOrigin): number => cycle.filter((c) => c.origin === origin).length / cycle.length
  const origins = [...new Set(cycle.map((c) => c.origin))]
  const hasPresenter = kind === 'presenter-motion'
  const layoutShares = { full: 0.2, 'half-left': 0.2, inset: 0.2, off: 0.4 }
  return {
    schema: 'atelier.clone.video-analysis/1', cloneId: 'fake', createdAt: '2026-11-04T00:00:00Z',
    videoId: video.id, url: video.url, title: video.title,
    coverage: { durationS: DURATION_S, readS: DURATION_S, complete: true, gaps: [], unreadAxes: [], said: null },
    parts: [{ part: 'hook', fromS: 0, toS: 20 }, { part: 'body', fromS: 20, toS: 280 }, { part: 'end', fromS: 280, toS: DURATION_S }],
    shots,
    // every 0.5 s on the hook, and ±2 s around each part change (20 s, 280 s)
    denseFrames: [...new Set([...Array.from({ length: 40 }, (_, i) => i * 0.5), ...Array.from({ length: 9 }, (_, i) => 18 + i * 0.5), ...Array.from({ length: 9 }, (_, i) => 278 + i * 0.5)])]
      .map((atS) => ({ atS, path: frame(atS) })),
    presenter: hasPresenter
      ? {
          kind: 'real',
          identity: { age: '35-45', gender: 'man', face: 'short beard', hair: 'short brown', wardrobe: 'navy blazer', setting: 'bright studio, plants', lighting: 'soft key left', evidence: ev(2) },
          angles: [
            { id: 'a0', framing: 'medium', description: 'facing camera', frames: [frame(2)] },
            { id: 'a1', framing: 'close', description: 'three-quarter left', frames: [frame(10)] }
          ],
          layoutByPart: (['hook', 'body', 'end'] as const).map((part) => ({ part, shares: layoutShares, evidence: ev(part === 'hook' ? 2 : 40) })),
          presenceByPart: (['hook', 'body', 'end'] as const).map((part) => ({ part, share: { value: 0.6, evidence: ev(part === 'hook' ? 2 : 40) } })),
          entries: [{ atS: 0, how: 'cold open on camera' }],
          exits: [{ atS: 296, how: 'cut to end card' }]
        }
      : { kind: 'none', identity: null, angles: [], layoutByPart: [], presenceByPart: [], entries: [], exits: [] },
    voice: { kind: 'real', timbre: 'warm baritone', wordsPerMinute: { value: 165, evidence: ev(30) }, pausesPerMinute: { value: 6, evidence: ev(30) }, meanPauseS: { value: 0.4, evidence: ev(30) }, energy: 'high' },
    motion: {
      elements: [{ type: kind === 'full-3d' ? 'map' : 'number', count: 15, meanDurationS: { value: 3.5, evidence: ev(6) }, easing: 'ease-out', palette: ['#0B1F3A', '#F5B700'], fonts: ['Inter'], texture: 'flat', landingOffsetS: { value: -0.1, evidence: ev(6) }, perMinuteByPart: [{ part: 'body', perMinute: 3 }] }],
      palette: ['#0B1F3A', '#F5B700'],
      fonts: ['Inter']
    },
    editing: {
      cutTypes: { hard: 74 },
      meanShotS: { value: SHOT_S, evidence: ev(60) }, medianShotS: { value: SHOT_S, evidence: ev(60) }, p90ShotS: { value: SHOT_S, evidence: ev(60) },
      shotCurve: [{ fromS: 0, toS: 150, meanShotS: SHOT_S }, { fromS: 150, toS: DURATION_S, meanShotS: SHOT_S }],
      holdsOver5S: 0, transitions: ['hard cut'],
      originShares: Object.fromEntries(origins.map((o) => [o, share(o)])),
      colour: 'clean, high contrast'
    },
    sound: { music: { present: true, genre: 'light electronic', levelUnderVoiceDb: { value: -22, evidence: ev(30) }, changesAtS: [20, 280] }, sfx: [{ kind: 'whoosh', on: 'card entry', count: 12 }], loudnessLufs: { value: -14, evidence: ev(30) } },
    script: { structure: ['hook', 'promise', '3 points', 'payoff', 'cta'], hookPattern: 'question + stakes', promise: 'you will understand X', payoff: 'the answer', chapters: [], cta: 'subscribe', sentenceWordsMean: { value: 12, evidence: ev(30) }, tone: 'direct, friendly', devices: ['rhetorical question'] },
    packaging: { title: video.title, titlePattern: 'question title', thumbnail: { path: null, pattern: 'face + big number' } },
    costUsd: 0.05
  }
}

/** A channel corpus like P1 would pick (helper for tests that start mid-way). */
export function fakeCorpus(ch: FakeChannel): Corpus['videos'] {
  return ch.videos.slice(0, 5).map((v, i) => ({ id: `v${i + 1}`, url: v.url, title: v.title, publishedAt: v.publishedAt, views: v.views, durationS: v.durationS, why: 'latest' as const, note: '' }))
}
