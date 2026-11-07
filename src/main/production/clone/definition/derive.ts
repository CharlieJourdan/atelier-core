// P4's measures (chantier B, spec §2 P4): every Style Definition field the whole-video analyses can measure, with its
// evidence — the v1-level richness (outline, hook window, presenter windows and configurations, motion types and their
// landing on the word, shot curve, hook cadence, footage lengths, stills vs footage, sound changes, SFX, captions…).
// The cross-video synthesis (chantier A) wins wherever it names the same field; these fill everything else. A value is
// written only when the corpus agrees on it (CONSTANT_MIN_FREQUENCY) or, for numbers, as the corpus median. Pure.
import type { AnalysedShot, Evidence, Layout, MediaOrigin, VideoAnalysis, VideoPart } from '../../../../shared/clone'
import { OPENING_S, VIDEO_PARTS } from '../../../../shared/clone'
import { heldDetail, heldNamed } from '../../../../engine/nodes/director-pov'
import type { POV_HELD, PovHeldDetail } from '../../../../engine/formats/pov'
import { distributionEvidence, poolByPart, poolDistributions, withDistributions } from '../analysis/distributions'
import { agreed, corpusEvidence, frequentItems, median, quantile, round2, round3, screenSeconds, shotsIn, tokens, videoMinutes } from './stats'

/** A measured value for a definition field (dotted path of style-definition.ts). */
export interface Derived { field: string; value: unknown; evidence: Evidence[] }

type Shot = AnalysedShot
const FOOTAGE_KINDS: readonly Shot['kind'][] = ['archive-film', 'stock-footage', 'gameplay', 'generated', 'screen-capture', 'other']
const STILL_KINDS: readonly Shot['kind'][] = ['archive-photo', 'document']
const isMotion = (s: Shot): boolean => s.origin === 'motion' || s.origin === 'drawn'
const onScreen = (s: Shot): boolean => s.layout !== 'off'

/** True when the analysis could not measure an axis (its `unmeasured` note). */
const unmeasured = (a: VideoAnalysis, key: string): boolean => (a.unmeasured ?? []).some((u) => u.startsWith(`${key}:`))

/** The evidence of a MeasuredNumber per video (first few). */
const numEvidence = (xs: { evidence: Evidence[] }[]): Evidence[] => xs.flatMap((x) => x.evidence.slice(0, 1)).slice(0, 6)

/** The parts every video of the corpus (most of it) has. */
function commonParts(analyses: readonly VideoAnalysis[]): VideoPart[] {
  return VIDEO_PARTS.filter((p) => analyses.filter((a) => a.parts.some((x) => x.part === p)).length / analyses.length >= 0.6)
}

/** Every field the corpus measures. Fields it cannot measure (or does not agree on) are left out. */
/** The things held up in the first-person shots (their descriptions and on-screen text, the engine's own vocabulary), each with
 *  what is drawn on it and its share of the first-person time, most frequent first (moteur-pov-2). Pure. */
export function heldObjectsOf(analyses: readonly VideoAnalysis[]): { objects: { hold: (typeof POV_HELD)[number]; detail: PovHeldDetail; share: number }[]; evidence: Evidence[] } {
  const time = new Map<string, number>()
  let total = 0
  const seen: { videoId: string; shot: Shot }[] = []
  for (const a of analyses) for (const s of a.shots) {
    if (s.pov !== true) continue
    total += s.lengthS
    const text = `${s.shows} ${s.onScreenText}`
    const hold = heldNamed(text)
    if (!hold) continue
    const detail: PovHeldDetail = hold === 'ticket' ? (/\d|number|numéro/i.test(text) ? 'numbers' : 'plain') : heldDetail(hold, text, [])
    const key = `${hold}|${detail}`
    time.set(key, (time.get(key) ?? 0) + s.lengthS)
    seen.push({ videoId: a.videoId, shot: s })
  }
  const objects = [...time]
    .map(([k, t]) => { const [hold, detail] = k.split('|') as [(typeof POV_HELD)[number], PovHeldDetail]; return { hold, detail, share: round3(t / Math.max(total, 1e-9)) } })
    .filter((o) => o.share >= 0.03)
    .sort((x, y) => y.share - x.share)
    .slice(0, 6)
  const evidence = analyses.flatMap((a) => corpusEvidence([a], (s) => seen.some((x) => x.videoId === a.videoId && x.shot === s), 2)).slice(0, 6)
  return { objects, evidence }
}

