// The style studies' rows (migration 034): one JSON state per study, rewritten whole on every change.
import type { EditOp, RecipeDoc } from '../../../engine/technologies'
import type { Range } from '../../../engine/technologies/cost'
import type { VideoMeasure } from '../../../engine/technologies/fit'
import type { VariantKindId } from '../../../shared/pipeline-agent'
import type { InspirationAxisId, StudyPath, StudyScope } from '../../../shared/style-agent'
import type { FeasibilityView } from '../../../shared/style-feasibility'
import type { Db } from '../../db'
import type { MeasuredReference } from './references'

export interface StoredQuote {
  id: string
  variant: VariantKindId
  /** The sample pipeline the quote was made for (a change of the variant makes it stale). */
  docKey: string
  credits: Range
  /** What the run holds from the wallet while it runs (its own worst-case quote); null: not known. */
  hold: number | null
  /** False on demo providers (Atelier Cloud not connected): nothing is held or debited. */
  debited: boolean
  seconds: number
  script: string
  channelId: number
}

export interface StoredSample {
  variant: VariantKindId
  runId: number
  docKey: string
  /** The variant's gap edits when the sample was made (its pipeline is the proposal plus these). */
  edits: EditOp[]
  status: 'running' | 'done' | 'failed'
  error: string | null
  measures: VideoMeasure | null
  lookFromStyle: boolean
  credits: number
}

/** One axis of « Créer de zéro avec des inspirations » (or of a mix of channels) and its reference's measures. */
export interface StoredInspiration {
  axis: InspirationAxisId
  url: string
  title: string
  measures: VideoMeasure[]
  subjects: string[]
  problem: string | null
}

export interface StudyState {
  /** The way in (absent on studies made before parcours-utilisateur: read as `clone`). */
  path?: StudyPath
  /** Extra instructions (« consignes en plus »). */
  instructions?: string
  /** « Créer de zéro » / « Mélanger » : each axis and its reference (the content axis's measures are also `refs`). */
  inspirations?: StoredInspiration[]
  /** « Retravailler » : the team's pipeline and its document when the study began. */
  rework?: { id: number; name: string; doc: RecipeDoc }
  /** The differentiators the agent matched to the owner's words (their ids). */
  suggested?: string[]
  /** The agent's question on how to differ, for this case. */
  ask?: string
  /** Whether Atelier can make the style (essais-utilisateur): the code's judgement, said better by the agent when it answered. */
  feasibility?: FeasibilityView | null
  /** A video link taken for its channel's style. */
  scope?: StudyScope
  /** The option the owner chose per ingredient (ingredients.ts ids). */
  choices?: Record<string, string>
  /** Seconds the analysis took. */
  analysisS?: number
  /** What the owner wants, in their words (may be empty when example links are given). */
  text: string
  links: string[]
  refs: MeasuredReference[]
  /** The base chosen from the words when no measured reference says it (null: the references', else avatar@1). */
  baseId: string | null
  summary: string | null
  agentNote: string | null
  script: string
  answers: Record<string, string>
  /** Gap edits the owner applied, per variant, on top of the proposal. */
  edits: Partial<Record<VariantKindId, EditOp[]>>
  channelId: number | null
  /** The source is the owner's own channel (« depuis une de tes chaînes »): an identical clone, no differentiator proposed unless asked. */
  own?: boolean
  /** The pipeline's language (translating the references' channel), absent: the channel's own. */
  language?: string
  /** The differentiators the owner picked (their ids, clonage-traduction), applied to every variant before the gap edits. */
  picks?: string[]
  quote: StoredQuote | null
  sample: StoredSample | null
  measureCredits: number
}

export interface StudyRow {
  id: number
  state: StudyState
  createdAt: string
}

export class StudyStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  create(state: StudyState): number {
    const at = this.now().toISOString()
    const r = this.db.prepare('INSERT INTO style_studies (state_json, created_at, updated_at) VALUES (?, ?, ?)').run(JSON.stringify(state), at, at)
    return Number(r.lastInsertRowid)
  }

  get(id: number): StudyRow {
    const r = this.db.prepare('SELECT id, state_json, created_at FROM style_studies WHERE id = ?').get(id) as { id: number; state_json: string; created_at: string } | undefined
    if (!r) throw new Error('Étude de style introuvable.')
    return { id: r.id, state: JSON.parse(r.state_json) as StudyState, createdAt: r.created_at }
  }

  save(id: number, state: StudyState): void {
    this.db.prepare('UPDATE style_studies SET state_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), this.now().toISOString(), id)
  }

  list(limit = 20): StudyRow[] {
    const rows = this.db.prepare('SELECT id, state_json, created_at FROM style_studies ORDER BY id DESC LIMIT ?').all(limit) as { id: number; state_json: string; created_at: string }[]
    return rows.map((r) => ({ id: r.id, state: JSON.parse(r.state_json) as StudyState, createdAt: r.created_at }))
  }
}
