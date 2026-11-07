// `npm run orchestra:week` — the planner's proof (docs/AGENT-RUNTIME.md §26), free and offline: a simulated week of a
// team of three channels on a temp database, the fake `claude` CLI (the real ClaudeCodeProvider on a fake child
// process), the in-memory production port and a simulated clock ticking every 15 minutes. Nobody tells the team what to
// do: the planner turns each channel's confirmed goals into steps. The week contains:
//   - « Histoire », recommended level (Charlie validates topics and thumbnails), a slot on Monday 18:00 that is too
//     close to be made; Charlie leaves one question unanswered for 30 h (one reminder, the lead told about the stuck step);
//   - « Mystères », « tout automatique »: no question at all;
//   - « Énigmes », a budget of 40 credits: one production fits (32 credits), the next is warned about;
//   - account 1 hits its usage limit on Wednesday evening: script turns (the expensive tier) wait for its reset, the cheap
//     work goes on on account 2;
//   - the app stops on Friday evening with runs in flight (a crash) and starts again on the same database.
// It prints the timeline and each slot's outcome, then checks: every slot has a ready kit before its time or an early
// warning; no duplicate task; budgets respected; Charlie asked only at his gates; no question in « tout automatique »;
// the restart was safe. Exit 0 = all hold. `--keep` keeps the temp folder.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCore } from '../src/main/core'
import { handleCall } from '../src/main/ipc'
import { ClaudeCodeProvider } from '../src/main/llm/claude-code'
import { FakeProvider } from '../src/main/llm/fake'
import { AccountProviders } from '../src/main/orchestra/providers'
import { fakeClaudeCli, scriptedReply, type FakeCliReply } from '../src/main/orchestra/fake-team'
import { slotLabel } from '../src/main/orchestra/plan'
import { MemoryProduction } from '../src/main/production/memory-port'
import type { ChannelGoalsInput } from '../src/shared/api/autopilot'
import type { OrchEvent } from '../src/shared/api/orchestra'

const KEEP = process.argv.includes('--keep')
const out = (s: string): void => void process.stdout.write(s + '\n')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** Monday 2 November 2026, 00:00 UTC, to Monday 9 November. */
const T0 = Date.parse('2026-11-02T00:00:00.000Z')
const END = T0 + 7 * DAY
const LIMIT_AT = Date.parse('2026-11-04T17:00:00.000Z')
const RESTART_AT = Date.parse('2026-11-06T18:00:00.000Z')
let now = T0
const dir = mkdtempSync(path.join(os.tmpdir(), 'atelier-orchestra-week-'))
const account2Dir = path.join(dir, 'claude-account-2')

// ---- the production port: in memory, kept across the restart (its runs stand for the database's) ---------------------
const port = new MemoryProduction(() => now)

/**
 * agents-production: a production step is done only once its video's run succeeded. The fake CLI has no tools (no MCP
 * bridge here), so the lead's production turn makes its run through the port, as `project.run` does in the app, and the
 * fake finishes it at once, booking its quote.
 */
function produce(prompt: string): void {
  const video = /^Brief: Planned step "production"[^\n]*?Video #(\d+)\./m.exec(prompt)?.[1]
  if (!video) return
  const req = { videoId: Number(video), mode: 'usage_max' as const }
  void port
    .listRuns({ videoId: req.videoId })
    .then(async (runs) => {
      if (runs.length) return
      const q = await port.quotePipeline(req)
      const run = await port.runPipeline(req, q.id)
      port.finish(run.id)
      // as a real run would, it books its quote (the month's budget counts it)
      const stored = port.runs.get(run.id)
      if (stored) stored.summary.credits = q.credits
    })
    .catch(() => undefined)
}

// ---- the fake CLI: account 1 hits its usage limit once on Wednesday evening, for 6 hours --------------------------
let limit: { at: number; until: number } | null = null
const cli = fakeClaudeCli((call): FakeCliReply => {
  if (call.configDir === null && limit === null && now >= LIMIT_AT) {
    limit = { at: now, until: now + 6 * HOUR }
    return { error: `Claude AI usage limit reached|${Math.floor(limit.until / 1000)}` }
  }
  produce(call.prompt)
  return { text: scriptedReply(call.system, call.prompt) }
})
const seams = { platform: process.platform, findBinary: () => (process.platform === 'win32' ? 'C:\\fake\\claude.exe' : '/fake/claude'), spawn: cli.spawn, killTree: cli.kill, exitWaitMs: 200 }