/** The narration's address from the words heard on every shot: the most frequent person, when it is clear (≥ 1.5 × the next
 *  one and at least 40 pronouns over the corpus); else nothing is said. Pure. */
export function addressOf(analyses: readonly VideoAnalysis[]): 'you' | 'we' | 'i' | 'neutral' | undefined {
  const text = analyses.flatMap((a) => a.shots.map((s) => s.words)).join(' ').toLowerCase()
  const count = (re: RegExp): number => text.match(re)?.length ?? 0
  const n = {
    you: count(/(?<![\p{L}])(tu|toi|ton|ta|tes|t['’]|vous|votre|vos|you|your|yours)(?![\p{L}])/gu),
    i: count(/(?<![\p{L}])(je|j['’]|moi|mon|ma|mes|i|my|me)(?![\p{L}])/gu),
    we: count(/(?<![\p{L}])(nous|notre|nos|we|our|us)(?![\p{L}])/gu)
  }
  const ranked = (Object.entries(n) as ['you' | 'i' | 'we', number][]).sort((x, y) => y[1] - x[1])
  const [top, next] = [ranked[0]!, ranked[1]!]
  if (top[1] < 40) return undefined
  return top[1] >= next[1] * 1.5 ? top[0] : undefined
}

export function deriveFields(analyses: readonly VideoAnalysis[]): Derived[] {
  if (analyses.length === 0) return []
  const out: Derived[] = []
  const put = (field: string, value: unknown, evidence: Evidence[]): void => { if (value !== undefined && evidence.length) out.push({ field, value, evidence }) }
  const all = (pick: (s: Shot) => boolean = () => true): Evidence[] => corpusEvidence(analyses, pick)
  const constant = <T>(field: string, read: (a: VideoAnalysis) => T, evidence: Evidence[] = all()): void => {
    const c = agreed(analyses.map(read))
    if (c) put(field, c.value, evidence)
  }
  const medianOf = (field: string, read: (a: VideoAnalysis) => number | null, evidence: Evidence[], digits: (n: number) => number = round2): void => {
    const xs = analyses.map(read).filter((x): x is number => x !== null && Number.isFinite(x))
    if (xs.length / analyses.length >= 0.6) put(field, digits(median(xs)), evidence)
  }
  const parts = commonParts(analyses)
  const hookEv = all((s) => s.startS < 15)

  // --- script
  medianOf('script.partCount', (a) => a.script.structure.length, hookEv, Math.round)
  constant('script.outline', (a) => a.script.structure, hookEv)
  const partShare = (a: VideoAnalysis, p: VideoPart): number | null => {
    const span = a.parts.find((x) => x.part === p)
    return span ? (span.toS - span.fromS) / Math.max(a.coverage.durationS, 1) : null
  }
  const hookPattern = agreed(analyses.map((a) => a.script.hookPattern))?.value ?? ''
  if (parts.length) {
    put('script.parts', parts.map((p) => ({ name: p, share: round3(median(analyses.map((a) => partShare(a, p)).filter((x): x is number => x !== null))), intent: p === 'hook' ? hookPattern : '' })),
      analyses.flatMap((a) => a.parts.map((x) => ({ video: a.videoId, fromS: x.fromS, toS: x.toS, frames: [], note: x.part }))).slice(0, 6))
  }
  medianOf('script.hookWindowS', (a) => a.parts.find((x) => x.part === 'hook')?.toS ?? null, hookEv, round2)
  constant('script.hookPattern', (a) => a.script.hookPattern, hookEv)
  constant('script.tone', (a) => a.script.tone)
  constant('script.chapters', (a) => a.script.chapters.length > 0)
  constant('script.cta', (a) => a.script.cta, all((s) => s.startS > 0))
  put('script.devices', frequentItems(analyses.map((a) => a.script.devices)), all())
  medianOf('script.sentenceWordsMean', (a) => a.script.sentenceWordsMean.value, numEvidence(analyses.map((a) => a.script.sentenceWordsMean)))
  const illustrationRead = (a: VideoAnalysis): boolean => !unmeasured(a, 'editing.illustratesShare')
  medianOf('script.illustratedShare', (a) => {
    if (!illustrationRead(a)) return null
    const rated = a.shots.filter((s) => s.illustrates !== null)
    const t = rated.reduce((x, s) => x + s.lengthS, 0)
    return t > 0 ? rated.reduce((x, s) => x + s.lengthS * (s.illustrates === 'yes' ? 1 : s.illustrates === 'partly' ? 0.5 : 0), 0) / t : null
  }, all((s) => s.illustrates !== null), round3)
  // the illustration part by part (the hook may illustrate every sentence, the body less), over the videos that read it
  const illustratedParts = poolByPart(analyses.filter(illustrationRead), (a) => a.editing.illustratesByPart, (r) => r.share, round3)
  if (illustratedParts.length) put('script.illustratesByPart', illustratedParts.map(({ part, value }) => ({ part, share: value })), all((s) => s.illustrates !== null).slice(0, 6))
  medianOf('script.wordsPerMinute', (a) => a.voice.wordsPerMinute.value, numEvidence(analyses.map((a) => a.voice.wordsPerMinute)), Math.round)

  // --- voice
  constant('voice.kind', (a) => a.voice.kind, numEvidence(analyses.map((a) => a.voice.wordsPerMinute)))
  if (agreed(analyses.map((a) => a.voice.kind))?.value !== 'none') {
    const voiceEv = numEvidence(analyses.map((a) => a.voice.wordsPerMinute))
    constant('voice.timbre', (a) => a.voice.timbre, voiceEv)
    constant('voice.energy', (a) => a.voice.energy, voiceEv)
    medianOf('voice.wordsPerMinute', (a) => a.voice.wordsPerMinute.value, voiceEv, Math.round)
    medianOf('voice.pausesPerMinute', (a) => a.voice.pausesPerMinute.value, numEvidence(analyses.map((a) => a.voice.pausesPerMinute)))
    medianOf('voice.meanPauseS', (a) => a.voice.meanPauseS.value, numEvidence(analyses.map((a) => a.voice.meanPauseS)))
    // the pace part by part (a hook often runs faster than the body), over the videos whose words were timed
    const paced = poolByPart(analyses.filter((a) => !unmeasured(a, 'voice.wordsPerMinute')), (a) => a.voice.wpmByPart, (r) => r.wpm, Math.round)
    if (paced.length) put('voice.wpmByPart', paced.map(({ part, value }) => ({ part, wpm: Math.max(1, value) })), voiceEv)
    // The kind of voice to look for: the timbre, and the speaker's gender/age when the presenter is the speaker.
    const id = agreed(analyses.map((a) => (a.presenter.identity ? [a.presenter.identity.gender, a.presenter.identity.age] : null)))?.value
    const timbre = agreed(analyses.map((a) => a.voice.timbre))?.value
    const descriptors = [...(id ?? []), ...(timbre ? [timbre] : [])].filter(Boolean)
    if (descriptors.length) put('voice.descriptors', descriptors, voiceEv)
  }

  // --- presenter
  const pKind = agreed(analyses.map((a) => a.presenter.kind))
  if (pKind) put('presenter.kind', pKind.value, all(onScreen).length ? all(onScreen) : all())
  if (pKind && pKind.value !== 'none') {
    const pEv = all(onScreen)
    const idEv = analyses.flatMap((a) => a.presenter.identity?.evidence ?? []).slice(0, 6)
    // Field by field: real analyses never word a face or a set identically twice; the most frequent wording of each field.
    const ids = analyses.flatMap((a) => (a.presenter.identity ? [a.presenter.identity] : []))
    if (ids.length / analyses.length >= 0.6 && idEv.length) {
      const pick = (k: 'age' | 'gender' | 'face' | 'hair' | 'wardrobe' | 'setting' | 'lighting'): string => {
        const vs = ids.map((x) => x[k]).filter(Boolean)
        return agreed(vs)?.value ?? [...vs].sort((x, y) => vs.filter((v) => v === y).length - vs.filter((v) => v === x).length)[0] ?? ''
      }
      put('presenter.identity', { age: pick('age'), gender: pick('gender'), face: pick('face'), hair: pick('hair'), wardrobe: pick('wardrobe'), setting: pick('setting'), lighting: pick('lighting') }, idEv)
    }
    medianOf('presenter.angleCount', (a) => a.presenter.angles.length, analyses.flatMap((a) => a.presenter.angles.map((x): Evidence => ({ video: a.videoId, frames: x.frames }))).slice(0, 8), Math.round)
    const configs = new Map<string, { id: string; framing: 'close' | 'medium' | 'wide'; layout: Layout; angle: number; description: string }>()
    for (const a of analyses) for (const s of a.shots) {
      if (s.layout === 'off' || s.angle === null) continue
      const angle = a.presenter.angles[s.angle]
      const key = `${s.layout}-${s.angle}`
      if (!configs.has(key)) configs.set(key, { id: key, framing: angle?.framing ?? 'medium', layout: s.layout, angle: s.angle, description: `${s.layout}, ${angle?.description ?? `angle ${s.angle}`}` })
    }
    if (configs.size) put('presenter.configurations', [...configs.values()].sort((x, y) => x.id.localeCompare(y.id)), pEv)
    const layoutParts = VIDEO_PARTS.filter((p) => analyses.some((a) => a.presenter.layoutByPart.some((l) => l.part === p)))
    if (layoutParts.length) {
      put('presenter.layoutCurve', layoutParts.map((part) => {
        const rows = analyses.flatMap((a) => a.presenter.layoutByPart.filter((l) => l.part === part))
        const layouts = [...new Set(rows.flatMap((r) => Object.keys(r.shares)))] as Layout[]
        return { part, shares: Object.fromEntries(layouts.map((l) => [l, round3(median(rows.map((r) => r.shares[l] ?? 0)))])) }
      }), analyses.flatMap((a) => a.presenter.layoutByPart.flatMap((l) => l.evidence)).slice(0, 8))
      put('presenter.presenceByPart', layoutParts.map((part) => ({ part, share: round3(median(analyses.flatMap((a) => a.presenter.presenceByPart.filter((x) => x.part === part).map((x) => x.share.value)))) })),
        analyses.flatMap((a) => a.presenter.presenceByPart.flatMap((x) => x.share.evidence)).slice(0, 8))
    }
    put('presenter.entries', frequentItems(analyses.map((a) => a.presenter.entries.map((e) => e.how))), pEv)
    put('presenter.exits', frequentItems(analyses.map((a) => a.presenter.exits.map((e) => e.how))), pEv)
    medianOf('presenter.talkSecondsPerMinute', (a) => a.shots.filter(onScreen).reduce((t, s) => t + s.lengthS, 0) / videoMinutes(a), pEv, round2)
    medianOf('presenter.windowMeanS', (a) => {
      const runs: number[] = []
      let run = 0
      for (const s of a.shots) { if (onScreen(s)) run += s.lengthS; else if (run > 0) { runs.push(run); run = 0 } }
      if (run > 0) runs.push(run)
      return runs.length ? runs.reduce((x, y) => x + y, 0) / runs.length : null
    }, pEv, round2)
  }

  // --- motion
  const motionEv = all(isMotion)
  if (motionEv.length) {
    const types = frequentItems(analyses.map((a) => a.motion.elements.filter((e) => e.count > 0).map((e) => e.type)))
    const rows = (t: string) => analyses.flatMap((a) => a.motion.elements.filter((e) => e.type === t && e.count > 0).map((e) => ({ a, e })))
    if (types.length) {
      put('motion.elements', types.map((t) => {
        const r = rows(t)
        return {
          type: t,
          durationS: round2(median(r.map((x) => x.e.meanDurationS.value))),
          easing: agreed(r.map((x) => x.e.easing))?.value ?? r[0]!.e.easing,
          perMinute: round2(median(r.map((x) => x.e.count / videoMinutes(x.a)))),
          landingOffsetS: round2(median(r.map((x) => x.e.landingOffsetS.value))),
          texture: agreed(r.map((x) => x.e.texture))?.value ?? r[0]!.e.texture
        }
      }), analyses.flatMap((a) => a.motion.elements.flatMap((e) => e.meanDurationS.evidence.concat(e.landingOffsetS.evidence))).slice(0, 8))
      const offsets = analyses.flatMap((a) => a.motion.elements.filter((e) => e.count > 0).map((e) => e.landingOffsetS.value))
      if (offsets.length) put('editing.illustrationLeadS', round2(median(offsets)), analyses.flatMap((a) => a.motion.elements.flatMap((e) => e.landingOffsetS.evidence)).slice(0, 6))
    }
    put('motion.palette', frequentItems(analyses.map((a) => a.motion.palette.map((c) => c.toUpperCase()))), motionEv)
    put('motion.fonts', frequentItems(analyses.map((a) => a.motion.fonts)), motionEv)
    if (parts.length) {
      put('motion.densityByPart', parts.map((part) => ({ part, perMinute: round2(median(analyses.map((a) => a.motion.elements.reduce((t, e) => t + (e.perMinuteByPart.find((x) => x.part === part)?.perMinute ?? 0), 0)))) })), motionEv)
      put('motion.coverageByPart', parts.map((part) => ({ part, share: round3(median(analyses.map((a) => {
        const shots = shotsIn(a, part)
        const t = shots.reduce((x, s) => x + s.lengthS, 0)
        return t > 0 ? shots.filter(isMotion).reduce((x, s) => x + s.lengthS, 0) / t : 0
      }))) })), motionEv)
    }
    const repeats = analyses.map((a) => {
      const m = a.shots.filter(isMotion)
      let same = 0
      for (let i = 1; i < m.length; i++) if (m[i]!.kind === m[i - 1]!.kind && m[i]!.n === m[i - 1]!.n + 1) same++
      return m.length > 1 ? same / (m.length - 1) : 0
    })
    put('motion.neverSameTypeTwice', median(repeats) < 0.15, motionEv)
  }

  // --- editing
  const durEv = (pick: (a: VideoAnalysis) => { evidence: Evidence[] }) => numEvidence(analyses.map(pick))
  medianOf('editing.meanShotS', (a) => a.editing.meanShotS.value, durEv((a) => a.editing.meanShotS))
  medianOf('editing.medianShotS', (a) => a.editing.medianShotS.value, durEv((a) => a.editing.medianShotS))
  medianOf('editing.p90ShotS', (a) => a.editing.p90ShotS.value, durEv((a) => a.editing.p90ShotS))
  medianOf('editing.hookMeanShotS', (a) => { const h = shotsIn(a, 'hook'); return h.length ? h.reduce((t, s) => t + s.lengthS, 0) / h.length : null }, hookEv)
  // the cadence part by part, every shot counted by the share of it inside the part
  const shotParts = poolByPart(analyses, (a) => a.editing.shotByPart, (r) => r.meanShotS)
  if (shotParts.length) put('editing.shotByPart', shotParts.map(({ part, value }) => ({ part, meanShotS: Math.max(0.01, value) })), all())
  const BUCKETS = 5
  const curve = Array.from({ length: BUCKETS }, (_, i) => {
    const from = i / BUCKETS, to = (i + 1) / BUCKETS
    const means = analyses.map((a) => {
      const d = Math.max(a.coverage.durationS, 1)
      const xs = a.shots.filter((s) => s.startS / d >= from && s.startS / d < to).map((s) => s.lengthS)
      return xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null
    }).filter((x): x is number => x !== null)
    return { fromShare: from, toShare: to, meanShotS: round2(median(means)) }
  }).filter((b) => b.meanShotS > 0)
  if (curve.length) put('editing.shotCurve', curve, all())
  const cuts = new Map<string, number>()
  // a cut's kind the analysis did not see (scene detection only counts cuts: `editing.cutTypes` unmeasured) is no measure
  for (const a of analyses.filter((x) => !unmeasured(x, 'editing.cutTypes'))) for (const [k, n] of Object.entries(a.editing.cutTypes)) cuts.set(k, (cuts.get(k) ?? 0) + (n ?? 0))
  const cutTotal = [...cuts.values()].reduce((x, y) => x + y, 0)
  if (cutTotal > 0) put('editing.cutTypes', Object.fromEntries([...cuts].map(([k, n]) => [k, round3(n / cutTotal)])), all())
  put('editing.transitions', frequentItems(analyses.map((a) => a.editing.transitions)), all())
  medianOf('editing.holdMaxS', (a) => { const xs = a.shots.filter((s) => !onScreen(s) || s.origin !== 'presenter').map((s) => s.lengthS); return xs.length ? quantile(xs, 0.95) : null }, all((s) => s.lengthS > 5).length ? all((s) => s.lengthS > 5) : all())
  const camera = new Map<string, number>()
  for (const a of analyses) for (const s of a.shots) camera.set(s.camera, (camera.get(s.camera) ?? 0) + s.lengthS)
  const total = screenSeconds(analyses)
  put('editing.cameraMoves', [...camera].filter(([, t]) => t / total >= 0.1).map(([k]) => k).sort(), all())
  constant('editing.colour', (a) => a.editing.colour)

  // --- sourcing
  const origins = new Map<MediaOrigin, number>()
  const kinds = new Map<string, number>()
  for (const a of analyses) for (const s of a.shots) { origins.set(s.origin, (origins.get(s.origin) ?? 0) + s.lengthS); kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + s.lengthS) }
  put('sourcing.originShares', Object.fromEntries([...origins].map(([k, t]) => [k, round3(t / total)])), all())
  put('sourcing.kindShares', Object.fromEntries([...kinds].map(([k, t]) => [k, round3(t / total)])), all())
  const found = analyses.flatMap((a) => a.shots.filter((s) => s.origin === 'found'))
  const foundT = found.reduce((t, s) => t + s.lengthS, 0)
  if (foundT > 0) put('sourcing.foundStillsShare', round3(found.filter((s) => STILL_KINDS.includes(s.kind)).reduce((t, s) => t + s.lengthS, 0) / foundT), all((s) => s.origin === 'found'))
  const footage = analyses.flatMap((a) => a.shots.filter((s) => FOOTAGE_KINDS.includes(s.kind) && s.origin !== 'presenter').map((s) => s.lengthS))
  if (footage.length >= 5) {
    const fEv = all((s) => FOOTAGE_KINDS.includes(s.kind))
    put('sourcing.footageMinS', round2(quantile(footage, 0.1)), fEv)
    put('sourcing.footageMaxS', round2(quantile(footage, 0.9)), fEv)
  }
  // how every screen element is distributed along the video (the corpus median per part and per tenth)
  const distributions = poolDistributions(analyses)
  if (distributions.length && withDistributions(analyses).length / analyses.length >= 0.6) put('sourcing.distributions', distributions, distributionEvidence(analyses))
  const top = [...kinds].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, t]) => `${k} ${Math.round((t / total) * 100)} %`)
  if (top.length) put('sourcing.illustrationStyle', top.join(', '), all())
  constant('sourcing.grade', (a) => a.editing.colour)

  // --- framing and the pictures' depth (moteur-briques): the letterbox, first-person hand shots, depth of field
  const framed = analyses.filter((a) => a.framing !== undefined)
  if (framed.length > 0 && framed.length / analyses.length >= 0.6) {
    const boxed = framed.flatMap((a) => (a.framing?.letterbox ? [a.framing.letterbox] : []))
    const value = boxed.length / framed.length >= 0.5 ? { aspect: round2(median(boxed.map((b) => b.aspect))), barShare: round3(median(boxed.map((b) => b.barShare))) } : null
    put('editing.letterbox', value, all())
  }
  // the frame format (moteur-pov-2): vertical when most measured videos are taller than wide
  const sized = analyses.filter((a) => a.frame !== undefined)
  if (sized.length > 0 && sized.length / analyses.length >= 0.6) {
    const tall = sized.filter((a) => a.frame!.height > a.frame!.width).length
    put('editing.aspect', tall / sized.length > 0.5 ? '9:16' : '16:9', corpusEvidence(sized).map((e) => {
      const f = sized.find((a) => a.videoId === e.video)?.frame
      return f ? { ...e, note: `${f.width}×${f.height} (${f.from === 'file' ? 'measured on the file' : 'a Shorts link'})` } : e
    }))
  }
  const povRead = analyses.filter((a) => a.shots.some((s) => s.pov !== undefined))
  if (povRead.length > 0 && povRead.length / analyses.length >= 0.6) {
    const t = povRead.reduce((n, a) => n + a.shots.reduce((m, s) => m + s.lengthS, 0), 0)
    const pov = povRead.reduce((n, a) => n + a.shots.filter((s) => s.pov === true).reduce((m, s) => m + s.lengthS, 0), 0)
    const ev = corpusEvidence(povRead, (s) => s.pov === true)
    if (t > 0) put('sourcing.povShare', round3(pov / t), ev.length ? ev : corpusEvidence(povRead))
    // moteur-pov-2: the opening apart (the reference handles its objects most there), and the things held up with what is on them
    const opening = (s: Shot): boolean => s.startS < OPENING_S
    const ot = povRead.reduce((n, a) => n + a.shots.filter(opening).reduce((m, s) => m + Math.min(s.lengthS, OPENING_S - s.startS), 0), 0)
    const op = povRead.reduce((n, a) => n + a.shots.filter((s) => opening(s) && s.pov === true).reduce((m, s) => m + Math.min(s.lengthS, OPENING_S - s.startS), 0), 0)
    if (ot > 0) put('sourcing.povOpeningShare', round3(op / ot), corpusEvidence(povRead, (s) => opening(s) && s.pov === true).concat(ev.length ? [] : corpusEvidence(povRead)).slice(0, 6))
    const held = heldObjectsOf(povRead)
    if (pov > 0) put('sourcing.heldObjects', held.objects, held.evidence.length ? held.evidence : corpusEvidence(povRead, (s) => s.pov === true))
  }
  // how the narration addresses the viewer (moteur-pov-2), counted on the words heard: tu / vous / je / nous (en: you / I / we)
  const address = addressOf(analyses)
  if (address) put('script.addressMode', address, all((s) => /\b(tu|toi|vous|you)\b/i.test(s.words)).concat(all()).slice(0, 6))
  // the cast's drawing (moteur-pov-2): each key's most frequent value over the videos that draw characters
  const drew = analyses.filter((a) => a.figures !== undefined)
  if (drew.length > 0 && drew.length / analyses.length >= 0.6) {
    const drawn = drew.flatMap((a) => (a.figures ? [a.figures] : []))
    const mode = <T>(xs: readonly T[]): T => [...xs].sort((x, y) => xs.filter((v) => v === y).length - xs.filter((v) => v === x).length)[0]!
    const value = drawn.length / drew.length >= 0.5
      ? { body: mode(drawn.map((f) => f.body)), rim: mode(drawn.map((f) => f.rim)), faces: mode(drawn.map((f) => f.faces)), colour: mode(drawn.map((f) => f.colour)) }
      : null
    put('sourcing.figures', value, corpusEvidence(drew, (s) => s.origin === 'drawn').concat(corpusEvidence(drew)).slice(0, 6))
  }
  // the generated pictures' look: the line of the video that generates the most (the corpus's clearest view of it)
  const genT = (a: VideoAnalysis): number => a.shots.filter((s) => s.origin === 'generated').reduce((n, s) => n + s.lengthS, 0)
  const genBest = analyses.filter((a) => a.generatedLook?.trim() && genT(a) > 0).sort((x, y) => genT(y) - genT(x))[0]
  if (genBest?.generatedLook) put('sourcing.generatedLook', genBest.generatedLook.trim().slice(0, 600), corpusEvidence([genBest], (s) => s.origin === 'generated'))
  const pictures = analyses.flatMap((a) => a.shots).filter((s) => s.depth !== undefined && s.depth !== null && s.origin !== 'presenter' && s.origin !== 'motion' && s.origin !== 'screen')
  const pictureT = pictures.reduce((n, s) => n + s.lengthS, 0)
  if (pictureT > 0) {
    const ev = corpusEvidence(analyses, (s) => s.depth === 'deep')
    put('sourcing.depthShare', round3(pictures.filter((s) => s.depth === 'deep').reduce((n, s) => n + s.lengthS, 0) / pictureT), ev.length ? ev : all())
  }

  // --- sound
  constant('sound.music', (a) => a.sound.music.present, numEvidence(analyses.map((a) => a.sound.loudnessLufs)))
  const withMusic = analyses.filter((a) => a.sound.music.present)
  if (withMusic.length / analyses.length >= 0.6) {
    const mEv = numEvidence(analyses.map((a) => a.sound.loudnessLufs))
    constant('sound.musicGenre', (a) => a.sound.music.genre, mEv)
    const levels = withMusic.flatMap((a) => (a.sound.music.levelUnderVoiceDb ? [a.sound.music.levelUnderVoiceDb] : []))
    if (levels.length) put('sound.musicLevelUnderVoiceDb', Math.max(-60, round2(median(levels.map((l) => l.value)))), numEvidence(levels))
    constant('sound.musicChanges', (a) => {
      const ch = a.sound.music.changesAtS
      if (ch.length === 0) return 'none'
      const bounds = a.parts.flatMap((p) => [p.fromS, p.toS])
      return ch.every((t) => bounds.some((b) => Math.abs(b - t) <= 3)) ? 'per-part' : 'per-scene'
    }, mEv)
  }
  const sfxKinds = frequentItems(analyses.map((a) => a.sound.sfx.filter((x) => x.count > 0).map((x) => `${x.kind}|${x.on}`)))
  put('sound.sfx', sfxKinds.map((k) => {
    const [kind, on] = k.split('|') as [string, string]
    return { kind, on, perMinute: round2(median(analyses.map((a) => (a.sound.sfx.find((x) => x.kind === kind && x.on === on)?.count ?? 0) / videoMinutes(a)))) }
  }), numEvidence(analyses.map((a) => a.sound.loudnessLufs)))
  medianOf('sound.loudnessLufs', (a) => (a.coverage.unreadAxes.includes('sound') ? null : Math.max(-40, a.sound.loudnessLufs.value)), numEvidence(analyses.map((a) => a.sound.loudnessLufs)))

  // --- captions: burnt-in captions are on-screen text that repeats the words said, shot after shot.
  const readable = analyses.filter((a) => !a.coverage.unreadAxes.includes('captions') && !a.coverage.unreadAxes.includes('text'))
  if (readable.length / analyses.length >= 0.6) {
    const isCaption = (s: Shot): boolean => {
      const said = new Set(tokens(s.words))
      const shown = tokens(s.onScreenText)
      return shown.length > 0 && said.size > 0 && shown.filter((w) => said.has(w)).length / shown.length >= 0.5
    }
    const share = median(readable.map((a) => { const t = a.shots.reduce((x, s) => x + s.lengthS, 0); return t > 0 ? a.shots.filter(isCaption).reduce((x, s) => x + s.lengthS, 0) / t : 0 }))
    const cEv = corpusEvidence(readable, isCaption).length ? corpusEvidence(readable, isCaption) : corpusEvidence(readable)
    if (share >= 0.6) {
      put('captions.burnIn', true, cEv)
      put('captions.maxWordsPerCue', Math.max(1, Math.round(quantile(readable.flatMap((a) => a.shots.filter(isCaption).map((s) => tokens(s.onScreenText).length)), 0.9))), cEv)
    } else if (share <= 0.1) put('captions.burnIn', false, cEv)
  }

  // --- packaging
  constant('packaging.titlePattern', (a) => a.packaging.titlePattern, all())
  constant('packaging.thumbnailPattern', (a) => a.packaging.thumbnail.pattern, analyses.flatMap((a): Evidence[] => (a.packaging.thumbnail.path ? [{ video: a.videoId, frames: [a.packaging.thumbnail.path] }] : [])).concat(all()).slice(0, 6))
  return out
}
