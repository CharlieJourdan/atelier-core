// Cloud-3: concurrency is a setting. The Cloud ran 2 jobs at once for everybody and every provider (a 13-minute video's 190 pictures,
// 55 clips and 5 presenter calls took about 1.5 h). Now: a global limit (default 8, config `maxConcurrentJobs` or
// ATELIER_CLOUD_MAX_JOBS) and a limit per provider (default 4, config `maxJobsPerProvider` or ATELIER_CLOUD_MAX_JOBS_PER_PROVIDER;
// HeyGen's MCP plan 3), and the queue skips a job whose provider is full to start the next one. Fake adapters only.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CloudConfigFile, loadConfig } from '../src/config.ts'
import { DEFAULT_MAX_JOBS, DEFAULT_MAX_JOBS_PER_PROVIDER, DEFAULT_PROVIDER_CAPS } from '../src/jobs.ts'
import type { ProviderAdapter } from '../src/providers/types.ts'
import { makeCloud, signUpAndIn, type Person, type TestCloud } from './helpers.ts'

const PROD = { NODE_ENV: 'production' }
const LOW = 'image:gpt-image-25-low'
const MEDIUM = 'image:gpt-image-25-medium'

/** Real-looking image adapters that hold their job until `release()` and count how many run at once, per engine. */
function gated() {
  const running: Record<string, number> = { [LOW]: 0, [MEDIUM]: 0 }
  const peak: Record<string, number> = { [LOW]: 0, [MEDIUM]: 0 }
  let open: () => void = () => undefined
  let gate = new Promise<void>((r) => (open = r))
  const adapter = (id: string): ProviderAdapter => ({
    id,
    kind: 'real',
    secretName: 'OPENAI_API_KEY',
    async generateImage() {
      running[id] = (running[id] ?? 0) + 1
      peak[id] = Math.max(peak[id] ?? 0, running[id] ?? 0)
      await gate
      running[id] = (running[id] ?? 0) - 1
      return { files: [{ name: 'image.png', mime: 'image/png', bytes: Buffer.from('png') }], data: {}, costUsd: 0.005 }
    }
  })
  return {
    adapters: [adapter(LOW), adapter(MEDIUM)],
    running,
    peak,
    release: () => {
      open()
      gate = Promise.resolve()
    }
  }
}

async function start(t: TestCloud, p: Person, engine: string, n: number): Promise<string> {
  const q = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'generateImage', input: { prompt: `image ${n}`, count: 1, engine } } })
  const quote = q.json() as { id: string }
  const j = await t.app.inject({ method: 'POST', url: '/v1/jobs', headers: p.auth, payload: { quoteId: quote.id, idempotencyKey: `conc-${engine}-${n}` } })
  expect(j.statusCode).toBe(200)
  return (j.json() as { id: string }).id
}

function cloudWith(g: ReturnType<typeof gated>, o: { maxConcurrentJobs?: number; maxJobsPerProvider?: number } = {}) {
  const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: g.adapters, engines: [LOW, MEDIUM], ...o })
  t.cloud.vault.set('OPENAI_API_KEY', 'openai-test-SECRET-key-0001', 'test')
  return t
}

