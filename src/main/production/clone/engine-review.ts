// P7's review agent, complete (decision 0086 wired into the clone engine): D's measured render defects (holds, freezes,
// slow hook, voice holes, loudness, pace, length) PLUS the engine's own edit review of the film — repeated pictures, a
// shot that does not show its words or lands late, maps without legends, dates and figures the voice never says, texts
// in another language — PLUS music or sound effects where the reference has none. Every one becomes a P7 defect on its
// compare axis, so the improver and the blind judge's loop see them (D had left these to the judge's illustration axis).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { BLOCKING_DEFECT_WEIGHT, type Defect, type PipelinePlan, type Production, type StyleDefinition } from '../../../shared/clone'
import type { DefectKind, ReviewReport } from '../../../engine/review/types'
import { isBlocking } from '../../../engine/review/blocking'
import { ENGINE_REVIEW_FILE } from './app-producer'
import type { CloneServices } from './services'

/** Which compare axis each engine review defect belongs to. */
export const REVIEW_AXIS: Record<DefectKind, Defect['axis']> = {
  off_subject: 'illustration',
  duplicate: 'illustration',
  held: 'cadence',
  frozen: 'motion',
  film_short: 'cadence',
  hook_slow: 'cadence',
  text_unsaid: 'script',
  text_late: 'illustration',
  text_form: 'captions',
  text_language: 'captions',
  map_legend: 'motion',
  audio_dropout: 'voice',
  audio_click: 'sound',
  music_loud: 'sound',
  word_cut: 'voice',
  sound_hole: 'sound',
  timing_drift: 'captions',
  black: 'cadence',
  wrong_aspect: 'layout'
}

/** The engine review's defects left on the delivered film, as P7 defects (pure). */
export function engineReviewDefects(report: ReviewReport | null): Defect[] {
  if (!report) return []
  return report.left.map((d) => ({
    axis: REVIEW_AXIS[d.kind] ?? 'illustration',
    atS: Math.max(0, Math.round(d.atS * 10) / 10),
    description: `revue du montage : ${d.detail}`,
    // a real error (decision 0102: measured by code, a cut voice, a hole, a frozen, black or repeated picture, a wrong text, music too
    // loud…) is never shown: blocking; other failures weigh, warnings less
    weight: isBlocking(d) ? BLOCKING_DEFECT_WEIGHT : d.severity === 'fail' ? 0.6 : 0.3
  }))
}

const said = (f: { source: string }): boolean => f.source !== 'default'
const usesBrick = (plan: PipelinePlan | null, prefix: string): boolean =>
  !!plan && (plan.bricks.some((b) => b.node.startsWith(prefix)) || JSON.stringify(plan.recipe ?? null).includes(`"${prefix}`))

/** Music or sound effects in our render where the reference measured none (pure). */
export function soundWhereNone(def: StyleDefinition, plan: PipelinePlan | null): Defect[] {
  const out: Defect[] = []
  if (said(def.sound.music) && def.sound.music.value === false && usesBrick(plan, 'sound.music')) {
    out.push({ axis: 'sound', atS: null, description: 'musique ajoutée alors que la référence n’en a pas', weight: 0.6 })
  }
  if (said(def.sound.sfx) && def.sound.sfx.value.length === 0 && /"sfx"\s*:\s*(true|"(?!none|off)[^"]+")/.test(JSON.stringify(plan?.recipe ?? null))) {
    out.push({ axis: 'sound', atS: null, description: 'bruitages ajoutés alors que la référence n’en a pas', weight: 0.5 })
  }
  return out
}

/** The engine review saved beside a round's render (`<round>/engine-review.json`, written by the app producer). */
export function savedEngineReview(cloneDir: string, production: Production): ReviewReport | null {
  const f = path.join(cloneDir, path.dirname(production.videoPath), ENGINE_REVIEW_FILE)
  if (!existsSync(f)) return null
  try { return JSON.parse(readFileSync(f, 'utf8')) as ReviewReport | null } catch { return null }
}

/** The review service: measured defects + the engine's review + sound where the reference has none. */
export function fullReview(inner: CloneServices['review'], o: { cloneDir: string; plan(): PipelinePlan | null }): CloneServices['review'] {
  return {
    async defects(production, def) {
      const measured = await inner.defects(production, def)
      return [...measured, ...engineReviewDefects(savedEngineReview(o.cloneDir, production)), ...soundWhereNone(def, o.plan())]
    }
  }
}
