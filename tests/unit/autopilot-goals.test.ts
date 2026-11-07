// agents-2 (A2): a channel's standing goals (time + budget) and its approval level (docs/AGENT-RUNTIME.md §25). Creating
// or importing a channel proposes them once (baseline from what Atelier read, an inbox item, a task for the lead), Charlie
// confirms or edits them, every turn of the channel's agents reads them, and the approval level decides which questions
// really reach Charlie. Fake providers and the fake clock only.
import { describe, expect, it } from 'vitest'
import type { ChannelGoals } from '../../src/shared/api/autopilot'
import { handleCall } from '../../src/main/ipc'
import { FakeProvider } from '../../src/main/llm/fake'
import { readPrompt } from '../../src/main/orchestra/fake-team'
import { baseline } from '../../src/main/orchestra/goals'
import { approvedIn } from '../../src/main/orchestra/toolbox'
import { T0, agentBySlug, rig, type Rig } from './orchestra-helpers'

const block = (actions: unknown[]): string => `\n\n\`\`\`atelier\n${JSON.stringify({ actions })}\n\`\`\``
const DAY = 86_400_000

async function ok<T>(r: Rig, m: string, ...args: unknown[]): Promise<T> {
  const res = await handleCall(r.core.api, m, args)
  if (!res.ok) throw new Error(`${m}: ${res.error.message}`)
  return res.value as T
}

