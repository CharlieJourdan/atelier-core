import { randomBytes } from 'node:crypto'
import net from 'node:net'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeServer, DENY_GRACE_MS, type BridgeSession, type BridgeTimers } from '../../src/main/agents/bridge'
import { bridgePath, encode, HELLO_TIMEOUT_MS, LineSplitter, MAX_LINE_BYTES, parseObject } from '../../src/main/mcp/protocol'
import { connectBridge, runMcpServer, SERVER_INFO } from '../../src/main/mcp/server'

const servers: BridgeServer[] = []
const clients: { close(): void }[] = []

async function startServer(timers?: BridgeTimers): Promise<BridgeServer> {
  const server = new BridgeServer(`test-${randomBytes(6).toString('hex')}`, process.platform, timers)
  servers.push(server)
  await server.listen()
  return server
}

afterEach(async () => {
  vi.useRealTimers()
  for (const c of clients.splice(0)) c.close()
  for (const s of servers.splice(0)) await s.close()
})

const SPECS = [
  { name: 'get_brief', description: 'The brief', inputSchema: { type: 'object', properties: {} } },
  { name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }
]

function session(over: Partial<BridgeSession> = {}): BridgeSession & { calls: { name: string; args: unknown }[] } {
  const calls: { name: string; args: unknown }[] = []
  return {
    specs: SPECS,
    calls,
    call: async (name, args) => {
      calls.push({ name, args })
      if (name === 'boom') throw new Error('handler exploded')
      return { text: `ran ${name} ${JSON.stringify(args)}`, isError: name === 'bad' }
    },
    ...over
  }
}

/** Raw socket client: sends lines, collects everything the server writes until it closes. */
function rawClient(address: string, lines: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(address)
    let data = ''
    socket.setEncoding('utf8')
    socket.on('data', (d: string) => (data += d))
    socket.on('error', reject)
    socket.on('close', () => resolve(data))
    socket.on('connect', () => {
      for (const l of lines) socket.write(l)
    })
  })
}

describe('bridge authentication', () => {
  it('denies a wrong token with a reason and never reaches the session', async () => {
    const server = await startServer()
    const s = session()
    server.register(s)
    await expect(connectBridge(server.address, 'not-the-token')).rejects.toThrow('Unknown or expired token')
    expect(s.calls).toEqual([])
  })

  it('ignores anything sent after a denial', async () => {
    const server = await startServer()
    const s = session()
    const { token } = server.register(s)
    const out = await rawClient(server.address, [
      encode({ t: 'hello', token: 'wrong' }),
      encode({ t: 'hello', token }), // a second try on the same connection
      encode({ t: 'call', id: 1, name: 'echo', args: { text: 'x' } })
    ])
    const replies = out.split('\n').filter(Boolean).map((l) => JSON.parse(l))
    expect(replies).toEqual([{ t: 'denied', error: 'Unknown or expired token' }])
    expect(s.calls).toEqual([])
  })

  it('denies a first line that is not a hello, and garbage', async () => {
    const server = await startServer()
    const s = session()
    server.register(s)
    const out1 = await rawClient(server.address, [encode({ t: 'list', id: 1 })])
    expect(JSON.parse(out1.trim())).toEqual({ t: 'denied', error: 'Unknown or expired token' })
    const out2 = await rawClient(server.address, ['not json\n'])
    expect(JSON.parse(out2.trim())).toMatchObject({ t: 'denied' })
    const out3 = await rawClient(server.address, [encode({ t: 'hello', token: 42 as never })])
    expect(JSON.parse(out3.trim())).toMatchObject({ t: 'denied' })
    expect(s.calls).toEqual([])
  })

  it('denies a connection that never says hello', async () => {
    // The bridge's own clock is driven by hand: no dependence on when accept() runs relative to the test (it differs
    // between a Windows named pipe and a Unix socket).
    const clock = manualClock()
    const server = await startServer(clock)
    const socket = net.connect(server.address)
    socket.setEncoding('utf8')
    let data = ''
    socket.on('data', (d: string) => (data += d))
    socket.on('error', () => undefined)
    const closed = new Promise<void>((r) => socket.once('close', () => r()))
    await new Promise<void>((r) => socket.once('connect', () => r()))
    // the server has armed the hello timer once it has accepted the connection
    await vi.waitFor(() => expect(clock.pending()).toEqual([HELLO_TIMEOUT_MS]))
    clock.advance(HELLO_TIMEOUT_MS - 1)
    await new Promise<void>((r) => setImmediate(r))
    expect(data).toBe('')
    clock.advance(1)
    await vi.waitFor(() => expect(data).toContain('\n'))
    expect(JSON.parse(data.trim())).toEqual({ t: 'denied', error: 'No hello' })
    // the connection is torn down at the latest when the grace period ends
    clock.advance(DENY_GRACE_MS)
    await closed
  })
})

