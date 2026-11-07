// The team computers: provisioning per plan (idempotent, location fallback when a type is out of stock), hibernation
// (snapshot then delete) and resume, single-use enrolment, the monthly cost, the cloud-init that never carries our
// secrets, the Hetzner client against a fake API (auth header, 429 retry, errors without the token), and the guard
// that keeps real machines off unless paidCalls is on and the token is in the vault.
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.ts'
import { BRAIN_PATHS, cloudInit } from '../src/machines/cloud-init.ts'
import { FakeMachineProvider, HetznerProvider, MachineProviderError } from '../src/machines/hetzner.ts'
import { MACHINE_PLANS, planMonthlyEur } from '../src/machines/plans.ts'
import { Machines, machineProvider } from '../src/machines/service.ts'
import { fakeFetch, json } from './fake-fetch.ts'
import { makeCloud } from './helpers.ts'

function setup(provider = new FakeMachineProvider()) {
  const { cloud } = makeCloud()
  const team = cloud.accounts.createAccount({ email: `m${Math.random()}@example.com`, name: 'M', password: 'correct horse battery', actor: 'test' }).team.id
  const machines = new Machines({ db: cloud.db, clock: cloud.clock, audit: cloud.audit, provider, cloudUrl: 'https://cloud.atelier.test', pollMs: 0 })
  return { cloud, team, machines, provider }
}

describe('team computers', () => {
  it('a plan gets its machines once; agency gets two; the cost follows the running ones', async () => {
    const { team, machines } = setup()
    const first = await machines.provision(team, 'studio', 'test')
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ plan: 'studio', serverType: 'cx53', status: 'running', provider: 'fake', location: 'fsn1' })
    expect(await machines.provision(team, 'studio', 'test')).toHaveLength(1)
    expect(machines.monthlyCost(team)).toEqual({ running: 1, hibernated: 0, eur: 29.99 })
    expect(MACHINE_PLANS.agency.count).toBe(2)
    expect(await machines.provision(team, 'agency', 'test')).toHaveLength(2)
    expect(planMonthlyEur('network')).toBe(119.96)
    await expect(machines.provision(team, 'galaxy', 'test')).rejects.toThrow(/unknown plan/)
    await expect(machines.provision('team_nope', 'starter', 'test')).rejects.toThrow(/no team/)
  })

  it('falls back to the next location when a type is out of stock', async () => {
    const provider = new FakeMachineProvider()
    provider.outOfStock.add('fsn1')
    const { team, machines } = setup(provider)
    const [m] = await machines.provision(team, 'starter', 'test')
    expect(m).toMatchObject({ location: 'nbg1', status: 'running' })
  })

  it('hibernation keeps a snapshot and deletes the server; resume rebuilds it and drops the snapshot', async () => {
    const { team, machines, provider, cloud } = setup()
    const [m] = await machines.provision(team, 'creator', 'test')
    const slept = await machines.hibernate(m!.id, 'test')
    expect(slept).toMatchObject({ status: 'hibernated', serverId: null })
    expect(provider.servers.size).toBe(0)
    expect(provider.images.size).toBe(1)
    expect(machines.monthlyCost(team)).toEqual({ running: 0, hibernated: 1, eur: 1.76 })
    await expect(machines.hibernate(m!.id, 'test')).rejects.toThrow(/hibernated/)
    const back = await machines.resume(m!.id, 'test')
    expect(back).toMatchObject({ status: 'running', snapshotId: null })
    expect(provider.servers.size).toBe(1)
    expect(provider.images.size).toBe(0)
    await machines.destroy(m!.id, 'test')
    expect(machines.list(team)).toHaveLength(0)
    expect(provider.servers.size).toBe(0)
    const actions = cloud.audit.list().map((e: { action: string }) => e.action)
    for (const a of ['machine.create', 'machine.hibernate', 'machine.resume', 'machine.delete']) expect(actions).toContain(a)
  })

  it('the enrolment token works once and is never stored in clear', async () => {
    const provider = new FakeMachineProvider()
    let userData = ''
    const create = provider.createServer.bind(provider)
    provider.createServer = async (i) => {
      userData = i.userData ?? ''
      return create(i)
    }
    const { team, machines, cloud } = setup(provider)
    await machines.provision(team, 'starter', 'test')
    const token = /ATELIER_ENROL_TOKEN=(\S+)/.exec(userData)![1]!
    const stored = JSON.stringify(cloud.db.prepare('SELECT * FROM team_machines').all())
    expect(stored).not.toContain(token)
    expect(machines.enrol(token)).toMatchObject({ enrolled: true })
    expect(() => machines.enrol(token)).toThrow(/unknown or used/)
  })
})

