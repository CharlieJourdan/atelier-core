// solidite: a Cloud job the app gives up on is cancelled there (released, never captured later while a fallback
// engine is paid for the same item); a job a Cloud restart cut short is retried as a new job, not a provider's verdict;
// the deadline counts from the job's last change of state. Real local Cloud, fake RunPod, nothing paid.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EngineError } from '../../src/engine'
import { cloudJobRunner } from '../../src/engine/cloud-http'
import { loadCloudTesting } from './p5-bench'

const ROOT = path.join(__dirname, '..', '..')
const ENTRY = path.join(__dirname, 'fixtures', 'p5-worker-main.ts')
const RESOURCES = path.join(ROOT, 'resources')

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})
function tempDir(label: string): string {
  const d = mkdtempSync(path.join(tmpdir(), `cloud-stalls-${label}-`))
  cleanups.push(() => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return d
}
const gpu = (mode: 'ok' | 'slow') => ({
  worker: 'render',
  estimatedGpuSeconds: 60,
  payload: { nodeType: 'p5.render@1', params: { mode }, inputs: { script: { type: 'text.script', fingerprint: 'f'.repeat(64), value: 'x' } }, seed: 0, attempt: 1, notes: [], settings: { minutes: 1, budgetMode: 'usage_max' }, fake: false }
})

describe('Cloud jobs that stall', () => {
  it('a job past its deadline is cancelled on the Cloud and its hold released: nothing is paid for it later', { timeout: 120_000 }, async () => {
    const bench = await (await loadCloudTesting()).bench(cleanups, { workerEntry: ENTRY, resources: RESOURCES, tempDir })
    const runner = cloudJobRunner({ baseUrl: bench.base, token: () => bench.person.accessToken, pollMs: 40, jobTimeoutMs: 1_500, stateDir: tempDir('keys') })
    const err = await runner.runJob('submitGpuJob', gpu('slow'), { idempotencyKey: 'stalled-job', signal: new AbortController().signal, dir: tempDir('dl') }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect(err).toMatchObject({ code: 'transient', message: expect.stringMatching(/pas fini la tâche à temps/) })
    await bench.waitJob('submitGpuJob', ['cancelled'])
    expect(bench.wallet()).toMatchObject({ held: 0, balance: 1000 })
    expect(bench.entries().some((e) => (e as { kind: string }).kind === 'capture')).toBe(false)
  })

  it('a job a Cloud restart cut short is retried as a new job (transient), never failed as the provider’s verdict', { timeout: 120_000 }, async () => {
    const bench = await (await loadCloudTesting()).bench(cleanups, { workerEntry: ENTRY, resources: RESOURCES, tempDir })
    const runner = cloudJobRunner({ baseUrl: bench.base, token: () => bench.person.accessToken, pollMs: 40, stateDir: tempDir('keys') })
    const first = runner.runJob('submitGpuJob', gpu('slow'), { idempotencyKey: 'restart-job', signal: new AbortController().signal, dir: tempDir('dl1') }).catch((e: unknown) => e)
    await bench.waitJob('submitGpuJob', ['running'])
    // what a restarted Cloud does at boot to the jobs it was running
    await (bench.cloud as unknown as { jobs: { recover(): Promise<void> } }).jobs.recover()
    const err = await first
    expect(err).toMatchObject({ code: 'transient', message: expect.stringMatching(/redémarré/) })
    expect(bench.wallet()).toMatchObject({ held: 0, balance: 1000 })
    // the retry with the same key makes a NEW job (the cut one is spent)
    const second = runner.runJob('submitGpuJob', gpu('ok'), { idempotencyKey: 'restart-job', signal: new AbortController().signal, dir: tempDir('dl2') }).catch((e: unknown) => e)
    await second
    expect(bench.jobs().length).toBe(2)
  })
})
