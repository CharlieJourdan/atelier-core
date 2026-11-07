// IPC module "orchestra": every method, listed one by one, and the handlers through the real `atelier:call` dispatcher
// (argument checks, errors as envelopes), on an in-memory core with fake account providers.
import { describe, expect, it } from 'vitest'
import { API_METHODS } from '../../src/shared/api'
import { ORCHESTRA_METHODS } from '../../src/shared/api/orchestra'
import { handleCall } from '../../src/main/ipc'
import { agentBySlug, rig } from './orchestra-helpers'

describe('orchestra IPC', () => {
  it('lists its 29 methods, all in the contract', () => {
    expect([...ORCHESTRA_METHODS]).toEqual([
      'orchestra.status', // loop on/off, running, task counts, accounts ready/limited, when work resumes, open inbox
      'orchestra.tree', // principal → leads → specialists, with status, current task, load, spend
      'orchestra.agents', // the same, flat
      'orchestra.seed', // seeds the hierarchy and its routines (idempotent)
      'orchestra.createAgent', // an agent on demand (custom role + instructions) under a parent
      'orchestra.updateAgent', // name, instructions, pause/resume, model policy, budget
      'orchestra.tasks', // list / filter
      'orchestra.enqueue', // give a task to an agent
      'orchestra.retryTask', // dead / failed / cancelled → queued with fresh attempts
      'orchestra.cancelTask', // cancels a task and its open sub-tasks (kills a run in flight)
      'orchestra.accounts', // the pool: usage, running, limited_until
      'orchestra.saveAccount', // add / edit a Claude Code, Codex, API or relay account
      'orchestra.clearLimit', // "the limit is over": waiting tasks go again
      'orchestra.routines', // per agent or all
      'orchestra.toggleRoutine', // on / off
      'orchestra.memory', // long-term memory items of an agent
      'orchestra.deleteMemory', // forget one item
      'orchestra.inbox', // human-in-the-loop items and alerts
      'orchestra.answer', // answer an item: its task resumes
      'orchestra.events', // the runtime timeline (activity feed)
      'orchestra.tick', // one supervisor pass (tests, demo, "run now")
      'orchestra.say', // Charlie writes to an agent: posted in its room with an @mention, the agent wakes
      'orchestra.technologies', // the catalogue of technologies (tools) and the roles that get each by default
      'orchestra.agentContext', // « Ce que l'agent sait »: the sections its next turn reads, secrets removed
      'orchestra.contextBlock', // « Mémoire de l'espace » / « Mémoire de la chaîne »
      'orchestra.saveContextBlock', // the owner edits one of them
      'orchestra.addCliAccount', // « Ajouter mon compte Claude Code / Codex »: own folder + login terminal
      'orchestra.openLogin', // the login terminal again
      'orchestra.checkAccount' // one tiny Haiku prompt through the account's CLI: ready / login / failed
    ])
    for (const m of ORCHESTRA_METHODS) expect(API_METHODS).toContain(m)
  })

  it('drives the runtime end to end through atelier:call', async () => {
    const r = rig({ seed: false })
    const api = r.core.api
    const call = (m: string, ...args: unknown[]) => handleCall(api, m, args)
    const ok = async <T>(m: string, ...args: unknown[]): Promise<T> => {
      const res = await call(m, ...args)
      if (!res.ok) throw new Error(`${m}: ${res.error.message}`)
      return res.value as T
    }
    expect(await ok('orchestra.tree')).toEqual([])
    const tree = await ok<{ agent: { id: number; slug: string } }[]>('orchestra.seed')
    expect(tree[0]!.agent.slug).toBe('principal')
    const status = await ok<{ enabled: boolean; agents: number; accountsReady: number }>('orchestra.status')
    expect(status).toMatchObject({ enabled: false, agents: 24, accountsReady: 1 })
    const principal = agentBySlug(r, 'principal')
    const task = await ok<{ id: number; status: string }>('orchestra.enqueue', { assigneeId: principal.id, kind: 'plan', title: 'Semaine', brief: 'Sujets [validate]' })
    expect(task.status).toBe('queued')
    for (let i = 0; i < 6; i++) await ok('orchestra.tick', { wait: true })
    const inbox = await ok<{ id: number; kind: string }[]>('orchestra.inbox')
    expect(inbox).toHaveLength(1)
    await ok('orchestra.answer', inbox[0]!.id, { choice: 'Valider' })
    await ok('orchestra.tick', { wait: true })
    const tasks = await ok<{ id: number; status: string }[]>('orchestra.tasks', { status: ['done'] })
    expect(tasks.map((t) => t.id)).toContain(task.id)
    expect((await ok<unknown[]>('orchestra.tasks', { assigneeId: principal.id })).length).toBe(1)
    const events = await ok<{ id: number; type: string }[]>('orchestra.events', 0, 500)
    expect(events.some((e) => e.type === 'bump')).toBe(true)
    expect(await ok<unknown[]>('orchestra.events', events.at(-1)!.id)).toEqual([])
    const mem = await ok<{ id: number }[]>('orchestra.memory', principal.id)
    expect(mem.length).toBeGreaterThan(0)
    await ok('orchestra.deleteMemory', mem[0]!.id)
    const accounts = await ok<{ id: number; kind: string }[]>('orchestra.accounts')
    expect(accounts).toEqual([expect.objectContaining({ id: 1, kind: 'claude-code', limitedUntil: null })])
    const added = await ok<{ id: number }>('orchestra.saveAccount', { kind: 'codex', label: 'Codex', configDir: 'C:\\codex\\one' })
    expect((await ok<unknown[]>('orchestra.accounts')).length).toBe(2)
    expect(await ok('orchestra.clearLimit', added.id)).toMatchObject({ limitedUntil: null })
    const routines = await ok<{ id: number; enabled: boolean }[]>('orchestra.routines')
    expect(routines.length).toBe(5)
    expect(await ok('orchestra.toggleRoutine', routines[0]!.id, false)).toMatchObject({ enabled: false })
    expect((await ok<unknown[]>('orchestra.routines', principal.id)).length).toBe(1)
    const agent = await ok<{ id: number; custom: boolean }>('orchestra.createAgent', { name: 'Veilleur Shorts', role: 'shorts_scout', parentId: principal.id })
    expect(agent.custom).toBe(true)
    expect(await ok('orchestra.updateAgent', agent.id, { paused: true })).toMatchObject({ status: 'paused' })
    expect((await ok<unknown[]>('orchestra.agents')).length).toBe(25)
    const t2 = await ok<{ id: number }>('orchestra.enqueue', { assigneeId: agent.id, kind: 'task', title: 'x' })
    expect(await ok('orchestra.cancelTask', t2.id)).toMatchObject({ status: 'cancelled' })
    expect(await ok('orchestra.retryTask', t2.id)).toMatchObject({ status: 'queued' })
  })

  it('say: the message from Charlie lands in the room of the agent and wakes it with a mention task', async () => {
    const r = rig()
    const call = (m: string, ...args: unknown[]) => handleCall(r.core.api, m, args)
    const ok = async <T>(m: string, ...args: unknown[]): Promise<T> => {
      const res = await call(m, ...args)
      if (!res.ok) throw new Error(`${m}: ${res.error.message}`)
      return res.value as T
    }
    const principal = agentBySlug(r, 'principal')
    const said = await ok<{ conversationId: number; messageId: number }>('orchestra.say', { agentId: principal.id, text: 'Prépare la semaine' })
    const msgs = await ok<{ id: number; authorType: string; body: string }[]>('chat.messages', said.conversationId)
    expect(msgs.find((m) => m.id === said.messageId)).toMatchObject({ authorType: 'owner', body: expect.stringContaining('Prépare la semaine') })
    const tasks = await ok<{ kind: string; status: string; payload: { conversationId?: number } }[]>('orchestra.tasks', { assigneeId: principal.id })
    expect(tasks).toEqual([expect.objectContaining({ kind: 'mention', status: 'queued', payload: expect.objectContaining({ conversationId: said.conversationId }) })])
    expect(await call('orchestra.say', { agentId: principal.id, text: '   ' })).toMatchObject({ ok: false })
  })

  it('refuses bad arguments with an error envelope', async () => {
    const r = rig()
    const call = (m: string, ...args: unknown[]) => handleCall(r.core.api, m, args)
    expect(await call('orchestra.updateAgent', 'one', {})).toMatchObject({ ok: false })
    expect(await call('orchestra.memory', 99_999)).toMatchObject({ ok: false, error: { message: expect.stringMatching(/n’a pas pu aboutir/), detail: expect.stringMatching(/Unknown agent/) } })
    expect(await call('orchestra.enqueue', { assigneeId: 1, kind: 'Bad Kind', title: 'x' })).toMatchObject({ ok: false })
    expect(await call('orchestra.enqueue', { assigneeId: 1, kind: 'plan', title: '' })).toMatchObject({ ok: false })
    expect(await call('orchestra.saveAccount', { kind: 'gemini', label: 'x' })).toMatchObject({ ok: false })
    expect(await call('orchestra.retryTask', 0)).toMatchObject({ ok: false })
    expect(await call('orchestra.toggleRoutine', 1, 'yes')).toMatchObject({ ok: false })
    expect(await call('orchestra.answer', 1, { text: 'x' })).toMatchObject({ ok: false })
  })
})
