// agents-4 (A4): Charlie and the team on the phone (docs/AGENT-RUNTIME.md §27). A question of the team reaches Discord in
// #à-valider with its buttons and a ping, in its own thread; « Valider une fois / Refuser / Toujours valider » arrive as
// button clicks over the gateway; « toujours » writes a standing-allow rule the approval-level check reads, so the next
// question of that type is approved without asking; replies in the thread reach the agent like `orchestra.say` and its
// answer comes back there; only what waits for a decision pings the phone; the daily digest and the weekly report are
// computed from the real state, in the app and on Discord. In-memory Discord (FakeDiscord + its gateway socket), fake
// providers and the fake clock only: no network, no model.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AllowAlwaysResult, TeamReport } from '../../src/shared/api/autopilot'
import { handleCall } from '../../src/main/ipc'
import { FakeDiscord, FAKE_BOT, FAKE_OWNER_ID } from '../../src/main/discord/fake'
import { CHANNEL_PUBLIC_THREAD, FLAG_EPHEMERAL, FLAG_SUPPRESS_NOTIFICATIONS, type DiscordMessage } from '../../src/main/discord/types'
import { FakeProvider } from '../../src/main/llm/fake'
import { readPrompt } from '../../src/main/orchestra/fake-team'
import { iso } from '../../src/main/orchestra/util'
import { agentBySlug, rig, type Rig } from './orchestra-helpers'

const TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OQ' + '.GabcDE.abcdefghijklmnopqrstuvwxyz0123456789'
const STRANGER = '800000000000000099'
const HOUR = 3_600_000
const DAY = 24 * HOUR
const block = (actions: unknown[]): string => `\n\n\`\`\`atelier\n${JSON.stringify({ actions })}\n\`\`\``

/**
 * The lead asks a validation whose gate (and series) is in the task's brief, `gate|series`; a message from Charlie is
 * answered; an answer (Charlie's, the level's or a rule's) lets the task finish.
 */
function asker() {
  return new FakeProvider((req) => {
    const s = readPrompt(req.system ?? '', req.prompt)
    if (s.kind === 'mention') return 'Bien noté : je garde Ramsès pour la suite de la série.' + block([{ type: 'done', result: 'Bien noté : je garde Ramsès pour la suite de la série.' }])
    if (s.answered || req.prompt.includes('Approved by')) return 'Validé, je continue.' + block([{ type: 'done', result: 'continué' }])
    const [gate, series] = s.brief.split('|')
    return 'À valider.' + block([{ type: 'ask_human', kind: 'validate', title: s.title, question: `Valider : ${s.title} ?`, options: ['Valider', 'Revoir'], gate, ...(series ? { series } : {}) }])
  })
}

interface Phone {
  r: Rig
  fake: FakeDiscord
  channel: number
  lead: ReturnType<typeof agentBySlug>
  approvals: string
  /** One full pass of the bridge (after the one that may be running). */
  pass(): Promise<void>
  ask(title: string, brief: string): ReturnType<Rig['core']['orchestra']['enqueue']>
  ticks(n?: number): Promise<void>
  /** The bot's open question messages in #à-valider. */
  questions(): DiscordMessage[]
}

const made: Rig[] = []
afterEach(() => {
  for (const r of made.splice(0)) r.core.close()
  vi.restoreAllMocks()
})

