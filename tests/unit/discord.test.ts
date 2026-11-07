// Atlas on Discord (src/main/discord) against an in-memory Discord (FakeDiscord: guilds, channels, messages, reactions
// behind the REST client's fetch). No network. Covers: the token (checked, encrypted, never echoed), the invitation, the
// idempotent setup, a Discord message reaching the runtime and the agent's reply coming back, approvals by reaction or
// reply, run announcements, the daily summary, the off-by-default switch, and the rate limit.
import { trackTemp } from '../setup/track-temp'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeDiscord, FAKE_APP_ID, FAKE_BOT, FAKE_OWNER_ID } from '../../src/main/discord/fake'
import { DiscordError, DiscordRest } from '../../src/main/discord/rest'
import { channelSlug } from '../../src/main/discord/setup'
import { PERMISSIONS } from '../../src/main/discord/types'
import { FakeProvider } from '../../src/main/llm/fake'
import { scriptedResponder } from '../../src/main/orchestra/fake-team'
import { memoryCore } from './helpers'

const TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OQ' + '.GabcDE.abcdefghijklmnopqrstuvwxyz0123456789'
const STRANGER = '800000000000000099'

/** Monday 26 October 2026, 07:00 local time. */
const T0 = new Date(2026, 9, 26, 7, 0, 0).getTime()

function rig() {
  let now = T0
  const fake = new FakeDiscord(TOKEN)
  const sleeps: number[] = []
  const core = memoryCore({
    now: () => new Date(now),
    orchestra: {
      cronUtc: true,
      dataDir: trackTemp(mkdtempSync(path.join(tmpdir(), 'atelier-discord-test-'))),
      providers: (a) => new FakeProvider((req) => scriptedResponder(req), `fake-${a.id}`)
    },
    discord: {
      fetch: fake.fetch,
      sleep: async (ms) => {
        sleeps.push(ms)
      }
    }
  })
  const wf = core.context.workflow
  const histoire = wf.channels.create({ name: 'Histoire' })
  const mysteres = wf.channels.create({ name: 'Mystères' })
  const guild = fake.addGuild('Atelier de Charlie')
  return {
    core,
    fake,
    guild,
    sleeps,
    histoire,
    mysteres,
    d: core.discord,
    advance: (ms: number) => void (now += ms),
    /** Token, setup, and a first pass that fixes the cursors. */
    async ready() {
      await core.discord.setToken(TOKEN)
      await core.discord.setup(guild.id)
      await core.discord.bridge.pollOnce()
      return core.discord.store.get()
    },
    async settle() {
      await core.orchestra.tick({ wait: true })
      await core.orchestra.tick({ wait: true })
    }
  }
}

const cores: ReturnType<typeof rig>[] = []
const make = (): ReturnType<typeof rig> => {
  const r = rig()
  cores.push(r)
  return r
}
afterEach(() => {
  for (const r of cores.splice(0)) r.core.close()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('token', () => {
  it('is checked with Discord, stored encrypted and never returned', async () => {
    const r = make()
    expect(r.d.status().tokenSet).toBe(false)
    await expect(r.d.setToken('pas un jeton')).rejects.toThrow(/jeton/i)
    const wrong = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OQ' + '.GabcDE.ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'
    const err = await r.d.setToken(wrong).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/refusé/)
    expect((err as Error).message).not.toContain(wrong)
    expect(r.d.status().tokenSet).toBe(false)

    const status = await r.d.setToken(`Bot ${TOKEN}`)
    expect(status).toMatchObject({ tokenSet: true, bot: { name: 'AtelierBot' }, applicationId: FAKE_APP_ID, enabled: false, running: false })
    expect(JSON.stringify(status)).not.toContain(TOKEN)
    // The ciphertext in the secrets table is not the token; the settings table does not hold it either.
    const rows = r.core.db.prepare('SELECT name, ciphertext FROM secrets').all() as { name: string; ciphertext: Uint8Array }[]
    expect(rows.map((x) => x.name)).toContain('discord.botToken')
    for (const row of rows) expect(Buffer.from(row.ciphertext).toString('utf8')).not.toContain(TOKEN)
    expect(JSON.stringify(r.core.db.prepare('SELECT * FROM settings').all())).not.toContain(TOKEN)

    const cleared = r.d.clearToken()
    expect(cleared).toMatchObject({ tokenSet: false, enabled: false })
  })

  it('stays out of IPC results, errors and logs, even when Discord echoes it back', async () => {
    const logs: string[] = []
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')))
    const r = make()
    await r.ready()
    // A server answer that quotes the token in its message.
    const leaking = new DiscordRest({
      token: () => TOKEN,
      fetch: async () => new Response(JSON.stringify({ message: `bad ${TOKEN} here`, code: 5 }), { status: 400 })
    })
    const err = await leaking.me().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DiscordError)
    expect((err as Error).message).not.toContain(TOKEN)
    const api = r.core.api
    const results = [await api['discord.status'](), await api['discord.inviteUrl'](), await api['discord.guilds'](), await api['settings.list']()]
    expect(JSON.stringify(results)).not.toContain(TOKEN)
    expect(logs.join('\n')).not.toContain(TOKEN)
    // Without a token the REST client refuses before any request.
    const none = new DiscordRest({ token: () => null, fetch: async () => new Response('{}') })
    await expect(none.me()).rejects.toThrow(/token/)
  })

  it('can not be written through the generic settings.set', async () => {
    const r = make()
    await expect(Promise.resolve().then(() => r.core.api['settings.set']('discord.enabled', true))).rejects.toThrow(/cannot be changed/)
  })
})