/** A read of a channel (source 0 = itself) or a competitor: `perWeek` videos of `seconds` over the last weeks. */
function read(r: Rig, channelId: number, sourceKey: number, perWeek: number, seconds: number, weeks = 6, shortsPerWeek = 0): void {
  const videos: { id: string; title: string; views: number; durationS: number; publishedAt: string }[] = []
  const add = (n: number, s: number, tag: string) => {
    for (let i = 0; i < n * weeks; i++) videos.push({ id: `${tag}${sourceKey}-${i}`, title: `v${i}`, views: 1000, durationS: s, publishedAt: new Date(T0 - (i * 7 * DAY) / n).toISOString() })
  }
  add(perWeek, seconds, 'l')
  if (shortsPerWeek) add(shortsPerWeek, 50, 's')
  r.core.db
    .prepare('INSERT INTO channel_reads (channel_id, source_key, url, title, videos_json, read_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(channelId, sourceKey, 'https://www.youtube.com/@x', sourceKey === 0 ? 'Ma chaîne' : `Concurrent ${sourceKey}`, JSON.stringify(videos), new Date(T0).toISOString())
}

function competitor(r: Rig, channelId: number, n: number, watched = true): number {
  return Number(
    r.core.db
      .prepare('INSERT INTO channel_competitors (channel_id, url, name, watched) VALUES (?, ?, ?, ?)')
      .run(channelId, `https://www.youtube.com/@concurrent${n}`, `Concurrent ${n}`, watched ? 1 : 0).lastInsertRowid
  )
}

describe('goals are proposed when a channel is created or imported', () => {
  it('create: the team, a baseline proposal, an inbox item to confirm, a task for the lead; once only', async () => {
    const r = rig()
    const row = await ok<{ id: number }>(r, 'channels.create', { name: 'Énigmes', niche: 'énigmes historiques' })
    const o = r.core.orchestra
    const lead = agentBySlug(r, `lead-${row.id}`)
    const goals = (await ok<ChannelGoals>(r, 'autopilot.goals', row.id))!
    // nothing read yet: a prudent start, said as such, with a budget in credits and a first deadline
    expect(goals).toMatchObject({ status: 'proposed', source: 'baseline', trigger: 'create', level: 'recommended', gates: ['topic', 'thumbnail'] })
    expect(goals.formats).toEqual([{ kind: 'long', minutes: 10, perWeek: 2 }])
    expect(goals.slots).toEqual([
      { day: 2, time: '18:00', kind: 'long' },
      { day: 5, time: '18:00', kind: 'long' }
    ])
    expect(goals.budgetCredits).toBe(8700) // 2 × 10 min × 52/12 weeks × 100 credits a minute, rounded up to 100
    expect(goals.deadlines).toHaveLength(1)
    expect(Date.parse(goals.deadlines[0]!.date)).toBeGreaterThanOrEqual(T0 + 6 * DAY)
    expect(goals.reasons).toMatch(/Aucune vidéo lue/)
    const item = o.inbox().find((i) => i.id === goals.inboxId)!
    expect(item).toMatchObject({ kind: 'validate', title: 'Objectifs proposés · Énigmes', options: ['Confirmer', 'Je modifie dans la fiche'], agentId: lead.id })
    expect(item.body).toContain('Objectifs PROPOSÉS')
    const tasks = o.tasks({ assigneeId: lead.id, kind: 'goals' })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.status).toBe('queued')
    // the same channel again (a restore, a second call): nothing new
    o.channelAdded(row.id)
    expect(o.inbox().filter((i) => i.title.startsWith('Objectifs proposés'))).toHaveLength(1)
    expect(o.tasks({ kind: 'goals' })).toHaveLength(1)
  })

  it('import (linking an existing YouTube channel): the goals follow the channel’s own rhythm and length, once', async () => {
    const r = rig()
    const id = r.channels[0]!
    read(r, id, 0, 2, 20 * 60, 6, 3)
    expect(await ok(r, 'autopilot.goals', id)).toBeNull()
    await ok(r, 'channels.update', id, { youtubeChannelId: 'UCabcdefghijklmnopqrstuv' })
    const g = (await ok<ChannelGoals>(r, 'autopilot.goals', id))!
    expect(g).toMatchObject({ trigger: 'import', status: 'proposed' })
    expect(g.formats).toEqual([
      { kind: 'long', minutes: 20, perWeek: 2 },
      { kind: 'short', minutes: 1, perWeek: 3 }
    ])
    expect(g.slots.filter((s) => s.kind === 'short')).toHaveLength(3)
    expect(g.reasons).toContain('le rythme actuel de Ma chaîne')
    // 2 × 20 + 3 × 1 = 43 min a week × 52/12 × 100 credits = 18 634 → 18 700
    expect(g.budgetCredits).toBe(18_700)
    expect(r.core.orchestra.tasks({ kind: 'goals', channelId: id })).toHaveLength(1)
    // another update (a rename) or linking again changes nothing
    await ok(r, 'channels.update', id, { name: 'Histoire 2' })
    expect(r.core.orchestra.inbox().filter((i) => i.title.startsWith('Objectifs proposés'))).toHaveLength(1)
  })

  it('a new channel without its own videos takes the median of its WATCHED competitors', async () => {
    const r = rig()
    const id = r.channels[1]!
    read(r, id, competitor(r, id, 1), 1, 12 * 60)
    read(r, id, competitor(r, id, 2), 3, 8 * 60)
    read(r, id, competitor(r, id, 3), 2, 10 * 60)
    read(r, id, competitor(r, id, 4, false), 7, 40 * 60) // not watched: ignored
    r.core.orchestra.channelAdded(id)
    const g = r.core.orchestra.parts.goals.get(id)!
    expect(g.formats).toEqual([{ kind: 'long', minutes: 10, perWeek: 2 }])
    expect(g.reasons).toMatch(/médiane de 3 concurrent/)
  })

  it('the baseline stays within bounds (1..7 long videos a week, 4..40 minutes)', () => {
    const b = baseline([{ name: 'x', own: false, longPerWeek: 30, shortPerWeek: 0, longMinutes: 120 }], T0)
    expect(b.formats[0]).toEqual({ kind: 'long', minutes: 40, perWeek: 7 })
    expect(b.slots).toHaveLength(7)
  })
})