/** A hand-driven BridgeTimers: `advance(ms)` fires what is due. */
function manualClock(): BridgeTimers & { advance(ms: number): void; pending(): number[] } {
  let now = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  let next = 1
  return {
    set: (fn, ms) => {
      timers.set(next, { at: now + ms, fn })
      return next++
    },
    clear: (handle) => void timers.delete(handle as number),
    pending: () => [...timers.values()].map((t) => t.at - now),
    advance(ms) {
      now += ms
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id)
          t.fn()
        }
      }
    }
  }
}

describe('bridge calls', () => {
  it('lists the registered specs and round-trips arguments and results', async () => {
    const server = await startServer()
    const s = session()
    const { token } = server.register(s)
    const client = await connectBridge(server.address, token)
    clients.push(client)
    expect(await client.list()).toEqual(SPECS)
    const args = { text: 'héllo "quoted"\nnew line', n: [1, { deep: true }] }
    expect(await client.call('echo', args)).toEqual({ text: `ran echo ${JSON.stringify(args)}`, isError: false })
    expect(s.calls).toEqual([{ name: 'echo', args }])
    expect(await client.call('bad', {})).toMatchObject({ isError: true })
  })

  it('turns a throwing handler into an error result and keeps the connection usable', async () => {
    const server = await startServer()
    const { token } = server.register(session())
    const client = await connectBridge(server.address, token)
    clients.push(client)
    expect(await client.call('boom', {})).toEqual({ text: 'handler exploded', isError: true })
    expect(await client.call('echo', { text: 'ok' })).toMatchObject({ isError: false })
  })

  it('answers concurrent calls to the right caller', async () => {
    const server = await startServer()
    const { token } = server.register(session())
    const client = await connectBridge(server.address, token)
    clients.push(client)
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => client.call('echo', { i })))
    expect(results.map((r) => r.text)).toEqual([1, 2, 3, 4, 5].map((i) => `ran echo {"i":${i}}`))
  })

  it('keeps sessions apart by token', async () => {
    const server = await startServer()
    const a = session()
    const b = session({ specs: [SPECS[0]!] })
    const ta = server.register(a).token
    const tb = server.register(b).token
    const ca = await connectBridge(server.address, ta)
    const cb = await connectBridge(server.address, tb)
    clients.push(ca, cb)
    expect(await ca.list()).toHaveLength(2)
    expect(await cb.list()).toHaveLength(1)
    await cb.call('get_brief', {})
    expect(a.calls).toEqual([])
    expect(b.calls).toHaveLength(1)
  })

  it('a revoked token is refused for new connections and for calls on open ones', async () => {
    const server = await startServer()
    const s = session()
    const { token, revoke } = server.register(s)
    const client = await connectBridge(server.address, token)
    clients.push(client)
    expect(server.activeSessions).toBe(1)
    revoke()
    expect(server.activeSessions).toBe(0)
    expect(await client.call('echo', { text: 'late' })).toEqual({ text: 'This agent run has ended', isError: true })
    await expect(client.list()).rejects.toThrow('This agent run has ended')
    expect(s.calls).toEqual([])
    await expect(connectBridge(server.address, token)).rejects.toThrow('Unknown or expired token')
  })

  it('answers a bad request with an error, not a crash', async () => {
    const server = await startServer()
    const { token } = server.register(session())
    const out = await new Promise<string>((resolve) => {
      const socket = net.connect(server.address)
      let data = ''
      socket.setEncoding('utf8')
      socket.on('data', (d: string) => {
        data += d
        if (data.split('\n').filter(Boolean).length === 2) {
          socket.destroy()
          resolve(data)
        }
      })
      socket.on('connect', () => socket.write(encode({ t: 'hello', token }) + '{"t":"call","id":9}\n'))
    })
    const [ok, bad] = out.split('\n').filter(Boolean).map((l) => JSON.parse(l))
    expect(ok).toEqual({ t: 'ok' })
    expect(bad).toEqual({ t: 'error', id: 9, error: 'Bad request' })
  })
})