describe('invitation and setup', () => {
  it('builds the OAuth2 link: scope bot, view / send / manage channels / reactions / history', async () => {
    const r = make()
    await r.d.setToken(TOKEN)
    const { url, applicationId } = await r.d.inviteUrl()
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://discord.com/oauth2/authorize')
    expect(u.searchParams.get('client_id')).toBe(FAKE_APP_ID)
    expect(applicationId).toBe(FAKE_APP_ID)
    expect(u.searchParams.get('scope')).toBe('bot')
    const bits = Number(u.searchParams.get('permissions'))
    expect(bits).toBe(PERMISSIONS)
    for (const bit of [1 << 10, 1 << 11, 1 << 4, 1 << 16]) expect(bits & bit).toBe(bit)
    expect(await r.d.guilds()).toEqual([{ id: r.guild.id, name: 'Atelier de Charlie', owner: false }])
  })

  it('creates the category and the channels once, and reuses them the second time', async () => {
    const r = make()
    await r.d.setToken(TOKEN)
    const first = await r.d.setup(r.guild.id)
    // category + atlas + à-valider + production + one room per YouTube channel
    expect(first).toMatchObject({ created: 6, reused: 0, guild: { name: 'Atelier de Charlie' } })
    const all = r.fake.channels.get(r.guild.id) ?? []
    const category = all.find((c) => c.type === 4 && c.name === 'Atelier')
    expect(category).toBeDefined()
    expect(all.filter((c) => c.type === 0).map((c) => [c.name, c.parent_id])).toEqual([
      ['atlas', category?.id],
      ['à-valider', category?.id],
      ['production', category?.id],
      ['histoire', category?.id],
      ['mystères', category?.id]
    ])
    expect(first.channels.map((c) => [c.key, c.name])).toEqual([['atlas', 'atlas'], ['approvals', 'à-valider'], ['production', 'production'], ['room', 'histoire'], ['room', 'mystères']])
    expect(first.channels.find((c) => c.name === 'histoire')?.channelId).toBe(r.histoire.id)
    // Each new channel got a welcome line from the bot.
    expect(r.fake.botMessages(r.fake.channel(r.guild.id, 'atlas')?.id as string)).toHaveLength(1)
    // The owner of the server is the person allowed to talk to Atlas.
    expect(r.d.status().allowedUserIds).toEqual([FAKE_OWNER_ID])

    const before = all.length
    const second = await r.d.setup(r.guild.id)
    expect(second).toMatchObject({ created: 0, reused: 6 })
    expect(r.fake.channels.get(r.guild.id)).toHaveLength(before)

    // Only what is missing is created again (a channel deleted by hand).
    const mid = r.fake.channels.get(r.guild.id) as { id: string; name: string }[]
    mid.splice(mid.findIndex((c) => c.name === 'production'), 1)
    const third = await r.d.setup(r.guild.id)
    expect(third).toMatchObject({ created: 1, reused: 5 })
    expect(mid.filter((c) => c.name === 'production')).toHaveLength(1)
  })

  it('reuses channels with the right names that were created without it, and picks up a new YouTube channel', async () => {
    const r = make()
    await r.d.setToken(TOKEN)
    const category = await r.d.rest.createCategory(r.guild.id, 'atelier')
    await r.d.rest.createTextChannel(r.guild.id, 'atlas', category.id, '')
    const res = await r.d.setup(r.guild.id)
    expect(res.created).toBe(4)
    expect(res.reused).toBe(2)
    r.core.context.workflow.channels.create({ name: 'Space Shorts' })
    expect(await r.d.setup(r.guild.id)).toMatchObject({ created: 1 })
    expect(r.fake.channel(r.guild.id, 'space-shorts')).toBeDefined()
  })

  it('refuses a server the bot is not in, and names collide safely', async () => {
    const r = make()
    await r.d.setToken(TOKEN)
    await expect(r.d.setup('123456789012345678')).rejects.toThrow(/pas dans ce serveur/)
    await expect(r.d.setup('x')).rejects.toThrow(/invalide/)
    expect(channelSlug('Mes Vidéos  Histoire!')).toBe('mes-vidéos-histoire')
    r.core.context.workflow.channels.create({ name: 'Production' })
    await r.d.setup(r.guild.id)
    expect(r.fake.channel(r.guild.id, 'chaine-production')).toBeDefined()
  })
})

