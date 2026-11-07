// `npm run cloud -- billing …`: a team's plan, card and automatic top-up from the admin tool.
//
//   billing status --team TEAM_ID
//   billing auto --team TEAM_ID --on|--off [--threshold CREDITS] [--pack pack2k|pack5k|pack20k] [--cap CENTS]
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'

export function billingCli(cmd: string | undefined, flags: Map<string, string | true>, cloud: Cloud, out: (s: string) => void): void {
  const team = flags.get('team')
  if (typeof team !== 'string' || !team) throw new CloudError('bad_request', '--team is required')
  const num = (name: string): number | undefined => {
    const v = flags.get(name)
    if (v === undefined) return undefined
    const n = Number(v)
    if (!Number.isSafeInteger(n)) throw new CloudError('bad_request', `--${name} is a whole number`)
    return n
  }
  if (cmd === 'auto') {
    if (flags.has('on') === flags.has('off')) throw new CloudError('bad_request', 'give --on or --off')
    const pack = flags.get('pack')
    const threshold = num('threshold')
    const cap = num('cap')
    cloud.billing.setAutoRecharge(team, {
      enabled: flags.has('on'),
      ...(threshold !== undefined ? { thresholdCredits: threshold } : {}),
      ...(typeof pack === 'string' ? { pack } : {}),
      ...(cap !== undefined ? { monthlyCapCents: cap } : {})
    })
  } else if (cmd !== 'status') throw new CloudError('bad_request', 'usage: billing status | auto')
  const s = cloud.billing.status(team)
  out(`payments: ${s.provider === 'stripe' ? 'Stripe' : 'simulated'}`)
  out(s.subscription ? `plan: ${s.subscription.plan} (${s.subscription.period}), ${s.subscription.status} since ${s.subscription.since}` : 'plan: none')
  out(`card on file: ${s.cardOnFile ? 'yes' : 'no'}`)
  const a = s.autoRecharge
  out(`auto top-up: ${a.enabled ? 'on' : 'off'}, under ${a.thresholdCredits} credits buy ${a.pack}, cap ${(a.monthlyCapCents / 100).toFixed(2)} €/month (${(a.spentThisMonthCents / 100).toFixed(2)} € used)`)
}