describe('MCP server over stdio', () => {
  async function mcp() {
    const server = await startServer()
    const s = session()
    const { token } = server.register(s)
    const input = new PassThrough()
    const output = new PassThrough()
    const bridge = connectBridge(server.address, token)
    bridge.then((c) => clients.push(c), () => undefined)
    const done = runMcpServer({ input, output, bridge })
    const lines: Record<string, unknown>[] = []
    let buffer = ''
    const waiters: (() => void)[] = []
    output.setEncoding('utf8')
    output.on('data', (d: string) => {
      buffer += d
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        lines.push(JSON.parse(buffer.slice(0, nl)) as Record<string, unknown>)
        buffer = buffer.slice(nl + 1)
      }
      waiters.splice(0).forEach((w) => w())
    })
    const send = (msg: unknown) => input.write(typeof msg === 'string' ? `${msg}\n` : `${JSON.stringify(msg)}\n`)
    const reply = async (id: unknown): Promise<Record<string, unknown>> => {
      for (;;) {
        const found = lines.find((l) => l.id === id)
        if (found) return found
        await new Promise<void>((r) => waiters.push(r))
      }
    }
    return { s, input, send, reply, lines, done }
  }

  it('initializes, lists tools, calls them and ends when stdin ends', async () => {
    const { s, send, reply, lines, input, done } = await mcp()
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } })
    expect(await reply(1)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO }
    })
    expect(SERVER_INFO.name).toBe('atelier')

    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const list = (await reply(2)).result as { tools: { name: string; inputSchema: unknown }[] }
    expect(list.tools.map((t) => t.name)).toEqual(['get_brief', 'echo'])
    expect(list.tools[1]!.inputSchema).toMatchObject({ type: 'object', required: ['text'] })

    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } })
    expect((await reply(3)).result).toEqual({ content: [{ type: 'text', text: 'ran echo {"text":"hi"}' }], isError: false })
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'bad' } })
    expect((await reply(4)).result).toEqual({ content: [{ type: 'text', text: 'ran bad {}' }], isError: true })
    expect(s.calls.map((c) => c.name)).toEqual(['echo', 'bad'])

    send({ jsonrpc: '2.0', id: 5, method: 'ping' })
    expect((await reply(5)).result).toEqual({})
    // the notification got no answer
    expect(lines.map((l) => l.id)).toEqual([1, 2, 3, 4, 5])

    input.end()
    await done
  })

  it('defaults the protocol version when the client sends none', async () => {
    const { send, reply } = await mcp()
    send({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(((await reply(1)).result as { protocolVersion: string }).protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('answers -32601 for an unknown method, -32700 for garbage, -32602 for a nameless call', async () => {
    const { send, reply } = await mcp()
    send({ jsonrpc: '2.0', id: 7, method: 'resources/list' })
    expect((await reply(7)).error).toEqual({ code: -32601, message: 'Method not found: resources/list' })
    send('this is not json')
    expect((await reply(null)).error).toEqual({ code: -32700, message: 'Parse error' })
    send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: {} })
    expect((await reply(8)).error).toMatchObject({ code: -32602 })
    send({ jsonrpc: '2.0', id: 9 })
    expect((await reply(9)).error).toMatchObject({ code: -32600 })
  })

  it('reports an unreachable Atelier as a tool error and a -32603 on list', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const done = runMcpServer({ input, output, bridge: Promise.reject(new Error('no bridge')) })
    output.setEncoding('utf8')
    const got: string[] = []
    output.on('data', (d: string) => got.push(d))
    input.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"x"}}\n')
    await vi.waitFor(() => expect(got.join('').split('\n').filter(Boolean)).toHaveLength(2))
    const [a, b] = got.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    expect(a.error).toMatchObject({ code: -32603 })
    expect(a.error.message).toContain('no bridge')
    expect(b.result.isError).toBe(true)
    expect(b.result.content[0].text).toContain('no bridge')
    input.end()
    await done
  })
})

