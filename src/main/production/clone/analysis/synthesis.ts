// The real cross-video synthesis (chantier moteur-analyse, spec §2 P2 end): which styles the corpus holds, then — over the
// chosen style's videos — what is constant (the style) and what varies, with frequencies. Every constant names the Style
// Definition field it feeds (a dotted path of style-definition.ts) and carries evidence from each agreeing video.
// Deterministic: numbers agree when they sit within ±25 % of the median, words when they share enough vocabulary, shares
// per key; a value a video could not measure (`unmeasured`) is left out, never counted as a disagreement. Pure.
import { canonLooks } from './canon'
import { isDeepStrictEqual } from 'node:util'
import type { INSPIRATION_AXES} from '../../../../shared/clone';
import { CONSTANT_MIN_FREQUENCY, type Brief, type Evidence, type Synthesis, type SynthesisConstant, type VideoAnalysis } from '../../../../shared/clone'
import { mean, quantile } from './measures'
import { distributionEvidence, poolByPart, poolDistributions } from './distributions'

type Body = Omit<Synthesis, 'schema' | 'cloneId' | 'createdAt'>
type Kind = 'number' | 'text' | 'exact' | 'shares' | 'list' | 'curve'
interface Extractor {
  field: string
  kind: Kind
  /** The value, or undefined when this video could not measure it. */
  read(a: VideoAnalysis): unknown
  evidence(a: VideoAnalysis): Evidence[]
  /** The agreed value in the Style Definition field's own shape (from the agreeing videos). */
  shape?(value: unknown, agreeing: readonly VideoAnalysis[]): unknown
}

/** A number agrees with the median when within this ratio. */
export const NUMBER_TOLERANCE = 0.25
/** Two texts agree when they share this share of their words (Jaccard). */
export const TEXT_AGREEMENT = 0.3
/** Shares (0..1) agree when their mean gap to the median is at most this, and no gap passes SHARE_MAX_GAP. */
export const SHARE_MEAN_GAP = 0.12
export const SHARE_MAX_GAP = 0.25
/** A style holding at least this share of the corpus is chosen without asking (the others are variants). */
export const DOMINANT_STYLE = CONSTANT_MIN_FREQUENCY

const r2 = (n: number): number => Math.round(n * 100) / 100
const unmeasured = (a: VideoAnalysis, key: string): boolean => (a.unmeasured ?? []).some((u) => u.startsWith(`${key}:`))
const first = (a: VideoAnalysis): Evidence[] => [{ video: a.videoId, atS: a.shots[0]!.startS, frames: a.shots[0]!.frames }]
const shotsEv = (a: VideoAnalysis, pred: (s: VideoAnalysis['shots'][number]) => boolean, max = 2): Evidence[] => {
  const list = a.shots.filter(pred)
  const step = Math.max(1, Math.floor(list.length / max))
  const ev = list.filter((_, i) => i % step === 0).slice(0, max).map((s) => ({ video: a.videoId, atS: s.startS, frames: s.frames }))
  return ev.length ? ev : first(a)
}
const hookOf = (a: VideoAnalysis): { fromS: number; toS: number } => a.parts.find((p) => p.part === 'hook') ?? { fromS: 0, toS: a.parts[0]!.toS }
const mustText = (v: string): string | undefined => (v.trim() ? v.trim() : undefined)
/** Evidence at a time: the shot on screen then, with its frame. */
const evAtTime = (a: VideoAnalysis, t: number): Evidence => {
  const s = a.shots.find((x) => t >= x.startS && t < x.startS + x.lengthS) ?? a.shots[a.shots.length - 1]!
  return { video: a.videoId, atS: t, frames: s.frames }
}
/** Evidence over a part (the last span of that part, else the whole video). */
const partEv = (a: VideoAnalysis, part: string, note: string): Evidence => {
  const p = [...a.parts].reverse().find((x) => x.part === part) ?? { fromS: 0, toS: a.coverage.durationS }
  return { ...evAtTime(a, p.fromS), fromS: p.fromS, toS: p.toS, note: note.slice(0, 120) || part }
}
/** The median of measured landing offsets; 0 only when none was measured (the element's own unmeasured note says so). */
const landing = (xs: number[]): number => (xs.length ? r2(quantile(xs, 0.5)) : 0)

