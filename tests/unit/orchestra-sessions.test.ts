// Agent runtime: Claude Code session continuity (--resume on the same account, a fresh session elsewhere), the context
// budget (compaction by a cheap model into memory items + a handover, then a fresh session seeded with them), memory
// recall, and model routing per task kind (tier, effort, overrides). The real ClaudeCodeProvider runs on a fake CLI.
import { trackTemp } from '../setup/track-temp'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ClaudeCodeProvider } from '../../src/main/llm/claude-code'
import { FakeProvider } from '../../src/main/llm/fake'
import { AccountProviders } from '../../src/main/orchestra/providers'
import { COMPACTION_MARK } from '../../src/main/orchestra/compaction'
import { fakeClaudeCli, scriptedReply } from '../../src/main/orchestra/fake-team'
import { keywords } from '../../src/main/orchestra/memory'
import { Router } from '../../src/main/orchestra/routing'
import { agentBySlug, rig } from './orchestra-helpers'

function cliTeam() {
  const cli = fakeClaudeCli((call) => ({ text: scriptedReply(call.system, call.prompt) }))
  const seams = { platform: 'win32' as const, findBinary: () => 'C:\\fake\\claude.exe', spawn: cli.spawn, killTree: cli.kill, exitWaitMs: 50, removeDir: (d: string) => void trackTemp(d) }
  const ap = new AccountProviders({ defaultClaudeCode: new ClaudeCodeProvider({ ...seams, env: {} }), anthropic: new FakeProvider(), env: { PATH: 'x' }, claudeCode: seams })
  return { cli, r: rig({ providerFor: ap.factory }) }
}

