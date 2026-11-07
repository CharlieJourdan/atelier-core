// usage-claude: what the Claude Code subscription served is read from the ledger — tokens, API-equivalent cost, time.
import { describe, expect, it } from 'vitest'
import { reserveFor, runReserved } from '../../src/main/agents/call'
import { FakeProvider } from '../../src/main/llm'
import { memoryCore } from './helpers'

const ROUTE = { providerId: 'claude-code', model: 'claude-sonnet-5-5', tier: 'balanced' }
const WHO = { channelId: null, videoId: null as number | null, taskId: null }

function setup() {
  const core = memoryCore({ now: () => new Date('2026-11-03T12:00:00.000Z') })
  const ch = Number(core.db.prepare('INSERT INTO channels (name) VALUES (?)').run('c').lastInsertRowid)
  const video = (title: string) =>
    Number(core.db.prepare('INSERT INTO videos (channel_id, title) VALUES (?, ?)').run(ch, title).lastInsertRowid)
  return { core, ch, video }
}

async function turn(core: ReturnType<typeof memoryCore>, videoId: number | null, model: string, costUsd: number, providerId = 'claude-code') {
  const provider = new FakeProvider([{ text: 'ok', costUsd }], providerId)
  const est = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const handle = reserveFor(core.ledger, { ...ROUTE, providerId, model } as never, est, { ...WHO, videoId })
  await runReserved(core.ledger, handle, provider, { model, prompt: 'hi' })
}

describe('Claude usage from the ledger', () => {
  it('totals a video: tokens, API-equivalent cost, calls, time, by model; ignores other providers and videos', async () => {
    const { core, video } = setup()
    const a = video('A')
    const b = video('B')
    await turn(core, a, 'claude-sonnet-5-5', 0.25)
    await turn(core, a, 'claude-opus-5-5', 0.5)
    await turn(core, b, 'claude-sonnet-5-5', 9)
    await turn(core, a, 'claude-sonnet-5-5', 3, 'anthropic')
    const u = core.ledger.claudeUsage({ videoId: a })
    expect(u.calls).toBe(2)
    expect(u.apiEquivalentUsd).toBeCloseTo(0.75)
    expect(u.byModel.map((m) => m.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
    expect(u.totalTokens).toBe(u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens)
    expect(u.durationMs).toBeGreaterThanOrEqual(0)
    const stored = core.db.prepare('SELECT duration_ms AS d FROM ledger WHERE video_id = ? AND provider_id = ?').all(a, 'claude-code') as { d: number | null }[]
    expect(stored.every((r) => typeof r.d === 'number')).toBe(true)
  })

  it('the weekly total covers the last 7 days only', async () => {
    const { core, video } = setup()
    const a = video('A')
    await turn(core, a, 'claude-sonnet-5-5', 1)
    await turn(core, a, 'claude-sonnet-5-5', 2)
    core.db.prepare(`UPDATE ledger SET created_at = '2026-10-20T00:00:00.000Z' WHERE id = (SELECT MIN(id) FROM ledger)`).run()
    const u = core.ledger.claudeUsage({ lastWeek: true })
    expect(u.calls).toBe(1)
    expect(u.apiEquivalentUsd).toBeCloseTo(2)
  })

  it('is empty without any Claude Code call', () => {
    const { core } = setup()
    expect(core.ledger.claudeUsage({ lastWeek: true })).toMatchObject({ calls: 0, totalTokens: 0, apiEquivalentUsd: 0, byModel: [] })
  })

  it('is reachable over the API', async () => {
    const { core, video } = setup()
    const a = video('A')
    await turn(core, a, 'claude-sonnet-5-5', 0.1)
    const api = core.api as unknown as Record<string, (...a: unknown[]) => unknown>
    expect((api['spend.claudeUsage']!({ videoId: a }) as { calls: number }).calls).toBe(1)
  })
})
