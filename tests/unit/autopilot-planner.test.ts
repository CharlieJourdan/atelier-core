// agents-3 (A3): the planner and the heartbeat (docs/AGENT-RUNTIME.md §26). From a channel's confirmed goals, an hourly
// pass in code (no LLM) works each upcoming slot backwards (topic → approval → script → production → QC → thumbnail →
// kit ready), enqueues the next missing step for the lead once (a key per slot and step), checks the budget through the
// production port's quote, puts expensive turns after an account's reset, and warns early in the inbox when a slot will
// be missed. The heartbeat reminds Charlie once of a question left 24 h and tells the lead about a task stuck past its
// deadline. Fake providers, the fake production port and the fake clock only.
import { describe, expect, it } from 'vitest'
import type { ChannelGoalsInput } from '../../src/shared/api/autopilot'
import { MemoryProduction } from '../../src/main/production/memory-port'
import { FakeProvider } from '../../src/main/llm/fake'
import type { CallOptions, CompletionRequest, StreamEvent } from '../../src/main/llm/types'
import { scriptedResponder } from '../../src/main/orchestra/fake-team'
import { UnavailableProduction } from '../../src/main/production/port'
import { STEPS, deadlineOf, finishEstimate, opensAt, slotTimes } from '../../src/main/orchestra/plan'
import { T0, agentBySlug, drain, rig, type Rig } from './orchestra-helpers'

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Thursday 29 October 2026, 18:00 UTC: 82 h after T0. */
const THU = Date.parse('2026-10-29T18:00:00.000Z')

function goals(r: Rig, channelId: number, input: ChannelGoalsInput): void {
  r.core.orchestra.parts.goals.save(channelId, { slots: [{ day: 4, time: '18:00', kind: 'long' }], formats: [{ kind: 'long', minutes: 10, perWeek: 1 }], budgetCredits: 10_000, confirm: true, ...input })
}

const planTasks = (r: Rig, channelId: number) =>
  r.core.orchestra.parts.queue
    .list({ channelId, limit: 1000 })
    .filter((t) => typeof (t.payload.plan as { step?: string } | undefined)?.step === 'string')
    .sort((a, b) => a.id - b.id)
const stepOf = (t: { payload: Record<string, unknown> }): string => (t.payload.plan as { step: string }).step
const alerts = (r: Rig) => r.core.orchestra.inbox(true).filter((i) => i.kind === 'alert' && i.title.startsWith('Créneau menacé'))

/**
 * agents-production: the production step is done only once the video's run succeeded. The scripted team's production
 * turn makes that run through the port (as the lead's project tools do in the app) and the fake finishes it at once.
 */
class ProducingProvider extends FakeProvider {
  constructor(private readonly port: MemoryProduction) {
    super((req) => scriptedResponder(req))
  }
  override async *stream(req: CompletionRequest, opts?: CallOptions): AsyncGenerator<StreamEvent> {
    const video = /^Brief: Planned step "production"[^\n]*?Video #(\d+)\./m.exec(req.prompt)?.[1]
    if (video && (await this.port.listRuns({ videoId: Number(video) })).length === 0) {
      const q = await this.port.quotePipeline({ videoId: Number(video), mode: 'usage_max' })
      this.port.finish((await this.port.runPipeline({ videoId: Number(video), mode: 'usage_max' }, q.id)).id)
    }
    yield* super.stream(req, opts)
  }
}

function withPort(port = new MemoryProduction(() => Date.now())): Rig {
  return rig({ core: { production: port }, providerFor: () => new ProducingProvider(port) })
}

describe('the calendar, worked backwards (pure)', () => {
  it('weekly slots between two times, in UTC or local time', () => {
    const slots = [
      { day: 4, time: '18:00', kind: 'long' as const },
      { day: 1, time: '12:00', kind: 'short' as const }
    ]
    expect(slotTimes(slots, T0, T0 + 7 * DAY, true)).toEqual([
      { at: Date.parse('2026-10-26T12:00:00.000Z'), kind: 'short' },
      { at: THU, kind: 'long' }
    ])
    // Monday 08:00 → a slot that same Monday at 12:00 is in; one at 07:00 is not
    expect(slotTimes([{ day: 1, time: '07:00', kind: 'long' }], T0, T0 + DAY, true)).toEqual([])
  })

  it('each step has a deadline before the slot (half as far for a Short) and the chain is in order', () => {
    expect(STEPS.map((s) => s.step)).toEqual(['topic', 'approval', 'script', 'production', 'qc', 'thumbnail', 'kit'])
    expect(deadlineOf('kit', THU, 'long')).toBe(THU - 12 * HOUR)
    expect(deadlineOf('topic', THU, 'long')).toBe(THU - 96 * HOUR)
    expect(deadlineOf('topic', THU, 'short')).toBe(THU - 48 * HOUR)
    for (let i = 1; i < STEPS.length; i++) expect(deadlineOf(STEPS[i]!.step, THU, 'long')).toBeGreaterThan(deadlineOf(STEPS[i - 1]!.step, THU, 'long'))
    // the earliest finish of what is left: the sum of the steps' durations
    const left = STEPS.filter((s) => s.step !== 'approval')
    expect(finishEstimate(left, T0, 'long')).toBe(T0 + left.reduce((n, s) => n + s.hours, 0) * HOUR)
  })
})

