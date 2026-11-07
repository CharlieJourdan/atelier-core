// A local HTTP service on another machine (H1's production worker, a self-hosted Atelier Cloud) reached through an
// SSH tunnel: the system `ssh` with the user's ~/.ssh/config (a host alias) forwards a free local port to a
// port bound to 127.0.0.1 over there. Nothing is opened on the network: the tunnel is the only way in.
// `ssh -N -L 127.0.0.1:<free>:127.0.0.1:<remote> <host>` with ExitOnForwardFailure (a port that cannot be forwarded
// fails the start) and ServerAliveInterval=15 (a dead link closes the tunnel), BatchMode (never a password prompt).
// No shell; the host is a config alias checked before use. Starting the service over there is atelier-hand's job
// (a later lot): until then it must already run.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { findOnPath, killTree } from '../platform/process'

export type TunnelState = 'off' | 'connecting' | 'ready' | 'error'

export interface TunnelStatus {
  state: TunnelState
  /** http://127.0.0.1:<local port> while the tunnel is ready. */
  url: string | null
  lastError: string | null
}

/** True when the service answers at `baseUrl` within `timeoutMs` (any HTTP answer below 500 counts). */
export type TunnelProbe = (baseUrl: string, timeoutMs: number) => Promise<boolean>

export interface SshTunnelOptions {
  /** The SSH host alias (an alias of ~/.ssh/config). */
  host: () => string
  /** The service's port on the remote machine (bound to 127.0.0.1 there). */
  remotePort: () => number
  /** What the remote service is, for messages ("the production worker on H1"). */
  service?: string
  /** How readiness is checked (default: an HTTP GET of `healthPath`). */
  probe?: TunnelProbe
  /** Path the default probe asks (default "/"). */
  healthPath?: string
  platform?: NodeJS.Platform
  /** The ssh binary; default: Windows' OpenSSH by full path, `/usr/bin/ssh` on macOS. */
  sshPath?: () => string | null
  spawnProcess?: typeof spawn
  /** A free local port (default: one the OS hands out). */
  localPort?: () => Promise<number>
  readyTimeoutMs?: number
  probeIntervalMs?: number
  kill?: (pid: number) => void
  env?: NodeJS.ProcessEnv
  onChange?: () => void
}

/** An SSH host alias: letters, digits, dots, dashes, underscores; never starting with a dash (no option injection). */
export const SAFE_HOST = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/

/** What ssh gets from Atelier's environment: enough to find ~/.ssh and the agent, nothing else. */
const SSH_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SSH_AUTH_SOCK', 'TMPDIR', 'LANG', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'TEMP', 'TMP', 'COMSPEC'] as const

export function sshArgs(host: string, localPort: number, remotePort: number): string[] {
  if (!SAFE_HOST.test(host)) throw new Error(`Not an SSH host alias: ${JSON.stringify(host)}`)
  for (const p of [localPort, remotePort]) if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`Bad port ${p}`)
  return [
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'BatchMode=yes',
    '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    host
  ]
}

export function defaultSshPath(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists = existsSync): string | null {
  if (platform === 'win32') {
    const full = path.win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe')
    return exists(full) ? full : findOnPath('ssh', { platform, pathVar: env.PATH ?? env.Path, pathExt: env.PATHEXT, exists })
  }
  return exists('/usr/bin/ssh') ? '/usr/bin/ssh' : null
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
  })
}

