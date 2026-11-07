// Our production engine inside the app (lot Z1). `ProductionRuns` turns a request ("make this video") into a
// `video_runs` row and an engine run (`startRun`): artefacts on disk per video
// (`<data>/production/video-<id>/artefacts`), gate decisions in SQLite (`SqliteNodeStateStore`, scope `video-<id>`),
// the host's services (`nodeHost`: ffmpeg, system voice, working folders, our resources). Engine events update the
// node rows; the owner approves, sends back, cancels, retries, redoes or resumes. A run is DEMO unless the owner turned it
// real: the nodes' fakes for the providers (template script, system voice, drawn pictures) while the local stages really
// run; nothing is held or debited. « Moteur réel » (production-16, runs/cloud.ts): the nodes' real code, their paid
// items through Atelier Cloud's jobs (each job holds, captures or releases its credits there), each job kept with its
// node. The local-wallet path (hold the quote, capture each node's real cost, release the rest; `demo: false` in the
// deps) is lot Z1's, unit-tested with test nodes.
import path from 'node:path'
import { systemClock } from '../../../engine/errors'
import { nodeHost } from '../../../engine/host'
import type { Pipeline } from '../../../engine/pipeline-schema'
import type { NodeRegistry } from '../../../engine/registry'
import { startRun, type Run, type RunResult } from '../../../engine/scheduler'
import { FsArtefactStore } from '../../../engine/store'
import type { EngineEvent } from '../../../engine/types'
import { t } from '../../../shared/fr'
import type {
  EngineStatus,
  LibraryItem,
  RunBudgetMode,
  RunDetail,
  RunFile,
  RunGateMode,
  RunOutput,
  RunQuote,
  RunStartInput,
  RunSummary,
  RunVoices
} from '../../../shared/runs'
import { transaction, type Db } from '../../db'
import { captureCeiling, enginesOf, notSignedIn, OpenJobsRefresh, recordJob, stopIfOverQuote, type CloudRunHost } from './cloud'
import { createRun, runInputs } from './create'
import type { Live, ProductionRunsDeps } from './deps'
import { checkId, checkNote, checkQuoteInput, checkStartInput } from './inputs'
import { stopsTheRun } from './labels'
import { RunMoney, releaseHold } from './money'
import { afterRestart, markInterrupted } from './recovery'
import { applyPendingDecision } from './gates'
import { applyRunContext, contextOf, NO_CONTEXT, styleWithProfile, type RunContext } from './profile'
import { DEFAULT_RUN_STYLE, defaultRegistry, libraryPipeline, mergeStyle, resolvePipeline, templatePipeline, withSpeakers, type PipelineFactory } from './pipeline'
import { quoteRun, runPrices } from './quote'
import { applyEvent, doomedByError, refreshLiveStatus } from './recorder'
import { checkFilter, findRun, listRunRows, readNode, readNodes, readRun, toDetail, toSummary, type RunRow } from './rows'
import { finishOutputs, presenterRegistrations } from './finish'
import { SqliteNodeStateStore } from './state-store'
import { Throttle } from './throttle'
import { engineStatus, library, revealPackage, runFile, runOutput, voices } from './views'
import { runEnded, startError, videoFollowsRun } from './video-status'

export type { ProductionRunsDeps } from './deps'

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])
/** The channel assets a run takes when its pipeline reads them and was given none (the clip library, its avatar, its name). */
const CHANNEL_ASSET_INPUTS = ['gameplay', 'channelAvatar', 'channelMusic', 'channel'] as const

export class ProductionRuns {
  readonly productionDir: string
  readonly state: SqliteNodeStateStore
  private readonly registry: NodeRegistry
  private readonly pipeline: PipelineFactory
  private readonly defaultStyle: Record<string, unknown>
  private readonly demo: boolean
  private readonly live = new Map<number, Live>()
  private readonly now: () => Date
  private closed = false
  /** 'production' notifications while runs progress: at most one every `notifyEveryMs` (~4/s). */
  private readonly progressNotify: Throttle
  /** Real runs' jobs the app stopped waiting for, asked again to the Cloud (production-17). */
  private readonly openJobs: OpenJobsRefresh

