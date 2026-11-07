// `npm run orchestra:demo` — the agent runtime's proof (docs/AGENT-RUNTIME.md), free and offline by default. On a temp
// database it seeds a workspace with 2 channels, gives the principal "produce next week's topics", and runs the
// supervisor loop on a simulated clock until the work is done:
//   principal → the 2 channel leads → their researchers; one researcher's CLI hangs (a simulated crash): the watchdog
//   kills its process tree and the task is retried; account 1 hits its usage limit: the turn fails over to account 2;
//   the principal's context passes its budget: compaction into memory + a fresh session; the principal asks Charlie to
//   validate the plan (the demo answers), then concludes. It prints the timeline, then checks the invariants; exit 0 =
//   all hold. The real ClaudeCodeProvider runs on a fake `claude` child process (stream-json), so --resume,
//   CLAUDE_CONFIG_DIR and the process-tree kill are the real code paths.
// `--real` uses the real Claude Code CLI of this machine instead (it spends from the subscription: only on purpose;
// the crash and limit simulations are then off). `--keep` keeps the temp folder.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCore } from '../src/main/core'
import { ClaudeCodeProvider } from '../src/main/llm/claude-code'
import { FakeProvider } from '../src/main/llm/fake'
import { AccountProviders } from '../src/main/orchestra/providers'
import { fakeClaudeCli, scriptedReply, type FakeCliReply } from '../src/main/orchestra/fake-team'
import type { OrchEvent } from '../src/shared/api/orchestra'

const REAL = process.argv.includes('--real')
const KEEP = process.argv.includes('--keep')
const out = (s: string): void => void process.stdout.write(s + '\n')

const T0 = Date.parse('2026-10-26T08:00:00.000Z')
let now = T0
const dir = mkdtempSync(path.join(os.tmpdir(), 'atelier-orchestra-demo-'))
const account2Dir = path.join(dir, 'claude-account-2')

// ---- the fake CLI: one researcher hangs once; account 1 hits its usage limit on its 4th call (resets 7 min later) ---
let hungOnce = false
let account1Calls = 0
const cli = fakeClaudeCli((call): FakeCliReply => {
  if (call.configDir === null) account1Calls++
  if (!hungOnce && call.system.includes('(role: researcher, channel: Mystères)')) {
    hungOnce = true
    return { hang: true }
  }
  if (call.configDir === null && account1Calls === 4) {
    return { error: `Claude AI usage limit reached|${Math.floor((T0 + 7 * 60_000) / 1000)}` }
  }
  return { text: scriptedReply(call.system, call.prompt) }
})
const seams = { platform: process.platform, findBinary: () => (process.platform === 'win32' ? 'C:\\fake\\claude.exe' : '/fake/claude'), spawn: cli.spawn, killTree: cli.kill, exitWaitMs: 200 }
const providers = REAL
  ? new AccountProviders({ defaultClaudeCode: new ClaudeCodeProvider(), anthropic: new FakeProvider() })
  : new AccountProviders({ defaultClaudeCode: new ClaudeCodeProvider({ ...seams, env: { PATH: process.env.PATH ?? '' } }), anthropic: new FakeProvider(), claudeCode: seams })

const core = createCore({
  paths: { userData: dir },
  cipher: { isAvailable: () => true, encrypt: (s) => new TextEncoder().encode(s), decrypt: (b) => new TextDecoder().decode(b) },
  now: () => new Date(now),
  orchestra: { providers: providers.factory, cronUtc: true }
})
const o = core.orchestra

// ---- workspace -----------------------------------------------------------------------------------------------------
const addChannel = core.db.prepare("INSERT INTO channels (name, niche, standards) VALUES (?, ?, ?)")
addChannel.run('Histoire', 'histoire racontée', 'Faits sourcés, ton posé.')
addChannel.run('Mystères', 'mystères non résolus', 'Suspense, jamais de fausses affirmations.')
o.seed()
if (!REAL) o.saveAccount({ kind: 'claude-code', label: 'Claude Code · compte 2', configDir: account2Dir, priority: 1, maxConcurrent: 2 })
o.saveAccount({ id: 1, kind: 'claude-code', label: 'Claude Code · compte 1', priority: 0, maxConcurrent: 2 })
const principal = o.parts.tree.bySlug('principal')!
o.updateAgent(principal.id, { policy: { compactAtTokens: 300 } })

const names = new Map(o.agents().map((a) => [a.id, a.name]))
const clockText = (at: string): string => {
  const s = Math.round((Date.parse(at) - T0) / 1000)
  return `+${String(Math.floor(s / 60)).padStart(3, '0')}:${String(s % 60).padStart(2, '0')}`
}
const QUIET = new Set(['status', 'lease'])
o.parts.events.listener = (e: OrchEvent) => {
  if (QUIET.has(e.type)) return
  out(`${clockText(e.at)}  ${e.type.padEnd(10)} ${(e.agentId !== null ? names.get(e.agentId) ?? '' : '').padEnd(34)} ${e.text}`)
}

out(`Atelier agent runtime demo${REAL ? ' (REAL Claude Code CLI)' : ' (fake CLI, simulated clock)'} — data in ${dir}`)
out(`Team: ${o.agents().length} agents, accounts: ${o.accounts().map((a) => a.label).join(', ')}`)
out('')
out('TIMELINE')
const root = o.enqueue({ assigneeId: principal.id, kind: 'plan', title: 'Produire les sujets de la semaine prochaine', brief: '3 sujets par chaîne, sources vérifiables [validate]' })

