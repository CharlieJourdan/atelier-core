import { describe, expect, it } from 'vitest'
import { FakeProvider } from '../../src/main/llm/fake'
import type { RunScope } from '../../src/main/agents/tools'
import { memoryCore } from './helpers'

function setup(provider = new FakeProvider(() => ({ text: 'final text' }))) {
  const core = memoryCore({ chatProvider: () => provider, retryDelayMs: 0 })
  const wf = core.context.workflow
  const channel = wf.channels.create({ name: 'History' })
  const { video } = wf.createVideo(channel.id, { title: 'Atlantis', brief: 'brief' })
  const videoChat = core.chat.store.open({ kind: 'video', videoId: video.id })
  const supervisorChat = core.chat.store.open({ kind: 'supervisor' })
  const material = { brief: () => 'THE BRIEF', inputs: () => 'THE INPUTS' }
  const open = (kind: 'task' | 'chat', role: string, conversationId = videoChat.id) => {
    const scope: RunScope = {
      kind,
      role,
      conversationId,
      channelId: channel.id,
      videoId: video.id,
      taskId: kind === 'task' ? 1 : null
    }
    return core.runner.openTools(scope, core.agents.get(role), provider, material)
  }
  const bodies = (id = videoChat.id) => core.api['chat.messages'](id)
  return { core, provider, channel, video, videoChat, supervisorChat, open, bodies }
}

const names = (o: { run: { specs: { name: string }[] } }) => o.run.specs.map((s) => s.name)

describe('tool specs per scope', () => {
  it('a task run has get_inputs and save_version, a chat run has not', () => {
    const { open } = setup()
    const task = open('task', 'scriptwriter')
    expect(names(task)).toEqual(expect.arrayContaining(['get_brief', 'get_inputs', 'save_version', 'post_message', 'remember']))
    const chat = open('chat', 'scriptwriter')
    expect(names(chat)).toEqual(expect.arrayContaining(['get_brief', 'post_message', 'remember']))
    expect(names(chat)).not.toContain('get_inputs')
    expect(names(chat)).not.toContain('save_version')
  })

  it('only the supervisor gets create_video', async () => {
    const { open, core } = setup()
    expect(names(open('chat', 'supervisor'))).toContain('create_video')
    expect(names(open('task', 'researcher'))).not.toContain('create_video')
    // even if an edited agent row lists it, a non-supervisor never gets it
    const row = { ...core.agents.get('researcher'), tools: [...core.agents.get('researcher').tools, 'create_video' as const] }
    const opened = core.runner.openTools(
      { kind: 'chat', role: 'researcher', conversationId: 1, channelId: null, videoId: null, taskId: null },
      row,
      new FakeProvider(),
      { brief: () => '', inputs: () => '' }
    )
    expect(names(opened)).not.toContain('create_video')
    const r = await opened.run.call('create_video', { channel: 'History', title: 't', brief: 'b' })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/not available/)
  })

  it('has object JSON schemas and the in-process provider accepts the tools', () => {
    const { open } = setup()
    const o = open('task', 'researcher')
    expect(o.available).toBe(true)
    expect(o.tools.webSearch).toBe(true)
    for (const s of o.run.specs) expect(s.inputSchema).toMatchObject({ type: 'object' })
    expect(o.tools.mcp).toBeUndefined() // no bridge in unit tests
  })
})

