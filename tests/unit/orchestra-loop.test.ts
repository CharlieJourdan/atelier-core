// Agent runtime: routines (cron), wake-ups on @mentions in the chat (bounded depth), human in the loop (inbox →
// answer → the task resumes), cancel, pause, the global concurrency limit and the daily digest.
import { describe, expect, it } from 'vitest'
import { FakeProvider } from '../../src/main/llm/fake'
import { MAX_MENTION_DEPTH } from '../../src/main/orchestra/messaging'
import { Cron } from '../../src/main/orchestra/routines'
import { scriptedResponder } from '../../src/main/orchestra/fake-team'
import { agentBySlug, drain, rig, T0 } from './orchestra-helpers'

describe('cron', () => {
  const at = (s: string) => Date.parse(s)
  it('computes the next run (UTC): every morning, every Monday, steps, lists, ranges, day OR weekday', () => {
    expect(new Date(Cron.parse('0 7 * * *').next(at('2026-10-26T08:00:00Z'), true)).toISOString()).toBe('2026-10-27T07:00:00.000Z')
    expect(new Date(Cron.parse('0 9 * * 1').next(at('2026-10-26T08:00:00Z'), true)).toISOString()).toBe('2026-10-26T09:00:00.000Z')
    expect(new Date(Cron.parse('0 9 * * 1').next(at('2026-10-26T09:00:00Z'), true)).toISOString()).toBe('2026-11-02T09:00:00.000Z')
    expect(new Date(Cron.parse('*/15 * * * *').next(at('2026-10-26T08:07:30Z'), true)).toISOString()).toBe('2026-10-26T08:15:00.000Z')
    expect(new Date(Cron.parse('30 8-10/2 * * 1-5').next(at('2026-10-31T12:00:00Z'), true)).toISOString()).toBe('2026-11-02T08:30:00.000Z')
    expect(new Date(Cron.parse('0 0 1 * 0').next(at('2026-10-26T00:00:00Z'), true)).toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(new Date(Cron.parse('0 12 29 2 *').next(at('2026-03-01T00:00:00Z'), true)).toISOString()).toBe('2028-02-29T12:00:00.000Z')
    expect(Cron.parse('0 0 * * 7').next(at('2026-10-26T00:00:00Z'), true)).toBe(at('2026-11-01T00:00:00Z'))
    for (const bad of ['', '* * * *', '60 * * * *', '* 24 * * *', '5-1 * * * *', 'a * * * *', '*/0 * * * *']) expect(() => Cron.parse(bad), bad).toThrow()
  })
})

describe('routines', () => {
  it('fire when due (ideas every Monday 09:00), once per open task, and follow their schedule; off = never', async () => {
    const r = rig()
    const o = r.core.orchestra
    const routines = o.routines()
    const ideas = routines.filter((x) => x.kind === 'topics')
    expect(ideas.map((x) => x.nextRunAt)).toEqual(['2026-10-26T09:00:00.000Z', '2026-10-26T09:00:00.000Z'])
    o.toggleRoutine(ideas[1]!.id, false)
    expect((await o.tick()).routines).toBe(0)
    r.clock.set(Date.parse('2026-10-26T09:00:30Z'))
    const res = await o.tick({ wait: true })
    expect(res.routines).toBe(1)
    const fired = o.tasks({ kind: 'topics' })
    expect(fired).toHaveLength(1)
    expect(fired[0]).toMatchObject({ assigneeId: ideas[0]!.agentId, routineId: ideas[0]!.id, title: "Next week's topics" })
    expect(o.routines().find((x) => x.id === ideas[0]!.id)).toMatchObject({ nextRunAt: '2026-11-02T09:00:00.000Z', lastRunAt: '2026-10-26T09:00:30.000Z' })
    await drain(r)
    expect(o.tasks({ kind: 'topics' })[0]!.status).toBe('done')
    // the competitor scan of every channel fires the next morning; the digest at 08:00 posts in the Supervisor chat
    r.clock.set(Date.parse('2026-10-27T08:00:10Z'))
    const next = await o.tick({ wait: true })
    expect(next.routines).toBe(3) // 2 competitor scans (07:00, overdue) + the digest (08:00)
    await drain(r)
    const digest = o.tasks({ kind: 'digest' })[0]!
    expect(digest.status).toBe('done')
    const sup = r.core.chat.store.open({ kind: 'supervisor' })
    expect(r.core.chat.store.messages(sup.id).some((m) => m.authorId === 'orch:principal' && m.body.includes('Digest'))).toBe(true)
  })

  it('skips a routine while its previous task is still open', async () => {
    const r = rig({ providerFor: () => new FakeProvider(() => ({ text: '', error: 'boom' })) })
    const o = r.core.orchestra
    r.clock.set(Date.parse('2026-10-26T09:00:30Z'))
    await o.tick({ wait: true })
    expect(o.tasks({ kind: 'topics' })).toHaveLength(2)
    r.clock.set(Date.parse('2026-11-02T09:00:30Z'))
    await o.tick({ wait: true })
    // the daily routines fired, but no second "ideas" task while the first ones are still being retried
    expect(o.tasks({ kind: 'topics' })).toHaveLength(2)
    expect(o.events(0, 1000).some((e) => e.type === 'routine' && e.text.includes('still open'))).toBe(true)
  })
})

describe('wake on mention', () => {
  it('an @mention in a channel conversation wakes the agent, which answers in the same conversation', async () => {
    const r = rig()
    const o = r.core.orchestra
    const chat = r.core.chat.store
    const researcher = agentBySlug(r, `researcher-${r.channels[0]}`)
    expect(o.agents().find((a) => a.id === researcher.id)?.status).toBe('sleeping')
    const conv = chat.open({ kind: 'channel', channelId: r.channels[0]! })
    chat.post(conv.id, { authorType: 'owner', body: 'Hello @Recherchiste_Histoire, tu peux regarder le vol 19 ?' })
    const woken = o.tasks({ kind: 'mention' })
    expect(woken).toHaveLength(1)
    expect(woken[0]).toMatchObject({ assigneeId: researcher.id, channelId: r.channels[0], payload: { depth: 0, conversationId: conv.id } })
    expect(o.agents().find((a) => a.id === researcher.id)?.status).toBe('idle')
    await o.tick({ wait: true })
    const last = chat.messages(conv.id).at(-1)!
    expect(last).toMatchObject({ authorType: 'agent', authorId: `orch:${researcher.slug}` })
    expect(last.body).toContain('Message reçu')
    expect(o.agents().find((a) => a.id === researcher.id)?.status).toBe('sleeping')
  })

  it('agents waking each other stop at the depth limit (no infinite loop)', async () => {
    const r = rig({
      providerFor: () =>
        new FakeProvider((req) => {
          // two agents that always mention each other
          const other = req.system?.includes('Recherchiste') ? '@Scénariste_Histoire' : '@Recherchiste_Histoire'
          return `${other} à toi !`
        })
    })
    const o = r.core.orchestra
    const chat = r.core.chat.store
    const conv = chat.open({ kind: 'channel', channelId: r.channels[0]! })
    chat.post(conv.id, { authorType: 'owner', body: '@Recherchiste_Histoire démarre' })
    await drain(r, 20)
    const mentions = o.tasks({ kind: 'mention', limit: 100 })
    expect(mentions.length).toBe(MAX_MENTION_DEPTH + 1)
    expect(Math.max(...mentions.map((t) => Number(t.payload.depth)))).toBe(MAX_MENTION_DEPTH)
    expect(o.events(0, 1000).some((e) => e.type === 'mention' && e.text.includes('not followed'))).toBe(true)
  })
})

describe('human in the loop', () => {
  it('a task asks Charlie to validate: waiting_human + inbox item; the answer resumes it', async () => {
    const r = rig()
    const o = r.core.orchestra
    const principal = agentBySlug(r, 'principal')
    const root = o.enqueue({ assigneeId: principal.id, kind: 'plan', title: 'Sujets', brief: 'Sujets de la semaine [validate]' })
    await drain(r)
    expect(o.parts.queue.get(root.id)).toMatchObject({ status: 'waiting_human', waitReason: 'human' })
    expect(o.agents().find((a) => a.id === principal.id)?.status).toBe('waiting')
    const [item] = o.inbox()
    expect(item).toMatchObject({ kind: 'validate', taskId: root.id, options: ['Valider', 'Revoir'], status: 'open' })
    expect(o.status().openInbox).toBe(1)
    expect(() => o.answer(item!.id, { choice: 'Peut-être' })).toThrow(/options/)
    expect(() => o.answer(item!.id, {})).toThrow(/vide/)
    const answered = o.answer(item!.id, { choice: 'Valider', text: 'parfait' })
    expect(answered).toMatchObject({ status: 'answered', answer: { choice: 'Valider', text: 'parfait' } })
    expect(() => o.answer(item!.id, { choice: 'Valider' })).toThrow(/déjà reçu une réponse/)
    expect(o.parts.queue.get(root.id)).toMatchObject({ status: 'queued', attempts: 0 })
    await drain(r)
    const done = o.parts.queue.get(root.id)
    expect(done.status).toBe('done')
    expect(done.result).toContain('Plan de la semaine')
    expect(done.payload.human).toEqual([{ question: 'Valider les sujets de la semaine prochaine ?', choice: 'Valider', text: 'parfait' }])
  })
})

describe('budgets', () => {
  it('an agent past its monthly budget waits (no call) and the user is told; the ledger caps park tasks too', async () => {
    let calls = 0
    const r = rig({ providerFor: () => new FakeProvider((req) => (calls++, scriptedResponder(req))) })
    const o = r.core.orchestra
    const a = agentBySlug(r, `researcher-${r.channels[0]}`)
    o.updateAgent(a.id, { budgetUsdMonth: 0 })
    const t = o.enqueue({ assigneeId: a.id, kind: 'research', title: 'x' })
    await o.tick({ wait: true })
    expect(calls).toBe(0)
    expect(o.parts.queue.get(t.id)).toMatchObject({ status: 'waiting', waitReason: 'budget', attempts: 0, notBefore: '2026-11-01T00:00:00.000Z' })
    expect(o.inbox().some((i) => i.kind === 'alert' && i.title.includes(a.name))).toBe(true)
    // the global cap of the ledger (Réglages › Budget) refuses the reservation: same wait, nothing booked
    r.core.context.settings.set('budget.globalMonthlyUsd', 0)
    const b = agentBySlug(r, `scriptwriter-${r.channels[0]}`)
    const t2 = o.enqueue({ assigneeId: b.id, kind: 'script', title: 'y' })
    await o.tick({ wait: true })
    expect(calls).toBe(0)
    expect(o.parts.queue.get(t2.id)).toMatchObject({ status: 'waiting', waitReason: 'budget' })
    expect((r.core.db.prepare('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }).n).toBe(0)
  })
})

describe('control', () => {
  it('cancel stops a task and its open sub-tasks (handoffs closed); pause keeps an agent’s tasks waiting', async () => {
    const r = rig()
    const o = r.core.orchestra
    const lead = agentBySlug(r, `lead-${r.channels[0]}`)
    const t = o.enqueue({ assigneeId: lead.id, kind: 'topics', title: 'Sujets' })
    await o.tick({ wait: true })
    const [child] = o.tasks({ parentId: t.id })
    expect(child?.status).toBe('queued')
    const cancelled = o.cancelTask(t.id)
    expect(cancelled.status).toBe('cancelled')
    expect(o.parts.queue.get(child!.id).status).toBe('cancelled')
    expect(() => o.retryTask(child!.id)).not.toThrow()
    const researcher = agentBySlug(r, `researcher-${r.channels[0]}`)
    o.updateAgent(researcher.id, { paused: true })
    await o.tick({ wait: true })
    expect(o.parts.queue.get(child!.id).status).toBe('queued')
    o.updateAgent(researcher.id, { paused: false })
    await o.tick({ wait: true })
    expect(o.parts.queue.get(child!.id).status).toBe('done')
  })

  it('never runs more than orchestra.maxConcurrent turns at once, nor two tasks of one agent', async () => {
    let live = 0
    let peak = 0
    const r = rig({
      providerFor: () =>
        new FakeProvider((req) => {
          live++
          peak = Math.max(peak, live)
          queueMicrotask(() => live--)
          return scriptedResponder(req)
        })
    })
    const o = r.core.orchestra
    o.saveAccount({ kind: 'claude-code', label: 'Compte 2', configDir: 'C:\\two', maxConcurrent: 4 })
    r.core.context.settings.set('orchestra.maxConcurrent', 3)
    const ch = r.channels[0]
    for (const slug of [`researcher-${ch}`, `researcher-${ch}`, `scriptwriter-${ch}`, `packaging-${ch}`, `director-${ch}`]) {
      o.enqueue({ assigneeId: agentBySlug(r, slug).id, kind: 'task', title: slug })
    }
    const first = await o.tick()
    expect(first.started).toBe(3)
    expect(o.supervisor.running.size).toBe(3)
    const agentsRunning = [...o.supervisor.running.values()].map((h) => h.agentId)
    expect(new Set(agentsRunning).size).toBe(3)
    await o.supervisor.idle()
    await drain(r)
    expect(o.tasks().every((t) => t.status === 'done')).toBe(true)
    expect(T0).toBeGreaterThan(0)
  })
})
