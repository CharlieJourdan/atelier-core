// From a recipe (`atelier.recette/2`) to an executable `atelier.pipeline/1` document (decisions 0011, 0022). First the
// chosen options of its base pipeline become edit operations applied in « option » mode (options.ts); the pipeline's mix
// gives the bricks that read it their recipe-layer settings (`fromMix`). Then settings resolve
// technology defaults < recipe < channel < project, each layer limited to the settings the technology lets it set. Bricks
// hand each other named slots (types.ts): `@slot` reads the latest provider BEFORE the brick (a translation reads the
// script, every later brick reads the translation), `@slot?` the latest one before it, else the last one after it (the
// render reads the captions wherever they sit in the Montage stage), else it stays unwired. One fixed budget mode, no
// quality switch; the checkpoints (the recipe's, else the channel's, else topic + thumbnail) become `owner` gates and every
// other node is explicitly `none`. Engines and styles are checked against the bricks' families and returned as `pins`
// (the project pins them with the recipe version, R5.7); the bricks that pass them to their nodes come with their own
// chantiers. Pure: no I/O. The result is validated against the node registry by the caller.
import { engineFamilyOf, fallbackScope } from '../../shared/cloud-engines'
import type { BrickStyle } from '../../shared/brick-styles'
import type { Pipeline, PipelineInput, PipelineNode } from '../pipeline-schema'
import { basePipeline } from './bases'
import { applyOps } from './edit-ops'
import { optionOps } from './options'
import type { MixKind } from './mix'
import type { TechnologyRegistry } from './registry'
import { CHECKPOINTS, DEFAULT_CHECKPOINTS, capForMinutes, parseRecipe, type Checkpoint, type RecipeDoc } from './recipe'
import { STAGES, techName, type AnyTechnology, type CompileCtx, type Settings, type Slot, type TechnologyId } from './types'

export type RecipeIssueCode =
  | 'schema'
  | 'unknown_technology'
  | 'stage_order'
  | 'duplicate_technology'
  | 'duplicate_node'
  | 'not_overridable'
  | 'bad_settings'
  | 'missing_slot'
  | 'no_video'
  | 'unknown_base'
  | 'bad_option'
  | 'no_engine'
  | 'engine_family'
  | 'bad_fallbacks'
  | 'unknown_engine'
  | 'no_style'

export interface RecipeIssue {
  code: RecipeIssueCode
  path: (string | number)[]
  message: string
}

/** What a channel sets for the recipes it uses: per-technology settings (keyed by name, no version) and its checkpoints. */
export interface ChannelProduction {
  technologies: Record<string, Settings>
  checkpoints: Checkpoint[] | null
}

/** One video's adjustments (decision 0011: technology < recipe < channel < project). */
export interface ProjectAdjustments {
  technologies?: Record<string, Settings>
  minutes?: number
}

/** What a brick runs on and wears, as the project pins it (decision 0021). */
export interface BrickPin {
  tech: TechnologyId
  /** null: the Cloud's default engine for the brick's usage. */
  engine: string | null
  fallbacks: string[]
  /** `video`: a fallback replaces the engine for the whole video before it starts (voice, presenter); `item`: per item. */
  fallbackScope: 'video' | 'item' | null
  /** `name` or `name@version` as the recipe says it; the project resolves it to an exact version. */
  style: string | null
}

/** Per brick (technology name): its engine, fallbacks and style. */
export type Pins = Record<string, BrickPin>

/** An option that replaced a value the recipe set itself (solidite: never silent; shown before a run, kept in the run). */
export interface OptionOverride {
  option: string
  /** What it replaced, e.g. `mix.clipAi`. */
  path: string
  from: number
  to: number
}

export type CompileResult =
  | { ok: true; pipeline: Pipeline; checkpoints: Checkpoint[]; pins: Pins; doc: RecipeDoc; overrides: OptionOverride[] }
  | { ok: false; errors: RecipeIssue[] }