describe('the planner turns confirmed goals into work', () => {
  it('nothing for goals Charlie has not confirmed; then the first step, once, with its video and deadline', async () => {
    const r = withPort()
    const ch = r.channels[0]!
    const o = r.core.orchestra
    r.core.orchestra.parts.goals.propose(ch, 'create')
    await o.tick()
    expect(planTasks(r, ch)).toHaveLength(0)

    goals(r, ch, {})
    r.clock.advance(HOUR)
    await o.tick()
    const tasks = planTasks(r, ch)
    expect(tasks).toHaveLength(1)
    const t = tasks[0]!
    const lead = agentBySlug(r, `lead-${ch}`)
    expect(t).toMatchObject({ kind: 'topics', assigneeId: lead.id, channelId: ch })
    expect(t.payload.plan).toMatchObject({ step: 'topic', slotAt: new Date(THU).toISOString(), deadline: new Date(THU - 96 * HOUR).toISOString() })
    expect(t.videoId).not.toBeNull()
    const video = r.core.db.prepare('SELECT channel_id, deadline, status FROM videos WHERE id = ?').get(t.videoId!) as { channel_id: number; deadline: string; status: string }
    expect(video).toEqual({ channel_id: ch, deadline: new Date(THU).toISOString(), status: 'idea' })

    // later passes (and a forced one) never enqueue the same step again
    for (let i = 0; i < 3; i++) {
      r.clock.advance(HOUR)
      await o.tick()
    }
    await o.planner.pass()
    expect(planTasks(r, ch)).toHaveLength(1)
  })

  it('a slot further than 5 days is on the plan (its video) but its work opens 5 days before (2,5 for a Short)', async () => {
    const r = withPort()
    const ch = r.channels[0]!
    const o = r.core.orchestra
    // Sunday 1 November 18:00: 5 days and 10 hours after T0
    const SUN = Date.parse('2026-11-01T18:00:00.000Z')
    goals(r, ch, { slots: [{ day: 7, time: '18:00', kind: 'long' }], level: 'all-auto' })
    expect(opensAt(SUN, 'long')).toBe(SUN - 120 * HOUR)
    expect(opensAt(SUN, 'short')).toBe(SUN - 60 * HOUR)
    await o.tick()
    expect(r.core.db.prepare('SELECT COUNT(*) AS n FROM orch_plan_slots WHERE channel_id = ?').get(ch)).toEqual({ n: 1 })
    expect(planTasks(r, ch)).toHaveLength(0)
    r.clock.set(SUN - 120 * HOUR)
    await o.tick()
    expect(planTasks(r, ch).map(stepOf)).toEqual(['topic'])
  })

  it('recommended level: topic → Charlie approves the topic → script; Charlie is asked only at his gates', async () => {
    const r = withPort()
    const ch = r.channels[0]!
    const o = r.core.orchestra
    goals(r, ch, { level: 'recommended' })
    await drain(r)
    // the topic is done; its approval is a task that asks Charlie with the gate `topic`
    const approval = planTasks(r, ch).find((t) => stepOf(t) === 'approval')!
    expect(approval.status).toBe('waiting_human')
    expect(approval.payload.brief).toContain('gate "topic"')
    const asked = o.inbox().filter((i) => i.kind === 'validate')
    expect(asked).toHaveLength(1)
    o.answer(asked[0]!.id, { choice: 'Valider' })
    await drain(r)
    const script = planTasks(r, ch).find((t) => stepOf(t) === 'script')!
    expect(script.status).toBe('done')
    // script, production and QC are not Charlie's gates here: their briefs say so and nobody asks; the thumbnail is
    expect(script.payload.brief).not.toContain('gate "script"')
    expect(script.payload.brief).toContain('No validation by Charlie')
    expect(planTasks(r, ch).map(stepOf)).toEqual(['topic', 'approval', 'script', 'production', 'qc', 'thumbnail'])
    const open = o.inbox().filter((i) => i.kind === 'validate')
    expect(open).toHaveLength(1)
    expect(open[0]!.taskId).toBe(planTasks(r, ch).find((t) => stepOf(t) === 'thumbnail')!.id)
  })

  it('« tout automatique »: no approval step, no question, the slot ends with a ready kit before its time', async () => {
    const r = withPort()
    const ch = r.channels[0]!
    const o = r.core.orchestra
    goals(r, ch, { level: 'all-auto' })
    for (let i = 0; i < 12; i++) {
      await drain(r)
      r.clock.advance(HOUR)
    }
    const steps = planTasks(r, ch).map(stepOf)
    expect(steps).toEqual(['topic', 'script', 'production', 'qc', 'thumbnail', 'kit'])
    expect(planTasks(r, ch).every((t) => t.status === 'done')).toBe(true)
    expect(o.inbox(true).filter((i) => i.kind !== 'alert' && !i.title.startsWith('Objectifs'))).toHaveLength(0)
    expect(alerts(r)).toHaveLength(0)
    const slot = r.core.db.prepare('SELECT status, video_id FROM orch_plan_slots WHERE channel_id = ?').get(ch) as { status: string; video_id: number }
    expect(slot.status).toBe('ready')
    expect((r.core.db.prepare('SELECT status FROM videos WHERE id = ?').get(slot.video_id) as { status: string }).status).toBe('ready')
    expect(r.clock.now()).toBeLessThan(THU)
  })

  it('budget: the production quote does not fit what is left this month → no production, one early warning with the numbers', async () => {
    const port = new MemoryProduction(() => Date.now())
    const r = withPort(port)
    const ch = r.channels[0]!
    // a 32-credit quote (usage_max) against a 20-credit month
    goals(r, ch, { level: 'all-auto', budgetCredits: 20 })
    for (let i = 0; i < 6; i++) {
      await drain(r)
      r.clock.advance(HOUR)
    }
    expect(planTasks(r, ch).map(stepOf)).toEqual(['topic', 'script'])
    expect(port.calls.filter((c) => c.startsWith('quotePipeline')).length).toBeGreaterThan(0)
    expect(port.calls.some((c) => c.startsWith('runPipeline'))).toBe(false)
    const a = alerts(r)
    expect(a).toHaveLength(1)
    expect(a[0]!.body).toMatch(/budget/i)
    expect(a[0]!.body).toContain('32')
    expect(a[0]!.body).toContain('20')
  })

  it('production not wired (a port that is not): the team prepares topic and script, then one honest warning', async () => {
    // agents-production: the app's own port is wired now (AppProduction); the unwired port keeps its honest warning
    const r = rig({ core: { production: new UnavailableProduction() } })
    const ch = r.channels[0]!
    goals(r, ch, { level: 'all-auto' })
    for (let i = 0; i < 6; i++) {
      await drain(r)
      r.clock.advance(HOUR)
    }
    expect(planTasks(r, ch).map(stepOf)).toEqual(['topic', 'script'])
    const a = alerts(r)
    expect(a).toHaveLength(1)
    expect(a[0]!.body).toMatch(/production n.est pas encore branchée/)
  })

  it('a slot too close to be made: an early warning that says which step and why', async () => {
    const r = withPort()
    const ch = r.channels[0]!
    // Monday 08:00, a slot Monday 19:00: 11 h for a chain of 12 h
    goals(r, ch, { slots: [{ day: 1, time: '19:00', kind: 'long' }], level: 'all-auto' })
    await r.core.orchestra.tick()
    const a = alerts(r)
    expect(a).toHaveLength(1)
    expect(a[0]!.body).toMatch(/sujet/)
    expect(a[0]!.body).toMatch(/après le créneau/)
    // the team still tries: the topic is queued
    expect(planTasks(r, ch).map(stepOf)).toEqual(['topic'])
  })

  it('an account at its limit: the expensive script turn waits for the reset; cheap work goes now', async () => {
    const r = withPort()
    const ch = r.channels[0]!
    const o = r.core.orchestra
    goals(r, ch, { level: 'all-auto' })
    await o.tick({ wait: true }) // the topic opened and done; the script is not opened yet
    expect(planTasks(r, ch).map(stepOf)).toEqual(['topic'])
    const reset = r.clock.now() + 5 * HOUR
    for (const a of o.parts.accounts.list()) o.parts.accounts.markLimited(a.id, { kind: 'usage', until: reset, note: 'test' })
    r.clock.advance(HOUR)
    await o.tick()
    const script = planTasks(r, ch).find((t) => stepOf(t) === 'script')!
    expect(script.notBefore).toBe(new Date(reset).toISOString())
  })

  it('a step that died: a warning, never a loop of new tasks', async () => {
    const r = withPort()
    const ch = r.channels[0]!
    const o = r.core.orchestra
    goals(r, ch, { level: 'all-auto' })
    await o.tick()
    const topic = planTasks(r, ch)[0]!
    o.parts.queue.cancel(topic.id)
    r.clock.advance(HOUR)
    await o.tick()
    r.clock.advance(HOUR)
    await o.tick()
    expect(planTasks(r, ch)).toHaveLength(1)
    expect(alerts(r)).toHaveLength(1)
    expect(alerts(r)[0]!.body).toMatch(/annulée|échoué/)
  })
})

