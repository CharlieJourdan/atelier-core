// Whether a reference's style can be made by Atelier, said early and honestly (essais-utilisateur, Charlie 03/11: « dire tôt et
// honnêtement si le style est reproductible, en partie (quelles parties, quelle part) ou pas du tout, et pourquoi ; sinon proposer
// ce qu'Atelier sait faire à la place ; proposer des humains ; lister les technologies qui manquent »). Main computes it
// (style-agent/feasibility.ts); the renderer shows it first, above the proposals. In French for the owner.
import type { EstimateRange } from './estimates'

export type FeasibilityVerdictId = 'yes' | 'partial' | 'no'

/** One part of the reference's style and whether Atelier makes it. */
export interface FeasibilityPartView {
  title: string
  /** Share of the video this part takes, 0–100. */
  share: number
  can: FeasibilityVerdictId
  /** How Atelier makes it, or why not. */
  how: string
}

/** A technology Atelier lacks for this style: bring it in, build it, or train a model. */
export interface MissingTechView {
  id: string
  title: string
  kind: 'import' | 'build' | 'train'
  /** Cost and time to close the gap, in plain words. */
  cost: string
  /** The pipeline already has the slot (the owner can bring this ingredient today). */
  slot: boolean
}

/** A person the pipeline needs, and how the pipeline takes their work. */
export interface HumanStepView {
  id: string
  title: string
  how: string
}

/** What Atelier does instead when the style is out of reach (« tu envoies l'audio ou le script… »). */
export interface InsteadView {
  id: string
  title: string
  detail: string
  /** The ingredient option that does it, and the price of a minute it gives (credits). */
  option: string | null
  perMinute: EstimateRange | null
}

export interface FeasibilityView {
  verdict: FeasibilityVerdictId
  /** Share of the reference's style Atelier reproduces, 0–100. */
  share: number
  why: string
  parts: FeasibilityPartView[]
  missing: MissingTechView[]
  humans: HumanStepView[]
  instead: InsteadView[]
  /** What the eyes could not read (« les 5 premières minutes sur 47 »), null: read whole. */
  unread: string | null
  /** Who said it: the agent (checked against the code's lists), or the code alone. */
  source: 'agent' | 'code'
}
