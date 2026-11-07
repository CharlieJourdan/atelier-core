// The agent that prepares and edits pipelines (production-12, decisions 0013, 0024, 0032; docs/specs/production-model.md §10).
// Propose: the target's measured videos (a channel's own, a channel-to-launch's references, none for a concept) → the code's
// variants (src/engine/technologies/propose.ts, priced with the Cloud's engines, scored with the fit) → the agent's draft on
// top (one model call on the « pipeline » route, Opus by default; it adjusts variants only through edit operations and
// writes the summary) → the open questions. Edit: the pipeline's conversation — each message is one model turn whose only
// way to change the pipeline is the pipeline tools; a proposed batch is checked, shown as a diff with Δ cost and Δ fit, and
// saved as a new version only when the owner accepts. Every model call goes through the ledger like the other agents.
import { optionProblem, basePipeline, type EditIssue, type RecipeDoc } from '../../../engine/technologies'
import type { CostInput } from '../../../engine/technologies/cost'
import type { FitContext, VideoMeasure } from '../../../engine/technologies/fit'
import { tryEdit, type TriedEdit } from '../../../engine/technologies/pipeline-diff'
import { proposePipelines, unmeasuredDimensions, type ProposalVariant } from '../../../engine/technologies/propose'
import type { ChangeTopic } from '../../../shared/api'
import type { AgentDraft, AgentTarget, ChangeView, EditOpView, ProposalView, ProposeOptions, ThreadView, VariantKindId } from '../../../shared/pipeline-agent'
import type { RecipeDetail, RecipeDocument } from '../../../shared/recipes'
import type { Db } from '../../db'
import { EyesStore } from '../../eyes/store'
import type { AgentTools } from '../../llm/types'
import { measureVideo } from '../estimates/measure'
import type { EstimatesService } from '../estimates'
import { RecipeStore } from '../recipes'
import { ChannelSponsors } from '../sponsors'
import { assignmentView, assignChannels } from './assign'
import { pipelineText, profileText, proposalSystem, threadSystem } from './prompt'
import { ThreadStore, type ChangeRow } from './store'
import { benchTools, callPipelineTool, parseFenced, triedText, type BenchTarget, type Workbench } from './tools'

const CREDIT_EUR = 0.01

/** One model call with the pipeline tools (the api layer routes it, reserves it on the ledger, opens the MCP bridge). */
export type PipelineModel = (req: { system: (toolsOffered: boolean) => string; prompt: string; tools: AgentTools; channelId: number | null }) => Promise<{
  text: string
  model: string
  /** The provider took the tools (Claude Code through the bridge, the fake in-process); else the fenced block is read. */
  toolsOffered: boolean
}>

export interface PipelineAgentDeps {
  db: Db
  estimates: EstimatesService
  model: PipelineModel | null
  notify?: (topic: ChangeTopic) => void
  now?: () => Date
}

interface Profile {
  videos: VideoMeasure[]
  demo: boolean
  ctx: FitContext
  label: string
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const KIND_FR: Record<VariantKindId, string> = { faithful: 'fidèle', cheap: 'économique', premium: 'premium' }

export class PipelineAgentService {
  readonly recipes: RecipeStore
  private readonly eyes: EyesStore
  readonly threads: ThreadStore
  private readonly sponsors: ChannelSponsors

  constructor(private readonly deps: PipelineAgentDeps) {
    this.recipes = new RecipeStore(deps.db, undefined, deps.now)
    this.eyes = new EyesStore(deps.db)
    this.threads = new ThreadStore(deps.db, deps.now)
    this.sponsors = new ChannelSponsors({ db: deps.db, ...(deps.now ? { now: deps.now } : {}), ...(deps.notify ? { notify: () => deps.notify?.('production') } : {}) })
  }

  private get reg() {
    return this.recipes.registry
  }