describe('calls', () => {
  it('returns get_brief and get_inputs material', async () => {
    const { open } = setup()
    const { run } = open('task', 'scriptwriter')
    expect(await run.call('get_brief', {})).toEqual({ text: 'THE BRIEF', isError: false })
    expect(await run.call('get_inputs', {})).toEqual({ text: 'THE INPUTS', isError: false })
    expect(run.callCount).toBe(2)
  })

  it('refuses the 6th post_message as a tool error and posts only five', async () => {
    const { open, bodies } = setup()
    const { run } = open('task', 'researcher')
    for (let i = 1; i <= 5; i++) expect(await run.call('post_message', { text: `note ${i}` })).toMatchObject({ isError: false })
    const sixth = await run.call('post_message', { text: 'note 6' })
    expect(sixth).toMatchObject({ isError: true })
    expect(sixth.text).toMatch(/5 times per run/)
    const posted = (await bodies()).filter((m) => m.authorType === 'agent' && m.body.startsWith('note '))
    expect(posted.map((m) => m.body)).toEqual(['note 1', 'note 2', 'note 3', 'note 4', 'note 5'])
    expect(posted.every((m) => m.authorId === 'researcher')).toBe(true)
    expect(run.callCount).toBe(5)
  })

  it('returns argument problems as isError, never throws', async () => {
    const { open } = setup()
    const { run } = open('task', 'researcher')
    for (const args of [{}, { text: '' }, { text: 42 }, { text: 'x'.repeat(4001) }, null, 'str', [1]]) {
      const r = await run.call('post_message', args)
      expect(r.isError, JSON.stringify(args)).toBe(true)
    }
    expect((await run.call('save_version', { content: '   ' })).isError).toBe(true)
    expect((await run.call('save_version', { content: 'x'.repeat(200_001) })).text).toMatch(/limited to 200000/)
    expect((await run.call('remember', { note: 5 })).isError).toBe(true)
    expect((await run.call('propose_action', { title: 'only title' })).isError).toBe(true)
    const unknown = await run.call('rm_rf', {})
    expect(unknown).toMatchObject({ isError: true })
    expect(unknown.text).toMatch(/not available/)
    expect(run.draft).toBeNull()
  })

  it('remember stores a note for the role and channel', async () => {
    const { open, core, channel } = setup()
    const { run } = open('task', 'researcher')
    expect(await run.call('remember', { note: '  prefers primary sources  ' })).toEqual({ text: 'Noted.', isError: false })
    expect(core.agents.recall('researcher', channel.id).map((m) => m.content)).toEqual(['prefers primary sources'])
    expect(core.agents.recall('scriptwriter', channel.id)).toEqual([])
  })

  it('propose_action posts a pending proposal card', async () => {
    const { open, core, bodies } = setup()
    const { run } = open('chat', 'channel_strategist')
    const r = await run.call('propose_action', { title: 'Buy a map pack', detail: 'It is cheap' })
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/Proposal #1 posted/)
    const card = (await bodies()).find((m) => m.card?.type === 'proposal')!
    expect(card.authorId).toBe('channel_strategist')
    expect(card.card).toMatchObject({ type: 'proposal', proposalId: 1, title: 'Buy a map pack', detail: 'It is cheap', status: 'pending' })
    expect(core.proposals.get(1)).toMatchObject({ kind: 'other', status: 'pending' })
    // confirming an "other" proposal changes nothing but its status
    await core.api['proposals.decide'](1, true)
    expect(core.proposals.statusOf(1)).toBe('accepted')
  })

  it('caps propose_action at 3 per run', async () => {
    const { open } = setup()
    const { run } = open('chat', 'supervisor')
    for (let i = 0; i < 3; i++) expect((await run.call('propose_action', { title: `p${i}`, detail: 'd' })).isError).toBe(false)
    expect((await run.call('propose_action', { title: 'p3', detail: 'd' })).isError).toBe(true)
  })

  it('create_video resolves a channel by name (any case) or id and proposes without creating', async () => {
    const { open, core, channel, supervisorChat } = setup()
    const { run } = open('chat', 'supervisor', supervisorChat.id)
    const byName = await run.call('create_video', { channel: ' history ', title: 'Troy', brief: 'The horse' })
    expect(byName.isError).toBe(false)
    const byId = await run.call('create_video', { channel: channel.id, title: 'Pompeii', brief: 'Ash' })
    expect(byId.isError).toBe(false)
    expect(core.proposals.get(1).payload).toMatchObject({ channelId: channel.id, title: 'Troy', brief: 'The horse' })
    expect(core.context.workflow.listVideos()).toHaveLength(1) // only the setup video
    const unknown = await run.call('create_video', { channel: 'Nope', title: 'T', brief: 'B' })
    expect(unknown).toMatchObject({ isError: true })
    expect(unknown.text).toMatch(/Unknown channel "Nope".*#1 History/)
    expect(core.proposals.statusOf(3)).toBeNull()
  })
})

describe('inside a model call', () => {
  it('save_version wins over the final text in a task run', async () => {
    const provider = new FakeProvider(() => ({
      text: 'FINAL TEXT',
      toolCalls: [
        { name: 'save_version', args: { content: 'first draft' } },
        { name: 'save_version', args: { content: 'THE DRAFT' } }
      ]
    }))
    const { core, video } = setup(provider)
    core.runner.tick()
    await core.runner.idle()
    const wf = core.context.workflow
    const d = wf.listDeliverables(video.id).find((x) => x.type === 'research')!
    expect(wf.listVersions(d.id).map((v) => v.content)).toEqual(['THE DRAFT'])
    expect(provider.toolResults.map((r) => [r.name, r.isError])).toEqual([['save_version', false], ['save_version', false]])
  })

  it('the final text is saved when no draft was saved; a failing tool call does not break the run', async () => {
    const provider = new FakeProvider(() => ({ text: 'FINAL TEXT', toolCalls: [{ name: 'save_version', args: { content: '' } }] }))
    const { core, video } = setup(provider)
    core.runner.tick()
    await core.runner.idle()
    const wf = core.context.workflow
    const d = wf.listDeliverables(video.id).find((x) => x.type === 'research')!
    expect(wf.listVersions(d.id).map((v) => v.content)).toEqual(['FINAL TEXT'])
    expect(provider.toolResults[0]).toMatchObject({ name: 'save_version', isError: true })
  })

  it('a task prompt names the tools because the provider accepts them', async () => {
    const provider = new FakeProvider(() => ({ text: 'x' }))
    const { core } = setup(provider)
    core.runner.tick()
    await core.runner.idle()
    const call = provider.calls[0]!
    expect(call.system).toContain('You can use these Atelier tools:')
    expect(call.prompt).toContain('save it with save_version')
    expect(call.tools?.specs.map((s) => s.name)).toContain('save_version')
  })
})