export interface CompileOptions {
  channel?: ChannelProduction
  project?: ProjectAdjustments
  id?: string
  version?: number
  name?: string
  /** The engine ids the Cloud publishes; absent (offline, tests): only the families are checked. */
  engines?: ReadonlySet<string>
  /**
   * The documents of the styles the bricks wear, keyed by the reference the recipe writes (`phone-real`, `phone-real@3`),
   * each at the version the project pinned: a brick with `styleParams` passes its look to its nodes (decision 0035).
   * Absent: the styles stay pins only, as before.
   */
  styles?: Readonly<Record<string, BrickStyle>>
}

/** Which slots a checkpoint stops after. */
const CHECKPOINT_SLOTS: Record<Checkpoint, readonly Slot[]> = {
  topic: ['brief'],
  script: ['script'],
  voice: ['voice'],
  director: ['plan'],
  visuals: ['images', 'clips', 'background'],
  avatar: ['avatar'],
  final: ['video'],
  thumbnail: ['thumbnails']
}

/**
 * The settings of one brick after the layers, or the problems: a layer may only set what the technology lets it set
 * (a project may adjust what the recipe or the channel may), and the result must pass the technology's schema.
 */
export function resolveSettings(
  t: AnyTechnology,
  layers: { recipe?: Settings; channel?: Settings; project?: Settings },
  path: (string | number)[] = []
): { ok: true; settings: Settings } | { ok: false; errors: RecipeIssue[] } {
  const errors: RecipeIssue[] = []
  const allowed = {
    recipe: t.overridable.recipe as readonly string[],
    channel: t.overridable.channel as readonly string[],
    project: [...t.overridable.recipe, ...t.overridable.channel] as readonly string[]
  }
  const merged: Settings = {}
  for (const layer of ['recipe', 'channel', 'project'] as const) {
    for (const [k, v] of Object.entries(layers[layer] ?? {})) {
      if (!allowed[layer].includes(k)) errors.push({ code: 'not_overridable', path: [...path, layer, k], message: `${t.id}: a ${layer} cannot set "${k}"` })
      else if (v !== undefined) merged[k] = v
    }
  }
  const parsed = t.params.safeParse(merged)
  if (!parsed.success) {
    for (const i of parsed.error.issues) errors.push({ code: 'bad_settings', path: [...path, ...i.path.map((p) => (typeof p === 'symbol' ? String(p) : p))], message: `${t.id}: ${i.message}` })
  }
  return errors.length > 0 || !parsed.success ? { ok: false, errors } : { ok: true, settings: parsed.data }
}

/** Shape and registry checks of a recipe document (no channel, no project): what saving or importing one runs. */
/** Shape and registry checks of a recipe document of any version (no channel, no project): what saving or importing one
 *  runs. A version 1 document comes back as version 2. */
export function checkRecipe(doc: unknown, reg: TechnologyRegistry, engines?: ReadonlySet<string>): { ok: true; recipe: RecipeDoc } | { ok: false; errors: RecipeIssue[] } {
  const parsed = parseRecipe(doc)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => ({ code: 'schema' as const, path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)), message: i.message })) }
  }
  const compiled = compileRecipe(parsed.data, reg, engines ? { engines } : {})
  return compiled.ok ? { ok: true, recipe: parsed.data } : { ok: false, errors: compiled.errors }
}

