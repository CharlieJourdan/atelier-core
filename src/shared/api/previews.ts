// IPC contract, module "previews" (production-15): the saved previews per technology, shown free (src/shared/previews.ts).
// Every method added here must also be listed in PREVIEWS_METHODS (tests/unit/ipc.test.ts compares the list with main).
import type { PreviewItem } from '../previews'
import type { RecipeDocument } from '../recipes'
import type { RunFile } from '../runs'

export type * from '../previews'

export interface PreviewsContract {
  /** The saved previews of what a pipeline uses and can switch to (its pictures, clips, presenter; engines and styles). */
  'previews.forDoc': { args: [doc: RecipeDocument]; result: PreviewItem[] }
  /** One file of a preview. */
  'previews.file': { args: [key: string, ref: string]; result: RunFile }
  /** The before / after previews of the options a user may pick (pipeline-ui, `resources/option-previews`). */
  'previews.options': { args: []; result: PreviewItem[] }
}

export const PREVIEWS_METHODS = ['previews.forDoc', 'previews.file', 'previews.options'] as const satisfies readonly (keyof PreviewsContract)[]
