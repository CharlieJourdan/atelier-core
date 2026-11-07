// P2 assembly (chantier moteur-analyse): one whole-video log (eyes 0085) + the measures (word timings, loudness, pitch)
// + the looks (vision) + the script reading → the contract's VideoAnalysis. Times and numbers come from the measures;
// the looks only name what is on screen. Every number carries its evidence (frames + times); what could not be read is
// said in `coverage`, what could not be measured in `unmeasured`. Pure.
import type { AnalysedShot, CorpusVideo, Evidence, Layout, MediaOrigin, VideoAnalysis, VideoPart } from '../../../../shared/clone'
import type { LogShot, WholeVideoLog } from '../../../../shared/shot-log'
import type { LoudnessLog, MusicLevel } from './audio'
import { timbreFromPitch } from './audio'
import { shotFrameTime } from './frames'
import type { GlobalLook, ScriptRead, ShotLook } from './look'
import type { FrameMeasure } from './frame'
import type { LetterboxMeasure } from './letterbox'
import type { ShotForensics } from '../../../../engine/watch/forensics'
import { forensicsByShot, guardedOrigin } from './forensic-guard'
import { captionShare, cutSnapShare, denseTimes, landingOffsets, mean, originShares, partAt, sentenceWordsMean, shotStats, speechStats, timeShares, type Word } from './measures'
import { distributionsOf, illustratesByPartOf, illustrationRead, shotByPartOf, wpmByPartOf } from './distributions'

export interface AssembleInput {
  cloneId: string
  createdAt: string
  video: CorpusVideo
  log: WholeVideoLog
  /** Whisper word timings; null when no recogniser could run (said in coverage). */
  words: Word[] | null
  loudness: LoudnessLog | null
  music: MusicLevel | null
  pitchHz: number | null
  looks: Map<number, ShotLook>
  global: GlobalLook | null
  script: ScriptRead | null
  /** Evidence frame (path relative to the clone folder) per time, for every shot frame and dense time. */
  frames: Map<number, string>
  thumbnail: string | null
  /** Dollars really billed (a subscription run bills nothing). */
  costUsd: number
  /** The file could not be downloaded (why): shots show the thumbnail only; frames, sound, timings are not read. */
  noFile?: string
  /** The black bars measured on the 0.5 s frames (analysis/letterbox.ts); undefined when not measured. */
  letterbox?: LetterboxMeasure | null
  /** The video's display frame (analysis/frame.ts); undefined when not measured. */
  frame?: FrameMeasure | null
  /** The shots' palettes and stillness (src/engine/watch/forensics.ts); undefined when not measured (older prepared file). */
  forensics?: ShotForensics[]
}

/** Picture origin from the shot kind, used only when the look has no row for a shot (counted and said). */
const ORIGIN_OF_KIND: Record<LogShot['kind'], MediaOrigin> = {
  'archive-film': 'found', 'archive-photo': 'found', document: 'found', map: 'motion', chart: 'motion', 'motion-graphic': 'motion',
  'title-card': 'motion', illustration: 'drawn', 'stock-footage': 'found', 'screen-capture': 'screen', presenter: 'presenter',
  gameplay: 'screen', generated: 'generated', other: 'found'
}
/** Shot kinds that are made pictures, never a person filmed or generated talking to the viewer. */
const DRAWN_KINDS = new Set<LogShot['kind']>(['illustration', 'map', 'chart', 'motion-graphic', 'title-card'])
const STILL_KINDS = new Set<LogShot['kind']>(['archive-photo', 'document', 'title-card', 'illustration'])

const r2 = (n: number): number => Math.round(n * 100) / 100

