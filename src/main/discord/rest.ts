// Discord REST client (API v10): bot auth header, injectable fetch and sleep, rate-limit aware. A 429 is retried after
// `retry-after` (header or body); a bucket that reports `X-RateLimit-Remaining: 0` makes the next call of the same route
// wait for `X-RateLimit-Reset-After`. The bot token is only ever put in the Authorization header: error messages are
// scrubbed of it and nothing here logs.
import {
  CHANNEL_CATEGORY,
  CHANNEL_TEXT,
  DISCORD_API,
  FLAG_SUPPRESS_NOTIFICATIONS,
  type DiscordActionRow,
  type DiscordApplication,
  type DiscordChannel,
  type DiscordGuild,
  type DiscordGuildRef,
  type DiscordMessage,
  type DiscordUser
} from './types'

/** How a post reaches the phone: silent (no push), or pinging these people (a decision waits for them). */
export interface PostOptions {
  silent?: boolean
  mention?: readonly string[]
  components?: DiscordActionRow[]
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>

export class DiscordError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null = null
  ) {
    super(message)
    this.name = 'DiscordError'
  }
}

export interface RestOptions {
  token: () => string | null
  fetch?: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  baseUrl?: string
  /** Retries after a 429 or a 5xx before giving up. */
  maxRetries?: number
}

interface Bucket {
  remaining: number
  resetAt: number
}

const MAX_WAIT_MS = 60_000

export class DiscordRest {
  private readonly buckets = new Map<string, Bucket>()
  private readonly fetchImpl: FetchLike
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly baseUrl: string
  private readonly maxRetries: number

  constructor(private readonly o: RestOptions) {
    this.fetchImpl = o.fetch ?? ((url, init) => fetch(url, init))
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.now = o.now ?? Date.now
    this.baseUrl = o.baseUrl ?? DISCORD_API
    this.maxRetries = o.maxRetries ?? 3
  }

