// The bridge: while it is on, one pass every ~5 s moves things between Atelier and the Discord channels created by the
// setup.
//   in    a message of an allowed person in #atlas (or a channel's room) goes to the agent runtime exactly like the app does
//         (`orchestra.say`: the agent is @mentioned in its room, wakes up, answers in the same conversation)
//   out   what the runtime says in those conversations (agents, system lines, the owner's own messages from the app) is
//         posted to the channel, from a per-conversation cursor (nothing old is replayed)
//   #à-valider  new inbox items / deliverables / production gates are posted with buttons « Valider une fois / Refuser /
//         Toujours valider » (and ✅ ❌ while the buttons are not live) and a thread for the conversation about each one
//         (threads.ts); a click (through the gateway, gateway.ts), a reaction or a reply of an allowed person is applied
//         through the same services as the app
//   #production  runs started / blocked / finished / failed
//   #atlas  the daily summary at the chosen hour, the weekly report on the chosen day
// Notifications: with the level `important` (default) only what waits for a decision pings the allowed people; everything
// else is posted silent (no push on the phone).
// Everything but the button clicks is pull-based over the REST API; each part fails on its own and shows in `lastError`.
import { t } from '../../shared/fr'
import type { OrchAgent } from '../../shared/api/orchestra'
import type { MessageRow } from '../../shared/chat'
import { teamReport } from '../orchestra/reports'
import { Approvals, BUTTON, refKey, type Ctx, type Decision } from './approvals'
import { chunk, mirrorText, nameResolver } from './format'
import { DiscordGateway, type SocketFactory } from './gateway'
import { DiscordError, scrub, type DiscordRest } from './rest'
import { channelSlug, type AtelierChannel } from './setup'
import type { PostedRef, StateStore } from './state'
import { dailySummary } from './summary'
import { QuestionThreads } from './threads'
import { FLAG_EPHEMERAL, maxSnowflake, snowflakeCompare, REACT_NO, REACT_OK, type DiscordActionRow, type DiscordInteraction, type DiscordMessage } from './types'

export interface BridgeOptions {
  rest: DiscordRest
  store: StateStore
  ctx: Ctx
  token: () => string | null
  now?: () => number
  intervalMs?: number
  /** The WebSocket the gateway uses for the button clicks; null = no buttons (✅ ❌ and replies still work). */
  socket?: SocketFactory | null
}

type Target = { discordId: string; kind: 'atlas' | 'approvals' | 'production' | 'room'; channelId: number | null }

export interface PostOpts {
  /** It waits for a decision: pings the allowed people (unless the level is `nothing`). Else silent with `important`. */
  important?: boolean
  components?: DiscordActionRow[]
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted'])

export class DiscordBridge {
  lastPollAt: string | null = null
  lastError: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private kicking: ReturnType<typeof setTimeout> | null = null
  private inflight: Promise<void> | null = null
  private readonly approvals: Approvals
  private readonly threads: QuestionThreads
  private readonly gateway: DiscordGateway | null
  private gatewayError: string | null = null
  /** Chat message ids that came from Discord: not echoed back. */
  private readonly fromDiscord = new Set<number>()
  private readonly now: () => number
  private readonly intervalMs: number

  constructor(private readonly o: BridgeOptions) {
    this.now = o.now ?? Date.now
    this.intervalMs = o.intervalMs ?? 5000
    this.approvals = new Approvals(o.ctx)
    this.threads = new QuestionThreads({
      rest: o.rest,
      store: o.store,
      ctx: o.ctx,
      now: this.now,
      post: (channelId, text, opts) => this.post(channelId, text, opts),
      decide: (channelId, messageId, ref, decision) => this.decide(channelId, messageId, ref, decision),
      fromDiscord: this.fromDiscord
    })
    this.gateway = o.socket
      ? new DiscordGateway({
          token: o.token,
          rest: o.rest,
          socket: o.socket,
          onInteraction: (i) => void this.interact(i),
          onError: (m) => {
            this.gatewayError = m
          }
        })
      : null
  }

