// `npm run cloud -- admin test-team …` (record 0066): the test teams our headless brains run real tests on.
//   admin test-team create --name N --credits C --key-file PATH   a test team, its member without a password, C test credits,
//                                                                  and a brain key written to PATH (0600, never printed)
//   admin test-team key --team TEAM_ID --key-file PATH            another key for that team
//   admin test-team list                                          the test teams, their balance and keys (never a key's value)
//   admin test-team revoke --team TEAM_ID                         every key and every device of the team stop working at once
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Cloud } from './cloud.ts'
import { CloudError } from './errors.ts'

const flag = (flags: Map<string, string | true>, name: string): string => {
  const v = flags.get(name)
  if (typeof v !== 'string' || !v) throw new CloudError('bad_request', `--${name} is required`)
  return v
}

/** Writes the key alone in a new file readable by its owner only; an existing file is never overwritten. */
export function writeKeyFile(path: string, key: string): string {
  const file = resolve(path)
  if (existsSync(file)) throw new CloudError('conflict', `${file} already exists: give a new path (or delete it first)`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${key}\n`, { mode: 0o600, flag: 'wx' })
  return file
}

export function testTeamCli(sub: string | undefined, flags: Map<string, string | true>, cloud: Cloud, actor: string, out: (s: string) => void): void {
  if (sub === 'create') {
    const keyFile = flag(flags, 'key-file')
    if (existsSync(resolve(keyFile))) throw new CloudError('conflict', `${resolve(keyFile)} already exists: give a new path (or delete it first)`)
    const credits = Number(flag(flags, 'credits'))
    const made = cloud.testTeams.create({ name: flag(flags, 'name'), credits, actor })
    const file = writeKeyFile(keyFile, made.key)
    out(`test team ${made.team.id} "${made.team.name}" (internal, test credits: balance ${made.balance})`)
    out(`member ${made.email} (no password: never signs in from a browser)`)
    out(`brain key ${made.keyId} written to ${file} (valid until ${made.expiresAt.slice(0, 10)}; start a brain with --token-file ${file})`)
  } else if (sub === 'key') {
    const keyFile = flag(flags, 'key-file')
    if (existsSync(resolve(keyFile))) throw new CloudError('conflict', `${resolve(keyFile)} already exists: give a new path (or delete it first)`)
    const k = cloud.testTeams.newKey(flag(flags, 'team'), actor)
    out(`brain key ${k.keyId} written to ${writeKeyFile(keyFile, k.key)} (valid until ${k.expiresAt.slice(0, 10)})`)
  } else if (sub === 'list') {
    const rows = cloud.testTeams.list()
    if (rows.length === 0) out('(no test team)')
    for (const r of rows) {
      out(`${r.team.id}\t${r.team.name}\t${r.email ?? '—'}\tbalance ${r.balance}`)
      for (const k of r.keys) out(`  key ${k.id}\tcreated ${k.createdAt}\texpires ${k.expiresAt}\tlast used ${k.lastUsedAt ?? 'never'}${k.revokedAt ? `\tREVOKED ${k.revokedAt}` : ''}`)
    }
  } else if (sub === 'revoke') {
    const r = cloud.testTeams.revoke(flag(flags, 'team'), actor)
    out(`revoked ${r.keys} key(s) and ${r.devices} device(s): the team's brains are signed out`)
  } else {
    throw new CloudError('bad_request', 'usage: admin test-team create|key|list|revoke (see cloud/src/test-teams-cli.ts)')
  }
}