async function phone(opts: { buttons?: boolean } = {}): Promise<Phone> {
  const fake = new FakeDiscord(TOKEN)
  const guild = fake.addGuild('Atelier de Charlie')
  const r = rig({
    providerFor: () => asker(),
    core: { discord: { fetch: fake.fetch, sleep: async () => undefined, intervalMs: 3_600_000, socket: opts.buttons === false ? null : fake.gateway() } }
  })
  made.push(r)
  const d = r.core.discord
  await d.setToken(TOKEN)
  // No summary and no weekly report until a test asks for them (#atlas stays quiet).
  d.configure({ summaryHour: null, weeklyDay: null })
  await d.setup(guild.id)
  const pass = async (): Promise<void> => {
    await d.bridge.pollOnce()
    await d.bridge.pollOnce()
  }
  await pass()
  if (opts.buttons !== false) {
    d.setEnabled(true)
    await vi.waitFor(() => expect(d.status().buttonsLive).toBe(true))
  }
  const channel = r.channels[0]!
  // Recommended level: topics and thumbnails ask Charlie (not confirmed: the planner stays out of these tests).
  r.core.orchestra.parts.goals.save(channel, { level: 'recommended' })
  const approvals = d.store.get().approvalsId as string
  const o = r.core.orchestra
  return {
    r,
    fake,
    channel,
    lead: agentBySlug(r, `lead-${channel}`),
    approvals,
    pass,
    ask: (title, brief) => o.enqueue({ assigneeId: agentBySlug(r, `lead-${channel}`).id, kind: 'plan', title, brief }),
    ticks: async (n = 2) => {
      for (let i = 0; i < n; i++) await o.tick({ wait: true })
    },
    questions: () => fake.botMessages(approvals).filter((m) => m.content.includes('**Question**'))
  }
}

const buttonIds = (m: DiscordMessage | undefined): string[] => (m?.components ?? []).flatMap((row) => row.components.map((b) => b.custom_id))
const buttonLabels = (m: DiscordMessage | undefined): string[] => (m?.components ?? []).flatMap((row) => row.components.map((b) => b.label))