describe('Discord → Atlas → Discord', () => {
  it('a message in #atlas reaches the runtime like the app does, and the reply is posted back', async () => {
    const r = make()
    const st = await r.ready()
    const atlas = st.atlasId as string
    r.fake.say(atlas, FAKE_OWNER_ID, 'Salut Atlas, où en est la semaine ?')
    await r.d.bridge.pollOnce()

    const principal = r.core.orchestra.agents().find((a) => a.role === 'principal')
    const tasks = r.core.orchestra.tasks({ kind: 'mention' })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ assigneeId: principal?.id, status: 'queued' })
    // Posted in the Supervisor conversation as the owner, with the @mention the app adds.
    const supervisor = r.core.chat.store.open({ kind: 'supervisor' }).id
    const said = r.core.chat.store.messages(supervisor).filter((m) => m.authorType === 'owner')
    expect(said).toHaveLength(1)
    expect(said[0]?.body).toContain('Salut Atlas, où en est la semaine ?')

    await r.settle()
    await r.d.bridge.pollOnce()
    const mine = r.fake.botMessages(atlas).map((m) => m.content)
    expect(mine.some((c) => c.includes('Message reçu et pris en compte.') && c.includes(principal?.name as string))).toBe(true)
    // Charlie's own words are not echoed back to Discord.
    expect(mine.some((c) => c.includes('Salut Atlas'))).toBe(false)
    // Acknowledged with an eyes reaction, and read only once.
    await r.d.bridge.pollOnce()
    expect(r.core.orchestra.tasks({ kind: 'mention' })).toHaveLength(1)
    expect(r.fake.botMessages(atlas).map((m) => m.content).filter((c) => c.includes('Message reçu et pris en compte.'))).toHaveLength(1)
  })

  it('a channel room talks to that channel\'s lead', async () => {
    const r = make()
    const st = await r.ready()
    const room = st.rooms[String(r.histoire.id)]?.discordId as string
    r.fake.say(room, FAKE_OWNER_ID, 'Quels sujets pour Histoire ?')
    await r.d.bridge.pollOnce()
    const lead = r.core.orchestra.agents().find((a) => a.role === 'channel_lead' && a.channelId === r.histoire.id)
    const tasks = r.core.orchestra.tasks({ kind: 'mention' })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.assigneeId).toBe(lead?.id)
    await r.settle()
    await r.d.bridge.pollOnce()
    expect(r.fake.botMessages(room).some((m) => m.content.includes('Message reçu et pris en compte.'))).toBe(true)
    // …and nothing leaked into the other rooms.
    expect(r.fake.botMessages(st.atlasId as string).some((m) => m.content.includes('Message reçu et pris en compte.'))).toBe(false)
  })

  it('ignores bots and people who are not allowed; allowing someone else works', async () => {
    const r = make()
    const st = await r.ready()
    const atlas = st.atlasId as string
    r.fake.say(atlas, STRANGER, 'Je ne suis pas autorisé')
    r.fake.say(atlas, FAKE_BOT.id, 'écho du bot')
    r.fake.say(atlas, '800000000000000050', 'autre bot', { author: { id: '800000000000000050', username: 'autre', bot: true } })
    await r.d.bridge.pollOnce()
    expect(r.core.orchestra.tasks({ kind: 'mention' })).toHaveLength(0)
    expect(() => r.d.configure({ allowedUserIds: ['pas un id'] })).toThrow(/identifiant/i)
    r.d.configure({ allowedUserIds: [FAKE_OWNER_ID, STRANGER] })
    r.fake.say(atlas, STRANGER, 'Maintenant oui')
    await r.d.bridge.pollOnce()
    expect(r.core.orchestra.tasks({ kind: 'mention' })).toHaveLength(1)
  })

  it('mirrors what Charlie writes in the app, and flags a missing Message Content Intent', async () => {
    const r = make()
    const st = await r.ready()
    const atlas = st.atlasId as string
    const supervisor = r.core.chat.store.open({ kind: 'supervisor' }).id
    r.core.chat.store.post(supervisor, { authorType: 'owner', body: 'Un mot depuis l’app' })
    r.core.chat.store.post(supervisor, { authorType: 'system', body: 'Le travail reprend.' })
    await r.d.bridge.pollOnce()
    const mine = r.fake.botMessages(atlas).map((m) => m.content)
    expect(mine.some((c) => c.includes('Un mot depuis l’app') && c.includes('dans l’app'))).toBe(true)
    expect(mine).toContain('*Le travail reprend.*')

    expect(r.d.status().contentIntentMissing).toBe(false)
    r.fake.say(atlas, FAKE_OWNER_ID, '')
    await r.d.bridge.pollOnce()
    expect(r.d.status().contentIntentMissing).toBe(true)
  })

  it('splits long replies under the 2000-character limit', async () => {
    const r = make()
    const st = await r.ready()
    const supervisor = r.core.chat.store.open({ kind: 'supervisor' }).id
    const a = r.core.orchestra.agents().find((x) => x.role === 'principal')
    r.core.chat.store.post(supervisor, { authorType: 'agent', authorId: `orch:${a?.slug}`, body: 'mot '.repeat(1200) })
    await r.d.bridge.pollOnce()
    const parts = r.fake.botMessages(st.atlasId as string).filter((m) => m.content.includes('mot mot'))
    expect(parts.length).toBeGreaterThan(2)
    for (const p of parts) expect(p.content.length).toBeLessThanOrEqual(2000)
  })
})