  private channelName(channelId: number): string {
    const r = this.deps.db.prepare('SELECT name, niche FROM channels WHERE id = ?').get(channelId) as { name: string; niche: string } | undefined
    if (!r) throw new Error('Chaîne inconnue.')
    return r.niche ? `${r.name} (${r.niche})` : r.name
  }

  /** What the target's measured videos say (R10.1 steps 1–2). */
  profile(target: AgentTarget): Profile {
    if (target.kind === 'concept') {
      const text = typeof target.text === 'string' ? target.text.trim() : ''
      if (text.length < 3) throw new Error('Décris ton idée de chaîne en une ou deux phrases.')
      return { videos: [], demo: false, ctx: { language: target.language ?? null }, label: `Idée de chaîne : ${text.slice(0, 1500)}` }
    }
    const label = this.channelName(target.channelId)
    if (target.kind === 'channel') {
      const m = this.deps.estimates.measured(target.channelId)
      return { ...m, label: `Chaîne existante : ${label}` }
    }
    // a channel to launch: the videos of the competitors it watches are its references
    const refs = this.eyes.analyses(target.channelId).filter((a) => a.sourceKey !== 0)
    const videos = refs.map(measureVideo)
    const said = videos.map((v) => v.sponsor).filter((s): s is boolean => typeof s === 'boolean')
    return { videos, demo: refs.some((r) => r.demo), ctx: { channelHasSponsor: said.length === 0 ? null : said.includes(true) }, label: `Chaîne à lancer, d’après ses chaînes de référence : ${label}` }
  }

  // --------------------------------------------------------------------------------------------------------- propose

  /**
   * What the channel's own promo does not say yet (promo-motion): the agent asks one short question for each. An answer given here is
   * kept on the channel's asset at once; the question stays listed with its answer for this proposal.
   */
  private promoQuestions(target: AgentTarget, answers: Record<string, string> | undefined): ('place' | 'mode')[] {
    if (target.kind === 'concept') return []
    const open = this.sponsors.promoUnknowns(target.channelId)
    for (const [which, id] of [['place', 'promoPlace'], ['mode', 'promoMode']] as const) {
      const a = answers?.[id]
      if (open.includes(which) && a) this.sponsors.answerPromo(target.channelId, which, a)
    }
    return open
  }

  async propose(target: AgentTarget, o: ProposeOptions = {}): Promise<ProposalView> {
    const profiled = this.profile(target)
    const promo = this.promoQuestions(target, o.answers)
    const p = promo.length > 0 ? { ...profiled, ctx: { ...profiled.ctx, channelPromo: promo } } : profiled
    const cost = await this.deps.estimates.costInput()
    const name = target.kind === 'concept' ? 'Avatar — ma nouvelle chaîne' : `Avatar — ${this.channelName(target.channelId).replace(/ \(.*\)$/, '')}`
    const base = proposePipelines({ videos: p.videos, ctx: p.ctx, ...(cost ? { cost } : {}), name, ...(o.answers ? { answers: o.answers } : {}) }, this.reg)
    let draft = o.draft ?? null
    let agentNote: string | null = null
    let model: string | null = null
    if (o.agent && !draft) {
      if (!this.deps.model) agentNote = 'L’agent n’est pas disponible ici : voici la proposition calculée.'
      else {
        try {
          const r = await this.draft(base.variants, p, cost)
          draft = r.draft
          model = r.model
        } catch (e) {
          agentNote = `L’agent n’a pas pu répondre (${errText(e).slice(0, 200)}) : voici la proposition calculée.`
        }
      }
    }
    const variants = base.variants.map((v) => {
      const extra = draft?.ops[v.kind] ?? []
      const tried = extra.length > 0 ? this.tried(v.doc, extra, p, cost) : null
      const doc = tried?.ok ? tried.doc : v.doc
      const ops = tried?.ok ? [...v.ops, ...extra] : v.ops
      const est = tried?.ok ? tried.perMinute?.after ?? null : v.estimate?.perMinute ?? null
      return {
        kind: v.kind,
        doc: doc as unknown as RecipeDocument,
        ops: ops as unknown as EditOpView[],
        perMinute: est,
        perVideo: est ? { min: est.min * doc.format.minutes, avg: est.avg * doc.format.minutes, max: est.max * doc.format.minutes } : null,
        fit: tried?.ok ? tried.fit.after : v.fit,
        why: draft?.why[v.kind] ?? ''
      }
    })
    return {
      target,
      base: base.base,
      measured: p.videos.length,
      demo: p.demo,
      unmeasured: unmeasuredDimensions(p.videos),
      variants,
      recommended: base.recommended,
      questions: base.questions.map((q) => ({ id: q.id, choices: q.choices.map((c) => c.value), default: q.default, answer: q.answer })),
      draft,
      agentNote,
      model,
      pricesAvailable: cost !== null,
      creditEur: CREDIT_EUR
    }
  }

