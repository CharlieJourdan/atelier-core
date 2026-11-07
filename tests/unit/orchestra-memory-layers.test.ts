// Agent runtime, the memory layers and what an agent sees: the workspace block (first seed / onboarding), each channel's
// block (written when the channel is added through `channels.create`, updated by a new style profile, archived with the
// channel and its agents, restored with them), the owner's edits over IPC, and the context assembly of a turn (role +
// technologies + workspace + channel + task + handover + memories + thread, each within its budget, secrets removed).
import { describe, expect, it } from 'vitest'
import { handleCall } from '../../src/main/ipc'
import { FakeProvider } from '../../src/main/llm/fake'
import { BUDGETS, scrubSecrets } from '../../src/main/orchestra/assemble'
import { styleLine, upsertLine } from '../../src/main/orchestra/layers'
import { DEFAULT_PROFILE, STYLE_PROFILE_ID, type StyleProfile } from '../../src/shared/style-profile'
import { agentBySlug, drain, rig } from './orchestra-helpers'

const PROFILE: StyleProfile = {
  $schema: STYLE_PROFILE_ID,
  source: { ownVideos: 2, competitorVideos: 3, builtAt: '2026-10-20T10:00:00Z', demo: false },
  ...DEFAULT_PROFILE,
  hook: { pattern: 'question choc', seconds: 12, example: '' },
  script: { structure: ['hook', 'body', 'outro'], tone: 'grave et précis', ctaPerVideo: 1 }
}

describe('memory layers', () => {
  it('writes the workspace block at the first seed and a channel block when a channel is added through the app', async () => {
    const r = rig()
    const api = r.core.api
    const ws = r.core.orchestra.contextBlock('workspace')
    expect(ws).toMatchObject({ scope: 'workspace', source: 'seed', archived: false })
    expect(ws.text).toMatch(/^Propriétaire : la personne qui dirige/)
    // the seed never overwrites an edited block
    r.core.orchestra.saveContextBlock({ scope: 'workspace', text: 'Propriétaire : Charlie. Ton : tutoiement.' })
    r.core.orchestra.seed()
    expect(r.core.orchestra.contextBlock('workspace')).toMatchObject({ text: 'Propriétaire : Charlie. Ton : tutoiement.', source: 'user' })
    // a channel added like the screens do: its block and its team appear
    const row = await api['channels.create']({ name: 'Énigmes', niche: 'énigmes historiques', standards: 'Sources citées.', thumbnailStyle: 'visage, texte rouge' })
    const block = r.core.orchestra.contextBlock('channel', row.id)
    expect(block.source).toBe('channel')
    expect(block.text.split('\n')).toEqual(['Chaîne : Énigmes', 'Niche : énigmes historiques', 'Règles : Sources citées.', 'Miniatures : visage, texte rouge'])
    expect(r.core.orchestra.agents().filter((a) => a.channelId === row.id).map((a) => a.role)).toContain('channel_lead')
  })

  it('updates the channel block with a new style profile, without duplicating the line', () => {
    const r = rig()
    const ch = r.channels[0]!
    r.core.orchestra.profileBuilt(ch, PROFILE, 1)
    r.core.orchestra.profileBuilt(ch, { ...PROFILE, length: { minutes: 12 } }, 2)
    const lines = r.core.orchestra.contextBlock('channel', ch).text.split('\n')
    expect(lines.filter((l) => l.startsWith('Style :'))).toEqual([styleLine({ ...PROFILE, length: { minutes: 12 } }, 2)])
    expect(lines.at(-1)).toMatch(/^Style : v2 · rythme medium .* accroche « question choc » en 12 s · structure hook → body → outro · ton grave et précis · 12 min$/)
    expect(upsertLine('a\nStyle : x\nb', 'Style :', 'Style : y')).toBe('a\nStyle : y\nb')
  })

  it('archives the channel block and the channel’s agents when the channel is removed, and brings them back', async () => {
    const r = rig()
    const o = r.core.orchestra
    const ch = r.channels[1]!
    const lead = agentBySlug(r, `lead-${ch}`)
    const t = o.enqueue({ assigneeId: lead.id, kind: 'plan', title: 'Plan' })
    const before = o.agents().length
    await r.core.api['channels.archive'](ch, true)
    expect(o.contextBlock('channel', ch).archived).toBe(true)
    expect(o.agents()).toHaveLength(before - 11) // its lead and 10 specialists left the tree
    expect(o.tree()[0]!.children.some((c) => c.agent.channelId === ch)).toBe(false)
    expect(o.tasks().find((x) => x.id === t.id)?.status).toBe('cancelled')
    expect(r.core.orchestra.parts.tree.archived().every((a) => a.channelId === ch)).toBe(true)
    // nothing of theirs runs while archived
    await drain(r)
    expect(o.tasks({ assigneeId: lead.id }).every((x) => x.status === 'cancelled')).toBe(true)
    // restored: the same agents come back with their memory; no second team is seeded
    await r.core.api['channels.archive'](ch, false)
    expect(o.agents()).toHaveLength(before)
    expect(agentBySlug(r, `lead-${ch}`).id).toBe(lead.id)
    expect(o.contextBlock('channel', ch).archived).toBe(false)
  })

  it('edits both blocks over IPC (8 000 characters at most, a channel must exist)', async () => {
    const r = rig()
    const call = (m: string, ...args: unknown[]) => handleCall(r.core.api, m, args)
    const saved = await call('orchestra.saveContextBlock', { scope: 'channel', channelId: r.channels[0], text: 'Niche : histoire\nSponsors : NordVPN' })
    expect(saved).toMatchObject({ ok: true, value: { scope: 'channel', text: 'Niche : histoire\nSponsors : NordVPN', source: 'user' } })
    expect(await call('orchestra.contextBlock', 'channel', r.channels[0])).toMatchObject({ ok: true, value: { text: 'Niche : histoire\nSponsors : NordVPN' } })
    expect((await call('orchestra.saveContextBlock', { scope: 'workspace', text: 'x'.repeat(8001) })).ok).toBe(false)
    expect((await call('orchestra.saveContextBlock', { scope: 'channel', channelId: 999, text: 'x' })).ok).toBe(false)
  })
})

