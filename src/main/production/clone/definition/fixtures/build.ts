// Builds self-consistent whole-video analyses from a channel profile (chantier B's fixtures; tests and proofs only):
// shots are laid out part by part from the profile's shot cycles, and every derived number of the analysis (origin
// shares, layout curve, presence, motion counts, shot lengths) is computed FROM those shots, so the feasibility map and
// the definition can be checked against them. Deterministic; no network, no money.
import { distributionsOf, illustratesByPartOf, shotByPartOf } from '../../analysis/distributions'
import type { AnalysedShot, Layout, MediaOrigin, VideoAnalysis, VideoPart } from '../../../../../shared/clone'
import { median, quantile, round2, round3 } from '../stats'

export interface ShotTemplate {
  kind: AnalysedShot['kind']
  origin: MediaOrigin
  lengthS: number
  layout?: Layout
  angle?: number
  shows: string
  camera?: AnalysedShot['camera']
  /** On-screen text; `$words` repeats the words said (burnt-in captions). */
  text?: string
}

export interface ChannelProfile {
  id: string
  url: string
  language: string
  /** Where each fact comes from (docs path:line) or « fixture » when no doc measured it. */
  sources: Record<string, string>
  durationS: number
  videos: number
  titles: string[]
  parts: { part: VideoPart; share: number; cycle: ShotTemplate[] }[]
  presenter: { kind: VideoAnalysis['presenter']['kind']; identity: Omit<NonNullable<VideoAnalysis['presenter']['identity']>, 'evidence'> | null; angles: { framing: 'close' | 'medium' | 'wide'; description: string }[]; entries: string[]; exits: string[] }
  voice: { kind: VideoAnalysis['voice']['kind']; timbre: string; wpm: number; pausesPerMinute: number; meanPauseS: number; energy: 'low' | 'medium' | 'high' }
  motion: { types: Partial<Record<AnalysedShot['kind'], VideoAnalysis['motion']['elements'][number]['type']>>; durationS: number; easing: string; landingOffsetS: number; texture: string; palette: string[]; fonts: string[] }
  editing: { cutTypes: VideoAnalysis['editing']['cutTypes']; transitions: string[]; colour: string }
  sound: { music: boolean; genre: string; levelDb: number | null; changes: 'none' | 'per-part'; sfx: { kind: string; on: string; perMinute: number }[]; lufs: number }
  script: { structure: string[]; hookPattern: string; promise: string; payoff: string; chapters: boolean; cta: string; sentenceWords: number; tone: string; devices: string[] }
  packaging: { titlePattern: string; thumbnailPattern: string }
}

const WORDS = 'the price of every choice we make shows up later in the numbers and the story we tell ourselves about it'.split(' ')

export function buildAnalyses(p: ChannelProfile): VideoAnalysis[] {
  return Array.from({ length: p.videos }, (_, i) => buildAnalysis(p, i))
}

