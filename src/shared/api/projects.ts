// IPC contract, module "projects" (decision 0011): a project is ONE video made from a pinned recipe version, for a
// channel or none, with its idea, inputs and per-video adjustments; launching it compiles the recipe (technology <
// recipe < channel < project) and starts a run of our engine. Types: `src/shared/recipes.ts`. Every method added here
// must also be listed in PROJECTS_METHODS. Change topic: 'production' after every write. Errors are in French.
import type { ProjectCreateInput, ProjectDetail, ProjectSummary, ProjectUpdateInput, RecipeCompiled } from '../recipes'
import type { RunQuote } from '../runs'

/** How a project is launched or quoted: `real` = « Moteur réel » (production-16), the owner's click; absent: a demo run. */
export interface ProjectRunOptions {
  real?: boolean
}

export interface ProjectsContract {
  /** Projects, newest first (of one channel when asked). */
  'projects.list': { args: [filter?: { channelId?: number }]; result: ProjectSummary[] }
  'projects.get': { args: [id: number]; result: ProjectDetail }
  /** Creates a project on a recipe version (the latest unless one is named), pinned from then on. */
  'projects.create': { args: [input: ProjectCreateInput]; result: ProjectDetail }
  /** Changes a project not launched yet. */
  'projects.update': { args: [id: number, input: ProjectUpdateInput]; result: ProjectDetail }
  /** What the project would run: the compiled nodes and gates, or the errors. */
  'projects.compile': { args: [id: number]; result: RecipeCompiled }
  /** Launches it: compiles, then starts a run of the engine (a project needs a channel to run). */
  'projects.run': { args: [id: number, options?: ProjectRunOptions]; result: ProjectDetail }
  /** What launching it would cost, before anything is spent (`real`: Atelier Cloud's prices and wallet). */
  'projects.quote': { args: [id: number, options?: ProjectRunOptions]; result: RunQuote }
  /** « J'ai mon script »: the text of a dropped .txt or .docx file (base64), for a project's `script` input. */
  'projects.readScript': { args: [file: { name: string; base64: string }]; result: { text: string; words: number } }
}

export const PROJECTS_METHODS = [
  'projects.list',
  'projects.get',
  'projects.create',
  'projects.update',
  'projects.compile',
  'projects.run',
  'projects.quote',
  'projects.readScript'
] as const satisfies readonly (keyof ProjectsContract)[]
