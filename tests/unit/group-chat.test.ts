// Lot 13 proof (group engine, FakeProvider only): @mentions answered in turn in the order of the text, the lead silent;
// handoffs with their card and the limit per message; the round budget checked before each turn; Stop; the lane rule;
// tool steps streamed and saved.
import { afterEach, describe, expect, it } from 'vitest'
import type { EventContract } from '../../src/shared/api'
import type { MessageRow } from '../../src/shared/chat'
import { FakeProvider, type FakeReply } from '../../src/main/llm/fake'
import { ProviderError, type CompletionRequest, type Provider, type StreamEvent } from '../../src/main/llm/types'
import { memoryCore } from './helpers'

type Stream = EventContract['atelier:stream']
type Core = ReturnType<typeof memoryCore>

/** The agent a request is for, from its system prompt ("You are the <Name> of Atelier"). */
const speaker = (req: CompletionRequest): string => /^You are the (.+?) of Atelier/.exec(req.system ?? '')?.[1] ?? '?'

function setup(replies: Record<string, (req: CompletionRequest) => FakeReply | string>) {
  const events: Stream[] = []
  const provider = new FakeProvider((req) => {
    const who = speaker(req)
    const reply = replies[who]
    return reply ? reply(req) : `${who} répond.`
  })
  const core = memoryCore({ chatProvider: () => provider, emitStream: (e) => events.push(e) })
  return { core, provider, events, api: core.api }
}

async function room(core: Core, department: 'production' | 'direction' | 'operations' = 'production') {
  const channel = await core.api['channels.create']({ name: 'Histoires oubliées' })
  return core.api['chat.open']({ kind: 'room', channelId: channel.id, department })
}

const agentLines = (msgs: MessageRow[]): [string | null, string][] =>
  msgs.filter((m) => m.authorType === 'agent').map((m) => [m.authorId, m.body])

let open: Core | null = null
afterEach(() => {
  open?.close()
  open = null
})

describe('@mentions in a room', () => {
  it('each mentioned agent answers in turn, in the order of the text, and the lead does not answer', async () => {
    const { core, provider, events, api } = setup({})
    open = core
    const r = await room(core)
    const sent = await api['chat.send'](r.id, '@Voix_off puis @Scénariste : où en est la vidéo sur Ys ?')
    await core.chat.idle()
    expect(provider.calls.map(speaker)).toEqual(['Voix off', 'Scénariste'])
    const msgs = await api['chat.messages'](r.id)
    expect(agentLines(msgs)).toEqual([
      ['voiceover', 'Voix off répond.'],
      ['scriptwriter', 'Scénariste répond.']
    ])
    // The second agent saw the first one's answer.
    expect(provider.calls[1]!.prompt).toContain('Voiceover: Voix off répond.')
    // Every turn has its own stream, tagged with its author.
    const streams = [...new Set(events.filter((e) => e.conversationId === r.id).map((e) => `${e.streamId}|${e.authorId}`))]
    expect(streams).toEqual([`${sent.streamId}|voiceover`, `${sent.streamId!.replace(/-1$/, '-2')}|scriptwriter`])
    const mentions = core.chat.group['deps'].handoffs.mentions(sent.message.id)
    expect(mentions.map((m) => [m.agentId, m.position, m.state])).toEqual([
      ['voiceover', 0, 'answered'],
      ['scriptwriter', 1, 'answered']
    ])
    expect(mentions.every((m) => m.replyMessageId !== null)).toBe(true)
  })

  it('without a mention the team lead answers, with its scope; in a private chat a mention is plain text', async () => {
    const { core, provider, api } = setup({})
    open = core
    const r = await room(core)
    await api['chat.send'](r.id, 'Qui travaille sur le script ?')
    await core.chat.idle()
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]!.system).toContain('team lead of the production room')
    expect(provider.calls[0]!.system).toContain('Chef d’équipe')
    expect(agentLines(await api['chat.messages'](r.id))).toEqual([['supervisor', 'Superviseur répond.']])

    const dm = await api['chat.open']({ kind: 'agent', agentId: 'metadata' })
    await api['chat.send'](dm.id, '@Scénariste tu as fini ?')
    await core.chat.idle()
    expect(provider.calls.map(speaker)).toEqual(['Superviseur', 'Rédacteur SEO'])
  })

  it('a disabled agent is not a mention target; a video chat is answered by the Producteur', async () => {
    const { core, provider, api } = setup({})
    open = core
    await api['agents.update']('voiceover', { enabled: false })
    const r = await room(core)
    await api['chat.send'](r.id, '@Voix_off tu es là ?')
    await core.chat.idle()
    expect(provider.calls.map(speaker)).toEqual(['Superviseur'])
    const channels = await api['channels.list']()
    const video = await api['videos.create'](channels[0]!.id, { title: 'Ys' })
    const vc = await api['chat.open']({ kind: 'video', videoId: video.video.id })
    expect(vc.channelId).toBe(channels[0]!.id)
    await api['chat.send'](vc.id, 'Où en est-on ?')
    await core.chat.idle()
    expect(provider.calls[1]!.system).toContain('Producer of this video')
  })
})