describe('a question reaches the phone', () => {
  it('in #à-valider with its buttons and a ping, in its own thread; a word in the thread answers it', async () => {
    const p = await phone()
    const o = p.r.core.orchestra
    const task = p.ask('Sujet : Ramsès II', 'topic|Égypte antique')
    await p.ticks(1)
    expect(o.parts.queue.get(task.id).status).toBe('waiting_human')
    const item = o.inbox().find((i) => i.taskId === task.id)!
    expect(item).toMatchObject({ gate: 'topic', channelId: p.channel, series: 'Égypte antique' })

    await p.pass()
    const [msg] = p.questions()
    expect(msg?.content).toContain('Sujet : Ramsès II')
    expect(msg?.content).toContain('Étape : sujets · série « Égypte antique »')
    expect(buttonLabels(msg)).toEqual(['Valider une fois', 'Refuser', 'Toujours valider : sujets', 'Toujours : série « Égypte antique »'])
    // It matters: Charlie's phone is pinged (not a silent post); the buttons are live, so no ✅ ❌ fallback.
    expect(p.fake.mentions.get(msg!.id)).toEqual([FAKE_OWNER_ID])
    expect(msg?.content.startsWith(`<@${FAKE_OWNER_ID}>`)).toBe(true)
    expect(msg?.flags).toBeUndefined()
    expect(p.fake.reactions.has(`${p.approvals}/${msg!.id}/✅`)).toBe(false)

    // Its thread: started on the message, with a first line that says who answers there.
    const guildChannels = [...p.fake.channels.values()].flat()
    const thread = guildChannels.find((c) => c.id === msg!.id)
    expect(thread).toMatchObject({ type: CHANNEL_PUBLIC_THREAD, parent_id: p.approvals, name: 'Sujet : Ramsès II' })
    expect(p.fake.botMessages(thread!.id)[0]?.content).toContain(p.lead.name)
    // Posted once, not on every pass.
    await p.pass()
    expect(p.questions()).toHaveLength(1)

    // Charlie answers in the thread: that is his answer, the task resumes with it.
    p.fake.say(thread!.id, FAKE_OWNER_ID, 'Plutôt sous l’angle des batailles')
    await p.pass()
    expect(o.parts.inbox.get(item.id)).toMatchObject({ status: 'answered', answer: { text: 'Plutôt sous l’angle des batailles' } })
    expect(p.fake.botMessages(thread!.id).at(-1)?.content).toContain('Réponse envoyée')
    // Its buttons are gone from the message.
    expect(p.fake.message(msg!.id)?.components).toEqual([])
    await p.ticks(1)
    expect(o.parts.queue.get(task.id)).toMatchObject({ status: 'done', result: 'continué' })
    // A thread deleted in Discord is let go, without an error on every pass.
    for (const list of p.fake.channels.values()) {
      const i = list.findIndex((c) => c.id === thread!.id)
      if (i >= 0) list.splice(i, 1)
    }
    await p.pass()
    expect(p.r.core.discord.store.get().threads[thread!.id]).toBeUndefined()
    expect(p.r.core.discord.status().lastError).toBeNull()
  })

  it('a word in the thread after the question goes to the agent who asked, and its answer comes back in the thread', async () => {
    const p = await phone()
    const o = p.r.core.orchestra
    p.ask('Sujet : Ramsès II', 'topic|Égypte antique')
    await p.ticks(1)
    await p.pass()
    const [msg] = p.questions()
    p.fake.click(msg!.id, 'atl:yes', FAKE_OWNER_ID)
    await vi.waitFor(() => expect(p.fake.callbacks).toHaveLength(1))
    p.fake.say(msg!.id, FAKE_OWNER_ID, 'Et garde Ramsès pour toute la série')
    await p.pass()
    // Like the app's « écrire à l'agent »: an @mention of the lead in the channel's room.
    const room = p.r.core.context.chat.store.open({ kind: 'channel', channelId: p.channel })
    expect(p.r.core.context.chat.store.messages(room.id).some((m) => m.authorType === 'owner' && m.body.includes('Et garde Ramsès'))).toBe(true)
    await p.ticks(2)
    await p.pass()
    const back = p.fake.botMessages(msg!.id).at(-1)
    expect(back?.content).toContain(p.lead.name)
    expect(back?.content).toContain('je garde Ramsès')
    // An agent's answer to Charlie's own message pings him; the room mirror stays silent.
    expect(back?.flags).toBeUndefined()
    const roomId = p.r.core.discord.store.get().rooms[String(p.channel)]!.discordId
    const mirrored = p.fake.botMessages(roomId).filter((m) => m.content.includes('je garde Ramsès'))
    expect(mirrored.length).toBeGreaterThan(0)
    for (const m of mirrored) expect(m.flags).toBe(FLAG_SUPPRESS_NOTIFICATIONS)
    expect(o.inbox()).toHaveLength(0)
  })
})

