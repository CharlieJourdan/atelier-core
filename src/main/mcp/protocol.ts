// Wire format between the Atelier MCP server (a child of the Claude Code CLI) and the main process: one JSON
// object per line over a Windows named pipe / Unix socket. The first line must be `hello` with the run's token;
// anything else, or a wrong token, closes the connection. Imported by both sides: node built-ins only.
import os from 'node:os'
import path from 'node:path'

export type ClientMessage =
  | { t: 'hello'; token: string }
  | { t: 'list'; id: number }
  | { t: 'call'; id: number; name: string; args: unknown }

export interface WireToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type ServerMessage =
  | { t: 'ok' }
  | { t: 'denied'; error: string }
  | { t: 'tools'; id: number; tools: WireToolSpec[] }
  | { t: 'result'; id: number; text: string; isError: boolean; images?: { mimeType: 'image/jpeg' | 'image/png'; data: string }[] }
  | { t: 'error'; id: number; error: string }

/** Longest accepted line (a saved script can be long, but not this long). */
export const MAX_LINE_BYTES = 4 * 1024 * 1024
export const HELLO_TIMEOUT_MS = 5000

export const ENV_BRIDGE = 'ATELIER_BRIDGE'
export const ENV_TOKEN = 'ATELIER_BRIDGE_TOKEN'

/** macOS's sun_path holds 104 bytes including the final NUL; keep a margin. */
export const MAX_SOCKET_PATH_BYTES = 100

/**
 * `\\.\pipe\atelier-bridge-<id>` on Windows, a socket file in the temp folder elsewhere. A Unix socket path is
 * limited to 104 bytes on macOS: when the temp folder is too long (a custom TMPDIR), the socket goes to /tmp (it is
 * chmod 0600 and every run still needs its token).
 */
export function bridgePath(id: string, platform: NodeJS.Platform = process.platform, tmp: string = os.tmpdir()): string {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new Error(`Invalid bridge id: ${id}`)
  if (platform === 'win32') return `\\\\.\\pipe\\atelier-bridge-${id}`
  const preferred = path.posix.join(tmp, `atelier-bridge-${id}.sock`)
  return Buffer.byteLength(preferred) <= MAX_SOCKET_PATH_BYTES ? preferred : path.posix.join('/tmp', `atelier-bridge-${id}.sock`)
}

/** Splits a byte stream into lines; a line over `max` bytes is reported once and the stream is dropped. */
export class LineSplitter {
  private buffer = ''
  private overflowed = false

  constructor(
    private readonly onLine: (line: string) => void,
    private readonly onOverflow: () => void,
    /** Longest line accepted; may change (the bridge accepts long lines only after the hello). */
    public max = MAX_LINE_BYTES
  ) {}

  push(chunk: string): void {
    if (this.overflowed) return
    this.buffer += chunk
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '')
      this.buffer = this.buffer.slice(nl + 1)
      if (line.trim()) this.onLine(line)
      if (this.overflowed) return
    }
    if (Buffer.byteLength(this.buffer) > this.max) {
      this.overflowed = true
      this.buffer = ''
      this.onOverflow()
    }
  }
}

export function encode(msg: ClientMessage | ServerMessage): string {
  return `${JSON.stringify(msg)}\n`
}

export function parseObject(line: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(line)
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
