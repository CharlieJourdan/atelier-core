// DiscordService: what the `discord.*` IPC methods call. Owns the token (encrypted secrets store; it never leaves the main
// process and never appears in a result, a log or an error), the persisted state and the bridge. Off by default: the
// bridge only runs with a token, a created layout and the explicit switch.
import type {
  DiscordConfigInput,
  DiscordGuild,
  DiscordInvite,
  DiscordSetupResult,
  DiscordStatus,
  DiscordTestResult
} from '../../shared/api/discord'
import { t } from '../../shared/fr'
import type { SecretsStore } from '../secrets'
import type { SettingsStore } from '../settings'
import type { Ctx } from './approvals'
import { DiscordBridge } from './bridge'
import { nodeSocket, type SocketFactory } from './gateway'
import { DiscordError, DiscordRest, scrub, type FetchLike } from './rest'
import { inviteUrl, listGuilds, roomStatuses, runSetup, type AtelierChannel } from './setup'
import { isSetUp, NOTIFICATION_LEVELS, SECRET_NAME, StateStore } from './state'

export interface DiscordServiceOptions {
  ctx: Ctx
  settings: SettingsStore
  secrets: SecretsStore
  notify: () => void
  /** Tests and the e2e fake pass an in-memory Discord; the app uses the real `fetch`. */
  fetch?: FetchLike
  /**
   * The gateway's WebSocket (button clicks). Default: Node's own with the real `fetch`, none with an injected one (a fake
   * Discord never reaches the real gateway); tests pass the fake's.
   */
  socket?: SocketFactory | null
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  intervalMs?: number
}

const TOKEN_SHAPE = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/
const USER_ID = /^\d{15,25}$/

export class DiscordService {
  readonly store: StateStore
  readonly rest: DiscordRest
  readonly bridge: DiscordBridge

