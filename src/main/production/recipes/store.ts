// The team's recipes (« pipelines » in the UI, decisions 0011, 0022) in SQLite (migration 025): a recipe serves one video
// type and belongs to the team; each save is a new immutable version holding the whole `atelier.recette/2` document,
// refused when it does not compile against the technology registry or names a style of the wrong family. Stored
// version 1 documents load as version 2. A pipeline is made from a base pipeline (`fromBase`) or by hand, and changed by
// edit operations (`edit`, decision 0024). A channel picks one recipe per video type and keeps its own settings per
// technology and its checkpoints. Export / import is one validated `.atelier-recette.json` file.
import {
  applyOps,
  applyOptions,
  BASE_PIPELINES,
  basePipeline,
  checkRecipe,
  compileRecipe,
  fromBase,
  optionProblem,
  parseRecipe,
  resolveSettings,
  CheckpointsSchema,
  type ChannelProduction,
  type Checkpoint,
  type CompileResult,
  type OptionDecl,
  type OptionOverride,
  type RecipeDoc,
  type RecipeIssue,
  type TechnologyRegistry
} from '../../../engine/technologies'
import {
  type BasePipelineInfo,
  type OptionInfo,
  DEFAULT_RECIPE_CHECKPOINTS,
  pipelineForm,
  RECIPE_STAGES,
  RECIPE_VIDEO_TYPES,
  type RecipeStage,
  type ChannelProductionInput,
  type ChannelProductionView,
  type RecipeCompiled,
  type RecipeDetail,
  type RecipeSummary,
  type RecipeVideoType
} from '../../../shared/recipes'
import type { BrickStyle } from '../../../shared/brick-styles'
import { transaction, type Db } from '../../db'
import { BrickStyleStore } from '../styles'
import { pipelineCode, readShareText, shareText } from './codes'
import { appTechnologies, latestOf } from './technologies'

interface RecipeRow {
  id: number
  name: string
  video_type: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A French error listing the first problems of a recipe. */
export function recipeError(lead: string, errors: readonly RecipeIssue[]): Error {
  const list = errors
    .slice(0, 5)
    .map((e) => `${e.message} (${e.code}${e.path.length > 0 ? ` · ${e.path.join('.')}` : ''})`)
    .join(' ; ')
  return new Error(`${lead} : ${list}.`)
}

export function checkPositiveId(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error(`${what} invalide.`)
  return v
}

/** The view of a compile result the renderer gets. */
export function compiledView(r: CompileResult): RecipeCompiled {
  if (!r.ok) return { ok: false, errors: r.errors, nodes: [], checkpoints: [], pins: {}, overrides: [] }
  return {
    ok: true,
    errors: [],
    nodes: r.pipeline.nodes.map((n) => ({ id: n.id, type: n.type, gate: n.gate ?? 'none', params: n.params ?? {} })),
    checkpoints: r.checkpoints,
    pins: r.pins,
    overrides: r.overrides
  }
}

/** An option declaration as the renderer sees it. */
export function optionInfo(d: OptionDecl): OptionInfo {
  return {
    id: d.id,
    labelKey: d.labelKey,
    subject: d.subject,
    kind: d.kind,
    default: d.default,
    choices: d.kind === 'slider' ? [] : d.choices.map((c) => ({ value: c.value, labelKey: c.labelKey, soon: c.soon ?? null })),
    slider: d.kind === 'slider' ? { min: d.min, max: d.max, step: d.step } : null,
    soon: d.soon ?? null
  }
}

export class RecipeStore {
  readonly styles: BrickStyleStore

  constructor(
    private readonly db: Db,
    readonly registry: TechnologyRegistry = appTechnologies(),
    private readonly now: () => Date = () => new Date()
  ) {
    this.styles = new BrickStyleStore(db, now)
  }

  private iso(): string {
    return this.now().toISOString()
  }

  private row(id: unknown): RecipeRow {
    const r = this.db.prepare('SELECT * FROM recipes WHERE id = ?').get(checkPositiveId(id, 'Recette')) as RecipeRow | undefined
    if (!r) throw new Error(`Recette introuvable : ${String(id)}.`)
    return r
  }

