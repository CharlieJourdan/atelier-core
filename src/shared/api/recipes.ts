// IPC contract, module "recipes" (decisions 0010, 0011, 0022, 0024): the technologies of the code registry, the base
// pipelines, the team's recipes (« pipelines » in the UI; versions are immutable: a save or an edit is a new version), a channel's production settings (per-technology settings,
// checkpoints, the recipe per video type) and the `.atelier-recette.json` export / import. Types: `src/shared/recipes.ts`.
// Every method added here must also be listed in RECIPES_METHODS (tests/unit/ipc.test.ts compares the list with main).
// Change topic: 'production' after every write. Errors are thrown with a French message.
import type {
  BasePipelineInfo,
  ChannelProductionInput,
  ChannelProductionView,
  RecipeCompiled,
  RecipeDetail,
  RecipeDocument,
  RecipeIssueView,
  RecipeOverrideView,
  RecipeMix,
  RecipeSaveInput,
  RecipeSummary,
  RecipeVideoType,
  TechnologyInfo
} from '../recipes'

export type * from '../recipes'

export interface RecipesContract {
  /** Every technology of the code registry, in stage order (the panel; read-only: technologies are code, 0010). */
  'technologies.list': { args: []; result: TechnologyInfo[] }
  /** The base pipelines (« pipelines de base ») with their options, tied to no channel. */
  'recipes.bases': { args: []; result: BasePipelineInfo[] }
  /** A new pipeline of the team from a base pipeline, its options at their defaults. */
  'recipes.fromBase': { args: [baseId: string, name?: string]; result: RecipeDetail }
  /** « Traduire »: the same pipeline in another language, as a new pipeline of the team. */
  'recipes.translate': { args: [id: number, language: string]; result: RecipeDetail }
  /**
   * Applies a batch of edit operations (decision 0024: setMix, setCurve, setOption, setEngine, setFallbacks, setStyle,
   * addBrick, removeBrick, moveBrick, setSetting, setGate, setInput, setCap, rename) to the latest version and saves a new
   * one; refused whole, with the problems, when one fails. The same path serves the editor and the agents.
   */
  'recipes.edit': { args: [id: number, ops: Record<string, unknown>[], note?: string]; result: RecipeDetail }
  /** The team's recipes, newest first (archived ones last). */
  'recipes.list': { args: []; result: RecipeSummary[] }
  /** One recipe, at its latest version or the one asked for. */
  'recipes.get': { args: [id: number, version?: number]; result: RecipeDetail }
  /** Checks a document against the registry without saving it (the editor's live check). */
  'recipes.check': { args: [doc: RecipeDocument]; result: { ok: boolean; errors: RecipeIssueView[]; mix?: RecipeMix | null; overrides?: RecipeOverrideView[] } }
  /** Saves a new recipe, or a new version of one; refused when it does not compile. */
  'recipes.save': { args: [input: RecipeSaveInput]; result: RecipeDetail }
  /** Archives (true) or restores (false) a recipe; projects keep their pinned version. */
  'recipes.archive': { args: [id: number, archived: boolean]; result: RecipeSummary }
  /** What the recipe would run for a channel (or with no channel): the nodes, their gates, or the errors. */
  'recipes.compile': { args: [id: number, channelId?: number | null]; result: RecipeCompiled }
  /** The recipe as one `.atelier-recette.json` file (name and text). */
  'recipes.export': { args: [id: number, version?: number]; result: { fileName: string; json: string } }
  /** A new recipe from a `.atelier-recette.json` text; an invalid file is refused with its problems. */
  'recipes.import': { args: [json: string]; result: RecipeDetail }
  /**
   * The pipeline code of a version (`7K2Q-9XPM`) and the text that shares it (production-lab). Refused while pipeline codes
   * are off (the beta: `ATELIER_PIPELINE_CODES=1` turns them on).
   */
  'recipes.share': { args: [id: number, version?: number]; result: { code: string; text: string } }
  /** A new pipeline from a shared code, checked then validated like any save; refused while pipeline codes are off. */
  'recipes.fromCode': { args: [text: string]; result: RecipeDetail }
  /** A channel's production settings. */
  'recipes.channel': { args: [channelId: number]; result: ChannelProductionView }
  /** Sets a channel's per-technology settings and / or its checkpoints. */
  'recipes.setChannel': { args: [channelId: number, input: ChannelProductionInput]; result: ChannelProductionView }
  /** The recipe a channel uses for a video type (null: none). */
  'recipes.useForChannel': { args: [channelId: number, videoType: RecipeVideoType, recipeId: number | null]; result: ChannelProductionView }
}

export const RECIPES_METHODS = [
  'technologies.list',
  'recipes.bases',
  'recipes.fromBase',
  'recipes.translate',
  'recipes.edit',
  'recipes.list',
  'recipes.get',
  'recipes.check',
  'recipes.save',
  'recipes.archive',
  'recipes.compile',
  'recipes.export',
  'recipes.import',
  'recipes.share',
  'recipes.fromCode',

  'recipes.channel',
  'recipes.setChannel',
  'recipes.useForChannel'
] as const satisfies readonly (keyof RecipesContract)[]
