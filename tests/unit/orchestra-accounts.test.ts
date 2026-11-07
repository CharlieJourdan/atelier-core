// Agent runtime: the account pool (selection by tier preference, priority and load; concurrency limits), usage-limit
// detection, transparent failover to the next account, waiting when every account is limited (the principal says when
// work resumes), and the providers built per account (CLAUDE_CONFIG_DIR / CODEX_HOME).
import { describe, expect, it } from 'vitest'
import { FakeProvider } from '../../src/main/llm/fake'
import type { CompletionRequest } from '../../src/main/llm/types'
import { AccountProviders } from '../../src/main/orchestra/providers'
import { DEFAULT_RATE_COOLDOWN_MS, DEFAULT_USAGE_COOLDOWN_MS, detectLimit, resetTime } from '../../src/main/orchestra/limits'
import { scriptedResponder } from '../../src/main/orchestra/fake-team'
import { agentBySlug, drain, rig, T0 } from './orchestra-helpers'

describe('limit detection', () => {
  const now = T0
  it('reads the reset time of Claude Code, Codex and HTTP refusals', () => {
    expect(detectLimit('Claude AI usage limit reached|1793005200', now)).toMatchObject({ kind: 'usage', until: 1793005200 * 1000 })
    expect(detectLimit("You've hit your usage limit. Try again in 2 hours 5 minutes.", now)?.until).toBe(now + 2 * 3_600_000 + 5 * 60_000)
    expect(detectLimit('429 Too Many Requests (Retry-After: 30)', now)).toMatchObject({ kind: 'rate', until: now + 30_000 })
    expect(detectLimit('rate_limit_error: slow down', now)).toMatchObject({ kind: 'rate', until: now + DEFAULT_RATE_COOLDOWN_MS })
    expect(detectLimit('Usage limit reached, resets at 2026-10-26T13:00:00Z', now)?.until).toBe(Date.parse('2026-10-26T13:00:00Z'))
    expect(detectLimit('quota exceeded', now)?.until).toBe(now + DEFAULT_USAGE_COOLDOWN_MS)
    const local = detectLimit("You've hit your limit · resets 3pm (Europe/Paris)", now)!
    expect(new Date(local.until).getHours()).toBe(15)
    expect(local.until).toBeGreaterThan(now)
    expect(resetTime('try again at 12:30 am', now)).toBeGreaterThan(now)
    // ordinary failures are not limits
    expect(detectLimit('Claude Code exited (code 1) without a result', now)).toBeNull()
    expect(detectLimit('', now)).toBeNull()
    // never more than 8 days
    expect(detectLimit('usage limit reached|9999999999', now)!.until).toBe(now + 8 * 86_400_000)
  })
})

describe('account pool', () => {
  it('picks by kind preference, then priority, then load; respects each account’s concurrency', () => {
    const r = rig()
    const pool = r.core.orchestra.parts.accounts
    const second = r.core.orchestra.saveAccount({ kind: 'claude-code', label: 'Compte 2', configDir: 'C:\\cc\\two', priority: 1, maxConcurrent: 1 })
    const api = r.core.orchestra.saveAccount({ kind: 'anthropic', label: 'Clé API', priority: 0 })
    expect(pool.pick('balanced')?.id).toBe(1)
    pool.acquire(1)
    pool.acquire(1) // default account: 2 slots
    expect(pool.pick('balanced')?.id).toBe(second.id)
    pool.acquire(second.id)
    // subscriptions are full: the beta rule (decision 0038) never hands an agent's turn to the API key
    expect(pool.pick('balanced')).toBeNull()
    r.core.orchestra.saveAccount({ id: api.id, kind: 'anthropic', label: 'Clé API', tiers: ['fast'] })
    expect(pool.pick('fast')).toBeNull()
    pool.release(second.id)
    expect(pool.pick('fast')?.id).toBe(second.id)
    expect(() => r.core.orchestra.saveAccount({ id: api.id, kind: 'codex', label: 'x' })).toThrow(/cannot change/)
    expect(() => r.core.orchestra.saveAccount({ kind: 'codex', label: 'x', configDir: 'C:\\a"b' })).toThrow(/Invalid config folder/)
  })

  it('builds one CLI provider per account: CLAUDE_CONFIG_DIR / CODEX_HOME, the default login without a folder', () => {
    const def = new FakeProvider()
    const api = new FakeProvider()
    const ap = new AccountProviders({ defaultClaudeCode: def, anthropic: api, env: { PATH: 'x' } })
    const base = { secretName: null, profileId: null, tiers: ['best', 'balanced', 'fast'] as const, models: {}, priority: 0, maxConcurrent: 1, enabled: true, limitedUntil: null, limitNote: null, calls: 0, failures: 0, lastUsedAt: null }
    expect(ap.factory({ ...base, tiers: [...base.tiers], id: 1, kind: 'claude-code', label: 'a', configDir: null })).toBe(def)
    const cc = ap.factory({ ...base, tiers: [...base.tiers], id: 2, kind: 'claude-code', label: 'b', configDir: 'C:\\cc\\two' }) as unknown as { env: NodeJS.ProcessEnv }
    expect(cc.env.CLAUDE_CONFIG_DIR).toBe('C:\\cc\\two')
    const cx = ap.factory({ ...base, tiers: [...base.tiers], id: 3, kind: 'codex', label: 'c', configDir: 'C:\\codex\\one' }) as unknown as { env: NodeJS.ProcessEnv; id: string }
    expect(cx.id).toBe('codex')
    expect(cx.env.CODEX_HOME).toBe('C:\\codex\\one')
    expect(ap.factory({ ...base, tiers: [...base.tiers], id: 4, kind: 'anthropic', label: 'd', configDir: null })).toBe(api)
    expect(ap.factory({ ...base, tiers: [...base.tiers], id: 5, kind: 'relay', label: 'e', configDir: null }).id).toBe('atelier-relay')
  })
})