  constructor(private readonly o: DiscordServiceOptions) {
    this.store = new StateStore(o.settings)
    const token = (): string | null => this.token()
    this.rest = new DiscordRest({ token, ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.sleep ? { sleep: o.sleep } : {}), ...(o.now ? { now: o.now } : {}) })
    this.bridge = new DiscordBridge({
      rest: this.rest,
      store: this.store,
      ctx: o.ctx,
      token,
      socket: o.socket !== undefined ? o.socket : o.fetch ? null : nodeSocket(),
      ...(o.now ? { now: o.now } : {}),
      ...(o.intervalMs !== undefined ? { intervalMs: o.intervalMs } : {})
    })
  }

  private token(): string | null {
    try {
      return this.o.secrets.has(SECRET_NAME) ? this.o.secrets.get(SECRET_NAME) : null
    } catch {
      return null
    }
  }

  /** App start: the bridge resumes only if it was switched on and everything it needs is there. */
  start(): void {
    if (this.store.enabled() && this.token() !== null && isSetUp(this.store.get())) this.bridge.start()
  }

  close(): void {
    this.bridge.stop()
  }

  /** A chat message was posted: the bridge looks at it soon. */
  kick(): void {
    this.bridge.kick()
  }

  private channels(): AtelierChannel[] {
    return this.o.ctx.workflow.channels.list().map((c) => ({ id: c.id, name: c.name }))
  }

  status(): DiscordStatus {
    const st = this.store.get()
    return {
      tokenSet: this.token() !== null,
      bot: st.botUserId ? { id: st.botUserId, name: st.botName ?? '' } : null,
      applicationId: st.applicationId,
      guild: st.guildId ? { id: st.guildId, name: st.guildName ?? '' } : null,
      channels: roomStatuses(st, this.channels()),
      allowedUserIds: [...st.allowedUserIds],
      enabled: this.store.enabled(),
      running: this.bridge.running,
      summaryHour: st.summaryHour,
      lastPollAt: this.bridge.lastPollAt,
      lastError: this.bridge.lastError,
      teamOn: this.o.settings.get<boolean>('orchestra.enabled', false) === true,
      contentIntentMissing: st.contentIntentMissing,
      notifications: st.notifications,
      weeklyDay: st.weeklyDay,
      buttonsLive: this.bridge.buttonsLive
    }
  }

  /** Checks the token with Discord first, so a typo never replaces a working one. */
  async setToken(raw: string): Promise<DiscordStatus> {
    const token = typeof raw === 'string' ? raw.trim().replace(/^Bot\s+/i, '') : ''
    if (!TOKEN_SHAPE.test(token)) throw new Error(t('discord.err.tokenFormat'))
    const probe = new DiscordRest({ token: () => token, ...(this.o.fetch ? { fetch: this.o.fetch } : {}), ...(this.o.sleep ? { sleep: this.o.sleep } : {}), ...(this.o.now ? { now: this.o.now } : {}) })
    let bot
    let app
    try {
      bot = await probe.me()
      app = await probe.application()
    } catch (err) {
      throw this.fail(err, token)
    }
    if (bot.bot !== true) throw new Error(t('discord.err.notBot'))
    this.o.secrets.set(SECRET_NAME, token)
    const st = this.store.get()
    if (st.botUserId !== bot.id) {
      // Another bot: the earlier layout (channels, cursors) belongs to the old one.
      Object.assign(st, { guildId: null, guildName: null, categoryId: null, atlasId: null, approvalsId: null, productionId: null, rooms: {}, cursors: {}, mirrored: {}, posted: {}, threads: {}, allowedUserIds: [] })
      this.bridge.stop()
      this.store.setEnabled(false)
    }
    st.botUserId = bot.id
    st.botName = bot.username
    st.applicationId = app.id
    this.store.save()
    return this.changed()
  }

  clearToken(): DiscordStatus {
    this.bridge.stop()
    this.o.secrets.clear(SECRET_NAME)
    this.store.setEnabled(false)
    const st = this.store.get()
    st.botUserId = null
    st.botName = null
    st.applicationId = null
    this.store.save()
    return this.changed()
  }

  async inviteUrl(): Promise<DiscordInvite> {
    return this.guard(() => inviteUrl(this.rest, this.store))
  }

  async guilds(): Promise<DiscordGuild[]> {
    return this.guard(() => listGuilds(this.rest))
  }

  async setup(guildId: string): Promise<DiscordSetupResult> {
    // One lead agent per channel is what the rooms talk to.
    this.o.ctx.orchestra.seed()
    const result = await this.guard(() => runSetup(this.rest, this.store, guildId, this.channels()))
    this.changed()
    return result
  }

  setEnabled(on: boolean): DiscordStatus {
    if (on) {
      if (this.token() === null) throw new Error(t('discord.err.noToken'))
      if (!isSetUp(this.store.get())) throw new Error(t('discord.err.notSetUp'))
    }
    this.store.setEnabled(on === true)
    if (on) this.bridge.start()
    else this.bridge.stop()
    return this.changed()
  }

  configure(input: DiscordConfigInput): DiscordStatus {
    const st = this.store.get()
    if (input && input.summaryHour !== undefined) {
      const h = input.summaryHour
      if (h !== null && (!Number.isInteger(h) || h < 0 || h > 23)) throw new Error(t('discord.err.hour'))
      st.summaryHour = h
    }
    if (input && input.notifications !== undefined) {
      if (!(NOTIFICATION_LEVELS as readonly unknown[]).includes(input.notifications)) throw new Error(t('discord.err.notifications'))
      st.notifications = input.notifications
    }
    if (input && input.weeklyDay !== undefined) {
      const d = input.weeklyDay
      if (d !== null && (!Number.isInteger(d) || d < 1 || d > 7)) throw new Error(t('discord.err.weekday'))
      st.weeklyDay = d
    }
    if (input && input.allowedUserIds !== undefined) {
      const ids = input.allowedUserIds
      if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string' && USER_ID.test(x))) throw new Error(t('discord.err.userId'))
      st.allowedUserIds = [...new Set(ids)]
    }
    this.store.save()
    return this.changed()
  }

  async test(): Promise<DiscordTestResult> {
    const st = this.store.get()
    if (!st.atlasId) throw new Error(t('discord.err.notSetUp'))
    await this.guard(() => this.bridge.post(st.atlasId as string, t('discord.msg.test')))
    return { ok: true, channel: 'atlas' }
  }

  private changed(): DiscordStatus {
    this.o.notify()
    return this.status()
  }

  /** Runs a Discord call; its failure becomes a token-free, human message. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      throw this.fail(err, this.token())
    }
  }

  private fail(err: unknown, token: string | null): Error {
    if (err instanceof DiscordError && err.status === 401) return new Error(t('discord.err.tokenRefused'))
    return new Error(scrub(err instanceof Error ? err.message : String(err), token))
  }
}
