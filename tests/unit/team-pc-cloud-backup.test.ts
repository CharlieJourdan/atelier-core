// The team computer's nightly backup goes to Atelier Cloud with the machine's own credential, and a NEW computer of the
// same team (the move to another machine, or a dead disk) restores « latest » into an empty folder: `--restore latest`
// enrols it with its enrolment file, downloads the archive, checks it and writes it. A test Cloud on a random port, the
// real headless brain, the fake team; no network beyond the loopback.
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MachineStats } from '../../src/shared/api/app'
import { backupCommand } from '../../src/main/headless/backup-cli'
import { parseHeadlessArgs } from '../../src/main/headless/config'
import { REPO, startTestBrain, tempDir } from './headless-helpers'

// The Cloud's sources use .ts imports: loaded through a computed path, as in relay-brain.test.ts.
interface CloudT {
  app: { listen(o: { host: string; port: number }): Promise<string> }
  cloud: {
    machines(): { provision(teamId: string, plan: string, actor: string): Promise<{ id: string }[]>; newEnrolToken(id: string, actor: string): string }
    backups: { list(teamId: string): { id: string; machineId: string; size: number }[] }
  }
}
const HELPERS = 'helpers'
const cloudTesting = (await import(`../../cloud/tests/${HELPERS}.ts`)) as {
  makeCloud(o?: Record<string, unknown>): CloudT
  signUpAndIn(t: CloudT): Promise<{ teamId: string; accessToken: string }>
}

async function until(check: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('team computer backups through Atelier Cloud', () => {
  it('the enrolled brain sends its backup; a new machine of the team restores « latest » with the same team', async () => {
    const t = cloudTesting.makeCloud()
    const base = await t.app.listen({ host: '127.0.0.1', port: 0 })
    const owner = await cloudTesting.signUpAndIn(t)
    const [m1] = await t.cloud.machines().provision(owner.teamId, 'starter', 'test')
    const enrolDir = tempDir('atb-enrol-')
    const enrolFile = path.join(enrolDir, 'enrol')
    writeFileSync(enrolFile, `ATELIER_CLOUD_URL=${base}\nATELIER_ENROL_TOKEN=${t.cloud.machines().newEnrolToken(m1!.id, 'test')}\n`)
    const brain = await startTestBrain({ enrolFile, cloudEnrol: true, cloudLink: { retryMs: () => 50, relay: { waitS: 1 } }, backup: { at: { hour: 3, minute: 30 } } })
    try {
      await brain.cloud?.ready
      await until(() => brain.cloud?.state().online === true)
      brain.core.orchestra.seed()
      await brain.core.api['channels.create']({ name: 'Histoire', niche: 'histoire', standards: '' })
      const state = await brain.backups!.runNow()
      expect(state).toMatchObject({ ok: true, cloud: 'sent', error: null })
      // the Mac app reads « Ordinateur d'équipe » through the relay: app.machine carries the brain's health there too
      const relayed = await fetch(`${base}/v1/team/brain/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.accessToken}` },
        body: JSON.stringify({ method: 'app.machine', args: [] })
      })
      const machine = (await relayed.json()) as { ok: boolean; value: MachineStats }
      expect(machine.ok).toBe(true)
      expect(machine.value.brain?.backup).toMatchObject({ ok: true, cloud: 'sent' })
      const onCloud = t.cloud.backups.list(owner.teamId)
      expect(onCloud).toEqual([expect.objectContaining({ id: state.cloudId, machineId: m1!.id, size: state.sizeBytes })])

      // a new computer of the team: its own enrolment, the same machine key (copied with the secrets), an empty folder
      const [m2] = await t.cloud.machines().provision(owner.teamId, 'starter', 'test')
      const newDir = tempDir('atb-new-')
      const newEnrol = path.join(newDir, 'enrol')
      writeFileSync(newEnrol, `ATELIER_CLOUD_URL=${base}\nATELIER_ENROL_TOKEN=${t.cloud.machines().newEnrolToken(m2!.id, 'test')}\n`)
      const target = path.join(newDir, 'data')
      const lines: string[] = []
      const args = parseHeadlessArgs(['--data', target, '--key-file', path.join(brain.dir, 'key', 'machine.key'), '--enrol-file', newEnrol, '--restore', 'latest'], {})
      expect(await backupCommand(args, { repoRoot: REPO, out: (l) => lines.push(l) })).toBe(0)
      expect(lines.join('\n')).toContain(`Atelier Cloud ${state.cloudId ?? ''}`)
      expect(lines.join('\n')).toMatch(/1 chaînes/)
      // enrolled as the new machine (its own credential), the token file used up
      expect(existsSync(path.join(target, 'cloud-machine.json'))).toBe(true)
      expect(existsSync(newEnrol)).toBe(false)
      const restored = await startTestBrain({ dataDir: target, keyFile: path.join(brain.dir, 'key', 'machine.key') })
      try {
        expect(restored.core.orchestra.agents().map((a) => a.slug).sort()).toEqual(brain.core.orchestra.agents().map((a) => a.slug).sort())
      } finally {
        await restored.close()
      }
      // the list command reads both places; another key cannot restore
      const listed: string[] = []
      expect(await backupCommand(parseHeadlessArgs(['--data', target, '--key-file', path.join(brain.dir, 'key', 'machine.key'), '--list-backups'], {}), { repoRoot: REPO, out: (l) => listed.push(l) })).toBe(0)
      expect(listed.join('\n')).toContain(state.cloudId ?? 'missing')
      const wrong: string[] = []
      const other = path.join(tempDir('atb-other-'), 'data')
      expect(await backupCommand(parseHeadlessArgs(['--data', other, '--key-file', path.join(tempDir('atb-k-'), 'nope.key'), '--restore', state.localFile ?? ''], {}), { repoRoot: REPO, out: (l) => wrong.push(l) })).toBe(1)
      expect(wrong.join('\n')).toMatch(/Clé de la machine introuvable/)
    } finally {
      await brain.stop()
    }
  })
})
