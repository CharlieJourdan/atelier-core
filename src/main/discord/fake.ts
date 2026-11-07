// An in-memory Discord for tests and for the e2e build (ATELIER_FAKE_LLM=1): guilds, channels, threads, messages, reactions
// and button clicks kept in memory behind the same `fetch` signature the REST client uses, plus a gateway socket that
// hands the clicks over (`gateway()`, `click()`). No network, ever.
import type { SocketFactory, SocketLike } from './gateway'
import type { FetchLike } from './rest'
import {
  CHANNEL_CATEGORY,
  CHANNEL_PUBLIC_THREAD,
  CHANNEL_TEXT,
  snowflakeCompare,
  type DiscordActionRow,
  type DiscordChannel,
  type DiscordInteraction,
  type DiscordMessage,
  type DiscordUser
} from './types'

export interface FakeGuild {
  id: string
  name: string
  owner_id: string
}

export const FAKE_BOT: DiscordUser = { id: '900000000000000001', username: 'AtelierBot', bot: true }
export const FAKE_APP_ID = '900000000000000002'
export const FAKE_OWNER_ID = '800000000000000001'

export class FakeDiscord {
  readonly guilds: FakeGuild[] = []
  readonly channels = new Map<string, DiscordChannel[]>()
  readonly messages = new Map<string, DiscordMessage[]>()
  readonly reactions = new Map<string, DiscordUser[]>()
  /** Every request seen: method, path (no query), and whether the bot header was the accepted one. */
  readonly calls: { method: string; path: string; authorised: boolean }[] = []
  /** The answers to button clicks (interaction callbacks), in order. */
  readonly callbacks: { interactionId: string; type: number; data: Record<string, unknown> }[] = []
  /** The gateway sockets opened, and what the bot sent on them (identify, heartbeats, resume). */
  readonly sockets: FakeSocket[] = []
  /** Message id → the users its post was allowed to ping. */
  readonly mentions = new Map<string, string[]>()
  private next = 1_000_000_000_000_000_000n
  private limited = 0
  private retryAfter = 1

  /** `token`: the only accepted one; null accepts any. */
  constructor(private readonly token: string | null = null) {}

  private id(): string {
    return String(this.next++)
  }

  addGuild(name: string, ownerId = FAKE_OWNER_ID): FakeGuild {
    const g = { id: this.id(), name, owner_id: ownerId }
    this.guilds.push(g)
    this.channels.set(g.id, [])
    return g
  }

  channel(guildId: string, name: string): DiscordChannel | undefined {
    return this.channels.get(guildId)?.find((c) => c.name === name)
  }

  /** The next `count` requests answer 429 with this `retry-after` (seconds). */
  rateLimit(count: number, retryAfterSeconds: number): void {
    this.limited = count
    this.retryAfter = retryAfterSeconds
  }

  /** A person writes in a channel. */
  say(channelId: string, userId: string, content: string, extra: Partial<DiscordMessage> = {}): DiscordMessage {
    const m: DiscordMessage = { id: this.id(), channel_id: channelId, content, author: { id: userId, username: `user-${userId.slice(-4)}` }, ...extra }
    this.list(channelId).push(m)
    return m
  }

  /** A person reacts to a message. */
  react(channelId: string, messageId: string, emoji: string, userId: string): void {
    const key = `${channelId}/${messageId}/${emoji}`
    const users = this.reactions.get(key) ?? []
    users.push({ id: userId, username: `user-${userId.slice(-4)}` })
    this.reactions.set(key, users)
  }

  /** What the bot posted in a channel. */
  botMessages(channelId: string): DiscordMessage[] {
    return this.list(channelId).filter((m) => m.author.id === FAKE_BOT.id)
  }

  /** A message by id, wherever it is. */
  message(messageId: string): DiscordMessage | undefined {
    for (const l of this.messages.values()) {
      const m = l.find((x) => x.id === messageId)
      if (m) return m
    }
    return undefined
  }

  /** The gateway's WebSocket: hello at once, READY after identify, acknowledgements of heartbeats. */
  gateway(): SocketFactory {
    return (url) => {
      const socket = new FakeSocket(url)
      this.sockets.push(socket)
      queueMicrotask(() => socket.serverSend({ op: 10, d: { heartbeat_interval: 41_250 } }))
      return socket
    }
  }