  get running(): boolean {
    return this.timer !== null
  }

  /** The buttons work right now (the gateway is connected). */
  get buttonsLive(): boolean {
    return this.gateway?.ready === true
  }

  start(): void {
    if (this.timer) return
    const st = this.o.store.get()
    // The summary (and the weekly report) of an hour already past today is not posted late the moment the bridge is switched on.
    const now = new Date(this.now())
    if (st.summaryHour !== null && st.lastSummaryDay === null && now.getHours() >= st.summaryHour) st.lastSummaryDay = dayOf(this.now())
    if (st.weeklyDay !== null && st.lastWeeklyDay === null && isoDay(now) === st.weeklyDay && now.getHours() >= (st.summaryHour ?? 8)) st.lastWeeklyDay = dayOf(this.now())
    this.gatewayError = null
    this.gateway?.start()
    this.timer = setInterval(() => void this.pollOnce(), this.intervalMs)
    this.timer.unref()
    this.kick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.kicking) clearTimeout(this.kicking)
    this.timer = null
    this.kicking = null
    this.gateway?.stop()
  }

  /** A chat message was just posted: look at it soon instead of at the next beat. */
  kick(): void {
    if (!this.timer || this.kicking) return
    this.kicking = setTimeout(() => {
      this.kicking = null
      void this.pollOnce()
    }, 400)
    this.kicking.unref()
  }

  /** One pass (or the one already running). Never throws: each part records its own failure. */
  pollOnce(): Promise<void> {
    if (!this.inflight) this.inflight = this.pass().finally(() => (this.inflight = null))
    return this.inflight
  }

  private async pass(): Promise<void> {
    let failed: string | null = null
    try {
      const parts = [
        this.pullInbound,
        () => this.threads.pull(),
        this.pushMirror,
        () => this.threads.replies(),
        this.syncApprovals,
        this.readReactions,
        this.announceRuns,
        this.maybeSummary,
        this.maybeWeekly
      ]
      for (const part of parts) {
        try {
          await part.call(this)
        } catch (err) {
          failed = failed ?? this.describe(err)
          if (err instanceof DiscordError && err.status === 401) {
            this.stop()
            break
          }
        }
      }
      this.lastError = failed ?? this.threads.error ?? this.gatewayError
      this.lastPollAt = new Date(this.now()).toISOString()
    } finally {
      this.o.store.save()
    }
  }

  /** Posts a line in a channel (long texts are split; the ping and the buttons go on the first part). Returns the first message. */
  async post(channelId: string, text: string, opts: PostOpts = {}): Promise<DiscordMessage | null> {
    const st = this.o.store.get()
    const level = st.notifications
    const ping = opts.important === true && level !== 'nothing'
    const silent = level === 'nothing' || (level === 'important' && !ping)
    let first: DiscordMessage | null = null
    for (const part of chunk(text)) {
      const m = await this.o.rest.postMessage(channelId, part, {
        silent,
        ...(first === null && ping ? { mention: st.allowedUserIds } : {}),
        ...(first === null && opts.components?.length ? { components: opts.components } : {})
      })
      first = first ?? m
    }
    return first
  }

  private describe(err: unknown): string {
    return scrub(err instanceof Error ? err.message : String(err), this.o.token())
  }

  // ---- in -----------------------------------------------------------------------------------------------

  private targets(): Target[] {
    const st = this.o.store.get()
    const out: Target[] = []
    if (st.atlasId) out.push({ discordId: st.atlasId, kind: 'atlas', channelId: null })
    if (st.approvalsId) out.push({ discordId: st.approvalsId, kind: 'approvals', channelId: null })
    if (st.productionId) out.push({ discordId: st.productionId, kind: 'production', channelId: null })
    const active = new Set(this.channels().map((c) => c.id))
    for (const [id, room] of Object.entries(st.rooms)) if (active.has(Number(id))) out.push({ discordId: room.discordId, kind: 'room', channelId: Number(id) })
    return out
  }

