import { describe, expect, it } from 'vitest'
import { ROLES } from '../../src/shared/roles'
import { MAX_INSTRUCTIONS_CHARS, MAX_MEMORY_CHARS, MAX_MEMORY_NOTES } from '../../src/main/agents/store'
import { agentDefault } from '../../src/main/agents/roles'
import { memoryCore } from './helpers'

// api handlers throw synchronously; expose them as rejections
const fails = (fn: () => unknown) => expect(Promise.resolve().then(fn)).rejects

describe('seeding', () => {
  it('inserts the 27 roles once and keeps edited instructions on a second seed', async () => {
    const { api, agents } = memoryCore()
    const list = await api['agents.list']()
    expect(list).toHaveLength(27) // 22 v1 roles + 5 v2 roles (lot 13)
    expect(list.map((a) => a.role)).toEqual(ROLES.map((r) => r.role))
    expect(list.every((a) => a.id === a.role && a.enabled && !a.customized)).toBe(true)

    await api['agents.update']('scriptwriter', { instructions: 'Write like a poet.' })
    expect(agents.seed()).toBe(0)
    const sw = (await api['agents.list']()).find((a) => a.role === 'scriptwriter')!
    expect(sw.instructions).toBe('Write like a poet.')
    expect(await api['agents.list']()).toHaveLength(27)
  })

  it('gives each role its tools and web search', async () => {
    const { api } = memoryCore()
    const by = Object.fromEntries((await api['agents.list']()).map((a) => [a.role, a]))
    expect(by.supervisor!.tools).toContain('create_video')
    expect(by.supervisor!.tools).not.toContain('save_version')
    expect(by.supervisor!.cadence).toBe('on_message')
    expect(by.researcher!.webSearch).toBe(true)
    expect(by.researcher!.tools).toEqual(expect.arrayContaining(['get_brief', 'get_inputs', 'save_version']))
    expect(by.researcher!.cadence).toBe('on_task')
    expect(by.scriptwriter!.webSearch).toBe(false)
    expect(by.scriptwriter!.tools).toContain('save_version')
    expect(by.scriptwriter!.tools).not.toContain('create_video')
    expect(by.trend_scout!.tools).not.toContain('save_version')
    expect(by.trend_scout!.cadence).toBe('daily')
    // create_video belongs to the supervisor only
    expect(Object.values(by).filter((a) => a.tools.includes('create_video')).map((a) => a.role)).toEqual(['supervisor'])
  })

  it('shows the tier of the routes table and follows a route change', async () => {
    const { api } = memoryCore()
    const tier = async (role: string) => (await api['agents.list']()).find((a) => a.role === role)!.tier
    expect(await tier('researcher')).toBe('balanced')
    expect(await tier('scriptwriter')).toBe('best')
    await api['routes.set']('researcher', { tier: 'fast' })
    expect(await tier('researcher')).toBe('fast')
    expect(await tier('scriptwriter')).toBe('best')
  })
})

describe('updating', () => {
  it('validates instructions, enabled and cadence', async () => {
    const { api } = memoryCore()
    await fails(() => api['agents.update']('researcher', { instructions: '   ' })).toThrow(/cannot be empty/)
    await fails(() => api['agents.update']('researcher', { instructions: 'x'.repeat(MAX_INSTRUCTIONS_CHARS + 1) })).toThrow(/limited to/)
    await fails(() => api['agents.update']('researcher', { cadence: 'yearly' as never })).toThrow(/Unknown cadence/)
    await fails(() => api['agents.update']('researcher', { enabled: 'yes' as never })).toThrow(/true or false/)
    await fails(() => api['agents.update']('nobody', { enabled: false })).toThrow(/Unknown agent/)
    // nothing above changed the agent
    const r = (await api['agents.list']()).find((a) => a.role === 'researcher')!
    expect(r).toMatchObject({ customized: false, enabled: true, cadence: 'on_task' })
  })

  it('accepts the maximum length, trims, and applies enabled and cadence', async () => {
    const { api } = memoryCore()
    const max = 'y'.repeat(MAX_INSTRUCTIONS_CHARS)
    expect((await api['agents.update']('researcher', { instructions: `  ${max}  ` })).instructions).toBe(max)
    const up = await api['agents.update']('researcher', { enabled: false, cadence: 'weekly' })
    expect(up).toMatchObject({ enabled: false, cadence: 'weekly' })
  })

  it('flags customized instructions and reset puts the default back', async () => {
    const { api } = memoryCore()
    const edited = await api['agents.update']('qc', { instructions: 'Be strict.' })
    expect(edited.customized).toBe(true)
    await api['agents.update']('qc', { cadence: 'daily' })
    const back = await api['agents.reset']('qc')
    expect(back).toMatchObject({ customized: false, instructions: agentDefault('qc')!.instructions, cadence: 'on_task' })
    // setting the default text by hand also counts as not customized
    const same = await api['agents.update']('qc', { instructions: agentDefault('qc')!.instructions })
    expect(same.customized).toBe(false)
  })

  it('notifies the agents topic on changes', async () => {
    const topics: string[] = []
    const { api } = memoryCore({ notify: (t) => topics.push(t) })
    await api['agents.update']('qc', { enabled: false })
    await api['agents.reset']('qc')
    expect(topics.filter((t) => t === 'agents')).toHaveLength(2)
  })
})

