// The published blueprint as the app sees it (the founder's « Blueprints », served by Atelier Cloud at GET /v1/blueprint):
// plain data shared by the main process (which fetches, caches and applies it) and the renderer (which shows it). Also the
// one place that decides a drawing kind for a step the founder did not give one (a label heuristic, with a warning).
import type { DrawingKind, DrawingRunner } from './pipeline-drawing'

export type BlueprintTier = 'fast' | 'balanced' | 'deep'

/** One agent of the blueprint, with the runtime role it maps onto (null = not a role the runtime has: « recrutable »). */
export interface BlueprintAgentView {
  id: string
  role: string
  tier: BlueprintTier
  routines: string[]
  instructions: string
  /** The runtime role it feeds (`principal`, `researcher`…); null for a template to recruit. */
  runtimeRole: string | null
}

export interface BlueprintStepView {
  id: string
  kind: DrawingKind
  label: string
  runner: DrawingRunner
  gate: boolean
  provider: string
  credits: number
  /** `guessed`: the blueprint gave no kind, it was deduced from the label. */
  kindSource: 'blueprint' | 'guessed'
}

export interface BlueprintPipelineView {
  id: string
  name: string
  credits: number
  steps: BlueprintStepView[]
}

/**
 * `not-connected`: the app has no Cloud session (built-in defaults); `none`: connected but nothing published yet (404);
 * `ok`: a version is known (fresh, or the cached one when the Cloud could not be reached: `stale`).
 */
export interface BlueprintStatus {
  state: 'not-connected' | 'none' | 'ok'
  version: number | null
  publishedAt: string | null
  fetchedAt: string | null
  stale: boolean
  /** Agents that feed a runtime role. */
  agents: BlueprintAgentView[]
  /** Agents the runtime has no role for: optional templates to recruit. */
  recruitable: BlueprintAgentView[]
  pipelines: BlueprintPipelineView[]
}

export const NO_BLUEPRINT: BlueprintStatus = {
  state: 'not-connected',
  version: null,
  publishedAt: null,
  fetchedAt: null,
  stale: false,
  agents: [],
  recruitable: [],
  pipelines: []
}

/** What « Appliquer la version N » would change on one existing agent. */
export interface BlueprintAgentChange {
  agentId: number
  slug: string
  name: string
  role: string
  blueprintId: string
  instructions?: { from: string; to: string }
  /** Model tier of the runtime (`best` = the blueprint's deep). */
  tier?: { from: string | null; to: string }
  /** Scheduled routines that would be added (their French names). */
  routines?: string[]
  /** The user changed this agent after the last blueprint (or seed): it is only changed when the user picks it. */
  handEdited: boolean
}

export interface BlueprintPlan {
  version: number | null
  /** Agents whose settings differ from the published version; empty when everything is up to date. */
  changes: BlueprintAgentChange[]
  /** The version the user last applied (or that a new agent was seeded from); null if none. */
  appliedVersion: number | null
}

export interface BlueprintApplyResult {
  version: number
  /** Agents changed. */
  applied: number
  /** Ids asked for that were not in the plan (already up to date, or gone). */
  skipped: number
}

/* ---------- drawing kind of a step ---------- */

const KIND_RULES: readonly (readonly [RegExp, DrawingKind])[] = [
  [/miniature|thumbnail/i, 'thumbnail'],
  [/sous-?titre|caption/i, 'captions'],
  [/qualit|contr[oô]le|\bqc\b|relecture/i, 'qc'],
  [/montage|rendu|assemblage/i, 'edit'],
  [/r[ée]alisation|d[ée]coupage|storyboard/i, 'director'],
  [/script|sc[ée]nario|dialogue|r[ée]daction/i, 'script'],
  [/sujet|id[ée]e|histoire|angle/i, 'idea'],
  [/avatar|pr[ée]sentateur/i, 'avatar'],
  [/archive|b-?roll|stock/i, 'stock'],
  [/vid[ée]o ia|g[ée]n[ée]ration vid[ée]o/i, 'video-gen'],
  [/image|illustration|visuel/i, 'image-gen'],
  [/anim|motion|compte [àa] rebours/i, 'motion'],
  [/voix|narration|voice/i, 'voice'],
  [/musique|ambiance sonore|\bson\b/i, 'music'],
  [/gameplay/i, 'gameplay'],
  [/carte/i, 'card'],
  [/traduction|adaptation|translate/i, 'translate'],
  [/publi|planning|programm/i, 'publish'],
  [/valid|fournir|d[ée]pose|import/i, 'human-input']
]

/** The kind a step gets when the blueprint gives none: the first rule matching its label, else a generic code step. */
export function guessDrawingKind(label: string): { kind: DrawingKind; matched: boolean } {
  for (const [re, kind] of KIND_RULES) if (re.test(label)) return { kind, matched: true }
  return { kind: 'code', matched: false }
}
