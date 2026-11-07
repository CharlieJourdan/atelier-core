// Edit operations on a pipeline (decision 0024, docs/specs/production-model.md §10.2): the closed set of typed changes the
// UI, the chat and the agents apply to an `atelier.recette/2` document. Never a free-text rewrite: each operation is
// validated (zod, then against the registry), and a batch either applies whole or returns typed errors. Options
// (options.ts) are named batches of the same operations, applied by the compiler in « option » mode, where the document's
// explicit choices win (a brick whose engine or fallbacks the document sets keeps that pin whole; a style or a setting
// already set is kept) and adding a brick that is there, or removing one that is not, does nothing. Pure: no I/O.
import { z } from 'zod'
import { STYLE_REF } from '../../shared/brick-styles'
import { ENGINE_ID, engineFamilyOf } from '../../shared/cloud-engines'
import { CHECKPOINTS, CheckpointsSchema, InputSourceSchema, OptionValueSchema, RecipeSchema, TECH_ID, type Checkpoint, type RecipeBrick, type RecipeDoc } from './recipe'
import { CurveSchema, MIX_KINDS, MixSchema, setShare, type Mix, type MixKind } from './mix'
import type { TechnologyRegistry } from './registry'
import { STAGES, techName } from './types'

/** A brick is named by its technology's name, without the version (a recipe uses a technology once). */
const brick = z.string().regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
/** In an option's effects, `$value` stands for the option's value (a slider). */
const VALUE = z.literal('$value')

export const EditOpSchema = z.discriminatedUnion('op', [
  // one kind's share (the others rescale), or the whole mix (null: back to the director's and the profile's choice)
  z
    .strictObject({ op: z.literal('setMix'), kind: z.enum(MIX_KINDS).optional(), share: z.union([z.number().min(0).max(1), VALUE]).optional(), mix: MixSchema.nullable().optional() })
    .refine((o) => (o.mix !== undefined) !== (o.kind !== undefined && o.share !== undefined), 'setMix takes either a kind and its share, or a whole mix'),
  z.strictObject({ op: z.literal('setCurve'), curve: CurveSchema }),
  z.strictObject({ op: z.literal('setOption'), option: z.string().min(1).max(60), value: OptionValueSchema }),
  z.strictObject({ op: z.literal('setEngine'), brick, engine: z.string().regex(ENGINE_ID).nullable() }),
  z.strictObject({ op: z.literal('setFallbacks'), brick, fallbacks: z.array(z.string().regex(ENGINE_ID)).max(6) }),
  z.strictObject({ op: z.literal('setStyle'), brick, style: z.string().regex(STYLE_REF).nullable() }),
  z.strictObject({ op: z.literal('addBrick'), tech: z.string().regex(TECH_ID), after: brick.nullable().optional(), settings: z.record(z.string(), z.unknown()).optional() }),
  z.strictObject({ op: z.literal('removeBrick'), brick }),
  z.strictObject({ op: z.literal('moveBrick'), brick, after: brick.nullable() }),
  z.strictObject({ op: z.literal('setSetting'), brick, key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), value: z.unknown() }),
  // one gate on or off (the pipeline must have its own list), or the whole list (null: back to the channel's)
  z
    .strictObject({ op: z.literal('setGate'), checkpoint: z.enum(CHECKPOINTS).optional(), on: z.boolean().optional(), checkpoints: CheckpointsSchema.nullable().optional() })
    .refine((o) => (o.checkpoints !== undefined) !== (o.checkpoint !== undefined && o.on !== undefined), 'setGate takes either a checkpoint and on, or a whole list'),
  z.strictObject({ op: z.literal('setInput'), input: z.string().regex(/^[a-z][A-Za-z0-9_]{0,39}$/), source: InputSourceSchema.nullable() }),
  z.strictObject({ op: z.literal('setCap'), capCredits: z.number().int().min(0).max(1_000_000).nullable() }),
  z.strictObject({ op: z.literal('rename'), name: z.string().trim().min(1).max(120) })
])
export type EditOp = z.infer<typeof EditOpSchema>
export type EditOpName = EditOp['op']

export type EditIssueCode = 'bad_op' | 'unknown_brick' | 'unknown_technology' | 'already_there' | 'engine_family' | 'no_engine' | 'no_style' | 'no_mix' | 'bad_option' | 'schema'