/** Analysis → Style Definition field (style-definition.ts paths). */
export const EXTRACTORS: readonly Extractor[] = [
  { field: 'script.wordsPerMinute', kind: 'number', read: (a) => (unmeasured(a, 'voice.wordsPerMinute') ? undefined : a.voice.wordsPerMinute.value), evidence: (a) => a.voice.wordsPerMinute.evidence },
  { field: 'script.sentenceWordsMean', kind: 'number', read: (a) => (unmeasured(a, 'script.sentenceWordsMean') ? undefined : a.script.sentenceWordsMean.value), evidence: (a) => a.script.sentenceWordsMean.evidence },
  { field: 'script.hookWindowS', kind: 'number', read: (a) => r2(hookOf(a).toS - hookOf(a).fromS), evidence: (a) => [{ video: a.videoId, fromS: hookOf(a).fromS, toS: hookOf(a).toS, frames: a.denseFrames.slice(0, 2).map((d) => d.path) }] },
  { field: 'script.hookPattern', kind: 'text', read: (a) => mustText(a.script.hookPattern), evidence: (a) => [{ video: a.videoId, fromS: 0, toS: hookOf(a).toS, frames: a.denseFrames.slice(0, 2).map((d) => d.path) }] },
  { field: 'script.promise', kind: 'text', read: (a) => mustText(a.script.promise), evidence: (a) => [{ video: a.videoId, fromS: 0, toS: hookOf(a).toS, frames: [], note: a.script.promise }] },
  { field: 'script.payoff', kind: 'text', read: (a) => mustText(a.script.payoff), evidence: (a) => [partEv(a, 'end', a.script.payoff)] },
  { field: 'script.tone', kind: 'text', read: (a) => mustText(a.script.tone), evidence: first },
  { field: 'script.cta', kind: 'text', read: (a) => mustText(a.script.cta), evidence: (a) => [partEv(a, 'end', a.script.cta)] },
  { field: 'script.devices', kind: 'list', read: (a) => (a.script.devices.length ? a.script.devices : undefined), evidence: first },
  { field: 'script.chapters', kind: 'exact', read: (a) => a.script.chapters.length > 0, evidence: (a) => (a.script.chapters.length ? a.script.chapters.slice(0, 3).map((c) => ({ ...evAtTime(a, c.atS), note: c.title })) : [partEv(a, 'body', 'no chapter')]) },
  { field: 'voice.kind', kind: 'exact', read: (a) => ((a.unmeasured ?? []).some((u) => u.startsWith('voice.kind: no script')) ? undefined : a.voice.kind), evidence: (a) => a.voice.wordsPerMinute.evidence },
  { field: 'voice.timbre', kind: 'text', read: (a) => (unmeasured(a, 'voice.timbre') ? undefined : a.voice.timbre), evidence: (a) => a.voice.wordsPerMinute.evidence },
  { field: 'voice.wordsPerMinute', kind: 'number', read: (a) => (unmeasured(a, 'voice.wordsPerMinute') ? undefined : a.voice.wordsPerMinute.value), evidence: (a) => a.voice.wordsPerMinute.evidence },
  { field: 'voice.pausesPerMinute', kind: 'number', read: (a) => (unmeasured(a, 'voice.pausesPerMinute') ? undefined : a.voice.pausesPerMinute.value), evidence: (a) => a.voice.pausesPerMinute.evidence },
  { field: 'voice.meanPauseS', kind: 'number', read: (a) => (unmeasured(a, 'voice.meanPauseS') ? undefined : a.voice.meanPauseS.value), evidence: (a) => a.voice.meanPauseS.evidence },
  { field: 'voice.energy', kind: 'exact', read: (a) => (unmeasured(a, 'voice.energy') ? undefined : a.voice.energy), evidence: (a) => a.voice.wordsPerMinute.evidence },
  { field: 'presenter.kind', kind: 'exact', read: (a) => (unmeasured(a, 'presenter.kind') ? undefined : a.presenter.kind), evidence: (a) => shotsEv(a, (s) => s.layout !== 'off') },
  { field: 'presenter.identity', kind: 'text', read: (a) => { if (!a.presenter.identity) return a.presenter.kind === 'none' ? null : undefined; const { evidence: _e, ...d } = a.presenter.identity; return d }, evidence: (a) => a.presenter.identity?.evidence ?? first(a) },
  // a count of angles is a whole number: the median of an even corpus (3 and 4 → 3.5) is rounded up, so every measured angle is
  // configured (Yarnhub refused at P4: « 3 angles configured, 3.5 measured », 2026-11-06)
  { field: 'presenter.angleCount', kind: 'number', read: (a) => a.presenter.angles.length, shape: (v) => Math.ceil(Number(v)), evidence: (a) => [...a.presenter.angles.map((x): Evidence => ({ video: a.videoId, frames: x.frames, note: x.description })), ...first(a)].slice(0, 4) },
  {
    field: 'presenter.configurations', kind: 'list',
    read: (a) => (a.presenter.kind === 'none' ? undefined : [...new Set(a.shots.filter((s) => s.layout !== 'off' && s.angle !== null).map((s) => `${s.layout}/${a.presenter.angles[s.angle!]?.framing ?? 'medium'}`))]),
    evidence: (a) => shotsEv(a, (s) => s.layout !== 'off', 4),
    shape: (v) => {
      const framings = [...new Set((v as string[]).map((c) => c.split('/')[1]!))]
      return (v as string[]).map((c) => { const [layout, framing] = c.split('/') as [string, string]; return { id: `${layout}-${framing}`, framing, layout, angle: framings.indexOf(framing), description: `${layout}, ${framing} framing` } })
    }
  },
  { field: 'presenter.layoutCurve', kind: 'shares', read: (a) => (a.presenter.kind === 'none' ? undefined : Object.fromEntries(a.presenter.layoutByPart.flatMap((l) => Object.entries(l.shares).map(([k, v]) => [`${l.part}.${k}`, v as number])))), evidence: (a) => a.presenter.layoutByPart.flatMap((l) => l.evidence).slice(0, 4), shape: (v) => byPart(v as Record<string, number>, (part, rest) => ({ part, shares: rest })) },
  { field: 'presenter.presenceByPart', kind: 'shares', read: (a) => (a.presenter.kind === 'none' ? undefined : Object.fromEntries(a.presenter.presenceByPart.map((p) => [p.part, p.share.value]))), evidence: (a) => a.presenter.presenceByPart.flatMap((p) => p.share.evidence).slice(0, 4), shape: (v) => Object.entries(v as Record<string, number>).map(([part, share]) => ({ part, share })) },
  {
    field: 'motion.elements', kind: 'list', read: (a) => (a.motion.elements.length ? a.motion.elements.map((e) => e.type) : undefined), evidence: (a) => a.motion.elements.flatMap((e) => e.meanDurationS.evidence).slice(0, 4),
    shape: (v, agreeing) => (v as string[]).map((type) => {
      const els = agreeing.flatMap((a) => a.motion.elements.filter((e) => e.type === type).map((e) => ({ e, a })))
      const med = (f: (x: (typeof els)[number]) => number): number => r2(quantile(els.map(f), 0.5))
      const minutes = (a: VideoAnalysis): number => Math.max(a.coverage.durationS / 60, 1 / 60)
      return {
        type, durationS: Math.max(0.01, med((x) => x.e.meanDurationS.value)), easing: els[0]?.e.easing ?? '', perMinute: med((x) => x.e.count / minutes(x.a)),
        landingOffsetS: landing(els.filter((x) => !unmeasured(x.a, `motion.${type}.landingOffsetS`)).map((x) => x.e.landingOffsetS.value)), texture: els[0]?.e.texture ?? ''
      }
    })
  },
  { field: 'motion.palette', kind: 'list', read: (a) => (a.motion.palette.length ? a.motion.palette.map((c) => c.toUpperCase()) : undefined), evidence: (a) => shotsEv(a, (s) => s.origin === 'motion') },
  { field: 'motion.fonts', kind: 'list', read: (a) => (a.motion.fonts.length ? a.motion.fonts.map((f) => f.toLowerCase()) : undefined), evidence: (a) => shotsEv(a, (s) => s.onScreenText.trim().length > 0) },
  { field: 'motion.densityByPart', kind: 'shares', read: (a) => (a.motion.elements.length ? Object.fromEntries(a.parts.map((p) => [p.part, a.motion.elements.reduce((t, e) => t + (e.perMinuteByPart.find((x) => x.part === p.part)?.perMinute ?? 0), 0)])) : undefined), evidence: (a) => shotsEv(a, (s) => s.origin === 'motion', 3), shape: (v) => Object.entries(v as Record<string, number>).map(([part, perMinute]) => ({ part, perMinute })) },
  {
    field: 'editing.shotCurve', kind: 'shares',
    read: (a) => Object.fromEntries(a.editing.shotCurve.map((c) => [String(Math.min(9, Math.floor((c.fromS / a.coverage.durationS) * 10))), c.meanShotS])),
    evidence: (a) => a.editing.meanShotS.evidence,
    shape: (v) => Object.entries(v as Record<string, number>).sort((x, y) => Number(x[0]) - Number(y[0])).map(([k, m]) => ({ fromShare: Number(k) / 10, toShare: (Number(k) + 1) / 10, meanShotS: Math.max(0.01, m) }))
  },
  { field: 'editing.meanShotS', kind: 'number', read: (a) => a.editing.meanShotS.value, evidence: (a) => a.editing.meanShotS.evidence },
  { field: 'editing.medianShotS', kind: 'number', read: (a) => a.editing.medianShotS.value, evidence: (a) => a.editing.medianShotS.evidence },
  { field: 'editing.p90ShotS', kind: 'number', read: (a) => a.editing.p90ShotS.value, evidence: (a) => a.editing.p90ShotS.evidence },
  { field: 'editing.hookMeanShotS', kind: 'number', read: (a) => { const h = hookOf(a); const s = a.shots.filter((x) => x.startS < h.toS); return s.length ? r2(mean(s.map((x) => x.lengthS))) : undefined }, evidence: (a) => a.denseFrames.slice(0, 3).map((d): Evidence => ({ video: a.videoId, atS: d.atS, frames: [d.path] })).concat(first(a)) },
  { field: 'editing.holdMaxS', kind: 'number', read: (a) => a.editing.longestShotS?.value, evidence: (a) => a.editing.longestShotS?.evidence ?? first(a) },
  { field: 'editing.cutSnapToPhrase', kind: 'exact', read: (a) => (a.editing.cutOnPhraseShare ? a.editing.cutOnPhraseShare.value >= 0.6 : undefined), evidence: (a) => a.editing.cutOnPhraseShare?.evidence ?? first(a) },
  { field: 'editing.transitions', kind: 'list', read: (a) => (a.editing.transitions.length ? a.editing.transitions : undefined), evidence: (a) => a.denseFrames.slice(0, 2).map((d): Evidence => ({ video: a.videoId, atS: d.atS, frames: [d.path] })).concat(first(a)) },
  { field: 'editing.cameraMoves', kind: 'list', read: (a) => { const c = new Map<string, number>(); a.shots.forEach((s) => c.set(s.camera, (c.get(s.camera) ?? 0) + s.lengthS)); const tot = a.shots.reduce((t, s) => t + s.lengthS, 0); return [...c].filter(([k, v]) => k !== 'unknown' && v / tot >= 0.05).map(([k]) => k).sort() }, evidence: (a) => shotsEv(a, (s) => s.camera !== 'still', 3) },
  {
    field: 'editing.cutTypes', kind: 'shares',
    // scene detection counts the cuts but does not see their kind (the analysis says `editing.cutTypes` unmeasured): no vote
    read: (a) => { if (unmeasured(a, 'editing.cutTypes')) return undefined; const tot = Object.values(a.editing.cutTypes).reduce((t, n) => t + (n ?? 0), 0); return tot ? Object.fromEntries(Object.entries(a.editing.cutTypes).map(([k, n]) => [k, r2((n ?? 0) / tot)])) : undefined },
    evidence: (a) => shotsEv(a, () => true, 2)
  },
  { field: 'editing.colour', kind: 'text', read: (a) => mustText(a.editing.colour), evidence: (a) => shotsEv(a, () => true, 3) },
  {
    // how every screen element is distributed along the video: a video agrees when its shares (overall and per tenth) sit close to
    // the corpus median; the agreed value is the agreeing videos' median per part and per tenth
    field: 'sourcing.distributions', kind: 'curve',
    read: (a) => (a.distributions && !unmeasured(a, 'distributions') ? Object.fromEntries(a.distributions.flatMap((d) => [[`${d.element}|all`, d.overall], ...d.curve.map((c, k) => [`${d.element}|${k}`, c])])) : undefined),
    evidence: (a) => distributionEvidence([a], 4),
    shape: (_v, agreeing) => poolDistributions(agreeing)
  },
  {
    field: 'editing.shotByPart', kind: 'shares',
    read: (a) => (a.editing.shotByPart?.length ? Object.fromEntries(a.editing.shotByPart.map((p) => [p.part, p.meanShotS])) : undefined),
    evidence: (a) => (a.editing.shotByPart ?? []).map((p) => partEv(a, p.part, `${p.part}: mean shot ${p.meanShotS} s`)),
    shape: (_v, agreeing) => poolByPart(agreeing, (a) => a.editing.shotByPart, (r) => r.meanShotS).map(({ part, value }) => ({ part, meanShotS: Math.max(0.01, value) }))
  },
  {
    field: 'voice.wpmByPart', kind: 'shares',
    read: (a) => (unmeasured(a, 'voice.wordsPerMinute') || !a.voice.wpmByPart?.length ? undefined : Object.fromEntries(a.voice.wpmByPart.map((p) => [p.part, p.wpm]))),
    evidence: (a) => (a.voice.wpmByPart ?? []).map((p) => partEv(a, p.part, `${p.part}: ${p.wpm} words/min`)),
    shape: (_v, agreeing) => poolByPart(agreeing, (a) => a.voice.wpmByPart, (r) => r.wpm, Math.round).map(({ part, value }) => ({ part, wpm: Math.max(1, value) }))
  },
  {
    field: 'script.illustratesByPart', kind: 'shares',
    read: (a) => { if (unmeasured(a, 'editing.illustratesShare')) return undefined; const rows = (a.editing.illustratesByPart ?? []).filter((p) => p.share !== null); return rows.length ? Object.fromEntries(rows.map((p) => [p.part, p.share!])) : undefined },
    evidence: (a) => (a.editing.illustratesByPart ?? []).filter((p) => p.share !== null).map((p) => partEv(a, p.part, `${p.part}: ${Math.round(p.share! * 100)} % illustrated`)),
    shape: (_v, agreeing) => poolByPart(agreeing, (a) => a.editing.illustratesByPart, (r) => r.share, (n) => Math.round(n * 1000) / 1000).map(({ part, value }) => ({ part, share: value }))
  },
  { field: 'sourcing.originShares', kind: 'shares', read: (a) => a.editing.originShares, evidence: (a) => Object.keys(a.editing.originShares).flatMap((o) => shotsEv(a, (s) => s.origin === o, 1)).slice(0, 6) },
  { field: 'sound.music', kind: 'exact', read: (a) => (unmeasured(a, 'sound.music.levelUnderVoiceDb') ? undefined : a.sound.music.present), evidence: (a) => a.sound.music.levelUnderVoiceDb?.evidence ?? a.sound.loudnessLufs.evidence },
  { field: 'sound.musicLevelUnderVoiceDb', kind: 'number', read: (a) => a.sound.music.levelUnderVoiceDb?.value, evidence: (a) => a.sound.music.levelUnderVoiceDb?.evidence ?? a.sound.loudnessLufs.evidence },
  { field: 'sound.loudnessLufs', kind: 'number', read: (a) => (unmeasured(a, 'sound.loudnessLufs') ? undefined : a.sound.loudnessLufs.value), evidence: (a) => a.sound.loudnessLufs.evidence },
  { field: 'captions.burnIn', kind: 'exact', read: (a) => (a.captions ? a.captions.burnedInShare.value >= 0.5 : undefined), evidence: (a) => a.captions?.burnedInShare.evidence ?? first(a) },
  { field: 'packaging.titlePattern', kind: 'text', read: (a) => mustText(a.packaging.titlePattern), evidence: (a) => [{ video: a.videoId, frames: a.packaging.thumbnail.path ? [a.packaging.thumbnail.path] : [], note: a.packaging.title }] },
  { field: 'packaging.thumbnailPattern', kind: 'text', read: (a) => mustText(a.packaging.thumbnail.pattern), evidence: (a) => [{ video: a.videoId, frames: a.packaging.thumbnail.path ? [a.packaging.thumbnail.path] : [], note: a.packaging.thumbnail.pattern || 'thumbnail' }] }
]