  constructor(private readonly deps: ProductionRunsDeps) {
    this.productionDir = path.join(deps.dataDir, 'production')
    this.registry = deps.registry ?? defaultRegistry()
    this.pipeline = deps.pipeline ?? templatePipeline
    this.defaultStyle = deps.defaultStyle ?? DEFAULT_RUN_STYLE
    this.demo = deps.demo ?? true
    this.now = deps.now ?? (() => new Date())
    this.state = new SqliteNodeStateStore(deps.db, this.now)
    this.progressNotify = new Throttle(() => deps.notify('production'), deps.notifyEveryMs ?? 250)
    const cloudRuns = deps.cloudRuns
    const changed = (): void => {
      if (!this.closed) deps.notify('production')
    }
    this.openJobs = new OpenJobsRefresh({ db: deps.db, job: cloudRuns ? (id) => cloudRuns.job(id) : null, now: this.now, changed })
  }

  get db(): Db { return this.deps.db } // prettier-ignore

  get resourcesDir(): string { return this.deps.resourcesDir } // prettier-ignore
  get dataDir(): string { return this.deps.dataDir } // prettier-ignore

  isDemo(): boolean { return this.demo } // prettier-ignore

  artefactsDir(videoId: number): string {
    return path.join(this.productionDir, `video-${videoId}`, 'artefacts')
  }

  storeFor(videoId: number): FsArtefactStore {
    return new FsArtefactStore(this.artefactsDir(videoId))
  }

  activeIds(): number[] {
    return [...this.live.keys()]
  }

  isLive(runId: number): boolean {
    return this.live.has(runId)
  }

  /** Resolves once the run's current engine has finished and its row is final (immediately when none is live). */
  settled(runId: number): Promise<void> {
    return this.live.get(runId)?.finished ?? Promise.resolve()
  }

  // ------------------------------------------------------------------------------------------------ queries

  get(runId: unknown): RunDetail {
    const row = readRun(this.db, runId)
    // a finished real run's jobs still open here may have ended (and been captured) on the Cloud since
    if (row.cloud === 1 && !this.live.has(row.id)) this.openJobs.poke(row.id)
    return toDetail(row, readNodes(this.db, row.id), this.live.has(row.id), row.cloud === 1 ? enginesOf(this.db, row.id) : undefined)
  }

  /** Asks the Cloud now about a finished real run's open jobs (tests; the view pokes on its own). */
  refreshCloudJobs(runId: number): Promise<number> {
    return this.openJobs.refresh(runId)
  }

  /** Whether « Moteur réel » can be turned on now (the app signed in to a Cloud), and why not. */
  realState(): { available: boolean; reason: string } {
    return this.deps.cloudRuns?.state() ?? notSignedIn()
  }

  list(filter?: unknown): RunSummary[] {
    return listRunRows(this.db, checkFilter(filter)).map((r) => toSummary(r, readNodes(this.db, r.id), this.live.has(r.id)))
  }

  /** The channel's style profile and its competitors' outliers, when it has them: what the run starts from (lot "eyes"). */
  private runContext(channelId: number | undefined): RunContext {
    if (channelId === undefined) return NO_CONTEXT
    const profile = this.deps.styleProfileFor?.(channelId) ?? null
    const inspiration = this.deps.inspirationFor?.(channelId, { demo: this.demo }) ?? []
    const bricks = this.deps.bricksFor?.(channelId) ?? []
    return contextOf(profile, inspiration, bricks, this.deps.channelVoiceFor?.(channelId) ?? null, this.deps.channelPresenterFor?.(channelId) ?? null, this.deps.channelScriptStyleFor?.(channelId) ?? '')
  }