/** The document once its options are applied (what the compiler compiles), or the problems of its options. */
export function applyOptions(recipe: RecipeDoc, reg: TechnologyRegistry): { ok: true; doc: RecipeDoc; overrides: OptionOverride[] } | { ok: false; errors: RecipeIssue[] } {
  if (recipe.base === null) {
    const stray = Object.keys(recipe.options)
    return stray.length > 0
      ? { ok: false, errors: stray.map((k) => ({ code: 'bad_option' as const, path: ['options', k], message: `no option « ${k} »: this pipeline has no base` })) }
      : { ok: true, doc: recipe, overrides: [] }
  }
  const base = basePipeline(recipe.base)
  if (!base) return { ok: false, errors: [{ code: 'unknown_base', path: ['base'], message: `no base pipeline « ${recipe.base} »` }] }
  const batches = optionOps(recipe, base.options)
  if (!batches.ok) return { ok: false, errors: batches.errors.map((e) => ({ code: 'bad_option' as const, path: ['options', e.option], message: e.message })) }
  let doc = recipe
  const overrides: OptionOverride[] = []
  for (const b of batches.batches) {
    // the mix shares the recipe set itself (they differ from its base's): a slider nobody moved leaves them alone, one moved
    // on purpose replaces them and says so (solidite: avatar round 2 rendered as round 1, its clip share silently undone)
    const own = mixKindsOf(b.ops).filter((k) => doc.mix?.[k] !== undefined && doc.mix[k] !== base.doc.mix?.[k])
    const chosen = recipe.options[b.option] !== undefined
    if (own.length > 0 && !chosen && b.value !== undefined) continue
    const before = doc.mix
    const r = applyOps(doc, b.ops, reg, { mode: 'option', ...(b.value !== undefined ? { value: b.value } : {}) })
    if (!r.ok) return { ok: false, errors: r.errors.map((e) => ({ code: 'bad_option' as const, path: ['options', b.option], message: `${b.option}: ${e.message}` })) }
    doc = r.doc
    for (const k of own) {
      const from = before?.[k] as number
      const to = doc.mix?.[k]
      if (typeof to === 'number' && Math.abs(to - from) > 1e-9) overrides.push({ option: b.option, path: `mix.${k}`, from, to })
    }
  }
  return { ok: true, doc, overrides }
}

/** The mix kinds a batch of operations sets by share. */
function mixKindsOf(ops: readonly unknown[]): MixKind[] {
  const kinds: MixKind[] = []
  for (const op of ops as { op?: string; kind?: MixKind }[]) if (op.op === 'setMix' && op.kind) kinds.push(op.kind)
  return kinds
}

/** The engine and style of a brick against its technology's families (and the Cloud's engines when known). */
function checkEnginesAndStyles(t: AnyTechnology, b: RecipeDoc['bricks'][number], at: (string | number)[], engines: ReadonlySet<string> | undefined): RecipeIssue[] {
  const errors: RecipeIssue[] = []
  const ids = [...(b.engine ? [b.engine] : []), ...b.fallbacks]
  if (ids.length > 0 && !t.engineFamily) errors.push({ code: 'no_engine', path: [...at, 'engine'], message: `${t.id} runs no engine: it takes no engine nor fallbacks` })
  if (t.engineFamily) {
    for (const id of ids) {
      if (engineFamilyOf(id) !== t.engineFamily) errors.push({ code: 'engine_family', path: [...at, id === b.engine ? 'engine' : 'fallbacks'], message: `${id} is not a ${t.engineFamily} engine (${t.id})` })
      else if (engines && !engines.has(id)) errors.push({ code: 'unknown_engine', path: [...at, 'engine'], message: `Atelier Cloud has no engine « ${id} »` })
    }
    if (new Set(ids).size !== ids.length) errors.push({ code: 'bad_fallbacks', path: [...at, 'fallbacks'], message: `${t.id}: an engine is listed twice (the engine and its fallbacks differ)` })
  }
  if (b.style !== null && !t.styleFamily) errors.push({ code: 'no_style', path: [...at, 'style'], message: `${t.id} wears no style` })
  return errors
}