/** Per-part shares keyed `part.layout` → [{ part, shares }]. */
function byPart(v: Record<string, number>, make: (part: string, rest: Record<string, number>) => unknown): unknown[] {
  const parts = new Map<string, Record<string, number>>()
  for (const [k, n] of Object.entries(v)) { const [part, layout] = k.split('.') as [string, string]; parts.set(part, { ...(parts.get(part) ?? {}), [layout]: n }) }
  return [...parts].map(([part, rest]) => make(part, rest))
}

const text = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))
const words = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^a-z0-9àâçéèêëîïôûùüÿœ#-]+/).filter((w) => w.length > 2))
export function jaccard(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  if (x.size === 0 && y.size === 0) return 1
  let inter = 0
  for (const w of x) if (y.has(w)) inter++
  return inter / (x.size + y.size - inter)
}

interface Agreement { value: unknown; agree: number[]; frequency: number }

/** The value most of the measured videos agree on, with which ones (indexes into `values`). */
export function agreement(kind: Kind, values: readonly unknown[]): Agreement {
  const n = values.length
  const best = (scored: { value: unknown; agree: number[] }[]): Agreement => {
    const top = scored.sort((a, b) => b.agree.length - a.agree.length)[0]!
    return { ...top, frequency: r2(top.agree.length / n) }
  }
  if (kind === 'number') {
    const xs = values as number[]
    const med = r2(quantile(xs, 0.5))
    const agree = xs.map((x, i) => (Math.abs(x - med) <= Math.max(Math.abs(med) * NUMBER_TOLERANCE, 0.05) ? i : -1)).filter((i) => i >= 0)
    return { value: med, agree, frequency: r2(agree.length / n) }
  }
  if (kind === 'exact') return best(values.map((v) => ({ value: v, agree: values.map((w, i) => (isDeepStrictEqual(v, w) ? i : -1)).filter((i) => i >= 0) })))
  if (kind === 'text') return best(values.map((v) => ({ value: v, agree: values.map((w, i) => (jaccard(text(v), text(w)) >= TEXT_AGREEMENT ? i : -1)).filter((i) => i >= 0) })))
  if (kind === 'list') {
    // the items present in at least half the videos; a video agrees when it holds most of them
    const lists = values as string[][]
    const count = new Map<string, number>()
    lists.forEach((l) => new Set(l).forEach((x) => count.set(x, (count.get(x) ?? 0) + 1)))
    const core = [...count].filter(([, c]) => c / n >= 0.5).map(([x]) => x).sort()
    const agree = lists.map((l, i) => (core.length && core.filter((x) => l.includes(x)).length / core.length >= 0.6 ? i : -1)).filter((i) => i >= 0)
    return { value: core, agree, frequency: r2(agree.length / n) }
  }
  if (kind === 'curve') {
    // distributions over time (keys `element|window`): per key the median; a video agrees when, element by element, its mean gap
    // to the median over that element's windows is at most SHARE_MEAN_GAP (one noisy tenth does not make a video disagree, an
    // element whose whole curve is off does)
    const maps = values as Record<string, number>[]
    const keys = [...new Set(maps.flatMap((m) => Object.keys(m)))].sort()
    const med = Object.fromEntries(keys.map((k) => [k, r2(quantile(maps.map((m) => m[k] ?? 0), 0.5))]))
    const groups = [...new Set(keys.map((k) => k.split('|')[0]!))].map((g) => keys.filter((k) => k.split('|')[0] === g))
    const close = (m: Record<string, number>): boolean => groups.every((ks) => ks.reduce((t, k) => t + Math.abs((m[k] ?? 0) - (med[k] ?? 0)), 0) / ks.length <= SHARE_MEAN_GAP)
    const agree = maps.map((m, i) => (keys.length && close(m) ? i : -1)).filter((i) => i >= 0)
    return { value: med, agree, frequency: r2(agree.length / n) }
  }
  // shares: per key the median; a video agrees when its shares sit close to it (mean gap ≤ SHARE_MEAN_GAP over the keys,
  // none off by more than SHARE_MAX_GAP) — numbers per minute (densities) are compared relative to the median instead
  const maps = values as Record<string, number>[]
  const keys = [...new Set(maps.flatMap((m) => Object.keys(m)))].sort()
  const med = Object.fromEntries(keys.map((k) => [k, r2(quantile(maps.map((m) => m[k] ?? 0), 0.5))]))
  const scale = Math.max(1, ...keys.map((k) => med[k] ?? 0))
  const gap = (m: Record<string, number>, k: string): number => Math.abs((m[k] ?? 0) - (med[k] ?? 0)) / scale
  const agree = maps.map((m, i) => (keys.length && keys.reduce((t, k) => t + gap(m, k), 0) / keys.length <= SHARE_MEAN_GAP && keys.every((k) => gap(m, k) <= SHARE_MAX_GAP) ? i : -1)).filter((i) => i >= 0)
  return { value: med, agree, frequency: r2(agree.length / n) }
}

