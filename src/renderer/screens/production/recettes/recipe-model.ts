// Pure helpers of the pipeline editor (production-2, -3): a new pipeline built by hand, the bricks of each stage, adding / removing a brick in
// stage order, editing a setting, reading a setting field from text. No React, no I/O (unit-tested).
import { RECIPE_STAGES, type RecipeBrickEntry, type RecipeDocument, type RecipeStage, type TechField, type TechnologyInfo } from '../../../../shared/recipes'

/** A brick entry with its engine, fallbacks and style left open (the option or the defaults decide). */
export const brickEntry = (tech: string, settings: Record<string, unknown> = {}): RecipeBrickEntry => ({ tech, settings, engine: null, fallbacks: [], style: null })

/** A new recipe: the stages a video cannot do without, each with its first validated technology. */
export function newRecipe(name: string, techs: readonly TechnologyInfo[]): RecipeDocument {
  const pick = (id: string): RecipeBrickEntry[] => (techs.some((t) => t.id === id) ? [brickEntry(id)] : [])
  return {
    $schema: 'atelier.recette/2',
    name,
    base: null,
    language: null,
    mix: null,
    options: {},
    inputs: {},
    videoType: 'documentaire',
    format: { aspect: '16:9', minutes: 8 },
    capCredits: null,
    checkpoints: null,
    bricks: [
      ...pick('idea.research@1'),
      ...pick('script.write@1'),
      ...pick('voice.tts@1'),
      ...pick('director.plan@1'),
      ...pick('visuals.fulfil@1'),
      ...pick('captions.make@1'),
      ...pick('sound.music@1'),
      ...pick('render.assemble@1'),
      ...pick('thumbnail.make@1'),
      ...pick('package.youtube@1')
    ]
  }
}

export const techOf = (techs: readonly TechnologyInfo[], id: string): TechnologyInfo | undefined => techs.find((t) => t.id === id)

/** The bricks of each stage, with their index in the recipe (unknown technologies stay in their own list). */
export function bricksByStage(doc: RecipeDocument, techs: readonly TechnologyInfo[]): Record<RecipeStage, { index: number; tech: TechnologyInfo }[]> {
  const out = Object.fromEntries(RECIPE_STAGES.map((s) => [s, [] as { index: number; tech: TechnologyInfo }[]])) as Record<RecipeStage, { index: number; tech: TechnologyInfo }[]>
  doc.bricks.forEach((b, index) => {
    const tech = techOf(techs, b.tech)
    if (tech) out[tech.stage].push({ index, tech })
  })
  return out
}

/** Adds a technology at the end of its stage (the recipe stays in stage order). */
export function addBrick(doc: RecipeDocument, tech: TechnologyInfo, techs: readonly TechnologyInfo[]): RecipeDocument {
  const rank = (id: string): number => RECIPE_STAGES.indexOf(techOf(techs, id)?.stage ?? 'controle')
  const at = doc.bricks.findIndex((b) => rank(b.tech) > RECIPE_STAGES.indexOf(tech.stage))
  const bricks = [...doc.bricks]
  bricks.splice(at < 0 ? bricks.length : at, 0, brickEntry(tech.id))
  return { ...doc, bricks }
}

export function removeBrick(doc: RecipeDocument, index: number): RecipeDocument {
  return { ...doc, bricks: doc.bricks.filter((_, i) => i !== index) }
}

/** Sets one setting of a brick; `undefined` removes it (back to the technology's default or the channel style). */
export function setSetting(doc: RecipeDocument, index: number, key: string, value: unknown): RecipeDocument {
  return {
    ...doc,
    bricks: doc.bricks.map((b, i) => {
      if (i !== index) return b
      const settings = { ...b.settings }
      if (value === undefined) delete settings[key]
      else settings[key] = value
      return { ...b, settings }
    })
  }
}

/** The technologies a stage may still take (one brick per technology). */
export function addable(doc: RecipeDocument, stage: RecipeStage, techs: readonly TechnologyInfo[]): TechnologyInfo[] {
  const used = new Set(doc.bricks.map((b) => b.tech.replace(/@\d+$/, '')))
  return techs.filter((t) => t.stage === stage && !t.superseded && !used.has(t.name))
}

/** A field's value read from what the user typed ('' → unset). */
export function parseField(field: TechField, raw: string | boolean): unknown {
  if (typeof raw === 'boolean') return raw
  if (raw.trim() === '') return undefined
  switch (field.type) {
    case 'number':
    case 'integer': {
      const n = Number(raw.replace(',', '.'))
      return Number.isFinite(n) ? (field.type === 'integer' ? Math.round(n) : n) : undefined
    }
    case 'list':
      return raw
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    default:
      return raw
  }
}

/** A setting as text for its input. */
export function fieldText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.join('\n')
  return String(value)
}
