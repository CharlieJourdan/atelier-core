// P5's plan → recipe compiler (chantier moteur-pipeline, decision 0099). The bricks are chosen from what the Style Definition and the
// feasibility map say the channel is made of (never « the nearest base »); the recipe (`atelier.recette/2`) has no base, no base option,
// and every brick setting is a plan setting `<node>.<setting>` computed from the definition (plan-rules.ts SETTING_MAP). A brick
// setting the definition does not decide is left out: the brick's OWN engine default applies, never a base pipeline's styling.
import { isDeepStrictEqual } from 'node:util'
import { atPath, type Feasibility, type PipelinePlan, type PlanSetting, type StyleDefinition } from '../../../../shared/clone'
import { applyOptions, checkRecipe } from '../../../../engine/technologies/compile'
import { RECIPE_SCHEMA, type RecipeDoc } from '../../../../engine/technologies/recipe'
import { technologyRegistry, type TechnologyRegistry } from '../../../../engine/technologies/registry'
import { BASE_PIPELINES, type BasePipeline } from '../../../../engine/technologies/bases'
import { STAGES } from '../../../../engine/technologies/types'
import { definitionDefaults } from '../definition-defaults'
import { cardStyleFrom, drawnShareOf, editKitFrom, mixOf } from './values'

export interface ComposedBrick { tech: string; role: string }

export { drawnShareOf }

/** The bricks that execute this definition, in the engine's stage order. Pure. */
export function composeBricks(def: StyleDefinition): ComposedBrick[] {
  // the kinds the measured mix asks for (its distributions along the video when measured)
  const mix = mixOf(def)
  const drawn = drawnShareOf(def) >= 0.5
  const presenter = def.presenter.kind.value !== 'none' && def.presenter.mode.value !== 'none' && (mix.presenter ?? 0) > 0
  const pictures = (mix.stock ?? 0) + (mix.archive ?? 0) + (mix.imageAi ?? 0) + (mix.clipAi ?? 0) > 0
  // motion design only in the channel's measured style (no palette measured: no card in the templates' own look) or drawn scenes
  const motion = cardStyleFrom(def) !== undefined || drawn
  const transitions = editKitFrom(def) !== undefined
  const out: ComposedBrick[] = [
    { tech: 'idea.brief@1', role: 'the subject of the video' },
    { tech: 'script.write@2', role: 'the script in the channel’s measured grammar' },
    { tech: 'voice.tts@1', role: 'the voice (the user’s clone or a voice of the same kind)' },
    { tech: 'words.align@1', role: 'every word timed (illustration on its word)' },
    drawn
      ? { tech: 'director.pov@1', role: 'drawn 2D scenes at the measured cadence and palette' }
      : { tech: 'director.plan@1', role: 'the edit at the measured cadence and presenter layouts' }
  ]
  if (!drawn && pictures) out.push({ tech: 'visuals.fulfil@1', role: 'found / made pictures as the reference sources them' })
  if (!drawn && (mix.clipAi ?? 0) > 0) out.push({ tech: 'clip.make@1', role: 'moving generated shots (the reference generates them)' })
  if (presenter) out.push({ tech: 'avatar.speak@1', role: def.presenter.angleCount.value > 1 ? 'the presenter, switching between his measured angles' : 'the presenter' })
  if (motion) out.push({ tech: 'motion.render@1', role: 'motion design in the channel’s measured card style' })
  if (def.captions.burnIn.value) out.push({ tech: 'captions.make@1', role: 'burnt-in captions as measured' })
  if (def.sound.music.value) out.push({ tech: 'sound.music@1', role: 'the music bed at its measured level' })
  if (transitions) out.push({ tech: 'edit.fx@1', role: 'the drawn channel’s transitions' })
  out.push({ tech: 'render.assemble@1', role: 'assembly' }, { tech: 'qc.check@1', role: 'review' })
  return out
}

const node = (tech: string): string => tech.split('@')[0]!

/** The plan settings that go into one brick: `<node>.<setting>` keys, null values left out (the brick's own default). */
export function brickSettings(tech: string, settings: readonly PlanSetting[]): Record<string, unknown> {
  const n = node(tech)
  const out: Record<string, unknown> = {}
  for (const s of settings) {
    if (!s.key.startsWith(`${n}.`) || s.value === null || s.value === undefined) continue
    const name = s.key.slice(n.length + 1)
    if (!name.includes('.')) out[name] = s.value
  }
  return out
}

/** The versioned technology of a plan brick: its own `tech`, else the engine's latest version of its node. */
export function techOf(b: { node: string; tech?: string | undefined }): string {
  if (b.tech) return b.tech
  if (b.node.includes('@')) return b.node
  return latestOf(b.node) ?? `${b.node}@1`
}

/** The engine a brick runs on, and its fallbacks, as the base pipelines that use this brick set them (the brick, not a
 *  style: ai33 for the voice — Charlie's standing rule —, the image engines of the picture bricks…). Null: the brick's own
 *  engine default. Cost rounds may later pick cheaper engines. (Seen on the first real round: an empty engine let a test
 *  Cloud answer with its demo voice.) */
export function engineOf(tech: string, bases: readonly BasePipeline[] = BASE_PIPELINES): { engine: string | null; fallbacks: string[] } {
  // a base sets an engine on its brick or through its options' defaults (the avatar base: « quality » options set the
  // presenter and clip engines): the base as it runs with its defaults is read, never its styling settings
  for (const base of bases) {
    const applied = applyOptions({ ...structuredClone(base.doc), base: base.id }, reg())
    const doc = applied.ok ? applied.doc : base.doc
    const b = doc.bricks.find((x) => x.tech === tech && x.engine) ?? base.doc.bricks.find((x) => x.tech === tech && x.engine)
    if (b) return { engine: b.engine, fallbacks: [...b.fallbacks] }
  }
  return { engine: null, fallbacks: [] }
}