  private checkOption(doc: RecipeDoc) {
    const decls = basePipeline(doc.base)?.options ?? []
    return (option: string, value: unknown): string | null => optionProblem(decls, option, value)
  }

  private tried(doc: RecipeDoc, ops: readonly unknown[], p: Pick<Profile, 'videos' | 'ctx'>, cost: CostInput | null): TriedEdit | { ok: false; errors: EditIssue[] } {
    const r = tryEdit(doc, ops, this.reg, { checkOption: this.checkOption(doc) }, { ...(cost ? { cost } : {}), videos: p.videos, ctx: p.ctx })
    if (!r.ok || ops.length === 0) return r
    // a batch is tried as it would be saved (parcours-utilisateur: « cardTheme: red » applied, priced and shown, then refused on
    // « Accepter »): a value a brick does not take never reaches the owner
    const saved = this.recipes.check(r.doc)
    return saved.ok ? r : { ok: false, errors: saved.errors.map((e) => ({ op: -1, code: 'schema', message: `${e.path?.join('.') ?? ''} ${e.message}`.trim() }) as EditIssue) }
  }

  /** The agent's draft: one model call that may adjust the variants (edit operations only) and writes the summary. */
  private async draft(variants: readonly ProposalVariant[], p: Profile, cost: CostInput | null): Promise<{ draft: AgentDraft; model: string }> {
    const docs = new Map(variants.map((v) => [v.kind as string, v.doc]))
    const extra: Partial<Record<VariantKindId, EditOpView[]>> = {}
    const pick = (at: BenchTarget): RecipeDoc => {
      const d = docs.get(at.variant ?? 'faithful')
      if (!d) throw new Error('variant: faithful, cheap or premium (one of those proposed)')
      return d
    }
    const bench: Workbench = {
      read: (at) => {
        const d = pick(at)
        const r = this.tried(d, [], p, cost)
        return pipelineText(d, r.ok ? r.perMinute?.after ?? null : null, r.ok ? r.fit.after : null)
      },
      tryOps: (at, ops) => this.tried(pick(at), ops, p, cost),
      propose: (at, ops) => {
        const kind = (at.variant ?? 'faithful') as VariantKindId
        const r = this.tried(pick(at), ops, p, cost)
        if (!r.ok) return r
        docs.set(kind, r.doc)
        extra[kind] = [...(extra[kind] ?? []), ...(ops as EditOpView[])]
        return { ok: true, text: `Applied to « ${kind} ».\n${triedText(r)}` }
      }
    }
    const listing = variants.map((v) => `### ${v.kind}${v.kind === 'faithful' ? ' (recommended)' : ''}\n${pipelineText(v.doc, v.estimate?.perMinute ?? null, v.fit)}`).join('\n\n')
    const prompt = [`${p.label}`, `Measured videos (the eyes):\n${profileText(p.videos)}`, `Variants the code built:\n\n${listing}`].join('\n\n')
    const res = await this.callModel({ system: proposalSystem, prompt, tools: benchTools(bench, 'variant'), channelId: null })
    const f = parseFenced(res.text, 'atelier-proposal')
    const block = f.block ?? {}
    // without tools, the block's ops are checked the same way (an invalid batch is dropped, never half applied)
    if (!res.toolsOffered && isRecord(block.ops)) {
      for (const [kind, ops] of Object.entries(block.ops)) if (Array.isArray(ops) && docs.has(kind)) bench.propose({ variant: kind }, ops, '')
    }
    const why: Partial<Record<VariantKindId, string>> = {}
    if (isRecord(block.why)) for (const [k, v] of Object.entries(block.why)) if (docs.has(k) && typeof v === 'string') why[k as VariantKindId] = v.slice(0, 300)
    const summary = typeof block.summary === 'string' ? block.summary.slice(0, 1200) : f.text.slice(0, 1200)
    return { draft: { summary, why, ops: extra }, model: res.model }
  }