  /** One call; returns the parsed JSON (null for 204). Throws DiscordError (token-free message). */
  async request<T>(method: string, path: string, opts: { query?: Record<string, string | number>; body?: unknown } = {}): Promise<T> {
    const token = this.o.token()
    if (!token) throw new DiscordError('No Discord bot token is set', 401)
    const query = opts.query ? `?${new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, String(v)])).toString()}` : ''
    const url = `${this.baseUrl}${path}${query}`
    const key = `${method} ${bucketKey(path)}`
    for (let attempt = 0; ; attempt++) {
      await this.waitFor(key)
      const headers: Record<string, string> = { Authorization: `Bot ${token}`, 'User-Agent': 'DiscordBot (https://atelier.app, 1)' }
      const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers }
      if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(opts.body)
      }
      let res: Response
      try {
        res = await this.fetchImpl(url, init)
      } catch (err) {
        throw new DiscordError(scrub(`Network error: ${err instanceof Error ? err.message : String(err)}`, token), 0)
      }
      this.learn(key, res)
      if (res.status === 429 && attempt < this.maxRetries) {
        await this.sleep(Math.min(MAX_WAIT_MS, await retryAfterMs(res)))
        continue
      }
      if (res.status >= 500 && attempt < this.maxRetries) {
        await this.sleep(500 * 2 ** attempt)
        continue
      }
      if (res.status === 204) return null as T
      const text = await res.text()
      let data: unknown
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }
      if (!res.ok) {
        const d = (data ?? {}) as { message?: unknown; code?: unknown }
        const msg = typeof d.message === 'string' ? d.message : `HTTP ${res.status}`
        throw new DiscordError(scrub(`Discord ${res.status}: ${msg}`, token), res.status, typeof d.code === 'number' ? d.code : null)
      }
      return data as T
    }
  }

  private async waitFor(key: string): Promise<void> {
    const b = this.buckets.get(key)
    if (!b || b.remaining > 0) return
    const wait = b.resetAt - this.now()
    if (wait > 0) await this.sleep(Math.min(MAX_WAIT_MS, wait))
    this.buckets.delete(key)
  }

  private learn(key: string, res: Response): void {
    const remaining = res.headers.get('x-ratelimit-remaining')
    const after = res.headers.get('x-ratelimit-reset-after')
    if (remaining === null || after === null) return
    const r = Number(remaining)
    const a = Number(after)
    if (Number.isFinite(r) && Number.isFinite(a)) this.buckets.set(key, { remaining: r, resetAt: this.now() + a * 1000 })
  }

  // ---- typed calls --------------------------------------------------------------------------------------

  me(): Promise<DiscordUser> {
    return this.request('GET', '/users/@me')
  }

  application(): Promise<DiscordApplication> {
    return this.request('GET', '/oauth2/applications/@me')
  }

  guilds(): Promise<DiscordGuildRef[]> {
    return this.request('GET', '/users/@me/guilds')
  }

  guild(id: string): Promise<DiscordGuild> {
    return this.request('GET', `/guilds/${id}`)
  }

  channels(guildId: string): Promise<DiscordChannel[]> {
    return this.request('GET', `/guilds/${guildId}/channels`)
  }

  createCategory(guildId: string, name: string): Promise<DiscordChannel> {
    return this.request('POST', `/guilds/${guildId}/channels`, { body: { name, type: CHANNEL_CATEGORY } })
  }

  createTextChannel(guildId: string, name: string, parentId: string, topic: string): Promise<DiscordChannel> {
    return this.request('POST', `/guilds/${guildId}/channels`, { body: { name, type: CHANNEL_TEXT, parent_id: parentId, topic } })
  }

  /** Newest first; `after` returns the messages newer than that id. */
  messages(channelId: string, query: { after?: string; limit?: number }): Promise<DiscordMessage[]> {
    const q: Record<string, string | number> = { limit: query.limit ?? 50 }
    if (query.after) q.after = query.after
    return this.request('GET', `/channels/${channelId}/messages`, { query: q })
  }

  postMessage(channelId: string, content: string, opts: PostOptions = {}): Promise<DiscordMessage> {
    const mention = opts.mention ?? []
    const body: Record<string, unknown> = {
      content: mention.length ? `${mention.map((id) => `<@${id}>`).join(' ')} ${content}` : content,
      allowed_mentions: { parse: [], users: [...mention] }
    }
    if (opts.silent) body.flags = FLAG_SUPPRESS_NOTIFICATIONS
    if (opts.components) body.components = opts.components
    return this.request('POST', `/channels/${channelId}/messages`, { body })
  }

  /** Replaces the text and / or the buttons of one of the bot's messages. */
  editMessage(channelId: string, messageId: string, patch: { content?: string; components?: DiscordActionRow[] }): Promise<DiscordMessage> {
    return this.request('PATCH', `/channels/${channelId}/messages/${messageId}`, { body: patch })
  }

  /** A public thread started on a message (its id is the message's). */
  startThread(channelId: string, messageId: string, name: string): Promise<DiscordChannel> {
    return this.request('POST', `/channels/${channelId}/messages/${messageId}/threads`, { body: { name, auto_archive_duration: 10080 } })
  }

  /** The answer to a button click (within 3 seconds of it). */
  async interactionCallback(id: string, token: string, body: { type: number; data?: Record<string, unknown> }): Promise<void> {
    await this.request('POST', `/interactions/${id}/${token}/callback`, { body })
  }

  /** Where the gateway (the live connection that brings the button clicks) is. */
  gatewayBot(): Promise<{ url: string }> {
    return this.request('GET', '/gateway/bot')
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.request('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`)
  }

  reactionUsers(channelId: string, messageId: string, emoji: string): Promise<DiscordUser[]> {
    return this.request('GET', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, { query: { limit: 25 } })
  }
}

/** Discord's buckets are per route with the major id (channel / guild) kept: other ids are folded. */
function bucketKey(path: string): string {
  const parts = path.split('/').filter(Boolean)
  // an interaction's id and token are new every time: one bucket for all of them
  if (parts[0] === 'interactions') return 'interactions/:id/:token/callback'
  let seenMajor = false
  return parts
    .map((p, i) => {
      if (!/^\d+$/.test(p)) return p
      const prev = parts[i - 1]
      if (!seenMajor && (prev === 'channels' || prev === 'guilds')) {
        seenMajor = true
        return p
      }
      return ':id'
    })
    .join('/')
}

async function retryAfterMs(res: Response): Promise<number> {
  const header = Number(res.headers.get('retry-after'))
  if (Number.isFinite(header) && header > 0) return Math.ceil(header * 1000)
  try {
    const body = (await res.json()) as { retry_after?: unknown }
    if (typeof body.retry_after === 'number' && body.retry_after > 0) return Math.ceil(body.retry_after * 1000)
  } catch {
    // no usable body
  }
  return 1000
}

/** Removes the token (and any bot-token-looking string) from a text. */
export function scrub(text: string, token: string | null): string {
  let out = text
  if (token) out = out.split(token).join('[token]')
  return out.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}/g, '[token]')
}
