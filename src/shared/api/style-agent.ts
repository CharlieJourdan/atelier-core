// IPC contract, module "style" (production-15): « Reproduire un style » — the eyes measure the owner's links and the agent
// proposes the closest pipelines; a sample is quoted, then made only with the owner's click on that quote; its likeness
// score and three biggest gaps; applying a gap's edit; adopting a variant as the team's pipeline. Types:
// `src/shared/style-agent.ts`.
// Every method added here must also be listed in STYLE_METHODS (tests/unit/ipc.test.ts compares the list with main).
import type { RecipeDetail } from '../recipes'
import type { StudyInput, StudySummary, StudyView } from '../style-agent'

export type * from '../style-agent'

export interface StyleContract {
  /** Measures 1 to 5 YouTube links with the eyes and proposes the closest pipelines (price per minute, likeness estimate). */
  'style.study': { args: [input: StudyInput]; result: StudyView }
  /** A study; its sample's run is read again while it runs. */
  'style.get': { args: [id: number]; result: StudyView }
  'style.list': { args: []; result: StudySummary[] }
  /** Answers to the questions the references leave open. */
  'style.answer': { args: [id: number, answers: Record<string, string>]; result: StudyView }
  /** The channel the sample is made for (it is never published). */
  'style.channel': { args: [id: number, channelId: number]; result: StudyView }
  /** The sample's narration, rewritten by the owner. */
  'style.script': { args: [id: number, script: string]; result: StudyView }
  /** « Voir un exemple »: the sample's quote, before anything is spent. */
  'style.quote': { args: [id: number, variant: string]; result: StudyView }
  /** « Lancer l'exemple »: runs the sample, only with the quote's id the owner clicked. */
  'style.sample': { args: [id: number, variant: string, quoteId: string]; result: StudyView }
  /** Applies a gap's edit to the sample's variant (Δ cost and Δ score shown before). */
  'style.applyGap': { args: [id: number, index: number]; result: StudyView }
  /** The differentiators the owner keeps (their ids; empty: none), applied to every variant. */
  'style.pick': { args: [id: number, ids: string[]]; result: StudyView }
  'style.choose': { args: [id: number, ingredient: string, option: string]; result: StudyView }
  /** « Utiliser cette pipeline »: the variant becomes the team's pipeline. */
  'style.adopt': { args: [id: number, variant: string]; result: RecipeDetail }
}

export const STYLE_METHODS = [
  'style.study',
  'style.get',
  'style.list',
  'style.answer',
  'style.channel',
  'style.script',
  'style.quote',
  'style.sample',
  'style.applyGap',
  'style.pick',
  'style.choose',
  'style.adopt'
] as const satisfies readonly (keyof StyleContract)[]
