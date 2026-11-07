// A team computer's own credential (docs/BRAIN-HEADLESS.md §7): issued once, when the machine trades its single-use
// enrolment token (POST /v1/machines/enrol), shown only to the machine, stored as its SHA-256 hash. One live credential
// per machine: a new enrolment revokes the previous one, and so do a revocation by an admin and the machine's deletion.
// A 256-bit random value needs no slow hash; it is looked up by its hash.
import type { Audit } from '../audit.ts'
import { iso, type Clock } from '../clock.ts'
import type { CloudDb } from '../db/index.ts'
import { CloudError } from '../errors.ts'
import { newId, newSecret, sha256Hex } from '../ids.ts'

export const MACHINE_CREDENTIAL_PREFIX = 'amc'

export interface MachineIdentity {
  machineId: string
  teamId: string
  credentialId: string
}

interface Row {
  id: string
  machine_id: string
  team_id: string
  last_seen_at: string | null
  revoked_at: string | null
  status: string
}

export class MachineCredentials {
  private readonly db: CloudDb
  private readonly clock: Clock
  private readonly audit: Audit
  constructor(db: CloudDb, clock: Clock, audit: Audit) {
    this.db = db
    this.clock = clock
    this.audit = audit
  }

  /** A new credential for the machine (the previous ones stop working). Returns the plain value, once. */
  issue(machineId: string, teamId: string): string {
    const now = iso(this.clock.now())
    this.db.prepare('UPDATE machine_credentials SET revoked_at = ? WHERE machine_id = ? AND revoked_at IS NULL').run(now, machineId)
    const credential = newSecret(MACHINE_CREDENTIAL_PREFIX)
    this.db
      .prepare('INSERT INTO machine_credentials (id, machine_id, team_id, hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(newId('mcr'), machineId, teamId, sha256Hex(credential), now)
    return credential
  }

  /** The machine behind a credential; unknown, revoked or of a deleted machine → the same 401. */
  verify(credential: string | null): MachineIdentity {
    if (!credential || !credential.startsWith(`${MACHINE_CREDENTIAL_PREFIX}_`)) throw new CloudError('unauthorized', 'a machine credential is required')
    const row = this.db
      .prepare(
        `SELECT c.id, c.machine_id, c.team_id, c.last_seen_at, c.revoked_at, m.status
         FROM machine_credentials c JOIN team_machines m ON m.id = c.machine_id WHERE c.hash = ?`
      )
      .get(sha256Hex(credential)) as Row | undefined
    if (!row || row.revoked_at || row.status === 'deleted') throw new CloudError('unauthorized', 'unknown or revoked machine credential')
    const now = this.clock.now()
    if (!row.last_seen_at || now - Date.parse(row.last_seen_at) > 60_000) {
      this.db.prepare('UPDATE machine_credentials SET last_seen_at = ? WHERE id = ?').run(iso(now), row.id)
    }
    return { machineId: row.machine_id, teamId: row.team_id, credentialId: row.id }
  }

  /** Revokes every live credential of a machine; returns how many. */
  revoke(machineId: string, actor: string): number {
    const n = Number(
      this.db.prepare('UPDATE machine_credentials SET revoked_at = ? WHERE machine_id = ? AND revoked_at IS NULL').run(iso(this.clock.now()), machineId).changes
    )
    if (n > 0) this.audit.record(actor, 'machine.credential_revoke', machineId, { revoked: n })
    return n
  }

  /** True when the machine holds a live credential. */
  has(machineId: string): boolean {
    return this.db.prepare('SELECT 1 FROM machine_credentials WHERE machine_id = ? AND revoked_at IS NULL').get(machineId) !== undefined
  }
}
