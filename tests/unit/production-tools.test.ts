// Lot 13: the Supervisor's and the Opérateur production's tools over the ProductionPort (in-memory fake here, never a
// real run): quotes, proposal cards that start nothing until Charlie confirms, an expired quote, failures explained and
// a retry proposed; and a port that is not wired (no production tool, an honest prompt line).
import { describe, expect, it } from 'vitest'
import { FakeProvider, type FakeReply } from '../../src/main/llm/fake'
import type { CompletionRequest } from '../../src/main/llm/types'
import { MemoryProduction, MEMORY_QUOTE_TTL_MS } from '../../src/main/production/memory-port'
import { UnavailableProduction } from '../../src/main/production/port'
import { memoryCore } from './helpers'

const speaker = (req: CompletionRequest): string => /^You are the (.+?) of Atelier/.exec(req.system ?? '')?.[1] ?? '?'

function setup(withProduction = true) {
  let now = Date.now()
  const production = new MemoryProduction(() => now)
  const state: { respond: (req: CompletionRequest) => FakeReply | string } = { respond: () => 'ok' }
  const provider = new FakeProvider((req) => state.respond(req))
  // agents-production: the app's own port is wired now (AppProduction); `false` = a port that is not (UnavailableProduction)
  const core = memoryCore({ chatProvider: () => provider, production: withProduction ? production : new UnavailableProduction() })
  return { core, api: core.api, provider, production, state, tick: (ms: number) => (now += ms) }
}

async function videoOf(api: ReturnType<typeof memoryCore>['api'], name = 'Histoires') {
  const channel = await api['channels.create']({ name })
  const detail = await api['videos.create'](channel.id, { title: 'Ys, la ville engloutie' })
  return { channel, video: detail.video }
}

