// A deterministic synthesis for the fakes (decision 0095): reads each analysis field that feeds a Style Definition field,
// keeps it as a constant when at least CONSTANT_MIN_FREQUENCY of the corpus agrees (numbers: the median, always
// constant here). Chantier A replaces it with the real synthesis (frequencies + an LLM pass); the field mapping is the
// contract it must keep.
import { isDeepStrictEqual } from 'node:util'
import { CONSTANT_MIN_FREQUENCY, type Evidence, type Synthesis, type SynthesisConstant, type VideoAnalysis } from '../../../../shared/clone'

type Body = Omit<Synthesis, 'schema' | 'cloneId' | 'createdAt'>
interface Extractor { field: string; read(a: VideoAnalysis): unknown; numeric?: boolean; evidence(a: VideoAnalysis): Evidence[] }

const firstShot = (a: VideoAnalysis): Evidence[] => [{ video: a.videoId, atS: a.shots[0]!.startS, frames: a.shots[0]!.frames }]

/** Analysis → definition field. */
export const EXTRACTORS: readonly Extractor[] = [
  { field: 'script.wordsPerMinute', read: (a) => a.voice.wordsPerMinute.value, numeric: true, evidence: (a) => a.voice.wordsPerMinute.evidence },
  { field: 'script.sentenceWordsMean', read: (a) => a.script.sentenceWordsMean.value, numeric: true, evidence: (a) => a.script.sentenceWordsMean.evidence },
  { field: 'script.hookPattern', read: (a) => a.script.hookPattern, evidence: firstShot },
  { field: 'script.tone', read: (a) => a.script.tone, evidence: firstShot },
  { field: 'voice.kind', read: (a) => a.voice.kind, evidence: (a) => a.voice.wordsPerMinute.evidence },
  { field: 'voice.timbre', read: (a) => a.voice.timbre, evidence: (a) => a.voice.wordsPerMinute.evidence },
  { field: 'voice.wordsPerMinute', read: (a) => a.voice.wordsPerMinute.value, numeric: true, evidence: (a) => a.voice.wordsPerMinute.evidence },
  { field: 'voice.energy', read: (a) => a.voice.energy, evidence: (a) => a.voice.wordsPerMinute.evidence },
  { field: 'presenter.kind', read: (a) => a.presenter.kind, evidence: firstShot },
  { field: 'presenter.identity', read: (a) => (a.presenter.identity ? { ...a.presenter.identity, evidence: undefined } : null), evidence: (a) => a.presenter.identity?.evidence ?? firstShot(a) },
  { field: 'presenter.angleCount', read: (a) => a.presenter.angles.length, evidence: (a) => [...a.presenter.angles.map((x): Evidence => ({ video: a.videoId, frames: x.frames })), ...firstShot(a)] },
  {
    field: 'presenter.configurations',
    read: (a) => [...new Map(a.shots.filter((s) => s.layout !== 'off' && s.angle !== null).map((s) => [`${s.layout}/${s.angle}`, s])).values()].map((s) => ({
      id: `${s.layout}-${s.angle}`, framing: a.presenter.angles[s.angle!]?.framing ?? 'medium', layout: s.layout, angle: s.angle!, description: `${s.layout}, angle ${s.angle}`
    })),
    evidence: firstShot
  },
  { field: 'presenter.layoutCurve', read: (a) => a.presenter.layoutByPart.map((l) => ({ part: l.part, shares: l.shares })), evidence: (a) => a.presenter.layoutByPart.flatMap((l) => l.evidence).concat(firstShot(a)) },
  { field: 'presenter.presenceByPart', read: (a) => a.presenter.presenceByPart.map((p) => ({ part: p.part, share: p.share.value })), evidence: firstShot },
  { field: 'editing.meanShotS', read: (a) => a.editing.meanShotS.value, numeric: true, evidence: (a) => a.editing.meanShotS.evidence },
  { field: 'editing.medianShotS', read: (a) => a.editing.medianShotS.value, numeric: true, evidence: (a) => a.editing.medianShotS.evidence },
  { field: 'editing.p90ShotS', read: (a) => a.editing.p90ShotS.value, numeric: true, evidence: (a) => a.editing.p90ShotS.evidence },
  { field: 'sourcing.originShares', read: (a) => a.editing.originShares, evidence: firstShot },
  { field: 'motion.palette', read: (a) => a.motion.palette, evidence: firstShot },
  { field: 'motion.fonts', read: (a) => a.motion.fonts, evidence: firstShot },
  { field: 'sound.music', read: (a) => a.sound.music.present, evidence: (a) => a.sound.loudnessLufs.evidence },
  { field: 'sound.musicGenre', read: (a) => a.sound.music.genre, evidence: (a) => a.sound.loudnessLufs.evidence },
  { field: 'sound.loudnessLufs', read: (a) => a.sound.loudnessLufs.value, numeric: true, evidence: (a) => a.sound.loudnessLufs.evidence }
]

const strip = (v: unknown): unknown => JSON.parse(JSON.stringify(v)) as unknown
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]! }

export function deterministicSynthesis(analyses: readonly VideoAnalysis[], chosenStyle: string | null = null): Body {
  const constants: SynthesisConstant[] = []
  const variations: Body['variations'] = []
  for (const x of EXTRACTORS) {
    const values = analyses.map((a) => strip(x.read(a)))
    const evidence = analyses.flatMap((a) => x.evidence(a)).slice(0, 6)
    if (x.numeric) {
      constants.push({ field: x.field, value: median(values as number[]), frequency: 1, videos: analyses.map((a) => a.videoId), evidence })
      continue
    }
    const top = values[0]
    const agree = analyses.filter((_, i) => isDeepStrictEqual(values[i], top))
    const frequency = agree.length / analyses.length
    if (frequency >= CONSTANT_MIN_FREQUENCY) constants.push({ field: x.field, value: top, frequency, videos: agree.map((a) => a.videoId), evidence })
    else variations.push({ field: x.field, description: `varies across the corpus`, values: values.map((v, i) => ({ value: v, frequency: 1 / analyses.length, videos: [analyses[i]!.videoId] })) })
  }
  return { videoCount: analyses.length, styles: [{ id: 's1', description: 'one style', videos: analyses.map((a) => a.videoId) }], chosenStyle, constants, variations }
}
