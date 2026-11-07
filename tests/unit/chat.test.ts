import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { trackTemp } from '../setup/track-temp'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EventContract } from '../../src/shared/api'
import { FakeProvider } from '../../src/main/llm/fake'
import { ProviderError, type Provider } from '../../src/main/llm/types'
import { memoryCore } from './helpers'

type StreamEvent = EventContract['atelier:stream']

// api handlers throw synchronously; expose them as rejections
const fails = (fn: () => unknown) => expect(Promise.resolve().then(fn)).rejects

function setup(provider: Provider = new FakeProvider(['Hello Charlie, all good.'])) {
  const events: StreamEvent[] = []
  const topics: string[] = []
  const dir = trackTemp(mkdtempSync(path.join(os.tmpdir(), 'atelier-chat-test-')))
  const core = memoryCore({
    chatProvider: () => provider,
    emitStream: (e) => events.push(e),
    notify: (t) => topics.push(t),
    attachmentsDir: dir
  })
  return { core, api: core.api, events, topics, dir, provider }
}

async function videoWithBrief(api: ReturnType<typeof setup>['api'], budget: number | null = null) {
  const ch = await api['channels.create']({ name: 'History', niche: 'lost cities' })
  if (budget !== null) await api['spend.setChannelCap'](ch.id, budget)
  const video = await api['videos.create'](ch.id, { title: 'Ys, the drowned city', brief: 'A 10 minute story' })
  return { ch, video }
}

describe('conversations', () => {
  it('always has one Supervisor conversation and opens video / agent chats idempotently', async () => {
    const { api } = setup()
    const first = await api['chat.conversations']()
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ kind: 'supervisor', title: 'Supervisor', unread: 0, lastMessage: null })

    const { video } = await videoWithBrief(api)
    const v1 = await api['chat.open']({ kind: 'video', videoId: video.video.id })
    const v2 = await api['chat.open']({ kind: 'video', videoId: video.video.id })
    expect(v1.id).toBe(v2.id)
    expect(v1).toMatchObject({ kind: 'video', title: 'Ys, the drowned city', videoId: video.video.id })
    const a1 = await api['chat.open']({ kind: 'agent', agentId: 'scriptwriter' })
    expect((await api['chat.open']({ kind: 'agent', agentId: 'scriptwriter' })).id).toBe(a1.id)
    expect(a1.title).toBe('Scriptwriter')
    expect(await api['chat.conversations']()).toHaveLength(3)
  })

  it('rejects unknown kinds, videos and agents', async () => {
    const { api } = setup()
    await fails(() => api['chat.open']({ kind: 'group' as never })).toThrow(/Unknown conversation kind/)
    await fails(() => api['chat.open']({ kind: 'video' })).toThrow(/videoId/)
    await fails(() => api['chat.open']({ kind: 'video', videoId: 999 })).toThrow(/Unknown video/)
    await fails(() => api['chat.open']({ kind: 'agent', agentId: 'wizard' })).toThrow(/Unknown agent/)
    await fails(() => api['chat.messages'](42)).toThrow(/Unknown conversation/)
    await fails(() => api['chat.send'](42, 'hi')).toThrow(/Unknown conversation/)
  })
})