describe('approvals', () => {
  it('posts an inbox item in #à-valider and applies ✅ / ❌ from an allowed person only', async () => {
    const r = make()
    const st = await r.ready()
    const approvals = st.approvalsId as string
    const principal = r.core.orchestra.agents().find((a) => a.role === 'principal')
    const inbox = r.core.orchestra.parts.inbox
    const yes = inbox.add({ taskId: null, agentId: principal?.id ?? null, kind: 'validate', title: 'Sujets de la semaine', body: 'Atlantis, Pompéi', options: ['Valider', 'Revoir'] })
    const no = inbox.add({ taskId: null, agentId: principal?.id ?? null, kind: 'validate', title: 'Titre de la vidéo', options: ['Valider', 'Revoir'] })
    await r.d.bridge.pollOnce()
    const posted = r.fake.botMessages(approvals).filter((m) => m.content.includes('Question'))
    expect(posted).toHaveLength(2)
    const yesMsg = posted.find((m) => m.content.includes('Sujets de la semaine')) as { id: string }
    const noMsg = posted.find((m) => m.content.includes('Titre de la vidéo')) as { id: string }
    // The bot put the two reactions itself.
    expect(r.fake.reactions.get(`${approvals}/${yesMsg.id}/✅`)?.map((u) => u.id)).toEqual([FAKE_BOT.id])
    expect(r.fake.reactions.get(`${approvals}/${yesMsg.id}/❌`)?.map((u) => u.id)).toEqual([FAKE_BOT.id])
    // Posted once, not on every pass.
    await r.d.bridge.pollOnce()
    expect(r.fake.botMessages(approvals).filter((m) => m.content.includes('Question'))).toHaveLength(2)

    r.fake.react(approvals, yesMsg.id, '✅', STRANGER)
    await r.d.bridge.pollOnce()
    expect(inbox.get(yes.id).status).toBe('open')

    r.fake.react(approvals, yesMsg.id, '✅', FAKE_OWNER_ID)
    r.fake.react(approvals, noMsg.id, '❌', FAKE_OWNER_ID)
    await r.d.bridge.pollOnce()
    expect(inbox.get(yes.id)).toMatchObject({ status: 'answered', answer: { choice: 'Valider' } })
    expect(inbox.get(no.id)).toMatchObject({ status: 'answered', answer: { choice: 'Revoir' } })
    expect(r.fake.botMessages(approvals).some((m) => m.content.includes('Réponse envoyée : Sujets de la semaine'))).toBe(true)
  })

  it('answers an input question with a reply, and forgets what was settled in the app', async () => {
    const r = make()
    const st = await r.ready()
    const approvals = st.approvalsId as string
    const inbox = r.core.orchestra.parts.inbox
    const ask = inbox.add({ taskId: null, agentId: null, kind: 'input', title: 'Quel angle pour Pompéi ?' })
    const other = inbox.add({ taskId: null, agentId: null, kind: 'input', title: 'Budget du mois ?' })
    await r.d.bridge.pollOnce()
    const msg = r.fake.botMessages(approvals).find((m) => m.content.includes('Quel angle')) as { id: string }
    expect(r.fake.reactions.has(`${approvals}/${msg.id}/✅`)).toBe(false)
    r.fake.say(approvals, FAKE_OWNER_ID, 'Le dernier jour', { message_reference: { message_id: msg.id } })
    // The other one is answered in the app.
    r.core.orchestra.answer(other.id, { text: 'cinquante' })
    await r.d.bridge.pollOnce()
    expect(inbox.get(ask.id)).toMatchObject({ status: 'answered', answer: { text: 'Le dernier jour' } })
    expect(Object.keys(r.core.discord.store.get().posted)).toHaveLength(0)
  })

  it('approves or sends back a deliverable and a production gate through the same services as the app', async () => {
    const r = make()
    const st = await r.ready()
    const approvals = st.approvalsId as string
    const wf = r.core.context.workflow
    const video = wf.createVideo(r.histoire.id, { title: 'Atlantis' }).video
    const deliverable = (type: string) => wf.listDeliverables(video.id).find((x) => x.type === type)!
    const task = (type: string) => wf.listTasks({ videoId: video.id }).find((t) => t.deliverableId === deliverable(type).id)!
    wf.claimTask(task('research').id)
    wf.submitVersion(deliverable('research').id, { content: 'recherche', costUsd: 0, author: 'test' })
    wf.claimTask(task('thumbnail_brief').id)
    wf.submitVersion(deliverable('thumbnail_brief').id, { content: 'Un temple englouti, lumière bleue', costUsd: 0, author: 'test' })
    expect(wf.pendingApprovals()).toHaveLength(1)

    // A production gate waiting (the engine itself is not started: its two services are observed).
    const runs = r.core.context.productionRuns
    const summary = { id: 7, status: 'waiting', waitingNodes: ['script'], videoTitle: 'Atlantis', channelName: 'Histoire', error: null }
    vi.spyOn(runs, 'list').mockImplementation((filter?: unknown) => ((filter as { status?: unknown } | undefined)?.status ? [summary as never] : [summary as never]))
    vi.spyOn(runs, 'get').mockReturnValue({ nodes: [{ nodeId: 'script', label: 'Script', gate: 'waiting', gateKind: 'review', step: null }] } as never)
    const approve = vi.spyOn(runs, 'approve').mockReturnValue({} as never)
    const changes = vi.spyOn(runs, 'requestChanges').mockReturnValue({} as never)

    await r.d.bridge.pollOnce()
    const messages = r.fake.botMessages(approvals)
    const deliv = messages.find((m) => m.content.includes('Brief de miniature')) as { id: string; content: string }
    const gate = messages.find((m) => m.content.includes('Étape à valider')) as { id: string }
    expect(deliv.content).toContain('Un temple englouti')
    r.fake.react(approvals, deliv.id, '✅', FAKE_OWNER_ID)
    r.fake.react(approvals, gate.id, '❌', FAKE_OWNER_ID)
    await r.d.bridge.pollOnce()
    expect(wf.pendingApprovals()).toHaveLength(0)
    expect(wf.listApprovals(deliverable('thumbnail_brief').id)[0]).toMatchObject({ decision: 'approved', decidedBy: 'owner' })
    expect(approve).not.toHaveBeenCalled()
    expect(changes).toHaveBeenCalledWith(7, 'script', expect.stringContaining('Discord'))

    // A reply on a gate approves nothing but sends the note back.
    changes.mockClear()
    summary.id = 8
    await r.d.bridge.pollOnce()
    const gate2 = r.fake.botMessages(approvals).filter((m) => m.content.includes('Étape à valider')).at(-1) as { id: string }
    r.fake.react(approvals, gate2.id, '✅', FAKE_OWNER_ID)
    await r.d.bridge.pollOnce()
    expect(approve).toHaveBeenCalledWith(8, 'script')
  })
})