  private async callModel(req: Parameters<PipelineModel>[0]): ReturnType<PipelineModel> {
    if (!this.deps.model) throw new Error('L’agent n’est pas disponible ici.')
    return this.deps.model(req)
  }

  /** The chosen variant becomes the team's pipeline (a first version), with its conversation started and its channels. */
  adopt(input: { doc: RecipeDocument; kind: VariantKindId; summary?: string; channelIds?: number[] }): RecipeDetail {
    if (!isRecord(input) || !(input.kind in KIND_FR)) throw new Error('Proposition invalide.')
    const d = this.recipes.save({ doc: input.doc, note: `Proposée par l’agent (variante ${KIND_FR[input.kind]})` })
    const summary = typeof input.summary === 'string' && input.summary.trim() ? input.summary.trim() : `Pipeline préparée par l’agent, variante ${KIND_FR[input.kind]}.`
    this.threads.addMessage(d.id, 'agent', `${summary}\n\nDis-moi ce que tu veux changer (par exemple « moins cher », « plus de présentateur », « sous-titres »).`)
    if (Array.isArray(input.channelIds) && input.channelIds.length > 0) assignChannels(this.recipes, d.id, input.channelIds)
    this.deps.notify?.('production')
    return this.recipes.get(d.id)
  }

  // --------------------------------------------------------------------------------------------------------- thread

  private latest(recipeId: number): { doc: RecipeDoc; number: number } {
    return this.recipes.doc(recipeId)
  }

  private fitProfile(channelId: number | null | undefined): Pick<Profile, 'videos' | 'ctx'> {
    return channelId === null || channelId === undefined ? { videos: [], ctx: {} } : this.deps.estimates.measured(channelId)
  }

  private async changeView(row: ChangeRow, channelId: number | null | undefined, cost: CostInput | null): Promise<ChangeView> {
    const ops = JSON.parse(row.ops_json) as EditOpView[]
    let tried: TriedEdit | null = null
    let defaults: Record<string, unknown> = {}
    try {
      const doc = this.recipes.doc(row.recipe_id, row.base_version).doc
      defaults = Object.fromEntries((basePipeline(doc.base)?.options ?? []).map((o) => [o.id, o.default]))
      const r = this.tried(doc, ops, this.fitProfile(channelId), cost)
      if (r.ok) tried = r
    } catch {
      // a version that no longer loads: the change is listed without its diff
    }
    return {
      id: row.id,
      status: row.status,
      author: row.author,
      note: row.note,
      ops,
      // an option left at its default is not in the document: show the default it had (or goes back to)
      changes: (tried?.changes ?? []).map((c) => (c.kind === 'option' && c.key && c.key in defaults ? { ...c, before: c.before ?? defaults[c.key], after: c.after ?? defaults[c.key] } : c)),
      perMinute: tried?.perMinute ?? null,
      fit: tried?.fit ?? { before: null, after: null },
      baseVersion: row.base_version,
      savedVersion: row.saved_version,
      createdAt: row.created_at
    }
  }

