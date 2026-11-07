// The Atelier tools of one agent run: specs (JSON Schema, sent to the CLI through the MCP server) and handlers.
// The same handlers serve the MCP bridge and in-process providers (FakeProvider). Arguments come from a model:
// every one is checked, and each run has small quotas so a looping agent cannot flood the chat. Lot 13 adds
// `ask_agent` (a handoff, run by the group engine through `RunHooks.consult`), the production tools
// (tools-production.ts) and a report of each tool use (`RunHooks.onTool`, shown as steps in the chat).
import type { AgentRow, AtelierTool } from '../../shared/agents'
import type { ToolUse } from '../../shared/chat'
import type { ChatStore } from '../chat/store'
import type { Db } from '../db'
import type { ToolCallResult, ToolSpec } from '../llm/types'
import type { ProductionPort } from '../production/port'
import type { WorkflowEngine } from '../workflow/engine'
import type { ExtraTools } from './media'
import type { ProposalsStore } from './proposals'
import type { AgentsStore } from './store'
import { isProductionTool, listVideos, PRODUCTION_SPECS, runProductionTool } from './tools-production'

export interface RunScope {
  kind: 'task' | 'chat'
  role: string
  /** Where post_message and proposal cards go (the video chat for a task). */
  conversationId: number
  channelId: number | null
  videoId: number | null
  taskId: number | null
}

export interface ToolDeps {
  db: Db
  chat: ChatStore
  agents: AgentsStore
  proposals: ProposalsStore
  workflow: WorkflowEngine
  /** Production runs (our engine); absent or unavailable: the production tools are not offered. */
  production?: ProductionPort | null
}

export interface RunMaterial {
  /** Text returned by get_brief. */
  brief: () => string
  /** Text returned by get_inputs (task runs). */
  inputs: () => string
}

export interface ToolStep {
  id: string
  name: string
  state: 'running' | 'done' | 'error'
}

/** What the group engine plugs into a chat turn. */
export interface RunHooks {
  /** ask_agent: hands the question to another agent and resolves with its answer (throws = refused). */
  consult?: (to: string, question: string) => Promise<string>
  /** Called when a tool starts and when it ends. */
  onTool?: (step: ToolStep) => void
}

export const MAX_VERSION_CHARS = 200_000
export const MAX_POST_CHARS = 4000
export const MAX_ASK_CHARS = 4000
const QUOTA: Partial<Record<AtelierTool, number>> = {
  save_version: 5,
  post_message: 5,
  propose_action: 3,
  create_video: 3,
  remember: 5,
  ask_agent: 3,
  list_videos: 10,
  list_runs: 10,
  run_status: 10,
  estimate: 5,
  analyse_channel: 2,
  run_pipeline: 2,
  retry_node: 3,
  cancel_run: 2
}

const SPECS: Record<AtelierTool, Omit<ToolSpec, 'name'>> = {
  get_brief: {
    description: 'The brief of this job: video, channel standards, deliverable to make, revision note.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  get_inputs: {
    description: 'The approved deliverables this one builds on (research, brief, script…), full text.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  save_version: {
    description: 'Save the finished deliverable. Pass the complete text; the last call wins.',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string', description: 'The complete deliverable (Markdown).' } },
      required: ['content'],
      additionalProperties: false
    }
  },
  post_message: {
    description: 'Post a short message to Charlie in this chat (progress, a question).',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false
    }
  },
  propose_action: {
    description: 'Propose an action that needs Charlie. It appears as a card he confirms or dismisses.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, detail: { type: 'string' } },
      required: ['title', 'detail'],
      additionalProperties: false
    }
  },
  remember: {
    description: 'Keep a short note for your future work on this channel (a preference, a lesson).',
    inputSchema: {
      type: 'object',
      properties: { note: { type: 'string' } },
      required: ['note'],
      additionalProperties: false
    }
  },
  create_video: {
    description:
      'Propose a new video. Charlie gets a card to confirm; the video is created (and research starts) only then.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: ['string', 'integer'], description: 'Channel id or exact name.' },
        title: { type: 'string', description: 'Working title.' },
        brief: { type: 'string', description: 'What the video is about and its angle (2-5 sentences).' }
      },
      required: ['channel', 'title', 'brief'],
      additionalProperties: false
    }
  },
  ask_agent: {
    description:
      'Hand a question to another agent of the team (by name or id). Its answer comes back to you; then conclude for Charlie.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Name or id of the agent, e.g. "Scénariste" or "scriptwriter".' },
        question: { type: 'string', description: 'What you need from that agent, with the context it needs.' }
      },
      required: ['agent', 'question'],
      additionalProperties: false
    }
  },
  ...PRODUCTION_SPECS
}

/** Tools that only make sense in a task run (they need a deliverable). */
const TASK_ONLY: readonly AtelierTool[] = ['get_inputs', 'save_version']
const PRODUCTION_ONLY: readonly AtelierTool[] = ['list_runs', 'run_status', 'estimate', 'analyse_channel', 'run_pipeline', 'retry_node', 'cancel_run']

export class ToolRun {
  readonly specs: ToolSpec[]
  /** Content passed to save_version, if any. */
  draft: string | null = null
  /** Every accepted tool call, in order (saved on the chat message). */
  readonly uses: ToolUse[] = []
  private readonly used = new Map<string, number>()
  private seq = 0