describe('sending and replying', () => {
  it('stores the owner message, streams the FakeProvider reply and saves it', async () => {
    const { core, api, events } = setup(new FakeProvider([{ text: 'Hello Charlie, all good.', chunkSize: 5 }]))
    const [sup] = await api['chat.conversations']()
    const sent = await api['chat.send'](sup!.id, '  Hi there  ')
    expect(sent.message).toMatchObject({ authorType: 'owner', body: 'Hi there' })
    expect(sent.streamId).toMatch(/^chat-/)
    await core.chat.idle()

    const msgs = await api['chat.messages'](sup!.id)
    expect(msgs.map((m) => [m.authorType, m.authorId, m.body])).toEqual([
      ['owner', null, 'Hi there'],
      ['agent', 'supervisor', 'Hello Charlie, all good.']
    ])
    const mine = events.filter((e) => e.streamId === sent.streamId)
    const deltas = mine.filter((e) => e.delta !== undefined).map((e) => e.delta)
    expect(deltas.length).toBeGreaterThan(1)
    expect(deltas.join('')).toBe('Hello Charlie, all good.')
    expect(mine.at(-1)).toMatchObject({ done: true, messageId: msgs[1]!.id, conversationId: sup!.id })
    expect(mine.at(-1)?.error).toBeUndefined()
  })

  it('goes through the ledger with the routed model, effort and video attribution', async () => {
    const provider = new FakeProvider(['Sure.'])
    const { core, api } = setup(provider)
    const { ch, video } = await videoWithBrief(api)
    await api['routes.set']('supervisor', { effort: 'max' })
    const conv = await api['chat.open']({ kind: 'video', videoId: video.video.id })
    await api['chat.send'](conv.id, 'How is it going?')
    await core.chat.idle()

    expect(provider.calls).toHaveLength(1)
    const call = provider.calls[0]!
    expect(call.model).toBe('claude-opus-5-5')
    expect(call.effort).toBe('max')
    expect(call.system).toContain('Ys, the drowned city')
    expect(call.system).toContain('A 10 minute story')
    expect(call.prompt).toContain('Charlie: How is it going?')

    const entries = await api['spend.entries']()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ status: 'settled', channelId: ch.id, videoId: video.video.id, model: 'claude-opus-5-5' })
    expect(entries[0]!.amountUsd).toBeGreaterThan(0)
    expect((await api['spend.overview']()).reservedUsd).toBe(0)
  })

  it('an agent chat is answered by that agent role and its route', async () => {
    const provider = new FakeProvider(['Draft coming.'])
    const { core, api } = setup(provider)
    const conv = await api['chat.open']({ kind: 'agent', agentId: 'metadata' })
    await api['chat.send'](conv.id, 'Title ideas?')
    await core.chat.idle()
    expect(provider.calls[0]?.model).toBe('claude-haiku-5-5')
    const msgs = await api['chat.messages'](conv.id)
    expect(msgs[1]).toMatchObject({ authorType: 'agent', authorId: 'metadata' })
  })

  it('refuses empty and oversized messages', async () => {
    const { api } = setup()
    const [sup] = await api['chat.conversations']()
    await fails(() => api['chat.send'](sup!.id, '   ')).toThrow(/Write a message/)
    await fails(() => api['chat.send'](sup!.id, 'x'.repeat(20_001))).toThrow(/limited/)
    expect(await api['chat.messages'](sup!.id)).toHaveLength(0)
  })

  it('replies in one conversation run in order', async () => {
    const provider = new FakeProvider((req) => `re: ${req.prompt}`)
    const { core, api } = setup(provider)
    const [sup] = await api['chat.conversations']()
    await api['chat.send'](sup!.id, 'one')
    await api['chat.send'](sup!.id, 'two')
    await core.chat.idle()
    const msgs = await api['chat.messages'](sup!.id)
    expect(msgs.map((m) => m.authorType)).toEqual(['owner', 'owner', 'agent', 'agent'])
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[0]!.prompt).toContain('Charlie: one')
    expect(provider.calls[1]!.prompt).toContain('Charlie: two')
    expect(msgs[3]!.body).toContain('Supervisor: re:') // the second call saw the first reply
  })

  it('a provider failure becomes a system message and the reservation is refunded', async () => {
    const { core, api, events } = setup(new FakeProvider([{ text: '', error: 'rate limited' }]))
    const [sup] = await api['chat.conversations']()
    const sent = await api['chat.send'](sup!.id, 'hello')
    await core.chat.idle()
    const msgs = await api['chat.messages'](sup!.id)
    expect(msgs.at(-1)).toMatchObject({ authorType: 'system', body: 'Reply failed: rate limited' })
    expect(events.filter((e) => e.streamId === sent.streamId).at(-1)).toMatchObject({
      done: true,
      error: 'Reply failed: rate limited'
    })
    const entries = await api['spend.entries']()
    expect(entries[0]).toMatchObject({ status: 'refunded', amountUsd: 0 })
  })

  it('a call that would cross the budget cap is refused with a budget card and costs nothing', async () => {
    const provider = new FakeProvider(['never sent'])
    const { core, api } = setup(provider)
    const { video } = await videoWithBrief(api, 0.0001)
    const conv = await api['chat.open']({ kind: 'video', videoId: video.video.id })
    await api['chat.send'](conv.id, 'Go on')
    await core.chat.idle()
    expect(provider.calls).toHaveLength(0)
    const last = (await api['chat.messages'](conv.id)).at(-1)!
    expect(last.authorType).toBe('system')
    expect(last.card).toMatchObject({ type: 'budget', scope: 'channel', capUsd: 0.0001 })
    expect((await api['spend.overview']()).spentUsd).toBe(0)
  })

  it('tells the owner when a reply was cut short', async () => {
    const truncating: Provider = {
      id: 'trunc',
      complete: () => Promise.reject(new Error('unused')),
      async *stream(req) {
        yield { type: 'text', text: 'half a thou' }
        yield {
          type: 'done',
          result: {
            text: 'half a thou', model: req.model, costUsd: null, stopReason: 'max_tokens', truncated: true, sessionId: null,
            usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }
          }
        }
      }
    }
    const { core, api } = setup(truncating)
    const [sup] = await api['chat.conversations']()
    await api['chat.send'](sup!.id, 'long please')
    await core.chat.idle()
    const msgs = await api['chat.messages'](sup!.id)
    expect(msgs[1]!.body).toBe('half a thou')
    expect(msgs[2]).toMatchObject({ authorType: 'system', body: expect.stringMatching(/token limit/) })
  })
})

