// Proposals: actions an agent suggests and only the owner can confirm (a proposal card in the chat). Confirming a
// create_video proposal creates the video; the runner then starts its research. Confirming a production proposal
// (lot 13: analyse a channel, run a pipeline on its quote, retry a node, cancel a run) calls the ProductionPort.
import { PROPOSAL_KINDS, type CreateVideoPayload, type ProposalKind, type ProposalRow, type ProposalStatus } from '../../shared/agents'
import type { BudgetMode } from '../../engine/types'
import type { Db } from '../db'
import type { ChatStore } from '../chat/store'
import { QuoteExpiredError, type ProductionPort } from '../production/port'
import type { WorkflowEngine } from '../workflow/engine'

interface ProposalDb {
  id: number
  conversation_id: number | null
  message_id: number | null
  kind: string
  payload: string
  status: ProposalStatus
  decided_at: string | null
  created_at: string
}

export interface NewProposal {
  conversationId: number
  /** Role posting the card. */
  authorId: string
  kind: ProposalKind
  title: string
  detail: string
  data?: Record<string, unknown>
}

export const MAX_PROPOSAL_TEXT = 2000

export class ProposalsStore {
  constructor(
    private readonly db: Db,
    private readonly chat: ChatStore,
    private readonly workflow: WorkflowEngine,
    /** Called after a decision (the runner kicks in to start new tasks). */
    private readonly onDecided: (p: ProposalRow) => void = () => undefined,
    /** Runs the production proposals; absent: they cannot be confirmed. */
    private readonly production: ProductionPort | null = null,
    private readonly now: () => number = Date.now
  ) {}

  create(input: NewProposal): ProposalRow {
    const title = input.title.trim().slice(0, 200)
    const detail = input.detail.trim().slice(0, MAX_PROPOSAL_TEXT)
    if (!title) throw new Error('A proposal needs a title')
    const payload = { title, detail, ...(input.data ?? {}) }
    const r = this.db
      .prepare('INSERT INTO proposals (conversation_id, kind, payload) VALUES (?, ?, ?)')
      .run(input.conversationId, input.kind, JSON.stringify(payload))
    const id = Number(r.lastInsertRowid)
    const msg = this.chat.post(input.conversationId, {
      authorType: 'agent',
      authorId: input.authorId,
      body: '',
      card: { type: 'proposal', proposalId: id, title, detail }
    })
    this.db.prepare('UPDATE proposals SET message_id = ? WHERE id = ?').run(msg.id, id)
    return this.get(id)
  }

  get(id: number): ProposalRow {
    const r = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as unknown as ProposalDb | undefined
    if (!r) throw new Error(`Unknown proposal: ${String(id)}`)
    return toProposal(r)
  }

  /**
   * The owner's decision. Confirming runs the action; if it fails the proposal stays pending (an expired quote marks it
   * expired: a new quote is needed).
   */
  async decide(id: number, accept: boolean): Promise<ProposalRow> {
    if (!Number.isInteger(id)) throw new Error('proposalId must be an integer')
    if (typeof accept !== 'boolean') throw new Error('accept must be true or false')
    const p = this.get(id)
    // Claim the decision first (a double click or a crash mid-way never runs the action twice).
    const claimed = this.db
      .prepare(
        `UPDATE proposals SET status = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'pending'`
      )
      .run(accept ? 'accepted' : 'rejected', id)
    if (Number(claimed.changes) === 0) throw new Error(`Proposal ${id} is already ${p.status}`)
    const conversationId = p.conversationId
    let note = accept ? `You confirmed: ${p.title}.` : `You dismissed: ${p.title}.`
    if (accept && p.kind !== 'other') {
      try {
        note = await this.apply(p)
      } catch (err) {
        // Nothing was done (archived channel, refused run…): the owner can try again or dismiss; an expired quote ends it.
        const status = err instanceof QuoteExpiredError ? 'expired' : 'pending'
        this.db.prepare(`UPDATE proposals SET status = ?, decided_at = NULL WHERE id = ?`).run(status, id)
        if (err instanceof QuoteExpiredError && conversationId !== null) this.chat.post(conversationId, { authorType: 'system', body: err.message })
        throw err
      }
    }
    if (conversationId !== null) this.chat.post(conversationId, { authorType: 'system', body: note })
    const row = this.get(id)
    this.onDecided(row)
    return row
  }

