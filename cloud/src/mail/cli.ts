// `npm run cloud -- mail …`: the messages the fake mailer kept (the dev Cloud sends nothing for real; the verification and
// reset links are read here). With the real mailer (Resend) nothing is kept: the provider's dashboard shows the sends.
//
//   mail list [--to ADDRESS] [--limit N]
//   mail show ID                              the text of one message, links included
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'

export function mailCli(cmd: string | undefined, positional: string[], flags: Map<string, string | true>, cloud: Cloud, out: (s: string) => void): void {
  const box = cloud.outbox
  if (!box) {
    out('mail: the real mailer (Resend) is on, nothing is kept here; see the Resend dashboard')
    return
  }
  if (cmd === 'list') {
    const to = flags.get('to')
    const limit = flags.get('limit')
    const rows = box.list({ ...(typeof to === 'string' ? { to } : {}), ...(typeof limit === 'string' ? { limit: Number(limit) } : {}) })
    if (rows.length === 0) out('(no message)')
    for (const m of rows) out(`${m.id}\t${m.createdAt}\t${m.to}\t${m.subject}`)
  } else if (cmd === 'show') {
    const m = box.get(positional[0] ?? '')
    if (!m) throw new CloudError('not_found', 'no such message')
    out(`to: ${m.to}\nsubject: ${m.subject}\nat: ${m.createdAt}\n\n${m.text}`)
  } else {
    throw new CloudError('bad_request', 'usage: mail list [--to ADDRESS] [--limit N] | mail show ID')
  }
}
