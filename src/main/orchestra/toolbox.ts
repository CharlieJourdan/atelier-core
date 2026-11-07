// The tools of ONE runtime turn: the agent's technologies (technologies.ts) as MCP tool specs, and their handlers. A tool
// the agent was not granted is never offered, and is refused if called anyway (a model may invent a name; the FakeProvider
// in tests calls any name): « not one of <agent>'s technologies ». Arguments come from a model and are all checked; each
// turn has small quotas. A side effect (a channel created, a run started) is written to orch_effects with its task, so a
// turn retried after a crash or a restart gets the first result back instead of doing it twice.
import { readFileSync } from 'node:fs'
import type { ChannelGoalsInput } from '../../shared/api/autopilot'
import type { OrchTask } from '../../shared/api/orchestra'
import type { AgentTools, ToolCallResult, ToolSpec } from '../llm/types'
import type { RuntimeParts } from './parts'
import { isActionRight, technologiesOf, technologyOfTool, toolSpec } from './technologies'
import { int, need, opt, type Handler, type ToolCtx } from './tool-args'
import { productionList } from './tools-inprogress'
import { WORK_TOOLS, spentThisMonth } from './tools-work'
import { PROJECT_TOOLS } from './tools-project'
import { BRICK_TOOLS } from '../bricks/tools'
import { PIPELINE_TOOLS } from './tools-pipeline'
import { STYLE_TOOLS } from './tools-style'
import { ORDER_TOOLS } from './tools-orders'
import type { AgentRecord } from './tree'
import { iso, isRecord, truncate } from './util'

export type { ToolCtx } from './tool-args'

/** What the tools reach: the runtime's parts (its memory layers, services, team and eyes folders). */
export type ToolboxEnv = RuntimeParts

/** Calls of one tool per turn. */
const QUOTA: Record<string, number> = { 'pipeline.propose': 2, 'goals.propose': 2, 'eyes.look': 3, 'channel.read': 1, 'channel.create': 1, 'production.start': 1, 'project.run': 1, 'script.save': 3, 'files.save': 5, 'bricks.draft': 6, 'bricks.preview': 4, 'bricks.propose': 1, 'videos.order': 1 }
const DEFAULT_QUOTA = 8
const MAX_IMAGE_BYTES = 1_500_000