describe('cloud-init', () => {
  it('installs the tools, never carries a key, and refuses inputs that could break out of the YAML', () => {
    const yaml = cloudInit({ hostname: 'atelier-team-ab12', cloudUrl: 'https://cloud.atelier.test', enrolToken: 'enr_abcdefghijklmnop', sshKeys: ['ssh-ed25519 AAAAC3Nza support'] })
    for (const want of ['@anthropic-ai/claude-code', '@openai/codex', 'ffmpeg', 'chromium-browser', 'ufw', 'x11vnc -display :1 -localhost', 'ssh_pwauth: false']) expect(yaml).toContain(want)
    expect(yaml).not.toMatch(/API_KEY|sk-|password:/i)
    expect(() => cloudInit({ hostname: 'x\nruncmd', cloudUrl: 'https://a.b', enrolToken: 'enr_abcdefghijklmnop', sshKeys: [] })).toThrow(/hostname/)
    expect(() => cloudInit({ hostname: 'atelier-a', cloudUrl: 'https://a.b/$(id)', enrolToken: 'enr_abcdefghijklmnop', sshKeys: [] })).toThrow(/URL/)
    expect(() => cloudInit({ hostname: 'atelier-a', cloudUrl: 'https://a.b', enrolToken: 'short', sshKeys: [] })).toThrow(/token/)
    expect(() => cloudInit({ hostname: 'atelier-a', cloudUrl: 'https://a.b', enrolToken: 'enr_abcdefghijklmnop', sshKeys: ["ssh-ed25519 AAAA'; rm -rf /"] })).toThrow(/SSH/)
  })

  it('separates support (SSH keys, sudo, the only SSH login) from atelier (the brain: no sudo, no key), and sandboxes the units', () => {
    const yaml = cloudInit({ hostname: 'atelier-team-ab12', cloudUrl: 'https://cloud.atelier.test', enrolToken: 'enr_abcdefghijklmnop', sshKeys: ['ssh-ed25519 AAAAC3Nza support'] })
    const users = yaml.slice(yaml.indexOf('users:'), yaml.indexOf('ssh_pwauth:'))
    const support = users.slice(users.indexOf('- name: support'), users.indexOf('- name: atelier'))
    const atelier = users.slice(users.indexOf('- name: atelier'))
    expect(support).toContain('sudo: ALL=(ALL) NOPASSWD:ALL')
    expect(support).toContain('ssh-ed25519 AAAAC3Nza support')
    expect(atelier).not.toMatch(/sudo|ssh_authorized_keys|AAAAC3Nza/)
    expect(yaml).toContain('AllowUsers support')
    // the brain's unit: other homes read-only, its own home (data and key folders inside) writable, ~/.ssh not
    const brain = yaml.slice(yaml.indexOf('path: /etc/systemd/system/atelier-brain.service'), yaml.indexOf('runcmd:'))
    for (const want of ['User=atelier', 'NoNewPrivileges=true', 'ProtectHome=read-only', 'ReadWritePaths=/etc/atelier /home/atelier', 'ReadOnlyPaths=/home/atelier/.ssh', 'InaccessiblePaths=-/etc/atelier-screen']) expect(brain).toContain(want)
    for (const dir of [BRAIN_PATHS.data, BRAIN_PATHS.key]) expect(dir.startsWith(`${BRAIN_PATHS.home}/`)).toBe(true)
    expect(brain).toContain(`Environment=ATELIER_DATA_DIR=${BRAIN_PATHS.data}`)
    // the screen: no VNC without a password; the password file is root's, handed by systemd to the screen alone
    const screen = yaml.slice(yaml.indexOf('path: /etc/systemd/system/atelier-screen.service'), yaml.indexOf('path: /etc/systemd/system/atelier-brain.service'))
    expect(screen).not.toContain('-nopw')
    expect(screen).toContain(`LoadCredential=vnc.pass:${BRAIN_PATHS.vncPass}`)
    expect(screen).toContain('-rfbauth "${CREDENTIALS_DIRECTORY}/vnc.pass"')
    expect(yaml).toContain(`x11vnc -storepasswd "$pw" ${BRAIN_PATHS.vncPass}`)
    expect(yaml).toContain(`[chmod, '0600', ${BRAIN_PATHS.vncPass}]`)
    // the password is made on the machine: never in the user data
    expect(yaml).not.toMatch(/password:|API_KEY|sk-/i)
  })
})