describe('Charlie confirms or edits', () => {
  it('saves an edit with the level « tout automatique », confirms, closes the inbox item; bad input gets a French message', async () => {
    const r = rig()
    const row = await ok<{ id: number }>(r, 'channels.create', { name: 'Mystères 2' })
    const bad = await handleCall(r.core.api, 'autopilot.saveGoals', [row.id, { slots: [{ day: 9, time: '18:00' }] }])
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.message).toMatch(/jour de 1 \(lundi\) à 7/)
    const g = await ok<ChannelGoals>(r, 'autopilot.saveGoals', row.id, {
      slots: [{ day: 3, time: '19:30', kind: 'long' }],
      formats: [{ kind: 'long', minutes: 15, perWeek: 1 }],
      budgetCredits: 5000,
      level: 'all-auto',
      confirm: true
    })
    expect(g).toMatchObject({ status: 'confirmed', source: 'user', level: 'all-auto', gates: [], budgetCredits: 5000 })
    expect(g.confirmedAt).not.toBeNull()
    expect(r.core.orchestra.inbox(true).find((i) => i.id === g.inboxId)!.status).toBe('answered')
    // a custom level keeps the gates picked one by one
    const custom = await ok<ChannelGoals>(r, 'autopilot.saveGoals', row.id, { level: 'custom', gates: ['thumbnail', 'script'] })
    expect(custom.gates).toEqual(['script', 'thumbnail'])
  })

  it('« Confirmer » in the inbox confirms them as proposed', async () => {
    const r = rig()
    const row = await ok<{ id: number }>(r, 'channels.create', { name: 'Mystères 3' })
    const before = r.core.orchestra.parts.goals.get(row.id)!
    r.core.orchestra.answer(before.inboxId!, { choice: 'Confirmer' })
    expect(r.core.orchestra.parts.goals.get(row.id)).toMatchObject({ status: 'confirmed', slots: before.slots, budgetCredits: before.budgetCredits })
  })
})