  private channels(): AtelierChannel[] {
    return this.o.ctx.workflow.channels.list().map((c) => ({ id: c.id, name: c.name }))
  }

  private async pullInbound(): Promise<void> {
    const st = this.o.store.get()
    for (const target of this.targets()) {
      if (target.kind === 'production') continue
      const cursor = st.cursors[target.discordId]
      if (cursor === undefined) {
        // A channel that existed before the setup: start from its newest message.
        const latest = await this.o.rest.messages(target.discordId, { limit: 1 })
        st.cursors[target.discordId] = latest[0]?.id ?? '0'
        continue
      }
      const batch = await this.o.rest.messages(target.discordId, { after: cursor, limit: 50 })
      batch.sort((a, b) => snowflakeCompare(a.id, b.id))
      for (const m of batch) {
        st.cursors[target.discordId] = maxSnowflake(st.cursors[target.discordId] ?? '0', m.id)
        await this.handle(target, m)
      }
    }
  }

  private async handle(target: Target, m: DiscordMessage): Promise<void> {
    const st = this.o.store.get()
    if (m.author.bot === true || m.author.id === st.botUserId) return
    if (!st.allowedUserIds.includes(m.author.id)) return
    const urls = (m.attachments ?? []).map((a) => a.url)
    const text = [m.content.trim(), ...urls].filter(Boolean).join('\n')
    if (!text) {
      // Discord hides the text of messages that do not mention the bot until « Message Content Intent » is on.
      st.contentIntentMissing = true
      return
    }
    if (m.content.trim()) st.contentIntentMissing = false
    if (target.kind === 'approvals') return this.handleReply(target, m, text)
    const agent = this.agentFor(target)
    if (!agent) {
      await this.post(target.discordId, t('discord.err.noAgent'))
      return
    }
    try {
      const sent = this.o.ctx.orchestra.say({ agentId: agent.id, text })
      this.fromDiscord.add(sent.messageId)
      await this.o.rest.addReaction(target.discordId, m.id, '👀').catch(() => undefined)
    } catch (err) {
      await this.post(target.discordId, `⚠ ${this.describe(err)}`)
    }
  }

  private agentFor(target: Target): OrchAgent | undefined {
    let agents = this.o.ctx.orchestra.agents()
    if (agents.length === 0) agents = this.o.ctx.orchestra.seed().length > 0 ? this.o.ctx.orchestra.agents() : agents
    if (target.kind === 'atlas') return agents.find((a) => a.role === 'principal')
    return agents.find((a) => a.role === 'channel_lead' && a.channelId === target.channelId)
  }

  /** A reply to one of the bot's posts in #à-valider answers it with text (an input, or the note of a refusal). */
  private async handleReply(target: Target, m: DiscordMessage, text: string): Promise<void> {
    const st = this.o.store.get()
    const to = m.message_reference?.message_id
    const ref = to ? st.posted[to] : undefined
    if (!to || !ref) return
    await this.decide(target.discordId, to, ref, { kind: 'text', text })
  }

  private async decide(channelId: string, messageId: string, ref: PostedRef, decision: Decision): Promise<void> {
    const st = this.o.store.get()
    try {
      const line = this.approvals.apply(ref, decision)
      delete st.posted[messageId]
      // The buttons of a settled question go away.
      if (ref.buttons) await this.o.rest.editMessage(ref.channelId, messageId, { components: [] }).catch(() => undefined)
      await this.post(channelId, `✔ ${line}`)
    } catch (err) {
      // It stays in `posted` (so it is not posted again) but its reactions are no longer read.
      const entry = st.posted[messageId]
      if (entry) entry.react = false
      await this.post(channelId, `⚠ ${this.describe(err)}`)
    }
  }

