// What the Discord bridge remembers between runs, in the settings table (`discord.state`, `discord.enabled`). No secret
// here: the bot token lives in the encrypted secrets store (SECRET_NAME).
import type { JsonValue } from '../../shared/api'
import type { SettingsStore } from '../settings'

export const SECRET_NAME = 'discord.botToken'
const STATE_KEY = 'discord.state'
const ENABLED_KEY = 'discord.enabled'
const MAX_REMEMBERED = 200
/** Question threads followed at once (each costs one read per pass). */
const MAX_THREADS = 15

/** What a pending item is (a runtime inbox item, a workflow deliverable, a production gate). */
export type PendingRef = { kind: 'inbox'; id: number } | { kind: 'approval'; id: number } | { kind: 'gate'; runId: number; nodeId: string }

/**
 * A message the bot posted that waits for a decision of the owner. `react`: ✅ / ❌ on it are still read (switched off once
 * a decision failed, so it is not retried); `buttons`: it carries buttons (removed once decided); `threadId`: the thread
 * opened on it for the conversation about this question.
 */
export type PostedRef = PendingRef & { channelId: string; react: boolean; buttons?: boolean; threadId?: string }

/**
 * A question's thread. While its question is open, a message there answers it; afterwards it goes to the agent who
 * asked (`orchestra.say`) and the agent's next reply comes back in the thread (`reply`).
 */
export interface ThreadState {
  ref: PendingRef
  agentId: number | null
  /** Newest message id read in the thread. */
  cursor: string
  /** Followed until then (ms): a thread nobody wrote in for days is let go. */
  until: number
  /** Waiting for the agent's reply in this conversation, after this message id. */
  reply?: { conversationId: number; afterId: number } | undefined
}

/** `important`: only decisions and alerts ping the phone, the rest is silent; `everything`: Discord's own rules; `nothing`: all silent. */
export const NOTIFICATION_LEVELS = ['important', 'everything', 'nothing'] as const
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number]

export interface RoomState {
  discordId: string
  name: string
}

export interface DiscordState {
  botUserId: string | null
  botName: string | null
  applicationId: string | null
  guildId: string | null
  guildName: string | null
  categoryId: string | null
  atlasId: string | null
  approvalsId: string | null
  productionId: string | null
  /** Atelier channel id → its Discord channel. */
  rooms: Record<string, RoomState>
  allowedUserIds: string[]
  summaryHour: number | null
  lastSummaryDay: string | null
  /** Discord channel id → newest message id read. */
  cursors: Record<string, string>
  /** Atelier conversation id → newest message id mirrored to Discord. */
  mirrored: Record<string, number>
  /** Discord message id → the decision it waits for. */
  posted: Record<string, PostedRef>
  /** Production run id → the state last announced. */
  runs: Record<string, string>
  contentIntentMissing: boolean
  /** Thread id → the question it is about. */
  threads: Record<string, ThreadState>
  notifications: NotificationLevel
  /** ISO weekday (1 = Monday) of the weekly report, posted at the summary hour; null = none. */
  weeklyDay: number | null
  lastWeeklyDay: string | null
}

export function emptyState(): DiscordState {
  return {
    botUserId: null,
    botName: null,
    applicationId: null,
    guildId: null,
    guildName: null,
    categoryId: null,
    atlasId: null,
    approvalsId: null,
    productionId: null,
    rooms: {},
    allowedUserIds: [],
    summaryHour: 8,
    lastSummaryDay: null,
    cursors: {},
    mirrored: {},
    posted: {},
    runs: {},
    contentIntentMissing: false,
    threads: {},
    notifications: 'important',
    weeklyDay: 1,
    lastWeeklyDay: null
  }
}

export class StateStore {
  private cache: DiscordState | null = null
  private saved = ''

  constructor(private readonly settings: SettingsStore) {}

  get(): DiscordState {
    if (!this.cache) {
      const raw = this.settings.get<Record<string, JsonValue>>(STATE_KEY)
      this.cache = { ...emptyState(), ...(raw && typeof raw === 'object' ? (raw as unknown as Partial<DiscordState>) : {}) }
      this.saved = JSON.stringify(this.cache)
    }
    return this.cache
  }

  /** Writes the state when it changed (the loop calls this every pass). */
  save(): void {
    const s = this.get()
    const keys = Object.keys(s.runs)
    if (keys.length > MAX_REMEMBERED) for (const k of keys.slice(0, keys.length - MAX_REMEMBERED)) delete s.runs[k]
    const posted = Object.keys(s.posted)
    if (posted.length > MAX_REMEMBERED) for (const k of posted.slice(0, posted.length - MAX_REMEMBERED)) delete s.posted[k]
    const threads = Object.keys(s.threads)
    if (threads.length > MAX_THREADS) for (const k of threads.slice(0, threads.length - MAX_THREADS)) delete s.threads[k]
    const text = JSON.stringify(s)
    if (text === this.saved) return
    this.settings.set(STATE_KEY, JSON.parse(text) as JsonValue)
    this.saved = text
  }

  enabled(): boolean {
    return this.settings.get<boolean>(ENABLED_KEY, false) === true
  }

  setEnabled(on: boolean): void {
    this.settings.set(ENABLED_KEY, on)
  }
}

/** The layout exists: a server was picked and the three fixed channels were created. */
export function isSetUp(s: DiscordState): boolean {
  return s.guildId !== null && s.atlasId !== null && s.approvalsId !== null && s.productionId !== null
}