  /** The document of a version (the latest when `version` is absent). */
  doc(id: number, version?: number): { doc: RecipeDoc; number: number } {
    const r =
      version === undefined
        ? (this.db.prepare('SELECT number, json FROM recipe_versions WHERE recipe_id = ? ORDER BY number DESC LIMIT 1').get(id) as { number: number; json: string } | undefined)
        : (this.db.prepare('SELECT number, json FROM recipe_versions WHERE recipe_id = ? AND number = ?').get(id, checkPositiveId(version, 'Version')) as
            | { number: number; json: string }
            | undefined)
    if (!r) throw new Error(`Version de recette introuvable : ${id}${version !== undefined ? ` v${version}` : ''}.`)
    // a version saved as `atelier.recette/1` (production-2) loads as version 2
    const parsed = parseRecipe(JSON.parse(r.json))
    if (!parsed.success) throw new Error(`Version de recette illisible : ${id} v${r.number}.`)
    return { doc: parsed.data, number: r.number }
  }

  private summary(r: RecipeRow): RecipeSummary {
    const { doc, number } = this.doc(r.id)
    const channels = this.db.prepare('SELECT channel_id, video_type FROM recipe_channels WHERE recipe_id = ? ORDER BY channel_id').all(r.id) as {
      channel_id: number
      video_type: RecipeVideoType
    }[]
    return {
      id: r.id,
      name: r.name,
      videoType: r.video_type as RecipeVideoType,
      version: number,
      bricks: doc.bricks.length,
      channels: channels.map((c) => ({ channelId: c.channel_id, videoType: c.video_type })),
      archived: r.archived_at !== null,
      updatedAt: r.updated_at,
      base: doc.base,
      form: pipelineForm(doc),
      minutes: doc.format.minutes,
      stages: this.stagesOf(doc),
      code: pipelineCode(doc)
    }
  }

  /** The stages a document's bricks cover, in stage order. */
  private stagesOf(doc: RecipeDoc): RecipeStage[] {
    const used = new Set(doc.bricks.map((b) => this.registry.get(b.tech)?.stage))
    return RECIPE_STAGES.filter((s) => used.has(s))
  }

  list(): RecipeSummary[] {
    const rows = this.db.prepare('SELECT * FROM recipes ORDER BY archived_at IS NOT NULL, updated_at DESC, id DESC').all() as unknown as RecipeRow[]
    return rows.map((r) => this.summary(r))
  }

  get(id: unknown, version?: unknown): RecipeDetail {
    const r = this.row(id)
    const { doc, number } = this.doc(r.id, version === undefined ? undefined : checkPositiveId(version, 'Version'))
    const versions = this.db.prepare('SELECT number, note, created_at FROM recipe_versions WHERE recipe_id = ? ORDER BY number DESC').all(r.id) as {
      number: number
      note: string
      created_at: string
    }[]
    return { ...this.summary(r), doc, docVersion: number, versions: versions.map((v) => ({ number: v.number, note: v.note, createdAt: v.created_at })) }
  }

  /** The registry checks, plus each brick's style: it must exist and be of the brick's style family. */
  private validate(doc: unknown): { ok: true; recipe: RecipeDoc } | { ok: false; errors: RecipeIssue[] } {
    const r = checkRecipe(doc, this.registry)
    if (!r.ok) return r
    const errors: RecipeIssue[] = []
    r.recipe.bricks.forEach((b, i) => {
      if (b.style === null) return
      const family = this.registry.get(b.tech)?.styleFamily
      try {
        const st = this.styles.resolve(b.style)
        if (family && st.family !== family) errors.push({ code: 'no_style', path: ['bricks', i, 'style'], message: `${b.style} is a ${st.family} style, ${b.tech} wears a ${family} style` })
      } catch {
        errors.push({ code: 'no_style', path: ['bricks', i, 'style'], message: `no style « ${b.style} »` })
      }
    })
    return errors.length > 0 ? { ok: false, errors } : r
  }