  /** A button click (from the gateway): answered within Discord's 3 seconds by updating the message itself. */
  private async interact(i: DiscordInteraction): Promise<void> {
    if (i.type !== 3 || !i.message) return
    const st = this.o.store.get()
    const reply = (body: { type: number; data?: Record<string, unknown> }): Promise<void> => this.o.rest.interactionCallback(i.id, i.token, body).catch(() => undefined)
    const user = i.member?.user ?? i.user
    if (!user || !st.allowedUserIds.includes(user.id)) return reply({ type: 4, data: { content: t('discord.err.notAllowed'), flags: FLAG_EPHEMERAL } })
    const id = i.data?.custom_id
    const decision: Decision | null =
      id === BUTTON.yes ? { kind: 'yes' } : id === BUTTON.no ? { kind: 'no' } : id === BUTTON.always ? { kind: 'always', series: false } : id === BUTTON.series ? { kind: 'always', series: true } : null
    const ref = st.posted[i.message.id]
    const before = i.message.content ?? ''
    if (!ref || !decision) return reply({ type: 7, data: { content: `${before}\n\n${t('discord.err.gone')}`, components: [] } })
    try {
      const line = this.approvals.apply(ref, decision)
      delete st.posted[i.message.id]
      await reply({ type: 7, data: { content: `${before}\n\n✔ ${line}`, components: [] } })
    } catch (err) {
      await reply({ type: 4, data: { content: `⚠ ${this.describe(err)}`, flags: FLAG_EPHEMERAL } })
    } finally {
      this.o.store.save()
    }
  }

  // ---- out ----------------------------------------------------------------------------------------------

  private async pushMirror(): Promise<void> {
    const { ctx } = this.o
    const st = this.o.store.get()
    const store = ctx.chat.store
    const names = nameResolver(ctx.orchestra.agents())
    const rooms: { discordId: string; conversationId: number }[] = []
    if (st.atlasId) rooms.push({ discordId: st.atlasId, conversationId: store.open({ kind: 'supervisor' }).id })
    for (const t0 of this.targets()) {
      if (t0.kind !== 'room' || t0.channelId === null) continue
      try {
        rooms.push({ discordId: t0.discordId, conversationId: store.open({ kind: 'channel', channelId: t0.channelId }).id })
      } catch {
        // the channel was deleted meanwhile
      }
    }
    for (const room of rooms) {
      const key = String(room.conversationId)
      const cursor = st.mirrored[key]
      if (cursor === undefined) {
        st.mirrored[key] = store.messages(room.conversationId, 0, 1).at(-1)?.id ?? 0
        continue
      }
      for (const m of store.messages(room.conversationId, cursor, 100)) {
        const text = this.fromDiscord.has(m.id) ? null : mirrorText(m as MessageRow, names)
        if (text) await this.post(room.discordId, text)
        st.mirrored[key] = m.id
      }
    }
  }

  private async syncApprovals(): Promise<void> {
    const st = this.o.store.get()
    if (!st.approvalsId) return
    const pending = this.approvals.pending()
    const open = new Set(pending.map((p) => p.key))
    // Settled in the app meanwhile: forget it, and its buttons go away.
    for (const [mid, ref] of Object.entries(st.posted)) {
      if (open.has(refKey(ref))) continue
      delete st.posted[mid]
      if (ref.buttons) await this.o.rest.editMessage(ref.channelId, mid, { components: [] }).catch(() => undefined)
    }
    const known = new Set(Object.values(st.posted).map(refKey))
    let sent = 0
    for (const item of pending) {
      if (known.has(item.key)) continue
      if (sent++ >= 10) break
      const msg = await this.post(st.approvalsId, item.text, { important: true, components: item.buttons })
      if (!msg) continue
      st.posted[msg.id] = { ...item.ref, channelId: st.approvalsId, react: item.reactions, buttons: item.buttons.length > 0 }
      // While the buttons are not live (no gateway), the bot shows the ✅ ❌ to tap.
      if (item.reactions && !this.buttonsLive) {
        await this.o.rest.addReaction(st.approvalsId, msg.id, REACT_OK).catch(() => undefined)
        await this.o.rest.addReaction(st.approvalsId, msg.id, REACT_NO).catch(() => undefined)
      }
      const threadId = await this.threads.open(st.approvalsId, msg, item)
      const entry = st.posted[msg.id]
      if (threadId && entry) entry.threadId = threadId
    }
  }