function boot() {
  const providers = new AccountProviders({ defaultClaudeCode: new ClaudeCodeProvider({ ...seams, env: { PATH: process.env.PATH ?? '' } }), anthropic: new FakeProvider(), claudeCode: seams })
  return createCore({
    paths: { userData: dir },
    cipher: { isAvailable: () => true, encrypt: (s) => new TextEncoder().encode(s), decrypt: (b) => new TextDecoder().decode(b) },
    now: () => new Date(now),
    production: port,
    orchestra: { providers: providers.factory, cronUtc: true }
  })
}

let core = boot()
const call = async <T>(m: string, ...args: unknown[]): Promise<T> => {
  const res = await handleCall(core.api, m, args)
  if (!res.ok) throw new Error(`${m}: ${res.error.message}`)
  return res.value as T
}

// ---- the workspace: three channels, their goals confirmed by Charlie ------------------------------------------------
const long = (day: number, time = '18:00') => ({ day, time, kind: 'long' as const })
const SETUP: { name: string; niche: string; goals: ChannelGoalsInput }[] = [
  { name: 'Histoire', niche: 'histoire racontée', goals: { slots: [long(1), long(3), long(5)], level: 'recommended', budgetCredits: 10_000 } },
  { name: 'Mystères', niche: 'mystères non résolus', goals: { slots: [{ day: 2, time: '12:00', kind: 'short' }, long(4), long(6)], level: 'all-auto', budgetCredits: 10_000 } },
  { name: 'Énigmes', niche: 'énigmes historiques', goals: { slots: [long(3), long(6, '12:00')], level: 'all-auto', budgetCredits: 40 } }
]
const channels: { id: number; name: string; gates: string[] }[] = []
for (const s of SETUP) {
  const row = await call<{ id: number }>('channels.create', { name: s.name, niche: s.niche })
  const g = await call<{ gates: string[] }>('autopilot.saveGoals', row.id, { ...s.goals, formats: [{ kind: 'long', minutes: 10, perWeek: s.goals.slots?.length ?? 1 }], confirm: true })
  channels.push({ id: row.id, name: s.name, gates: g.gates })
}
core.orchestra.saveAccount({ kind: 'claude-code', label: 'Claude Code · compte 2', configDir: account2Dir, priority: 1, maxConcurrent: 2 })
core.orchestra.saveAccount({ id: 1, kind: 'claude-code', label: 'Claude Code · compte 1', priority: 0, maxConcurrent: 2 })
/** Questions after this inbox id are the week's (the three « Objectifs proposés » came with the channels). */
const setupInbox = core.orchestra.inbox(true).reduce((m, i) => Math.max(m, i.id), 0)

// ---- the timeline ---------------------------------------------------------------------------------------------------
const SHOWN = new Set(['plan-warning', 'reminder', 'followup', 'recover', 'limit', 'failover', 'auto-approved', 'answer'])
const clockText = (at: number): string => slotLabel(at, true)
function listen(): void {
  core.orchestra.parts.events.listener = (e: OrchEvent) => {
    if (SHOWN.has(e.type) || (e.type === 'plan' && /kit prêt|lancé.*remise/.test(e.text))) out(`${clockText(Date.parse(e.at))}  ${e.type.padEnd(13)} ${e.text}`)
  }
}
out(`Atelier — a simulated week of the planner (fake CLI, fake production, simulated clock) — data in ${dir}`)
out(`Channels: ${channels.map((c) => `${c.name} (Charlie validates: ${c.gates.join(', ') || 'rien'})`).join(' · ')}`)
out('')
out('TIMELINE')
listen()

