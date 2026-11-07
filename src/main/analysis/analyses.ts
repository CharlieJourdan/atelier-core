// Analysis runs (Production › Analyser une chaîne, PLAN-V2-PRODUCTION §2.1–§2.4): from a reference channel to a format
// profile, a style draft, the gauge, the cost per minute and a proposed pipeline. Every change (examples, answers,
// budget mode, the Analyste's adjustments) recomputes and stores the gauge, the pipeline and its cost.
import type { Db } from '../db'
import { nowIso } from '../db'
import {
  STEP_IDS,
  type Adjust,
  type AnalysisDetail,
  type AnalysisMessage,
  type AnalysisStep,
  type AnalysisSummary,
  type CostPerMinute,
  type FormatProfile,
  type StyleSheet
} from '../../shared/analysis'
import { computeGauge, isGaugeMode, isInputId, type ComponentId, type GaugeMode, type GaugeResult, type InputId } from '../../shared/gauge'
import { adaptTemplate } from './adapt'
import { checkPipeline, costReport } from './catalog'
import { findReference, patternShares, timelineFor, type ReferenceChannel } from './references'
import { isId } from './library'

interface RunRow {
  id: number
  source_link: string
  reference_id: string
  status: 'choose_examples' | 'done'
  mode: GaugeMode
  chosen_examples_json: string
  steps_json: string
  profile_json: string
  style_draft_json: string
  answers_json: string
  replace_json: string
  adjust_json: string
  gauge_json: string
  proposed_pipeline_json: string
  created_pipeline_id: number | null
  example: number
  created_at: string
}

export interface AdjustState {
  maxCreditsPerVideo?: number
  minutes?: number
  scriptLength?: string
  scriptTone?: string
}

const LENGTH_FACTOR: Record<string, number> = { court: 0.6, moyen: 1, long: 1.4 }

export class AnalysisStore {
  constructor(private readonly db: Db) {}

  private raw(id: number): RunRow {
    if (!isId(id)) throw new Error('Analyse inconnue.')
    const r = this.db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(id) as unknown as RunRow | undefined
    if (!r) throw new Error('Analyse inconnue.')
    return r
  }

  private ref(r: RunRow): ReferenceChannel {
    const ref = findReference(r.reference_id)
    if (!ref) throw new Error('Chaîne de référence inconnue.')
    return ref
  }

  list(): AnalysisSummary[] {
    const rows = this.db.prepare('SELECT * FROM analysis_runs ORDER BY id DESC').all() as unknown as RunRow[]
    return rows.filter((r) => findReference(r.reference_id)).map((r) => this.summary(r))
  }

  private summary(r: RunRow): AnalysisSummary {
    const gauge = JSON.parse(r.gauge_json) as GaugeResult | null
    return {
      id: r.id,
      referenceId: r.reference_id,
      channelName: this.ref(r).name,
      sourceLink: r.source_link,
      status: r.status,
      score: gauge?.score ?? null,
      example: r.example === 1,
      createdAt: r.created_at
    }
  }

  /** Starts an analysis of a reference channel: the channel is read, 3 example videos are proposed. */
  start(referenceId: string, sourceLink = '', example = false): number {
    const ref = findReference(referenceId)
    if (!ref) throw new Error('Chaîne de référence inconnue.')
    const steps: AnalysisStep[] = STEP_IDS.map((id) =>
      id === 'read' ? { id, status: 'done', n: ref.recentVideos.length } : id === 'examples' ? { id, status: 'waiting', n: 0 } : { id, status: 'pending', n: 0 }
    )
    const at = nowIso()
    return Number(
      this.db
        .prepare(
          `INSERT INTO analysis_runs (source_link, reference_id, status, steps_json, example, created_at, updated_at)
           VALUES (?, ?, 'choose_examples', ?, ?, ?, ?)`
        )
        .run(sourceLink.slice(0, 500), ref.id, JSON.stringify(steps), example ? 1 : 0, at, at).lastInsertRowid
    )
  }