// ---- the loop ------------------------------------------------------------------------------------------------------
const settle = (ms: number): Promise<void> => Promise.race([o.supervisor.idle(), new Promise<void>((r) => setTimeout(r, ms))])
for (let i = 0; i < 80; i++) {
  await o.tick()
  await settle(REAL ? 600_000 : 100)
  const ask = o.inbox().find((x) => x.kind === 'validate' && x.status === 'open')
  if (ask) o.answer(ask.id, { choice: 'Valider', text: 'Parfait, on part là-dessus.' })
  if (o.parts.queue.get(root.id).status === 'done' && o.supervisor.running.size === 0) break
  now += 2 * 60_000
}
await o.supervisor.idle()

// ---- checks --------------------------------------------------------------------------------------------------------
const q = o.parts.queue
const all = q.list({ limit: 1000 })
const events = o.events(0, 1000)
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => void checks.push({ name, ok, detail })
const rootTask = q.get(root.id)
const leads = all.filter((t) => t.parentId === root.id)
const researches = all.filter((t) => leads.some((l) => l.id === t.parentId))
check('delegation', rootTask.status === 'done' && leads.length === 2 && researches.length === 2 && [...leads, ...researches].every((t) => t.status === 'done'),
  `principal #${root.id} ${rootTask.status}; ${leads.length} lead task(s), ${researches.length} research task(s), all done`)
check('auto-bump', leads.every((t) => t.bumps === 1) && rootTask.bumps >= 1, `leads woken ${leads.map((t) => t.bumps).join('/')}×, principal ${rootTask.bumps}×`)
const killedTask = researches.find((t) => t.attempts === 2)
if (!REAL) {
  check('watchdog', events.some((e) => e.type === 'kill') && cli.killed.length === 1 && killedTask?.status === 'done',
    `hung CLI pid ${cli.killed.join(',') || '-'} killed, task #${killedTask?.id ?? '-'} retried and done after ${killedTask?.attempts ?? 0} attempts`)
  const acc = o.accounts()
  const limit = events.find((e) => e.type === 'limit')
  check('failover', limit !== undefined && events.some((e) => e.type === 'failover') && all.some((t) => t.accountId === acc[1]!.id && t.status === 'done'),
    `${limit?.text.replace(/ \(.*$/, '') ?? 'no limit'}; the turn moved to ${acc[1]!.label} at once, account 1 used again after its reset`)
  check('session resume', cli.calls.some((c) => c.resumeId !== null), `${cli.calls.filter((c) => c.resumeId !== null).length} turn(s) continued their Claude Code session with --resume`)
  check('account 2 config folder', cli.calls.some((c) => c.configDir === account2Dir), `CLAUDE_CONFIG_DIR=${account2Dir} on ${cli.calls.filter((c) => c.configDir === account2Dir).length} call(s)`)
}
const compactions = events.filter((e) => e.type === 'compaction' && e.text.includes('fresh session'))
const principalMemory = o.memory(principal.id)
check('compaction', compactions.length >= 1 && principalMemory.some((m) => m.source.startsWith('compaction:')) && o.parts.memory.closedSessions(principal.id) >= 1,
  `${compactions.length} compaction(s); principal memory: ${principalMemory.length} item(s), ${principalMemory.filter((m) => m.source.startsWith('compaction:')).length} from compaction`)
const answered = o.inbox(true).filter((x) => x.kind === 'validate' && x.status === 'answered')
check('human in the loop', answered.length === 1 && Array.isArray(rootTask.payload.human), `"${answered[0]?.body ?? '-'}" → ${answered[0]?.answer?.choice ?? '-'}`)
const open = all.filter((t) => ['leased', 'running', 'queued', 'failed', 'waiting'].includes(t.status))
check('nothing left running or lost', open.length === 0 && all.every((t) => t.status !== 'dead'), `${all.length} task(s): ${Object.entries(q.counts()).map(([k, v]) => `${v} ${k}`).join(', ')}`)
const ledger = core.db.prepare('SELECT status, account_id, orch_task_id FROM ledger').all() as { status: string; account_id: number | null; orch_task_id: number | null }[]
check('ledger', ledger.length > 0 && ledger.every((l) => l.account_id !== null && l.orch_task_id !== null && l.status !== 'reserved'),
  `${ledger.length} call(s) booked: ${ledger.filter((l) => l.status === 'settled').length} settled, ${ledger.filter((l) => l.status === 'refunded').length} refunded`)
check('agents asleep', o.agents().every((a) => a.status === 'sleeping'), 'every agent sleeps once the work is done (no tokens spent)')
const resumed = cli.calls.filter((c) => c.resumeId !== null).length

out('')
out('RESULT')
out(`Principal: ${rootTask.result}`)
for (const l of leads) out(`  ${names.get(l.assigneeId)}: ${l.result}`)
out('')
out(`ACCOUNTS: ${o.accounts().map((a) => `${a.label} — ${a.calls} call(s)${a.limitedUntil ? `, limited until ${a.limitedUntil}` : ''}`).join(' | ')}`)
if (!REAL) out(`CLI calls: ${cli.calls.length} (${resumed} resumed with --resume, ${cli.killed.length} killed by the watchdog)`)
out('')
out('CHECKS')
for (const c of checks) out(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`)
const failed = checks.filter((c) => !c.ok).length
out('')
out(failed === 0 ? `All ${checks.length} invariants hold.` : `${failed} invariant(s) failed.`)
core.close()
if (!KEEP) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
process.exit(failed === 0 ? 0 : 1)