describe('the Hetzner client', () => {
  it('sends the bearer token, retries after a 429, and its errors never contain the token', async () => {
    const token = 'hz-test-token-not-real'
    const f = fakeFetch((req, n) => {
      if (n === 1) return new Response('{}', { status: 429, headers: { 'ratelimit-reset': '0' } })
      if (req.url.endsWith('/servers') && req.method === 'POST') return json({ server: { id: 42, status: 'initializing', public_net: { ipv4: { ip: '203.0.113.7' } } }, action: { id: 9 } })
      if (req.url.endsWith('/actions/9')) return json({ action: { status: 'success' } })
      if (req.url.endsWith('/servers/404')) return json({ error: { code: 'not_found', message: 'server not found' } }, 404)
      return json({ error: { code: 'resource_unavailable', message: 'cx53 not available' } }, 412)
    })
    const hz = new HetznerProvider({ token, fetchImpl: f.fetch, sleep: async () => undefined })
    const made = await hz.createServer({ name: 'atelier-a', serverType: 'cx53', location: 'fsn1', image: 'ubuntu-24.04', userData: '#cloud-config', labels: { atelier: 'team' } })
    expect(made).toEqual({ server: { id: '42', status: 'initializing', ipv4: '203.0.113.7' }, actionId: '9' })
    expect(f.calls).toHaveLength(2)
    expect(f.calls[1]!.headers.authorization).toBe(`Bearer ${token}`)
    expect(JSON.parse(f.calls[1]!.body)).toMatchObject({ server_type: 'cx53', location: 'fsn1', image: 'ubuntu-24.04', start_after_create: true })
    expect(await hz.actionStatus('9')).toBe('success')
    expect(await hz.getServer('404')).toBeNull()
    const err = await hz.shutdown('7').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MachineProviderError)
    expect((err as MachineProviderError).outOfStock).toBe(true)
    expect(String((err as Error).message)).not.toContain(token)
  })

  it('real machines stay off unless paidCalls is on and the token is in the vault', () => {
    const { cloud } = makeCloud()
    expect(machineProvider({ paidCalls: true, vault: cloud.vault }).kind).toBe('fake')
    cloud.vault.set('HETZNER_API_TOKEN', 'hz-test-token-not-real', 'test')
    expect(machineProvider({ paidCalls: false, vault: cloud.vault }).kind).toBe('fake')
    expect(machineProvider({ paidCalls: true, vault: cloud.vault }).kind).toBe('hetzner')
  })
})

describe('machines from the admin tool', () => {
  it('plans, provision, list, hibernate and resume across separate commands (demo machines)', async () => {
    const { cloud } = makeCloud()
    const team = cloud.accounts.createAccount({ email: 'cli@example.com', name: 'C', password: 'correct horse battery', actor: 'test' }).team.id
    const run = async (args: string[]): Promise<{ code: number; text: string }> => {
      const out: string[] = []
      const sink = new PassThrough()
      sink.on('data', (d) => out.push(String(d)))
      const code = await runCli(args, { stdin: Object.assign(new PassThrough(), { isTTY: false }), stdout: sink, stderr: sink, env: {}, cloud })
      return { code, text: out.join('') }
    }
    expect((await run(['machines', 'plans'])).text).toContain('studio\t1 × cx53')
    const made = await run(['machines', 'provision', '--team', team, '--plan', 'starter'])
    expect(made.code).toBe(0)
    const id = /^(mch_\S+)/m.exec(made.text)![1]!
    expect((await run(['machines', 'list'])).text).toMatch(/demo/)
    expect((await run(['machines', 'hibernate', id])).text).toContain('hibernated')
    expect((await run(['machines', 'resume', id])).text).toContain('running')
    expect((await run(['machines', 'list', '--team', team])).text).toContain('8.99 €/month')
    expect((await run(['machines', 'teleport'])).code).toBe(1)
  })
})

describe('team computer provisioning (review fixes)', () => {
  it('two provisions at once create the plan’s machines once; a machine in error is replaced; label values are Hetzner-safe; real machines need a support key', async () => {
    const { labelValue } = await import('../src/machines/service.ts')
    const { cloud, team, machines } = setup()
    await Promise.all([machines.provision(team, 'agency', 'test'), machines.provision(team, 'agency', 'test')])
    expect(machines.list(team)).toHaveLength(2)
    cloud.db.prepare("UPDATE team_machines SET status = 'error' WHERE id = ?").run(machines.list(team)[0]!.id)
    await machines.provision(team, 'agency', 'test')
    expect(machines.list(team).filter((m) => m.status === 'running')).toHaveLength(2)
    expect(labelValue('team_ab-')).toBe('team_ab')
    expect(labelValue('-_x_')).toBe('x')
    const real = new Machines({ db: cloud.db, clock: cloud.clock, audit: cloud.audit, provider: new HetznerProvider({ token: 't', fetchImpl: (async () => { throw new Error('no network') }) as unknown as typeof fetch }), cloudUrl: 'https://c.test', pollMs: 0 })
    await expect(real.provision(team, 'starter', 'test')).rejects.toThrow(/SSH key/)
  })
})