const YES = /^(oui|ok|okay|valider|valide|validé|approuver|approuvé|confirmer|confirmé|go|d['’]accord|yes|approve|accept)/i

/** Charlie said yes in this task (a choice or a text answer to the agent's question); an approval level's is not his. */
export function approvedIn(task: OrchTask): boolean {
  const human = Array.isArray(task.payload.human) ? (task.payload.human as unknown[]) : []
  return human.some((h) => isRecord(h) && h.auto !== true && ((typeof h.choice === 'string' && YES.test(h.choice.trim())) || (typeof h.text === 'string' && YES.test(h.text.trim()))))
}

const TEAM_TOOLS: Record<string, Handler> = {
  'dashboard.read': (c) => dashboard(c),
  'production.list': (c, a) => productionList(c, a),
  'memory.workspace': (c, a) => {
    const line = need(a.text, 'text', 400)
    c.env.context.addLine('workspace', null, line, `agent:${c.agent.slug}`)
    return 'Added to the workspace memory.'
  },
  'memory.channel': (c, a) => {
    const channelId = a.channel === undefined ? c.channelId : int(a.channel, 'channel')
    if (channelId === null) throw new Error('No channel: give its id')
    if (c.agent.channelId !== null && channelId !== c.agent.channelId) throw new Error('You can only write the memory of your own channel')
    c.env.context.addLine('channel', channelId, need(a.text, 'text', 400), `agent:${c.agent.slug}`)
    return 'Added to the channel memory.'
  },
  'goals.propose': (c, a) => {
    if (c.channelId === null) throw new Error('Goals belong to a channel: you have none')
    const reasons = need(a.reasons, 'reasons', 1200)
    // time and budget only: the approval level is Charlie's alone
    const input = { slots: a.slots, formats: a.formats, budgetCredits: a.budgetCredits, deadlines: a.deadlines } as ChannelGoalsInput
    const g = c.env.goals.agentPropose(c.channelId, input, reasons)
    return `Proposed to Charlie (still a draft until he confirms): ${g.slots.length} slot(s) a week, ${g.budgetCredits} credits a month.`
  },
  'channel.create': (c, a) => {
    const done = c.effect('channel')
    if (isRecord(done)) return `Already done in this task: channel #${String(done.id)} « ${String(done.name)} », its lead is ${String(done.lead)}. Delegate to it.`
    if (!c.approved()) throw new Error('Charlie has not validated this channel yet: ask him first (ask_human, kind validate), then create it in your next turn')
    const ch = c.env.services.channels
    if (!ch) throw new Error('Creating channels is not available here')
    const name = need(a.name, 'name', 80)
    if (ch.list().some((x) => x.name.trim().toLowerCase() === name.toLowerCase())) throw new Error(`A channel is already called ${name}`)
    const from = a.translateFrom === undefined ? null : ch.list().find((x) => x.id === int(a.translateFrom, 'translateFrom')) ?? null
    if (a.translateFrom !== undefined && !from) throw new Error(`Unknown channel to translate: ${String(a.translateFrom)}`)
    const language = opt(a.language, 'language', 12)
    const niche = opt(a.niche, 'niche', 200) ?? from?.niche ?? ''
    const standards = [from ? `Traduction de « ${from.name} »${language ? ` en ${language}` : ''}.` : '', from?.standards ?? ''].filter(Boolean).join('\n')
    const row = ch.create({ name, niche, standards, ...(from?.scriptStyle ? { scriptStyle: from.scriptStyle } : {}), ...(from?.thumbnailStyle ? { thumbnailStyle: from.thumbnailStyle } : {}) })
    const audience = opt(a.audience, 'audience', 300)
    const notes = opt(a.notes, 'notes', 1500)
    // The channel block was written by the create path; the agent's facts (language, source, audience) come on top.
    const cur = c.env.context.channel(row.id)
    const extra = [language ? `Langue : ${language}` : '', from ? `Traduit la chaîne : ${from.name} (#${from.id})` : '', audience ? `Public : ${audience}` : '', notes ?? ''].filter(Boolean)
    if (extra.length) c.env.context.save('channel', row.id, [cur.text, ...extra].filter(Boolean).join('\n'), `agent:${c.agent.slug}`)
    const lead = c.env.tree.bySlug(`lead-${row.id}`)
    const result = { id: row.id, name: row.name, lead: lead?.slug ?? null }
    c.remember('channel', result)
    return `Channel #${row.id} « ${row.name} » created with its team and its channel memory. Its lead is ${lead?.slug ?? '(not seeded)'}: delegate to it (to: "${lead?.slug ?? ''}").`
  }
}

/** A channel's production credits this month against its monthly budget (its goals). */
function budgetOf(c: ToolCtx, channelId: number, name: string): string {
  const goals = c.env.goals.get(channelId)
  const spent = spentThisMonth(c, channelId)
  return goals ? `#${channelId} ${name}: ${spent} of ${goals.budgetCredits} credits` : `#${channelId} ${name}: ${spent} credits (no budget set)`
}

function dashboard(c: ToolCtx): string {
  const p = c.env
  const channels = c.env.services.channels?.list() ?? []
  const counts = p.queue.counts()
  const agents = p.tree.list()
  const by = (s: string): number => agents.filter((a) => a.status === s).length
  const runs = c.env.services.production?.list({ limit: 10 }) ?? []
  const spent = (p.db.prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS s FROM ledger WHERE status = 'settled' AND created_at >= ?`).get(iso(Date.UTC(new Date(p.now()).getUTCFullYear(), new Date(p.now()).getUTCMonth(), 1))) as { s: number }).s
  return [
    `Channels (${channels.length}): ${channels.map((x) => `#${x.id} ${x.name}${x.niche ? ` (${x.niche})` : ''}`).join(', ') || 'none'}`,
    `Team: ${agents.length} agents · ${by('working')} working · ${by('waiting')} waiting · ${by('idle')} idle · ${by('paused')} paused · ${by('error')} in error`,
    `Queue: ${counts.queued ?? 0} queued, ${(counts.leased ?? 0) + (counts.running ?? 0)} running, ${counts.waiting ?? 0} waiting, ${counts.waiting_human ?? 0} waiting for Charlie, ${counts.dead ?? 0} stopped`,
    `Charlie's inbox: ${p.inbox.openCount()} open item(s)`,
    `Runs: ${runs.map((r) => `#${r.id} ${r.status}${r.waitingNodes?.length ? ` (gate: ${r.waitingNodes.join(', ')})` : ''}`).join(', ') || 'none'}`,
    `Claude turns this month: $${spent.toFixed(2)} in API-price equivalent, paid by the Claude subscription (never by the channels' budgets)`,
    // production money is each channel's own budget (its goals) against its runs' credits (production-equipe: the team
    // read the subscription's token-equivalent as production spend and refused to produce)
    `Production budgets this month: ${channels.map((x) => budgetOf(c, x.id, x.name)).join(', ') || 'none'}`
  ].join('\n')
}

export class Toolbox {
  readonly granted: string[]
  readonly specs: ToolSpec[]
  readonly uses: { tool: string; ok: boolean }[] = []
  /** A tool put something in Charlie's inbox for this task: the turn ends waiting for his answer. */
  waitsForHuman = false
  private readonly used = new Map<string, number>()
  private readonly ctx: ToolCtx

  constructor(
    env: ToolboxEnv,
    readonly agent: AgentRecord,
    task: OrchTask,
    signal: AbortSignal,
    /** Every tool call proves the turn is alive (the heartbeat of a turn that streams no text while it uses tools). */
    private readonly onActivity: () => void = () => undefined
  ) {
    this.granted = technologiesOf(agent)
    this.specs = this.granted.map(toolSpec).filter((s): s is ToolSpec => s !== null)
    const p = env
    this.ctx = {
      env,
      agent,
      task,
      signal,
      channelId: agent.channelId ?? task.channelId,
      approved: () => approvedIn(p.queue.get(task.id)),
      effect: (key) => {
        const r = p.db.prepare('SELECT result FROM orch_effects WHERE task_id = ? AND tool = ? AND key = ?').get(task.id, 'effect', key) as { result: string } | undefined
        return r ? (JSON.parse(r.result) as unknown) : null
      },
      remember: (key, result) => {
        p.db.prepare('INSERT OR REPLACE INTO orch_effects (task_id, tool, key, result, created_at) VALUES (?, ?, ?, ?, ?)').run(task.id, 'effect', key, JSON.stringify(result), iso(p.now()))
      },
      waitForHuman: () => {
        this.waitsForHuman = true
      }
    }
  }

  /** Whether the agent may use this action of the protocol (delegate → team.delegate, ask_human → inbox.ask). */
  allows(technology: string): boolean {
    return this.granted.includes(technology)
  }

  /** The tools for the request (`call` is the same handler the MCP bridge reaches). */
  tools(): AgentTools {
    return { specs: this.specs, webSearch: false, call: (n, a) => this.call(n, a) }
  }

  /** Runs one tool. Never throws: problems go back to the model as tool errors. */
  async call(name: string, args: unknown): Promise<ToolCallResult> {
    const id = technologyOfTool(name) ?? name
    const events = this.ctx.env.events
    this.onActivity()
    if (!this.granted.includes(id) || isActionRight(id)) {
      events.add('refused', `${this.agent.name}: ${id} is not one of its technologies`, this.agent.id, this.ctx.task.id)
      this.uses.push({ tool: id, ok: false })
      return { text: `Refused: ${id} is not one of ${this.agent.name}'s technologies (${this.granted.join(', ') || 'none'}).`, isError: true }
    }
    const count = (this.used.get(id) ?? 0) + 1
    const quota = QUOTA[id] ?? DEFAULT_QUOTA
    if (count > quota) return { text: `${id} can be used ${quota} time(s) per turn`, isError: true }
    this.used.set(id, count)
    const handler = TEAM_TOOLS[id] ?? WORK_TOOLS[id] ?? PROJECT_TOOLS[id] ?? BRICK_TOOLS[id] ?? PIPELINE_TOOLS[id] ?? STYLE_TOOLS[id] ?? ORDER_TOOLS[id]
    try {
      if (!handler) throw new Error(`${id} has no handler`)
      const out = await handler(this.ctx, isRecord(args) ? args : {})
      this.uses.push({ tool: id, ok: true })
      events.add('tool', `${this.agent.name} used ${id}`, this.agent.id, this.ctx.task.id)
      if (typeof out === 'string') return { text: truncate(out, 20_000), isError: false }
      const images = out.images
        .map((im) => {
          try {
            const data = readFileSync(im.path)
            return data.length <= MAX_IMAGE_BYTES ? { mimeType: im.mimeType, data: data.toString('base64') } : null
          } catch {
            return null
          }
        })
        .filter((x): x is { mimeType: 'image/jpeg'; data: string } => x !== null)
      return { text: truncate(out.text, 20_000), isError: false, ...(images.length ? { images } : {}) }
    } catch (e) {
      this.uses.push({ tool: id, ok: false })
      const message = e instanceof Error ? e.message : String(e)
      events.add('tool', `${this.agent.name}: ${id} failed (${truncate(message, 160)})`, this.agent.id, this.ctx.task.id)
      return { text: message, isError: true }
    }
  }
}