describe('sessions', () => {
  it('resumes the agent’s Claude Code session on the same account, in the agent’s own folder, with the effort flag', async () => {
    const { cli, r } = cliTeam()
    const o = r.core.orchestra
    const a = agentBySlug(r, `researcher-${r.channels[0]}`)
    o.enqueue({ assigneeId: a.id, kind: 'research', title: 'Premier sujet' })
    await o.tick({ wait: true })
    o.enqueue({ assigneeId: a.id, kind: 'research', title: 'Deuxième sujet' })
    await o.tick({ wait: true })
    const [first, second] = cli.calls
    expect(first!.resumeId).toBeNull()
    expect(first!.args).not.toContain('--no-session-persistence')
    expect(first!.args[first!.args.indexOf('--effort') + 1]).toBe('medium')
    expect(first!.cwd).toBe(path.join(r.dataDir, 'agents', a.slug))
    expect(first!.prompt).toContain('Do the task now')
    expect(second!.resumeId).toBe('fake-session-1')
    expect(second!.args).toContain('--resume')
    // a resumed turn sends only the new task, not the memory again
    expect(second!.prompt).not.toContain('What you remember')
    const session = o.parts.memory.session(a.id)
    expect(session).toMatchObject({ cliSessionId: 'fake-session-1', turns: 2, accountId: 1 })
  })

  it('starts a fresh CLI session (full context) when the task runs on another account', async () => {
    const { cli, r } = cliTeam()
    const o = r.core.orchestra
    const a = agentBySlug(r, `researcher-${r.channels[0]}`)
    o.enqueue({ assigneeId: a.id, kind: 'research', title: 'Premier' })
    await o.tick({ wait: true })
    o.saveAccount({ id: 1, kind: 'claude-code', label: 'Claude Code (connexion par défaut)', enabled: false })
    o.saveAccount({ kind: 'claude-code', label: 'Compte 2', configDir: 'C:\\cc\\two' })
    o.enqueue({ assigneeId: a.id, kind: 'research', title: 'Deuxième' })
    await o.tick({ wait: true })
    expect(cli.calls[1]).toMatchObject({ resumeId: null, configDir: 'C:\\cc\\two' })
    expect(cli.calls[1]!.prompt).toContain('What you remember')
  })

  it('compacts past the context budget: memory items + handover by the fast tier, then a fresh seeded session', async () => {
    const { cli, r } = cliTeam()
    const o = r.core.orchestra
    const a = agentBySlug(r, `researcher-${r.channels[0]}`)
    o.updateAgent(a.id, { policy: { compactAtTokens: 100 } })
    o.enqueue({ assigneeId: a.id, kind: 'research', title: 'Premier sujet' })
    await o.tick({ wait: true })
    const before = o.parts.memory.session(a.id)
    expect(before.contextTokens).toBeGreaterThanOrEqual(100)
    o.enqueue({ assigneeId: a.id, kind: 'research', title: 'Deuxième sujet' })
    await o.tick({ wait: true })
    expect(cli.calls).toHaveLength(3)
    const [, compaction, fresh] = cli.calls
    expect(compaction!.prompt.startsWith(COMPACTION_MARK)).toBe(true)
    expect(compaction!.args[compaction!.args.indexOf('--model') + 1]).toBe('claude-haiku-5-5')
    expect(fresh!.resumeId).toBeNull()
    expect(fresh!.prompt).toContain('Handover from your previous session')
    expect(fresh!.prompt).toContain('Weekly topics delegated')
    expect(fresh!.prompt).toContain('Charlie wants the weekly topics validated')
    const items = o.memory(a.id)
    expect(items.filter((m) => m.source === `compaction:${before.id}`).map((m) => m.kind).sort()).toEqual(['lesson', 'preference'])
    expect(o.parts.memory.closedSessions(a.id)).toBe(1)
    const now = o.parts.memory.session(a.id)
    expect(now.id).not.toBe(before.id)
    expect(now.cliSessionId).toBe('fake-session-3')
    expect(o.events(0, 500).some((e) => e.type === 'compaction' && e.text.includes('fresh session'))).toBe(true)
    // the compaction call is in the ledger too, on the task that triggered it
    const n = (r.core.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE model = 'claude-haiku-5-5'").get() as { n: number }).n
    expect(n).toBe(1)
  })

  it('compaction falls back to a plain handover when the cheap model answers garbage', async () => {
    const r = rig({
      providerFor: () => new FakeProvider((req) => (req.prompt.startsWith(COMPACTION_MARK) ? 'no json here' : scriptedReply(req.system ?? '', req.prompt)))
    })
    const o = r.core.orchestra
    const a = agentBySlug(r, `researcher-${r.channels[0]}`)
    o.updateAgent(a.id, { policy: { compactAtTokens: 100 } })
    o.enqueue({ assigneeId: a.id, kind: 'research', title: 'Un' })
    await o.tick({ wait: true })
    o.enqueue({ assigneeId: a.id, kind: 'research', title: 'Deux' })
    await o.tick({ wait: true })
    expect(o.parts.memory.session(a.id).handover).toContain('automatic summary')
    expect(o.tasks({ assigneeId: a.id }).every((t) => t.status === 'done')).toBe(true)
  })
})

describe('memory recall', () => {
  it('ranks by shared keywords, importance and recency; dedupes; deletes', () => {
    const r = rig()
    const m = r.core.orchestra.parts.memory
    const a = agentBySlug(r, 'principal')
    m.add(a.id, { kind: 'fact', content: 'The History channel posts on Tuesdays', source: 'user', importance: 2 })
    m.add(a.id, { kind: 'preference', content: 'Charlie prefers short thumbnails text', source: 'user', importance: 5 })
    m.add(a.id, { kind: 'style', content: 'Scripts open with a cold open about the mystery', source: 'user', importance: 3 })
    const again = m.add(a.id, { kind: 'fact', content: 'The History channel posts on Tuesdays', source: 'task:1', importance: 4 })
    expect(m.list(a.id)).toHaveLength(3)
    expect(again.importance).toBe(4)
    const top = m.recall(a.id, 'write the script about the mystery', 1)
    expect(top[0]!.kind).toBe('style')
    expect(m.recall(a.id, 'unrelated words', 3)[0]!.kind).toBe('preference')
    expect([...keywords('Les vidéos de la chaîne Histoire')]).toEqual(['videos', 'chaine', 'histoire'])
    r.core.orchestra.deleteMemory(top[0]!.id)
    expect(m.list(a.id)).toHaveLength(2)
    expect(() => r.core.orchestra.deleteMemory(top[0]!.id)).toThrow(/Unknown memory/)
  })
})

describe('routing', () => {
  it('maps task kinds to tiers and efforts, with workspace and agent overrides', () => {
    const r = rig()
    const router = new Router(r.core.context.settings)
    expect(router.resolve('script')).toMatchObject({ tier: 'best', effort: 'high', source: 'built-in' })
    expect(router.resolve('qc_check')).toMatchObject({ tier: 'fast', effort: 'low' })
    expect(router.resolve('summary')).toMatchObject({ tier: 'fast' })
    expect(router.resolve('research')).toMatchObject({ tier: 'balanced', effort: 'medium' })
    expect(router.resolve('architecture')).toMatchObject({ tier: 'best' })
    expect(router.resolve('something_new')).toMatchObject({ tier: 'balanced', effort: 'medium', source: 'default' })
    r.core.context.settings.set('orchestra.routing', { research: { tier: 'fast' }, script: { tier: 'nope' } })
    expect(router.resolve('research')).toMatchObject({ tier: 'fast', effort: 'medium', source: 'workspace' })
    expect(router.resolve('script')).toMatchObject({ tier: 'best' })
    expect(router.resolve('research', { tier: 'best' })).toMatchObject({ tier: 'best', source: 'agent' })
    expect(router.resolve('research', { tier: 'best', kinds: { research: { tier: 'fast', effort: 'low' } } })).toMatchObject({ tier: 'fast', effort: 'low', source: 'agent-kind' })
    expect(router.resolve('plan', { model: 'claude-opus-5-5' }).model).toBe('claude-opus-5-5')
  })

  it('calls the tier’s model: Opus for a script, Sonnet for research, Haiku for a QC check', async () => {
    const seen: string[] = []
    const r = rig({ providerFor: () => new FakeProvider((req) => (seen.push(`${/kind: ([a-z_]+)/.exec(req.prompt)?.[1]}=${req.model}/${req.effort}`), 'ok')) })
    const o = r.core.orchestra
    const ch = r.channels[0]
    o.enqueue({ assigneeId: agentBySlug(r, `scriptwriter-${ch}`).id, kind: 'script', title: 's' })
    o.enqueue({ assigneeId: agentBySlug(r, `researcher-${ch}`).id, kind: 'research', title: 'r' })
    o.enqueue({ assigneeId: agentBySlug(r, `qc-eye-${ch}`).id, kind: 'qc_check', title: 'q' })
    // the default account runs 2 calls at a time: two in the first pass, the third in the next one
    expect((await o.tick({ wait: true })).started).toBe(2)
    expect((await o.tick({ wait: true })).started).toBe(1)
    expect(seen.sort()).toEqual(['qc_check=claude-haiku-5-5/low', 'research=claude-sonnet-5-5/medium', 'script=claude-opus-5-5/high'])
  })
})
