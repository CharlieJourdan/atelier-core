// The team computers (PLAN-COMPLEXITE §E.4): one or several machines per subscribed team, created when the team
// subscribes, hibernated when it is inactive (snapshot, then the server is deleted: a stopped Hetzner server is still
// billed), resumed from the snapshot, destroyed when the team leaves. Real machines only when paidCalls is on and
// HETZNER_API_TOKEN is in the vault; otherwise demo machines (the fake provider), marked as such.
import type { Audit } from '../audit.ts'
import type { Clock } from '../clock.ts'
import type { CloudDb } from '../db/index.ts'
import { CloudError } from '../errors.ts'
import { randomBytes } from 'node:crypto'
import { tx } from '../db/index.ts'
import { newSecret, sha256Hex } from '../ids.ts'
import type { Vault } from '../vault.ts'
import { cloudInit } from './cloud-init.ts'
import { MachineCredentials } from './credentials.ts'
import { FakeMachineProvider, HetznerProvider, MachineProviderError, type MachineProvider } from './hetzner.ts'
import { LOCATIONS, MACHINE_PLANS, SERVER_TYPES, SNAPSHOT_EUR_PER_GB_MONTH, isPlanId, type Location, type PlanId } from './plans.ts'

export const MACHINE_STATUSES = ['creating', 'running', 'hibernating', 'hibernated', 'resuming', 'deleted', 'error'] as const
export type MachineStatus = (typeof MACHINE_STATUSES)[number]

export interface TeamMachine {
  id: string
  teamId: string
  plan: PlanId
  serverType: keyof typeof SERVER_TYPES
  location: Location
  provider: 'hetzner' | 'fake'
  serverId: string | null
  snapshotId: string | null
  status: MachineStatus
  ipv4: string | null
  enrolled: boolean
  error: string | null
  createdAt: string
  updatedAt: string
}

interface Row {
  id: string
  team_id: string
  plan: string
  server_type: string
  location: string
  provider: string
  server_id: string | null
  snapshot_id: string | null
  status: string
  ipv4: string | null
  enrol_hash: string
  enrolled_at: string | null
  error: string | null
  created_at: string
  updated_at: string
}

/** A Hetzner label value: letters, digits, `-_.`, at most 63, starting and ending with a letter or digit. */
export function labelValue(v: string): string {
  return v.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 63).replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '') || 'x'
}