export function compileRecipe(source: RecipeDoc, reg: TechnologyRegistry, o: CompileOptions = {}): CompileResult {
  const applied = applyOptions(source, reg)
  if (!applied.ok) return applied
  const recipe = applied.doc
  const errors: RecipeIssue[] = []
  const short = recipe.format.aspect === '9:16'
  const minutes = o.project?.minutes ?? recipe.format.minutes
  const ctx: CompileCtx = { aspect: recipe.format.aspect, short, minutes, ...(recipe.mix ? { mix: recipe.mix } : {}) }

  // 1. the technologies, their order, their settings
  const techs: { t: AnyTechnology; settings: Settings }[] = []
  const seen = new Set<string>()
  let lastStage = 0
  recipe.bricks.forEach((b, i) => {
    const at = ['bricks', i]
    const t = reg.get(b.tech)
    if (!t) {
      errors.push({ code: 'unknown_technology', path: [...at, 'tech'], message: `no technology "${b.tech}"` })
      return
    }
    const stage = STAGES.indexOf(t.stage)
    if (stage < lastStage) errors.push({ code: 'stage_order', path: at, message: `${t.id} (${t.stage}) comes after a later stage` })
    lastStage = Math.max(lastStage, stage)
    const name = techName(t.id)
    if (seen.has(name)) errors.push({ code: 'duplicate_technology', path: at, message: `${name} is used twice` })
    seen.add(name)
    errors.push(...checkEnginesAndStyles(t, b, at, o.engines))
    // the mix speaks first in the recipe layer; the brick's own settings win
    const recipeOverridable = t.overridable.recipe as readonly string[]
    const mixed = recipe.mix && t.fromMix ? Object.fromEntries(Object.entries(t.fromMix(recipe.mix, ctx)).filter(([k, v]) => v !== undefined && recipeOverridable.includes(k))) : {}
    const r = resolveSettings(t, { recipe: { ...mixed, ...b.settings }, channel: o.channel?.technologies[name], project: o.project?.technologies?.[name] }, at)
    if (!r.ok) errors.push(...r.errors)
    else techs.push({ t, settings: r.settings })
  })
  if (errors.length > 0) return { ok: false, errors }

  // 2. who provides which slot
  const providers = new Map<Slot, { brick: number; ref: string }[]>()
  techs.forEach(({ t }, brick) => {
    for (const [slot, ref] of Object.entries(t.provides)) {
      const list = providers.get(slot as Slot) ?? []
      list.push({ brick, ref })
      providers.set(slot as Slot, list)
    }
  })
  const before = (slot: Slot, brick: number): string | undefined => providers.get(slot)?.filter((p) => p.brick < brick).at(-1)?.ref
  const after = (slot: Slot, brick: number): string | undefined => providers.get(slot)?.filter((p) => p.brick > brick).at(-1)?.ref
  const wire = (inn: Record<string, string>, brick: number, path: (string | number)[]): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [port, ref] of Object.entries(inn)) {
      const m = /^@([a-z]+)(\?)?$/.exec(ref)
      if (!m) {
        out[port] = ref
        continue
      }
      const slot = m[1] as Slot
      const src = before(slot, brick) ?? (m[2] ? after(slot, brick) : undefined)
      if (src) out[port] = src
      else if (!m[2]) errors.push({ code: 'missing_slot', path: [...path, port], message: `${techs[brick]?.t.id} needs « ${slot} » from an earlier brick` })
    }
    return out
  }

  // 3. the nodes
  const nodes: PipelineNode[] = []
  const byId = new Map<string, PipelineNode>()
  techs.forEach(({ t, settings }, brick) => {
    const params = t.nodeParams(settings, ctx)
    const b = recipe.bricks[brick]
    if (t.pinParams && b?.engine) {
      for (const [id, add] of Object.entries(t.pinParams({ engine: b.engine, fallbacks: b.fallbacks }))) params[id] = { ...(params[id] ?? {}), ...add }
    }
    const style = b?.style ? o.styles?.[b.style] : undefined
    if (t.styleParams && style && style.family === t.styleFamily) {
      for (const [id, add] of Object.entries(t.styleParams(style))) params[id] = { ...(params[id] ?? {}), ...add }
    }
    for (const n of t.nodes) {
      if (byId.has(n.id)) {
        errors.push({ code: 'duplicate_node', path: ['bricks', brick], message: `${t.id} and another brick both make « ${n.id} »` })
        continue
      }
      const node: PipelineNode = { id: n.id, type: n.type, in: wire(n.in, brick, ['bricks', brick, n.id]), params: { ...(params[n.id] ?? {}) }, gate: 'none' }
      nodes.push(node)
      byId.set(n.id, node)
    }
  })
  // 4. what a brick asks of an earlier one (the director places a presenter's or the overlays' shots)
  techs.forEach(({ t, settings }, brick) => {
    for (const [slot, add] of Object.entries(t.contributes?.(settings, ctx) ?? {})) {
      const ref = before(slot as Slot, brick)
      const target = ref ? byId.get(ref.split('.')[0] as string) : undefined
      if (!ref || !target || !add) {
        errors.push({ code: 'missing_slot', path: ['bricks', brick], message: `${t.id} needs « ${slot} » from an earlier brick` })
        continue
      }
      const providerBrick = providers.get(slot as Slot)?.find((p) => p.ref === ref)?.brick ?? brick
      target.params = { ...target.params, ...(add.params ?? {}) }
      target.in = { ...target.in, ...wire(add.in ?? {}, providerBrick, ['bricks', brick, slot]) }
    }
  })
  // a pipeline with no clip brick has no clip engine: its director plans no generated clip (issue #114)
  if (!nodes.some((n) => n.type.startsWith('clip.make@'))) for (const n of nodes) if (n.type === 'director.plan@1' && n.params && typeof n.params.screen === 'object' && n.params.screen !== null) n.params = { ...n.params, screen: { ...n.params.screen, clips: false } }
  if (!providers.has('video')) errors.push({ code: 'no_video', path: ['bricks'], message: 'no brick of the Montage stage renders the video' })
  if (errors.length > 0) return { ok: false, errors }

  // 5. the checkpoints become owner gates on the node that provides the slot (its final provider)
  const checkpoints = [...(recipe.checkpoints ?? o.channel?.checkpoints ?? DEFAULT_CHECKPOINTS)].sort((a, b) => CHECKPOINTS.indexOf(a) - CHECKPOINTS.indexOf(b))
  for (const cp of checkpoints) {
    for (const slot of CHECKPOINT_SLOTS[cp]) {
      const ref = providers.get(slot)?.at(-1)?.ref
      const node = ref ? byId.get(ref.split('.')[0] as string) : undefined
      if (node) node.gate = 'owner'
    }
  }
  // a brick that asks for the owner's check (the script written « with validation »): the gate goes on the slot's final
  // provider, so the owner sees the script once the sponsor mentions and the fact check are in
  for (const { t, settings } of techs) {
    if (!t.ownerGate?.(settings)) continue
    for (const slot of Object.keys(t.provides) as Slot[]) {
      const ref = providers.get(slot)?.at(-1)?.ref
      const node = ref ? byId.get(ref.split('.')[0] as string) : undefined
      if (node) node.gate = 'owner'
    }
  }
  for (const n of nodes) if (n.params && Object.keys(n.params).length === 0) delete n.params

  const inputs: PipelineInput[] = []
  for (const { t } of techs) for (const inp of t.inputs ?? []) if (!inputs.some((x) => x.id === inp.id)) inputs.push({ ...inp })
  const pins: Pins = {}
  for (const b of recipe.bricks) {
    const t = reg.get(b.tech) as AnyTechnology
    pins[techName(t.id)] = { tech: t.id, engine: b.engine, fallbacks: [...b.fallbacks], fallbackScope: t.engineFamily ? fallbackScope(t.engineFamily) : null, style: b.style }
  }
  return {
    ok: true,
    checkpoints,
    pins,
    doc: recipe,
    overrides: applied.overrides,
    pipeline: {
      $schema: 'atelier.pipeline/1',
      id: o.id ?? 'recette',
      version: o.version ?? 1,
      name: (o.name ?? recipe.name).slice(0, 200),
      format: short
        ? { kind: 'youtube_short', aspect: '9:16', minutes: { default: minutes, min: Math.min(0.1, minutes), max: Math.max(3, minutes) } }
        : { kind: 'youtube_long', aspect: '16:9', minutes: { default: minutes, min: Math.min(0.5, minutes), max: Math.max(30, minutes) } },
      inputs,
      // one fixed mode (decision 0011): each brick carries its own choices, no « qualité max / usage max » switch
      budget: { default: 'usage_max', ...(recipe.capCredits !== null ? { capCredits: capForMinutes(recipe.capCredits, recipe.format.minutes, minutes) } : {}) },
      nodes
    }
  }
}
