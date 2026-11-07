// The SSH tunnel to a service on another machine (src/main/remote/ssh-tunnel.ts), kept from lot 3 to reach H1's
// production worker or a self-hosted Atelier Cloud. A Node script plays ssh (tests/fixtures/fake-ssh.mjs: it
// forwards the local port to a port on this machine) and a plain HTTP server plays the remote service.
import { spawn } from 'node:child_process'
import http from 'node:http'
import type net from 'node:net'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSshPath, httpProbe, sshArgs, SshTunnel } from '../../src/main/remote/ssh-tunnel'

const FAKE_SSH = path.join(__dirname, '..', 'fixtures', 'fake-ssh.mjs')

let server: http.Server
let port: number
beforeEach(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ service: 'fake', path: req.url }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  port = (server.address() as net.AddressInfo).port
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
})

const tunnel = (host: string, remotePort: number, readyTimeoutMs = 5000) =>
  new SshTunnel({
    host: () => host,
    remotePort: () => remotePort,
    service: 'the production worker on H1',
    healthPath: '/health',
    sshPath: () => 'ssh',
    // the fixture plays ssh: it forwards the local port to the "remote" one on this machine
    spawnProcess: ((_cmd: string, args: readonly string[], opts: object) => spawn(process.execPath, [FAKE_SSH, ...args], opts)) as unknown as typeof spawn,
    readyTimeoutMs,
    probeIntervalMs: 50,
    kill: (pid) => process.kill(pid)
  })

describe('SSH tunnel to a remote service (simulated ssh)', () => {
  // spawns a Node child that plays ssh: slow to start on a loaded machine
  it('opens the tunnel, talks to the service through it, and closes it', { timeout: 30_000 }, async () => {
    const t = tunnel('cerveau', port)
    const url = await t.ensureReady()
    expect(url).not.toBe(`http://127.0.0.1:${port}`) // the local end of the tunnel, not the service itself
    expect(t.status()).toMatchObject({ state: 'ready', url, lastError: null })
    const body = (await (await fetch(`${url}/health`)).json()) as { service: string; path: string }
    expect(body).toEqual({ service: 'fake', path: '/health' })
    expect(await t.readyUrl()).toBe(url)
    expect(await t.ensureReady()).toBe(url) // already open: same tunnel
    t.close()
    expect(t.status()).toMatchObject({ state: 'off', url: null })
    expect(await t.readyUrl()).toBeNull()
    await new Promise((r) => setTimeout(r, 200))
    expect(await httpProbe()(url, 500)).toBe(false)
  })

  // spawns a Node child that plays ssh: slow to start on a loaded machine
  it('says why it could not connect: ssh failed, or the service does not answer', { timeout: 30_000 }, async () => {
    await expect(tunnel('unreachable', port).ensureReady()).rejects.toThrow(/Could not resolve hostname/)
    const dead = http.createServer()
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', () => r()))
    const deadPort = (dead.address() as net.AddressInfo).port
    await new Promise((r) => dead.close(r))
    const t = tunnel('cerveau', deadPort, 1000)
    await expect(t.ensureReady()).rejects.toThrow(/the production worker on H1 does not answer/)
    expect(t.status()).toMatchObject({ state: 'error', lastError: expect.stringContaining('does not answer') })
  })

  it('builds the ssh command line without a shell or option injection, and finds ssh by full path', () => {
    expect(sshArgs('cerveau', 50001, 7000)).toEqual([
      '-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
      '-o', 'BatchMode=yes', '-L', '127.0.0.1:50001:127.0.0.1:7000', 'cerveau'
    ])
    expect(() => sshArgs('-oProxyCommand=evil', 1, 2)).toThrow(/Not an SSH host alias/)
    expect(() => sshArgs('cerveau', 0, 2)).toThrow(/Bad port/)
    expect(defaultSshPath('win32', { SystemRoot: 'C:\\Windows' }, (p) => p === 'C:\\Windows\\System32\\OpenSSH\\ssh.exe')).toBe(
      'C:\\Windows\\System32\\OpenSSH\\ssh.exe'
    )
    expect(defaultSshPath('darwin', {}, (p) => p === '/usr/bin/ssh')).toBe('/usr/bin/ssh')
    expect(defaultSshPath('darwin', {}, () => false)).toBeNull()
  })
})