  /** A person clicks a button of a message: the interaction goes over the open gateway socket. */
  click(messageId: string, customId: string, userId: string): string {
    const m = this.message(messageId)
    if (!m) throw new Error(`no message ${messageId}`)
    const socket = this.sockets.findLast((x) => x.open && x.identified)
    if (!socket) throw new Error('no gateway connected')
    const i: DiscordInteraction = {
      id: this.id(),
      token: `itoken-${this.next}`,
      type: 3,
      channel_id: m.channel_id,
      data: { custom_id: customId, component_type: 2 },
      message: { id: m.id, channel_id: m.channel_id, content: m.content },
      member: { user: { id: userId, username: `user-${userId.slice(-4)}` } }
    }
    socket.dispatched.push(i)
    socket.serverSend({ op: 0, s: ++socket.seq, t: 'INTERACTION_CREATE', d: i })
    return i.id
  }

  private clickedMessage(interactionId: string): DiscordMessage | undefined {
    const ev = this.sockets.flatMap((sk) => sk.dispatched).find((d) => d.id === interactionId)
    return ev?.message ? this.message(ev.message.id) : undefined
  }

  private list(channelId: string): DiscordMessage[] {
    let l = this.messages.get(channelId)
    if (!l) this.messages.set(channelId, (l = []))
    return l
  }

  readonly fetch: FetchLike = async (url, init) => {
    const u = new URL(url)
    const path = u.pathname.replace(/^\/api\/v10/, '')
    const authorised = this.token === null ? /^Bot \S+$/.test(init.headers.Authorization ?? '') : init.headers.Authorization === `Bot ${this.token}`
    this.calls.push({ method: init.method, path, authorised })
    if (!authorised) return json(401, { message: '401: Unauthorized', code: 0 })
    if (this.limited > 0) {
      this.limited--
      return json(429, { message: 'You are being rate limited.', retry_after: this.retryAfter, global: false }, { 'retry-after': String(this.retryAfter) })
    }
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    return this.route(init.method, path, u.searchParams, body)
  }

