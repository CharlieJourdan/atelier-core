// Demo fixtures, lab: the app's own base pipelines (src/engine/technologies/bases, pure data: their runtime imports are zod
// and plain modules, browser-safe). Loaded through Vite's glob so the renderer's type check does not walk the engine's
// type-only imports (registry, nodes, node:* modules); the shape the demo reads is restated here.
import type { RecipeDocument, RecipeOptionValue } from '../../../shared/recipes'

interface DemoOptionChoice {
  value: string | boolean
  labelKey: string
  soon?: string
}

/** The fields of an engine `OptionDecl` the demo reads. */
export type DemoOptionDecl = { id: string; labelKey: string; subject: string; soon?: string } & (
  | { kind: 'switch' | 'choice'; choices: readonly DemoOptionChoice[]; default: string | boolean }
  | { kind: 'slider'; min: number; max: number; step: number; default: number }
)

/** The fields of an engine `BasePipeline` the demo reads. */
export interface DemoBase {
  id: string
  labelKey: string
  doc: RecipeDocument
  options: readonly DemoOptionDecl[]
}

const mods = import.meta.glob<readonly DemoBase[]>('../../../engine/technologies/bases/index.ts', { eager: true, import: 'BASE_PIPELINES' })

export const BASES: readonly DemoBase[] = Object.values(mods)[0] ?? []

export const baseById = (id: string | null): DemoBase | undefined => (id === null ? undefined : BASES.find((b) => b.id === id))

/** The option values of a document, the base's defaults filled in. */
export function optionValues(doc: RecipeDocument): Record<string, RecipeOptionValue> {
  const out: Record<string, RecipeOptionValue> = {}
  for (const o of baseById(doc.base)?.options ?? []) out[o.id] = doc.options[o.id] ?? o.default
  return out
}