const setting = (plan: Pick<PipelinePlan, 'settings'>, key: string): unknown => plan.settings.find((s) => s.key === key)?.value

/** The recipe document of a plan (pure): no base, no option, settings only from the plan's definition-computed settings. */
export function compilePlan(plan: Pick<PipelinePlan, 'bricks' | 'settings'>, def: StyleDefinition): RecipeDoc {
  // the measured frame (moteur-pov-2): a vertical reference renders 9:16
  const aspect = setting(plan, 'recipe.aspect') === '9:16' ? '9:16' : '16:9'
  const mix = setting(plan, 'recipe.mix') as RecipeDoc['mix']
  const minutes = Number(setting(plan, 'recipe.minutes') ?? 10)
  return {
    $schema: RECIPE_SCHEMA,
    name: `Clone — ${def.channel.name || 'channel'} (definition v${def.version})`.slice(0, 120),
    base: null,
    videoType: def.presenter.kind.value === 'none' ? 'documentaire' : 'avatar-long',
    format: { aspect, minutes: Math.min(30, Math.max(0.5, minutes)) },
    language: (setting(plan, 'recipe.language') as string | null) ?? null,
    mix: mix && Object.keys(mix).length > 1 ? mix : null,
    options: {},
    inputs: {},
    capCredits: null,
    checkpoints: null,
    bricks: plan.bricks.map((b) => {
      const tech = techOf(b)
      return { tech, settings: brickSettings(tech, plan.settings), ...engineOf(tech), style: null }
    })
  }
}

let registry: TechnologyRegistry | null = null
const reg = (): TechnologyRegistry => (registry ??= technologyRegistry())

/** Bricks in the engine's stage order (a stable sort: within a stage the order given is kept). */
export function inStageOrder<T extends { node: string; tech?: string | undefined }>(bricks: readonly T[]): T[] {
  const rank = (t: string): number => {
    const tech = reg().get(t)
    return tech ? STAGES.indexOf(tech.stage) : STAGES.length
  }
  return bricks.map((b, i) => ({ b, i, r: rank(techOf(b)) })).sort((x, y) => x.r - y.r || x.i - y.i).map((x) => x.b)
}

/** The engine's latest version of a node's technology (by version number, `@10` after `@2`). */
export function latestOf(node: string): string | undefined {
  return [...knownTechnologies()].filter((t) => t.split('@')[0] === node).sort((a, b) => Number(a.split('@')[1]) - Number(b.split('@')[1])).pop()
}

/** The technology ids the engine knows (a plan brick must be one of them). */
export const knownTechnologies = (): Set<string> => new Set(reg().list().map((t) => t.id))

/**
 * Problems of a compiled recipe (empty = sound): it must compile against the engine's registry, carry no base and no base option, and
 * every brick setting must be the plan's setting of that brick (so nothing of a base pipeline's settings slipped in); a setting equal to
 * a base pipeline's brick setting is allowed only when the plan computed it from the definition.
 */
export function recipeProblems(recipe: unknown, plan: Pick<PipelinePlan, 'bricks' | 'settings'>, bases: readonly BasePipeline[] = [], def?: StyleDefinition): string[] {
  const p: string[] = []
  const r = checkRecipe(recipe, reg())
  if (!r.ok) return r.errors.map((e) => `recipe: ${e.code} ${e.path.join('.')} ${e.message}`)
  const doc = r.recipe
  if (doc.base !== null) p.push(`recipe names a base pipeline (${doc.base}): bricks only, never a base`)
  if (Object.keys(doc.options).length > 0) p.push(`recipe carries base options (${Object.keys(doc.options).join(', ')})`)
  const known = new Set(plan.bricks.map(techOf))
  for (const b of doc.bricks) {
    if (!known.has(b.tech)) p.push(`recipe brick ${b.tech} is not in the plan`)
    const expected = brickSettings(b.tech, plan.settings)
    for (const [k, value] of Object.entries(b.settings)) {
      if (!(k in expected)) {
        const fromBase = bases.some((base) => base.doc.bricks.some((x) => x.tech === b.tech && k in x.settings && isDeepStrictEqual(x.settings[k], value)))
        p.push(`recipe brick ${b.tech} setting ${k} is not computed from the definition${fromBase ? ' (a base pipeline’s value)' : ''}`)
      } else if (!isDeepStrictEqual(expected[k], value)) p.push(`recipe brick ${b.tech} setting ${k} differs from the plan`)
      else if (def && bases.some((base) => base.doc.bricks.some((x) => x.tech === b.tech && isDeepStrictEqual(x.settings[k], value)))) {
        // equal to a base pipeline's brick setting: allowed only when a field it is computed from was measured or said by the user
        const fields = plan.settings.find((s) => s.key === `${node(b.tech)}.${k}`)?.fields ?? []
        const said = fields.some((f) => {
          const field = atPath(def, f) as { source?: string; value?: unknown } | undefined
          const own = atPath(definitionDefaults(), f) as { value?: unknown } | undefined
          // measured, said by the user, or the definition's own untouched default (nothing measured: not a base's value)
          return field?.source !== 'default' || isDeepStrictEqual(field?.value, own?.value)
        })
        if (!said) p.push(`recipe brick ${b.tech} setting ${k} = ${JSON.stringify(value)} is a base pipeline's value no measured field backs`)
      }
    }
  }
  return p
}

/** The feasibility elements a plan cannot make with the engine's bricks (how = impossible). */
export const impossibleOf = (f: Feasibility): Feasibility['elements'] => f.elements.filter((e) => e.how === 'impossible')