describe('the limits are settings', () => {
  it('default to 8 jobs at once and 4 per provider, HeyGen’s MCP plan 3', () => {
    expect(DEFAULT_MAX_JOBS).toBe(8)
    expect(DEFAULT_MAX_JOBS_PER_PROVIDER).toBe(4)
    expect(DEFAULT_PROVIDER_CAPS['presenter:heygen-mcp']).toBe(3)
    const t = makeCloud()
    expect(t.cloud.jobs.limits()).toEqual({ maxConcurrent: 8, perProvider: 4, providerCaps: { 'presenter:heygen-mcp': 3 } })
    expect(makeCloud({ maxConcurrentJobs: 5, maxJobsPerProvider: 2 }).cloud.jobs.limits()).toMatchObject({ maxConcurrent: 5, perProvider: 2 })
  })

  it('config.json keys and the environment set them; the environment wins', () => {
    expect(CloudConfigFile.parse({})).toMatchObject({ maxConcurrentJobs: 8, maxJobsPerProvider: 4 })
    expect(() => CloudConfigFile.parse({ maxConcurrentJobs: 0 })).toThrow()
    const dir = mkdtempSync(join(tmpdir(), 'atelier-cloud-cfg-'))
    try {
      expect(loadConfig(dir, {})).toMatchObject({ maxConcurrentJobs: 8, maxJobsPerProvider: 4 })
      expect(loadConfig(dir, { ATELIER_CLOUD_MAX_JOBS: '12', ATELIER_CLOUD_MAX_JOBS_PER_PROVIDER: '6' })).toMatchObject({ maxConcurrentJobs: 12, maxJobsPerProvider: 6 })
      expect(() => loadConfig(dir, { ATELIER_CLOUD_MAX_JOBS: 'lots' })).toThrow(/ATELIER_CLOUD_MAX_JOBS/)
      expect(() => loadConfig(dir, { ATELIER_CLOUD_MAX_JOBS: '0' })).toThrow(/ATELIER_CLOUD_MAX_JOBS/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the queue honours the global and the per-provider limits', () => {
  it('never runs more than the per-provider limit of one provider, and starts another provider’s job while the first is full', async () => {
    const g = gated()
    const t = cloudWith(g, { maxConcurrentJobs: 6, maxJobsPerProvider: 2 })
    const p = await signUpAndIn(t, { credits: 10_000 })
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push(await start(t, p, LOW, i))
    await vi.waitFor(() => expect(g.running[LOW]).toBe(2))
    // the three other pictures of the first provider wait; they do not hold back the second provider
    for (let i = 0; i < 2; i++) ids.push(await start(t, p, MEDIUM, i))
    await vi.waitFor(() => expect(g.running[MEDIUM]).toBe(2))
    expect(g.running[LOW]).toBe(2)
    expect(t.cloud.jobs.get(p.teamId, ids[4] as string).state).toBe('queued')
    g.release()
    await t.cloud.jobs.whenIdle()
    expect(ids.map((id) => t.cloud.jobs.get(p.teamId, id).state)).toEqual(Array(7).fill('succeeded'))
    expect(g.peak[LOW]).toBe(2)
    expect(g.peak[MEDIUM]).toBe(2)
  })

  it('runs the global limit when each provider is below its own', async () => {
    const g = gated()
    const t = cloudWith(g, { maxConcurrentJobs: 3, maxJobsPerProvider: 10 })
    const p = await signUpAndIn(t, { credits: 10_000 })
    for (let i = 0; i < 6; i++) await start(t, p, i % 2 === 0 ? LOW : MEDIUM, i)
    await vi.waitFor(() => expect((g.running[LOW] ?? 0) + (g.running[MEDIUM] ?? 0)).toBe(3))
    await new Promise((r) => setTimeout(r, 30))
    expect((g.running[LOW] ?? 0) + (g.running[MEDIUM] ?? 0)).toBe(3)
    g.release()
    await t.cloud.jobs.whenIdle()
    expect((g.peak[LOW] ?? 0) + (g.peak[MEDIUM] ?? 0)).toBeLessThanOrEqual(6)
  })

  it('a job skipped for its full provider still starts later, and a cancelled queued job leaves the queue', async () => {
    const g = gated()
    const t = cloudWith(g, { maxConcurrentJobs: 4, maxJobsPerProvider: 1 })
    const p = await signUpAndIn(t, { credits: 10_000 })
    const first = await start(t, p, LOW, 0)
    const second = await start(t, p, LOW, 1)
    const third = await start(t, p, LOW, 2)
    await vi.waitFor(() => expect(g.running[LOW]).toBe(1))
    t.cloud.jobs.cancel(p.teamId, second)
    g.release()
    await t.cloud.jobs.whenIdle()
    expect(t.cloud.jobs.get(p.teamId, first).state).toBe('succeeded')
    expect(t.cloud.jobs.get(p.teamId, second).state).toBe('cancelled')
    expect(t.cloud.jobs.get(p.teamId, third).state).toBe('succeeded')
    expect(g.peak[LOW]).toBe(1)
  })
})