  private async readReactions(): Promise<void> {
    const st = this.o.store.get()
    for (const [mid, ref] of Object.entries(st.posted).slice(0, 10)) {
      if (!ref.react) continue
      const yes = await this.reactedBy(ref.channelId, mid, REACT_OK)
      if (yes) {
        await this.decide(ref.channelId, mid, ref, { kind: 'yes' })
        continue
      }
      if (await this.reactedBy(ref.channelId, mid, REACT_NO)) await this.decide(ref.channelId, mid, ref, { kind: 'no' })
    }
  }

  private async reactedBy(channelId: string, messageId: string, emoji: string): Promise<boolean> {
    const allowed = this.o.store.get().allowedUserIds
    const users = await this.o.rest.reactionUsers(channelId, messageId, emoji)
    return users.some((u) => u.bot !== true && allowed.includes(u.id))
  }

  private async announceRuns(): Promise<void> {
    const st = this.o.store.get()
    if (!st.productionId) return
    for (const r of this.o.ctx.productionRuns.list({ limit: 50 })) {
      const key = String(r.id)
      const sig = r.status === 'waiting' ? `waiting:${r.waitingNodes.join(',')}` : r.status
      const prev = st.runs[key]
      if (prev === sig) continue
      if (prev === undefined && TERMINAL.has(r.status)) {
        st.runs[key] = sig
        continue
      }
      const vars = { title: r.videoTitle, channel: r.channelName, error: r.error ?? '', nodes: r.waitingNodes.join(', ') }
      let line: string | null = null
      if (r.status === 'waiting') line = t('discord.run.blocked', vars)
      else if (r.status === 'succeeded') line = t('discord.run.done', vars)
      else if (r.status === 'failed') line = t('discord.run.failed', vars)
      else if (r.status === 'cancelled') line = t('discord.run.cancelled', vars)
      else if (r.status === 'interrupted') line = t('discord.run.interrupted', vars)
      else if (prev === undefined) line = t('discord.run.started', vars)
      if (line) await this.post(st.productionId, line)
      st.runs[key] = sig
    }
  }

  private async maybeSummary(): Promise<void> {
    const st = this.o.store.get()
    if (st.summaryHour === null || !st.atlasId) return
    const day = dayOf(this.now())
    if (st.lastSummaryDay === day || new Date(this.now()).getHours() < st.summaryHour) return
    await this.post(st.atlasId, dailySummary(this.o.ctx, this.now()))
    st.lastSummaryDay = day
  }

  /** The weekly report in #atlas, on the chosen day at the summary hour (8 h without a summary). */
  private async maybeWeekly(): Promise<void> {
    const st = this.o.store.get()
    if (st.weeklyDay === null || !st.atlasId) return
    const now = new Date(this.now())
    const day = dayOf(this.now())
    if (st.lastWeeklyDay === day || isoDay(now) !== st.weeklyDay || now.getHours() < (st.summaryHour ?? 8)) return
    const o = this.o.ctx.orchestra
    await this.post(st.atlasId, teamReport(o.parts, 'weekly', o.planner.utc).text)
    st.lastWeeklyDay = day
  }
}

/** Local calendar day, `YYYY-MM-DD`. */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
const isoDay = (d: Date): number => ((d.getDay() + 6) % 7) + 1

export { channelSlug }