  private route(method: string, path: string, q: URLSearchParams, body: Record<string, unknown>): Response {
    const p = path.split('/').filter(Boolean)
    if (method === 'GET' && path === '/users/@me') return json(200, FAKE_BOT)
    if (method === 'GET' && path === '/oauth2/applications/@me') return json(200, { id: FAKE_APP_ID, name: 'Atelier' })
    if (method === 'GET' && path === '/gateway/bot') return json(200, { url: 'wss://gateway.fake.invalid', shards: 1 })
    if (method === 'POST' && p[0] === 'interactions' && p[1] && p[3] === 'callback') {
      const data = (body.data ?? {}) as Record<string, unknown>
      this.callbacks.push({ interactionId: p[1], type: Number(body.type), data })
      // An update (type 7) rewrites the clicked message.
      const clicked = this.clickedMessage(p[1])
      if (Number(body.type) === 7 && clicked) {
        if (typeof data.content === 'string') clicked.content = data.content
        if (Array.isArray(data.components)) clicked.components = data.components as DiscordActionRow[]
      }
      return new Response(null, { status: 204 })
    }
    if (method === 'GET' && path === '/users/@me/guilds') return json(200, this.guilds.map((g) => ({ id: g.id, name: g.name, owner: false })))
    if (p[0] === 'guilds' && p[1]) {
      const guild = this.guilds.find((g) => g.id === p[1])
      if (!guild) return json(404, { message: 'Unknown Guild', code: 10004 })
      if (method === 'GET' && p.length === 2) return json(200, guild)
      if (p[2] === 'channels') {
        const list = this.channels.get(guild.id) ?? []
        if (method === 'GET') return json(200, list)
        if (method === 'POST') {
          const type = body.type === CHANNEL_CATEGORY ? CHANNEL_CATEGORY : CHANNEL_TEXT
          // Text channel names are lowercased with dashes by Discord; a category keeps its name as typed.
          const typed = String(body.name ?? '')
          const name = type === CHANNEL_CATEGORY ? typed : typed.toLowerCase().replace(/\s+/g, '-')
          const ch: DiscordChannel = { id: this.id(), type, name, parent_id: typeof body.parent_id === 'string' ? body.parent_id : null, topic: typeof body.topic === 'string' ? body.topic : null }
          list.push(ch)
          return json(201, ch)
        }
      }
    }
    if (p[0] === 'channels' && p[1] && p[2] === 'messages') {
      const channelId = p[1]
      const parent = [...this.channels.values()].find((l) => l.some((c) => c.id === channelId))
      if (!parent) return json(404, { message: 'Unknown Channel', code: 10003 })
      const list = this.list(channelId)
      if (p[3] && p[4] === 'threads' && method === 'POST') {
        const source = list.find((m) => m.id === p[3])
        if (!source) return json(404, { message: 'Unknown Message', code: 10008 })
        if (parent.some((c) => c.id === p[3])) return json(400, { message: 'A thread has already been created for this message', code: 160004 })
        // A thread started on a message takes the message's id.
        const thread: DiscordChannel = { id: source.id, type: CHANNEL_PUBLIC_THREAD, name: String(body.name ?? ''), parent_id: channelId }
        parent.push(thread)
        return json(201, thread)
      }
      if (p[3] && !p[4] && method === 'PATCH') {
        const m = list.find((x) => x.id === p[3])
        if (!m) return json(404, { message: 'Unknown Message', code: 10008 })
        if (typeof body.content === 'string') m.content = body.content
        if (Array.isArray(body.components)) m.components = body.components as DiscordActionRow[]
        return json(200, m)
      }
      if (!p[3]) {
        if (method === 'GET') {
          const limit = Math.min(100, Number(q.get('limit') ?? 50))
          const after = q.get('after')
          const sorted = [...list].sort((a, b) => snowflakeCompare(a.id, b.id))
          const picked = after ? sorted.filter((m) => snowflakeCompare(m.id, after) > 0).slice(0, limit) : sorted.slice(-limit)
          return json(200, picked.reverse())
        }
        if (method === 'POST') {
          const m: DiscordMessage = { id: this.id(), channel_id: channelId, content: String(body.content ?? ''), author: FAKE_BOT }
          if (typeof body.flags === 'number') m.flags = body.flags
          if (Array.isArray(body.components)) m.components = body.components as DiscordActionRow[]
          this.mentions.set(m.id, ((body.allowed_mentions as { users?: string[] } | undefined)?.users ?? []).slice())
          list.push(m)
          return json(200, m)
        }
      }
      if (p[4] === 'reactions' && p[5]) {
        const emoji = decodeURIComponent(p[5])
        const key = `${channelId}/${p[3]}/${emoji}`
        if (method === 'PUT') {
          const users = this.reactions.get(key) ?? []
          users.push(FAKE_BOT)
          this.reactions.set(key, users)
          return new Response(null, { status: 204 })
        }
        if (method === 'GET') return json(200, this.reactions.get(key) ?? [])
      }
    }
    return json(404, { message: `Unknown route ${method} ${path}`, code: 0 })
  }
}

/** One gateway connection: what the bot sends is recorded and answered like Discord does. */
export class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  readonly sent: { op: number; d: unknown }[] = []
  /** The interactions handed over on this connection. */
  readonly dispatched: DiscordInteraction[] = []
  open = true
  identified = false
  seq = 0

  constructor(readonly url: string) {}

  send(data: string): void {
    const p = JSON.parse(data) as { op: number; d: unknown }
    this.sent.push(p)
    if (p.op === 1) queueMicrotask(() => this.serverSend({ op: 11, d: null }))
    if (p.op === 2) {
      this.identified = true
      queueMicrotask(() => this.serverSend({ op: 0, s: ++this.seq, t: 'READY', d: { session_id: 'fake-session', resume_gateway_url: 'wss://resume.fake.invalid' } }))
    }
    if (p.op === 6) {
      this.identified = true
      queueMicrotask(() => this.serverSend({ op: 0, s: ++this.seq, t: 'RESUMED', d: {} }))
    }
  }

  close(code = 1000): void {
    if (!this.open) return
    this.open = false
    queueMicrotask(() => this.onclose?.({ code }))
  }

  /** Discord drops the connection (the bot should come back and resume). */
  drop(code = 1006): void {
    this.close(code)
  }

  serverSend(p: { op: number; d: unknown; s?: number; t?: string }): void {
    if (this.open) this.onmessage?.({ data: JSON.stringify(p) })
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** The Discord of the e2e build: one server the bot is already in, any well-shaped token accepted. */
export function e2eDiscord(): FakeDiscord {
  const d = new FakeDiscord(null)
  d.addGuild('Serveur de test')
  return d
}
