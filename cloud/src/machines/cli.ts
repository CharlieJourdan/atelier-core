// `npm run cloud -- machines …`: the team computers from the admin tool.
//
//   machines plans                              what each plan includes and costs per month
//   machines list [--team TEAM_ID]              machines, their state and the monthly cost
//   machines provision --team TEAM_ID --plan P  create the machines the plan includes (idempotent)
//   machines hibernate ID | resume ID | delete ID
//   machines revoke ID                          the machine's credential stops working (relay cut at once)
//   machines enrol-token ID                     a new single-use enrolment token, printed ONCE (put it in the
//                                               machine's /etc/atelier/enrol, then restart atelier-brain)
//   machines calls [--team TEAM_ID] [--limit N] the relay's audit: who called which method (never the arguments)
//
// Real Hetzner machines only with paidCalls on and HETZNER_API_TOKEN in the vault; otherwise demo machines.
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { MACHINE_PLANS, PLAN_IDS, SERVER_TYPES, planMonthlyEur } from './plans.ts'
import { Machines, machineProvider } from './service.ts'

/** The Cloud's own machines service, or one enrolling at `cloudUrl` when the admin tool runs beside the server. */
export function machinesFor(cloud: Cloud, cloudUrl: string, sshKeys: readonly string[] = []): Machines {
  return new Machines({ db: cloud.db, clock: cloud.clock, audit: cloud.audit, provider: machineProvider({ paidCalls: cloud.registry.paidCalls, vault: cloud.vault }), cloudUrl, sshKeys })
}

export async function machinesCli(
  cmd: string | undefined,
  positional: string[],
  flags: Map<string, string | true>,
  cloud: Cloud,
  cloudUrl: string,
  actor: string,
  out: (s: string) => void,
  sshKeys: readonly string[] = []
): Promise<void> {
  const flag = (name: string): string => {
    const v = flags.get(name)
    if (typeof v !== 'string' || !v) throw new CloudError('bad_request', `--${name} is required`)
    return v
  }
  if (cmd === 'plans') {
    for (const id of PLAN_IDS) {
      const p = MACHINE_PLANS[id]
      const t = SERVER_TYPES[p.serverType]
      out(`${id}\t${p.count} × ${t.id} (${t.vcpu} vCPU, ${t.ramGb} GB, ${t.diskGb} GB)\t${planMonthlyEur(id).toFixed(2)} €/month`)
    }
    return
  }
  const machines = machinesFor(cloud, cloudUrl, sshKeys)
  if (cmd === 'list') {
    const team = typeof flags.get('team') === 'string' ? (flags.get('team') as string) : undefined
    out(`provider: ${machines.providerKind === 'hetzner' ? 'Hetzner (real)' : 'demo (paidCalls off or no HETZNER_API_TOKEN)'}`)
    const rows = machines.list(team)
    if (rows.length === 0) out('(no machine)')
    for (const m of rows) out(`${m.id}\t${m.teamId}\t${m.plan}\t${m.serverType}\t${m.location}\t${m.status}${m.ipv4 ? `\t${m.ipv4}` : ''}${m.provider === 'fake' ? '\t(demo)' : ''}${m.error ? `\t${m.error}` : ''}`)
    const cost = machines.monthlyCost(team)
    out(`running ${cost.running}, hibernated ${cost.hibernated}: ${cost.eur.toFixed(2)} €/month`)
  } else if (cmd === 'provision') {
    const list = await machines.provision(flag('team'), flag('plan'), actor)
    for (const m of list) out(`${m.id}\t${m.status}\t${m.serverType}\t${m.location}${m.provider === 'fake' ? '\t(demo)' : ''}`)
  } else if (cmd === 'hibernate' || cmd === 'resume' || cmd === 'delete') {
    const id = positional[0]
    if (!id) throw new CloudError('bad_request', `usage: machines ${cmd} MACHINE_ID`)
    if (cmd === 'delete') {
      await machines.destroy(id, actor)
      out(`${id} deleted`)
    } else {
      const m = cmd === 'hibernate' ? await machines.hibernate(id, actor) : await machines.resume(id, actor)
      out(`${m.id}\t${m.status}`)
    }
  } else if (cmd === 'revoke' || cmd === 'enrol-token') {
    const id = positional[0]
    if (!id) throw new CloudError('bad_request', `usage: machines ${cmd} MACHINE_ID`)
    if (cmd === 'revoke') {
      out(`${id}: ${machines.credentials.revoke(machines.get(id).id, actor)} credential(s) revoked`)
    } else {
      const token = machines.newEnrolToken(id, actor)
      out(`ATELIER_ENROL_TOKEN=${token}`)
      out('(shown once: write it with ATELIER_CLOUD_URL into /etc/atelier/enrol on the machine, mode 600, owner atelier)')
    }
  } else if (cmd === 'calls') {
    const team = typeof flags.get('team') === 'string' ? (flags.get('team') as string) : undefined
    const limit = typeof flags.get('limit') === 'string' ? Number(flags.get('limit')) : 50
    const rows = cloud.relayAudit.list({ ...(team ? { teamId: team } : {}), limit })
    if (rows.length === 0) out('(no relayed call)')
    for (const c of rows) out(`${c.at}\t${c.teamId}\t${c.accountId}\t${c.machineId ?? '-'}\t${c.method}\t${c.outcome}\t${c.ms} ms`)
  } else {
    throw new CloudError('bad_request', 'usage: machines plans | list | provision | hibernate | resume | delete | revoke | enrol-token | calls')
  }
}