const toMachine = (r: Row): TeamMachine => ({
  id: r.id,
  teamId: r.team_id,
  plan: r.plan as PlanId,
  serverType: r.server_type as TeamMachine['serverType'],
  location: r.location as Location,
  provider: r.provider as TeamMachine['provider'],
  serverId: r.server_id,
  snapshotId: r.snapshot_id,
  status: r.status as MachineStatus,
  ipv4: r.ipv4,
  enrolled: r.enrolled_at !== null,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export interface MachinesOptions {
  db: CloudDb
  clock: Clock
  audit: Audit
  /** The provider for new work (real or fake). */
  provider: MachineProvider
  /** The Cloud URL the machines enrol with. */
  cloudUrl: string
  sshKeys?: readonly string[]
  /** Optional https URL of the app's code (a .tar.gz) the machine installs at /opt/atelier (see cloud-init.ts). */
  appBundleUrl?: string
  /** Polling of provider actions (tests: 0 ms). */
  pollMs?: number
  maxPolls?: number
  sleep?: (ms: number) => Promise<void>
}

export class Machines {
  private readonly sleep: (ms: number) => Promise<void>
  private readonly o: MachinesOptions
  /** The machines' own credentials (enrolment, relay). */
  readonly credentials: MachineCredentials
  constructor(o: MachinesOptions) {
    this.o = o
    this.credentials = new MachineCredentials(o.db, o.clock, o.audit)
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  get providerKind(): 'hetzner' | 'fake' {
    return this.o.provider.kind
  }

  private iso(): string {
    return new Date(this.o.clock.now()).toISOString()
  }

  list(teamId?: string): TeamMachine[] {
    const rows = (
      teamId
        ? this.o.db.prepare("SELECT * FROM team_machines WHERE team_id = ? AND status <> 'deleted' ORDER BY created_at").all(teamId)
        : this.o.db.prepare("SELECT * FROM team_machines WHERE status <> 'deleted' ORDER BY team_id, created_at").all()
    ) as unknown as Row[]
    return rows.map(toMachine)
  }

  get(id: string): TeamMachine {
    const row = this.o.db.prepare('SELECT * FROM team_machines WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new CloudError('not_found', `no machine ${id}`)
    return toMachine(row)
  }

  private set(id: string, patch: Partial<Pick<Row, 'status' | 'server_id' | 'snapshot_id' | 'ipv4' | 'error' | 'location'>>): void {
    const keys = Object.keys(patch) as (keyof typeof patch)[]
    const sets = [...keys.map((k) => `${k} = ?`), 'updated_at = ?'].join(', ')
    this.o.db.prepare(`UPDATE team_machines SET ${sets} WHERE id = ?`).run(...keys.map((k) => patch[k] ?? null), this.iso(), id)
  }

  /** The provider that holds a machine (a demo machine is always the fake's, rebuilt after a restart). */
  private providerFor(m: TeamMachine): MachineProvider {
    if (m.provider === 'fake') {
      if (this.o.provider instanceof FakeMachineProvider) {
        const fake = this.o.provider
        if (m.serverId && !fake.servers.has(m.serverId)) fake.servers.set(m.serverId, { id: m.serverId, status: m.status === 'running' ? 'running' : 'off', ipv4: m.ipv4, image: 'ubuntu-24.04', type: m.serverType })
        if (m.snapshotId) fake.images.add(m.snapshotId)
        return fake
      }
      throw new CloudError('bad_request', 'this is a demo machine; real machines are on (paidCalls + HETZNER_API_TOKEN): delete it and provision again')
    }
    if (this.o.provider.kind !== 'hetzner') throw new CloudError('bad_request', 'real machines need paidCalls on and HETZNER_API_TOKEN in the vault')
    return this.o.provider
  }

  private async waitAction(p: MachineProvider, actionId: string): Promise<void> {
    for (let i = 0; i < (this.o.maxPolls ?? 120); i++) {
      const s = await p.actionStatus(actionId)
      if (s === 'success') return
      if (s === 'error') throw new CloudError('internal', `provider action ${actionId} failed`)
      await this.sleep(this.o.pollMs ?? 2000)
    }
    throw new CloudError('internal', `provider action ${actionId} still running`)
  }

  /**
   * Creates the machines the plan includes that the team does not have yet (idempotent). The missing rows are reserved
   * in one transaction before any provider call, so two calls at once (a payment event and an admin command) never
   * create the same machine twice. A machine in error does not count: a new one replaces it.
   */
  async provision(teamId: string, plan: unknown, actor: string): Promise<TeamMachine[]> {
    if (!isPlanId(plan)) throw new CloudError('bad_request', `unknown plan: ${String(plan)}`)
    const team = this.o.db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId)
    if (!team) throw new CloudError('not_found', `no team ${teamId}`)
    if (this.o.provider.kind === 'hetzner' && (this.o.sshKeys ?? []).length === 0) {
      throw new CloudError('bad_request', 'real team computers need at least one support SSH key (config machines.sshKeys)')
    }
    const spec = MACHINE_PLANS[plan]
    const reserved = tx(this.o.db, () => {
      const have = (this.o.db.prepare("SELECT COUNT(*) AS n FROM team_machines WHERE team_id = ? AND status NOT IN ('deleted', 'error')").get(teamId) as { n: number }).n
      const out: { id: string; token: string }[] = []
      for (let n = have; n < spec.count; n++) out.push(this.reserve(teamId, plan))
      return out
    })
    for (const r of reserved) await this.createOne(r.id, r.token, teamId, plan, actor)
    return this.list(teamId)
  }

  private reserve(teamId: string, plan: PlanId): { id: string; token: string } {
    const spec = MACHINE_PLANS[plan]
    const id = `mch_${randomBytes(10).toString('hex')}`
    const token = newSecret('enr')
    const now = this.iso()
    this.o.db
      .prepare(
        `INSERT INTO team_machines (id, team_id, plan, server_type, location, provider, status, enrol_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?)`
      )
      .run(id, teamId, plan, spec.serverType, LOCATIONS[0], this.o.provider.kind, sha256Hex(token), now, now)
    return { id, token }
  }

  private async createOne(id: string, token: string, teamId: string, plan: PlanId, actor: string): Promise<void> {
    const spec = MACHINE_PLANS[plan]
    const hostname = `atelier-${id.slice(4, 16)}`
    const userData = cloudInit({
      hostname,
      cloudUrl: this.o.cloudUrl,
      enrolToken: token,
      sshKeys: this.o.sshKeys ?? [],
      ...(this.o.appBundleUrl ? { appBundleUrl: this.o.appBundleUrl } : {})
    })
    let lastErr: unknown = null
    for (const location of LOCATIONS) {
      try {
        const { server, actionId } = await this.o.provider.createServer({
          name: hostname,
          serverType: spec.serverType,
          location,
          image: 'ubuntu-24.04',
          userData,
          labels: { atelier: 'team', team: labelValue(teamId), machine: labelValue(id) }
        })
        this.set(id, { server_id: server.id, location, ipv4: server.ipv4 })
        await this.waitAction(this.o.provider, actionId)
        this.set(id, { status: 'running', error: null })
        this.o.audit.record(actor, 'machine.create', id, { teamId, plan, serverType: spec.serverType, location, provider: this.o.provider.kind })
        return
      } catch (err) {
        lastErr = err
        if (err instanceof MachineProviderError && err.outOfStock) continue
        break
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
    this.set(id, { status: 'error', error: msg.slice(0, 500) })
    throw new CloudError('internal', `machine ${id} not created: ${msg}`)
  }

  /** Snapshot, then delete the server: the team stops paying for it, its files stay in the snapshot. */
  async hibernate(id: string, actor: string): Promise<TeamMachine> {
    const m = this.get(id)
    if (m.status !== 'running' || !m.serverId) throw new CloudError('bad_request', `machine ${id} is ${m.status}`)
    const p = this.providerFor(m)
    this.set(id, { status: 'hibernating' })
    try {
      await this.waitAction(p, (await p.shutdown(m.serverId)).actionId)
      const snap = await p.createSnapshot(m.serverId, `atelier ${m.teamId} ${id}`)
      this.set(id, { snapshot_id: snap.imageId })
      await this.waitAction(p, snap.actionId)
      await this.waitAction(p, (await p.deleteServer(m.serverId)).actionId)
      this.set(id, { status: 'hibernated', server_id: null, ipv4: null, error: null })
    } catch (err) {
      this.set(id, { status: 'error', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
      throw err
    }
    this.o.audit.record(actor, 'machine.hibernate', id, { teamId: m.teamId })
    return this.get(id)
  }

  /** A new server from the snapshot; the snapshot is removed once the server runs. */
  async resume(id: string, actor: string): Promise<TeamMachine> {
    const m = this.get(id)
    if (m.status !== 'hibernated' || !m.snapshotId) throw new CloudError('bad_request', `machine ${id} is ${m.status}`)
    const p = this.providerFor(m)
    this.set(id, { status: 'resuming' })
    try {
      const { server, actionId } = await p.createServer({
        name: `atelier-${id.slice(4, 16).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`,
        serverType: m.serverType,
        location: m.location,
        image: m.snapshotId,
        userData: null,
        labels: { atelier: 'team', machine: labelValue(id) }
      })
      this.set(id, { server_id: server.id, ipv4: server.ipv4 })
      await this.waitAction(p, actionId)
      await p.deleteImage(m.snapshotId)
      this.set(id, { status: 'running', snapshot_id: null, error: null })
    } catch (err) {
      this.set(id, { status: 'error', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
      throw err
    }
    this.o.audit.record(actor, 'machine.resume', id, { teamId: m.teamId })
    return this.get(id)
  }

  /** Deletes the server and its snapshot: the machine is gone for good. */
  async destroy(id: string, actor: string): Promise<void> {
    const m = this.get(id)
    if (m.status === 'deleted') return
    const p = this.providerFor(m)
    if (m.serverId && (await p.getServer(m.serverId))) await this.waitAction(p, (await p.deleteServer(m.serverId)).actionId)
    if (m.snapshotId) await p.deleteImage(m.snapshotId)
    this.set(id, { status: 'deleted', server_id: null, snapshot_id: null, ipv4: null })
    this.credentials.revoke(id, actor)
    this.o.audit.record(actor, 'machine.delete', id, { teamId: m.teamId })
  }

  /** The machine's first call: trades its single-use enrolment token for its id (the token cannot be used twice). */
  enrol(token: string): TeamMachine {
    return tx(this.o.db, () => {
      const row = this.o.db.prepare('SELECT * FROM team_machines WHERE enrol_hash = ? AND enrolled_at IS NULL').get(sha256Hex(token)) as Row | undefined
      if (!row || row.status === 'deleted') throw new CloudError('unauthorized', 'unknown or used enrolment token')
      this.o.db.prepare('UPDATE team_machines SET enrolled_at = ?, updated_at = ? WHERE id = ?').run(this.iso(), this.iso(), row.id)
      this.o.audit.record(`machine:${row.id}`, 'machine.enrol', row.id, { teamId: row.team_id })
      return this.get(row.id)
    })
  }

  /** `POST /v1/machines/enrol`: the enrolment and the machine's new credential, in one transaction. */
  enrolWithCredential(token: string): { machine: TeamMachine; credential: string } {
    return tx(this.o.db, () => {
      const machine = this.enrol(token)
      return { machine, credential: this.credentials.issue(machine.id, machine.teamId) }
    })
  }

  /** A new single-use enrolment token for a machine that lost its credential (admin tool, printed once). */
  newEnrolToken(id: string, actor: string): string {
    const m = this.get(id)
    if (m.status === 'deleted') throw new CloudError('bad_request', `machine ${id} is deleted`)
    const token = newSecret('enr')
    this.o.db.prepare('UPDATE team_machines SET enrol_hash = ?, enrolled_at = NULL, updated_at = ? WHERE id = ?').run(sha256Hex(token), this.iso(), id)
    this.o.audit.record(actor, 'machine.enrol_token', id, { teamId: m.teamId })
    return token
  }

  /** What the machines cost per month right now (running servers + snapshots of hibernated ones), in EUR. */
  monthlyCost(teamId?: string): { running: number; hibernated: number; eur: number } {
    let eur = 0
    let running = 0
    let hibernated = 0
    for (const m of this.list(teamId)) {
      const t = SERVER_TYPES[m.serverType]
      if (m.status === 'running' || m.status === 'resuming' || m.status === 'creating' || m.status === 'hibernating') {
        running++
        eur += t.monthlyEur
      } else if (m.status === 'hibernated') {
        hibernated++
        eur += t.diskGb * SNAPSHOT_EUR_PER_GB_MONTH
      }
    }
    return { running, hibernated, eur: Math.round(eur * 100) / 100 }
  }
}

/** The provider the Cloud may use: Hetzner only with paidCalls on and the token in the vault, else the demo one. */
export function machineProvider(o: { paidCalls: boolean; vault: Vault; fetchImpl?: typeof fetch; fake?: FakeMachineProvider }): MachineProvider {
  if (o.paidCalls && o.vault.has('HETZNER_API_TOKEN')) {
    return new HetznerProvider({ token: o.vault.readForAdapter('HETZNER_API_TOKEN', 'hetzner'), ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) })
  }
  return o.fake ?? new FakeMachineProvider()
}
