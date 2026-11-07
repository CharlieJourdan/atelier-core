// The final quality pass of an ordered video (equipe-3-chaines), on top of what the render already did. Nothing new is
// measured here twice: the real errors are the render's own blocking checks (decision 0102: its review report, `left`,
// kinds flagged blocking) plus, when given, the same checks re-measured on the finished artefacts; the edit review's remarks
// (decision 0086) are the rest of that report; the blind judge is the cloning engine's (decision 0097), fed our film and one
// of the channel's own videos at the same moments. The judge's call is the only paid part (cents, cached by its frames).
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Defect } from '../../../engine/review/types'
import { fmtS } from '../../../engine/review/types'
import type { RunFn } from '../../../engine/sourcing/types'
import { buildSheet } from '../../../engine/sourcing/sheet'
import type { BlindItem, BlindVerdict } from '../../../shared/clone'
import { blindJudge, type AskFn, type HeardItem } from '../../production/clone/compare/judge'
import { unblind } from '../../production/clone/compare/improver'
import { measureFile } from '../../production/clone/compare/measure'
import type { FileMeasures } from '../../production/clone/compare/curves'
import { detectCuts, probeDuration } from '../../../engine/sourcing/measure-video'
import { stepOf, type FinalPass, type FinalReport } from '.'

export interface FinalPassDeps {
  run: RunFn
  /** Where the pass keeps its frames and the judge's files (`<data>/orders/<id>`). */
  workDir(orderId: number): string
  /** The render's review report of the run (what the film delivered still has), null when there is none. */
  review(runId: number): Promise<{ left: Defect[] } | null>
  /** A real error (the render's blocking kinds, decision 0102). */
  isBlocking(d: Pick<Defect, 'kind' | 'severity'>): boolean
  /** The same blocking checks re-measured on the finished run (free; absent: the render's report is the measure). */
  remeasure?(runId: number): Promise<Defect[]>
  /** The finished film and its length. */
  film(runId: number): { file: string; durationS: number | null } | null
  /** The channel's own video to judge against (a local file), null when none is known. */
  reference(channelId: number): string | null
  /** The words our film says (its script), for the judge's « heard ». */
  words(runId: number): string
  /** The judge's model call (no context). */
  ask: AskFn | null
  /** Frames per side (default 12). */
  frames?: number
}

const r1 = (x: number): number => Math.round(x * 10) / 10

/** The moments both films are looked at (pure): `n` points spread over the shorter one, away from its very ends. */
export function judgeMoments(oursS: number, referenceS: number, n = 12): number[] {
  const span = Math.max(4, Math.min(oursS, referenceS))
  return Array.from({ length: n }, (_, i) => r1(span * (0.04 + (0.92 * i) / Math.max(1, n - 1))))
}

/** The judge's verdict as Charlie reads it (pure): the mean of the axes and every defect said about ours. */
export function verdictLines(v: BlindVerdict, key: Readonly<Record<string, 'reference' | 'ours'>>): NonNullable<FinalReport['judge']> {
  const score = Math.round(v.scores.reduce((a, s) => a + s.score, 0) / Math.max(1, v.scores.length))
  const defects = v.scores.filter((s) => s.score < 85).flatMap((s) => s.defects.map((x) => `${s.axis} (${s.score}) : ${unblind(x, key)}`))
  return { sameChannel: v.sameChannel, score, reason: unblind(v.reason, key), defects }
}

/** The judge's measures of a file; a file without sound (a reference kept as its picture only) still gives its cuts and length. */
async function measured(run: RunFn, file: string, dir: string): Promise<FileMeasures> {
  try {
    return await measureFile(file, run, dir, null)
  } catch {
    const durationS = (await probeDuration(file, run).catch(() => null)) ?? 0
    const cutsS = await detectCuts(file, run).catch(() => [] as number[])
    return { cutsS, durationS, loudnessLufs: null, palette: [], wordsPerMinute: null }
  }
}

async function frameAt(run: RunFn, file: string, atS: number, out: string): Promise<string> {
  if (!existsSync(out)) await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(atS), '-i', file, '-frames:v', '1', '-vf', 'scale=384:216:force_original_aspect_ratio=decrease,pad=384:216:(ow-iw)/2:(oh-ih)/2', out], { timeoutMs: 120_000 })
  return out
}