describe('productions and the daily summary', () => {
  it('announces runs started, blocked, finished and failed in #production, without replaying old ones', async () => {
    const r = make()
    const st = await r.ready()
    const production = st.productionId as string
    const run = { id: 1, status: 'succeeded', waitingNodes: [] as string[], videoTitle: 'Vieille vidéo', channelName: 'Histoire', error: null as string | null }
    const list = vi.spyOn(r.core.context.productionRuns, 'list').mockImplementation(() => [run as never])
    await r.d.bridge.pollOnce()
    const lines = (): string[] => r.fake.botMessages(production).map((m) => m.content)
    expect(lines().filter((l) => l.includes('Vieille vidéo'))).toHaveLength(0)

    Object.assign(run, { id: 2, status: 'running', videoTitle: 'Atlantis' })
    await r.d.bridge.pollOnce()
    expect(lines().at(-1)).toContain('la fabrication démarre')
    Object.assign(run, { status: 'waiting', waitingNodes: ['script'] })
    list.mockImplementation(() => [run as never])
    await r.d.bridge.pollOnce()
    expect(lines().at(-1)).toContain('attend ta validation (script)')
    Object.assign(run, { status: 'running', waitingNodes: [] })
    await r.d.bridge.pollOnce()
    expect(lines().filter((l) => l.includes('démarre'))).toHaveLength(1) // resumed after approval: no second "started"
    Object.assign(run, { status: 'failed', error: 'ffmpeg manquant' })
    await r.d.bridge.pollOnce()
    expect(lines().at(-1)).toMatch(/échec.*ffmpeg manquant/)
    await r.d.bridge.pollOnce()
    expect(lines().filter((l) => l.includes('ffmpeg manquant'))).toHaveLength(1)
    Object.assign(run, { id: 3, status: 'running', videoTitle: 'Pompéi', error: null })
    await r.d.bridge.pollOnce()
    Object.assign(run, { status: 'succeeded' })
    await r.d.bridge.pollOnce()
    expect(lines().at(-1)).toContain('Pompéi')
    expect(lines().at(-1)).toContain('fabrication terminée')
  })

  it('posts the summary once a day at the chosen hour', async () => {
    const r = make()
    const st = await r.ready() // 07:00, summary at 08:00 by default
    const atlas = st.atlasId as string
    const wf = r.core.context.workflow
    const video = wf.createVideo(r.histoire.id, { title: 'Atlantis' }).video
    wf.claimTask(wf.listTasks({ videoId: video.id })[0]!.id)
    const summaries = (): string[] => r.fake.botMessages(atlas).map((m) => m.content).filter((c) => c.includes('Résumé du jour'))
    await r.d.bridge.pollOnce()
    expect(summaries()).toHaveLength(0)
    r.advance(65 * 60 * 1000) // 08:05
    await r.d.bridge.pollOnce()
    expect(summaries()).toHaveLength(1)
    expect(summaries()[0]).toMatch(/À valider\*\* : 0/)
    expect(summaries()[0]).toMatch(/En production\*\* : 1/)
    expect(summaries()[0]).toContain('Publiées cette semaine')
    await r.d.bridge.pollOnce()
    expect(summaries()).toHaveLength(1)
    r.advance(24 * 3600 * 1000)
    await r.d.bridge.pollOnce()
    expect(summaries()).toHaveLength(2)
    r.d.configure({ summaryHour: null })
    r.advance(24 * 3600 * 1000)
    await r.d.bridge.pollOnce()
    expect(summaries()).toHaveLength(2)
    expect(() => r.d.configure({ summaryHour: 24 })).toThrow(/0 à 23/)
  })
})