/** The default probe: an HTTP GET of `path` that gets any answer below 500 in time. */
export function httpProbe(pathName = '/'): TunnelProbe {
  return async (baseUrl, timeoutMs) => {
    try {
      const res = await fetch(new URL(pathName, baseUrl), { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
      await res.body?.cancel()
      return res.status < 500
    } catch {
      return false
    }
  }
}

export class SshTunnel {
  private child: ChildProcess | null = null
  private port: number | null = null
  private state: TunnelState = 'off'
  private lastError: string | null = null
  private opening: Promise<string> | null = null
  private stderr = ''

  constructor(private readonly opts: SshTunnelOptions) {}

  status(): TunnelStatus {
    return { state: this.state, url: this.state === 'ready' && this.port ? `http://127.0.0.1:${this.port}` : null, lastError: this.lastError }
  }

  /** The base URL when the tunnel is up and the service answers now; never opens anything. */
  async readyUrl(): Promise<string | null> {
    if (this.state !== 'ready' || !this.port) return null
    const url = `http://127.0.0.1:${this.port}`
    return (await this.probe(url, 1500)) ? url : null
  }

  /** Opens the tunnel (once; concurrent calls share it) and resolves with the base URL once the service answers. */
  ensureReady(): Promise<string> {
    if (this.state === 'ready' && this.port) return Promise.resolve(`http://127.0.0.1:${this.port}`)
    this.opening ??= this.open().finally(() => (this.opening = null))
    return this.opening
  }

  close(): void {
    const child = this.child
    this.child = null
    this.port = null
    if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) this.killChild(child.pid)
    this.set('off')
  }

  private async open(): Promise<string> {
    this.close()
    this.set('connecting')
    this.lastError = null
    this.stderr = ''
    const ssh = (this.opts.sshPath ?? (() => defaultSshPath(this.platform)))()
    if (!ssh) return this.fail('No ssh client found (Windows: the OpenSSH client feature; macOS: /usr/bin/ssh)')
    const host = this.opts.host()
    const remote = this.opts.remotePort()
    let args: string[]
    let port: number
    try {
      port = await (this.opts.localPort ?? freePort)()
      args = sshArgs(host, port, remote)
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : String(err))
    }
    const env: Record<string, string> = {}
    const source = this.opts.env ?? process.env
    const win = this.platform === 'win32'
    for (const [k, v] of Object.entries(source)) if (v !== undefined && (SSH_ENV as readonly string[]).includes(win ? k.toUpperCase() : k)) env[k] = v
    const child = (this.opts.spawnProcess ?? spawn)(ssh, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      detached: !win,
      env
    })
    this.child = child
    this.port = port
    child.stderr?.on('data', (c: Buffer) => (this.stderr = (this.stderr + c.toString('utf8')).slice(-2000)))
    child.on('error', (err) => (this.lastError = `ssh did not start: ${err.message}`))
    const exited = new Promise<void>((res) => child.once('exit', () => res()))
    child.once('exit', (code) => {
      if (this.child !== child) return
      this.child = null
      this.port = null
      this.lastError = `The tunnel to ${host} closed (ssh exit ${String(code)})${this.tail()}`
      this.set('error')
    })
    const url = `http://127.0.0.1:${port}`
    const deadline = Date.now() + (this.opts.readyTimeoutMs ?? 20_000)
    while (Date.now() < deadline) {
      const outcome = await Promise.race([
        exited.then(() => 'exit' as const),
        new Promise<'tick'>((res) => setTimeout(() => res('tick'), this.opts.probeIntervalMs ?? 300))
      ])
      if (outcome === 'exit' || this.child !== child) break
      if (await this.probe(url, 1500)) {
        this.set('ready')
        return url
      }
    }
    if (this.child === child) {
      this.close()
      return this.fail(`The tunnel to ${host} is open but ${this.opts.service ?? 'the remote service'} does not answer on 127.0.0.1:${remote} (is it started?)${this.tail()}`)
    }
    return this.fail(this.lastError ?? `The tunnel to ${host} could not be opened`)
  }

  private fail(message: string): never {
    this.lastError = message
    this.set('error')
    throw new Error(message)
  }

  private tail(): string {
    const t = this.stderr.trim().split(/\r?\n/).slice(-2).join(' | ')
    return t ? `: ${t}` : ''
  }

  private probe(url: string, timeoutMs: number): Promise<boolean> {
    return (this.opts.probe ?? httpProbe(this.opts.healthPath))(url, timeoutMs)
  }

  private get platform(): NodeJS.Platform {
    return this.opts.platform ?? process.platform
  }

  private killChild(pid: number): void {
    if (this.opts.kill) this.opts.kill(pid)
    else killTree(pid, this.platform)
  }

  private set(state: TunnelState): void {
    if (this.state === state) return
    this.state = state
    try {
      this.opts.onChange?.()
    } catch {
      /* an observer never breaks the tunnel */
    }
  }
}