describe('memory', () => {
  it('remembers per channel, recalls channel + general notes oldest first, and forgets', async () => {
    const { agents, api, context } = memoryCore()
    const a = context.workflow.channels.create({ name: 'A' })
    const b = context.workflow.channels.create({ name: 'B' })
    agents.remember('researcher', null, '  general  ')
    agents.remember('researcher', a.id, 'about A')
    agents.remember('researcher', b.id, 'about B')
    agents.remember('scriptwriter', a.id, 'other agent')

    expect(agents.recall('researcher', a.id).map((m) => m.content)).toEqual(['general', 'about A'])
    expect(agents.recall('researcher', b.id).map((m) => m.content)).toEqual(['general', 'about B'])
    expect(agents.recall('researcher', null).map((m) => m.content)).toEqual(['general'])
    expect(agents.recall('researcher', a.id, 1).map((m) => m.content)).toEqual(['about A'])
    const all = await api['agents.memory']('researcher')
    expect(all.map((m) => m.content)).toEqual(['general', 'about A', 'about B'])
    expect(all[1]).toMatchObject({ agentId: 'researcher', channelId: a.id })

    await api['agents.forget'](all[1]!.id)
    expect((await api['agents.memory']('researcher')).map((m) => m.content)).toEqual(['general', 'about B'])
    await fails(() => api['agents.forget'](1.5)).toThrow(/integer/)
  })

  it('refuses empty notes and clips long ones', () => {
    const { agents } = memoryCore()
    expect(() => agents.remember('researcher', null, '  ')).toThrow(/needs text/)
    expect(() => agents.remember('nobody', null, 'x')).toThrow(/Unknown agent/)
    expect(agents.remember('researcher', null, 'z'.repeat(MAX_MEMORY_CHARS + 500)).content).toHaveLength(MAX_MEMORY_CHARS)
  })

  it('keeps only the newest 50 notes per agent and channel', () => {
    const { agents, context } = memoryCore()
    const ch = context.workflow.channels.create({ name: 'A' })
    for (let i = 1; i <= MAX_MEMORY_NOTES + 5; i++) agents.remember('researcher', ch.id, `note ${i}`)
    agents.remember('researcher', null, 'general')
    const mine = agents.memory('researcher').filter((m) => m.channelId === ch.id)
    expect(mine).toHaveLength(MAX_MEMORY_NOTES)
    expect(mine[0]!.content).toBe('note 6')
    expect(mine.at(-1)!.content).toBe(`note ${MAX_MEMORY_NOTES + 5}`)
    // the general note is untouched by the channel's cap
    expect(agents.memory('researcher').filter((m) => m.channelId === null)).toHaveLength(1)
  })
})

describe('migration 005', () => {
  it('adds agents.cadence and tasks.hold_reason to a fresh database', () => {
    const { db } = memoryCore()
    const cols = (table: string) =>
      db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number; dflt_value: string | null }[]
    const cadence = cols('agents').find((c) => c.name === 'cadence')
    expect(cadence).toMatchObject({ notnull: 1, dflt_value: "'on_task'" })
    expect(cols('tasks').find((c) => c.name === 'hold_reason')).toBeDefined()
    expect(cols('agent_memory').map((c) => c.name)).toEqual(expect.arrayContaining(['agent_id', 'channel_id', 'content']))
  })
})
