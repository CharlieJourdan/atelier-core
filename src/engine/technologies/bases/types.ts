// A base pipeline (decision 0022, docs/specs/production-model.md §6.6): a pipeline document shipped with the app, tied to
// no channel (`base: null`), with the options it declares. Used as it is (a copy saved with `base` = its id) or copied and
// customised. A base ships only when it runs end to end (0011).
import type { OptionDecl } from '../options'
import type { RecipeDoc } from '../recipe'
import type { ReferenceProfile } from '../reference-profile'

export interface BasePipeline {
  /** `avatar@1`: a new version of a base is registered beside the old one, like a technology. */
  id: `${string}@${number}`
  /** Key of its French label (`src/shared/fr-p-recipes.ts`); `<key>.blurb` is its one-line description. */
  labelKey: string
  doc: RecipeDoc
  options: readonly OptionDecl[]
  /** Its « profil mesuré »: what its reference videos measure, its settings' source (record 0055). */
  profile?: ReferenceProfile
}