describe('Supervisor production tools', () => {
  it('run_pipeline posts a card with the quote; the run starts only when Charlie confirms', async () => {
    const ctx = setup()
    const { api, provider, production } = ctx
    const { video } = await videoOf(api)
    provider.calls.length = 0
    const replies: FakeReply = { text: 'Devis envoyé.', toolCalls: [{ name: 'run_pipeline', args: { video: video.id, mode: 'usage_max' } }] }
    const sup = (await api['chat.conversations']())[0]!
    ctx.state.respond = () => replies
    await api['chat.send'](sup.id, 'Produis la vidéo Ys en usage max')
    await ctx.core.chat.idle()
    expect(provider.toolResults[0]).toMatchObject({ name: 'run_pipeline', isError: false })
    expect(provider.toolResults[0]!.text).toMatch(/Proposal #\d+ posted with the quote \(32 credits\)\. Nothing starts unless Charlie confirms/)
    expect(production.calls).toEqual([`quotePipeline:${video.id}:usage_max`])
    expect(production.runs.size).toBe(0)
    const card = (await api['chat.messages'](sup.id)).find((m) => m.card?.type === 'proposal')!.card as { proposalId: number; title: string; detail: string }
    expect(card.title).toBe('Produire « Ys, la ville engloutie » (usage max) : 32 crédits')
    expect(card.detail).toMatch(/^Devis quote-\d+ : 32 crédits au total\./)

    const row = await api['proposals.decide'](card.proposalId, true)
    expect(row).toMatchObject({ status: 'accepted', kind: 'run_pipeline' })
    expect(row.payload.runId).toBe('run-2')
    expect(production.calls.at(-1)).toMatch(new RegExp(`^runPipeline:${video.id}:quote-1$`))
    expect((await api['chat.messages'](sup.id)).at(-1)!.body).toMatch(/Production lancée \(run-2\)/)
    ctx.core.close()
  })

  it('an expired quote cannot start a run: the proposal is marked expired', async () => {
    const ctx = setup()
    const { api, production } = ctx
    const { video } = await videoOf(api)
    ctx.state.respond = (): FakeReply => ({
      text: 'Voilà.',
      toolCalls: [{ name: 'run_pipeline', args: { video: video.id, mode: 'qualite_max' } }]
    })
    const sup = (await api['chat.conversations']())[0]!
    await api['chat.send'](sup.id, 'Produis Ys')
    await ctx.core.chat.idle()
    const card = (await api['chat.messages'](sup.id)).find((m) => m.card?.type === 'proposal')!.card as { proposalId: number }
    ctx.tick(MEMORY_QUOTE_TTL_MS)
    await expect(api['proposals.decide'](card.proposalId, true)).rejects.toThrow(/a expiré/)
    expect(production.runs.size).toBe(0)
    const after = (await api['chat.messages'](sup.id)).find((m) => m.card?.type === 'proposal')!.card as { status: string }
    expect(after.status).toBe('expired')
    ctx.core.close()
  })

  it('estimate quotes without starting anything; analyse_channel wants an https link and starts nothing when dismissed', async () => {
    const ctx = setup()
    const { api, provider, production } = ctx
    const { video } = await videoOf(api)
    ctx.state.respond = (): FakeReply => ({
      text: 'Fait.',
      toolCalls: [
        { name: 'estimate', args: { video: video.id, mode: 'qualite_max' } },
        { name: 'analyse_channel', args: { url: 'http://youtube.com/@x' } },
        { name: 'analyse_channel', args: { url: 'https://www.youtube.com/@exemple' } }
      ]
    })
    const sup = (await api['chat.conversations']())[0]!
    await api['chat.send'](sup.id, 'Combien pour Ys, et analyse cette chaîne')
    await ctx.core.chat.idle()
    expect(provider.toolResults.map((r) => r.isError)).toEqual([false, true, false])
    expect(provider.toolResults[0]!.text).toMatch(/^Quote quote-\d+: 190 credits .* Nothing was started\.$/)
    expect(provider.toolResults[1]!.text).toBe('url must be an https link')
    const card = (await api['chat.messages'](sup.id)).find((m) => m.card?.type === 'proposal')!.card as { proposalId: number; title: string }
    expect(card.title).toBe('Analyser https://www.youtube.com/@exemple : 5 crédits')
    await api['proposals.decide'](card.proposalId, false)
    expect(production.analyses).toHaveLength(0)
    expect(production.runs.size).toBe(0)
    ctx.core.close()
  })

  it('in a channel room, a video of another channel is refused', async () => {
    const ctx = setup()
    const { api, provider } = ctx
    const a = await videoOf(api, 'Histoires')
    const b = await videoOf(api, 'Sciences')
    ctx.state.respond = (): FakeReply => ({
      text: 'Non.',
      toolCalls: [{ name: 'run_pipeline', args: { video: b.video.id, mode: 'usage_max' } }]
    })
    const room = await api['chat.open']({ kind: 'room', channelId: a.channel.id, department: 'production' })
    await api['chat.send'](room.id, 'Lance la vidéo de Sciences')
    await ctx.core.chat.idle()
    expect(provider.toolResults[0]).toMatchObject({ isError: true, text: `Video #${b.video.id} belongs to another channel` })
    ctx.core.close()
  })
})

describe('Opérateur production', () => {
  it('reads a failed run, explains it and proposes a retry that Charlie confirms', async () => {
    const ctx = setup()
    const { api, provider, production } = ctx
    const { video } = await videoOf(api)
    const quote = await production.quotePipeline({ videoId: video.id, mode: 'usage_max' })
    const run = await production.runPipeline({ videoId: video.id, mode: 'usage_max' }, quote.id)
    production.fail(run.id, 'voice', 'Le fournisseur de voix a refusé le texte (trop long)', 'provider_refused')
    ctx.state.respond = (req: CompletionRequest): FakeReply | string =>
      speaker(req) === 'Opérateur production'
        ? {
            text: 'La voix a échoué : texte trop long. Je propose de relancer.',
            toolCalls: [
              { name: 'list_runs', args: { active: false } },
              { name: 'run_status', args: { run: run.id } },
              { name: 'retry_node', args: { run: run.id, node: 'voice', why: 'Le texte a été raccourci.' } },
              { name: 'retry_node', args: { run: run.id, node: 'script', why: 'x' } }
            ]
          }
        : 'ok'
    const dm = await api['chat.open']({ kind: 'agent', agentId: 'engine_operator' })
    await api['chat.send'](dm.id, 'Pourquoi la production de Ys est bloquée ?')
    await ctx.core.chat.idle()
    const [list, status, retry, wrong] = provider.toolResults
    // The fake names a run it started itself "Vidéo #<id>".
    expect(list!.text).toContain(`${run.id} "Vidéo #${video.id}" (video #${video.id}, modele-standard): error, 0 %, 0 credits — FAILED at voice: Le fournisseur de voix a refusé le texte (trop long)`)
    expect(status!.text).toContain('voice (voice.tts@1): error, 1 attempt(s) — permanent error provider_refused')
    expect(retry).toMatchObject({ isError: false })
    expect(wrong).toMatchObject({ isError: true, text: 'Node script is running: only a node in error can be retried' })
    // Nothing retried before the confirmation.
    expect(production.calls.filter((c) => c.startsWith('retryNode'))).toEqual([])
    const card = (await api['chat.messages'](dm.id)).find((m) => m.card?.type === 'proposal')!.card as { proposalId: number; title: string }
    expect(card.title).toBe(`Relancer l’étape voice de « Vidéo #${video.id} »`)
    await api['proposals.decide'](card.proposalId, true)
    expect(production.calls.at(-1)).toBe(`retryNode:${run.id}:voice`)
    expect((await production.runStatus(run.id)).state).toBe('running')
    ctx.core.close()
  })
})

describe('with a production port that is not wired', () => {
  it('offers no production tool but list_videos, and tells the model plainly', async () => {
    const ctx = setup(false)
    const { api, provider } = ctx
    expect(ctx.core.production.available).toBe(false)
    await videoOf(api)
    const sup = (await api['chat.conversations']())[0]!
    ctx.state.respond = (): FakeReply => ({
      text: 'Une vidéo en cours.',
      toolCalls: [{ name: 'list_videos', args: {} }, { name: 'run_pipeline', args: { video: 1, mode: 'usage_max' } }]
    })
    await api['chat.send'](sup.id, 'Où en est la production ?')
    await ctx.core.chat.idle()
    const names = provider.calls[0]!.tools!.specs.map((s) => s.name)
    expect(names).toContain('list_videos')
    for (const n of ['list_runs', 'run_status', 'estimate', 'analyse_channel', 'run_pipeline', 'retry_node', 'cancel_run']) expect(names).not.toContain(n)
    expect(provider.calls[0]!.system).toContain('Production runs (our own engine) are not connected yet')
    expect(provider.toolResults[0]!.text).toMatch(/^#\d+ "Ys, la ville engloutie" \(channel #\d+, idea\)\n {2}research: /)
    expect(provider.toolResults[1]).toEqual({ name: 'run_pipeline', text: 'Tool run_pipeline is not available in this run', isError: true })
    // A production proposal (from an older build) cannot be confirmed: it stays pending.
    const p = ctx.core.proposals.create({ conversationId: sup.id, authorId: 'supervisor', kind: 'run_pipeline', title: 'x', detail: 'y', data: { videoId: 1, mode: 'usage_max', quoteId: 'q' } })
    await expect(api['proposals.decide'](p.id, true)).rejects.toThrow(/pas encore branchée/)
    expect(ctx.core.proposals.get(p.id).status).toBe('pending')
    ctx.core.close()
  })
})
