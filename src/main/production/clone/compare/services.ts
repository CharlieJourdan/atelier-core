// The real P7/P8 services (decision 0095, chantier D): `frames`, `curves`, `review`, `judge` and `improver` of
// CloneServices, built on ffmpeg (system tools through an injectable `run`) and on one model call per judgement. The
// reference passage is cut once per clone (`p7-reference/`) and measured with the SAME instruments as our render; the
// measures are kept in memory between the calls of one P7 so a file is measured once. The assembler plugs these into
// create.ts with the real `run`, the reference file resolver (P1/P2 downloads) and the model call.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { BlindItem, CorpusVideo, Defect, FramePair, PipelinePlan, Production, StyleDefinition, VideoAnalysis } from '../../../../shared/clone'
import { buildSheet } from '../../../../engine/sourcing/sheet'
import type { RunFn } from '../../../../engine/sourcing/types'
import type { CloneServices } from '../services'
import { loadCalibration } from './calibration'
import { compareCurves, type FileMeasures } from './curves'
import { matchFrames } from './frames'
import { causeImprover } from './improver'
import { blindJudge, type AskFn, type HeardItem } from './judge'
import { measureFile, scriptPace, segmentArgs } from './measure'
import { measureHoles, renderDefects, type Holes } from './review'
import { ENGINE_REVIEW_FILE } from '../app-producer'

export interface CompareDeps {
  run: RunFn
  /** The clone folder (`<dataDir>/clones/<id>`): artefact paths are relative to it. */
  cloneDir: string
  /** The data folder (engine-wide calibration lives there). */
  dataDir: string
  /** Absolute path of a corpus video's local file (downloaded by P1/P2). */
  referenceFile(video: CorpusVideo): Promise<string>
  /** The P2 analysis of a corpus video (for the reference's words and parts). */
  analysis(videoId: string): VideoAnalysis | null
  /** The current pipeline plan (for the brick that reads a field). */
  plan(): PipelinePlan | null
  /** The blind judge's model call (a separate call with no context). */
  judgeAsk: AskFn
  /** Optional model pass of the improver, for axes the curves do not measure. */
  fixAsk?: AskFn
  onSpend?(s: { usd: number; seconds: number; what: string }): void
}

type CompareServices = Pick<CloneServices, 'frames' | 'curves' | 'review' | 'judge' | 'improver'>

const r1 = (x: number): number => Math.round(x * 10) / 10

/** What the judge hears of the music, the same words for both films (it must not tell them apart by the wording): `none`,
 *  `present, -18 dB against the voice`, or `present` when the level is not known. Null: not known at all. Pure. */
export function musicHeard(present: boolean | null, levelDb: number | null): string | null {
  if (present === null) return null
  if (!present) return 'none'
  return levelDb === null || !Number.isFinite(levelDb) ? 'present' : `present, ${r1(levelDb)} dB against the voice`
}

/** The reference's music as P2 measured it on the whole video (presence, bed level under the voice). */
export const referenceMusic = (a: VideoAnalysis | null): string | null =>
  a ? musicHeard(a.sound.music.present, a.sound.music.levelUnderVoiceDb?.value ?? null) : null

/** Our film's music: the plan's music brick and the bed level it mixes under the voice (the engine mixes the bed at the voice's
 *  loudness + `bedDb`, exactly), moved by the engine review's own correction (`musicDb`, saved beside the render). */
export function oursMusic(plan: PipelinePlan | null, reviewFile: string | null): string | null {
  if (!plan) return null
  if (!plan.bricks.some((b) => b.node.split('@')[0] === 'sound.music')) return 'none'
  const bed = plan.settings.find((x) => x.key === 'sound.music.bedDb')?.value
  let fix = 0
  if (reviewFile && existsSync(reviewFile)) {
    try { fix = Number((JSON.parse(readFileSync(reviewFile, 'utf8')) as { musicDb?: unknown }).musicDb ?? 0) || 0 } catch { fix = 0 }
  }
  return musicHeard(true, typeof bed === 'number' ? bed + fix : null)
}

/** Words said in the reference passage (from the analysis shot log). */
export function passageWords(a: VideoAnalysis | null, passage: Production['passage']): string {
  if (!a) return ''
  return a.shots.filter((s) => s.startS + s.lengthS > passage.fromS && s.startS < passage.toS).map((s) => s.words).join(' ').replace(/\s+/g, ' ').trim()
}