describe('what the agent sees', () => {
  it('assembles role, technologies, workspace, channel, task, handover, memories and thread, within budgets, without secrets', async () => {
    const seen: { system: string; prompt: string }[] = []
    const r = rig({ providerFor: () => new FakeProvider((req) => (seen.push({ system: req.system ?? '', prompt: req.prompt }), 'ok\n```atelier\n{"actions":[{"type":"done","result":"ok"}]}\n```')) })
    const o = r.core.orchestra
    const ch = r.channels[0]!
    o.saveContextBlock({ scope: 'workspace', text: 'Propriétaire : Charlie.\nClé API : sk-ant-api03-SECRETSECRETSECRET\napi_key=hunter2hunter2' })
    o.saveContextBlock({ scope: 'channel', channelId: ch, text: 'Niche : histoire\nToken Discord : xoxb-1234567890-abcdefghij' })
    const writer = agentBySlug(r, `scriptwriter-${ch}`)
    o.parts.memory.add(writer.id, { kind: 'style', content: 'Charlie veut des phrases courtes. password: tropfacile123', source: 'user', importance: 5 })
    r.core.chat.store.post(r.core.chat.store.open({ kind: 'channel', channelId: ch }).id, { authorType: 'owner', body: 'On garde le ton grave.' })
    const view = o.agentContext(writer.id)
    expect(view.sections.map((s) => s.id)).toEqual(['role', 'technologies', 'workspace', 'channel', 'task', 'handover', 'memories', 'thread'])
    for (const s of view.sections) {
      expect(s.budget).toBe(BUDGETS[s.id])
      expect(s.tokens).toBeLessThanOrEqual(s.budget)
    }
    const text = (id: string): string => view.sections.find((s) => s.id === id)!.text
    expect(text('role')).toMatch(/^You are Scénariste · Histoire, an agent of Atelier's AI team \(role: scriptwriter, channel: Histoire\)/)
    expect(text('technologies')).toContain('- script.save (tool script_save)')
    expect(text('workspace')).toContain('  Propriétaire : Charlie.')
    expect(text('channel')).toContain('  Niche : histoire')
    expect(text('task')).toContain('Title: (prochaine tâche)')
    expect(text('memories')).toContain('[style] Charlie veut des phrases courtes.')
    expect(text('thread')).toBe('Charlie: On garde le ton grave.')
    const all = JSON.stringify(view)
    for (const secret of ['sk-ant-api03-SECRETSECRETSECRET', 'hunter2hunter2', 'xoxb-1234567890-abcdefghij', 'tropfacile123']) expect(all).not.toContain(secret)
    expect(all).toContain('[secret retiré]')
    // the read-only view counted no memory use
    expect(o.memory(writer.id)[0]!.uses).toBe(0)
    // a real turn sends the same parts (and no secret either)
    o.enqueue({ assigneeId: writer.id, kind: 'script', title: 'Script du vol 19' })
    await drain(r)
    const turn = seen.at(-1)!
    expect(turn.system).toContain('Workspace memory')
    expect(turn.system).toContain('Channel memory (Histoire')
    expect(turn.prompt).toContain('Recent messages in your conversation')
    expect(turn.prompt).toContain('What you remember')
    for (const secret of ['sk-ant-api03', 'hunter2hunter2', 'xoxb-1234567890', 'tropfacile123']) expect(turn.system + turn.prompt).not.toContain(secret)
  })

  it('scrubs the usual credential shapes', () => {
    expect(scrubSecrets('key sk-ant-abcdefgh12345 and Bearer abcdefghijklmnop and token: zzz')).toBe('key [secret retiré] and [secret retiré] and token: [secret retiré]')
    expect(scrubSecrets('rien de secret ici')).toBe('rien de secret ici')
  })
})
