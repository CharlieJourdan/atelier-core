// Projects (decision 0011): ONE video made from a pinned recipe version, for a channel or none, with its idea, inputs and
// per-video adjustments. Launching compiles the recipe with the channel's settings and the project's adjustments
// (technology < recipe < channel < project) into `atelier.pipeline/1`, and starts a run of `ProductionRuns` on it (one
// fixed budget mode; the checkpoints are owner gates, so the run is « tout d'un coup » between them). A run needs a
// video, and a video a channel: a project with no channel is kept but cannot run yet. A project pins, with the recipe
// version, each brick's engine and fallbacks and the EXACT version of its style (R5.7, decision 0021): a new version of a
// style later does not change a project made before it.
import { basePipeline, compileRecipe, pipelineGraph, type CompileOptions, type CompileResult, type OptionOverride, type Pins, type ProjectAdjustments, type RecipeDoc } from '../../../engine/technologies'
import type { Pipeline } from '../../../engine/pipeline-schema'
import type { PipelineGraphView } from '../../../shared/pipeline-graph'
import type { ProjectRunOptions } from '../../../shared/api/projects'
import { t } from '../../../shared/fr'
import type { RunQuote, RunStartInput } from '../../../shared/runs'
import type { BrickPinView, ProjectCreateInput, ProjectDetail, ProjectSummary, ProjectUpdateInput, RecipeCompiled } from '../../../shared/recipes'
import type { Db } from '../../db'
import { checkRunInputs } from '../runs/inputs'
import type { ProductionRuns } from '../runs/service'
import { scriptMinutes } from './script-length'
import { checkPositiveId, compiledView, recipeError, type RecipeStore } from './store'

interface ProjectRow {
  id: number
  recipe_id: number
  recipe_version: number
  channel_id: number | null
  title: string
  idea: string
  inputs_json: string
  adjustments_json: string
  pins_json: string
  run_id: number | null
  created_at: string
  updated_at: string
  recipe_name: string
  run_status: string | null
  /** The video the project fills (a planner's slot, or the one its run made). */
  video_id: number | null
  run_video_id: number | null
}

const SELECT = `SELECT p.*, r.name AS recipe_name, v.status AS run_status, v.video_id AS run_video_id
  FROM projects p JOIN recipes r ON r.id = p.recipe_id LEFT JOIN video_runs v ON v.id = p.run_id`

/** The French message when a pipeline that takes the owner's script has none (never the engine's raw « required inputs missing »). */
export const MISSING_SCRIPT = 'Il manque le script de cette vidéo : sa pipeline lit ton script (option « Script » : je l’importe). Colle-le ou importe un fichier .txt ou .docx, puis relance. Rien n’a été lancé ni facturé.'