// ---- Charlie: answers each question 2 h after it came, except the first one of « Histoire » (30 h) --------------------
let ignored: number | null = null
const histoire = channels[0]!.id
function charlie(): void {
  const o = core.orchestra
  for (const item of o.inbox()) {
    if (item.kind === 'alert' || item.id <= setupInbox) continue
    const task = item.taskId !== null ? o.parts.queue.find(item.taskId) : null
    if (ignored === null && task?.channelId === histoire) ignored = item.id
    const wait = item.id === ignored ? 30 * HOUR : 2 * HOUR
    if (now - Date.parse(item.createdAt) >= wait) o.answer(item.id, { choice: item.options.includes('Valider') ? 'Valider' : item.options[0], text: 'OK' })
  }
}

const settle = (ms: number): Promise<void> => Promise.race([core.orchestra.supervisor.idle(), new Promise<void>((r) => setTimeout(r, ms))])
let restarted = false
let recovered = 0
while (now < END) {
  await core.orchestra.tick()
  if (!restarted && now >= RESTART_AT && core.orchestra.supervisor.running.size > 0) {
    // a crash in the middle of runs: nothing waits for them, the app is gone
    restarted = true
    const inFlight = core.orchestra.supervisor.running.size
    out(`${clockText(now)}  restart       the app stops with ${inFlight} run(s) in flight, then starts again on the same database`)
    core.close()
    core = boot()
    listen()
    recovered = (core.db.prepare(`SELECT COUNT(*) AS n FROM orch_events WHERE type = 'recover'`).get() as { n: number }).n
    continue
  }
  await settle(200)
  charlie()
  now += 15 * MIN
}
await core.orchestra.supervisor.idle()

// ---- outcomes -------------------------------------------------------------------------------------------------------
const o = core.orchestra
const db = core.db
interface SlotRow {
  channel_id: number
  slot_at: string
  status: string
}
const slots = db.prepare('SELECT channel_id, slot_at, status FROM orch_plan_slots WHERE slot_at >= ? AND slot_at < ? ORDER BY slot_at, channel_id').all(new Date(T0).toISOString(), new Date(END).toISOString()) as unknown as SlotRow[]
const kitAt = (s: SlotRow): string | null =>
  (db
    .prepare(`SELECT t.finished_at FROM orch_plan_steps st JOIN orch_tasks t ON t.id = st.task_id WHERE st.channel_id = ? AND st.slot_at = ? AND st.step = 'kit' AND t.status = 'done'`)
    .get(s.channel_id, s.slot_at) as { finished_at: string } | undefined)?.finished_at ?? null
const warnings = (s: SlotRow) => db.prepare('SELECT reason, text, created_at FROM orch_plan_warnings WHERE channel_id = ? AND slot_at = ? ORDER BY created_at').all(s.channel_id, s.slot_at) as { reason: string; text: string; created_at: string }[]
const nameOf = (id: number): string => channels.find((c) => c.id === id)?.name ?? `#${id}`

out('')
out('SLOTS OF THE WEEK')
const expected = SETUP.reduce((n, s) => n + (s.goals.slots?.length ?? 0), 0)
let covered = 0
for (const s of slots) {
  const kit = kitAt(s)
  const ready = kit !== null && kit <= s.slot_at
  const early = warnings(s).filter((w) => w.created_at < s.slot_at)
  if (ready || early.length) covered++
  const what = ready ? `kit prêt le ${clockText(Date.parse(kit as string))}` : early.length ? `prévenu le ${clockText(Date.parse(early[0]!.created_at))} (${early[0]!.reason}) : ${early[0]!.text}` : 'NI KIT NI AVERTISSEMENT'
  out(`  ${nameOf(s.channel_id).padEnd(9)} ${clockText(Date.parse(s.slot_at)).padEnd(18)} ${what}`)
}

// ---- checks ---------------------------------------------------------------------------------------------------------
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => void checks.push({ name, ok, detail })
const tasks = o.parts.queue.list({ limit: 1000 })
const planned = tasks.filter((t) => typeof (t.payload.plan as { step?: string } | undefined)?.step === 'string')

