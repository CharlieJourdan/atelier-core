// Agent runtime: the seeded tree, delegation principal → leads → researchers, the parent auto-bump, the handoff cards
// in the channel conversations, memory written by the agents, and the ledger entries carrying the account.
import { describe, expect, it } from 'vitest'
import { FakeProvider } from '../../src/main/llm/fake'
import { agentBySlug, drain, rig } from './orchestra-helpers'

describe('agent tree', () => {
  it('seeds principal → one lead per channel → specialists, idempotently, with the default routines', () => {
    const r = rig()
    const o = r.core.orchestra
    const tree = o.tree()
    expect(tree).toHaveLength(1)
    const principal = tree[0]!
    expect(principal.agent.slug).toBe('principal')
    const leads = principal.children.filter((c) => c.agent.role === 'channel_lead')
    expect(leads.map((l) => l.agent.channelId)).toEqual(r.channels)
    expect(principal.children.map((c) => c.agent.role)).toContain('pipeline_architect')
    const lead = leads[0]!
    expect(lead.children.map((c) => c.agent.role).sort()).toEqual(
      ['competitor_analyst', 'production_supervisor', 'publisher', 'qc_eye', 'researcher', 'sponsor_manager'].sort()
    )
    const sup = lead.children.find((c) => c.agent.role === 'production_supervisor')!
    expect(sup.children.map((c) => c.agent.role)).toEqual(['scriptwriter', 'packaging', 'director', 'video_producer'])
    // existing roles keep their registry names; runtime roles get theirs; channel agents are named with the channel
    expect(sup.children[3]!.agent.name).toBe('Monteur · Histoire')
    expect(lead.agent.name).toBe('Responsable de chaîne · Histoire')
    const count = o.agents().length
    expect(count).toBe(1 + 1 + 2 * (1 + 6 + 4))
    o.seed()
    expect(o.agents()).toHaveLength(count)
    const routines = o.routines()
    expect(routines.map((x) => x.kind).sort()).toEqual(['competitor_scan', 'competitor_scan', 'digest', 'topics', 'topics'])
    // every agent sleeps: nothing to do, no tokens
    expect(o.agents().every((a) => a.status === 'sleeping')).toBe(true)
  })

  it('creates agents on demand under a parent, with a custom role and instructions', () => {
    const r = rig()
    const o = r.core.orchestra
    const lead = agentBySlug(r, `lead-${r.channels[0]}`)
    const a = o.createAgent({ name: 'Chasseur de Shorts', role: 'shorts hunter', parentId: lead.id, instructions: 'Find Shorts angles.' })
    expect(a).toMatchObject({ role: 'shorts_hunter', parentId: lead.id, channelId: r.channels[0], custom: true, instructions: 'Find Shorts angles.' })
    expect(a.slug).toBe('chasseur-de-shorts')
    expect(() => o.createAgent({ name: 'Chasseur de Shorts', role: 'x', parentId: lead.id })).toThrow(/already called/)
    expect(() => o.createAgent({ name: 'X', role: '', parentId: lead.id })).toThrow(/Invalid role/)
    expect(() => o.updateAgent(a.id, { policy: { tier: 'huge' as never } })).toThrow(/Unknown tier/)
    expect(o.updateAgent(a.id, { paused: true }).status).toBe('paused')
  })
})

describe('delegation and auto-bump', () => {
  it('principal → leads → researchers, each parent woken with its reports’ results, then done', async () => {
    const r = rig()
    const o = r.core.orchestra
    const principal = agentBySlug(r, 'principal')
    const root = o.enqueue({ assigneeId: principal.id, kind: 'plan', title: 'Produire les sujets de la semaine prochaine' })
    await drain(r)
    const all = o.tasks({ limit: 100 })
    const leads = all.filter((t) => t.parentId === root.id)
    expect(leads).toHaveLength(2)
    const researches = all.filter((t) => leads.some((l) => l.id === t.parentId))
    expect(researches).toHaveLength(2)
    expect(researches.every((t) => t.kind === 'research' && t.status === 'done')).toBe(true)
    expect(leads.every((t) => t.status === 'done' && t.bumps === 1)).toBe(true)
    const done = o.tasks({ status: ['done'] }).find((t) => t.id === root.id)!
    expect(done.bumps).toBe(1)
    expect(done.result).toContain('Plan de la semaine')
    // the lead saw its researcher's topics in its second turn
    expect(leads[0]!.result).toMatch(/vol 19/)
    // handoff cards in each channel conversation, answered with the sub-task's result
    const chat = r.core.chat.store
    for (const ch of r.channels) {
      const conv = chat.open({ kind: 'channel', channelId: ch })
      const cards = chat.messages(conv.id).filter((m) => m.card?.type === 'handoff')
      expect(cards.length).toBeGreaterThanOrEqual(2)
      expect(cards.every((m) => m.card?.type === 'handoff' && m.card.state === 'answered')).toBe(true)
    }
    // memory written by the agents (remember actions)
    expect(o.memory(principal.id).some((m) => m.content.includes('Week planning'))).toBe(true)
    expect(o.memory(agentBySlug(r, `researcher-${r.channels[0]}`).id)[0]?.source).toMatch(/^task:\d+$/)
    // every call went through the ledger, attributed to the account and the runtime task
    const rows = r.core.db.prepare('SELECT provider_id, account_id, orch_task_id, status FROM ledger').all() as { provider_id: string; account_id: number; orch_task_id: number; status: string }[]
    expect(rows).toHaveLength(2 + 2 * 2 + 2) // principal ×2, leads ×2 each, researchers ×1 each
    expect(rows.every((x) => x.provider_id === 'claude-code' && x.account_id === 1 && x.orch_task_id > 0 && x.status === 'settled')).toBe(true)
    expect(o.agents().every((a) => a.status === 'sleeping')).toBe(true)
  })

  it('refuses a delegation to an agent outside the delegator’s branch (warning, the task still finishes)', async () => {
    const r = rig({
      providerFor: () =>
        new FakeProvider(() => 'ok\n```atelier\n{"actions":[{"type":"delegate","to":"principal","title":"do my job"}]}\n```')
    })
    const o = r.core.orchestra
    const researcher = agentBySlug(r, `researcher-${r.channels[0]}`)
    const t = o.enqueue({ assigneeId: researcher.id, kind: 'research', title: 'x' })
    await drain(r)
    expect(o.tasks().find((x) => x.id === t.id)?.status).toBe('done')
    expect(o.events(0, 1000).some((e) => e.type === 'warning' && e.text.includes('Cannot delegate to principal'))).toBe(true)
  })

  it('runs a task only once its dependencies finished', async () => {
    const r = rig()
    const o = r.core.orchestra
    const q = o.parts.queue
    const a = agentBySlug(r, `researcher-${r.channels[0]}`)
    const b = agentBySlug(r, `scriptwriter-${r.channels[0]}`)
    const first = q.enqueue({ kind: 'research', title: 'facts', assigneeId: a.id })
    const second = q.enqueue({ kind: 'script', title: 'script', assigneeId: b.id, dependsOn: [first.id] })
    expect(q.runnable().map((t) => t.id)).toEqual([first.id])
    await o.tick({ wait: true })
    expect(q.get(first.id).status).toBe('done')
    expect(q.runnable().map((t) => t.id)).toEqual([second.id])
    await o.tick({ wait: true })
    expect(q.get(second.id).status).toBe('done')
  })
})
