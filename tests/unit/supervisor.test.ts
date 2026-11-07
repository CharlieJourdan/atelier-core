import { describe, expect, it } from 'vitest'
import { fakeTeamReply } from '../../src/main/agents/fake-team'
import { FakeProvider } from '../../src/main/llm/fake'
import { memoryCore } from './helpers'

async function setup() {
  const provider = new FakeProvider(fakeTeamReply)
  const core = memoryCore({ chatProvider: () => provider, retryDelayMs: 0 })
  const channel = await core.api['channels.create']({ name: 'History', niche: 'lost cities' })
  const [sup] = await core.api['chat.conversations']()
  const say = async (text: string) => {
    await core.api['chat.send'](sup!.id, text)
    await core.chat.idle()
    return core.api['chat.messages'](sup!.id)
  }
  const proposalCard = async () => (await core.api['chat.messages'](sup!.id)).find((m) => m.card?.type === 'proposal')
  return { core, provider, channel, sup: sup!, say, proposalCard }
}

describe('Supervisor proposing a video', () => {
  it('posts a pending proposal card and creates no video until Charlie confirms', async () => {
    const { core, say, proposalCard } = await setup()
    const msgs = await say('make a video about lost cities for History')

    const card = await proposalCard()
    expect(card).toBeDefined()
    expect(card!.authorId).toBe('supervisor')
    expect(card!.card).toMatchObject({
      type: 'proposal',
      status: 'pending',
      title: 'New video for History: Lost cities',
      detail: 'A video about lost cities.'
    })
    expect(core.context.workflow.listVideos()).toHaveLength(0)
    // the Supervisor also answered in words, after the card
    expect(msgs.at(-1)).toMatchObject({ authorType: 'agent', authorId: 'supervisor' })
    expect(msgs.at(-1)!.body).toContain('Confirm the card')
  })

  it('confirming creates the video with the brief, marks the proposal accepted and posts a system message', async () => {
    const { core, sup, say, proposalCard } = await setup()
    await say('make a video about lost cities for History')
    const card = (await proposalCard())!.card as { proposalId: number }

    const decided = await core.api['proposals.decide'](card.proposalId, true)
    expect(decided).toMatchObject({ status: 'accepted', kind: 'create_video' })
    const videos = await core.api['videos.list']()
    expect(videos).toHaveLength(1)
    expect(videos[0]).toMatchObject({ title: 'Lost cities', brief: 'A video about lost cities.', channelId: 1 })
    expect(decided.resultVideoId).toBe(videos[0]!.id)

    const msgs = await core.api['chat.messages'](sup.id)
    expect(msgs.find((m) => m.card?.type === 'proposal')!.card).toMatchObject({ status: 'accepted' })
    expect(msgs.some((m) => m.authorType === 'system' && m.body.includes('You confirmed') && m.body.includes('research starts now'))).toBe(true)
    const videoChat = await core.api['chat.open']({ kind: 'video', videoId: videos[0]!.id })
    expect((await core.api['chat.messages'](videoChat.id)).some((m) => m.body.includes('Video created from the Supervisor chat'))).toBe(true)

    await expect(Promise.resolve().then(() => core.api['proposals.decide'](card.proposalId, true))).rejects.toThrow(/already accepted/)
    await expect(Promise.resolve().then(() => core.api['proposals.decide'](card.proposalId, false))).rejects.toThrow(/already accepted/)
    expect(await core.api['videos.list']()).toHaveLength(1)
  })

  it('after confirmation the runner writes the research', async () => {
    const { core, provider, say, proposalCard } = await setup()
    await say('make a video about lost cities for History')
    await core.api['proposals.decide'](((await proposalCard())!.card as { proposalId: number }).proposalId, true)
    const started = core.runner.tick()
    expect(started).toHaveLength(1)
    await core.runner.idle()
    const wf = core.context.workflow
    const video = wf.listVideos()[0]!
    const research = wf.listDeliverables(video.id).find((d) => d.type === 'research')!
    const versions = wf.listVersions(research.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]!.content).toContain('Fake research written by the test team.')
    expect(provider.calls.some((c) => c.prompt.startsWith('Make the Research for the video "Lost cities"'))).toBe(true)
  })

  it('dismissing creates nothing', async () => {
    const { core, sup, say, proposalCard } = await setup()
    await say('make a video about lost cities for History')
    const id = ((await proposalCard())!.card as { proposalId: number }).proposalId
    const row = await core.api['proposals.decide'](id, false)
    expect(row).toMatchObject({ status: 'rejected', resultVideoId: null })
    expect(await core.api['videos.list']()).toHaveLength(0)
    expect(core.runner.tick()).toEqual([])
    const msgs = await core.api['chat.messages'](sup.id)
    expect(msgs.find((m) => m.card?.type === 'proposal')!.card).toMatchObject({ status: 'rejected' })
    expect(msgs.some((m) => m.authorType === 'system' && m.body.includes('You dismissed'))).toBe(true)
    await expect(Promise.resolve().then(() => core.api['proposals.decide'](id, true))).rejects.toThrow(/already rejected/)
    expect(await core.api['videos.list']()).toHaveLength(0)
  })

  it('an unknown channel is a tool error: no proposal, no video', async () => {
    const { core, provider, say, proposalCard } = await setup()
    await say('make a video about volcanoes for Geology')
    expect(provider.toolResults).toHaveLength(1)
    expect(provider.toolResults[0]).toMatchObject({ name: 'create_video', isError: true })
    expect(provider.toolResults[0]!.text).toMatch(/Unknown channel "Geology".*History/)
    expect(await proposalCard()).toBeUndefined()
    expect(core.db.prepare('SELECT COUNT(*) AS n FROM proposals').get()).toEqual({ n: 0 })
    expect(await core.api['videos.list']()).toHaveLength(0)
  })

  it('the agent turn gives the Supervisor its channel list and tools, and is booked in the ledger', async () => {
    const { core, provider, say } = await setup()
    await core.api['channels.create']({ name: 'Space' })
    await say('hello team')
    const call = provider.calls[0]!
    expect(call.system).toContain("Charlie's channels:")
    expect(call.system).toContain('#1 History (lost cities)')
    expect(call.system).toContain('#2 Space')
    expect(call.system).toContain('- create_video:')
    expect(call.tools?.specs.map((s) => s.name)).toContain('create_video')
    const msgs = await core.api['chat.messages']((await core.api['chat.conversations']())[0]!.id)
    expect(msgs.at(-1)!.body).toBe('Fake reply to: hello team')
    const rows = core.db.prepare(`SELECT status FROM ledger`).all() as { status: string }[]
    expect(rows).toEqual([{ status: 'settled' }])
  })

  it('a disabled Supervisor does not answer and says so', async () => {
    const { core, provider, say } = await setup()
    await core.api['agents.update']('supervisor', { enabled: false })
    const msgs = await say('make a video about lost cities for History')
    expect(provider.calls).toHaveLength(0)
    expect(msgs.at(-1)).toMatchObject({ authorType: 'system' })
    expect(msgs.at(-1)!.body).toMatch(/turned off/)
  })
})
