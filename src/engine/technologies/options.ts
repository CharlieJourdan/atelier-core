// Options of a pipeline (decision 0022, docs/specs/production-model.md §6.3): named switches, choices or sliders a base
// pipeline declares, each value carrying its effects as edit operations (edit-ops.ts). The document stores only the
// chosen values (`options`); the compiler turns them into operations and applies them in « option » mode before
// compiling (0016 unchanged otherwise). Quality lives here, per subject, never in one global switch (R6.5). An option, or
// one of its choices, whose bricks do not exist yet is declared with `soon` (the chantier that brings it): it is shown,
// and only its default can be chosen. Pure: no I/O.
import { EditOpSchema, type EditOp } from './edit-ops'
import type { OptionValue, RecipeDoc } from './recipe'

/** What an option is about (the editor groups them; quality is per subject, R6.5). */
export const OPTION_SUBJECTS = ['editing', 'script', 'presenter', 'images', 'clips', 'sound', 'sponsor'] as const
export type OptionSubject = (typeof OPTION_SUBJECTS)[number]

export interface OptionChoice {
  value: string | boolean
  /** Key of its French label (`src/shared/fr-p-recipes.ts`). */
  labelKey: string
  effects: readonly EditOp[]
  /** Not built yet: the chantier that brings it (`production-9`). */
  soon?: string
}

interface OptionBase {
  /** `editing`, `quality.images`… (the key in the document's `options`). */
  id: string
  labelKey: string
  subject: OptionSubject
  /** The whole option is not built yet: the chantier that brings it. */
  soon?: string
}

export interface ChoiceOption extends OptionBase {
  kind: 'switch' | 'choice'
  choices: readonly OptionChoice[]
  default: string | boolean
}

/** A number between `min` and `max`; its effects use `$value` for the chosen number (`setMix` of one kind). */
export interface SliderOption extends OptionBase {
  kind: 'slider'
  min: number
  max: number
  step: number
  default: number
  effects: readonly EditOp[]
}

export type OptionDecl = ChoiceOption | SliderOption

/** The problems of a set of declarations (the base pipelines' test runs it): ids, defaults, choices, effects. */
export function checkDeclarations(decls: readonly OptionDecl[]): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const d of decls) {
    if (ids.has(d.id)) problems.push(`option ${d.id} is declared twice`)
    ids.add(d.id)
    const effects = d.kind === 'slider' ? [d.effects] : d.choices.map((c) => c.effects)
    for (const list of effects) for (const e of list) if (!EditOpSchema.safeParse(e).success) problems.push(`option ${d.id}: an effect is not an edit operation`)
    if (d.kind === 'slider') {
      if (!(d.min <= d.default && d.default <= d.max && d.step > 0)) problems.push(`option ${d.id}: the default is outside the slider`)
    } else {
      const values = d.choices.map((c) => c.value)
      if (new Set(values).size !== values.length) problems.push(`option ${d.id}: two choices share a value`)
      const def = d.choices.find((c) => c.value === d.default)
      if (!def) problems.push(`option ${d.id}: the default is not one of its choices`)
      else if (def.soon) problems.push(`option ${d.id}: the default cannot be « soon »`)
      if (d.kind === 'switch' && !(values.length === 2 && values.includes(true) && values.includes(false))) problems.push(`option ${d.id}: a switch is true / false`)
    }
  }
  return problems
}

/** Why `value` cannot be chosen for the option `id` (null: it can). */
export function optionProblem(decls: readonly OptionDecl[], id: string, value: unknown): string | null {
  const d = decls.find((x) => x.id === id)
  if (!d) return `no option « ${id} » in this pipeline`
  if (d.kind === 'slider') {
    if (typeof value !== 'number' || !(value >= d.min && value <= d.max)) return `${id} is a number from ${d.min} to ${d.max}`
    if (d.soon && value !== d.default) return `${id} is not built yet (${d.soon})`
    return null
  }
  const choice = d.choices.find((c) => c.value === value)
  if (!choice) return `${id} is one of ${d.choices.map((c) => JSON.stringify(c.value)).join(', ')}`
  const soon = d.soon ?? choice.soon
  if (soon && value !== d.default) return `${id} = ${JSON.stringify(value)} is not built yet (${soon})`
  return null
}

/** The value each option takes in a document (its own, else the default). */
/** A slider's value kept within its declaration (rounded to its step); other options' values as they are. */
export function withinSlider(decls: readonly OptionDecl[], id: string, value: number): number {
  const d = decls.find((x) => x.id === id)
  if (!d || d.kind !== 'slider') return value
  const v = Math.min(d.max, Math.max(d.min, value))
  return Math.round(v / d.step) * d.step
}

export function optionValues(doc: Pick<RecipeDoc, 'options'>, decls: readonly OptionDecl[]): Record<string, OptionValue> {
  return Object.fromEntries(decls.map((d) => [d.id, doc.options[d.id] ?? d.default]))
}

/**
 * The operations the chosen options stand for, in declaration order, or the problems (an unknown option, a value that is
 * not a choice, a « soon » value). A slider's operations carry its value for `$value`.
 */
export function optionOps(
  doc: Pick<RecipeDoc, 'options'>,
  decls: readonly OptionDecl[]
): { ok: true; batches: { option: string; ops: readonly EditOp[]; value?: number }[] } | { ok: false; errors: { option: string; message: string }[] } {
  const errors: { option: string; message: string }[] = []
  for (const id of Object.keys(doc.options)) if (!decls.some((d) => d.id === id)) errors.push({ option: id, message: `no option « ${id} » in this pipeline` })
  const batches: { option: string; ops: readonly EditOp[]; value?: number }[] = []
  const values = optionValues(doc, decls)
  for (const d of decls) {
    const value = values[d.id]
    const problem = optionProblem(decls, d.id, value)
    if (problem) {
      errors.push({ option: d.id, message: problem })
      continue
    }
    if (d.kind === 'slider') {
      batches.push({ option: d.id, ops: d.effects, value: value as number })
      continue
    }
    const effects = d.choices.find((c) => c.value === value)?.effects ?? []
    // at its default and not chosen, an option adds or removes no brick: the bricks of the document stay as they are
    // (a brick removed by hand under « Avancé » is not put back)
    const chosen = doc.options[d.id] !== undefined
    batches.push({ option: d.id, ops: chosen ? effects : effects.filter((e) => e.op !== 'addBrick' && e.op !== 'removeBrick') })
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, batches }
}