describe('the heartbeat follows up stale threads', () => {
  it('a question unanswered for 24 h: one reminder, never two', async () => {
    const r = rig()
    const o = r.core.orchestra
    const lead = agentBySlug(r, `lead-${r.channels[0]}`)
    const item = o.parts.inbox.add({ taskId: null, agentId: lead.id, kind: 'validate', title: 'Valider le sujet', body: '?', options: ['Oui', 'Non'] })
    r.clock.advance(23 * HOUR)
    await o.tick()
    const reminders = () => o.events(0, 1000).filter((e) => e.type === 'reminder')
    expect(reminders()).toHaveLength(0)
    r.clock.advance(2 * HOUR)
    await o.tick()
    r.clock.advance(5 * HOUR)
    await o.tick()
    expect(reminders()).toHaveLength(1)
    expect(reminders()[0]!.text).toContain('Valider le sujet')
    const row = r.core.db.prepare('SELECT reminded_at FROM orch_inbox WHERE id = ?').get(item.id) as { reminded_at: string | null }
    expect(row.reminded_at).not.toBeNull()
  })

  it('a planned task stuck waiting past its deadline: the lead is told once', async () => {
    const r = withPort()
    const ch = r.channels[0]!
    const o = r.core.orchestra
    goals(r, ch, { level: 'recommended' })
    await drain(r) // the approval waits for Charlie
    const approval = planTasks(r, ch).find((t) => stepOf(t) === 'approval')!
    expect(approval.status).toBe('waiting_human')
    // its deadline (84 h before the slot) was already past when it opened: it is due 12 h (its duration) after that
    const deadline = Date.parse((approval.payload.plan as { deadline: string }).deadline)
    expect(deadline).toBeLessThan(Date.parse(approval.createdAt))
    const lead = agentBySlug(r, `lead-${ch}`)
    r.clock.set(Date.parse(approval.createdAt) + 11 * HOUR)
    await o.tick()
    expect(o.parts.queue.list({ assigneeId: lead.id, kind: 'followup' })).toHaveLength(0)
    r.clock.set(Date.parse(approval.createdAt) + 13 * HOUR)
    await o.tick()
    r.clock.advance(HOUR)
    await o.tick()
    const told = o.parts.queue.list({ assigneeId: lead.id, kind: 'followup' })
    expect(told).toHaveLength(1)
    expect(told[0]!.title).toContain(`#${approval.id}`)
  })
})

