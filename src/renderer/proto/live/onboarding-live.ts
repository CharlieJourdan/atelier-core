// Real mode, the onboarding: what the first-run / add-a-channel flow does for real once a backend exists. One session per
// flow (a plain class with a subscription, so it is unit-tested without React): it creates the channel, runs the channel
// analysis on a reference channel, answers the analysis' questions, makes the library pipeline, starts a test run on it and
// sets up the channel's team in the agent runtime. Every method is idempotent (going back and forth in the flow never makes
// a second channel, analysis or pipeline) and takes the IPC `call` as a dependency. Nothing here writes to YouTube and
// nothing reads a real channel: the analysis uses the app's reference channels (a real link needs Atelier Cloud).
import type { ApiArgs, ApiMethod, ApiResult } from '../../../shared/api'
import type { OrchAgent } from '../../../shared/api/orchestra'
import type { AnalysisDetail, LibraryPipelineRow, PipelineCostReport, ReferenceSummary } from '../../../shared/analysis'
import type { InputId } from '../../../shared/gauge'
import type { RunDetail, RunQuote } from '../../../shared/runs'
import type { LiveRunInput, LiveRunResult } from './registry'

export type Call = <M extends ApiMethod>(method: M, ...args: ApiArgs<M>) => Promise<ApiResult<M>>

/** What the session needs from the app: the IPC call and the existing live « start a run » path of the proto store. */
export interface OnboardingDeps {
  call: Call
  startRun: (input: LiveRunInput) => Promise<LiveRunResult>
}

let deps: OnboardingDeps | null = null

/** Registered once in the desktop app (LiveSync); null in the web demo and in unit renders. */
export function setOnboardingDeps(d: OnboardingDeps | null): void {
  deps = d
}

export function onboardingDeps(): OnboardingDeps | null {
  return deps
}

/** What the answers of the flow say about the channel (derived in screens/onboarding/live/draft.ts). */
export interface LiveDraft {
  kind: 'own' | 'translate' | 'niche' | 'idea'
  /** Readable name of the new channel. */
  name: string
  /** The niche, as text (empty when it comes from the link). */
  niche: string
  /** Where the link or the translation source is kept: the channel's standards note. */
  standards: string
  /** The link that was pasted (own channel, or the channel to translate); empty otherwise. */
  link: string
  /** Words that decide which reference channel the analysis uses (niche id, link, idea). */
  hint: string
  /** Note of a new version of the pipeline when the answers changed after it was made. */
  versionNote: string
}

export interface TestRunDraft {
  title: string
  topic: string
}

export type Phase = 'idle' | 'running' | 'done' | 'error'

export interface LiveOnboardingState {
  channelId: number | null
  analysisPhase: Phase
  analysis: AnalysisDetail | null
  /** The reference channel the analysis ran on, and whether a link was pasted (so a stand-in must be disclosed). */
  reference: { id: string; name: string; standsInForLink: boolean } | null
  /** The engine's estimate of the proposed pipeline. */
  estimate: PipelineCostReport | null
  pipeline: LibraryPipelineRow | null
  /** The quote of the test video (null while unknown or when the engine cannot quote). */
  quote: RunQuote | null
  runPhase: 'idle' | 'starting' | 'started' | 'error'
  run: RunDetail | null
  team: OrchAgent[] | null
  teamPhase: Phase
  /** Roles of the team that are paused because the user does that job herself. */
  pausedRoles: string[]
  error: string | null
}

const INITIAL: LiveOnboardingState = {
  channelId: null,
  analysisPhase: 'idle',
  analysis: null,
  reference: null,
  estimate: null,
  pipeline: null,
  quote: null,
  runPhase: 'idle',
  run: null,
  team: null,
  teamPhase: 'idle',
  pausedRoles: [],
  error: null
}

/** Which reference channel stands in for what the user described: by keywords, else the first one. */
export function pickReference(refs: readonly ReferenceSummary[], hint: string): ReferenceSummary | undefined {
  const h = hint.toLowerCase()
  const wanted = /anime|animé|top|classement|money|finance/.test(h)
    ? 'top-dix-anime'
    : /game|gaming|jeu|manette|gameplay|stream/.test(h)
      ? 'recits-manette'
      : 'archives-silencieuses'
  return refs.find((r) => r.id === wanted) ?? refs[0]
}