  async quote(raw: unknown, given?: Pipeline): Promise<RunQuote> {
    const input = checkQuoteInput(raw)
    const video = input.videoId !== undefined ? this.videoOf(input.videoId) : null
    const ctx = this.runContext(video?.channelId ?? input.channelId)
    const style = mergeStyle(styleWithProfile(this.defaultStyle, ctx), input.style ?? {})
    // a given document (a style sample, production-15) is quoted as `startDocument` would run it
    const doc = applyRunContext(given ? withSpeakers(structuredClone(this.deps.adaptDocument?.(given) ?? given), style) : this.docFor(input.pipelineId, input.minutes, style), ctx)
    const plan = resolvePipeline(doc, this.registry, style)
    const realState = this.realState()
    const real = input.real === true && realState.available && this.deps.cloudRuns !== undefined
    const quote = await quoteRun({
      doc,
      plan,
      minutes: input.minutes,
      style,
      ...(input.topic !== undefined ? { topic: input.topic } : {}),
      demo: real ? false : this.demo,
      reuse: video ? { store: this.storeFor(video.id), gates: { state: this.state, scope: `video-${video.id}` } } : null,
      reuseDir: path.join(this.productionDir, 'cache', 'reuse'),
      balance: real && this.deps.cloudRuns ? await this.deps.cloudRuns.balance() : this.deps.credits.balance(),
      prices: await runPrices(this.deps),
      llm: this.deps.llmQuote?.() ?? null
    })
    return { ...quote, real: realState }
  }

  /** What one node produced, for its review screen. */
  output(runId: unknown, nodeId: unknown): Promise<RunOutput> {
    return runOutput(this, runId, nodeId)
  }

  /** One artefact file of the run (refused outside its artefact folder). */
  file(runId: unknown, ref: unknown): Promise<RunFile> {
    return runFile(this, runId, ref)
  }

  library(filter?: unknown): Promise<LibraryItem[]> {
    return library(this, filter)
  }

  voices(): Promise<RunVoices> {
    return voices(this.deps.platform ?? process.platform)
  }

  engineStatus(): Promise<EngineStatus> {
    return engineStatus(this, this.deps.platform ?? process.platform, this.deps.pathEnv ?? process.env.PATH ?? process.env.Path ?? '')
  }

  /** The package a run built (which video, which folder, its title); null before it has one. */
  packageOf(runId: number): { videoId: number; packageDir: string; title: string; durationS: number | null } | null {
    const row = findRun(this.db, runId)
    return row?.package_dir ? { videoId: row.video_id, packageDir: row.package_dir, title: row.video_title || row.topic, durationS: row.duration_s } : null
  }

  revealPackage(runId: unknown): Promise<{ opened: boolean; path: string }> {
    return revealPackage(this, runId, this.deps.opener)
  }

  /** The pipeline document of a run: a library pipeline when one is chosen, else the engine's template. */
  private docFor(pipelineId: number | undefined, minutes: number, style: Record<string, unknown>): Pipeline {
    return withSpeakers(pipelineId !== undefined ? libraryPipeline(this.db, pipelineId, minutes) : this.pipeline(minutes, style), style)
  }

  // ------------------------------------------------------------------------------------------------ actions

  async start(raw: unknown): Promise<RunDetail> {
    const input = checkStartInput(raw)
    return this.begin(input, (style) => this.docFor(input.pipelineId, input.minutes, style))
  }

  /** Starts a run of a given document: a project compiled from its pinned recipe (src/main/production/recipes). */
  async startDocument(raw: unknown, pipeline: Pipeline): Promise<RunDetail> {
    const input = checkStartInput(raw)
    if (input.pipelineId !== undefined) throw new Error('Donne soit une pipeline de la bibliothèque, soit un document.')
    return this.begin(input, (style) => withSpeakers(structuredClone(this.deps.adaptDocument?.(pipeline) ?? pipeline), style))
  }

  /**
   * The channel's own assets a pipeline reads and the given inputs lack (clone-reddit-shorts: its clip library `gameplay`, its post-card
   * `channelAvatar`, its name `channel`), so a project checks its required inputs with them before launching.
   */
  channelAssets(channelId: number, inputIds: readonly string[], given: Readonly<Record<string, string>>): Record<string, string> {
    const assets: Record<string, string> = {}
    for (const id of CHANNEL_ASSET_INPUTS) {
      if (!inputIds.includes(id) || given[id]?.trim()) continue
      const value = this.deps.channelInputFor?.(channelId, id)
      if (value) assets[id] = value
    }
    return assets
  }