  /** The user picks at least one of the proposed videos: the analysts complete from the reference data. */
  chooseExamples(id: number, videoIds: unknown): void {
    const r = this.raw(id)
    const ref = this.ref(r)
    if (!Array.isArray(videoIds) || videoIds.length === 0) throw new Error('Choisis au moins une vidéo d’exemple.')
    const chosen = [...new Set(videoIds)]
    if (!chosen.every((v): v is string => typeof v === 'string' && ref.proposedExamples.includes(v))) throw new Error('Vidéo d’exemple inconnue.')
    const shares = patternShares(ref)
    const profile: FormatProfile = { ...ref.profile, components: shares }
    const shots = chosen.reduce((s, v) => s + timelineFor(ref, v).length, 0)
    const steps: AnalysisStep[] = [
      { id: 'read', status: 'done', n: ref.recentVideos.length },
      { id: 'examples', status: 'done', n: chosen.length },
      { id: 'video', status: 'done', n: shots },
      { id: 'script', status: 'done', n: ref.scriptCard.structure.length },
      { id: 'synthesis', status: 'done', n: ref.questions.length }
    ]
    this.db
      .prepare(
        `UPDATE analysis_runs SET status = 'done', chosen_examples_json = ?, steps_json = ?, profile_json = ?, style_draft_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(JSON.stringify(chosen), JSON.stringify(steps), JSON.stringify(profile), JSON.stringify(ref.styleDraft), nowIso(), id)
    this.recompute(id)
  }

  answer(id: number, input: unknown, value: unknown): void {
    const r = this.raw(id)
    if (!isInputId(input) || !this.ref(r).questions.includes(input)) throw new Error('Question inconnue pour cette analyse.')
    if (value !== true && value !== false && value !== null) throw new Error('Réponse attendue : oui, non ou effacer.')
    const answers = JSON.parse(r.answers_json) as Partial<Record<InputId, boolean>>
    if (value === null) delete answers[input]
    else answers[input] = value
    this.db.prepare('UPDATE analysis_runs SET answers_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(answers), nowIso(), id)
    this.recompute(id)
  }

  setMode(id: number, mode: unknown): void {
    this.raw(id)
    if (!isGaugeMode(mode)) throw new Error('Mode de budget inconnu.')
    this.db.prepare('UPDATE analysis_runs SET mode = ?, updated_at = ? WHERE id = ?').run(mode, nowIso(), id)
    this.recompute(id)
  }

  /** Applies a validated adjustment of the Analyste (answers, replacements, mode, budget, script). */
  applyAdjust(id: number, a: Adjust): void {
    const r = this.raw(id)
    const ref = this.ref(r)
    const answers = JSON.parse(r.answers_json) as Partial<Record<InputId, boolean>>
    for (const [k, val] of Object.entries(a.answers ?? {})) if (isInputId(k) && ref.questions.includes(k) && typeof val === 'boolean') answers[k] = val
    const replace = JSON.parse(r.replace_json) as Partial<Record<ComponentId, ComponentId>>
    for (const [k, by] of Object.entries(a.replace ?? {})) {
      // a component is only replaced by something we can make (never by clips of others)
      if (by && by !== 'clip' && k !== by) replace[k as ComponentId] = by
    }
    const adjust = JSON.parse(r.adjust_json) as AdjustState
    if (a.maxCreditsPerVideo !== undefined) adjust.maxCreditsPerVideo = a.maxCreditsPerVideo
    if (a.minutes !== undefined) adjust.minutes = a.minutes
    if (a.script?.length) adjust.scriptLength = a.script.length
    if (a.script?.tone) adjust.scriptTone = a.script.tone
    this.db
      .prepare('UPDATE analysis_runs SET answers_json = ?, replace_json = ?, adjust_json = ?, mode = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(answers), JSON.stringify(replace), JSON.stringify(adjust), a.mode ?? r.mode, nowIso(), id)
    this.recompute(id)
  }

  /**
   * Gauge, style draft and proposed pipeline, from the current state (synchronous, so the example seeder can use it).
   * The cost is filled by `fillCost` (the engine's estimate is async).
   */
  recompute(id: number): void {
    const r = this.raw(id)
    if (r.status !== 'done') return
    const ref = this.ref(r)
    const profile = JSON.parse(r.profile_json) as FormatProfile
    const answers = JSON.parse(r.answers_json) as Partial<Record<InputId, boolean>>
    const replace = JSON.parse(r.replace_json) as Partial<Record<ComponentId, ComponentId>>
    const adjust = JSON.parse(r.adjust_json) as AdjustState
    const gauge = computeGauge(
      { components: profile.components, voice: profile.notes.voice, script: profile.notes.script, edit: profile.notes.edit, analystConfidence: profile.analystConfidence },
      { mode: r.mode, answers, replace }
    )
    const minutes = adjust.minutes ?? Math.max(1, Math.round(ref.template.minutes * (LENGTH_FACTOR[adjust.scriptLength ?? 'moyen'] ?? 1)))
    const pipeline = adaptTemplate(ref, { mode: r.mode, answers, minutes, maxCreditsPerVideo: adjust.maxCreditsPerVideo, shares: profile.components })
    const check = checkPipeline(pipeline)
    if (!check.ok) throw new Error('Le pipeline proposé ne passe pas la validation.')
    const style = this.styleFrom(ref.styleDraft, r.mode, adjust, minutes)
    this.db
      .prepare('UPDATE analysis_runs SET gauge_json = ?, proposed_pipeline_json = ?, style_draft_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify({ ...gauge, cost: null }), check.json, JSON.stringify(style), nowIso(), id)
  }

  /** Cost per minute of the proposed pipeline in both modes, when it is not computed yet. */
  async fillCost(id: number): Promise<void> {
    const r = this.raw(id)
    const gauge = JSON.parse(r.gauge_json) as (GaugeResult & { cost: CostPerMinute | null }) | null
    if (!gauge || gauge.cost) return
    const check = checkPipeline(r.proposed_pipeline_json)
    if (!check.ok || !check.plan) return
    const report = await costReport(check.plan)
    const cost: CostPerMinute = {
      minutes: report.minutes,
      modes: {
        qualite_max: { credits: report.modes.qualite_max.credits, perMinute: report.modes.qualite_max.perMinute },
        usage_max: { credits: report.modes.usage_max.credits, perMinute: report.modes.usage_max.perMinute }
      }
    }
    // only if nothing changed meanwhile
    this.db.prepare('UPDATE analysis_runs SET gauge_json = ? WHERE id = ? AND gauge_json = ?').run(JSON.stringify({ ...gauge, cost }), id, r.gauge_json)
  }

  private styleFrom(draft: StyleSheet, mode: GaugeMode, adjust: AdjustState, minutes: number): StyleSheet {
    return {
      ...draft,
      script: { ...draft.script, lengthMin: minutes, ...(adjust.scriptTone ? { tone: adjust.scriptTone } : {}) },
      budget: { mode, capCredits: adjust.maxCreditsPerVideo ?? draft.budget.capCredits }
    }
  }

  setCreatedPipeline(id: number, pipelineId: number): void {
    this.db.prepare('UPDATE analysis_runs SET created_pipeline_id = ?, updated_at = ? WHERE id = ?').run(pipelineId, nowIso(), id)
  }

  /** What « Créer le pipeline » needs. */
  forCreation(id: number): { ref: ReferenceChannel; pipelineJson: string; style: StyleSheet } {
    const r = this.raw(id)
    if (r.status !== 'done') throw new Error('Choisis d’abord une vidéo d’exemple : l’analyse n’est pas terminée.')
    return { ref: this.ref(r), pipelineJson: r.proposed_pipeline_json, style: JSON.parse(r.style_draft_json) as StyleSheet }
  }

  addMessage(id: number, author: 'user' | 'analyst', body: string, applied: Adjust | null = null): void {
    this.raw(id)
    this.db
      .prepare('INSERT INTO analysis_messages (analysis_id, author, body, applied_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, author, body, applied ? JSON.stringify(applied) : null, nowIso())
  }

  messages(id: number): AnalysisMessage[] {
    const rows = this.db
      .prepare('SELECT id, author, body, applied_json, created_at FROM analysis_messages WHERE analysis_id = ? ORDER BY id')
      .all(id) as { id: number; author: 'user' | 'analyst'; body: string; applied_json: string | null; created_at: string }[]
    return rows.map((m) => ({ id: m.id, author: m.author, body: m.body, applied: m.applied_json ? (JSON.parse(m.applied_json) as Adjust) : null, createdAt: m.created_at }))
  }

  detail(id: number): AnalysisDetail {
    const r = this.raw(id)
    const ref = this.ref(r)
    const chosen = JSON.parse(r.chosen_examples_json) as string[]
    const gaugeRow = JSON.parse(r.gauge_json) as (GaugeResult & { cost: CostPerMinute | null }) | null
    const profile = JSON.parse(r.profile_json) as FormatProfile | null
    let gauge: GaugeResult | null = null
    let cost: CostPerMinute | null = null
    if (gaugeRow) {
      const { cost: c, ...g } = gaugeRow
      gauge = g
      cost = c
    }
    return {
      ...this.summary(r),
      mode: r.mode,
      reference: {
        id: ref.id,
        name: ref.name,
        niche: ref.niche,
        format: ref.format,
        subscribers: ref.subscribers,
        uploadsPerWeek: ref.uploadsPerWeek,
        recentVideos: ref.recentVideos,
        proposedExamples: [...ref.proposedExamples]
      },
      chosenExamples: chosen,
      examples: chosen.flatMap((vid) => {
        const video = ref.recentVideos.find((v) => v.id === vid)
        return video ? [{ video, segments: timelineFor(ref, vid) }] : []
      }),
      steps: JSON.parse(r.steps_json) as AnalysisStep[],
      profile,
      scriptCard: profile ? ref.scriptCard : null,
      styleDraft: JSON.parse(r.style_draft_json) as StyleSheet | null,
      questions: [...ref.questions],
      answers: JSON.parse(r.answers_json) as Partial<Record<InputId, boolean>>,
      replace: JSON.parse(r.replace_json) as Partial<Record<ComponentId, ComponentId>>,
      adjust: JSON.parse(r.adjust_json) as AdjustState,
      gauge,
      cost,
      proposedPipelineJson: r.status === 'done' ? r.proposed_pipeline_json : null,
      createdPipelineId: r.created_pipeline_id,
      messages: this.messages(id)
    }
  }

  delete(id: number): void {
    this.raw(id)
    this.db.prepare('DELETE FROM analysis_runs WHERE id = ?').run(id)
  }
}