describe('« Toujours valider pour ce type »', () => {
  it('creates the rule, and the next question of that type is approved without asking', async () => {
    const p = await phone()
    const o = p.r.core.orchestra
    const first = p.ask('Sujet : Ramsès II', 'topic|Égypte antique')
    await p.ticks(1)
    await p.pass()
    const [msg] = p.questions()
    p.fake.click(msg!.id, 'atl:always', FAKE_OWNER_ID)
    await vi.waitFor(() => expect(p.fake.callbacks).toHaveLength(1))
    // The message itself says what happened and loses its buttons.
    expect(p.fake.callbacks[0]).toMatchObject({ type: 7, data: { components: [] } })
    expect(String(p.fake.callbacks[0]!.data.content)).toContain('Règle « toujours » : sujets')
    const [rule] = o.parts.allow.list(p.channel)
    expect(rule).toMatchObject({ channelId: p.channel, gate: 'topic', series: null, maxUses: null, uses: 0 })
    // That question was Charlie's yes (its first option).
    expect(o.parts.inbox.get(o.inbox(true).find((i) => i.taskId === first.id)!.id)).toMatchObject({ status: 'answered', answer: { choice: 'Valider' } })
    await p.ticks(1)
    expect(o.parts.queue.get(first.id).status).toBe('done')

    // The next topic of that channel: approved at once, nothing in the inbox, nothing on the phone.
    const next = p.ask('Sujet : Cléopâtre', 'topic')
    await p.ticks(2)
    expect(o.parts.queue.get(next.id)).toMatchObject({ status: 'done', result: 'continué' })
    expect(o.inbox()).toHaveLength(0)
    expect(o.events(0, 2000).some((e) => e.type === 'auto-approved' && e.text.includes('standing rule'))).toBe(true)
    expect(o.parts.allow.get(rule!.id).uses).toBe(1)
    await p.pass()
    expect(p.questions()).toHaveLength(1)
    const report = await call<TeamReport>(p.r, 'autopilot.report', 'daily')
    expect(report.autoApproved).toEqual({ level: 0, rules: 1 })

    // Another gate of that channel still asks Charlie; the same gate of another channel too.
    const thumb = p.ask('Miniature', 'thumbnail')
    await p.ticks(1)
    expect(o.parts.queue.get(thumb.id).status).toBe('waiting_human')
    const other = o.enqueue({ assigneeId: agentBySlug(p.r, `lead-${p.r.channels[1]!}`).id, kind: 'plan', title: 'Sujet ailleurs', brief: 'topic' })
    await p.ticks(1)
    expect(o.parts.queue.get(other.id).status).toBe('waiting_human')

    // Charlie takes the rule back: topics ask him again.
    await call(p.r, 'autopilot.revokeRule', rule!.id)
    const again = p.ask('Sujet : Néfertiti', 'topic')
    await p.ticks(1)
    expect(o.parts.queue.get(again.id).status).toBe('waiting_human')
  })

  it('« Toujours : série » covers that series only', async () => {
    const p = await phone()
    const o = p.r.core.orchestra
    p.ask('Sujet : Ramsès II', 'topic|Égypte antique')
    await p.ticks(1)
    await p.pass()
    p.fake.click(p.questions()[0]!.id, 'atl:series', FAKE_OWNER_ID)
    await vi.waitFor(() => expect(p.fake.callbacks).toHaveLength(1))
    expect(o.parts.allow.list(p.channel)).toMatchObject([{ gate: 'topic', series: 'Égypte antique' }])
    const same = p.ask('Sujet : Khéops', 'topic|égypte  ANTIQUE')
    const rome = p.ask('Sujet : César', 'topic|Rome')
    await p.ticks(4)
    expect(o.parts.queue.get(same.id).status).toBe('done')
    expect(o.parts.queue.get(rome.id).status).toBe('waiting_human')
  })

  it('only allowed people decide; « Refuser » sends back the second option; a question without a gate has no « toujours »', async () => {
    const p = await phone()
    const o = p.r.core.orchestra
    const t = p.ask('Miniature', 'thumbnail')
    o.parts.inbox.add({ taskId: null, agentId: p.lead.id, kind: 'input', title: 'Quel ton pour la voix ?' })
    await p.ticks(1)
    await p.pass()
    const thumb = p.questions().find((m) => m.content.includes('Miniature'))!
    const input = p.questions().find((m) => m.content.includes('Quel ton'))!
    expect(buttonIds(thumb)).toEqual(['atl:yes', 'atl:no', 'atl:always'])
    expect(buttonIds(input)).toEqual([])

    p.fake.click(thumb.id, 'atl:always', STRANGER)
    await vi.waitFor(() => expect(p.fake.callbacks).toHaveLength(1))
    expect(p.fake.callbacks[0]).toMatchObject({ type: 4, data: { flags: FLAG_EPHEMERAL } })
    expect(o.parts.allow.list()).toHaveLength(0)
    expect(o.parts.queue.get(t.id).status).toBe('waiting_human')

    p.fake.click(thumb.id, 'atl:no', FAKE_OWNER_ID)
    await vi.waitFor(() => expect(p.fake.callbacks).toHaveLength(2))
    expect(o.inbox(true).find((i) => i.taskId === t.id)).toMatchObject({ status: 'answered', answer: { choice: 'Revoir' } })
    // A click on a question already settled only clears its buttons.
    p.fake.click(thumb.id, 'atl:yes', FAKE_OWNER_ID)
    await vi.waitFor(() => expect(p.fake.callbacks).toHaveLength(3))
    expect(String(p.fake.callbacks[2]!.data.content)).toContain('n’attend déjà plus')
    // Atlas (no channel) can never get a rule.
    const atlas = o.parts.inbox.add({ taskId: null, agentId: agentBySlug(p.r, 'principal').id, kind: 'validate', title: 'Créer la chaîne ?', gate: 'topic' })
    expect(atlas.channelId).toBeNull()
    await expect(call(p.r, 'autopilot.allowAlways', atlas.id)).rejects.toThrow(/d’une chaîne/)
  })

  it('in the app too, with a limit; the questions already waiting are answered with it', async () => {
    const p = await phone({ buttons: false })
    const o = p.r.core.orchestra
    const a = p.ask('Sujet A', 'topic')
    const b = p.ask('Sujet B', 'topic')
    await p.ticks(2)
    const items = o.inbox().filter((i) => i.gate === 'topic')
    expect(items).toHaveLength(2)
    const res = await call<AllowAlwaysResult>(p.r, 'autopilot.allowAlways', items[0]!.id, { maxUses: 2 })
    expect(res.alsoAnswered).toBe(1)
    expect(res.rule).toMatchObject({ gate: 'topic', maxUses: 2, uses: 1 })
    await p.ticks(2)
    expect(o.parts.queue.get(a.id).status).toBe('done')
    expect(o.parts.queue.get(b.id).status).toBe('done')
    // One use left: the next topic passes, the one after asks Charlie again (the rule is used up).
    const c = p.ask('Sujet C', 'topic')
    await p.ticks(2)
    expect(o.parts.queue.get(c.id).status).toBe('done')
    expect(o.parts.allow.list(p.channel)).toHaveLength(0)
    const d = p.ask('Sujet D', 'topic')
    await p.ticks(1)
    expect(o.parts.queue.get(d.id).status).toBe('waiting_human')
    // Without the live connection, the bot puts ✅ ❌ under the question (they still work).
    await p.pass()
    const msg = p.questions().find((m) => m.content.includes('Sujet D'))!
    expect(p.fake.reactions.get(`${p.approvals}/${msg.id}/✅`)?.map((u) => u.id)).toEqual([FAKE_BOT.id])
    expect(p.r.core.discord.status().buttonsLive).toBe(false)
    // Answered in the app: the phone's message loses its buttons at the next pass.
    expect(buttonIds(msg).length).toBeGreaterThan(0)
    o.answer(o.inbox().find((i) => i.taskId === d.id)!.id, { choice: 'Valider' })
    await p.pass()
    expect(p.fake.message(msg.id)?.components).toEqual([])
  })
})