export interface EditIssue {
  code: EditIssueCode
  /** The index of the operation in the batch (-1: the resulting document). */
  op: number
  message: string
}

export type EditResult = { ok: true; doc: RecipeDoc } | { ok: false; errors: EditIssue[] }

export interface ApplyOptions {
  /** `option`: the compiler applying an option's effects (explicit choices win, add / remove are idempotent). */
  mode?: 'edit' | 'option'
  /** The value `$value` stands for (a slider option). */
  value?: number
  /** Checks a `setOption` (the base pipeline's declarations, options.ts); absent: `setOption` is refused. */
  checkOption?: (option: string, value: unknown) => string | null
}

const indexOf = (doc: RecipeDoc, name: string): number => doc.bricks.findIndex((b) => techName(b.tech) === name)

/**
 * Applies a batch of operations to a copy of `doc`. Every operation is checked in turn; the first problem of each is
 * reported and the batch fails as a whole (the document is never half changed). The result is parsed again with the
 * `atelier.recette/2` schema; registry checks of the whole pipeline (slots, settings, stage order) are `checkRecipe`'s.
 */
export function applyOps(doc: RecipeDoc, ops: readonly unknown[], reg: TechnologyRegistry, o: ApplyOptions = {}): EditResult {
  const option = o.mode === 'option'
  const errors: EditIssue[] = []
  const next: RecipeDoc = structuredClone(doc)
  const fail = (op: number, code: EditIssueCode, message: string): void => void errors.push({ op, code, message })
  /** The bricks whose engine or fallbacks the document itself sets (an option leaves that pin alone). */
  const pinned = new Set(doc.bricks.filter((b) => b.engine !== null || b.fallbacks.length > 0).map((b) => techName(b.tech)))
  const at = (i: number, name: string): RecipeBrick | null => {
    const k = indexOf(next, name)
    if (k < 0 && !option) fail(i, 'unknown_brick', `no brick « ${name} » in this pipeline`)
    return k < 0 ? null : (next.bricks[k] as RecipeBrick)
  }
  const familyOf = (i: number, b: RecipeBrick, kind: 'engine' | 'style'): string | null => {
    const t = reg.get(b.tech)
    const family = kind === 'engine' ? t?.engineFamily : t?.styleFamily
    if (!family) fail(i, kind === 'engine' ? 'no_engine' : 'no_style', `${b.tech} has no ${kind} to choose`)
    return family ?? null
  }

  ops.forEach((raw, i) => {
    const parsed = EditOpSchema.safeParse(raw)
    if (!parsed.success) return fail(i, 'bad_op', parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; '))
    const op = parsed.data
    switch (op.op) {
      case 'setMix': {
        if (op.mix !== undefined) {
          next.mix = op.mix
          return
        }
        const share = op.share === '$value' ? o.value : op.share
        if (typeof share !== 'number' || !(share >= 0 && share <= 1)) return fail(i, 'bad_op', 'a share is a number from 0 to 1')
        const base: Mix = next.mix ?? { curve: 'flat' }
        next.mix = setShare(base, op.kind as MixKind, share)
        return
      }
      case 'setCurve':
        if (!next.mix) return fail(i, 'no_mix', 'set the mix before its curve')
        next.mix = { ...next.mix, curve: op.curve }
        return
      case 'setOption': {
        const problem = o.checkOption ? o.checkOption(op.option, op.value) : 'this pipeline declares no options'
        if (problem) return fail(i, 'bad_option', problem)
        next.options = { ...next.options, [op.option]: op.value }
        return
      }
      case 'setEngine':
      case 'setFallbacks': {
        const b = at(i, op.brick)
        if (!b) return
        const family = familyOf(i, b, 'engine')
        if (!family) return
        const ids = op.op === 'setEngine' ? (op.engine === null ? [] : [op.engine]) : op.fallbacks
        const wrong = ids.find((id) => engineFamilyOf(id) !== family)
        if (wrong) return fail(i, 'engine_family', `${wrong} is not a ${family} engine (${b.tech})`)
        // in option mode the engine and its fallbacks are one pin: a document that sets either keeps both as they are
        if (option && pinned.has(op.brick)) return
        if (op.op === 'setEngine') b.engine = op.engine
        else b.fallbacks = [...op.fallbacks]
        return
      }
      case 'setStyle': {
        const b = at(i, op.brick)
        if (!b || !familyOf(i, b, 'style')) return
        if (!option || b.style === null) b.style = op.style
        return
      }
      case 'addBrick': {
        const t = reg.get(op.tech)
        if (!t) return fail(i, 'unknown_technology', `no technology « ${op.tech} »`)
        const name = techName(op.tech)
        if (indexOf(next, name) >= 0) return option ? undefined : fail(i, 'already_there', `« ${name} » is already in this pipeline`)
        const entry: RecipeBrick = { tech: op.tech, settings: { ...(op.settings ?? {}) }, engine: null, fallbacks: [], style: null }
        let k: number
        if (op.after === null) k = 0
        else if (op.after !== undefined) {
          const after = indexOf(next, op.after)
          if (after < 0) return fail(i, 'unknown_brick', `no brick « ${op.after} » to add after`)
          k = after + 1
        } else {
          // at the end of its stage, but before the first brick of that stage that reads what it provides (the writer goes
          // before the sponsor mentions, a translation stays after the script it translates)
          const stage = STAGES.indexOf(t.stage)
          k = next.bricks.filter((x) => STAGES.indexOf(reg.get(x.tech)?.stage ?? 'controle') <= stage).length
          const slots = Object.keys(t.provides)
          const reader = next.bricks.findIndex((x) => {
            const xt = reg.get(x.tech)
            return xt?.stage === t.stage && xt.nodes.some((n) => Object.values(n.in).some((ref) => slots.includes(ref.replace(/^@|\?$/g, ''))))
          })
          if (reader >= 0 && reader < k) k = reader
        }
        next.bricks.splice(k, 0, entry)
        return
      }
      case 'removeBrick': {
        const k = indexOf(next, op.brick)
        if (k < 0) return option ? undefined : fail(i, 'unknown_brick', `no brick « ${op.brick} » in this pipeline`)
        next.bricks.splice(k, 1)
        return
      }
      case 'moveBrick': {
        const k = indexOf(next, op.brick)
        if (k < 0) return fail(i, 'unknown_brick', `no brick « ${op.brick} » in this pipeline`)
        const [moved] = next.bricks.splice(k, 1) as [RecipeBrick]
        const after = op.after === null ? -1 : indexOf(next, op.after)
        if (op.after !== null && after < 0) return fail(i, 'unknown_brick', `no brick « ${op.after} » to move after`)
        next.bricks.splice(after + 1, 0, moved)
        return
      }
      case 'setSetting': {
        const b = at(i, op.brick)
        if (!b) return
        if (option && op.key in b.settings) return
        // a slider's effect sets the brick to the slider's value
        const value = op.value === '$value' ? o.value : op.value
        if (value === null || value === undefined) delete b.settings[op.key]
        else b.settings[op.key] = value
        return
      }
      case 'setGate': {
        if (op.checkpoints !== undefined) {
          next.checkpoints = op.checkpoints === null ? null : CHECKPOINTS.filter((c) => op.checkpoints?.includes(c))
          return
        }
        // starting from the defaults would silently drop the channel's own gates: give the whole list first
        if (next.checkpoints === null) return fail(i, 'bad_op', 'this pipeline uses the channel’s checkpoints: set its own list (setGate with checkpoints) first')
        const set = new Set(next.checkpoints)
        if (op.on) set.add(op.checkpoint as Checkpoint)
        else set.delete(op.checkpoint as Checkpoint)
        next.checkpoints = CheckpointsSchema.parse(CHECKPOINTS.filter((c) => set.has(c)))
        return
      }
      case 'setInput': {
        const inputs = { ...next.inputs }
        if (op.source === null) delete inputs[op.input]
        else inputs[op.input] = op.source
        next.inputs = inputs
        return
      }
      case 'setCap':
        next.capCredits = op.capCredits
        return
      case 'rename':
        next.name = op.name
        return
    }
  })
  if (errors.length > 0) return { ok: false, errors }
  const checked = RecipeSchema.safeParse(next)
  if (!checked.success) return { ok: false, errors: checked.error.issues.map((x) => ({ op: -1, code: 'schema' as const, message: `${x.path.join('.')} ${x.message}` })) }
  return { ok: true, doc: checked.data }
}
