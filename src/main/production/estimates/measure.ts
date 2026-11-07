// A channel's measured profile for the fit % (docs/specs/production-model.md §12): one measure per own video, from what the
// eyes read (src/main/eyes). When the eyes return their editing measures (production-15) those are used as they are;
// otherwise the eyes do not time the presenter, the picture kinds, the layouts, the look or the words yet,
// so: the presenter share and the picture kinds are the share of the shot types they name (made vs found only), the shot
// length comes from the cuts per minute, burnt-in captions from a dense on-screen text, the sponsor from a call to action
// or a text that names one. What is not read is left out of the comparison (fit.ts), never guessed.
import type { VideoMeasure } from '../../../engine/technologies/fit'
import type { AnalysisRecord } from '../../eyes/store'
import { classifyShot } from '../../../shared/style-profile'
import type { AnalysisResult, StyleMeasures } from '../../../shared/video-analysis'
import { measureEditing, type ProfileShot } from '../../../engine/technologies/reference-profile'

const PRESENTER = /talking|presenter|pr[ée]sentat|\bhost|face cam|facecam|avatar|vlog|interview|narrateur [àa] l[’']?[ée]cran/i
const SPONSOR = /sponsor|partenaire|partner|code promo|promo code|r[ée]duction|discount|offert par|brought to you|lien en description|link in (?:the )?description/i
/** On-screen texts per minute above which the text is captions burnt in (the profile builder's « word by word » threshold). */
const CAPTIONS_PER_MINUTE = 6

/** The style a look family is made with, when a base style has it (a measure's `look` must be a style the pipeline can wear). */
const LOOK_STYLE: Readonly<Record<string, string>> = { photoreal: 'phone-real', stock: 'clean-stock', archive: 'archive-real' }

/** The eyes' exact editing measures (production-15) over the heuristic reading of the same video. */
function exact(m: StyleMeasures, seconds: number | null): Partial<VideoMeasure> {
  const p = m.pictures
  const total = p.aiImage + p.aiClip + p.stock + p.archive + p.motion
  const kinds = total > 0 ? { imageAi: p.aiImage / total, clipAi: p.aiClip / total, stock: p.stock / total, archive: p.archive / total, motion: p.motion / total } : null
  const hook = m.hookPresenterShare
  return {
    presenterShare: m.presenterShare,
    layouts: m.presenterShare > 0 ? m.layouts : [],
    kinds: kinds ? Object.fromEntries(Object.entries(kinds).filter(([, v]) => v > 0)) : null,
    kindsCoarse: false,
    shotS: m.shotS,
    look: LOOK_STYLE[m.look] ?? null,
    lookFamily: m.look,
    // a presenter that takes the opening far more than the rest of the video is the hook-heavy curve
    curve: m.presenterShare > 0 && typeof hook === 'number' ? (hook >= m.presenterShare + 0.15 ? 'hook-heavy' : 'flat') : null,
    captions: m.captions === 'sentences' || m.captions === 'words',
    labelsPerMinute: m.labelsPerMinute,
    wordsPerMinute: m.wordsPerMinute,
    sponsor: m.offer !== null,
    sponsorAtS: m.offer?.atS ?? null,
    sponsorS: m.offer?.durationS ?? null,
    ...(m.presenterActs !== undefined ? { presenterActs: m.presenterActs } : {}),
    ...(m.presenterRunMaxS !== undefined && m.presenterShare > 0 ? { presenterRunMaxS: m.presenterRunMaxS } : {}),
    ...(m.light !== undefined ? { light: m.light } : {}),
    ...(m.camera !== undefined ? { camera: m.camera } : {}),
    ...(seconds === null ? {} : { minutes: seconds / 60 })
  }
}

/**
 * The presenter's curve and longest full-frame run from the eyes' presenter spans (record 0058): the spans and the time
 * between them (pictures) up to the end of what was watched. Nothing when the eyes did not read the presenter.
 */
export function presenterOf(an: AnalysisResult, watchedS: number | null): Pick<VideoMeasure, 'presenterCurve' | 'presenterRunMaxS'> {
  if (!an.presenter) return {}
  const spans = an.presenter.filter((p) => p.toS > p.fromS).sort((a, b) => a.fromS - b.fromS)
  const end = Math.max(watchedS ?? 0, ...an.structure.map((s) => s.toS), ...spans.map((p) => p.toS))
  if (end <= 0) return {}
  const shots: ProfileShot[] = []
  let t = 0
  for (const p of spans) {
    if (p.fromS > t) shots.push({ start: t, end: p.fromS, presenter: false })
    const start = Math.max(t, p.fromS)
    if (p.toS > start) shots.push({ start, end: p.toS, presenter: p.layout === 'full', withPresenter: p.layout !== 'full' })
    t = Math.max(t, p.toS)
  }
  if (end > t) shots.push({ start: t, end, presenter: false })
  const m = measureEditing(shots, [])
  return { presenterCurve: m.presenterCurve ?? null, presenterRunMaxS: m.presenterRunMaxS ?? (spans.length === 0 ? null : 0) }
}

/** One own video as the fit compares it. */
export function measureVideo(a: AnalysisRecord): VideoMeasure {
  const an = a.analysis
  const end = Math.max(0, ...an.structure.map((s) => s.toS))
  const seconds = a.durationS && a.durationS > 0 ? a.durationS : end > 0 ? end : null
  const minutes = seconds === null ? null : seconds / 60
  let presenter = 0
  let made = 0
  let found = 0
  for (const raw of new Set(an.shotTypes.map((s) => s.trim().toLowerCase()).filter(Boolean))) {
    const c = classifyShot(raw)
    if (c === 'footage' && PRESENTER.test(raw)) presenter++
    else if (c === 'generated') made++
    else if (c === 'stock' || c === 'footage') found++
  }
  const total = presenter + made + found
  const perMinute = minutes ? an.onScreenText.length / minutes : null
  const sponsorAt = [...an.callsToAction, ...an.onScreenText].find((x) => SPONSOR.test(x.text))
  const heuristic: VideoMeasure = {
    minutes,
    ...(total > 0 ? { presenterShare: presenter / total } : {}),
    ...(made + found > 0 ? { kinds: { imageAi: made / (made + found), stock: found / (made + found) }, kindsCoarse: true } : {}),
    shotS: an.pacing.cutsPerMinute > 0 ? 60 / an.pacing.cutsPerMinute : null,
    cta: an.callsToAction.length > 0,
    captions: perMinute === null ? null : perMinute >= CAPTIONS_PER_MINUTE,
    labelsPerMinute: perMinute !== null && perMinute < CAPTIONS_PER_MINUTE ? perMinute : null,
    sponsor: sponsorAt !== undefined,
    sponsorAtS: sponsorAt?.atS ?? null
  }
  const measured = an.measures ? { ...heuristic, ...exact(an.measures, seconds) } : heuristic
  return { ...measured, ...presenterOf(an, seconds) }
}

/** The channel's own analysed videos (competitors' ones are not the channel), as measures; `demo`: one came from the
 *  Cloud's demonstration provider, so the fit is an example, not a reading. */
export function channelMeasures(records: readonly AnalysisRecord[]): { videos: VideoMeasure[]; demo: boolean } {
  const own = records.filter((r) => r.sourceKey === 0)
  return { videos: own.map(measureVideo), demo: own.some((r) => r.demo) }
}