/** A run is « at its gate » (or over): the flow can go on. */
export function runSettled(run: RunDetail | null): boolean {
  return run !== null && (run.status === 'waiting' || run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'interrupted')
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The roles whose agents are paused when the user does the job (script, packaging). */
export const PAUSABLE_ROLES = ['scriptwriter', 'packaging'] as const

export class LiveOnboardingSession {
  private state: LiveOnboardingState = INITIAL
  private readonly listeners = new Set<() => void>()
  private channelSig = ''
  private creating: Promise<{ id: number }> | null = null
  private discarded = false
  private analysisKey = ''
  private analysisJob: Promise<void> | null = null
  private pipelineSig = ''
  private teamKey = ''
  private teamJob: Promise<void> | null = null

  constructor(private readonly deps: OnboardingDeps) {}

  getState = (): LiveOnboardingState => this.state

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private patch(p: Partial<LiveOnboardingState>): void {
    this.state = { ...this.state, ...p }
    for (const l of this.listeners) l()
  }

  private fail(err: unknown, p: Partial<LiveOnboardingState> = {}): never {
    this.patch({ ...p, error: errorText(err) })
    throw err
  }

  /** Step 3 → 4: the channel exists (created once, updated if the answers changed). */
  async ensureChannel(draft: LiveDraft): Promise<number> {
    const sig = JSON.stringify([draft.name, draft.niche, draft.standards])
    const { call } = this.deps
    try {
      if (this.discarded) throw new Error('Ajout de chaîne annulé')
      const id = this.state.channelId
      if (id === null) {
        this.creating = call('channels.create', { name: draft.name, niche: draft.niche, standards: draft.standards })
        const row = await this.creating
        this.channelSig = sig
        this.patch({ channelId: row.id, error: null })
        return row.id
      }
      if (sig !== this.channelSig) {
        await call('channels.update', id, { name: draft.name, niche: draft.niche, standards: draft.standards })
        this.channelSig = sig
      }
      this.patch({ error: null })
      return id
    } catch (err) {
      return this.fail(err)
    } finally {
      this.creating = null
    }
  }

  /**
   * « Annuler » in « Ajouter une chaîne » (Charlie 01/11: cancel created the channel anyway): the channel this flow made, if
   * any, is deleted with what hangs on it, even when its creation is still on the way. Nothing is made after this.
   */
  async discard(): Promise<void> {
    this.discarded = true
    const pending = this.creating
    if (pending) await pending.catch(() => undefined)
    const id = this.state.channelId
    if (id === null) return
    await this.deps.call('channels.discard', id)
    this.patch({ channelId: null })
  }

  /** Step 4: the analysis of the reference channel, then the examples it proposes (what the user would pick by default). */
  runAnalysis(draft: LiveDraft, retry = false): Promise<void> {
    const key = `${this.state.channelId ?? ''}|${draft.hint}|${draft.link}`
    if (!retry && key === this.analysisKey && this.analysisJob) return this.analysisJob
    this.analysisKey = key
    this.analysisJob = this.analyse(draft)
    return this.analysisJob
  }

  private async analyse(draft: LiveDraft): Promise<void> {
    const { call } = this.deps
    this.patch({ analysisPhase: 'running', analysis: null, estimate: null, pipeline: null, reference: null, error: null })
    this.pipelineSig = ''
    try {
      const refs = await call('analysis.references')
      const ref = pickReference(refs, draft.hint)
      if (!ref) throw new Error('Aucune chaîne de référence')
      const started = await call('analysis.start', { referenceId: ref.id, ...(draft.link ? { link: draft.link } : {}) })
      if (started.kind !== 'started') throw new Error('L’analyse n’a pas démarré')
      this.patch({ analysis: started.analysis, reference: { id: ref.id, name: ref.name, standsInForLink: draft.link.length > 0 } })
      await call('analysis.chooseExamples', started.analysis.id, started.analysis.reference.proposedExamples)
      const full = await call('analysis.get', started.analysis.id)
      this.patch({ analysis: full, analysisPhase: 'done' })
      await this.estimate(full)
    } catch (err) {
      this.analysisKey = ''
      this.fail(err, { analysisPhase: 'error' })
    }
  }

  private async estimate(a: AnalysisDetail): Promise<void> {
    if (!a.proposedPipelineJson) return
    try {
      this.patch({ estimate: await this.deps.call('pipelines.estimate', a.proposedPipelineJson) })
    } catch {
      this.patch({ estimate: null })
    }
  }

  /** Step 6 → 7: the answers about footage go to the analysis, then the library pipeline is made (or versioned). */
  async finishQuestions(draft: LiveDraft, answers: Partial<Record<InputId, boolean>>): Promise<LibraryPipelineRow> {
    const { call } = this.deps
    try {
      let a = this.state.analysis
      const channelId = this.state.channelId
      if (!a || channelId === null) throw new Error('Pas d’analyse terminée')
      for (const input of a.questions) {
        const value = answers[input]
        if (value !== undefined && a.answers[input] !== value) a = await call('analysis.answer', a.id, input, value)
      }
      this.patch({ analysis: a })
      await this.estimate(a)
      const sig = `${a.id}|${JSON.stringify(a.answers)}|${a.mode}`
      const made = this.state.pipeline
      if (made && sig === this.pipelineSig) return made
      let row: LibraryPipelineRow
      if (made && a.proposedPipelineJson) {
        const saved = await call('pipelines.saveVersion', made.id, a.proposedPipelineJson, draft.versionNote)
        if (!saved.ok) throw new Error(saved.problems.map((p) => p.code).join(', '))
        row = saved.pipeline
      } else {
        row = (await call('analysis.createPipeline', a.id, channelId)).pipeline
      }
      this.pipelineSig = sig
      this.patch({ pipeline: row, analysis: await call('analysis.get', a.id), error: null })
      return row
    } catch (err) {
      return this.fail(err)
    }
  }

  /** Step 7, before the launch: what the test video would cost (best effort: the engine may be unable to quote). */
  async loadQuote(): Promise<void> {
    const { pipeline, analysis } = this.state
    if (!pipeline || this.state.quote) return
    try {
      this.patch({ quote: await this.deps.call('production.quote', { pipelineId: pipeline.id, minutes: analysis?.cost?.minutes ?? 8 }) })
    } catch {
      this.patch({ quote: null })
    }
  }

  /** Step 7: the test video, a real run of the new pipeline; it stops at its first gate (step by step). */
  async startTest(draft: TestRunDraft): Promise<void> {
    const { channelId, pipeline, analysis } = this.state
    if (channelId === null || !pipeline) throw new Error('Pas de pipeline pour la vidéo test')
    if (this.state.runPhase === 'starting' || this.state.runPhase === 'started') return
    this.patch({ runPhase: 'starting', error: null })
    try {
      const res = await this.deps.startRun({
        channelId,
        title: draft.title,
        topic: draft.topic,
        minutes: analysis?.cost?.minutes ?? 8,
        gateMode: 'step',
        deadline: null,
        pipelineId: pipeline.id
      })
      const list = await this.deps.call('production.list', { channelId, limit: 5 })
      const runId = res.runId ?? list[0]?.id
      if (runId === undefined) throw new Error('La vidéo test n’a pas démarré')
      this.patch({ runPhase: 'started', run: await this.deps.call('production.get', runId) })
    } catch (err) {
      this.fail(err, { runPhase: 'error' })
    }
  }

  async refreshRun(): Promise<void> {
    const run = this.state.run
    if (!run) return
    try {
      this.patch({ run: await this.deps.call('production.get', run.id) })
    } catch {
      // a transient failure: the next poll tries again
    }
  }

  /** « Relancer » with remarks: the gate the run stopped at sends its node back with the note. */
  async sendBack(note: string): Promise<void> {
    const run = this.state.run
    const node = run?.waitingNodes[0]
    if (!run || !node) return
    try {
      this.patch({ run: await this.deps.call('production.requestChanges', run.id, node, note.trim() || 'À revoir'), error: null })
    } catch (err) {
      this.fail(err)
    }
  }

  async retryRun(): Promise<void> {
    const run = this.state.run
    if (!run) return
    try {
      this.patch({ run: await this.deps.call('production.retry', run.id), error: null })
    } catch (err) {
      this.fail(err)
    }
  }

  /** Step 8: the channel's team exists in the agent runtime; jobs the user does herself are paused. */
  setupTeam(pause: readonly string[]): Promise<void> {
    const key = `${this.state.channelId ?? ''}|${[...pause].sort().join(',')}`
    if (key === this.teamKey && this.teamJob) return this.teamJob
    this.teamKey = key
    this.teamJob = this.buildTeam(pause)
    return this.teamJob
  }

  private async buildTeam(pause: readonly string[]): Promise<void> {
    const { call } = this.deps
    const channelId = this.state.channelId
    this.patch({ teamPhase: 'running', error: null })
    try {
      if (channelId === null) throw new Error('Pas de chaîne pour l’équipe')
      await call('orchestra.seed')
      const team = (await call('orchestra.agents')).filter((a) => a.channelId === channelId)
      const paused: string[] = []
      for (const a of team) {
        const want = (PAUSABLE_ROLES as readonly string[]).includes(a.role) && pause.includes(a.role)
        if (want) paused.push(a.role)
        if (want !== a.paused && (PAUSABLE_ROLES as readonly string[]).includes(a.role)) await call('orchestra.updateAgent', a.id, { paused: want })
      }
      this.patch({ team: (await call('orchestra.agents')).filter((a) => a.channelId === channelId), teamPhase: 'done', pausedRoles: paused })
    } catch (err) {
      this.teamKey = ''
      this.fail(err, { teamPhase: 'error' })
    }
  }
}
