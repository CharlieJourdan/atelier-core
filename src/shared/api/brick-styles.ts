// IPC contract, module "brickStyles" (decision 0021): the brick styles, versioned data dressing a brick family. Versions are
// immutable (a save is a new version) and a style's family never changes. Document: `src/shared/brick-styles.ts`.
// Every method added here must also be listed in BRICK_STYLES_METHODS (tests/unit/ipc.test.ts compares the list with main).
// Change topic: 'production' after every write. Errors are thrown with a French message.
import type { BrickStyleDetail, BrickStyleSummary } from '../brick-styles'

export type * from '../brick-styles'

export interface BrickStylesContract {
  /** Every style (the founder's base styles first), at its latest version. */
  'brickStyles.list': { args: []; result: BrickStyleSummary[] }
  /** One style, at its latest version or the one asked for. */
  'brickStyles.get': { args: [name: string, version?: number]; result: BrickStyleDetail }
  /** Saves a new style, or a new version of one; refused when the document is invalid or the family changes. */
  'brickStyles.save': { args: [input: { doc: unknown; note?: string }]; result: BrickStyleDetail }
  /** The style as one `.atelier-style.json` file (name and text). */
  'brickStyles.export': { args: [name: string, version?: number]; result: { fileName: string; json: string } }
  /** A style (or a new version of it) from a `.atelier-style.json` text; an invalid file is refused. */
  'brickStyles.import': { args: [json: string]; result: BrickStyleDetail }
}

export const BRICK_STYLES_METHODS = ['brickStyles.list', 'brickStyles.get', 'brickStyles.save', 'brickStyles.export', 'brickStyles.import'] as const satisfies readonly (keyof BrickStylesContract)[]