  private async begin(given: RunStartInput, docOf: (style: Record<string, unknown>) => Pipeline): Promise<RunDetail> {
    if (given.real === true && !this.realState().available) throw new Error(this.realState().reason)
    const video = given.videoId !== undefined ? this.videoOf(given.videoId) : null
    const channelId = video?.channelId ?? given.channelId
    const ctx = this.runContext(channelId)
    const style = mergeStyle(styleWithProfile(this.defaultStyle, ctx), given.style ?? {})
    const doc = applyRunContext(docOf(style), ctx)
    // refused before anything is created when the chosen pipeline cannot run on this engine
    resolvePipeline(doc, this.registry, style)
    if (!video) this.channelOf(given.channelId as number)
    // the channel's sponsor (production-9, decision 0025) when the pipeline reads one and the run was given none; kept in the run's
    // inputs, so « Refaire pareil » speaks of the same sponsor
    const sponsor = channelId !== undefined && doc.inputs.some((i) => i.id === 'sponsor') && !given.inputs?.sponsor?.trim() ? this.deps.channelSponsorFor?.(channelId) : null
    // the channel's clip library, its post-card avatar and its name, for a pipeline that reads them and was given none
    const assets = channelId === undefined ? {} : this.channelAssets(channelId, doc.inputs.map((i) => i.id), given.inputs ?? {})
    const filled = Object.keys(assets).length > 0 ? { ...given, inputs: { ...given.inputs, ...assets } } : given
    const input: RunStartInput = sponsor ? { ...filled, inputs: { ...filled.inputs, sponsor } } : filled
    const id = await this.createRun({ input, doc, style, video, redoOf: null })
    this.launch(id)
    this.deps.notify('production')
    return this.get(id)
  }

  /** "Refaire pareil": same pipeline, topic, length, modes, style and seeds, on a new video of the same channel. */
  async redo(runId: unknown): Promise<RunDetail> {
    const row = readRun(this.db, runId)
    this.channelOf(row.channel_id)
    const style = JSON.parse(row.style_json) as Record<string, unknown>
    const input: RunStartInput = {
      channelId: row.channel_id,
      title: row.video_title || row.topic,
      topic: row.topic,
      minutes: row.minutes,
      budgetMode: row.budget_mode,
      gateMode: row.gate_mode,
      seeds: JSON.parse(row.seeds_json) as Record<string, number>,
      inputs: JSON.parse(row.inputs_json) as Record<string, string>,
      ...(row.cloud === 1 ? { real: true } : {})
    }
    if (input.real && !this.realState().available) throw new Error(this.realState().reason)
    const id = await this.createRun({ input, doc: JSON.parse(row.pipeline_json) as Pipeline, style, video: null, redoOf: row.id })
    this.launch(id)
    this.deps.notify('production')
    return this.get(id)
  }

  /**
   * « Refaire ces étapes » (equipe-3-chaines): the same run again on the SAME video with a new seed for the nodes named, so
   * they and what depends on them are made afresh while every other step comes back from the video's cache (a real error the
   * final check measured: the voice for a break, the pictures for a repeat). Nodes not in the pipeline are ignored. With
   * `maxCredits`, refused (nothing launched) when its quote on the video's cache is above it.
   */
  async remake(runId: unknown, nodeIds: readonly string[], maxCredits?: number): Promise<RunDetail> {
    const row = readRun(this.db, runId)
    this.channelOf(row.channel_id)
    const doc = JSON.parse(row.pipeline_json) as Pipeline
    const seeds = { ...(JSON.parse(row.seeds_json) as Record<string, number>) }
    for (const id of nodeIds) if (doc.nodes.some((n) => n.id === id)) seeds[id] = (seeds[id] ?? 0) + 1
    const input: RunStartInput = {
      channelId: row.channel_id,
      title: row.video_title || row.topic,
      topic: row.topic,
      minutes: row.minutes,
      budgetMode: row.budget_mode,
      gateMode: row.gate_mode,
      seeds,
      inputs: JSON.parse(row.inputs_json) as Record<string, string>,
      ...(row.cloud === 1 ? { real: true } : {})
    }
    if (input.real && !this.realState().available) throw new Error(this.realState().reason)
    const id = await this.createRun({ input, doc, style: JSON.parse(row.style_json) as Record<string, unknown>, video: { id: row.video_id, channelId: row.channel_id }, redoOf: row.id, ...(maxCredits !== undefined ? { maxCredits } : {}) })
    this.launch(id)
    this.deps.notify('production')
    return this.get(id)
  }