describe('failover', () => {
  const limited = (req: CompletionRequest) => {
    void req
    return { text: '', error: 'Claude AI usage limit reached|1793005200' }
  }

  it('moves a turn to the next account at once when the first one hits its usage limit', async () => {
    let calls1 = 0
    const r = rig({
      providerFor: (a) =>
        a.id === 1
          ? new FakeProvider(() => {
              calls1++
              return { text: '', error: 'Claude AI usage limit reached|1793005200' }
            })
          : new FakeProvider((req) => scriptedResponder(req))
    })
    const o = r.core.orchestra
    // the Réglages screen creates the default profile after the runtime's first account: it is still the one marked
    r.core.db.prepare("INSERT INTO claude_profiles (name, kind, is_default) VALUES ('Mon Claude Code', 'cli', 1)").run()
    const two = o.saveAccount({ kind: 'claude-code', label: 'Compte 2', configDir: 'C:\\cc\\two', priority: 1 })
    const researcher = agentBySlug(r, `researcher-${r.channels[0]}`)
    const t = o.enqueue({ assigneeId: researcher.id, kind: 'research', title: 'Sujets' })
    await o.tick({ wait: true })
    expect(calls1).toBe(1)
    expect(o.parts.queue.get(t.id)).toMatchObject({ status: 'done', attempts: 1, accountId: two.id })
    const accounts = o.accounts()
    expect(accounts[0]).toMatchObject({ id: 1, limitedUntil: new Date(1793005200 * 1000).toISOString() })
    // the Réglages profile shows the same limit
    expect((r.core.db.prepare('SELECT limited_until FROM claude_profiles WHERE id = 1').get() as { limited_until: string }).limited_until).toBe(new Date(1793005200 * 1000).toISOString())
    // the refused call was refunded (it never reached the model), the second one settled on account 2
    const rows = r.core.db.prepare('SELECT account_id, status FROM ledger WHERE orch_task_id = ? ORDER BY id').all(t.id)
    expect(rows).toEqual([
      { account_id: 1, status: 'refunded' },
      { account_id: two.id, status: 'settled' }
    ])
    expect(o.events(0, 500).some((e) => e.type === 'failover')).toBe(true)
    // later calls skip the limited account
    const t2 = o.enqueue({ assigneeId: researcher.id, kind: 'research', title: 'Encore' })
    await o.tick({ wait: true })
    expect(calls1).toBe(1)
    expect(o.parts.queue.get(t2.id).status).toBe('done')
  })

  it('when every account is limited, tasks wait (no attempt spent) and the principal says when work resumes', async () => {
    let ok = false
    const reset = T0 + 2 * 3_600_000
    const r = rig({
      providerFor: () => new FakeProvider((req) => (ok ? scriptedResponder(req) : { text: '', error: `Usage limit reached, resets at ${new Date(reset).toISOString()}` }))
    })
    const o = r.core.orchestra
    o.saveAccount({ kind: 'claude-code', label: 'Compte 2', configDir: 'C:\\cc\\two', priority: 1 })
    const researcher = agentBySlug(r, `researcher-${r.channels[0]}`)
    const t = o.enqueue({ assigneeId: researcher.id, kind: 'research', title: 'Sujets' })
    await o.tick({ wait: true })
    expect(o.parts.queue.get(t.id)).toMatchObject({ status: 'waiting', waitReason: 'accounts', attempts: 0, notBefore: new Date(reset).toISOString() })
    expect(o.status()).toMatchObject({ accountsReady: 0, accountsLimited: 2, resumesAt: new Date(reset).toISOString() })
    expect(o.agents().find((a) => a.id === researcher.id)?.status).toBe('waiting')
    const sup = r.core.chat.store.open({ kind: 'supervisor' })
    const said = r.core.chat.store.messages(sup.id).map((m) => m.body)
    expect(said.some((b) => b.includes('le travail reprend vers'))).toBe(true)
    // a new task waits too, without calling anything
    const t2 = o.enqueue({ assigneeId: agentBySlug(r, `researcher-${r.channels[1]}`).id, kind: 'research', title: 'Autre' })
    await o.tick({ wait: true })
    expect(o.parts.queue.get(t2.id)).toMatchObject({ status: 'waiting', waitReason: 'accounts', attempts: 0 })
    // the reset comes: everything resumes on its own
    ok = true
    r.clock.set(reset + 1000)
    await drain(r)
    expect(o.parts.queue.get(t.id).status).toBe('done')
    expect(o.parts.queue.get(t2.id).status).toBe('done')
    expect(r.core.chat.store.messages(sup.id).some((m) => m.body.includes('le travail reprend.'))).toBe(true)
  })

  it('clearing a limit by hand releases the waiting tasks', async () => {
    let ok = false
    const r = rig({ providerFor: () => new FakeProvider((req) => (ok ? scriptedResponder(req) : limited(req))) })
    const o = r.core.orchestra
    const researcher = agentBySlug(r, `researcher-${r.channels[0]}`)
    const t = o.enqueue({ assigneeId: researcher.id, kind: 'research', title: 'Sujets' })
    await o.tick({ wait: true })
    expect(o.parts.queue.get(t.id).status).toBe('waiting')
    ok = true
    expect(o.clearLimit(1).limitedUntil).toBeNull()
    expect(o.parts.queue.get(t.id).status).toBe('queued')
    await o.tick({ wait: true })
    expect(o.parts.queue.get(t.id).status).toBe('done')
  })
})
