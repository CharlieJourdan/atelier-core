// Main-process end of the MCP relay: a named pipe (Windows) / Unix socket server. Each agent run registers its
// tools and gets a fresh random token; a connection must say `hello` with a live token first, or it is closed.
// Tokens are kept only as SHA-256 hashes and revoked when the run ends.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, rmSync } from 'node:fs'
import net from 'node:net'
import type { ToolCallResult, ToolSpec } from '../llm/types'
import {
  bridgePath,
  encode,
  HELLO_TIMEOUT_MS,
  LineSplitter,
  MAX_LINE_BYTES,
  parseObject,
  type ServerMessage
} from '../mcp/protocol'

export interface BridgeSession {
  specs: ToolSpec[]
  call(name: string, args: unknown): Promise<ToolCallResult>
}

const MAX_WAITING_HELLO = 16
/** A hello line is short: anything longer before authentication is refused. */
const MAX_HELLO_BYTES = 1024

/** After a denial is flushed, how long the peer gets to read it before the connection is torn down. */
export const DENY_GRACE_MS = 250

const hash = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest()

/** The bridge's clock, injectable so tests drive the hello timeout without depending on accept() ordering. */
export interface BridgeTimers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: BridgeTimers = {
  set: (fn, ms) => setTimeout(fn, ms).unref(),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout)
}

export class BridgeServer {
  readonly address: string
  private server: net.Server | null = null
  private readonly sessions = new Map<string, { digest: Buffer; session: BridgeSession }>()
  private readonly sockets = new Set<net.Socket>()
  private waitingHello = 0

  constructor(
    id = randomBytes(8).toString('hex'),
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly timers: BridgeTimers = realTimers
  ) {
    this.address = bridgePath(id, platform)
  }

  listen(): Promise<string> {
    if (this.platform !== 'win32') rmSync(this.address, { force: true })
    const server = net.createServer((socket) => this.accept(socket))
    this.server = server
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.address, () => {
        server.off('error', reject)
        // Only Charlie's account may open the socket file (the token is still required).
        if (this.platform !== 'win32') chmodSync(this.address, 0o600)
        resolve(this.address)
      })
    })
  }

  /** Registers a run's tools; returns its token and a function that revokes it. */
  register(session: BridgeSession): { token: string; revoke: () => void } {
    const token = randomBytes(32).toString('hex')
    const key = randomBytes(8).toString('hex')
    this.sessions.set(key, { digest: hash(token), session })
    return { token, revoke: () => this.sessions.delete(key) }
  }

  get listening(): boolean {
    return this.server?.listening ?? false
  }

  get activeSessions(): number {
    return this.sessions.size
  }

  close(): Promise<void> {
    this.sessions.clear()
    for (const s of this.sockets) s.destroy()
    const server = this.server
    this.server = null
    if (!server) return Promise.resolve()
    return new Promise((resolve) => server.close(() => resolve()))
  }

  private find(token: unknown): BridgeSession | null {
    if (typeof token !== 'string' || token.length === 0 || token.length > 256) return null
    const digest = hash(token)
    let found: BridgeSession | null = null
    // Compare against every live token in constant time (no early exit, no map lookup on the secret).
    for (const entry of this.sessions.values()) {
      if (timingSafeEqual(entry.digest, digest)) found = entry.session
    }
    return found
  }

  private accept(socket: net.Socket): void {
    // Only a few connections may wait for their hello at once (each MCP server says it right away).
    if (this.waitingHello >= MAX_WAITING_HELLO) {
      socket.destroy()
      return
    }
    this.waitingHello++
    let waiting = true
    const helloDone = (): void => {
      if (waiting) this.waitingHello--
      waiting = false
    }
    this.sockets.add(socket)
    socket.setEncoding('utf8')
    let session: BridgeSession | null = null
    const write = (msg: ServerMessage): void => {
      if (!socket.destroyed) socket.write(encode(msg))
    }
    let denied = false
    let grace: unknown = null
    const deny = (error: string): void => {
      if (denied) return
      denied = true
      helloDone()
      if (socket.destroyed) return
      // One try per connection: say why, then close (whatever else the client sends is ignored). Stop reading and
      // half-close instead of destroying at once: on a Unix socket, destroying while the client's bytes are still
      // unread resets the connection and the client never sees the denial. The socket goes away once the peer has
      // closed, or after a short grace period.
      socket.pause()
      socket.end(encode({ t: 'denied', error }), () => {
        grace = this.timers.set(() => socket.destroy(), DENY_GRACE_MS)
      })
    }
    const timer = this.timers.set(() => deny('No hello'), HELLO_TIMEOUT_MS)
    const splitter = new LineSplitter(
      (line) => {
        if (denied) return
        const msg = parseObject(line)
        if (!session) {
          this.timers.clear(timer)
          const s = msg?.t === 'hello' ? this.find(msg.token) : null
          if (!s) return deny('Unknown or expired token')
          session = s
          helloDone()
          splitter.max = MAX_LINE_BYTES
          write({ t: 'ok' })
          return
        }
        const id = msg && typeof msg.id === 'number' ? msg.id : -1
        // The run may have ended while its MCP server was still connected: refuse from then on.
        if (![...this.sessions.values()].some((e) => e.session === session)) {
          write({ t: 'error', id, error: 'This agent run has ended' })
          return
        }
        if (msg?.t === 'list') {
          write({ t: 'tools', id, tools: session.specs })
        } else if (msg?.t === 'call' && typeof msg.name === 'string') {
          const current = session
          void current.call(msg.name, msg.args).then(
            (r) => write({ t: 'result', id, text: r.text, isError: r.isError, ...(r.images?.length ? { images: r.images } : {}) }),
            (err: unknown) => write({ t: 'error', id, error: err instanceof Error ? err.message : String(err) })
          )
        } else {
          write({ t: 'error', id, error: 'Bad request' })
        }
      },
      () => deny('Message too large'),
      MAX_HELLO_BYTES
    )
    socket.on('data', (chunk: string) => splitter.push(chunk))
    socket.on('error', () => undefined)
    socket.on('close', () => {
      this.timers.clear(timer)
      if (grace !== null) this.timers.clear(grace)
      helloDone()
      this.sockets.delete(socket)
    })
  }
}