  approve(runId: unknown, nodeId: unknown): RunDetail {
    const row = readRun(this.db, runId)
    const node = readNode(this.db, row.id, nodeId)
    if (node.gate !== 'waiting') throw new Error('Cette étape n’attend pas ta validation.')
    const live = this.live.get(row.id)
    if (live) {
      try {
        live.engine.approve(node.node_id)
      } catch {
        throw new Error('Cette étape n’attend plus ta validation.')
      }
      this.db.prepare("UPDATE video_run_nodes SET gate = 'approved' WHERE run_id = ? AND node_id = ?").run(row.id, node.node_id)
      refreshLiveStatus(this.db, row.id)
    } else {
      this.requireResumable(row)
      this.db
        .prepare("UPDATE video_run_nodes SET gate = 'approved', pending_decision = 'approve' WHERE run_id = ? AND node_id = ?")
        .run(row.id, node.node_id)
      this.launch(row.id)
    }
    this.deps.notify('production')
    return this.get(row.id)
  }

  requestChanges(runId: unknown, nodeId: unknown, note: unknown): RunDetail {
    const row = readRun(this.db, runId)
    const node = readNode(this.db, row.id, nodeId)
    const text = checkNote(note)
    if (node.gate !== 'waiting') throw new Error('Cette étape n’attend pas ta validation.')
    const live = this.live.get(row.id)
    if (live) {
      try {
        live.engine.requestChange(node.node_id, text)
      } catch {
        throw new Error('Cette étape n’attend plus ta validation.')
      }
      this.db
        .prepare("UPDATE video_run_nodes SET gate = 'changes_requested', change_note = ? WHERE run_id = ? AND node_id = ?")
        .run(text, row.id, node.node_id)
      refreshLiveStatus(this.db, row.id)
    } else {
      this.requireResumable(row)
      this.db
        .prepare("UPDATE video_run_nodes SET gate = 'changes_requested', change_note = ?, pending_decision = 'change' WHERE run_id = ? AND node_id = ?")
        .run(text, row.id, node.node_id)
      this.launch(row.id)
    }
    this.deps.notify('production')
    return this.get(row.id)
  }

  async cancel(runId: unknown): Promise<RunDetail> {
    const row = readRun(this.db, runId)
    const live = this.live.get(row.id)
    if (live) {
      live.engine.cancel()
      // the engine stops its nodes within its grace period; the row is final once it has
      await Promise.race([live.finished, new Promise((r) => setTimeout(r, 3_000).unref?.())])
      return this.get(row.id)
    }
    if (TERMINAL.has(row.status)) throw new Error('Cette fabrication est déjà terminée.')
    transaction(this.db, () => {
      this.db.prepare("UPDATE video_runs SET status = 'cancelled', finished_at = ? WHERE id = ?").run(this.iso(), row.id)
      this.db
        .prepare(
          `UPDATE video_run_nodes SET state = 'cancelled', pending_decision = NULL,
             gate = CASE WHEN gate = 'waiting' THEN 'none' ELSE gate END
           WHERE run_id = ? AND state IN ('pending','queued','running','waiting_gate')`
        )
        .run(row.id)
    })
    releaseHold(this.deps.credits, this.db, row.id, row.hold_id)
    runEnded(this.deps, row.id, 'cancelled', this.iso())
    this.deps.notify('production')
    return this.get(row.id)
  }