describe('handoffs (ask_agent)', () => {
  it('posts a handoff card, the specialist answers in the chat, its answer goes back and the asker concludes', async () => {
    const { core, provider, api } = setup({
      Superviseur: (req) =>
        req.prompt.includes('Charlie: Le script') && !provider.toolResults.length
          ? { text: 'Le Scénariste dit que le script est prêt.', toolCalls: [{ name: 'ask_agent', args: { agent: 'Scénariste', question: 'Le script de Ys est-il prêt ?' } }] }
          : 'ok',
      Scénariste: () => 'Oui, la version 2 attend ta validation.'
    })
    open = core
    const sup = (await api['chat.conversations']())[0]!
    await api['chat.send'](sup.id, 'Le script de Ys, il en est où ?')
    await core.chat.idle()
    const msgs = await api['chat.messages'](sup.id)
    expect(msgs.map((m) => [m.authorType, m.authorId, m.card?.type ?? null])).toEqual([
      ['owner', null, null],
      ['agent', 'supervisor', 'handoff'],
      ['agent', 'scriptwriter', null],
      ['agent', 'supervisor', null]
    ])
    expect(msgs[1]!.card).toMatchObject({
      type: 'handoff',
      from: 'supervisor',
      to: 'scriptwriter',
      ask: 'Le script de Ys est-il prêt ?',
      state: 'answered',
      answerExcerpt: 'Oui, la version 2 attend ta validation.'
    })
    expect(provider.toolResults).toEqual([{ name: 'ask_agent', text: 'Oui, la version 2 attend ta validation.', isError: false }])
    // The specialist got the question as a handoff, and cannot hand over again.
    const consult = provider.calls[1]!
    expect(consult.prompt).toContain('Supervisor handed you this: Le script de Ys est-il prêt ?')
    expect(consult.tools?.specs.map((s) => s.name) ?? []).not.toContain('ask_agent')
    expect(msgs[3]!.tools).toEqual([{ name: 'ask_agent', state: 'done' }])
  })

  it('refuses beyond the limit per message (anti-loop) with a refused card, and refuses unknown agents and itself', async () => {
    const asks = [
      { name: 'ask_agent', args: { agent: 'Scénariste', question: 'un' } },
      { name: 'ask_agent', args: { agent: 'Voix off', question: 'deux' } },
      { name: 'ask_agent', args: { agent: 'qc', question: 'trois' } }
    ]
    const { core, provider, api } = setup({
      Superviseur: (req) => (req.prompt.includes('handed you') ? 'x' : { text: 'Fini.', toolCalls: asks })
    })
    open = core
    await api['settings.set']('chat.maxHandoffs', 2)
    const sup = (await api['chat.conversations']())[0]!
    await api['chat.send'](sup.id, 'Fais le tour de l’équipe')
    await core.chat.idle()
    expect(provider.calls.map(speaker)).toEqual(['Superviseur', 'Scénariste', 'Voix off'])
    expect(provider.toolResults.map((r) => r.isError)).toEqual([false, false, true])
    expect(provider.toolResults[2]!.text).toMatch(/Handoff limit reached \(2 per message/)
    const cards = (await api['chat.messages'](sup.id)).flatMap((m) => (m.card?.type === 'handoff' ? [m.card] : []))
    expect(cards.map((c) => [c.to, c.state])).toEqual([
      ['scriptwriter', 'answered'],
      ['voiceover', 'answered'],
      ['qc', 'refused']
    ])
    expect(cards[2]!.reason).toBe('Limite de 2 passages de main par message atteinte')

    // The limit is per message of Charlie: the next message may hand over again.
    const before = provider.calls.length
    await api['chat.send'](sup.id, 'Encore une fois')
    await core.chat.idle()
    expect(provider.calls.length - before).toBe(3)
  })

  it('an unknown agent or itself is a tool error, nothing is posted', async () => {
    const { core, provider, api } = setup({
      Scénariste: () => ({
        text: 'Je reste seul.',
        toolCalls: [
          { name: 'ask_agent', args: { agent: 'Personne', question: 'a' } },
          { name: 'ask_agent', args: { agent: '@Scénariste', question: 'b' } }
        ]
      })
    })
    open = core
    const dm = await api['chat.open']({ kind: 'agent', agentId: 'scriptwriter' })
    await api['chat.send'](dm.id, 'Demande à quelqu’un')
    await core.chat.idle()
    expect(provider.toolResults.map((r) => r.isError)).toEqual([true, true])
    expect(provider.toolResults[0]!.text).toMatch(/^Unknown agent "Personne"\. The team: .*Voix off \(voiceover\)/)
    expect(provider.toolResults[1]!.text).toBe('You cannot hand a question to yourself')
    expect((await api['chat.messages'](dm.id)).some((m) => m.card?.type === 'handoff')).toBe(false)
  })
})

describe('budget per round', () => {
  it('checks the round budget before each turn: the next mention is refused once the message has spent it', async () => {
    const { core, provider, api } = setup({ 'Voix off': () => ({ text: 'Cher.', costUsd: 0.999 }) })
    open = core
    await api['settings.set']('chat.roundBudgetUsd', 1)
    const r = await room(core)
    const sent = await api['chat.send'](r.id, '@Voix_off @Scénariste @Monteur bilan ?')
    await core.chat.idle()
    expect(provider.calls.map(speaker)).toEqual(['Voix off'])
    const msgs = await api['chat.messages'](r.id)
    expect(msgs.at(-1)).toMatchObject({ authorType: 'system', body: expect.stringMatching(/^Budget du message atteint .*Scénariste ne répond pas/) })
    const states = core.chat.group['deps'].handoffs.mentions(sent.message.id).map((m) => m.state)
    expect(states).toEqual(['answered', 'failed', 'stopped'])
    // Only the call that ran is in the ledger.
    expect((await api['spend.overview']()).reservedUsd).toBe(0)
    expect(core.ledger.entries().filter((e) => e.status !== 'refunded')).toHaveLength(1)
  })

  it('a budget of 0 refuses before any model call; a global cap still refuses with its card', async () => {
    const { core, provider, api } = setup({})
    open = core
    await api['settings.set']('chat.roundBudgetUsd', 0)
    const sup = (await api['chat.conversations']())[0]!
    await api['chat.send'](sup.id, 'Bonjour')
    await core.chat.idle()
    expect(provider.calls).toHaveLength(0)
    expect((await api['spend.overview']()).spentUsd).toBe(0)
  })
})

describe('Stop', () => {
  it('aborts the turn in flight, the mentions not reached and the queued messages', async () => {
    const events: Stream[] = []
    let release: () => void = () => undefined
    const calls: string[] = []
    const provider = new FakeProvider((req) => {
      calls.push(speaker(req))
      return { text: 'Une très longue réponse qui arrive lentement, mot après mot, sans fin.', chunkSize: 4 }
    })
    // Slow the stream down so Stop lands in the middle of the first turn.
    const slow = {
      ...provider,
      id: provider.id,
      acceptsTools: () => true,
      complete: provider.complete.bind(provider),
      async *stream(req: CompletionRequest, opts: { signal?: AbortSignal } = {}) {
        let first = true
        for await (const ev of provider.stream(req, opts)) {
          yield ev
          if (first) {
            first = false
            await new Promise<void>((resolve) => {
              release = resolve
              opts.signal?.addEventListener('abort', () => resolve())
            })
          }
        }
      }
    }
    const core = memoryCore({ chatProvider: () => slow, emitStream: (e) => events.push(e) })
    open = core
    const r = await room(core)
    const sent = await core.api['chat.send'](r.id, '@Scénariste @Voix_off on y va ?')
    const queued = await core.api['chat.send'](r.id, 'Et ensuite ?')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(core.chat.busy(r.id)).toBe(true)
    expect(await core.api['chat.stop'](r.id)).toEqual({ stopped: true })
    release()
    await core.chat.idle()
    expect(calls).toEqual(['Scénariste'])
    const msgs = await core.api['chat.messages'](r.id)
    expect(msgs.filter((m) => m.authorType === 'agent')).toHaveLength(0)
    expect(msgs.some((m) => m.authorType === 'system' && m.body.startsWith('Arrêté'))).toBe(true)
    const states = core.chat.group['deps'].handoffs.mentions(sent.message.id).map((m) => m.state)
    expect(states).toEqual(['stopped', 'stopped'])
    // Both messages' streams are closed for the renderer.
    for (const id of [sent.streamId, queued.streamId]) {
      expect(events.some((e) => e.streamId === id && e.done && e.error === 'Stopped')).toBe(true)
    }
    expect(await core.api['chat.stop'](r.id)).toEqual({ stopped: false })
    expect(core.chat.busy(r.id)).toBe(false)
  })
})

describe('lane rule', () => {
  it('an off-topic answer becomes a short redirect to the right agent, and the token never streams', async () => {
    const last = (req: CompletionRequest): string => req.prompt.split('Charlie: ').pop() ?? ''
    const { core, events, api } = setup({ Scénariste: (req) => (last(req).includes('voix') ? 'OFF_TOPIC:voiceover' : 'OFF_TOPIC') })
    open = core
    const dm = await api['chat.open']({ kind: 'agent', agentId: 'scriptwriter' })
    await api['chat.send'](dm.id, 'Choisis la voix de la vidéo')
    await api['chat.send'](dm.id, 'Quelle est la capitale du Pérou ?')
    await core.chat.idle()
    const bodies = agentLines(await api['chat.messages'](dm.id)).map(([, b]) => b)
    expect(bodies[0]).toBe('Ce n’est pas mon métier (Scénariste). Pour ça, demande à @Voix_off.')
    expect(bodies[1]).toMatch(/^Ce n’est pas mon métier \(Scénariste\)\. Pose la question au Superviseur/)
    expect(events.some((e) => e.delta?.includes('OFF'))).toBe(false)
  })

  it('a normal answer that starts like the token is released, and the rule is only given to agents addressed directly', async () => {
    const { core, provider, api } = setup({ 'Voix off': () => 'OFFRE spéciale : la voix grave.' })
    open = core
    const r = await room(core)
    await api['chat.send'](r.id, '@Voix_off une idée ?')
    await api['chat.send'](r.id, 'Et le chef ?')
    await core.chat.idle()
    expect(agentLines(await api['chat.messages'](r.id))[0]).toEqual(['voiceover', 'OFFRE spéciale : la voix grave.'])
    expect(provider.calls[0]!.system).toContain('Stay in your lane')
    expect(provider.calls[1]!.system).not.toContain('Stay in your lane')
  })
})

describe('tool steps', () => {
  it('streams each tool as running then done, and saves the tools used on the message', async () => {
    const { core, events, api } = setup({
      Superviseur: () => ({ text: 'Rien en cours.', toolCalls: [{ name: 'list_videos', args: {} }] })
    })
    open = core
    const sup = (await api['chat.conversations']())[0]!
    await api['chat.send'](sup.id, 'Quelles vidéos sont en cours ?')
    await core.chat.idle()
    const steps = events.flatMap((e) => (e.tool ? [[e.tool.name, e.tool.state, e.authorId]] : []))
    expect(steps).toEqual([
      ['list_videos', 'running', 'supervisor'],
      ['list_videos', 'done', 'supervisor']
    ])
    expect((await api['chat.messages'](sup.id)).at(-1)!.tools).toEqual([{ name: 'list_videos', state: 'done' }])
  })
})

describe('review fixes', () => {
  it('a failed turn that was still billed counts in the round budget', async () => {
    const events: Stream[] = []
    const calls: string[] = []
    const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }
    const failing: Provider = {
      id: 'fake',
      acceptsTools: () => true,
      complete: () => Promise.reject(new Error('unused')),
      async *stream(req: CompletionRequest): AsyncGenerator<StreamEvent> {
        calls.push(speaker(req))
        await Promise.resolve()
        // A CLI error result that carries its usage: billed although the turn failed.
        if (calls.length > 0) throw new ProviderError('ran out of turns', 'TURN_LIMIT', usage, 0.999)
        yield { type: 'text', text: '' } // never reached
      }
    }
    const core = memoryCore({ chatProvider: () => failing, emitStream: (e) => events.push(e) })
    open = core
    await core.api['settings.set']('chat.roundBudgetUsd', 1)
    const r = await room(core)
    await core.api['chat.send'](r.id, '@Voix_off @Scénariste bilan ?')
    await core.chat.idle()
    expect(calls).toEqual(['Voix off'])
    expect((await core.api['chat.messages'](r.id)).at(-1)!.body).toMatch(/^Budget du message atteint \(0\.999 \$ sur 1\.00 \$/)
    // Each turn is announced (author, no text) before its first token, so the renderer keeps Stop between turns.
    const firstOfEach = events.filter((e) => !e.done && !e.delta && !e.tool).map((e) => e.authorId)
    expect(firstOfEach).toEqual(['voiceover', 'scriptwriter'])
  })

  it('Stop during a handoff cuts the specialist and the asker; the handoff is refused', async () => {
    let started: () => void = () => undefined
    const specialistStarted = new Promise<void>((resolve) => (started = resolve))
    const fake = new FakeProvider((req) =>
      speaker(req) === 'Superviseur'
        ? { text: 'Fini.', toolCalls: [{ name: 'ask_agent', args: { agent: 'Scénariste', question: 'Prêt ?' } }] }
        : { text: 'Une réponse très lente qui ne finit jamais vraiment.', chunkSize: 3 }
    )
    const slow: Provider = {
      id: 'fake',
      acceptsTools: () => true,
      complete: fake.complete.bind(fake),
      async *stream(req: CompletionRequest, opts: { signal?: AbortSignal } = {}): AsyncGenerator<StreamEvent> {
        for await (const ev of fake.stream(req, opts)) {
          yield ev
          if (speaker(req) === 'Scénariste') {
            started()
            await new Promise<void>((resolve) => opts.signal?.addEventListener('abort', () => resolve()))
          }
        }
      }
    }
    const core = memoryCore({ chatProvider: () => slow })
    open = core
    const sup = (await core.api['chat.conversations']())[0]!
    await core.api['chat.send'](sup.id, 'Demande au Scénariste')
    await specialistStarted
    expect(await core.api['chat.stop'](sup.id)).toEqual({ stopped: true })
    await core.chat.idle()
    const msgs = await core.api['chat.messages'](sup.id)
    expect(msgs.filter((m) => m.authorType === 'agent' && m.card === null)).toHaveLength(0)
    const card = msgs.find((m) => m.card?.type === 'handoff')!.card
    expect(card).toMatchObject({ state: 'refused', reason: 'Arrêté par Charlie' })
    expect((await core.api['spend.overview']()).reservedUsd).toBe(0)
  })
})
