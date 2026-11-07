// Lot Z1 review fixes: automations really start an engine run through the core's wiring (runNow and tick), the example
// automation never fires by itself, and the core's minute timer is only armed when asked.
import { afterEach, describe, expect, it } from 'vitest'
import { fixture, type Fixture } from './z1-runs-fixtures'
import { memoryCore } from './helpers'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

const AUTO = {
  name: 'Quotidienne',
  channelId: 1,
  cadence: 'daily' as const,
  weekday: null,
  hour: 11,
  topicFrom: 'fixed' as const,
  topic: '10 records',
  minutes: 1,
  budgetMode: 'usage_max' as const,
  gateMode: 'all' as const,
  enabled: true
}

function setup(now: () => Date): { core: ReturnType<typeof memoryCore>; fx: Fixture } {
  const fx = fixture()
  const core = memoryCore({ productionRuns: fx.productionRuns, now })
  cleanups.push(() => core.close(), () => fx.cleanup())
  return { core, fx }
}

describe('automations wired to the production runs', () => {
  it('runNow starts a real run on the video it created', async () => {
    const { core } = setup(() => new Date(2026, 9, 21, 10, 30))
    const ch = await core.api['channels.create']({ name: 'Histoire' })
    const a = await core.api['automations.create']({ ...AUTO, channelId: ch.id })
    const row = await core.api['automations.runNow'](a.id)
    expect(row).toMatchObject({ status: 'started' })
    expect(row.runId).not.toBeNull()
    expect(row.videoId).not.toBeNull()
    const run = await core.api['production.get'](row.runId as number)
    expect(run).toMatchObject({ videoId: row.videoId, topic: '10 records', gateMode: 'all' })
    expect(run.nodes.length).toBeGreaterThan(0)
  })

  it('tick fires a due rule through the same wiring, and never the example rule', async () => {
    let now = new Date(2026, 9, 21, 10, 30)
    const { core } = setup(() => now)
    const ch = await core.api['channels.create']({ name: 'Top' })
    const due = await core.api['automations.create']({ ...AUTO, channelId: ch.id })
    // An example rule that looks due: it must stay untouched.
    core.db
      .prepare(
        `INSERT INTO automations (name, channel_id, cadence, weekday, hour, topic_from, topic, minutes, budget_mode, gate_mode, enabled, next_run_at, example)
         VALUES ('Exemple', ?, 'daily', NULL, 11, 'fixed', 'Inventé', 1, 'usage_max', 'step', 1, ?, 1)`
      )
      .run(ch.id, new Date(2026, 9, 21, 9).toISOString())
    expect(await core.context.automations.tick()).toEqual([])
    now = new Date(2026, 9, 21, 11, 1)
    const fired = await core.context.automations.tick()
    expect(fired.map((f) => [f.automationId, f.status])).toEqual([[due.id, 'started']])
    expect((await core.api['production.list']({})).length).toBe(1)
  })

  it('the example automation is seeded disabled with no next firing', async () => {
    const { core } = setup(() => new Date(2026, 9, 21, 10, 30))
    await core.api['example.load']()
    const autos = await core.api['automations.list']()
    expect(autos.every((a) => !a.enabled && a.nextRunAt === null)).toBe(true)
  })
})