/** A picture origin over this share of the screen time makes the format (3D film, drawn film, interview, screen). */
export const FORMAT_SHARE = 0.4

/**
 * The style (format) of a video: short or long form, and what carries it — a filmed conversation, a 3D film, a drawn film,
 * a screen recording, or else an explainer (presenter, motion design and found media in topic-dependent proportions:
 * those proportions are variations of one style, not styles).
 */
export function styleSignature(a: VideoAnalysis): string {
  const o = a.editing.originShares
  const form = a.coverage.durationS < 180 ? 'short form' : 'long form'
  const format = (o.filmed ?? 0) >= FORMAT_SHARE ? 'filmed conversation or footage' : (o['3d'] ?? 0) >= FORMAT_SHARE ? '3D animation' : (o.drawn ?? 0) >= FORMAT_SHARE ? 'drawn animation' : (o.screen ?? 0) >= FORMAT_SHARE ? 'screen recording' : 'explainer'
  return `${form} ${format}`
}

/** Fields that need what the vision pass saw, or the sound: a video that did not read them does not vote. */
const NEEDS_LOOK = /^(presenter\.|motion\.|sourcing\.|captions\.|editing\.(colour|transitions|cameraMoves))|^packaging\.thumbnailPattern$/
export function readable(a: VideoAnalysis, field: string): boolean {
  const unread = a.coverage.unreadAxes
  if (NEEDS_LOOK.test(field) && (unread.includes('look') || unread.includes('frames'))) return false
  if (field.startsWith('sound.') && unread.includes('sound')) return false
  if (field.startsWith('voice.') && field !== 'voice.kind' && unread.includes('words')) return false
  return true
}