/** Run states a project relaunches (its same run) when launched again. */
const RELAUNCHABLE: readonly string[] = ['interrupted', 'failed', 'cancelled']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function text(v: unknown, what: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${what} manquant.`)
  if (v.length > max) throw new Error(`${what} trop long (${max} caractères au plus).`)
  return v.trim()
}

function checkAdjustments(v: unknown): ProjectAdjustments {
  if (v === undefined) return {}
  if (!isObj(v)) throw new Error('Ajustements invalides.')
  const out: ProjectAdjustments = {}
  if (v.minutes !== undefined) {
    if (typeof v.minutes !== 'number' || !(v.minutes >= 0.5 && v.minutes <= 30)) throw new Error('Durée invalide (0,5 à 30 minutes).')
    out.minutes = v.minutes
  }
  if (v.technologies !== undefined) {
    if (!isObj(v.technologies) || !Object.values(v.technologies).every(isObj)) throw new Error('Ajustements des technologies invalides.')
    out.technologies = v.technologies as Record<string, Record<string, unknown>>
  }
  return out
}

/** The words a minute a pipeline's voice reads at: its « Vitesse de la voix » option (a story short), its voice brick's setting, else none. */
function paceOf(doc: RecipeDoc): number | undefined {
  const chosen = doc.options.voicePace
  if (typeof chosen === 'number') return chosen
  const set = doc.bricks.find((b) => b.tech.startsWith('voice.tts@'))?.settings.wpm
  if (typeof set === 'number') return set
  const decl = basePipeline(doc.base)?.options.find((o) => o.id === 'voicePace')
  return decl?.kind === 'slider' ? decl.default : undefined
}

export class ProjectStore {
  constructor(
    private readonly db: Db,
    private readonly recipes: RecipeStore,
    private readonly runs: Pick<ProductionRuns, 'startDocument' | 'retry' | 'quote'> & Partial<Pick<ProductionRuns, 'channelAssets'>>,
    private readonly now: () => Date = () => new Date()
  ) {}

  private row(id: unknown): ProjectRow {
    const r = this.db.prepare(`${SELECT} WHERE p.id = ?`).get(checkPositiveId(id, 'Projet')) as ProjectRow | undefined
    if (!r) throw new Error(`Projet introuvable : ${String(id)}.`)
    return r
  }

  private summary(r: ProjectRow): ProjectSummary {
    return {
      id: r.id,
      title: r.title,
      recipeId: r.recipe_id,
      recipeName: r.recipe_name,
      recipeVersion: r.recipe_version,
      channelId: r.channel_id,
      runId: r.run_id,
      runStatus: r.run_status,
      videoId: r.video_id ?? r.run_video_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }
  }

  private detail(r: ProjectRow): ProjectDetail {
    return {
      ...this.summary(r),
      idea: r.idea,
      inputs: JSON.parse(r.inputs_json) as Record<string, string>,
      adjustments: JSON.parse(r.adjustments_json) as ProjectAdjustments,
      pins: JSON.parse(r.pins_json) as Record<string, BrickPinView>
    }
  }

  list(filter?: unknown): ProjectSummary[] {
    const channelId = isObj(filter) && filter.channelId !== undefined ? checkPositiveId(filter.channelId, 'Chaîne') : null
    const rows = (
      channelId === null
        ? this.db.prepare(`${SELECT} ORDER BY p.created_at DESC, p.id DESC`).all()
        : this.db.prepare(`${SELECT} WHERE p.channel_id = ? ORDER BY p.created_at DESC, p.id DESC`).all(channelId)
    ) as unknown as ProjectRow[]
    return rows.map((r) => this.summary(r))
  }

  get(id: unknown): ProjectDetail {
    return this.detail(this.row(id))
  }

  /** The pinned document and the options it compiles with for this project (its run, its graph), its styles at their pinned versions. */
  private compileInput(r: Pick<ProjectRow, 'id' | 'recipe_id' | 'recipe_version' | 'channel_id' | 'adjustments_json'> & { pins_json?: string; inputs_json?: string }): { doc: RecipeDoc; options: CompileOptions } {
    const { doc, number } = this.recipes.doc(r.recipe_id, r.recipe_version)
    const pins = r.pins_json ? (JSON.parse(r.pins_json) as Record<string, BrickPinView>) : undefined
    // an imported script sets the video's length (QA B5)
    // read at the voice's own measured pace when the pipeline sets one (a story short)
    const pace = paceOf(doc)
    const imported = scriptMinutes(r.inputs_json ? (JSON.parse(r.inputs_json) as Record<string, string>).script : undefined, typeof pace === 'number' ? pace : undefined)
    return {
      doc,
      options: {
        channel: this.recipes.production(r.channel_id),
        project: { ...(JSON.parse(r.adjustments_json) as ProjectAdjustments), ...(imported !== null ? { minutes: imported } : {}) },
        id: `projet-${r.id}`,
        version: number,
        styles: this.recipes.styleDocs(doc, pins)
      }
    }
  }

  private compileRow(r: Pick<ProjectRow, 'id' | 'recipe_id' | 'recipe_version' | 'channel_id' | 'adjustments_json'> & { pins_json?: string; inputs_json?: string }): CompileResult {
    const { doc, options } = this.compileInput(r)
    return compileRecipe(doc, this.recipes.registry, options)
  }

  /** The graph of the project a run was launched from, compiled as its run was (null: the run has no project). */
  graphOfRun(runId: unknown): PipelineGraphView | null {
    const r = this.db.prepare(`${SELECT} WHERE p.run_id = ?`).get(checkPositiveId(runId, 'Run')) as ProjectRow | undefined
    if (!r) return null
    const { doc, options } = this.compileInput(r)
    return pipelineGraph(doc, this.recipes.registry, options)
  }

  /** The compiler's pins with each style named at its exact version (the latest one today for an unversioned name). */
  private pinStyles(pins: Pins): Record<string, BrickPinView> {
    const out: Record<string, BrickPinView> = {}
    for (const [name, p] of Object.entries(pins)) {
      let style: string | null = null
      if (p.style !== null) {
        const st = this.recipes.styles.resolve(p.style)
        style = `${st.name}@${st.version}`
      }
      out[name] = { tech: p.tech, engine: p.engine, fallbacks: [...p.fallbacks], fallbackScope: p.fallbackScope, style }
    }
    return out
  }

  create(input: ProjectCreateInput): ProjectDetail {
    if (!isObj(input)) throw new Error('Projet invalide.')
    const recipe = this.recipes.get(input.recipeId, input.recipeVersion)
    if (recipe.archived) throw new Error('Cette recette est archivée.')
    const channelId = input.channelId === null || input.channelId === undefined ? null : this.recipes.channel(input.channelId).channelId
    const title = text(input.title, 'Titre', 200)
    const inputs = input.inputs === undefined ? {} : checkRunInputs(input.inputs)
    // « J'ai mon script »: the title stands for the idea when none is given
    const idea = inputs.script && (input.idea === undefined || input.idea === '') ? title : text(input.idea, 'Idée', 2000)
    const adjustments = checkAdjustments(input.adjustments)
    const videoId = input.videoId === undefined || input.videoId === null ? null : this.videoFor(input.videoId, channelId)
    const draft = { id: 0, recipe_id: recipe.id, recipe_version: recipe.docVersion, channel_id: channelId, adjustments_json: JSON.stringify(adjustments) }
    const compiled = this.compileRow(draft)
    if (!compiled.ok) throw recipeError('Ce projet ne peut pas se fabriquer', compiled.errors)
    if (inputs.script && !compiled.pipeline.inputs.some((i) => i.id === 'script')) {
      throw new Error('Cette pipeline écrit son propre script : pour fabriquer ton script, choisis une pipeline dont l’option « Script » est « Je l’importe ».')
    }
    const pins = this.pinStyles(compiled.pins)
    const now = this.now().toISOString()
    const res = this.db
      .prepare(
        `INSERT INTO projects (recipe_id, recipe_version, channel_id, title, idea, inputs_json, adjustments_json, pins_json, video_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(recipe.id, recipe.docVersion, channelId, title, idea, JSON.stringify(inputs), JSON.stringify(adjustments), JSON.stringify(pins), videoId, now, now)
    return this.get(Number(res.lastInsertRowid))
  }

  /** A video a project may fill: it exists, belongs to the project's channel and has no other project. */
  private videoFor(raw: unknown, channelId: number | null): number {
    const id = checkPositiveId(raw, 'Vidéo')
    const v = this.db.prepare('SELECT channel_id FROM videos WHERE id = ?').get(id) as { channel_id: number } | undefined
    if (!v) throw new Error('Vidéo introuvable.')
    if (channelId === null || v.channel_id !== channelId) throw new Error('Cette vidéo est celle d’une autre chaîne.')
    if (this.db.prepare('SELECT 1 FROM projects WHERE video_id = ?').get(id)) throw new Error('Cette vidéo a déjà son projet.')
    return id
  }

  /** The project that fills a video (null: none yet). */
  forVideo(videoId: number): ProjectDetail | null {
    const r = this.db.prepare(`${SELECT} WHERE p.video_id = ? OR (p.video_id IS NULL AND v.video_id = ?) ORDER BY p.id DESC LIMIT 1`).get(videoId, videoId) as ProjectRow | undefined
    return r ? this.detail(r) : null
  }

  /**
   * The topic the team chose for a planned video (production-equipe): the video's title and brief, and its project's title
   * and idea while it is not launched — the idea is the run's topic, which a pipeline that writes its own script follows.
   */
  setVideoTopic(videoId: number, title: unknown, idea: unknown): ProjectDetail | null {
    const t = text(title, 'Titre', 200)
    const i = text(idea, 'Idée', 2000)
    const at = this.now().toISOString()
    this.db.prepare(`UPDATE videos SET title = ?, brief = ?, updated_at = ? WHERE id = ? AND status != 'published'`).run(t, i, at, videoId)
    const own = this.forVideo(videoId)
    if (!own || own.runId !== null) return own
    this.db.prepare('UPDATE projects SET title = ?, idea = ?, updated_at = ? WHERE id = ?').run(t, i, at, own.id)
    return this.get(own.id)
  }

  /**
   * A new project for a video whose run is over (production-equipe): the team remakes a video its QC refused, or one
   * that failed past a retry. Same pipeline, length and topic as the last one; nothing launched (the caller sets the
   * topic or the script, then runs it). Refused while the video's run is still going, or before any run.
   */
  remakeForVideo(videoId: number): ProjectDetail {
    const own = this.forVideo(videoId)
    if (!own) throw new Error('Cette vidéo n’a pas encore de projet : prépare-la d’abord.')
    if (own.runId === null) return own
    if (own.runStatus === null || !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(own.runStatus)) {
      throw new Error('La fabrication de cette vidéo n’est pas finie : attends sa fin (ou annule-la) avant de la refaire.')
    }
    const fresh = this.create({ recipeId: own.recipeId, channelId: own.channelId, title: own.title, idea: own.idea || own.title, adjustments: own.adjustments })
    this.db.prepare('UPDATE projects SET video_id = ?, updated_at = ? WHERE id = ?').run(videoId, this.now().toISOString(), fresh.id)
    return this.get(fresh.id)
  }

  /** The script a project carries (the owner's or the team's), or null. */
  scriptOf(id: number): string | null {
    const s = (JSON.parse(this.row(id).inputs_json) as Record<string, string>).script
    return typeof s === 'string' && s.trim() ? s : null
  }

  /** The project's pipeline reads the owner's script (option « Script » : importé). */
  takesScript(id: unknown): boolean {
    const c = this.compileRow(this.row(id))
    return c.ok && c.pipeline.inputs.some((i) => i.id === 'script')
  }

  /** Attaches a script to a project not launched yet (the `script` input of its pipeline). */
  setScript(id: unknown, script: unknown): ProjectDetail {
    const r = this.row(id)
    if (r.run_id !== null) throw new Error('Ce projet est déjà lancé : son script ne change plus.')
    const compiled = this.compileRow(r)
    if (!compiled.ok) throw recipeError('Ce projet ne peut pas se fabriquer', compiled.errors)
    if (!compiled.pipeline.inputs.some((i) => i.id === 'script')) {
      throw new Error('Cette pipeline écrit son propre script : elle ne prend pas de script importé.')
    }
    const inputs = checkRunInputs({ ...(JSON.parse(r.inputs_json) as Record<string, string>), script: text(script, 'Script', 200_000) })
    this.db.prepare('UPDATE projects SET inputs_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(inputs), this.now().toISOString(), r.id)
    return this.get(r.id)
  }

  /**
   * The planner's slot takes the oldest imported script of its channel that no video took yet (« J'ai mon script »): the
   * project is linked to the slot's video, which takes its title. Null when the video has a project already, or none waits.
   */
  adoptForVideo(channelId: number, videoId: number): ProjectDetail | null {
    if (this.forVideo(videoId)) return null
    const rows = this.db
      .prepare(`${SELECT} WHERE p.channel_id = ? AND p.video_id IS NULL AND p.run_id IS NULL ORDER BY p.created_at, p.id`)
      .all(channelId) as unknown as ProjectRow[]
    const r = rows.find((x) => {
      const s = (JSON.parse(x.inputs_json) as Record<string, string>).script
      return typeof s === 'string' && s.trim() !== ''
    })
    if (!r) return null
    const now = this.now().toISOString()
    this.db.prepare('UPDATE projects SET video_id = ?, updated_at = ? WHERE id = ?').run(videoId, now, r.id)
    this.db.prepare('UPDATE videos SET title = ?, brief = ?, updated_at = ? WHERE id = ?').run(r.title, r.idea, now, videoId)
    return this.get(r.id)
  }

  /** The project of a video, made on the channel's pipeline when it has none (the team's production step). */
  ensureForVideo(videoId: number, recipeId?: number, minutes?: number | null): ProjectDetail {
    const own = this.forVideo(videoId)
    // the length the goals plan for this video (production-equipe) is kept on a project not launched yet
    if (own && minutes && own.runId === null && own.adjustments.minutes !== minutes) return this.update(own.id, { adjustments: { ...own.adjustments, minutes } })
    if (own) return own
    const v = this.db.prepare('SELECT channel_id, title, brief FROM videos WHERE id = ?').get(videoId) as { channel_id: number; title: string; brief: string } | undefined
    if (!v) throw new Error('Vidéo introuvable.')
    const uses = this.recipes.channel(v.channel_id).recipes
    const chosen = recipeId ?? uses['avatar-long'] ?? uses.documentaire ?? uses.autre ?? uses.short
    if (chosen === undefined) {
      throw new Error('Cette chaîne n’a pas encore de pipeline : choisis-en une dans Production › Pipelines (« Utiliser pour cette chaîne »), puis relance.')
    }
    const title = v.title.trim() || `Vidéo #${videoId}`
    return this.create({ recipeId: chosen, channelId: v.channel_id, title, idea: v.brief.trim() || title, videoId, ...(minutes ? { adjustments: { minutes } } : {}) })
  }

  update(id: unknown, input: ProjectUpdateInput): ProjectDetail {
    const r = this.row(id)
    if (r.run_id !== null) throw new Error('Ce projet est déjà lancé : il ne change plus.')
    if (!isObj(input)) throw new Error('Modification invalide.')
    const title = input.title === undefined ? r.title : text(input.title, 'Titre', 200)
    const idea = input.idea === undefined ? r.idea : text(input.idea, 'Idée', 2000)
    const inputs = input.inputs === undefined ? r.inputs_json : JSON.stringify(checkRunInputs(input.inputs))
    const adjustments = input.adjustments === undefined ? r.adjustments_json : JSON.stringify(checkAdjustments(input.adjustments))
    const compiled = this.compileRow({ ...r, adjustments_json: adjustments })
    if (!compiled.ok) throw recipeError('Ce projet ne peut pas se fabriquer', compiled.errors)
    this.db
      .prepare('UPDATE projects SET title = ?, idea = ?, inputs_json = ?, adjustments_json = ?, updated_at = ? WHERE id = ?')
      .run(title, idea, inputs, adjustments, this.now().toISOString(), r.id)
    return this.get(r.id)
  }

  compile(id: unknown): RecipeCompiled {
    return compiledView(this.compileRow(this.row(id)))
  }

  /**
   * Compiles the project and starts its run (refused without a channel). A project has one run: launched again after
   * its run was interrupted (app closed), failed or cancelled, that same run is relaunched (finished steps are reused);
   * while it runs, or once it succeeded, it is refused.
   */
  async run(id: unknown, options?: ProjectRunOptions): Promise<ProjectDetail> {
    const real = realOf(options)
    const r = this.row(id)
    if (r.run_id !== null) {
      if (r.run_status === null || !RELAUNCHABLE.includes(r.run_status)) throw new Error('Ce projet est déjà lancé.')
      this.runs.retry(r.run_id)
      this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(this.now().toISOString(), r.id)
      return this.get(r.id)
    }
    const { input, pipeline, notes } = this.launchOf(r, real)
    const run = await this.runs.startDocument(input, pipeline)
    // an option that replaced the recipe's own value is kept with the run (solidite, migration 038)
    if (notes.length > 0) this.db.prepare('UPDATE video_runs SET notes_json = ? WHERE id = ?').run(JSON.stringify(notes), run.id)
    this.db.prepare('UPDATE projects SET run_id = ?, video_id = COALESCE(video_id, ?), updated_at = ? WHERE id = ?').run(run.id, run.videoId, this.now().toISOString(), r.id)
    return this.get(r.id)
  }

  /** What launching the project would cost now (`real`: as « Moteur réel » would make it), nothing spent. */
  async quote(id: unknown, options?: ProjectRunOptions): Promise<RunQuote> {
    const r = this.row(id)
    const { input, pipeline } = this.launchOf(r, realOf(options), false)
    const quote = await this.runs.quote({ ...(r.video_id !== null ? { videoId: r.video_id } : { channelId: input.channelId }), topic: input.topic, minutes: input.minutes, ...(input.style ? { style: input.style } : {}), ...(input.real ? { real: true } : {}) }, pipeline)
    return { ...quote, budgetMode: input.budgetMode }
  }

  /** The compiled pipeline of a project and the run that launches it (refused without a channel or with errors). */
  private launchOf(r: ProjectRow, real: boolean, checkInputs = true): { input: RunStartInput; pipeline: Pipeline; notes: string[] } {
    if (r.channel_id === null) throw new Error('Choisis une chaîne pour ce projet : une vidéo se fabrique pour une chaîne.')
    const compiled = this.compileRow(r)
    if (!compiled.ok) throw recipeError('Ce projet ne peut pas se fabriquer', compiled.errors)
    const p = compiled.pipeline
    const own = JSON.parse(r.inputs_json) as Record<string, string>
    // the channel's own assets the pipeline reads (its clip library, its avatar, its name) count as given
    const given = { ...(this.runs.channelAssets?.(r.channel_id, p.inputs.map((i) => i.id), own) ?? {}), ...own }
    // a required input missing is said in French before anything is created (never the engine's raw message, nor an orphan run)
    const missing = p.inputs.filter((i) => i.required && i.id !== 'topic' && !given[i.id]?.trim())
    if (checkInputs && missing.some((i) => i.id === 'script')) throw new Error(MISSING_SCRIPT)
    if (checkInputs && missing.length) throw new Error(`Il manque ${missing.map((i) => `« ${i.label} »`).join(', ')} pour fabriquer cette vidéo. Rien n’a été lancé ni facturé.`)
    // the pipeline's own language (« Documentary » in English, its French copy in French: style-markets); null: the channel's
    const language = this.compileInput(r).doc.language?.slice(0, 2) ?? null
    const input: RunStartInput = {
      ...(r.video_id !== null ? { videoId: r.video_id } : { channelId: r.channel_id, title: r.title }),
      topic: r.idea,
      minutes: p.format.minutes.default,
      budgetMode: p.budget.default,
      gateMode: 'all',
      inputs: given,
      ...(language ? { style: { language } } : {}),
      ...(real ? { real: true } : {})
    }
    return { input, pipeline: p, notes: compiled.overrides.map(overrideNote) }
  }
}

/** The French note a run keeps of an option that replaced a value its recipe set itself (solidite, never silent). */
export function overrideNote(o: OptionOverride): string {
  return t('runs.note.override', { option: o.option, path: o.path, from: String(o.from), to: String(o.to) })
}

const realOf = (o: unknown): boolean => {
  if (o === undefined || o === null) return false
  if (typeof o !== 'object' || Array.isArray(o)) throw new Error('Options de lancement invalides.')
  const real = (o as { real?: unknown }).real
  if (real !== undefined && typeof real !== 'boolean') throw new Error('Options de lancement invalides : « moteur réel » attend oui ou non.')
  return real === true
}