  constructor(
    private readonly deps: ToolDeps,
    readonly scope: RunScope,
    agent: AgentRow,
    private readonly material: RunMaterial,
    /** Tools of a media module for this run (the production engine for the edit), beside the Atelier ones. */
    private readonly extra: ExtraTools | null = null,
    private readonly hooks: RunHooks = {}
  ) {
    const production = deps.production?.available === true
    this.specs = agent.tools
      .filter((t) => scope.kind === 'task' || !TASK_ONLY.includes(t))
      .filter((t) => t !== 'create_video' || agent.role === 'supervisor')
      .filter((t) => t !== 'ask_agent' || hooks.consult !== undefined)
      .filter((t) => production || !PRODUCTION_ONLY.includes(t))
      .map((t): ToolSpec => ({ name: t, ...SPECS[t] }))
    for (const s of extra?.specs ?? []) if (!this.specs.some((x) => x.name === s.name)) this.specs.push(s)
  }

  /** How many tool calls were accepted in this run. */
  get callCount(): number {
    let n = 0
    for (const v of this.used.values()) n += v
    return n
  }

  /** Runs one tool. Never throws: problems are returned to the model as tool errors. */
  async call(name: string, args: unknown): Promise<ToolCallResult> {
    if (!this.specs.some((s) => s.name === name)) return err(`Tool ${name} is not available in this run`)
    const external = this.extra?.specs.some((s) => s.name === name) === true
    const quota = external ? this.extra?.quota[name] : QUOTA[name as AtelierTool]
    const count = (this.used.get(name) ?? 0) + 1
    if (quota !== undefined && count > quota) return err(`${name} can be used ${quota} times per run`)
    this.used.set(name, count)
    const step: ToolStep = { id: `${name}-${++this.seq}`, name, state: 'running' }
    this.report(step)
    try {
      const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
      const text = external && this.extra ? await this.extra.call(name, a) : await this.run(name as AtelierTool, a)
      this.finish(step, 'done')
      return ok(text)
    } catch (e) {
      this.finish(step, 'error')
      return err(e instanceof Error ? e.message : String(e))
    }
  }

  private report(step: ToolStep): void {
    try {
      this.hooks.onTool?.({ ...step })
    } catch {
      // a display hook never breaks a tool call
    }
  }

  private finish(step: ToolStep, state: 'done' | 'error'): void {
    this.uses.push({ name: step.name, state })
    this.report({ ...step, state })
  }

  private async run(name: AtelierTool, a: Record<string, unknown>): Promise<string> {
    const { scope, deps } = this
    if (isProductionTool(name)) {
      return runProductionTool(name, a, {
        production: deps.production ?? null,
        workflow: deps.workflow,
        proposals: deps.proposals,
        conversationId: scope.conversationId,
        role: scope.role,
        channelId: scope.channelId
      })
    }
    switch (name) {
      case 'get_brief':
        return this.material.brief()
      case 'get_inputs':
        return this.material.inputs()
      case 'save_version': {
        const content = text(a.content, 'content', MAX_VERSION_CHARS)
        this.draft = content
        return 'Saved. It is submitted when you finish this turn.'
      }
      case 'post_message': {
        deps.chat.post(scope.conversationId, { authorType: 'agent', authorId: scope.role, body: text(a.text, 'text', MAX_POST_CHARS) })
        return 'Posted.'
      }
      case 'propose_action': {
        const p = deps.proposals.create({
          conversationId: scope.conversationId,
          authorId: scope.role,
          kind: 'other',
          title: text(a.title, 'title', 200),
          detail: text(a.detail, 'detail', 2000)
        })
        return `Proposal #${p.id} posted. Charlie will confirm or dismiss it.`
      }
      case 'remember': {
        deps.agents.remember(scope.role, scope.channelId, text(a.note, 'note', 1000))
        return 'Noted.'
      }
      case 'create_video': {
        const channel = this.channel(a.channel)
        const title = text(a.title, 'title', 200)
        const brief = text(a.brief, 'brief', 2000)
        const p = deps.proposals.create({
          conversationId: scope.conversationId,
          authorId: scope.role,
          kind: 'create_video',
          title: `New video for ${channel.name}: ${title}`,
          detail: brief,
          data: { channelId: channel.id, title, brief }
        })
        return `Proposal #${p.id} posted: Charlie must confirm it before the video exists. Do not say it is created.`
      }
      case 'ask_agent': {
        const consult = this.hooks.consult
        if (!consult) throw new Error('ask_agent is not available here')
        return consult(text(a.agent, 'agent', 80), text(a.question, 'question', MAX_ASK_CHARS))
      }
      case 'list_videos':
        return listVideos(deps.workflow, a, scope.channelId)
      default:
        throw new Error(`Tool ${String(name)} has no handler`)
    }
  }

  private channel(ref: unknown): { id: number; name: string } {
    const rows = this.deps.db.prepare('SELECT id, name FROM channels WHERE archived_at IS NULL ORDER BY id').all() as {
      id: number
      name: string
    }[]
    const byId = typeof ref === 'number' || (typeof ref === 'string' && /^#?\d+$/.test(ref.trim()))
    const found = byId
      ? rows.find((r) => r.id === Number(String(ref).replace('#', '')))
      : typeof ref === 'string'
        ? rows.find((r) => r.name.toLowerCase() === ref.trim().toLowerCase())
        : undefined
    if (!found) {
      const names = rows.map((r) => `#${r.id} ${r.name}`).join(', ')
      throw new Error(`Unknown channel ${JSON.stringify(ref)}. Channels: ${names || 'none'}`)
    }
    return found
  }
}

function text(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${field} must be non-empty text`)
  if (v.length > max) throw new Error(`${field} is limited to ${max} characters`)
  return v.trim()
}

const ok = (t: string): ToolCallResult => ({ text: t, isError: false })
const err = (t: string): ToolCallResult => ({ text: t, isError: true })