  retry(runId: unknown): RunDetail {
    const row = readRun(this.db, runId)
    if (this.live.has(row.id) || !['failed', 'cancelled', 'interrupted'].includes(row.status)) {
      throw new Error('Seule une fabrication en échec, annulée ou interrompue peut être relancée.')
    }
    this.launch(row.id)
    this.deps.notify('production')
    return this.get(row.id)
  }

  resume(runId: unknown): RunDetail {
    const row = readRun(this.db, runId)
    if (this.live.has(row.id)) return this.get(row.id)
    this.requireResumable(row)
    this.launch(row.id)
    this.deps.notify('production')
    return this.get(row.id)
  }

  /** At start-up: runs left queued/running by a quit or a crash become `interrupted` (holds given back), then are
   *  resumed by themselves (`autoResume`) or told to the team with their reason (runs/recovery.ts). */
  markInterrupted(): number {
    const ids = markInterrupted(this.db, this.deps)
    if (ids.length > 0) this.deps.notify('production')
    afterRestart({ db: this.db, deps: this.deps, ids, resume: (id) => void this.resume(id), realReady: () => this.realState().available, waitRealMs: 120_000, closed: () => this.closed })
    return ids.length
  }

  /** Quit: stop every live engine (their rows stay `running` and become `interrupted` at the next start). */
  close(): void {
    this.closed = true
    this.progressNotify.stop()
    for (const l of this.live.values()) {
      l.engine.cancel()
      void l.host.cleanup().catch(() => undefined)
    }
    this.live.clear()
    this.state.close() // engines still settling their cancel must not touch the closed database
  }

  // ------------------------------------------------------------------------------------------------ internals

  private iso(): string {
    return this.now().toISOString()
  }

  private videoOf(id: number): { id: number; channelId: number; title: string } {
    const v = this.db.prepare('SELECT id, channel_id, title FROM videos WHERE id = ?').get(checkId(id, 'Vidéo')) as
      | { id: number; channel_id: number; title: string }
      | undefined
    if (!v) throw new Error('Vidéo introuvable.')
    return { id: v.id, channelId: v.channel_id, title: v.title }
  }

  private channelOf(id: number): void {
    const c = this.db.prepare('SELECT archived_at FROM channels WHERE id = ?').get(checkId(id, 'Chaîne')) as { archived_at: string | null } | undefined
    if (!c) throw new Error('Chaîne introuvable.')
    if (c.archived_at) throw new Error('Cette chaîne est archivée.')
  }

  private requireResumable(row: RunRow): void {
    if (!['waiting', 'interrupted', 'queued', 'running'].includes(row.status)) {
      throw new Error('Cette fabrication ne peut pas être reprise : relance-la ou refais-la.')
    }
  }

  private createRun(o: Parameters<typeof createRun>[1]): Promise<number> {
    return createRun({ deps: this.deps, registry: this.registry, state: this.state, demo: this.demo, storeFor: (v) => this.storeFor(v), now: this.iso() }, o)
  }

