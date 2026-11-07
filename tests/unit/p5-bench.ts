// The bench of lot P5's proofs: the real local Atelier Cloud (in this process, listening on a loopback port, fake
// providers) wired to a real fake RunPod whose pod runs our worker program on the proof's nodes. A team with 1 000
// credits is signed in through the device login.
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.join(__dirname, '..', '..')

export interface WalletEntryView {
  kind: string
  delta: number
  heldDelta: number
  jobId: string | null
}
export interface JobView {
  id: string
  usage: string
  state: string
  credits: number
}
export interface FakeRunpodView {
  url: string
  cancels: string[]
  jobs(): { id: string; status: string; logs: string[] }[]
  job(id: string): { status: string } | undefined
  pidOf(id: string): number | undefined
  close(): Promise<void>
}

export interface Bench {
  base: string
  person: { teamId: string; accessToken: string; refreshToken: string; email: string }
  fake: FakeRunpodView
  /** Wallet entries of the team, oldest first. */
  entries(): WalletEntryView[]
  wallet(): { balance: number; held: number; available: number }
  jobs(): JobView[]
  /** Waits until the first job of `usage` is in one of `states`. */
  waitJob(usage: string, states: string[]): Promise<JobView>
  /** Waits until the process is gone (kill(pid, 0) throws). */
  waitGone(pid: number): Promise<void>
  /** The Cloud object itself (for tests that look deeper). */
  cloud: unknown
}

interface CloudLike {
  db: { prepare(sql: string): { all(...a: unknown[]): unknown[] } }
  wallet: { entries(teamId: string, o: { limit: number }): { entries: WalletEntryView[] }; state(teamId: string): { balance: number; held: number; available: number } }
  jobs: { whenIdle(): Promise<void> }
}
interface TestCloudLike {
  app: { listen(o: { host: string; port: number }): Promise<string> }
  cloud: CloudLike
}

// The Cloud's sources import each other with .ts extensions, which the app's tsconfig does not allow: they are loaded
// through computed paths (typed here by hand) so the app's typecheck never walks into cloud/.
const HELPERS = 'helpers'
const FAKE = 'fake'

export async function loadCloudTesting() {
  const helpers = (await import(`../../cloud/tests/${HELPERS}.ts`)) as {
    makeCloud(o: Record<string, unknown>): TestCloudLike
    signUpAndIn(t: TestCloudLike, p: { credits: number }): Promise<Bench['person']>
  }
  const runpod = (await import(`../../cloud/src/runpod/${FAKE}.ts`)) as {
    startFakeRunpod(o: { workerCommand: string[]; workDir: string; apiKey: string }): Promise<FakeRunpodView>
    fakeRunpodOptions(fake: FakeRunpodView, o?: { pollMs?: number }): unknown
  }
  return {
    async bench(
      cleanups: (() => Promise<void> | void)[],
      o: { workerEntry: string; resources: string; tempDir: (label: string) => string; credits?: number }
    ): Promise<Bench> {
      const work = o.tempDir('runpod')
      const workerCommand = [
        process.execPath,
        '--experimental-transform-types',
        '--no-warnings',
        '--import',
        pathToFileURL(path.join(ROOT, 'scripts', 'ts-resolve.mjs')).href,
        o.workerEntry,
        '--data',
        path.join(work, 'pod-data'),
        '--resources',
        o.resources
      ]
      const fake = await runpod.startFakeRunpod({ workerCommand, workDir: path.join(work, 'jobs'), apiKey: `rp-${Date.now().toString(36)}-proof` })
      let base = ''
      const t = helpers.makeCloud({ publicUrl: () => base, runpod: runpod.fakeRunpodOptions(fake, { pollMs: 100 }) })
      // closed before the helpers' own cleanup closes the Cloud (pods first, so no callback lands on a closed server)
      cleanups.push(() => fake.close())
      base = await t.app.listen({ host: '127.0.0.1', port: 0 })
      const person = await helpers.signUpAndIn(t, { credits: o.credits ?? 1000 })
      const jobs = (): JobView[] =>
        t.cloud.db.prepare('SELECT id, usage, state, credits FROM jobs ORDER BY created_at, rowid').all() as JobView[]
      return {
        base,
        person,
        fake,
        cloud: t.cloud,
        entries: () => [...t.cloud.wallet.entries(person.teamId, { limit: 500 }).entries].reverse(),
        wallet: () => t.cloud.wallet.state(person.teamId),
        jobs,
        async waitJob(usage, states) {
          for (let i = 0; i < 1200; i++) {
            const j = jobs().find((x) => x.usage === usage)
            if (j && states.includes(j.state)) return j
            await new Promise((r) => setTimeout(r, 50))
          }
          throw new Error(`no ${usage} job in ${states.join('/')}: ${JSON.stringify(jobs())}`)
        },
        async waitGone(pid) {
          for (let i = 0; i < 200; i++) {
            try {
              process.kill(pid, 0)
            } catch {
              return
            }
            await new Promise((r) => setTimeout(r, 50))
          }
          throw new Error(`process ${pid} is still alive`)
        }
      }
    }
  }
}