check('every slot: a ready kit or an early warning', slots.length === expected && covered === expected, `${covered}/${expected} slot(s) covered`)
const keys = planned.map((t) => `${t.channelId}|${(t.payload.plan as { slotAt: string }).slotAt}|${(t.payload.plan as { step: string }).step}`)
check('no duplicate task', new Set(keys).size === keys.length, `${planned.length} planned task(s), ${new Set(keys).size} distinct (channel, slot, step) keys`)
const spent = channels.map((c) => {
  const n = (db.prepare(`SELECT COALESCE(SUM(credits), 0) AS n FROM orch_plan_steps WHERE channel_id = ? AND step = 'production'`).get(c.id) as { n: number }).n
  return { c, n, budget: SETUP.find((s) => s.name === c.name)!.goals.budgetCredits ?? 0 }
})
const budgetWarned = slots.some((s) => s.channel_id === channels[2]!.id && warnings(s).some((w) => w.reason === 'budget'))
check('budgets respected', spent.every((x) => x.n <= x.budget) && budgetWarned, `${spent.map((x) => `${x.c.name} ${x.n}/${x.budget}`).join(', ')} crédits; Énigmes warned about its budget: ${budgetWarned}`)
const questions = o.inbox(true).filter((i) => i.kind !== 'alert' && i.id > setupInbox)
const offGate = questions.filter((q) => {
  const t = q.taskId !== null ? o.parts.queue.find(q.taskId) : null
  const gates = ((t?.payload.plan as { gates?: string[] } | undefined)?.gates ?? []) as string[]
  const ch = channels.find((c) => c.id === t?.channelId)
  return !ch || gates.length === 0 || !gates.every((g) => ch.gates.includes(g))
})
check('Charlie asked only at his gates', offGate.length === 0 && questions.length > 0, `${questions.length} question(s), ${offGate.length} outside his gates`)
const autoQuestions = questions.filter((q) => channels.slice(1).some((c) => c.id === (q.taskId !== null ? o.parts.queue.find(q.taskId)?.channelId : null)))
check('zero question in « tout automatique »', autoQuestions.length === 0, `${autoQuestions.length} question(s) from Mystères and Énigmes`)
const dead = tasks.filter((t) => t.status === 'dead')
check('restart safe', restarted && recovered >= 1 && dead.length === 0, `${recovered} recovery after the restart; ${dead.length} dead task(s); keys still unique`)
const reminders = db.prepare(`SELECT text FROM orch_events WHERE type = 'reminder'`).all() as { text: string }[]
check('one reminder for the question left 24 h', reminders.length === 1, reminders.map((e) => e.text).join(' ') || 'none')
const told = tasks.filter((t) => t.kind === 'followup')
check('the lead told about a stuck step', told.length >= 1, told.map((t) => t.title).join(' ; ') || 'none')
const lim = limit as { at: number; until: number } | null
const scriptsInLimit = lim ? planned.filter((t) => t.kind === 'script' && Date.parse(t.createdAt) >= lim.at && Date.parse(t.createdAt) < lim.until) : []
const startedInLimit = (kind: (k: string) => boolean): number =>
  lim ? tasks.filter((t) => kind(t.kind) && t.startedAt !== null && Date.parse(t.startedAt) >= lim.at && Date.parse(t.startedAt) < lim.until).length : 0
check(
  'expensive turns after the reset, cheap work first',
  lim !== null && scriptsInLimit.every((t) => t.notBefore !== null && Date.parse(t.notBefore) >= lim.until) && startedInLimit((k) => k === 'script') === 0 && startedInLimit((k) => k !== 'script') > 0,
  lim
    ? `account 1 limited ${clockText(lim.at)} → ${clockText(lim.until)}: ${scriptsInLimit.length} script(s) opened meanwhile, all after the reset; ${startedInLimit((k) => k !== 'script')} cheaper turn(s) ran meanwhile on account 2`
    : 'the limit never happened'
)

out('')
out(`TASKS: ${Object.entries(o.parts.queue.counts()).map(([k, v]) => `${v} ${k}`).join(', ')} · CLI calls: ${cli.calls.length}`)
out('')
out('CHECKS')
for (const c of checks) out(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`)
const failed = checks.filter((c) => !c.ok).length
out('')
out(failed === 0 ? `All ${checks.length} checks hold.` : `${failed} check(s) failed.`)
core.close()
if (!KEEP) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
process.exit(failed === 0 ? 0 : 1)