  /** The editor's live check; when it passes, the mix once the options are applied (a clip share moves it). */
  check(doc: unknown): { ok: boolean; errors: RecipeIssue[]; mix?: RecipeDoc['mix']; overrides?: OptionOverride[] } {
    const r = this.validate(doc)
    if (!r.ok) return { ok: false, errors: r.errors }
    const applied = applyOptions(r.recipe, this.registry)
    return { ok: true, errors: [], mix: applied.ok ? applied.doc.mix : r.recipe.mix, overrides: applied.ok ? applied.overrides : [] }
  }

  /** A new recipe, or a new immutable version of one. */
  save(input: unknown): RecipeDetail {
    if (!isObj(input)) throw new Error('Recette invalide.')
    const checked = this.validate(input.doc)
    if (!checked.ok) throw recipeError('La recette n’est pas valable', checked.errors)
    const doc = checked.recipe
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : ''
    const now = this.iso()
    const id = transaction(this.db, () => {
      let rid: number
      if (input.id !== undefined) {
        rid = this.row(input.id).id
        this.db.prepare('UPDATE recipes SET name = ?, video_type = ?, updated_at = ? WHERE id = ?').run(doc.name, doc.videoType, now, rid)
      } else {
        rid = Number(this.db.prepare('INSERT INTO recipes (name, video_type, created_at, updated_at) VALUES (?, ?, ?, ?)').run(doc.name, doc.videoType, now, now).lastInsertRowid)
      }
      const last = this.db.prepare('SELECT MAX(number) AS n FROM recipe_versions WHERE recipe_id = ?').get(rid) as { n: number | null }
      this.db.prepare('INSERT INTO recipe_versions (recipe_id, number, json, note, created_at) VALUES (?, ?, ?, ?, ?)').run(rid, (last.n ?? 0) + 1, JSON.stringify(doc), note, now)
      return rid
    })
    return this.get(id)
  }

  // ------------------------------------------------------------------------------------------------ bases, edit operations

  /** The base pipelines (« pipelines de base ») with their options, and how many of the team's pipelines came from each. */
  bases(): BasePipelineInfo[] {
    const docs = (this.db.prepare('SELECT id FROM recipes WHERE archived_at IS NULL').all() as { id: number }[]).map((r) => this.doc(r.id).doc)
    return BASE_PIPELINES.map((b) => ({
      id: b.id,
      labelKey: b.labelKey,
      doc: b.doc,
      options: b.options.map(optionInfo),
      copies: docs.filter((d) => d.base === b.id).length,
      form: pipelineForm(b.doc),
      code: pipelineCode(b.doc)
    }))
  }

  /** A new pipeline of the team made from a base pipeline (its options at their defaults). */
  fromBase(baseId: unknown, name?: unknown): RecipeDetail {
    const b = typeof baseId === 'string' ? basePipeline(baseId) : undefined
    if (!b) throw new Error('Pipeline de base inconnue.')
    const doc = fromBase(b, typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : undefined)
    return this.save({ doc, note: `Depuis la pipeline de base ${b.id}` })
  }

  /**
   * « Traduire » (clonage-traduction): the same pipeline in another language, saved as a new pipeline of the team (« … (FR) »). The run
   * then writes the script in that language (a project runs in its pipeline's language), the director writes the cards' texts with its
   * number and currency conventions, the archives' captions are translated; the voice is the channel's (designed in that language).
   */
  translate(id: unknown, language: unknown): RecipeDetail {
    const lang = typeof language === 'string' ? language.trim().toLowerCase() : ''
    if (!/^[a-z]{2}$/.test(lang)) throw new Error('Langue invalide : deux lettres (fr, en, es…).')
    const r = this.row(id)
    const { doc } = this.doc(r.id)
    if ((doc.language ?? null) === lang) throw new Error('Cette pipeline est déjà dans cette langue.')
    const name = `${doc.name.replace(/\s*\([A-Z]{2}\)$/, '')} (${lang.toUpperCase()})`.slice(0, 120)
    return this.save({ doc: { ...doc, language: lang, name }, note: `Traduite en ${lang} depuis « ${doc.name} »` })
  }