describe('review fixes: the loop stays safe around the planner', () => {
  it('a stop while the proactive work awaits (a quote): the pass starts no turn', async () => {
    const r = withPort()
    const o = r.core.orchestra
    const lead = agentBySlug(r, `lead-${r.channels[0]}`)
    o.parts.queue.enqueue({ kind: 'task', title: 'Une tâche prête', assigneeId: lead.id })
    let release: () => void = () => undefined
    o.supervisor.proactive = () => new Promise<number>((res) => (release = () => res(0)))
    const pass = o.tick()
    await new Promise((res) => setImmediate(res))
    o.power.stop()
    release()
    const result = await pass
    expect(result.started).toBe(0)
    expect(o.parts.queue.list({ status: ['leased', 'running'] })).toHaveLength(0)
  })

  it('a port call that never answers: the pass ends (timeout) and says so, the loop goes on', async () => {
    const port = new MemoryProduction(() => Date.now())
    port.quotePipeline = () => new Promise(() => undefined)
    const r = withPort(port)
    const ch = r.channels[0]!
    r.core.orchestra.planner.portTimeoutMs = 30
    goals(r, ch, { level: 'all-auto' })
    for (let i = 0; i < 4; i++) {
      await drain(r)
      r.clock.advance(HOUR)
    }
    expect(planTasks(r, ch).map(stepOf)).toEqual(['topic', 'script'])
    expect(alerts(r)).toHaveLength(1)
    expect(alerts(r)[0]!.body).toMatch(/Pas de devis/)
  })

  it('Charlie moves a slot: the old one is retired (its open step cancelled, its video too), the new one planned', async () => {
    const r = withPort()
    const ch = r.channels[0]!
    const o = r.core.orchestra
    goals(r, ch, { level: 'all-auto' })
    await o.tick()
    const old = planTasks(r, ch)[0]!
    o.parts.goals.save(ch, { slots: [{ day: 4, time: '19:00', kind: 'long' }] })
    r.clock.advance(HOUR)
    await o.tick()
    expect(o.parts.queue.get(old.id).status === 'cancelled' || o.parts.queue.get(old.id).status === 'done').toBe(true)
    const rows = r.core.db.prepare('SELECT slot_at, status FROM orch_plan_slots WHERE channel_id = ? ORDER BY slot_at').all(ch) as { slot_at: string; status: string }[]
    expect(rows).toEqual([
      { slot_at: new Date(THU).toISOString(), status: 'retired' },
      { slot_at: new Date(THU + HOUR).toISOString(), status: 'planned' }
    ])
    expect((r.core.db.prepare('SELECT status FROM videos WHERE id = ?').get(old.videoId!) as { status: string }).status).toBe('cancelled')
    // a later pass leaves the retired slot alone
    r.clock.advance(HOUR)
    await o.tick()
    expect(planTasks(r, ch).filter((t) => (t.payload.plan as { slotAt: string }).slotAt === new Date(THU).toISOString())).toHaveLength(1)
  })

  it('a cancelled production gives its quote back to the month', async () => {
    const r = withPort()
    const ch = r.channels[0]!
    const o = r.core.orchestra
    // two slots, 40 credits: one 32-credit production at a time
    goals(r, ch, { slots: [{ day: 4, time: '18:00', kind: 'long' }, { day: 5, time: '18:00', kind: 'long' }], level: 'all-auto', budgetCredits: 40 })
    // let the work reach production, then pause the lead before the production turn starts: it stays queued
    const lead = agentBySlug(r, `lead-${ch}`)
    const proactive = o.supervisor.proactive!
    o.supervisor.proactive = async () => {
      const n = await proactive()
      if (planTasks(r, ch).some((t) => stepOf(t) === 'production')) o.parts.tree.update(lead.id, { paused: true })
      return n
    }
    for (let i = 0; i < 3; i++) {
      await drain(r)
      r.clock.advance(HOUR)
    }
    let prod = planTasks(r, ch).filter((t) => stepOf(t) === 'production')
    expect(prod).toHaveLength(1)
    expect(prod[0]!.status).toBe('queued')
    // the first production is cancelled before it runs: its 32 credits are free again for the second slot
    o.parts.queue.cancel(prod[0]!.id)
    o.supervisor.proactive = proactive
    o.parts.tree.update(lead.id, { paused: false })
    for (let i = 0; i < 4; i++) {
      await drain(r)
      r.clock.advance(HOUR)
    }
    prod = planTasks(r, ch).filter((t) => stepOf(t) === 'production')
    expect(prod.map((t) => t.status)).toEqual(['cancelled', 'done'])
    expect(alerts(r).some((a) => /Budget/.test(a.body))).toBe(false)
  })

  it('one channel that fails does not stop the others', async () => {
    const r = withPort()
    const [a, b] = r.channels as [number, number]
    const o = r.core.orchestra
    goals(r, a, { level: 'all-auto' })
    goals(r, b, { level: 'all-auto' })
    const get = o.parts.goals.get.bind(o.parts.goals)
    o.parts.goals.get = (id: number) => {
      if (id === a) throw new Error('broken channel')
      return get(id)
    }
    await o.tick()
    expect(planTasks(r, b).map(stepOf)).toEqual(['topic'])
    expect(o.events(0, 500).some((e) => e.type === 'error' && e.text.includes('broken channel'))).toBe(true)
  })
})
