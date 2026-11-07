// One turn of an agent on a leased task (the supervisor leased it and reserved an account slot):
//   1. budget of the agent; 2. compaction when the working session passed its context budget (fresh session after);
//   3. session choice: resume the CLI session (`--resume`) when it lives on this account, else a fresh one seeded with
//      the persona, the handover and the top-k memory items; 4. the call through the ledger, each streamed delta
//      renewing the lease (heartbeat); 5. failover: a usage / rate limit marks the account and the turn moves to the
//      next account at once, as does a dead login (« à reconnecter »), or the task waits (`waiting`, reason `accounts`)
//      until the first one resets or an account works again; 6. the answer's actions (actions.ts). Any other error is a failed attempt (backoff) or, attempts used up, a dead letter.
import type { OrchTask } from '../../shared/api/orchestra'
import { BudgetExceededError } from '../ledger'
import type { AgentTools } from '../llm/types'
import type { AccountRecord } from './accounts'
import { applyReply, deadLetter } from './actions'
import { assemble } from './assemble'
import { callModel, supportsSessions } from './call'
import { compactionPrompt, compactionSystem, fallbackHandover, parseCompaction } from './compaction'
import { DEFAULT_USAGE_COOLDOWN_MS, detectAuthFailure, detectLimit } from './limits'
import type { SessionRecord } from './memory'
import { DEFAULTS, SETTINGS, intSetting, type RunHandle, type RuntimeParts } from './parts'
import type { TurnContext } from './prompt'
import type { Route } from './routing'
import { Toolbox } from './toolbox'
import type { AgentRecord } from './tree'
import { estimateTokens, iso, isRecord, truncate } from './util'

const HEARTBEAT_EVERY_MS = 1000
/** Most agentic steps of one tool turn (Claude Code `--max-turns`). */
const TOOL_MAX_TURNS = 16

export class TurnEngine {
  private readonly p: RuntimeParts
  /** Told when every account serving a tier is limited (the supervisor tells the principal's conversation). */
  onAllLimited: ((resumesAt: number) => void) | null = null
  /** Told when no subscription account works at all (logged out, none connected): the chat says what to click. */
  onNoAccount: ((task: OrchTask) => void) | null = null

  constructor(p: RuntimeParts) {
    this.p = p
  }

  async run(task: OrchTask, h: RunHandle, route: Route): Promise<void> {
    const p = this.p
    const agent = p.tree.get(task.assigneeId)
    let account = p.accounts.get(h.accountId)
    p.queue.markRunning(task.id, p.owner, account.id)
    p.tree.touch(agent.id)
    p.tree.refreshStatus(agent.id)
    p.events.add('run', `${agent.name} works on #${task.id} ${task.kind} (${route.tier}/${route.effort}, ${account.label})`, agent.id, task.id)

    if (this.parkIfOverBudget(agent, task)) return
    let session = p.memory.session(agent.id)
    const threshold = agent.policy.compactAtTokens ?? intSetting(p.settings, SETTINGS.compactAtTokens, DEFAULTS.compactAtTokens, 100, 10_000_000)
    if (session.contextTokens >= threshold) session = await this.compact(agent, session, task, h)
    if (h.killed) return

    const tried = new Set<number>()
    let retriedFresh = false
    const toolbox = new Toolbox(p, agent, task, h.controller.signal, () => this.beat(h))
    for (;;) {
      const resume =
        p.settings.get<boolean>(SETTINGS.resume, true) !== false &&
        supportsSessions(account) &&
        session.cliSessionId !== null &&
        session.accountId === account.id
      const ctx = this.contextFor(agent, task, session, resume)
      const opened = this.openTools(toolbox, account)
      const asm = assemble({ parts: p, context: p.context, agent, ctx, toolsAvailable: opened.available })
      const system = asm.system
      const prompt = asm.prompt
      try {
        const out = await callModel(p, {
          account,
          tier: route.tier,
          effort: route.effort,
          pinnedModel: route.model,
          system,
          prompt,
          channelId: task.channelId ?? agent.channelId,
          videoId: task.videoId,
          orchTaskId: task.id,
          ...(supportsSessions(account) ? { session: { cwd: p.agentDir(agent), resumeId: resume ? session.cliSessionId : null, effortFlag: true } } : {}),
          signal: h.controller.signal,
          onActivity: () => this.beat(h),
          ...(opened.available ? { tools: opened.tools, maxTurns: TOOL_MAX_TURNS } : {})
        })
        if (h.killed) return
        p.accounts.recordCall(account.id, true)
        const turnTokens = estimateTokens(resume ? prompt : system + prompt) + Math.max(out.usage.outputTokens, estimateTokens(out.text))
        session = p.memory.recordTurn(session.id, {
          cliSessionId: supportsSessions(account) ? out.sessionId : null,
          accountId: account.id,
          tokens: turnTokens,
          fresh: !resume
        })
        p.memory.logEpisode({ agentId: agent.id, sessionId: session.id, taskId: task.id, accountId: account.id, prompt, reply: out.text, tokens: turnTokens, costUsd: out.costUsd })
        const outcome = applyReply(p, agent, p.queue.get(task.id), out.text, { delegate: toolbox.allows('team.delegate'), ask: toolbox.allows('inbox.ask'), waitHuman: toolbox.waitsForHuman })
        p.events.add(
          'turn',
          `${agent.name} #${task.id} → ${outcome.status}${outcome.children.length ? ` (${outcome.children.length} sub-task(s))` : ''}${resume ? ' [resumed session]' : ''} $${out.costUsd.toFixed(4)}`,
          agent.id,
          task.id
        )
        return
      } catch (err) {
        if (h.killed) return
        const message = err instanceof Error ? err.message : String(err)
        if (err instanceof BudgetExceededError) {
          this.parkBudget(agent, task, message)
          return
        }
        const hit = detectLimit(message, p.now())
        // A dead login (expired OAuth session…) is not the task's fault: the account goes « à reconnecter », the same
        // attempt moves on, and no retry is ever spent on it.
        const auth = hit ? null : detectAuthFailure(message)
        if (hit || auth) {
          if (hit) p.accounts.markLimited(account.id, hit)
          else p.accounts.markNeedsLogin(account.id, auth as string)
          tried.add(account.id)
          const next = p.accounts.pick(route.tier, tried)
          if (next) {
            p.accounts.release(account.id)
            p.accounts.acquire(next.id)
            h.accountId = next.id
            p.events.add('failover', `${account.label} is ${hit ? 'limited' : 'logged out'}: #${task.id} moves to ${next.label}`, agent.id, task.id)
            account = next
            p.queue.markRunning(task.id, p.owner, next.id)
            continue
          }
          const avail = p.accounts.availability(route.tier)
          const until = avail.resumesAt ?? p.now() + DEFAULT_USAGE_COOLDOWN_MS
          p.queue.park(task.id, p.owner, 'accounts', until)
          p.events.add('wait', `#${task.id} waits for an account until ${iso(until)}`, agent.id, task.id)
          if (avail.resumesAt !== null) this.onAllLimited?.(until)
          else this.onNoAccount?.(task)
          return
        }
        if (resume && !retriedFresh && /(no conversation|session).*(not found|found|invalid|expired)/i.test(message)) {
          // The CLI lost the session (cleared folder, another machine): start a fresh one, same attempt.
          p.memory.forgetCliSession(session.id)
          session = p.memory.sessionById(session.id)
          retriedFresh = true
          continue
        }
        p.accounts.recordCall(account.id, false)
        const status = p.queue.fail(task.id, p.owner, truncate(message, 2000))
        if (status === 'dead') deadLetter(p, task.id, message)
        return
      } finally {
        opened.close()
      }
    }
  }