/** Share of the screen time without the presenter. */
const timeOff = (a: VideoAnalysis): number => {
  const tot = a.shots.reduce((t, s) => t + s.lengthS, 0)
  return tot ? a.shots.filter((s) => s.layout === 'off').reduce((t, s) => t + s.lengthS, 0) / tot : 1
}

export function realSynthesis(analyses: readonly VideoAnalysis[], brief: Pick<Brief, 'style'> | null): Body {
  const groups = new Map<string, string[]>()
  // a video whose pictures were not seen has no measured format: it joins the largest style of its form (said in the
  // description), and does not vote on what needs the pictures (readable())
  // a video whose look missed some rows (Yarnhub's WWII film: 60 of 363 shots, their origin from the shot log's kind) still has a
  // measured format: it is grouped by it, never joined by length to another style (it was joined to a trailer and a reaction video)
  const formatSeen = (a: VideoAnalysis): boolean => readable(a, 'sourcing.originShares') || (!a.coverage.unreadAxes.includes('frames') && Object.keys(a.editing.originShares).length > 0)
  const seen = analyses.filter(formatSeen)
  for (const a of seen) groups.set(styleSignature(a), [...(groups.get(styleSignature(a)) ?? []), a.videoId])
  const unseen = analyses.filter((a) => !formatSeen(a))
  for (const a of unseen) {
    const form = a.coverage.durationS < 180 ? 'short form' : 'long form'
    const host = [...groups].filter(([k]) => k.startsWith(form)).sort((x, y) => y[1].length - x[1].length)[0]?.[0] ?? `${form} (pictures not seen)`
    groups.set(host, [...(groups.get(host) ?? []), a.videoId])
  }
  const styles = [...groups].sort((x, y) => y[1].length - x[1].length).map(([signature, videos], i) => {
    const of = analyses.filter((a) => videos.includes(a.videoId))
    const presence = quantile(of.filter((a) => readable(a, 'presenter.kind')).map((a) => 1 - timeOff(a)), 0.5)
    const blind = of.filter((a) => !formatSeen(a)).map((a) => a.videoId)
    return { id: `s${i + 1}`, description: `${signature}, presenter on screen ${Math.round(presence * 100)} % (median)${blind.length ? `; ${blind.join(', ')} joined by form only (pictures not seen)` : ''}`, videos }
  })
  let chosen: string | null = null
  if (styles.length === 1) chosen = styles[0]!.id
  else if (brief?.style && styles.some((s) => s.id === brief.style)) chosen = brief.style
  else if (brief?.style) {
    const best = styles.map((s) => ({ s, j: jaccard(brief.style!, s.description) })).sort((x, y) => y.j - x.j)[0]!
    chosen = best.j > 0 ? best.s.id : null
  }
  else if (styles[0]!.videos.length / analyses.length >= DOMINANT_STYLE) chosen = styles[0]!.id
  // fonts and colours in canonical form, so videos can agree on them (free descriptions and exact codes never did)
  const pool = canonLooks(chosen ? analyses.filter((a) => styles.find((s) => s.id === chosen)!.videos.includes(a.videoId)) : analyses)

  const constants: SynthesisConstant[] = []
  const variations: Body['variations'] = []
  for (const x of EXTRACTORS) {
    const measured = pool.map((a) => ({ a, v: readable(a, x.field) ? x.read(a) : undefined })).filter((m) => m.v !== undefined)
    if (measured.length === 0) continue
    const ag = agreement(x.kind, measured.map((m) => JSON.parse(JSON.stringify(m.v)) as unknown))
    // frequency over the whole pool: a video that could not measure it does not agree
    const frequency = r2(ag.agree.length / pool.length)
    const agreeing = ag.agree.map((i) => measured[i]!.a)
    const shaped = frequency >= CONSTANT_MIN_FREQUENCY && agreeing.length > 0 ? (x.shape ? x.shape(ag.value, agreeing) : ag.value) : undefined
    if (shaped !== undefined && !(Array.isArray(ag.value) && ag.value.length === 0) && !(Array.isArray(shaped) && shaped.length === 0)) {
      constants.push({ field: x.field, value: shaped, frequency, videos: agreeing.map((a) => a.videoId), evidence: agreeing.flatMap((a) => x.evidence(a).slice(0, 2)).slice(0, 8) })
    } else {
      variations.push({
        field: x.field,
        description: `${x.field} varies: ${measured.length} of ${pool.length} videos measured it, ${ag.agree.length} agree`,
        values: measured.map((m) => ({ value: m.v, frequency: r2(1 / pool.length), videos: [m.a.videoId] }))
      })
    }
  }
  return { videoCount: analyses.length, styles, chosenStyle: chosen, constants, variations }
}