  /** Runs a confirmed proposal; returns the line posted in its conversation. */
  private async apply(p: ProposalRow): Promise<string> {
    const data = p.payload
    if (p.kind === 'create_video') {
      const v = data as unknown as CreateVideoPayload
      const videoId = this.workflow.createVideo(v.channelId, { title: v.title, brief: v.brief }).video.id
      this.setPayload(p, { resultVideoId: videoId })
      const videoChat = this.chat.open({ kind: 'video', videoId })
      this.chat.post(videoChat.id, { authorType: 'system', body: `Video created from the Supervisor chat. Brief: ${v.brief || '(none)'}` })
      return `You confirmed: ${p.title}. The video is created and research starts now.`
    }
    const port = this.production
    if (!port?.available) throw new Error('La production n’est pas encore branchée : rien n’a été lancé.')
    switch (p.kind) {
      case 'run_pipeline': {
        // The quote and the video are checked here too: the card may have waited.
        if (typeof data.expiresAt === 'string' && Date.parse(data.expiresAt) <= this.now()) throw new QuoteExpiredError(String(data.quoteId))
        const video = this.workflow.getVideo(Number(data.videoId))
        if (video.status === 'cancelled' || video.status === 'published') throw new Error(`La vidéo #${video.id} est ${video.status === 'cancelled' ? 'annulée' : 'publiée'} : rien n’a été lancé.`)
        const req = {
          videoId: Number(data.videoId),
          mode: data.mode as BudgetMode,
          ...(typeof data.pipeline === 'string' ? { pipeline: data.pipeline } : {})
        }
        const run = await port.runPipeline(req, String(data.quoteId))
        this.setPayload(p, { runId: run.id })
        return `Tu as confirmé : ${p.title}. Production lancée (${run.id}).`
      }
      case 'analyse_channel': {
        const started = await port.analyseChannel({ url: String(data.url) }, String(data.quoteId))
        this.setPayload(p, { analysisId: started.id })
        return `Tu as confirmé : ${p.title}. ${started.summary}`
      }
      case 'retry_node': {
        const run = await port.retryNode(String(data.runId), String(data.nodeId))
        return `Tu as confirmé : ${p.title}. L’étape repart (${run.id}).`
      }
      case 'cancel_run': {
        const run = await port.cancelRun(String(data.runId))
        return `Tu as confirmé : ${p.title}. Production arrêtée (${run.id}).`
      }
      default:
        throw new Error(`Proposal kind ${p.kind} cannot be confirmed`)
    }
  }

  private setPayload(p: ProposalRow, extra: Record<string, unknown>): void {
    this.db.prepare('UPDATE proposals SET payload = ? WHERE id = ?').run(JSON.stringify({ ...p.payload, ...extra }), p.id)
  }

  /** Live status for proposal cards. */
  statusOf(id: number): ProposalStatus | null {
    const r = this.db.prepare('SELECT status FROM proposals WHERE id = ?').get(id) as { status: ProposalStatus } | undefined
    return r?.status ?? null
  }
}

function toProposal(r: ProposalDb): ProposalRow {
  let payload: Record<string, unknown> = {}
  try {
    const v: unknown = JSON.parse(r.payload)
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) payload = v as Record<string, unknown>
  } catch {
    // keep {}
  }
  const kind: ProposalKind = (PROPOSAL_KINDS as readonly string[]).includes(r.kind) ? (r.kind as ProposalKind) : 'other'
  return {
    id: r.id,
    conversationId: r.conversation_id,
    messageId: r.message_id,
    kind,
    title: typeof payload.title === 'string' ? payload.title : '',
    detail: typeof payload.detail === 'string' ? payload.detail : '',
    payload,
    status: r.status,
    resultVideoId: typeof payload.resultVideoId === 'number' ? payload.resultVideoId : null,
    decidedAt: r.decided_at,
    createdAt: r.created_at
  }
}