describe('unread counts', () => {
  it('counts agent and system messages, not the owner own, until the chat is marked read', async () => {
    const { core, api, topics } = setup()
    const [sup] = await api['chat.conversations']()
    await api['chat.send'](sup!.id, 'hi')
    await core.chat.idle()
    const after = (await api['chat.conversations']())[0]!
    expect(after.unread).toBe(1)
    expect(after.lastMessage).toMatchObject({ authorType: 'agent', body: 'Hello Charlie, all good.' })
    await api['chat.markRead'](sup!.id)
    expect((await api['chat.conversations']())[0]!.unread).toBe(0)
    expect(topics).toContain('chat')
  })

  it('messages(afterId) returns only newer ones', async () => {
    const { core, api } = setup()
    const [sup] = await api['chat.conversations']()
    const sent = await api['chat.send'](sup!.id, 'hi')
    await core.chat.idle()
    const newer = await api['chat.messages'](sup!.id, sent.message.id)
    expect(newer).toHaveLength(1)
    expect(newer[0]!.authorType).toBe('agent')
  })
})

describe('attachments', () => {
  const b64 = (s: string): string => Buffer.from(s).toString('base64')

  it('stores dropped files in the data folder and gives text files to the model', async () => {
    const provider = new FakeProvider(['Read it.'])
    const { core, api, dir } = setup(provider)
    const [sup] = await api['chat.conversations']()
    const sent = await api['chat.send'](sup!.id, 'see notes', [
      { name: '..\\..\\evil/notes.txt', mime: 'text/plain', dataBase64: b64('remember the lighthouse') },
      { name: 'pic.png', mime: 'image/png', dataBase64: b64('not really a png') }
    ])
    await core.chat.idle()
    const [txt, png] = sent.message.attachments
    expect(txt).toMatchObject({ name: 'notes.txt', mime: 'text/plain', size: 23 })
    expect(path.resolve(txt!.path).startsWith(path.resolve(dir))).toBe(true)
    expect(readFileSync(txt!.path, 'utf8')).toBe('remember the lighthouse')
    expect(existsSync(png!.path)).toBe(true)
    expect(provider.calls[0]!.prompt).toContain('remember the lighthouse')
    expect(provider.calls[0]!.prompt).toContain('[attachment: pic.png (image/png')
  })

  it('refuses bad data, too many files and files that are too large', async () => {
    const { api } = setup()
    const [sup] = await api['chat.conversations']()
    await fails(() => api['chat.send'](sup!.id, 'x', [{ name: 'a', mime: 'text/plain', dataBase64: '!!!' }])).toThrow(
      /invalid data/
    )
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `f${i}`, mime: 'text/plain', dataBase64: b64('x') }))
    await fails(() => api['chat.send'](sup!.id, 'x', many)).toThrow(/At most 8/)
    const big = { name: 'big.bin', mime: 'application/octet-stream', dataBase64: 'A'.repeat(28 * 1024 * 1024) }
    await fails(() => api['chat.send'](sup!.id, 'x', [big])).toThrow(/larger than 20 MB/)
    expect(await api['chat.messages'](sup!.id)).toHaveLength(0)
  })

  it('a file alone is a valid message', async () => {
    const { core, api } = setup()
    const [sup] = await api['chat.conversations']()
    const sent = await api['chat.send'](sup!.id, '', [{ name: 'a.txt', mime: 'text/plain', dataBase64: b64('hi') }])
    await core.chat.idle()
    expect(sent.message.body).toBe('')
  })
})