  /**
   * The technologies of this turn as tools. A Claude Code account gets them through the agents' MCP bridge (one token per
   * turn, revoked when it ends); in-process providers (the FakeProvider) call them directly; Codex and the API key get
   * none yet (the agent then acts through the action block only, and its prompt says so).
   */
  private openTools(toolbox: Toolbox, account: AccountRecord): { tools: AgentTools; available: boolean; close: () => void } {
    const tools = toolbox.tools()
    let close = (): void => undefined
    const mcp = this.p.mcp()
    if (account.kind === 'claude-code' && mcp?.server.listening && tools.specs.length > 0) {
      const reg = mcp.server.register({ specs: tools.specs, call: (n, a) => toolbox.call(n, a) })
      close = reg.revoke
      tools.mcp = {
        command: mcp.command,
        args: mcp.args,
        env: { ...mcp.env, ELECTRON_RUN_AS_NODE: '1', ATELIER_BRIDGE: mcp.server.address, ATELIER_BRIDGE_TOKEN: reg.token }
      }
    }
    const available = tools.specs.length > 0 && this.p.accounts.provider(account).acceptsTools?.(tools) === true
    if (!available) {
      close()
      close = (): void => undefined
    }
    return { tools, available, close }
  }

  /** The streamed delta proves the run is alive: renew the lease (at most once a second of the runtime clock). */
  private beat(h: RunHandle): void {
    const now = this.p.now()
    if (now - h.lastBeatAt < HEARTBEAT_EVERY_MS) return
    h.lastBeatAt = now
    this.p.queue.heartbeat(h.taskId, this.p.owner)
  }

  /** What the turn knows (prompt.ts). `markRecall` false: a read-only view (« Ce que l'agent sait ») counts no memory use. */
  contextFor(agent: AgentRecord, task: OrchTask, session: SessionRecord, resumed: boolean, markRecall = true): TurnContext {
    const p = this.p
    const channelId = task.channelId ?? agent.channelId
    const ch = channelId === null ? undefined : (p.db.prepare('SELECT name, niche, standards FROM channels WHERE id = ?').get(channelId) as { name: string; niche: string; standards: string } | undefined)
    const brief = typeof task.payload.brief === 'string' ? task.payload.brief : ''
    const message = isRecord(task.payload.message) && typeof task.payload.message.text === 'string' ? { from: String(task.payload.message.from ?? 'someone'), text: task.payload.message.text } : null
    return {
      agent,
      task,
      manager: agent.parentId !== null ? p.tree.get(agent.parentId) : null,
      reports: p.tree.reports(agent.id),
      channel: ch ?? null,
      memory: resumed ? [] : p.memory.recall(agent.id, `${task.kind} ${task.title} ${brief} ${message?.text ?? ''}`, 8, markRecall),
      handover: session.handover,
      resumed,
      dependencies: task.dependsOn.map((id) => p.queue.find(id)).filter((d) => d !== null).map((d) => ({ title: d.title, status: d.status, result: d.result })),
      message,
      facts: task.kind === 'digest' ? this.digestFacts() : null,
      thread: ''
    }
  }