export function compareServices(d: CompareDeps): CompareServices {
  const measured = new Map<string, Promise<FileMeasures>>()
  const holes = new Map<string, Promise<Holes>>()
  const tmp = path.join(d.cloneDir, 'p7-reference')
  /** The current round's two sides, set by frames/curves, read by the judge's `heard`. */
  let current: { production: Production; analysis: VideoAnalysis | null; refFile: string } | null = null

  const abs = (rel: string): string => path.join(d.cloneDir, rel)
  const referencePassage = async (video: CorpusVideo, passage: Production['passage']): Promise<string> => {
    mkdirSync(tmp, { recursive: true })
    const out = path.join(tmp, `${video.id}-${passage.fromS}-${passage.toS}.mp4`)
    if (!existsSync(out)) await d.run('ffmpeg', segmentArgs(await d.referenceFile(video), passage.fromS, passage.toS, out), { timeoutMs: 600_000 })
    return out
  }
  const scriptOf = (pr: Production): string => (existsSync(abs(pr.scriptPath)) ? readFileSync(abs(pr.scriptPath), 'utf8') : '')
  const measureOnce = (file: string, wpm: number | null): Promise<FileMeasures> => {
    if (!measured.has(file)) measured.set(file, measureFile(file, d.run, tmp, wpm))
    return measured.get(file)!
  }
  const ours = (pr: Production): Promise<FileMeasures> => measureOnce(abs(pr.videoPath), null).then((m) => ({ ...m, wordsPerMinute: scriptPace(scriptOf(pr), m.durationS) }))
  const refMeasures = (refFile: string, a: VideoAnalysis | null): Promise<FileMeasures> => measureOnce(refFile, a?.voice.wordsPerMinute.value ?? null)
  const refFor = async (pr: Production): Promise<{ file: string; analysis: VideoAnalysis | null }> => {
    if (current && current.production.videoPath === pr.videoPath) return { file: current.refFile, analysis: current.analysis }
    throw new Error('the reference passage is cut by frames.matched first (P7 order)')
  }

  return {
    frames: {
      async matched(reference, production, dir): Promise<FramePair[]> {
        const analysis = d.analysis(reference.id)
        const refFile = await referencePassage(reference, production.passage)
        current = { production, analysis, refFile }
        const m = await matchFrames({ referenceFile: refFile, referenceFromS: production.passage.fromS, oursFile: abs(production.videoPath), production, analysis, dir, run: d.run })
        return m.pairs
      }
    },
    curves: {
      async compare(reference, production) {
        const ref = await refFor(production)
        return compareCurves({ analysis: reference, production, ours: await ours(production), reference: await refMeasures(ref.file, ref.analysis ?? reference) })
      }
    },
    review: {
      async defects(production, def: StyleDefinition): Promise<Defect[]> {
        const file = abs(production.videoPath)
        if (!holes.has(file)) holes.set(file, measureHoles(file, d.run))
        return renderDefects(await ours(production), await holes.get(file)!, def, production.passage.toS - production.passage.fromS)
      }
    },
    judge: blindJudge({
      ask: d.judgeAsk,
      strip: (frames, out) => buildSheet(frames, out, d.run, { cols: 4, cellW: 384, cellH: 216 }),
      heard: async (item: BlindItem): Promise<HeardItem> => {
        if (!current) throw new Error('the judge runs after frames and curves (P7 order)')
        const pr = current.production
        const isOurs = item.video === pr.videoPath
        const m = isOurs ? await ours(pr) : await refMeasures(current.refFile, current.analysis)
        const cuts = m.durationS > 0 ? r1((m.cutsS.length / m.durationS) * 60) : null
        // the music of both films, heard the same way (it was always null: the judge never heard the music)
        const music = isOurs ? oursMusic(d.plan(), path.join(path.dirname(abs(pr.videoPath)), ENGINE_REVIEW_FILE)) : referenceMusic(current.analysis)
        return { transcript: isOurs ? scriptOf(pr) : passageWords(current.analysis, pr.passage), wordsPerMinute: m.wordsPerMinute, loudnessLufs: m.loudnessLufs, cutsPerMinute: cuts, music }
      }
    }),
    improver: costAware(causeImprover({ plan: d.plan, calibration: () => loadCalibration(d.dataDir), ...(d.fixAsk ? { ask: d.fixAsk } : {}), ...(d.onSpend ? { onSpend: d.onSpend } : {}) }))
  }
}

/** Cost rounds (P8 asks with `kind: 'cost'`): a `rule` lowering the $/min ceiling the plan must meet, 30 % under what the
 *  round cost. It is a rule, not the definition's `cost.usdPerMinute` (the target P4 set). Nothing reads the ceiling yet
 *  (no compiler picks cheaper engines under it): P8 skips the cost round with that reason (p8-improve.ts COST_READERS). */
export const COST_STEP = 0.7
export const COST_CEILING = 'cost.ceilingUsdPerMinute'

function costAware(inner: ReturnType<typeof causeImprover>): ReturnType<typeof causeImprover> {
  return {
    async propose(round, def) {
      if (round.kind !== 'cost') return inner.propose(round, def)
      const now = round.production.usdPerMinute
      const target = Math.round(now * COST_STEP * 1000) / 1000
      if (!(target > 0)) return []
      return [{ cause: 'rule', target: COST_CEILING, before: Math.round(now * 1000) / 1000, after: target, why: `quality plateau at ${now.toFixed(3)} $/min: try engines and settings for ${target} $/min (the target stays ${def.cost.usdPerMinute.value} $/min)`, fixes: [`cost: ${now.toFixed(3)} $/min measured on round ${round.n}`] }]
    }
  }
}