function buildAnalysis(p: ChannelProfile, i: number): VideoAnalysis {
  const videoId = `${p.id}-v${i + 1}`
  const durationS = Math.round(p.durationS * (1 + ((i % 3) - 1) * 0.08))
  const frame = (atS: number): string => `p2/${videoId}/f${String(Math.round(atS * 10)).padStart(6, '0')}.jpg`
  const ev = (atS: number) => [{ video: videoId, atS, frames: [frame(atS)] }]
  const shots: AnalysedShot[] = []
  const parts: VideoAnalysis['parts'] = []
  let t = 0
  p.parts.forEach((part, pi) => {
    const end = pi === p.parts.length - 1 ? durationS : Math.round(t + part.share * durationS)
    parts.push({ part: part.part, fromS: t, toS: end })
    let k = i % part.cycle.length
    while (t < end - 0.05) {
      const c = part.cycle[k % part.cycle.length]!
      const lengthS = round2(Math.min(c.lengthS, end - t))
      const n = shots.length + 1
      const words = Array.from({ length: Math.max(1, Math.round((lengthS * p.voice.wpm) / 60)) }, (_, w) => WORDS[(n + w) % WORDS.length]).join(' ')
      shots.push({
        n, startS: round2(t), lengthS, kind: c.kind, shows: `${c.shows} (${n})`, onScreenText: c.text === '$words' ? words : (c.text ?? ''), words,
        illustrates: c.origin === 'presenter' ? null : 'yes', camera: c.camera ?? (c.origin === 'motion' || c.origin === 'drawn' ? 'animated' : 'still'),
        origin: c.origin, layout: c.layout ?? 'off', angle: c.layout && c.layout !== 'off' ? (c.angle ?? 0) : null, frames: [frame(t + lengthS / 2)]
      })
      t = round2(t + lengthS)
      k++
    }
  })
  const total = shots.reduce((s, x) => s + x.lengthS, 0)
  const minutes = durationS / 60
  const originShares: Partial<Record<MediaOrigin, number>> = {}
  for (const s of shots) originShares[s.origin] = (originShares[s.origin] ?? 0) + s.lengthS / total
  for (const k of Object.keys(originShares)) originShares[k as MediaOrigin] = round3(originShares[k as MediaOrigin]!)
  const inPart = (part: VideoPart) => { const span = parts.find((x) => x.part === part)!; return shots.filter((s) => s.startS >= span.fromS && s.startS < span.toS) }
  const hasPresenter = p.presenter.kind !== 'none'
  const layoutByPart = hasPresenter ? parts.map(({ part, fromS }) => {
    const ss = inPart(part)
    const tt = ss.reduce((x, s) => x + s.lengthS, 0)
    const shares: Partial<Record<Layout, number>> = {}
    for (const s of ss) shares[s.layout] = (shares[s.layout] ?? 0) + s.lengthS
    for (const k of Object.keys(shares)) shares[k as Layout] = Math.min(1, round3(shares[k as Layout]! / tt))
    return { part, shares, evidence: ev(fromS + 1) }
  }) : []
  const presenceByPart = layoutByPart.map((l) => ({ part: l.part, share: { value: round3(1 - (l.shares.off ?? 0)), evidence: l.evidence } }))
  const motionKinds = Object.keys(p.motion.types) as AnalysedShot['kind'][]
  const elements = motionKinds.flatMap((kind) => {
    const ss = shots.filter((s) => s.kind === kind && (s.origin === 'motion' || s.origin === 'drawn'))
    if (ss.length === 0) return []
    const first = ss[0]!
    return [{
      type: p.motion.types[kind]!, count: ss.length, meanDurationS: { value: round2(ss.reduce((x, s) => x + s.lengthS, 0) / ss.length), evidence: ev(first.startS) },
      easing: p.motion.easing, palette: p.motion.palette, fonts: p.motion.fonts, texture: p.motion.texture,
      landingOffsetS: { value: p.motion.landingOffsetS, evidence: ev(first.startS) },
      perMinuteByPart: parts.map(({ part, fromS, toS }) => ({ part, perMinute: round2(inPart(part).filter((s) => s.kind === kind).length / Math.max((toS - fromS) / 60, 0.1)) }))
    }]
  })
  const lengths = shots.map((s) => s.lengthS)
  const curve = [0, 0.5].map((f) => { const from = f * durationS, to = (f + 0.5) * durationS; const xs = shots.filter((s) => s.startS >= from && s.startS < to).map((s) => s.lengthS); return { fromS: from, toS: to, meanShotS: round2(xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1)) } })
  return {
    schema: 'atelier.clone.video-analysis/1', cloneId: 'fixture', createdAt: '2026-11-04T00:00:00Z',
    videoId, url: `${p.url}/video-${i + 1}`, title: p.titles[i % p.titles.length]!,
    coverage: { durationS, readS: durationS, complete: true, gaps: [], unreadAxes: [], said: null },
    parts, shots,
    denseFrames: Array.from({ length: 30 }, (_, k) => ({ atS: k * 0.5, path: frame(k * 0.5) })),
    presenter: hasPresenter ? {
      kind: p.presenter.kind,
      identity: p.presenter.identity ? { ...p.presenter.identity, evidence: ev(1) } : null,
      angles: p.presenter.angles.map((a, k) => ({ id: `a${k}`, framing: a.framing, description: a.description, frames: [frame(1 + k)] })),
      layoutByPart, presenceByPart,
      entries: p.presenter.entries.map((how) => ({ atS: 0, how })), exits: p.presenter.exits.map((how) => ({ atS: durationS - 5, how }))
    } : { kind: 'none', identity: null, angles: [], layoutByPart: [], presenceByPart: [], entries: [], exits: [] },
    voice: { kind: p.voice.kind, timbre: p.voice.timbre, wordsPerMinute: { value: p.voice.wpm + (i % 3) - 1, evidence: ev(30) }, pausesPerMinute: { value: p.voice.pausesPerMinute, evidence: ev(30) }, meanPauseS: { value: p.voice.meanPauseS, evidence: ev(30) }, energy: p.voice.energy },
    motion: { elements, palette: p.motion.palette, fonts: p.motion.fonts },
    editing: {
      cutTypes: p.editing.cutTypes,
      meanShotS: { value: round2(total / shots.length), evidence: ev(60) }, medianShotS: { value: round2(median(lengths)), evidence: ev(60) }, p90ShotS: { value: round2(quantile(lengths, 0.9)), evidence: ev(60) },
      shotCurve: curve, holdsOver5S: shots.filter((s) => s.lengthS > 5).length, transitions: p.editing.transitions, originShares, colour: p.editing.colour,
      shotByPart: shotByPartOf(shots, parts), illustratesByPart: illustratesByPartOf(shots, parts)
    },
    // the analysis's own measure of every element along the video (analysis/distributions.ts), on the built shots
    distributions: distributionsOf({ videoId, shots, parts, durationS, motion: new Set(shots.filter((s) => motionKinds.includes(s.kind)).map((s) => s.n)) }),
    sound: {
      music: { present: p.sound.music, genre: p.sound.genre, levelUnderVoiceDb: p.sound.levelDb === null ? null : { value: p.sound.levelDb, evidence: ev(30) }, changesAtS: p.sound.changes === 'per-part' ? parts.slice(1).map((x) => x.fromS) : [] },
      sfx: p.sound.sfx.map((x) => ({ kind: x.kind, on: x.on, count: Math.round(x.perMinute * minutes) })),
      loudnessLufs: { value: p.sound.lufs, evidence: ev(30) }
    },
    script: { structure: p.script.structure, hookPattern: p.script.hookPattern, promise: p.script.promise, payoff: p.script.payoff, chapters: p.script.chapters ? [{ atS: 60, title: 'part 1' }] : [], cta: p.script.cta, sentenceWordsMean: { value: p.script.sentenceWords, evidence: ev(30) }, tone: p.script.tone, devices: p.script.devices },
    packaging: { title: p.titles[i % p.titles.length]!, titlePattern: p.packaging.titlePattern, thumbnail: { path: null, pattern: p.packaging.thumbnailPattern } },
    costUsd: 0
  }
}