  /**
   * Applies a batch of edit operations (decision 0024) to the latest version and saves the result as a new version. A
   * `setOption` is checked against the base pipeline's declarations. Refused whole, with the problems, when one fails.
   */
  edit(id: unknown, ops: unknown, note?: unknown): RecipeDetail {
    const r = this.row(id)
    if (!Array.isArray(ops) || ops.length === 0 || ops.length > 50) throw new Error('Modifications invalides (1 à 50 opérations).')
    const { doc } = this.doc(r.id)
    const decls = basePipeline(doc.base)?.options ?? []
    const res = applyOps(doc, ops, this.registry, { checkOption: (option, value) => optionProblem(decls, option, value) })
    if (!res.ok) throw new Error(`Ces modifications ne sont pas valables : ${res.errors.slice(0, 5).map((e) => `${e.message} (${e.code}, opération ${e.op + 1})`).join(' ; ')}.`)
    return this.save({ id: r.id, doc: res.doc, note: typeof note === 'string' && note.trim() ? note : 'Modifiée' })
  }

  archive(id: unknown, archived: unknown): RecipeSummary {
    const r = this.row(id)
    this.db.prepare('UPDATE recipes SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived === true ? this.iso() : null, this.iso(), r.id)
    return this.summary(this.row(r.id))
  }

  // ------------------------------------------------------------------------------------------------ channels

  private channelExists(channelId: unknown): number {
    const id = checkPositiveId(channelId, 'Chaîne')
    if (!this.db.prepare('SELECT 1 FROM channels WHERE id = ?').get(id)) throw new Error(`Chaîne inconnue : ${id}.`)
    return id
  }

  /** A channel's settings as the compiler reads them (empty for none). */
  production(channelId: number | null): ChannelProduction {
    if (channelId === null) return { technologies: {}, checkpoints: null }
    const r = this.db.prepare('SELECT settings_json, checkpoints_json FROM channel_production WHERE channel_id = ?').get(channelId) as
      | { settings_json: string; checkpoints_json: string | null }
      | undefined
    return {
      technologies: r ? (JSON.parse(r.settings_json) as ChannelProduction['technologies']) : {},
      checkpoints: r?.checkpoints_json ? (JSON.parse(r.checkpoints_json) as Checkpoint[]) : null
    }
  }

  channel(channelId: unknown): ChannelProductionView {
    const id = this.channelExists(channelId)
    const p = this.production(id)
    const uses = this.db.prepare('SELECT video_type, recipe_id FROM recipe_channels WHERE channel_id = ?').all(id) as { video_type: RecipeVideoType; recipe_id: number }[]
    return {
      channelId: id,
      technologies: p.technologies,
      checkpoints: p.checkpoints ?? [...DEFAULT_RECIPE_CHECKPOINTS],
      defaultCheckpoints: p.checkpoints === null,
      recipes: Object.fromEntries(uses.map((u) => [u.video_type, u.recipe_id]))
    }
  }

  /** Sets a channel's settings: each one must be a setting a channel may set on the latest version of that technology. */
  setChannel(channelId: unknown, input: ChannelProductionInput): ChannelProductionView {
    const id = this.channelExists(channelId)
    if (!isObj(input)) throw new Error('Réglages de chaîne invalides.')
    const current = this.production(id)
    let technologies = current.technologies
    if (input.technologies !== undefined) {
      if (!isObj(input.technologies)) throw new Error('Réglages des technologies invalides.')
      technologies = {}
      for (const [name, settings] of Object.entries(input.technologies)) {
        const t = latestOf(this.registry, name)
        if (!t) throw new Error(`Technologie inconnue : ${name.slice(0, 60)}.`)
        if (!isObj(settings)) throw new Error(`Réglages invalides pour ${name}.`)
        const r = resolveSettings(t, { channel: settings }, [name])
        if (!r.ok) throw recipeError('Ces réglages de chaîne ne sont pas valables', r.errors)
        if (Object.keys(settings).length > 0) technologies[name] = settings
      }
    }
    let checkpoints = current.checkpoints
    if (input.checkpoints !== undefined) {
      if (input.checkpoints === null) checkpoints = null
      else {
        const c = CheckpointsSchema.safeParse(input.checkpoints)
        if (!c.success) throw new Error('Points de validation inconnus.')
        checkpoints = c.data
      }
    }
    this.db
      .prepare(
        `INSERT INTO channel_production (channel_id, settings_json, checkpoints_json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET settings_json = excluded.settings_json, checkpoints_json = excluded.checkpoints_json, updated_at = excluded.updated_at`
      )
      .run(id, JSON.stringify(technologies), checkpoints === null ? null : JSON.stringify(checkpoints), this.iso())
    return this.channel(id)
  }

  /** The recipe a channel uses for a video type (a recipe serves its own video type only). */
  useForChannel(channelId: unknown, videoType: unknown, recipeId: unknown): ChannelProductionView {
    const id = this.channelExists(channelId)
    if (!(RECIPE_VIDEO_TYPES as readonly unknown[]).includes(videoType)) throw new Error('Type de vidéo inconnu.')
    if (recipeId === null) {
      this.db.prepare('DELETE FROM recipe_channels WHERE channel_id = ? AND video_type = ?').run(id, videoType as string)
      return this.channel(id)
    }
    const r = this.row(recipeId)
    if (r.video_type !== videoType) throw new Error('Cette recette sert un autre type de vidéo.')
    if (r.archived_at !== null) throw new Error('Cette recette est archivée.')
    this.db
      .prepare(
        `INSERT INTO recipe_channels (channel_id, video_type, recipe_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(channel_id, video_type) DO UPDATE SET recipe_id = excluded.recipe_id, updated_at = excluded.updated_at`
      )
      .run(id, videoType as string, r.id, this.iso())
    return this.channel(id)
  }

  /** What a recipe (latest version) runs for a channel or none. */
  compile(id: unknown, channelId?: unknown): RecipeCompiled {
    const r = this.row(id)
    const ch = channelId === undefined || channelId === null ? null : this.channelExists(channelId)
    const { doc, number } = this.doc(r.id)
    return compiledView(compileRecipe(doc, this.registry, { channel: this.production(ch), id: `recette-${r.id}`, version: number, styles: this.styleDocs(doc) }))
  }

  /**
   * The documents of the styles a recipe's bricks wear, keyed as the recipe writes them, each at the version a project pinned
   * (`pins`, by brick name) or else the latest: the compiler hands their looks to the bricks that read them (decision 0035).
   * A style that no longer resolves is left out (the brick then runs without its look, as before).
   */
  styleDocs(doc: RecipeDoc, pins?: Record<string, { style: string | null }>): Record<string, BrickStyle> {
    const out: Record<string, BrickStyle> = {}
    for (const b of doc.bricks) {
      if (b.style === null || out[b.style]) continue
      try {
        const st = this.styles.resolve(pins?.[b.tech.replace(/@\d+$/, '')]?.style ?? b.style)
        out[b.style] = { ...st.doc, version: st.version }
      } catch {
        // unknown style: no look
      }
    }
    return out
  }

  // ------------------------------------------------------------------------------------------------ file

  exportFile(id: unknown, version?: unknown): { fileName: string; json: string } {
    const d = this.get(id, version)
    const slug =
      d.name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'recette'
    return { fileName: `${slug}.atelier-recette.json`, json: JSON.stringify(d.doc, null, 2) + '\n' }
  }

  importFile(json: unknown): RecipeDetail {
    if (typeof json !== 'string' || json.length > 1_000_000) throw new Error('Fichier de recette invalide.')
    let doc: unknown
    try {
      doc = JSON.parse(json)
    } catch {
      throw new Error('Ce fichier n’est pas du JSON.')
    }
    return this.save({ doc, note: 'Importée' })
  }

  // ------------------------------------------------------------------------------------------------ codes (production-lab)

  /** A version's code and the text that shares it (codes.ts; the API refuses it while codes are off). */
  share(id: unknown, version?: unknown): { code: string; text: string } {
    const { doc } = this.get(id, version)
    return { code: pipelineCode(doc), text: shareText(doc) }
  }

  /** A new pipeline from a shared code: its fingerprint checked, then validated like any save. */
  fromCode(text: unknown): RecipeDetail {
    const { code, doc } = readShareText(text)
    return this.save({ doc, note: `Depuis le code ${code}` })
  }
}