describe('off by default', () => {
  it('runs nothing without a token, created channels and the switch', async () => {
    vi.useFakeTimers()
    const r = make()
    expect(r.d.status()).toMatchObject({ tokenSet: false, enabled: false, running: false, channels: [], guild: null })
    expect(() => r.d.setEnabled(true)).toThrow(/jeton/)
    await r.d.setToken(TOKEN)
    expect(() => r.d.setEnabled(true)).toThrow(/salons/)
    await r.d.setup(r.guild.id)
    const callsBefore = r.fake.calls.length
    await r.d.bridge.pollOnce()
    expect(r.d.status().running).toBe(false)
    expect(r.fake.calls.length).toBeGreaterThan(callsBefore) // a manual pass works, but nothing started it
    expect(r.d.status().teamOn).toBe(false)

    const on = r.d.setEnabled(true)
    expect(on).toMatchObject({ enabled: true, running: true })
    expect(r.d.setEnabled(false)).toMatchObject({ enabled: false, running: false })
    // The app starts the bridge again only when it was left on.
    r.d.setEnabled(true)
    r.d.close()
    expect(r.d.status().running).toBe(false)
    r.d.start()
    expect(r.d.status().running).toBe(true)
    r.d.close()
  })

  it('a pass on a refused token stops the loop and reports it without the token', async () => {
    vi.useFakeTimers()
    const r = make()
    await r.ready()
    r.d.setEnabled(true)
    expect(r.d.status().running).toBe(true)
    const token = TOKEN
    Object.defineProperty(r.fake, 'token', { value: 'autre' })
    await r.d.bridge.pollOnce()
    const status = r.d.status()
    expect(status.running).toBe(false)
    expect(status.lastError).toMatch(/401|Unauthorized/)
    expect(status.lastError).not.toContain(token)
  })
})

describe('rate limits', () => {
  it('retries a 429 after retry-after', async () => {
    const r = make()
    await r.d.setToken(TOKEN)
    r.fake.rateLimit(2, 3)
    const me = await r.d.rest.me()
    expect(me.username).toBe('AtelierBot')
    expect(r.sleeps).toEqual([3000, 3000])
    // Gives up after the retries, with a token-free error.
    r.fake.rateLimit(10, 1)
    await expect(r.d.rest.me()).rejects.toThrow(/rate limited/)
  })

  it('reads retry_after from the body and waits for an empty bucket before the next call', async () => {
    let at = 1000
    const slept: number[] = []
    const answers: Response[] = [
      new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429 }),
      new Response('{"id":"1","username":"x","bot":true}', { status: 200, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '2' } }),
      new Response('{"id":"1","username":"x","bot":true}', { status: 200 })
    ]
    const rest = new DiscordRest({
      token: () => TOKEN,
      fetch: async () => answers.shift() as Response,
      sleep: async (ms) => void slept.push(ms),
      now: () => at
    })
    await rest.me()
    expect(slept).toEqual([1500])
    await rest.me()
    expect(slept).toEqual([1500, 2000])
    at += 5000
    expect(answers).toHaveLength(0)
  })
})