export function finalPass(d: FinalPassDeps): FinalPass {
  return {
    async check({ orderId, runId, channelId, real }) {
      const report = await d.review(runId)
      const remeasured = d.remeasure ? await d.remeasure(runId).catch(() => [] as Defect[]) : []
      const all = [...(report?.left ?? []), ...remeasured]
      const seen = new Set<string>()
      const blocking = all
        .filter((x) => d.isBlocking(x))
        .filter((x) => {
          const k = `${x.kind}@${Math.floor(x.atS)}`
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
        .map((x) => ({ kind: x.kind, atS: x.atS, what: `${fmtS(x.atS)} ${x.detail}`, step: stepOf(x.kind) }))
      const review = (report?.left ?? []).filter((x) => !d.isBlocking(x)).map((x) => `${fmtS(x.atS)} ${x.detail}`)
      const film = d.film(runId)
      const base: FinalReport = { blocking, checked: report !== null, review, judge: null, costUsd: 0, film: film?.file ?? null, durationS: film?.durationS ?? null }
      if (!report) base.review.unshift('le rendu n’a pas laissé de rapport de revue : les contrôles bloquants du rendu n’ont pas pu être relus')
      const ref = d.reference(channelId)
      if (!film || !existsSync(film.file)) return { ...base, judgeSkipped: 'le film n’est pas trouvé' }
      if (!ref || !existsSync(ref)) return { ...base, judgeSkipped: 'aucune vidéo de la chaîne à comparer sur cet ordinateur' }
      if (!d.ask) return { ...base, judgeSkipped: 'aucun modèle connecté' }
      if (!real) return { ...base, judgeSkipped: 'vidéo de démo : le juge (payant) n’est pas appelé' }
      // the judge never stops the order: a film it cannot read or an answer it cannot use is said, the video goes on
      try {
        const dir = d.workDir(orderId)
        mkdirSync(dir, { recursive: true })
        const ours = await measured(d.run, film.file, dir)
        const theirs = await measured(d.run, ref, dir)
        const moments = judgeMoments(ours.durationS, theirs.durationS, d.frames ?? 12)
        const shoot = async (file: string, tag: string) => Promise.all(moments.map((t, i) => frameAt(d.run, file, t, path.join(dir, `${tag}-${String(i).padStart(2, '0')}.jpg`)).then((f) => path.relative(dir, f))))
        // which label is ours is decided by the run id (stable across a resume, unknown to the judge)
        const oursFirst = runId % 2 === 0
        const key: Record<string, 'reference' | 'ours'> = oursFirst ? { A: 'ours', B: 'reference' } : { A: 'reference', B: 'ours' }
        const items: BlindItem[] = [
          { label: 'A', video: oursFirst ? film.file : ref, frames: await shoot(oursFirst ? film.file : ref, `run${runId}-A`) },
          { label: 'B', video: oursFirst ? ref : film.file, frames: await shoot(oursFirst ? ref : film.file, `run${runId}-B`) }
        ]
        const heard = (m: typeof ours, transcript: string): HeardItem => ({ transcript, wordsPerMinute: m.wordsPerMinute, loudnessLufs: m.loudnessLufs, cutsPerMinute: m.durationS > 0 ? r1((m.cutsS.length / m.durationS) * 60) : null, music: null })
        const judge = blindJudge({
          ask: d.ask,
          strip: (frames, out) => buildSheet(frames, out, d.run, { cols: 4, cellW: 384, cellH: 216 }),
          heard: async (it) => (it.video === film.file ? heard(ours, d.words(runId)) : heard(theirs, ''))
        })
        const v = await judge.blind(items, { abs: dir, rel: '' })
        return { ...base, judge: verdictLines(v, key), costUsd: v.costUsd ?? 0 }
      } catch (e) {
        const cost = (e as { costUsd?: number }).costUsd ?? 0
        return { ...base, costUsd: cost, judgeSkipped: `le juge n’a pas donné de verdict utilisable (${e instanceof Error ? e.message.slice(0, 160) : String(e)})` }
      }
    }
  }
}