  /** The numbers of the last 24 hours, computed here (the model only writes them up). */
  private digestFacts(): string {
    const p = this.p
    const since = p.now() - 86_400_000
    const finished = p.queue.finishedSince(since)
    const done = finished.filter((t) => t.status === 'done')
    const dead = finished.filter((t) => t.status === 'dead')
    const counts = p.queue.counts()
    const lines = [
      `Last 24 hours: ${done.length} task(s) done, ${dead.length} stopped after failures.`,
      `Queue now: ${counts.queued ?? 0} queued, ${(counts.leased ?? 0) + (counts.running ?? 0)} running, ${counts.waiting ?? 0} waiting, ${counts.waiting_human ?? 0} waiting for Charlie.`,
      ...done.slice(-15).map((t) => `- done #${t.id} ${t.title}: ${truncate(t.result ?? '', 160)}`),
      ...dead.map((t) => `- STOPPED #${t.id} ${t.title}: ${truncate(t.error ?? '', 160)}`)
    ]
    const limited = p.accounts.list().filter((a) => p.accounts.isLimited(a))
    if (limited.length) lines.push(`Accounts limited: ${limited.map((a) => `${a.label} until ${a.limitedUntil}`).join(', ')}`)
    return lines.join('\n')
  }

  private async compact(agent: AgentRecord, session: SessionRecord, task: OrchTask, h: RunHandle): Promise<SessionRecord> {
    const p = this.p
    const episodes = p.memory.episodes(session.id, 30)
    const route = p.router.resolve('compaction', agent.policy)
    const own = p.accounts.get(h.accountId)
    const picked = p.accounts.pick(route.tier)
    const account = picked ?? (own.tiers.includes(route.tier) ? own : null)
    let parsed = null
    if (account) {
      const extra = account.id !== own.id
      if (extra) p.accounts.acquire(account.id)
      try {
        const out = await callModel(p, {
          account,
          tier: route.tier,
          effort: route.effort,
          pinnedModel: null,
          system: compactionSystem(agent),
          prompt: compactionPrompt(agent, session, episodes),
          channelId: task.channelId ?? agent.channelId,
          videoId: null,
          orchTaskId: task.id,
          maxTokens: 2000,
          signal: h.controller.signal,
          onActivity: () => this.beat(h)
        })
        parsed = parseCompaction(out.text)
        p.accounts.recordCall(account.id, true)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const hit = detectLimit(message, p.now())
        if (hit) p.accounts.markLimited(account.id, hit)
        const auth = hit ? null : detectAuthFailure(message)
        if (auth) p.accounts.markNeedsLogin(account.id, auth)
        p.events.add('compaction', `${agent.name}: compaction model failed (${truncate(message, 120)}), plain summary used`, agent.id, task.id)
      } finally {
        if (extra) p.accounts.release(account.id)
      }
    }
    for (const m of parsed?.memories ?? []) {
      p.memory.add(agent.id, { kind: m.kind, content: m.content, importance: m.importance, source: `compaction:${session.id}` })
    }
    const handover = parsed?.handover || fallbackHandover(episodes)
    p.events.add(
      'compaction',
      `${agent.name}: session #${session.id} compacted at ~${session.contextTokens} tokens → ${parsed?.memories.length ?? 0} memory item(s) + handover; fresh session`,
      agent.id,
      task.id
    )
    return p.memory.reset(agent.id, `compaction at ~${session.contextTokens} tokens`, handover)
  }

  private parkIfOverBudget(agent: AgentRecord, task: OrchTask): boolean {
    if (agent.budgetUsdMonth === null) return false
    const spent = this.p.tree.spentThisMonth(agent.id)
    if (spent < agent.budgetUsdMonth) return false
    this.parkBudget(agent, task, `${agent.name} used its monthly budget ($${spent.toFixed(2)} of $${agent.budgetUsdMonth.toFixed(2)})`)
    return true
  }

  /** A cap (the agent's, the channel's or the global one) is reached: the task waits for the next month, the user is told. */
  private parkBudget(agent: AgentRecord, task: OrchTask, why: string): void {
    const p = this.p
    const d = new Date(p.now())
    const nextMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
    p.queue.park(task.id, p.owner, 'budget', nextMonth)
    p.inbox.add({ taskId: task.id, agentId: agent.id, kind: 'alert', title: `Budget atteint : ${agent.name}`, body: `${why}. La tâche #${task.id} attend : relève le budget ou relance-la.` })
  }
}
