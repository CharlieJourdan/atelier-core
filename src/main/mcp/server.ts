// The Atelier MCP server: JSON-RPC 2.0 over stdio (one message per line), as the Claude Code CLI expects from a
// stdio MCP server. It holds no data and no secrets: every tools/list and tools/call is relayed to the main
// process over the bridge, which checks the run's token and runs the tool. Node built-ins only.
import net from 'node:net'
import type { Readable, Writable } from 'node:stream'
import {
  encode,
  HELLO_TIMEOUT_MS,
  LineSplitter,
  parseObject,
  type ServerMessage,
  type WireToolSpec
} from './protocol'

export const SERVER_INFO = { name: 'atelier', version: '1.0.0' }
const DEFAULT_PROTOCOL = '2025-06-18'

export interface BridgeClient {
  list(): Promise<WireToolSpec[]>
  call(name: string, args: unknown): Promise<{ text: string; isError: boolean; images?: { mimeType: string; data: string }[] }>
  close(): void
}

type Pending = { resolve: (m: ServerMessage) => void; reject: (e: Error) => void }

/** Connects to the bridge and authenticates with the run's token. Rejects when the token is refused. */
export function connectBridge(
  address: string,
  token: string,
  connect: (address: string) => net.Socket = (a) => net.connect(a)
): Promise<BridgeClient> {
  return new Promise((resolve, reject) => {
    const socket = connect(address)
    socket.setEncoding('utf8')
    const pending = new Map<number, Pending>()
    let nextId = 1
    let ready = false
    let closedError: Error | null = null
    const failAll = (err: Error): void => {
      closedError = err
      for (const p of pending.values()) p.reject(err)
      pending.clear()
    }
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Atelier bridge did not answer'))
    }, HELLO_TIMEOUT_MS)
    const splitter = new LineSplitter(
      (line) => {
        const msg = parseObject(line) as ServerMessage | null
        if (!msg) return
        if (!ready) {
          clearTimeout(timer)
          if (msg.t === 'ok') {
            ready = true
            resolve(client)
          } else {
            reject(new Error(msg.t === 'denied' ? msg.error : 'Atelier bridge refused the connection'))
            socket.destroy()
          }
          return
        }
        if ('id' in msg) {
          const p = pending.get(msg.id)
          if (p) {
            pending.delete(msg.id)
            p.resolve(msg)
          }
        }
      },
      () => socket.destroy()
    )
    socket.on('data', (chunk: string) => splitter.push(chunk))
    socket.on('error', (err) => {
      clearTimeout(timer)
      if (!ready) reject(err)
      failAll(err)
    })
    socket.on('close', () => {
      clearTimeout(timer)
      if (!ready) reject(new Error('Atelier bridge closed the connection'))
      failAll(new Error('Atelier bridge closed'))
    })

    const request = (msg: { t: 'list' } | { t: 'call'; name: string; args: unknown }): Promise<ServerMessage> => {
      if (closedError) return Promise.reject(closedError)
      const id = nextId++
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej })
        socket.write(encode({ ...msg, id }))
      })
    }
    const client: BridgeClient = {
      async list() {
        const m = await request({ t: 'list' })
        if (m.t === 'tools') return m.tools
        throw new Error(m.t === 'error' ? m.error : 'Unexpected bridge answer')
      },
      async call(name, args) {
        const m = await request({ t: 'call', name, args })
        if (m.t === 'result') return { text: m.text, isError: m.isError, ...(m.images?.length ? { images: m.images } : {}) }
        if (m.t === 'error') return { text: m.error, isError: true }
        throw new Error('Unexpected bridge answer')
      },
      close: () => socket.end()
    }
    socket.write(encode({ t: 'hello', token }))
  })
}

interface RpcRequest {
  id?: string | number | null
  method?: unknown
  params?: unknown
}

/** Serves MCP on `input`/`output` until the input ends. Resolves when it does. */
export function runMcpServer(io: { input: Readable; output: Writable; bridge: Promise<BridgeClient> }): Promise<void> {
  const send = (msg: Record<string, unknown>): void => {
    io.output.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
  }
  const reply = (id: RpcRequest['id'], result: unknown): void => send({ id, result })
  const fail = (id: RpcRequest['id'], code: number, message: string): void => send({ id: id ?? null, error: { code, message } })

  const handle = async (req: RpcRequest): Promise<void> => {
    const isRequest = req.id !== undefined && req.id !== null
    if (typeof req.method !== 'string') {
      if (isRequest) fail(req.id, -32600, 'Invalid request')
      return
    }
    if (!isRequest) return // notifications (initialized, cancelled…) need no answer
    const params = (typeof req.params === 'object' && req.params !== null ? req.params : {}) as Record<string, unknown>
    switch (req.method) {
      case 'initialize':
        reply(req.id, {
          protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO
        })
        return
      case 'ping':
        reply(req.id, {})
        return
      case 'tools/list':
        try {
          const tools = await (await io.bridge).list()
          reply(req.id, { tools })
        } catch (err) {
          fail(req.id, -32603, `Atelier is not reachable: ${message(err)}`)
        }
        return
      case 'tools/call': {
        if (typeof params.name !== 'string') {
          fail(req.id, -32602, 'tools/call needs a tool name')
          return
        }
        try {
          const r = await (await io.bridge).call(params.name, params.arguments ?? {})
          const images = (r.images ?? []).map((im) => ({ type: 'image', data: im.data, mimeType: im.mimeType }))
          reply(req.id, { content: [{ type: 'text', text: r.text }, ...images], isError: r.isError })
        } catch (err) {
          reply(req.id, { content: [{ type: 'text', text: `Atelier is not reachable: ${message(err)}` }], isError: true })
        }
        return
      }
      default:
        fail(req.id, -32601, `Method not found: ${req.method}`)
    }
  }

  return new Promise((resolve) => {
    io.input.setEncoding('utf8')
    const splitter = new LineSplitter(
      (line) => {
        const req = parseObject(line)
        if (!req) {
          fail(null, -32700, 'Parse error')
          return
        }
        void handle(req as RpcRequest)
      },
      () => fail(null, -32600, 'Message too large')
    )
    io.input.on('data', (chunk: string) => splitter.push(chunk))
    io.input.on('end', () => resolve())
    io.input.on('close', () => resolve())
  })
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