describe('the agents read them, and the approval level decides what reaches Charlie', () => {
  it('the lead refines the draft with goals.propose, reads it every turn, and may not change confirmed goals', async () => {
    const prompts: string[] = []
    const r = rig({
      providerFor: () =>
        new FakeProvider((req) => {
          prompts.push(req.prompt)
          const s = readPrompt(req.system ?? '', req.prompt)
          if (s.kind === 'goals') {
            return {
              toolCalls: [{ name: 'goals_propose', args: { budgetCredits: 12000, formats: [{ kind: 'long', minutes: 12, perWeek: 3 }], slots: [{ day: 1, time: '17:00', kind: 'long' }, { day: 3, time: '17:00', kind: 'long' }, { day: 5, time: '17:00', kind: 'long' }], reasons: 'Les concurrents publient 3 fois par semaine.' } }],
              text: 'Proposé.' + block([{ type: 'done', result: 'ok' }])
            }
          }
          return 'ok' + block([{ type: 'done', result: 'ok' }])
        })
    })
    const o = r.core.orchestra
    const row = await ok<{ id: number }>(r, 'channels.create', { name: 'Énigmes 4' })
    await o.tick({ wait: true })
    const g = o.parts.goals.get(row.id)!
    expect(g).toMatchObject({ status: 'proposed', source: 'agent', budgetCredits: 12000, reasons: 'Les concurrents publient 3 fois par semaine.' })
    expect(prompts.find((p) => p.includes('Analyser la chaîne'))).toContain('Objectifs PROPOSÉS')
    // confirmed: the next turn of any agent of the channel reads them as such; the lead can no longer change them
    await ok(r, 'autopilot.saveGoals', row.id, { confirm: true })
    const researcher = agentBySlug(r, `researcher-${row.id}`)
    const view = o.agentContext(researcher.id)
    expect(view.sections.find((s) => s.id === 'task')!.text).toContain('Objectifs confirmés par le propriétaire')
    expect(view.sections.find((s) => s.id === 'task')!.text).toContain('lundi 17:00')
    const lead = agentBySlug(r, `lead-${row.id}`)
    const again = o.enqueue({ assigneeId: lead.id, kind: 'goals', title: 'Encore' })
    // confirmed goals are planned at once now (the planner's topic step may take the lead's first turn)
    for (let i = 0; i < 12 && o.parts.queue.get(again.id).status !== 'done'; i++) await o.tick({ wait: true })
    expect(o.parts.goals.get(row.id)!.budgetCredits).toBe(12000)
    expect(o.events(0, 2000).some((e) => /already confirmed these goals/.test(e.text))).toBe(true)
  })

  it('« recommandé » asks Charlie for topics and thumbnails only; « tout automatique » asks nothing', async () => {
    const r = rig({
      providerFor: () =>
        new FakeProvider((req) => {
          const s = readPrompt(req.system ?? '', req.prompt)
          if (s.answered || req.prompt.includes('Approved by the approval level')) return 'Validé, je continue.' + block([{ type: 'done', result: 'continué' }])
          return 'À valider.' + block([{ type: 'ask_human', kind: 'validate', question: `Valider : ${s.title} ?`, options: ['Valider', 'Revoir'], gate: s.brief }])
        })
    })
    const o = r.core.orchestra
    const id = r.channels[0]!
    o.parts.goals.propose(id, 'create')
    const lead = agentBySlug(r, `lead-${id}`)
    const ask = (gate: string) => o.enqueue({ assigneeId: lead.id, kind: 'plan', title: gate, brief: gate })
    // recommended: the script is approved at once, the topic waits for Charlie
    const script = ask('script')
    await o.tick({ wait: true })
    await o.tick({ wait: true })
    expect(o.parts.queue.get(script.id)).toMatchObject({ status: 'done', result: 'continué' })
    expect(o.events(0, 2000).some((e) => e.type === 'auto-approved')).toBe(true)
    // an approval level's yes is not Charlie's: production.approve and channel.create still need him
    expect(approvedIn(o.parts.queue.get(script.id))).toBe(false)
    const topic = ask('topic')
    await o.tick({ wait: true })
    expect(o.parts.queue.get(topic.id).status).toBe('waiting_human')
    expect(o.inbox().filter((i) => i.taskId === topic.id)).toHaveLength(1)
    // all automatic: zero question
    o.parts.goals.save(id, { level: 'all-auto', confirm: true })
    const before = o.inbox().length
    const tasks = ['topic', 'thumbnail', 'video', 'kit'].map(ask)
    // one task per agent per pass, two turns each
    for (let i = 0; i < 8; i++) await o.tick({ wait: true })
    for (const t of tasks) expect(o.parts.queue.get(t.id).status).toBe('done')
    expect(o.inbox().length).toBe(before)
    // manual: every gate asks
    o.parts.goals.save(id, { level: 'manual' })
    const voice = ask('voice')
    await o.tick({ wait: true })
    expect(o.parts.queue.get(voice.id).status).toBe('waiting_human')
  })
})

describe('what the approval level may not do (review fixes)', () => {
  it('stops auto-approving a gate asked again and again in one task: the third time goes to Charlie', async () => {
    const r = rig({
      providerFor: () =>
        new FakeProvider(() => 'Encore.' + block([{ type: 'ask_human', kind: 'validate', question: 'Script ok ?', options: ['Valider'], gate: 'script' }]))
    })
    const o = r.core.orchestra
    const id = r.channels[0]!
    o.parts.goals.propose(id, 'create')
    const t = o.enqueue({ assigneeId: agentBySlug(r, `lead-${id}`).id, kind: 'plan', title: 'boucle' })
    for (let i = 0; i < 5; i++) await o.tick({ wait: true })
    expect(o.events(0, 2000).filter((e) => e.type === 'auto-approved')).toHaveLength(2)
    expect(o.parts.queue.get(t.id).status).toBe('waiting_human')
    expect(o.inbox().filter((i) => i.taskId === t.id)).toHaveLength(1)
  })

  it('never auto-approves for an agent without a channel (Atlas), and the lead cannot change the level', async () => {
    const r = rig({
      providerFor: () =>
        new FakeProvider((req) => {
          const s = readPrompt(req.system ?? '', req.prompt)
          if (s.kind === 'goals') return { toolCalls: [{ name: 'goals_propose', args: { level: 'all-auto', gates: [], budgetCredits: 100, reasons: 'moins de validations' } }], text: 'ok' + block([{ type: 'done', result: 'ok' }]) }
          return 'Créer ?' + block([{ type: 'ask_human', kind: 'validate', question: 'Créer la chaîne ?', options: ['Valider'], gate: 'script' }])
        })
    })
    const o = r.core.orchestra
    const atlas = o.enqueue({ assigneeId: agentBySlug(r, 'principal').id, kind: 'plan', title: 'Nouvelle chaîne' })
    await o.tick({ wait: true })
    expect(o.parts.queue.get(atlas.id).status).toBe('waiting_human')
    const id = r.channels[1]!
    o.parts.goals.propose(id, 'create')
    o.enqueue({ assigneeId: agentBySlug(r, `lead-${id}`).id, kind: 'goals', title: 'Objectifs' })
    await o.tick({ wait: true })
    expect(o.parts.goals.get(id)).toMatchObject({ source: 'agent', budgetCredits: 100, level: 'recommended', gates: ['topic', 'thumbnail'] })
  })
})