describe('approval cards', () => {
  async function toThumbnailBrief() {
    const t = setup()
    const { video } = await videoWithBrief(t.api)
    const d = (type: string) => video.deliverables.find((x) => x.type === type)!
    await t.api['versions.add'](d('research').id, { content: 'Facts about Ys' })
    return { ...t, video, d }
  }

  it('posts a card in the video chat when a deliverable waits for approval', async () => {
    const { api, video, d } = await toThumbnailBrief()
    const conv = await api['chat.open']({ kind: 'video', videoId: video.video.id })
    expect(await api['chat.messages'](conv.id)).toHaveLength(0) // research needs no approval
    await api['versions.add'](d('thumbnail_brief').id, { content: 'A drowned bell tower at dusk' })
    const msgs = await api['chat.messages'](conv.id)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ authorType: 'agent', authorId: 'thumbnail_designer' })
    expect(msgs[0]!.card).toMatchObject({
      type: 'approval', deliverableId: d('thumbnail_brief').id, title: 'Thumbnail brief v1',
      excerpt: 'A drowned bell tower at dusk', status: 'waiting_approval', stale: false
    })
    expect((await api['chat.conversations']()).find((c) => c.id === conv.id)!.unread).toBe(1)
  })

  it('approving through the workflow api updates the card and records a system line', async () => {
    const { api, video, d } = await toThumbnailBrief()
    await api['versions.add'](d('thumbnail_brief').id, { content: 'Bell tower' })
    const conv = await api['chat.open']({ kind: 'video', videoId: video.video.id })
    await api['approvals.approve'](d('thumbnail_brief').id, 'nice')
    const msgs = await api['chat.messages'](conv.id)
    expect(msgs[0]!.card).toMatchObject({ type: 'approval', status: 'approved' })
    expect(msgs[1]).toMatchObject({ authorType: 'system', body: 'You approved thumbnail brief. Note: nice' })
    const detail = await api['videos.get'](video.video.id)
    expect(detail.deliverables.find((x) => x.type === 'thumbnail_brief')!.status).toBe('approved')
  })

  it('a revision marks the old card stale and the resubmitted version gets a new card', async () => {
    const { api, video, d } = await toThumbnailBrief()
    await api['versions.add'](d('thumbnail_brief').id, { content: 'v1' })
    const conv = await api['chat.open']({ kind: 'video', videoId: video.video.id })
    await api['approvals.requestRevision'](d('thumbnail_brief').id, 'More blue')
    await api['versions.add'](d('thumbnail_brief').id, { content: 'v2 bluer' })
    const msgs = await api['chat.messages'](conv.id)
    const cards = msgs.filter((m) => m.card?.type === 'approval')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.card).toMatchObject({ title: 'Thumbnail brief v1', stale: true, status: 'waiting_approval' })
    expect(cards[1]!.card).toMatchObject({ title: 'Thumbnail brief v2', stale: false, status: 'waiting_approval' })
    expect(msgs.some((m) => m.authorType === 'system' && m.body === 'You asked for changes on thumbnail brief: More blue')).toBe(true)
  })

  it('the model sees the cards in the transcript', async () => {
    const provider = new FakeProvider(['ok'])
    const t = setup(provider)
    const { video } = await videoWithBrief(t.api)
    const research = video.deliverables.find((x) => x.type === 'research')!
    const brief = video.deliverables.find((x) => x.type === 'thumbnail_brief')!
    await t.api['versions.add'](research.id, { content: 'r' })
    await t.api['versions.add'](brief.id, { content: 'b' })
    const conv = await t.api['chat.open']({ kind: 'video', videoId: video.video.id })
    await t.api['chat.send'](conv.id, 'thoughts?')
    await t.core.chat.idle()
    expect(provider.calls[0]!.prompt).toContain('[approval card: Thumbnail brief v1, status waiting_approval]')
  })
})