describe('protocol helpers', () => {
  it('bridgePath: a named pipe on win32, a socket file in the temp folder elsewhere', () => {
    expect(bridgePath('abc-123', 'win32')).toBe('\\\\.\\pipe\\atelier-bridge-abc-123')
    expect(bridgePath('abc-123', 'linux', '/tmp')).toBe('/tmp/atelier-bridge-abc-123.sock')
    expect(bridgePath('abc-123', 'darwin', '/var/folders/ab/cd/T')).toBe('/var/folders/ab/cd/T/atelier-bridge-abc-123.sock')
  })

  it('bridgePath on macOS: a temp folder too long for a socket path (104 bytes) falls back to /tmp', () => {
    const macTmp = '/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T'
    expect(bridgePath('0123456789abcdef', 'darwin', macTmp)).toBe(`${macTmp}/atelier-bridge-0123456789abcdef.sock`)
    const long = '/Users/charlie/' + 'very-long-folder-name/'.repeat(4)
    expect(bridgePath('0123456789abcdef', 'darwin', long)).toBe('/tmp/atelier-bridge-0123456789abcdef.sock')
  })

  it('bridgePath refuses ids that could escape the pipe or folder', () => {
    for (const bad of ['', '../x', 'a b', 'a\\b', 'a/b', 'x'.repeat(65), 'é']) {
      expect(() => bridgePath(bad, 'win32'), bad).toThrow(/Invalid bridge id/)
    }
    expect(() => new BridgeServer('../evil')).toThrow(/Invalid bridge id/)
  })

  it('LineSplitter joins chunks, drops blank lines and CR, and reports one overflow', () => {
    const lines: string[] = []
    let overflow = 0
    const sp = new LineSplitter((l) => lines.push(l), () => overflow++, 16)
    sp.push('ab')
    sp.push('c\r\n\n\nde')
    sp.push('f\nlast-no-newline')
    expect(lines).toEqual(['abc', 'def'])
    expect(overflow).toBe(0)
    sp.push('x'.repeat(40)) // pending line is now over 16 bytes
    expect(overflow).toBe(1)
    sp.push('more\nlines\n') // dropped for good
    expect(lines).toEqual(['abc', 'def'])
    expect(overflow).toBe(1)
  })

  it('LineSplitter counts bytes, not characters', () => {
    let overflow = 0
    const sp = new LineSplitter(() => undefined, () => overflow++, 8)
    sp.push('é'.repeat(5)) // 5 chars, 10 bytes
    expect(overflow).toBe(1)
    expect(MAX_LINE_BYTES).toBe(4 * 1024 * 1024)
  })

  it('the bridge closes a connection that sends a line over the limit', async () => {
    const server = await startServer()
    const socket = net.connect(server.address)
    socket.setEncoding('utf8')
    let data = ''
    socket.on('data', (d: string) => (data += d))
    const closed = new Promise<void>((r) => socket.once('close', () => r()))
    socket.on('error', () => undefined)
    await new Promise<void>((r) => socket.once('connect', () => r()))
    socket.write('x'.repeat(MAX_LINE_BYTES + 10))
    await closed
    expect(parseObject(data.trim())).toEqual({ t: 'denied', error: 'Message too large' })
  })
})