export function assembleAnalysis(i: AssembleInput): VideoAnalysis {
  const { log, video } = i
  const durationS = log.coverage.durationS
  const unmeasured: string[] = []
  const unread: string[] = []
  const notes: string[] = []

  // ── shots with their look
  let lookless = 0
  let redrawn = 0
  let presenterBack = 0
  let flat = 0
  const fx = forensicsByShot(i.forensics)
  const shotTime = (s: LogShot): number => shotFrameTime({ startS: s.startS, lengthS: Math.max(0.01, s.lengthS) })
  const frameOf = (s: LogShot): string => i.frames.get(shotTime(s)) ?? i.thumbnail!
  if (i.noFile) { unread.push('frames'); notes.push(`no file to measure (${i.noFile}): every shot shows the thumbnail, frames and sound were not read`) }
  // a drawn face is not a presenter: when the shot log saw a drawing, a card, a map or a chart and the look calls it a
  // person talking, the drawing wins (Le Monde en POV: drawn worried faces read as an « avatar » by the look); and when most
  // of the look's « presenter » shots are drawings, that character is a drawing everywhere (one of them logged as a screen)
  const lookPresenter = log.shots.filter((s) => s.lengthS > 0 && i.looks.get(s.n)?.origin === 'presenter')
  const drawnCharacter = lookPresenter.length > 0 && lookPresenter.filter((s) => DRAWN_KINDS.has(s.kind)).length / lookPresenter.length >= 0.5
  const base = log.shots.filter((s) => s.lengthS > 0).map((s) => {
    const raw = i.looks.get(s.n)
    if (!raw) lookless++
    const drawnPerson = raw?.origin === 'presenter' && ORIGIN_OF_KIND[s.kind] !== 'presenter' && (drawnCharacter || DRAWN_KINDS.has(s.kind))
    if (drawnPerson) redrawn++
    // the shot log saw the presenter and the look called it « filmed, off »: it is the presenter on another of his angles or
    // moving on his set (Finary: 2 092 s of his shots read « filmed », his presence measured at 40 % instead of ~55 %)
    const otherAngle = !drawnCharacter && s.kind === 'presenter' && raw?.layout === 'off' && raw.origin === 'filmed'
    if (otherAngle) presenterBack++
    const look = drawnPerson ? { ...raw!, layout: 'off' as Layout, origin: ORIGIN_OF_KIND[s.kind] } : otherAngle ? { ...raw!, layout: 'full' as Layout, origin: 'presenter' as MediaOrigin } : raw
    const seen = look ?? { layout: (s.kind === 'presenter' ? 'full' : 'off') as Layout, framing: null, view: null, origin: ORIGIN_OF_KIND[s.kind], motion: null }
    // a flat-colour picture was not made by an image model: the measured palette overrules « generated » (decision 0110)
    const origin = guardedOrigin(seen.origin, s.kind, fx.get(s.n))
    if (origin !== seen.origin) flat++
    return { s, look: origin === seen.origin ? seen : { ...seen, origin } }
  })
  if (presenterBack) notes.push(`${presenterBack} shot(s) the shot log saw as the presenter and the look called « filmed »: counted as the presenter on screen`)
  if (flat) notes.push(`${flat} shot(s) read « generated » are flat-colour pictures (measured palette): counted as drawn or motion design`)
  if (redrawn) notes.push(`${redrawn} shot(s) the look called a presenter are drawings, cards or charts in the shot log: counted as such, no presenter`)
  // what the shot log itself could not read (labels of shots whose vision batch failed, hook notes…) is said
  if ((log.coverage.missing ?? []).length) notes.push(`the shot log misses: ${log.coverage.missing.join(', ')}`)
  if (lookless > base.length * 0.1) unread.push('look')
  if (lookless) notes.push(`${lookless} of ${base.length} shots have no look row: their layout and origin come from the shot kind`)

  // ── presenter angles: distinct (framing, view) seen on ≥ 2 shots (a single odd frame is not an angle)
  // the angles are his set-ups as presenter (talking to the viewer: origin `presenter`); acted scenes where he also
  // appears count in his presence, not as angles. An angle needs ≥ 2 shots and ≥ 3 % of those shots.
  const onScreen = base.filter((b) => b.look.layout !== 'off')
  const talking = onScreen.filter((b) => b.look.origin === 'presenter')
  const setUps = talking.length >= 2 ? talking : onScreen
  const keyOf = (b: (typeof base)[number]): string => `${b.look.framing ?? 'medium'}/${b.look.view ?? 'front'}`
  const byKey = new Map<string, (typeof base)[number][]>()
  for (const b of setUps) byKey.set(keyOf(b), [...(byKey.get(keyOf(b)) ?? []), b])
  const angleKeys = [...byKey.entries()].filter(([, v]) => v.length >= 2 && v.length >= setUps.length * 0.03).sort((a, b) => b[1].length - a[1].length).map(([k]) => k)
  const angleOf = (b: (typeof base)[number]): number | null => {
    if (b.look.layout === 'off') return null
    const k = angleKeys.indexOf(keyOf(b))
    if (k >= 0) return k
    const same = angleKeys.findIndex((x) => x.startsWith(`${b.look.framing ?? 'medium'}/`))
    return same >= 0 ? same : angleKeys.length ? 0 : null
  }

  const shots: AnalysedShot[] = base.map((b, k) => ({
    n: k + 1, startS: b.s.startS, lengthS: b.s.lengthS, kind: b.s.kind, shows: b.s.shows, onScreenText: b.s.onScreenText, words: b.s.words,
    illustrates: b.s.illustrates, camera: b.s.camera, origin: b.look.origin, layout: b.look.layout, angle: angleOf(b), frames: [frameOf(b.s)],
    ...(b.look.pov !== undefined && b.look.pov !== null ? { pov: b.look.pov } : {}),
    ...(b.look.depth !== undefined ? { depth: b.look.depth ?? null } : {})
  }))
  const ev = (s: AnalysedShot): Evidence => ({ video: video.id, atS: s.startS, frames: s.frames })
  const shotAt = (t: number): AnalysedShot => shots.find((s) => t >= s.startS && t < s.startS + s.lengthS) ?? shots[shots.length - 1]!
  const evAt = (t: number, note?: string): Evidence => ({ ...ev(shotAt(t)), atS: r2(t), ...(note ? { note } : {}) })
  const spread = (list: readonly AnalysedShot[], max = 4): Evidence[] => {
    if (list.length === 0) return []
    const step = Math.max(1, Math.floor(list.length / max))
    return list.filter((_, j) => j % step === 0).slice(0, max).map(ev)
  }

  // ── parts
  const sr = i.script
  if (!sr) unread.push('script')
  const hookEnd = Math.min(durationS, Math.max(1, sr?.hookEndS ?? log.hook.endS))
  const cuts: { at: number; part: VideoPart }[] = [{ at: 0, part: 'hook' }, { at: hookEnd, part: 'body' }]
  for (const p of sr?.promo ?? []) if (p.toS > p.fromS && p.fromS >= hookEnd && p.toS <= durationS) cuts.push({ at: p.fromS, part: 'promo' }, { at: p.toS, part: 'body' })
  if (sr?.endFromS && sr.endFromS > hookEnd && sr.endFromS < durationS) cuts.push({ at: sr.endFromS, part: 'end' })
  cuts.sort((a, b) => a.at - b.at)
  const parts: VideoAnalysis['parts'] = []
  cuts.forEach((c, j) => {
    const to = c.part === 'end' ? durationS : j + 1 < cuts.length ? cuts[j + 1]!.at : durationS
    if (c.part !== 'end' && cuts.slice(0, j).some((x) => x.part === 'end')) return
    if (to - c.at <= 0.5) return
    parts.push({ part: c.part, fromS: r2(c.at), toS: r2(to) })
  })
  const partNames = [...new Set(parts.map((p) => p.part))]

  // ── dense frames
  const changes = parts.slice(1).map((p) => p.fromS)
  const denseFrames = denseTimes(hookEnd, changes, durationS).map((t) => ({ atS: t, path: i.frames.get(t)! })).filter((d) => d.path)

  // ── presenter
  const per = (part: VideoPart): { shares: Partial<Record<Layout, number>>; presence: number; evidence: Evidence[] } => {
    const spans = parts.filter((p) => p.part === part)
    const inPart = shots.filter((s) => spans.some((p) => s.startS >= p.fromS && s.startS < p.toS))
    const shares = timeShares(inPart as (AnalysedShot & Record<string, unknown>)[], (s) => (s as AnalysedShot).layout, 0, Infinity)
    const evidence = spread(inPart.filter((s) => s.layout !== 'off')).concat(spread(inPart, 2))
    return { shares, presence: r2(1 - (shares.off ?? 0)), evidence: evidence.length ? evidence : [evAt(spans[0]!.fromS)] }
  }
  const presenceAll = r2(1 - (timeShares(shots as (AnalysedShot & Record<string, unknown>)[], (s) => (s as AnalysedShot).layout).off ?? 0))
  // a presenter is someone talking to the viewer (origin `presenter`): people drawn or filmed in the pictures are not one,
  // so without the look's word on it a video with no talking shot has no presenter (Le Monde en POV: drawn characters)
  // a drawn character of the story is not a presenter (moteur-pov-2): only when the second look said the face is drawn (a channel
  // with drawn figures in its cards and a real presenter the looks missed, like Finary v3, keeps its presenter)
  const drawnTalker = i.global?.drawnPresenter === true
  if (drawnTalker && shots.some((s) => s.origin === 'presenter' || s.layout !== 'off')) {
    for (const s of shots) if (s.origin === 'presenter' || s.layout !== 'off') Object.assign(s, { origin: 'drawn', layout: 'off', framing: null, view: null })
    unmeasured.push('presenter: the faces on screen are a drawn character of the story, not a presenter (no presenter)')
  }
  const talks = !drawnTalker && shots.some((s) => s.origin === 'presenter')
  const presenterKind: VideoAnalysis['presenter']['kind'] = drawnTalker || presenceAll < 0.01 || (!i.global?.presenterKind && !talks) ? 'none' : (i.global?.presenterKind ?? 'real')
  if (presenterKind !== 'none' && !i.global?.presenterKind) unmeasured.push('presenter.kind: the look did not say real or avatar; « real » assumed from a person talking on screen')
  const presenterShots = shots.filter((s) => s.layout !== 'off')
  const identity = presenterKind === 'none' ? null : i.global?.identity
    ? (() => {
        const { shots: idShots, ...d } = i.global!.identity!
        const evidence = idShots.map((n) => shots.find((s) => s.n === n)).filter((s): s is AnalysedShot => !!s).map(ev)
        return { ...d, evidence: evidence.length ? evidence : spread(presenterShots, 3) }
      })()
    : null
  if (presenterKind !== 'none' && !identity) unread.push('presenter.identity')
  const angles = angleKeys.map((k, a) => {
    const of = shots.filter((s) => s.angle === a && s.origin === 'presenter')
    const all = shots.filter((s) => s.angle === a)
    const [framing, view] = k.split('/') as [AnalysedShot['layout'], string]
    return { id: `a${a}`, framing: (['close', 'medium', 'wide'].includes(framing) ? framing : 'medium') as 'close' | 'medium' | 'wide', description: `${framing}, facing ${view}, ${byKey.get(k)!.length} set-up shots`, frames: (of.length ? of : all).slice(0, 3).map((s) => s.frames[0]!) }
  }).filter((a) => a.frames.length > 0)
  const entries: { atS: number; how: string }[] = []
  const exits: { atS: number; how: string }[] = []
  shots.forEach((s, k) => {
    const prev = shots[k - 1]
    if (s.layout !== 'off' && (!prev || prev.layout === 'off')) entries.push({ atS: s.startS, how: `${prev ? 'cut' : 'opens'} to ${s.layout} (${partAt(parts, s.startS)})` })
    if (s.layout === 'off' && prev && prev.layout !== 'off') exits.push({ atS: s.startS, how: `cut from ${prev.layout} to ${s.origin} (${partAt(parts, s.startS)})` })
  })

  // ── voice
  const sp = i.words ? speechStats(i.words) : null
  if (!i.words) unread.push('words')
  const speechEv = (note: string): Evidence[] => [evAt(i.words?.[0]?.start ?? 0, note), evAt((i.words?.[Math.floor((i.words?.length ?? 1) / 2)]?.start) ?? durationS / 2, note)]
  const numberOr0 = (v: number | null | undefined, name: string, why: string): number => { if (v === null || v === undefined || !Number.isFinite(v)) { unmeasured.push(`${name}: ${why}`); return 0 } return v }
  // whisper large-v3 heard nothing (a long file under load, the Reddit proof 2026-11-06) while the shot log carries the words
  // under each shot: the pace is counted from them (words over the spoken shots' time), said in the evidence; pauses stay
  // unmeasured (a shot's words carry no gaps)
  const fromShots = ((): { wpm: number; words: number; seconds: number } | null => {
    if (sp?.wordsPerMinute || !i.words || i.words.length > 0) return null
    const spoken = i.log.shots.filter((s) => s.words.trim().length > 0)
    const words = spoken.reduce((t, s) => t + s.words.trim().split(/\s+/).length, 0)
    const seconds = spoken.reduce((t, s) => t + s.lengthS, 0)
    return words >= 20 && seconds > 0 ? { wpm: Math.round((words / seconds) * 60), words, seconds: Math.round(seconds) } : null
  })()
  const wpm = fromShots ? fromShots.wpm : numberOr0(sp?.wordsPerMinute, 'voice.wordsPerMinute', 'no word timings')
  const voice: VideoAnalysis['voice'] = {
    kind: sr?.voiceKind ?? (sp ? 'real' : 'none'),
    timbre: timbreFromPitch(i.pitchHz),
    wordsPerMinute: { value: wpm, evidence: fromShots ? [evAt(0, `${fromShots.words} words of the shot log over ${fromShots.seconds} s of spoken shots (whisper large-v3 heard nothing)`)] : speechEv(`${sp?.words ?? 0} whisper words over ${sp?.speakingS ?? 0} s of speech`) },
    pausesPerMinute: { value: numberOr0(sp?.pausesPerMinute, 'voice.pausesPerMinute', 'no word timings'), evidence: speechEv('gaps ≥ 0.3 s between words') },
    meanPauseS: { value: numberOr0(sp?.meanPauseS, 'voice.meanPauseS', 'no word timings'), evidence: sp?.longestPause ? [evAt(sp.longestPause.atS, `longest pause ${sp.longestPause.lengthS} s`)] : speechEv('no pause') },
    energy: !sp ? 'medium' : sp.wordsPerMinute >= 170 && sp.pausesPerMinute < 20 ? 'high' : sp.wordsPerMinute < 130 ? 'low' : 'medium',
    ...(sp && i.words ? { wpmByPart: wpmByPartOf(i.words, parts) } : {})
  }
  if (i.pitchHz === null) unmeasured.push('voice.timbre: too few voiced windows for the pitch')
  if (!sp) unmeasured.push('voice.energy: no word timings')
  if (!sr) unmeasured.push(`voice.kind: no script reading; « ${voice.kind} » only from whether words were heard`)
  if (sr) unmeasured.push(`voice.kind: judged by the reading model from the transcript and the presenter's lips (« ${sr.voiceClue.slice(0, 80)} »), not heard`)

  // ── motion
  const motionShots = shots.map((s, k) => ({ s, type: base[k]!.look.motion })).filter((x) => x.type !== null)
  const offsets = landingOffsets(shots, i.words ?? [])
  const types = [...new Set(motionShots.map((x) => x.type!))]
  const partMinutes = (part: VideoPart): number => parts.filter((p) => p.part === part).reduce((t, p) => t + (p.toS - p.fromS), 0) / 60
  const elements: VideoAnalysis['motion']['elements'] = types.map((type) => {
    const of = motionShots.filter((x) => x.type === type).map((x) => x.s)
    const offs = offsets.filter((o) => of.some((s) => s.n === o.n))
    const allOffs = offsets.filter((o) => motionShots.some((x) => x.s.n === o.n))
    const use = offs.length ? offs : allOffs
    if (!offs.length) unmeasured.push(`motion.${type}.landingOffsetS: ${use.length ? 'no word of its own matched; the mean of all motion shots is used' : 'no on-screen word is spoken within 4 s (0 is not a measure)'}`)
    return {
      type, count: of.length,
      meanDurationS: { value: r2(mean(of.map((s) => s.lengthS))), evidence: spread(of, 3) },
      easing: i.global?.easing ?? '', palette: i.global?.palette ?? [], fonts: i.global?.fonts ?? [], texture: i.global?.texture ?? '',
      landingOffsetS: { value: use.length ? r2(mean(use.map((o) => o.offsetS))) : 0, evidence: use.length ? use.slice(0, 4).map((o) => ev(shots[o.n - 1]!)) : spread(of, 1).map((e) => ({ ...e, note: 'no spoken match' })) },
      perMinuteByPart: partNames.map((part) => {
        const spans = parts.filter((p) => p.part === part)
        const n = of.filter((s) => spans.some((p) => s.startS >= p.fromS && s.startS < p.toS)).length
        return { part, perMinute: r2(n / Math.max(partMinutes(part), 1 / 60)) }
      })
    }
  })
  if (!i.global) unread.push('look.global')

  // ── editing
  const st = shotStats(shots, durationS)
  const longest = shots[st.longest.n - 1]!
  const snap = i.words ? cutSnapShare(shots, i.words) : null
  if (snap === null) unmeasured.push('editing.cutOnPhraseShare: no word timings')
  const spoken = shots.filter(illustrationRead)
  // the illustration is read by the shot labeller; a reader that cannot say it (Gemini's shot log: `illustrates` missing) or a log
  // whose spoken shots mostly have no reading leaves it unmeasured, never « 0 % illustrated »
  const speaking = shots.filter((s) => s.words.trim().split(/\s+/).filter(Boolean).length >= 2)
  const illustrationUnread = (log.coverage.missing ?? []).includes('illustrates') || (speaking.length > 0 && spoken.length < speaking.length * 0.5)
  if (illustrationUnread) unmeasured.push(`editing.illustratesShare: ${spoken.length} of ${speaking.length} spoken shots have their illustration read${(log.coverage.missing ?? []).includes('illustrates') ? ' (the shot reader does not say it)' : ''}`)
  const media = shots.filter((s) => ['found', 'filmed', 'generated'].includes(s.origin))
  const mediaTime = media.reduce((t, s) => t + s.lengthS, 0)
  const cutCount = Math.max(0, shots.length - 1)
  unmeasured.push('editing.cutTypes: scene detection counts the cuts; their kind is only seen where frames are dense (transitions)')
  const editing: VideoAnalysis['editing'] = {
    cutTypes: { hard: cutCount },
    meanShotS: { value: st.meanS, evidence: spread(shots, 4) },
    medianShotS: { value: st.medianS, evidence: spread(shots, 4) },
    p90ShotS: { value: st.p90S, evidence: spread([...shots].sort((a, b) => b.lengthS - a.lengthS).slice(0, Math.ceil(shots.length * 0.1)), 3) },
    shotCurve: st.curve,
    holdsOver5S: st.holdsOver5S,
    transitions: i.global?.transitions ?? [],
    originShares: originShares(shots),
    colour: i.global?.colour ?? '',
    longestShotS: { value: st.longest.lengthS, evidence: [ev(longest)] },
    ...(snap !== null ? { cutOnPhraseShare: { value: snap, evidence: spread(shots.slice(1), 3).map((e) => ({ ...e, note: 'cut vs pauses between words' })) } } : {}),
    shotByPart: shotByPartOf(shots, parts),
    ...(spoken.length && !illustrationUnread ? { illustratesByPart: illustratesByPartOf(shots, parts) } : {}),
    ...(spoken.length && !illustrationUnread ? { illustratesShare: { value: r2(spoken.filter((s) => s.illustrates !== 'no').length / spoken.length), evidence: spread(spoken.filter((s) => s.illustrates === 'no'), 3).concat(spread(spoken, 1)) } } : {}),
    ...(media.length ? { stillShare: { value: r2(media.filter((s) => STILL_KINDS.has(s.kind)).reduce((t, s) => t + s.lengthS, 0) / Math.max(mediaTime, 0.01)), evidence: spread(media, 3) } } : {})
  }

  // ── sound
  if (!i.loudness) unread.push('sound')
  if (i.loudness && !i.music) unmeasured.push('sound.music.levelUnderVoiceDb: too few pauses to sample the bed')
  unmeasured.push('sound.music.genre: no listening model', 'sound.sfx: no listening model', 'sound.music.changesAtS: no listening model')
  const sound: VideoAnalysis['sound'] = {
    music: {
      present: i.music?.present ?? false,
      genre: '',
      levelUnderVoiceDb: i.music?.present && i.music.underVoiceDb !== null ? { value: i.music.underVoiceDb, evidence: i.music.samples.slice(0, 4).map((t) => evAt(t, `bed ${i.music!.pauseLufs} LUFS in pauses vs voice ${i.music!.speechLufs} LUFS`)) } : null,
      changesAtS: []
    },
    sfx: [],
    loudnessLufs: { value: numberOr0(i.loudness?.integratedLufs, 'sound.loudnessLufs', 'no loudness pass'), evidence: [{ video: video.id, fromS: 0, toS: r2(durationS), frames: [], note: `EBU R128 integrated over the whole file${i.loudness?.lraLu !== null && i.loudness ? `, LRA ${i.loudness.lraLu} LU` : ''}` }] }
  }

  // ── script
  const transcript = i.words ? i.words.map((w) => w.word).join(' ') : shots.map((s) => s.words).join(' ')
  const swm = sentenceWordsMean(transcript)
  const script: VideoAnalysis['script'] = {
    structure: sr?.structure ?? ['unread'], hookPattern: sr?.hookPattern ?? '', promise: sr?.promise ?? '', payoff: sr?.payoff ?? '',
    chapters: sr?.chapters ?? [], cta: sr?.cta ?? '', tone: sr?.tone ?? '', devices: sr?.devices ?? [],
    sentenceWordsMean: { value: numberOr0(swm || null, 'script.sentenceWordsMean', 'no punctuated transcript'), evidence: speechEv(`${i.words ? 'whisper' : 'shot'} transcript, sentences split on . ! ?`) }
  }

  // ── how every screen element is distributed along the video (screen time by overlap, per part and per tenth)
  const motionSeen = new Set(shots.filter((_, k) => base[k]!.look.motion !== null).map((s) => s.n))
  const distributions = distributionsOf({ videoId: video.id, shots, parts, durationS, motion: motionSeen })
  if (i.noFile || unread.includes('look')) unmeasured.push(`distributions: ${i.noFile ? 'no file, the pictures were not seen' : 'most shots have no look row, their origin comes from the shot kind only'}`)

  const captionsShare = captionShare(shots)
  // a log whose shots stop before what it says it read: the tail is a gap, said (never stretched)
  const shotsEnd = r2(shots[shots.length - 1]!.startS + shots[shots.length - 1]!.lengthS)
  const gaps = log.coverage.gaps.map((g) => ({ fromS: g.fromS, toS: g.toS, why: g.why || 'not read' }))
  let readS = log.coverage.readS
  if (shotsEnd < readS - 1) {
    gaps.push({ fromS: shotsEnd, toS: r2(readS), why: 'the whole-video log has no shot after this time' })
    readS = shotsEnd
    notes.push(`the shot log ends at ${shotsEnd} s of ${r2(log.coverage.readS)} s read`)
  }
  const said = [
    !log.coverage.complete ? (log.coverage.gaps.length ? `the shot log has ${log.coverage.gaps.length} gap(s): ${[...new Set(log.coverage.gaps.map((g) => g.why))].join(', ')}` : `the shot log covers ${Math.round(log.coverage.readS)} of ${Math.round(durationS)} s`) : '',
    unread.length ? `not read: ${unread.join(', ')}` : '',
    ...notes
  ].filter(Boolean).join('; ')
  const complete = log.coverage.complete && unread.length === 0 && gaps.length === 0
  return {
    schema: 'atelier.clone.video-analysis/1', cloneId: i.cloneId, createdAt: i.createdAt,
    videoId: video.id, url: video.url, ...(video.reference !== undefined ? { reference: video.reference } : {}), title: log.title || video.title,
    coverage: { durationS, readS, complete, gaps, unreadAxes: unread, said: complete ? (notes.join('; ') || null) : (said || 'partly read') },
    parts, shots, denseFrames,
    presenter: {
      kind: presenterKind, identity,
      angles: presenterKind === 'none' ? [] : angles,
      layoutByPart: presenterKind === 'none' ? [] : partNames.map((part) => { const x = per(part); return { part, shares: x.shares, evidence: x.evidence } }),
      presenceByPart: presenterKind === 'none' ? [] : partNames.map((part) => { const x = per(part); return { part, share: { value: x.presence, evidence: x.evidence } } }),
      entries: presenterKind === 'none' ? [] : entries, exits: presenterKind === 'none' ? [] : exits
    },
    voice,
    motion: { elements, palette: i.global?.palette ?? [], fonts: i.global?.fonts ?? [] },
    ...(i.global?.generatedLook ? { generatedLook: i.global.generatedLook } : {}),
    editing, sound, script, distributions,
    packaging: { title: log.title || video.title, titlePattern: sr?.titlePattern ?? '', thumbnail: { path: i.thumbnail, pattern: i.global?.thumbnailPattern ?? '' } },
    captions: { burnedInShare: { value: captionsShare, evidence: spread(shots.filter((s) => s.onScreenText.trim()), 3).concat(spread(shots, 1)) } },
    ...(i.letterbox !== undefined ? { framing: { letterbox: i.letterbox } } : {}),
    ...(i.frame ? { frame: i.frame } : {}),
    ...(i.global && i.global.figures !== undefined ? { figures: i.global.figures } : {}),
    unmeasured,
    costUsd: r2(i.costUsd)
  }
}