describe('review fixes', () => {
  it('a refusal is booked (billed call), not refunded', async () => {
    const refusing: Provider = {
      id: 'ref',
      complete: () => Promise.reject(new Error('unused')),
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new ProviderError('The model declined to answer', 'REFUSED', {
          inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0
        })
      }
    }
    const { core, api } = setup(refusing)
    const [sup] = await api['chat.conversations']()
    await api['chat.send'](sup!.id, 'hi')
    await core.chat.idle()
    expect((await api['chat.messages'](sup!.id)).at(-1)).toMatchObject({ authorType: 'system', body: expect.stringMatching(/declined/) })
    expect((await api['spend.entries']())[0]).toMatchObject({ status: 'settled', inputTokens: 1000 })
  })

  it('an unpriced model on the API provider is refused instead of being booked at $0', async () => {
    const provider = new FakeProvider(['x'])
    const { core, api } = setup(provider)
    await api['routes.set']('supervisor', { providerId: 'anthropic', model: 'claude-mystery-9' })
    const [sup] = await api['chat.conversations']()
    await api['chat.send'](sup!.id, 'hi')
    await core.chat.idle()
    expect(provider.calls).toHaveLength(0)
    expect((await api['chat.messages'](sup!.id)).at(-1)!.body).toMatch(/No price is set for claude-mystery-9/)
  })

  it('an unpriced model on Claude Code still works (the CLI reports its cost)', async () => {
    const provider = new FakeProvider([{ text: 'ok', costUsd: 0.01 }])
    const { core, api } = setup(provider)
    await api['routes.set']('supervisor', { model: 'claude-mystery-9' })
    const [sup] = await api['chat.conversations']()
    await api['chat.send'](sup!.id, 'hi')
    await core.chat.idle()
    expect((await api['spend.entries']())[0]).toMatchObject({ status: 'settled', amountUsd: 0.01 })
  })

  it('a video chat follows the video title', async () => {
    const { api } = setup()
    const { video } = await videoWithBrief(api)
    const conv = await api['chat.open']({ kind: 'video', videoId: video.video.id })
    await api['videos.update'](video.video.id, { title: 'Ys, renamed' })
    expect((await api['chat.conversations']()).find((c) => c.id === conv.id)!.title).toBe('Ys, renamed')
  })
})