/** Definition sections each inspiration axis feeds. */
export const AXIS_SECTIONS: Record<(typeof INSPIRATION_AXES)[number], string[]> = {
  script: ['script'], voice: ['voice'], presenter: ['presenter'], motion: ['motion'], editing: ['editing', 'sourcing'],
  sound: ['sound'], captions: ['captions'], packaging: ['packaging']
}

/**
 * A mix or inspiration brief: each reference is synthesised on its own videos, and each constant is taken from the
 * reference whose `axes` name its section (a reference with no axes gives every section no other reference claims).
 */
export function mixSynthesis(analyses: readonly VideoAnalysis[], brief: Pick<Brief, 'style' | 'references'>): Body {
  const per = brief.references.map((ref, i) => ({ ref, body: realSynthesis(analyses.filter((a) => (a.reference ?? 0) === i), brief) }))
  const claimed = new Set(brief.references.flatMap((r) => r.axes.flatMap((x) => AXIS_SECTIONS[x])))
  const owns = (ref: Brief['references'][number], field: string): boolean => {
    const section = field.split('.')[0]!
    return ref.axes.length ? ref.axes.some((x) => AXIS_SECTIONS[x].includes(section)) : !claimed.has(section)
  }
  const constants = per.flatMap(({ ref, body }) => body.constants.filter((c) => owns(ref, c.field)))
  const variations = per.flatMap(({ ref, body }) => body.variations.filter((v) => v.field === null || owns(ref, v.field)))
  const styles = per.flatMap(({ body }, i) => body.styles.map((s) => ({ ...s, id: `r${i + 1}-${s.id}`, description: `reference ${i + 1}: ${s.description}` })))
  const unresolved = per.some(({ body }) => body.styles.length > 1 && !body.chosenStyle)
  // each reference's own choice is kept; the mix as a whole names the first reference's chosen style
  const firstChosen = per[0]?.body.chosenStyle ? `r1-${per[0].body.chosenStyle}` : null
  return { videoCount: analyses.length, styles, chosenStyle: unresolved ? null : (firstChosen ?? styles[0]!.id), constants, variations }
}

/** The synthesiser service (CloneServices.synthesiser). */
export const realSynthesiser = {
  synthesise: async (analyses: readonly VideoAnalysis[], brief: Brief): Promise<Body> => (brief.references.length > 1 ? mixSynthesis(analyses, brief) : realSynthesis(analyses, brief))
}