describe('notifications: only when it matters', () => {
  it('« important » pings decisions only; « rien » pings nothing; « tout » leaves Discord’s own rules', async () => {
    const p = await phone({ buttons: false })
    const d = p.r.core.discord
    const atlas = d.store.get().atlasId as string
    expect(d.status().notifications).toBe('important')
    const supervisor = p.r.core.context.chat.store.open({ kind: 'supervisor' })
    p.r.core.orchestra.parts.messaging.system(supervisor.id, 'Le travail reprend.')
    await p.pass()
    const line = p.fake.botMessages(atlas).find((m) => m.content.includes('Le travail reprend'))
    expect(line?.flags).toBe(FLAG_SUPPRESS_NOTIFICATIONS)
    expect(p.fake.mentions.get(line!.id)).toEqual([])

    d.configure({ notifications: 'nothing' })
    p.r.core.orchestra.parts.inbox.add({ taskId: null, agentId: p.lead.id, kind: 'alert', title: 'Créneau menacé · Histoire' })
    await p.pass()
    const alert = p.fake.botMessages(p.approvals).find((m) => m.content.includes('Créneau menacé'))!
    expect(alert.content).toContain('**Alerte**')
    expect(alert.flags).toBe(FLAG_SUPPRESS_NOTIFICATIONS)
    expect(p.fake.mentions.get(alert.id)).toEqual([])

    d.configure({ notifications: 'everything' })
    p.r.core.orchestra.parts.messaging.system(supervisor.id, 'Encore une ligne.')
    await p.pass()
    expect(p.fake.botMessages(atlas).find((m) => m.content.includes('Encore une ligne'))?.flags).toBeUndefined()
    expect(() => d.configure({ notifications: 'souvent' as never })).toThrow(/important/)
    expect(() => d.configure({ weeklyDay: 8 })).toThrow(/1 \(lundi\)/)
  })
})