describe('Atlas on a channel’s video follows that channel’s level (#110)', () => {
  it('a validation of a gate the level does not ask is approved at once; with no video and no channel Atlas still asks', async () => {
    const r = rig({
      providerFor: () =>
        new FakeProvider((req) => {
          if (req.prompt.includes('Approved by the approval level')) return 'Je continue.' + block([{ type: 'done', result: 'continué' }])
          return 'Valider ?' + block([{ type: 'ask_human', kind: 'validate', question: 'Lancer la fabrication ?', options: ['Lancer'], gate: 'video' }])
        })
    })
    const o = r.core.orchestra
    const id = r.channels[0]!
    o.parts.goals.propose(id, 'create')
    o.parts.goals.save(id, { level: 'all-auto', confirm: true })
    const video = Number(r.core.db.prepare("INSERT INTO videos (channel_id, title) VALUES (?, 'Une vidéo')").run(id).lastInsertRowid)
    const principal = agentBySlug(r, 'principal').id
    const on = o.enqueue({ assigneeId: principal, kind: 'plan', title: 'Fabriquer', videoId: video })
    for (let i = 0; i < 4 && o.parts.queue.get(on.id).status !== 'done'; i++) await o.tick({ wait: true })
    expect(o.parts.queue.get(on.id).status).toBe('done')
    expect(o.inbox().filter((i) => i.taskId === on.id)).toHaveLength(0)
    const bare = o.enqueue({ assigneeId: principal, kind: 'plan', title: 'Sans vidéo' })
    await o.tick({ wait: true })
    expect(o.parts.queue.get(bare.id).status).toBe('waiting_human')
  })
})

describe('an approval made by the level names the option it took (production-equipe)', () => {
  it('the next turn reads the first option as the decision, never as Charlie’s yes', async () => {
    const prompts: string[] = []
    const r = rig({
      providerFor: () =>
        new FakeProvider((req) => {
          prompts.push(req.prompt)
          if (req.prompt.includes('Approved by the approval level')) return 'Je relance.' + block([{ type: 'done', result: 'relancé' }])
          return 'Relancer ?' + block([{ type: 'ask_human', kind: 'validate', question: 'Le QC a échoué : relancer la vidéo ?', options: ['Relancer en réel', 'Ne rien faire'], gate: 'video' }])
        })
    })
    const o = r.core.orchestra
    const id = r.channels[0]!
    o.parts.goals.propose(id, 'create')
    o.parts.goals.save(id, { level: 'all-auto', confirm: true })
    const t = o.enqueue({ assigneeId: agentBySlug(r, `lead-${id}`).id, kind: 'plan', title: 'QC' })
    for (let i = 0; i < 8 && o.parts.queue.get(t.id).status !== 'done'; i++) await o.tick({ wait: true })
    expect(o.parts.queue.get(t.id).status).toBe('done')
    const after = prompts.find((p) => p.includes('Approved by the approval level') && p.includes('Le QC a échoué'))
    expect(after).toContain('« Relancer en réel »')
    expect(approvedIn(o.parts.queue.get(t.id))).toBe(false)
  })
})