  /** Starts an engine for the row (a new attempt): finished nodes in the store come back `cached`. */
  private launch(id: number): void {
    if (this.closed) throw new Error('Atelier se ferme : réessaie au prochain démarrage.')
    if (this.live.has(id)) throw new Error('Cette fabrication tourne déjà.')
    const row = readRun(this.db, id)
    const style = JSON.parse(row.style_json) as Record<string, unknown>
    const seeds = JSON.parse(row.seeds_json) as Record<string, number>
    const plan = resolvePipeline(JSON.parse(row.pipeline_json), this.registry, style)
    const attempt = row.attempt + 1
    // a real run's Cloud: refused before anything starts when the app is no longer signed in (nothing more is paid)
    const cloud = row.cloud === 1 ? this.cloudHost(row) : null
    let money: RunMoney | null = null
    if (row.demo === 0 && row.cloud === 0) {
      releaseHold(this.deps.credits, this.db, id, row.hold_id)
      const amount = Math.max(0, row.quote_credits - row.spent_credits)
      if (amount > 0) {
        const h = this.deps.credits.hold({ amount, idempotencyKey: `run-${id}-hold-${attempt}`, runId: id, note: `Fabrication ${id}` })
        money = new RunMoney(this.deps.credits, this.db, id, h.holdId, () => this.deps.notify('credits'), this.deps.unitPrices?.() ?? null)
        this.deps.notify('credits')
      }
    }
    this.db
      .prepare(
        "UPDATE video_runs SET status = 'running', attempt = ?, hold_id = ?, error = NULL, finished_at = NULL, started_at = COALESCE(started_at, ?) WHERE id = ?"
      )
      .run(attempt, money?.holdId ?? null, this.iso(), id)
    videoFollowsRun(this.db, row.video_id, 'running', this.iso())
    const demoCloud = // signed in, a demo run reaches the Cloud's free stock search only (decision 0109)
      row.demo === 1 && !cloud && this.realState().available ? (this.deps.cloudRuns?.forDemoRun?.({ dataDir: this.productionDir, resourcesDir: this.deps.resourcesDir }) ?? null) : null
    const host = cloud ?? demoCloud ?? (this.deps.host ?? nodeHost)({ dataDir: this.productionDir, resourcesDir: this.deps.resourcesDir })
    let engine: Run
    try {
      engine = startRun({
        plan,
        store: this.storeFor(row.video_id),
        state: this.state,
        runId: `vr-${id}-${attempt}`,
        scope: `video-${row.video_id}`,
        inputs: runInputs(row.topic, JSON.parse(row.inputs_json) as Record<string, string>),
        style,
        budgetMode: row.budget_mode as RunBudgetMode,
        gateMode: row.gate_mode as RunGateMode,
        minutes: row.minutes,
        seeds,
        useFakes: row.demo === 1,
        services: host.services,
        clock: this.deps.clock ?? systemClock,
        ...(this.deps.retry ? { retry: this.deps.retry } : {}),
        ...(money ? { spender: money.spender() } : {}),
        ...(cloud ? { spender: cloud.spender, executors: cloud.executors } : {}),
        onEvent: (e) => this.onEvent(id, e)
      })
    } catch (e) {
      void host.cleanup().catch(() => undefined)
      releaseHold(this.deps.credits, this.db, id, money?.holdId ?? null)
      const msg = startError(e)
      this.db.prepare("UPDATE video_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(msg, this.iso(), id)
      runEnded(this.deps, id, 'failed', this.iso())
      throw new Error(msg, { cause: e })
    }
    let resolveFinished!: () => void
    const finished = new Promise<void>((r) => (resolveFinished = r))
    const live: Live = { engine, host, money, finished, resolveFinished }
    this.live.set(id, live)
    void engine.done.then(
      (r) => this.finish(id, live, r),
      () => this.finish(id, live, { status: 'error', states: {} })
    )
  }

  /** The Cloud host of a real run's new attempt; marks the run failed (and throws) when the app is not signed in any more. */
  private cloudHost(row: RunRow): CloudRunHost {
    const ch = this.realState().available
      ? this.deps.cloudRuns?.forRun({
          dataDir: this.productionDir,
          resourcesDir: this.deps.resourcesDir,
          videoId: row.video_id,
          channelId: row.channel_id,
          capCredits: (JSON.parse(row.pipeline_json) as Pipeline).budget?.capCredits ?? null,
          // what an earlier attempt captured is not counted here: a node run again may reuse its jobs (stopIfOverQuote watches the captures)
          run: { ceilingCredits: captureCeiling(row.quote_credits), spentCredits: 0 },
          onJob: (nodeId, e) => {
            if (this.closed) return
            recordJob(this.db, row.id, nodeId, e, this.iso())
            stopIfOverQuote(this.db, row.id, this.live.get(row.id))
            this.progressNotify.call()
          }
        })
      : null
    if (!ch) {
      this.db.prepare("UPDATE video_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(t('runs.real.lost'), this.iso(), row.id)
      runEnded(this.deps, row.id, 'failed', this.iso())
      throw new Error(t('runs.real.lost'))
    }
    return ch
  }

  private onEvent(id: number, e: EngineEvent): void {
    if (this.closed) return
    const live = this.live.get(id)
    const a = applyEvent(this.db, id, e, this.iso())
    if (a.gone) {
      live?.engine.cancel()
      return
    }
    if (e.kind === 'done' && live?.money) live.money.nodeDone(e.nodeId, e.fingerprint, e.cost)
    if (e.kind === 'error' && live && !live.stop && stopsTheRun(e.code, e.message)) {
      live.stop = e.message
      live.engine.cancel()
    }
    if (a.gate && live) applyPendingDecision(this.db, id, a.gate, live.engine)
    if (e.kind === 'state' || e.kind === 'gate' || e.kind === 'done') refreshLiveStatus(this.db, id)
    // a node failed for good and only gates wait: the run is over, it never asks to validate a doomed video (QA B3)
    if (live && !live.stop && (e.kind === 'state' || e.kind === 'gate' || e.kind === 'error') && doomedByError(this.db, id)) {
      const failed = readNodes(this.db, id).filter((n) => n.state === 'error')
      live.stop = t('runs.error.failed', { nodes: failed.map((n) => n.label).join(', ') || '?' })
      live.engine.cancel()
    }
    if (e.kind !== 'log' && e.kind !== 'artefact') this.progressNotify.call()
  }

  private async finish(id: number, live: Live, r: RunResult): Promise<void> {
    if (this.live.get(id) === live) this.live.delete(id)
    try {
      await live.host.cleanup().catch(() => undefined)
      if (this.closed) return
      const row = findRun(this.db, id)
      if (!row) return
      const status = live.stop ? 'failed' : r.status === 'done' ? 'succeeded' : r.status === 'cancelled' ? 'cancelled' : 'failed'
      let out = { videoFile: null as string | null, packageDir: null as string | null, durationS: null as number | null }
      if (status === 'succeeded') out = await finishOutputs(this, row, readNodes(this.db, id))
      // the presenter's registrations a real run's engines returned (the HeyGen look) are kept on the channel's presenter
      if (row.cloud === 1 && this.deps.presenterRegistrations) {
        try {
          for (const regs of await presenterRegistrations(this.storeFor(row.video_id), readNodes(this.db, id))) this.deps.presenterRegistrations(row.channel_id, regs)
        } catch {
          // a convenience for the next run: this run ends the same either way
        }
      }
      if (this.closed) return
      let error: string | null = live.stop ?? null
      if (status === 'failed' && !error) {
        const failed = readNodes(this.db, id).filter((n) => n.state === 'error')
        error = t('runs.error.failed', { nodes: failed.map((n) => n.label).join(', ') || '?' })
      }
      releaseHold(this.deps.credits, this.db, id, live.money?.holdId ?? null)
      this.db
        .prepare('UPDATE video_runs SET status = ?, error = ?, finished_at = ?, video_file = COALESCE(?, video_file), package_dir = COALESCE(?, package_dir), duration_s = COALESCE(?, duration_s) WHERE id = ?')
        .run(status, error, this.iso(), out.videoFile, out.packageDir, out.durationS, id)
      runEnded(this.deps, id, status, this.iso())
      this.deps.notify('production')
      if (live.money) this.deps.notify('credits')
      if (status === 'succeeded' && out.packageDir) {
        try {
          this.deps.onPackage?.({ runId: id, videoId: row.video_id, packageDir: out.packageDir, title: row.video_title || row.topic, durationS: out.durationS })
        } catch {
          // the kit is a convenience: the run is finished either way
        }
      }
    } catch (e) {
      // solidite: a failure while closing the run (outputs, database) never leaves it « running » in silence
      if (this.closed || !findRun(this.db, id)) return
      releaseHold(this.deps.credits, this.db, id, live.money?.holdId ?? null)
      this.db.prepare("UPDATE video_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(startError(e), this.iso(), id)
      runEnded(this.deps, id, 'failed', this.iso())
      this.deps.notify('production')
    } finally {
      live.resolveFinished()
    }
  }
}