describe('the daily digest and the weekly report, from the real state', () => {
  it('shipped, late and why, decisions, spend — in the app and on Discord', async () => {
    const p = await phone({ buttons: false })
    const { r } = p
    const o = r.core.orchestra
    const db = r.core.db
    const now = r.clock.now()
    const [hist, myst] = r.channels as [number, number]
    // The planner itself: a slot at 19:00 today (11 h away) for a 12 h chain gives an early warning (« late »).
    o.parts.goals.save(hist, { slots: [{ day: 1, time: '19:00', kind: 'long' }], formats: [{ kind: 'long', minutes: 10, perWeek: 1 }], budgetCredits: 10_000, level: 'all-auto', confirm: true })
    await o.tick()
    // A kit made ready last night for Mystères, a video published three days ago.
    const video = Number(db.prepare(`INSERT INTO videos (channel_id, title, status, created_at, updated_at) VALUES (?, 'Le mystère de Roanoke', 'ready', ?, ?)`).run(myst, iso(now), iso(now)).lastInsertRowid)
    db.prepare(`INSERT INTO orch_plan_slots (channel_id, slot_at, kind, video_id, status, created_at, updated_at) VALUES (?, ?, 'long', ?, 'ready', ?, ?)`).run(myst, iso(now + 2 * DAY), video, iso(now - DAY), iso(now - 10 * HOUR))
    db.prepare(`INSERT INTO videos (channel_id, title, status, created_at, updated_at) VALUES (?, 'Les pyramides', 'published', ?, ?)`).run(hist, iso(now - 5 * DAY), iso(now - 3 * DAY))
    // A question asked now, still waiting 5 hours later; the team's calls (booked with an account).
    o.parts.inbox.add({ taskId: null, agentId: p.lead.id, kind: 'validate', title: 'Miniature de Ramsès', gate: 'thumbnail' })
    // (the lead's planned topic turn above booked its own call too)
    const team = (await call<TeamReport>(r, 'autopilot.report', 'weekly')).spend
    const book = db.prepare(`INSERT INTO ledger (provider_id, model, channel_id, status, estimate_usd, amount_usd, account_id, created_at) VALUES ('claude-code', 'claude-sonnet-5-5', ?, 'settled', 0, ?, 1, ?)`)
    book.run(hist, 1.25, iso(now - 2 * HOUR))
    book.run(myst, 0.5, iso(now - 2 * DAY))
    r.clock.advance(5 * HOUR)

    const weekly = await call<TeamReport>(r, 'autopilot.report', 'weekly')
    expect(weekly.shipped.map((s) => [s.channelName, s.title, s.state])).toEqual([
      ['Mystères', 'Le mystère de Roanoke', 'ready'],
      ['Histoire', 'Les pyramides', 'published']
    ])
    expect(weekly.late).toHaveLength(1)
    expect(weekly.late[0]).toMatchObject({ channelName: 'Histoire', reason: 'late' })
    expect(weekly.late[0]!.text).toMatch(/après le créneau/)
    expect(weekly.decisions).toMatchObject([{ channelName: 'Histoire', title: 'Miniature de Ramsès', gate: 'thumbnail', hours: 5 }])
    expect(weekly.spend.usd).toBeCloseTo(team.usd + 1.75, 2)
    expect(weekly.spend.calls).toBe(team.calls + 2)
    expect(weekly.spend.monthUsd).toBeGreaterThanOrEqual(1.25)
    expect(weekly.spend.byChannel.map((c) => c.channelName)).toEqual(['Histoire', 'Mystères'])
    expect(weekly.text).toContain('**Rapport de la semaine**')
    expect(weekly.text).toContain('**En retard, et pourquoi** : 1')
    expect(weekly.text).toContain('Miniature de Ramsès (miniatures), depuis 5 h')
    // The day only: what is older than 24 h is not in it.
    const daily = await call<TeamReport>(r, 'autopilot.report', 'daily')
    expect(daily.shipped.map((s) => s.title)).toEqual(['Le mystère de Roanoke'])
    expect(daily.spend.usd).toBeCloseTo(team.usd + 1.25, 2)
    expect(daily.spend.calls).toBe(team.calls + 1)
    expect(daily.text).toContain('**Digest du jour**')

    // On Discord: the weekly report on its day at the summary hour, once; the daily summary carries what is late.
    const d = r.core.discord
    const atlas = d.store.get().atlasId as string
    const local = new Date(r.clock.now())
    const hour = local.getHours()
    d.configure({ summaryHour: hour + 1, weeklyDay: ((local.getDay() + 6) % 7) + 1 })
    const posted = (title: string): string[] => p.fake.botMessages(atlas).map((m) => m.content).filter((c) => c.includes(title))
    await p.pass()
    expect(posted('Rapport de la semaine')).toHaveLength(0)
    r.clock.advance(HOUR)
    await p.pass()
    expect(posted('Rapport de la semaine')).toHaveLength(1)
    expect(posted('Résumé du jour')).toHaveLength(1)
    expect(posted('Résumé du jour')[0]).toContain('**En retard, et pourquoi** : 1')
    await p.pass()
    expect(posted('Rapport de la semaine')).toHaveLength(1)
    r.clock.advance(DAY)
    await p.pass()
    expect(posted('Rapport de la semaine')).toHaveLength(1)
    expect(posted('Résumé du jour')).toHaveLength(2)
    r.clock.advance(6 * DAY)
    await p.pass()
    expect(posted('Rapport de la semaine')).toHaveLength(2)
    await expect(call(r, 'autopilot.report', 'monthly')).rejects.toThrow(/daily/)
  })
})