  async thread(recipeId: number, channelId?: number | null): Promise<ThreadView> {
    const { number } = this.latest(recipeId)
    const cost = await this.deps.estimates.costInput()
    const rows = this.threads.changes(recipeId, 10)
    const changes = await Promise.all(rows.map((r) => this.changeView(r, channelId, cost)))
    const messages = this.threads.messages(recipeId).map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      changeId: m.change_id,
      errors: m.errors_json ? (JSON.parse(m.errors_json) as ThreadView['messages'][number]['errors']) : [],
      createdAt: m.created_at
    }))
    return { recipeId, version: number, messages, pending: changes.find((c) => c.status === 'pending') ?? null, changes, creditEur: CREDIT_EUR }
  }

  /** The workbench of one pipeline: `propose` stages a pending change (`author`: the pipeline's agent or a team agent). */
  bench(recipeId: number | null, channelId: number | null | undefined, cost: CostInput | null, author: ChangeRow['author'], onRefused?: (errors: EditIssue[]) => void, onProposed?: (id: number) => void): Workbench {
    const idOf = (at: BenchTarget): number => {
      const id = recipeId ?? at.pipeline
      if (typeof id !== 'number') throw new Error('pipeline: the id of a team pipeline')
      return id
    }
    const profile = this.fitProfile(channelId)
    return {
      read: (at) => {
        const { doc } = this.latest(idOf(at))
        const r = this.tried(doc, [], profile, cost)
        return pipelineText(doc, r.ok ? r.perMinute?.after ?? null : null, r.ok ? r.fit.after : null)
      },
      tryOps: (at, ops) => this.tried(this.latest(idOf(at)).doc, ops, profile, cost),
      propose: (at, ops, note) => {
        const id = idOf(at)
        const { doc, number } = this.latest(id)
        const r = this.tried(doc, ops, profile, cost)
        if (!r.ok) {
          onRefused?.(r.errors)
          return r
        }
        if (r.changes.length === 0) return { ok: false, errors: [{ op: -1, code: 'bad_op', message: 'these operations change nothing' }] }
        const changeId = this.threads.addChange(id, number, ops, note || 'Modification proposée', author)
        onProposed?.(changeId)
        if (author === 'team') this.threads.addMessage(id, 'system', `Un agent de l’équipe propose : ${note || 'une modification'}.`, changeId)
        this.deps.notify?.('production')
        return { ok: true, text: `Proposed to the owner as change #${changeId} (waiting for their answer).\n${triedText(r)}` }
      }
    }
  }

  /** The pipeline tools for the team agents of the runtime (orchestra `pipeline.*`): any team pipeline, by id. */
  async teamBench(): Promise<Workbench> {
    return this.bench(null, null, await this.deps.estimates.costInput(), 'team')
  }

  /** One message to the pipeline's agent: one model turn; a valid proposed batch becomes the pending change. */
  async say(recipeId: number, text: string, channelId?: number | null): Promise<ThreadView> {
    const message = typeof text === 'string' ? text.trim() : ''
    if (!message) throw new Error('Écris un message à l’agent.')
    const { doc } = this.latest(recipeId)
    this.threads.addMessage(recipeId, 'user', message.slice(0, 4000))
    const cost = await this.deps.estimates.costInput()
    // what the turn's tools did (set from their callbacks)
    const turn: { refused: EditIssue[]; proposed: number | null } = { refused: [], proposed: null }
    const bench = this.bench(recipeId, channelId, cost, 'agent', (e) => (turn.refused = e), (id) => (turn.proposed = id))
    const before = this.tried(doc, [], this.fitProfile(channelId), cost)
    const history = this.threads
      .messages(recipeId, 20)
      .map((m) => `${m.role === 'user' ? 'Owner' : m.role === 'agent' ? 'You' : 'App'}: ${m.text}`)
      .join('\n')
    const prompt = [pipelineText(doc, before.ok ? before.perMinute?.after ?? null : null, before.ok ? before.fit.after : null), `Conversation (latest last):\n${history}`].join('\n\n')
    try {
      const res = await this.callModel({ system: threadSystem, prompt, tools: benchTools(bench, 'none'), channelId: channelId ?? null })
      const f = parseFenced(res.text, 'atelier-ops')
      if (turn.proposed === null && f.block && Array.isArray(f.block.ops)) {
        callPipelineTool(bench, 'pipeline_propose', { ops: f.block.ops, note: typeof f.block.note === 'string' ? f.block.note : '' })
      }
      // the price is the code's: said under the agent's words, measured on the proposed batch
      const change = turn.proposed !== null ? this.threads.change(recipeId, turn.proposed) : null
      const tried = change ? this.tried(doc, JSON.parse(change.ops_json) as unknown[], this.fitProfile(channelId), cost) : null
      const price = tried?.ok && tried.perMinute ? priceLine(tried.perMinute.before.avg, tried.perMinute.after.avg) : ''
      const refused = turn.proposed === null && turn.refused.length > 0 ? 'Ce changement n’est pas possible tel quel, rien n’a changé : ' + turn.refused.map((e) => e.message).join(' ; ').slice(0, 300) : ''
      const answer = refused || [f.text || (turn.proposed !== null ? 'Voici ma proposition.' : 'Je n’ai rien changé.'), price].filter(Boolean).join('\n\n')
      this.threads.addMessage(recipeId, 'agent', answer, turn.proposed, turn.proposed === null ? turn.refused : [])
    } catch (e) {
      this.threads.addMessage(recipeId, 'system', `L’agent n’a pas pu répondre : ${errText(e).slice(0, 300)}`)
    }
    this.deps.notify?.('production')
    return this.thread(recipeId, channelId)
  }

  /** Saves the pending change as a new version (re-checked on the latest version: an edit saved meanwhile is kept). */
  async accept(recipeId: number, changeId: number): Promise<ThreadView> {
    const row = this.threads.change(recipeId, changeId)
    if (row.status !== 'pending') throw new Error('Cette modification n’attend plus de réponse.')
    const ops = JSON.parse(row.ops_json) as unknown[]
    const d = this.recipes.edit(recipeId, ops, `Agent : ${row.note}`)
    this.threads.decide(row.id, 'accepted', d.docVersion)
    this.threads.addMessage(recipeId, 'system', `Modification acceptée : version ${d.docVersion} enregistrée.`, row.id)
    this.deps.notify?.('production')
    return this.thread(recipeId)
  }

  async reject(recipeId: number, changeId: number): Promise<ThreadView> {
    const row = this.threads.change(recipeId, changeId)
    if (row.status !== 'pending') throw new Error('Cette modification n’attend plus de réponse.')
    this.threads.decide(row.id, 'rejected')
    this.threads.addMessage(recipeId, 'system', 'Modification refusée : la pipeline ne change pas.', row.id)
    this.deps.notify?.('production')
    return this.thread(recipeId)
  }

  assignment(recipeId: number) {
    return assignmentView(this.deps.db, this.recipes, recipeId)
  }

  assign(recipeId: number, channelIds: number[]) {
    assignChannels(this.recipes, recipeId, channelIds)
    this.deps.notify?.('production')
    return assignmentView(this.deps.db, this.recipes, recipeId)
  }
}

/** « Prix : 0,58 → 1,50 crédit la minute (+158 %) », from the code's numbers. */
export function priceLine(before: number, after: number): string {
  const n = (x: number): string => (Math.round(x * 100) / 100).toLocaleString('fr-FR')
  const pct = before > 0 ? Math.round(((after - before) / before) * 100) : null
  if (Math.abs(after - before) < 0.005) return `Prix : inchangé (${n(after)} crédit la minute).`
  return `Prix : ${n(before)} → ${n(after)} crédit la minute${pct === null ? '' : ` (${pct > 0 ? '+' : '−'}${Math.abs(pct)} %)`}.`
}