describe('the gateway (the live connection for the buttons)', () => {
  it('identifies without intents, beats, and resumes after a drop', async () => {
    const p = await phone()
    const first = p.fake.sockets[0]!
    expect(first.url).toBe('wss://gateway.fake.invalid/?v=10&encoding=json')
    const identify = first.sent.find((x) => x.op === 2)!
    expect(identify.d).toMatchObject({ token: TOKEN, intents: 0 })
    first.drop(1006)
    // the reconnection waits ~1 s; then it resumes the same session on the resume URL
    await vi.waitFor(() => expect(p.fake.sockets).toHaveLength(2), { timeout: 4000 })
    await vi.waitFor(() => expect(p.r.core.discord.status().buttonsLive).toBe(true))
    const second = p.fake.sockets[1]!
    expect(second.url).toBe('wss://resume.fake.invalid/?v=10&encoding=json')
    expect(second.sent.find((x) => x.op === 6)?.d).toMatchObject({ session_id: 'fake-session' })
    // switched off: the connection closes and stays closed
    p.r.core.discord.setEnabled(false)
    expect(second.open).toBe(false)
    expect(p.r.core.discord.status().buttonsLive).toBe(false)
  })
})

async function call<T = unknown>(r: Rig, method: string, ...args: unknown[]): Promise<T> {
  const res = await handleCall(r.core.api, method, args)
  if (!res.ok) throw new Error(res.error.message)
  return res.value as T
}
