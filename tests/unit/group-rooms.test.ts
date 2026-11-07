// Lot 13: department rooms and channel Managers, migration 009 (rebuild without losing a message), the 27 roles and
// their upgrade at startup, the pure helpers of the group engine (lane token, agent lookup).
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase, schemaVersion } from '../../src/main/db'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { AgentsStore } from '../../src/main/agents/store'
import { AGENT_DEFAULTS, NODE_ROLES, PREVIOUS_INSTRUCTIONS, roleForNode } from '../../src/main/agents/roles'
import { findAgent } from '../../src/main/chat/group'
import { mayBeOffTopic, offTopic, personaFor } from '../../src/main/chat/persona'
import { buildFolders } from '../../src/shared/chat-folders'
import { mentionSlug } from '../../src/shared/chat-rich'
import { ROLES } from '../../src/shared/roles'
import { memoryCore } from './helpers'

describe('rooms and channel Managers', () => {
  it('lists a Manager and the staffed department rooms of each active channel; opening is idempotent', async () => {
    const { api } = memoryCore()
    const a = await api['channels.create']({ name: 'Histoires' })
    const b = await api['channels.create']({ name: 'Sciences' })
    let rooms = await api['chat.rooms']()
    expect(rooms.map((r) => r.key)).toEqual([
      `manager:${a.id}`, `room:${a.id}:direction`, `room:${a.id}:production`, `room:${a.id}:operations`,
      `manager:${b.id}`, `room:${b.id}:direction`, `room:${b.id}:production`, `room:${b.id}:operations`
    ])
    expect(rooms.every((r) => r.conversationId === null && r.unread === 0)).toBe(true)
    expect(rooms[2]!.title).toBe('Salon Production · Histoires')

    const room = await api['chat.open']({ kind: 'room', channelId: a.id, department: 'production' })
    expect(room).toMatchObject({ kind: 'room', channelId: a.id, department: 'production', title: 'Salon Production · Histoires' })
    expect((await api['chat.open']({ kind: 'room', channelId: a.id, department: 'production' })).id).toBe(room.id)
    const manager = await api['chat.open']({ kind: 'channel', channelId: a.id })
    expect(manager).toMatchObject({ kind: 'channel', channelId: a.id, department: null, title: 'Manager · Histoires' })
    rooms = await api['chat.rooms']()
    expect(rooms.find((r) => r.key === `room:${a.id}:production`)?.conversationId).toBe(room.id)
    expect(rooms.find((r) => r.key === `manager:${a.id}`)?.conversationId).toBe(manager.id)

    // An archived channel has no rooms; a department without an enabled agent has none until it exists.
    await api['channels.archive'](b.id)
    for (const r of ROLES.filter((x) => x.group === 'operations')) await api['agents.update'](r.role, { enabled: false })
    rooms = await api['chat.rooms']()
    expect(rooms.map((r) => r.key)).toEqual([`manager:${a.id}`, `room:${a.id}:direction`, `room:${a.id}:production`])
  })

  it('refuses a room without channel, of an archived channel or of an unknown department', async () => {
    const { api } = memoryCore()
    const ch = await api['channels.create']({ name: 'Histoires' })
    await expect(Promise.resolve().then(() => api['chat.open']({ kind: 'room', department: 'production' }))).rejects.toThrow(/channelId/)
    await expect(Promise.resolve().then(() => api['chat.open']({ kind: 'room', channelId: ch.id, department: 'marketing' as never }))).rejects.toThrow(/Unknown department/)
    await expect(Promise.resolve().then(() => api['chat.open']({ kind: 'channel', channelId: 999 }))).rejects.toThrow(/Unknown channel/)
    await api['channels.archive'](ch.id)
    await expect(Promise.resolve().then(() => api['chat.open']({ kind: 'channel', channelId: ch.id }))).rejects.toThrow(/archived/)
  })

  it('the folder list opens a room not created yet with the right input', () => {
    const view = buildFolders({
      conversations: [],
      channels: [{ id: 1, name: 'H' }],
      videos: [],
      agents: [],
      rooms: [
        { key: 'manager:1', channelId: 1, kind: 'manager', title: 'Manager', conversationId: null, unread: 0 },
        { key: 'room:1:production', channelId: 1, kind: 'room', department: 'production', title: 'Salon', conversationId: null, unread: 0 }
      ],
      channelId: 1,
      query: '',
      labels: { noMessage: '', you: '', card: '', manager: 'M', room: (d) => d }
    })
    expect(view.manager?.open).toEqual({ kind: 'channel', channelId: 1 })
    expect(view.team.find((g) => g.department === 'production')?.room?.open).toEqual({ kind: 'room', channelId: 1, department: 'production' })
  })

  it('names who answers in each kind of conversation', () => {
    const row = { id: 1, title: '', videoId: null, agentId: null, channelId: 3, department: null, unread: 0, lastMessage: null, updatedAt: '' }
    expect(personaFor({ ...row, kind: 'supervisor' })).toMatchObject({ kind: 'supervisor', role: 'supervisor', name: 'Superviseur' })
    expect(personaFor({ ...row, kind: 'video', videoId: 4 })).toMatchObject({ kind: 'producer', role: 'supervisor', name: 'Producteur' })
    expect(personaFor({ ...row, kind: 'room', department: 'production' })).toMatchObject({ kind: 'team_lead', role: 'supervisor' })
    expect(personaFor({ ...row, kind: 'channel' })).toMatchObject({ kind: 'manager', role: 'supervisor', name: 'Manager de la chaîne' })
    expect(personaFor({ ...row, kind: 'agent', agentId: 'voiceover' })).toMatchObject({ kind: 'agent', role: 'voiceover', name: 'Voix off' })
  })
})

describe('migration 009', () => {
  it('rebuilds conversations without losing messages or proposals, and renames the v1 agents in French', () => {
    const db = openDatabase(':memory:', MIGRATIONS.slice(0, 8))
    db.exec(`
      INSERT INTO channels (id, name) VALUES (1, 'Histoires');
      INSERT INTO videos (id, channel_id, title) VALUES (7, 1, 'Ys');
      INSERT INTO conversations (id, kind, title) VALUES (1, 'supervisor', 'Supervisor');
      INSERT INTO conversations (id, kind, title, video_id, last_read_message_id) VALUES (2, 'video', 'Ys', 7, 2);
      INSERT INTO conversations (id, kind, title, agent_id) VALUES (3, 'agent', 'Scriptwriter', 'scriptwriter');
      INSERT INTO messages (id, conversation_id, author_type, body) VALUES (1, 1, 'owner', 'hello'), (2, 2, 'agent', 'ready'), (3, 3, 'owner', 'hi');
      INSERT INTO proposals (id, conversation_id, message_id, kind) VALUES (1, 1, 1, 'create_video');
      INSERT INTO agents (id, role, name) VALUES ('scriptwriter', 'scriptwriter', 'Scriptwriter'), ('voiceover', 'voiceover', 'Ma voix'), ('qc', 'qc', 'Qc');
    `)
    expect(migrate(db, MIGRATIONS.slice(0, 9))).toEqual([9])
    expect(schemaVersion(db)).toBe(9)
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 3 })
    expect(db.prepare('SELECT conversation_id, message_id FROM proposals').get()).toEqual({ conversation_id: 1, message_id: 1 })
    expect(db.prepare('SELECT id, kind, channel_id, department, last_read_message_id FROM conversations ORDER BY id').all()).toEqual([
      { id: 1, kind: 'supervisor', channel_id: null, department: null, last_read_message_id: null },
      { id: 2, kind: 'video', channel_id: 1, department: null, last_read_message_id: 2 },
      { id: 3, kind: 'agent', channel_id: null, department: null, last_read_message_id: null }
    ])
    expect(db.prepare('SELECT id, name FROM agents ORDER BY id').all()).toEqual([
      { id: 'qc', name: 'Contrôle qualité' },
      { id: 'scriptwriter', name: 'Scénariste' },
      { id: 'voiceover', name: 'Ma voix' }
    ])
    // The cascades still work after the rebuild, and one room per channel and department.
    db.exec(`INSERT INTO conversations (kind, channel_id, department) VALUES ('room', 1, 'production')`)
    expect(() => db.exec(`INSERT INTO conversations (kind, channel_id, department) VALUES ('room', 1, 'production')`)).toThrow(/UNIQUE/)
    expect(() => db.exec(`INSERT INTO conversations (kind) VALUES ('room')`)).toThrow(/CHECK/)
    db.exec('DELETE FROM videos WHERE id = 7')
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 2 })
    db.exec('DELETE FROM channels WHERE id = 1')
    expect(db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE kind = 'room'`).get()).toEqual({ n: 0 })
  })

  it('rolls back and turns the foreign keys back on when a rebuild would break a key', () => {
    const db = openDatabase(':memory:', MIGRATIONS.slice(0, 8))
    const broken = { version: 9, name: 'broken', foreignKeysOff: true, up: (d: typeof db) => d.exec(`INSERT INTO messages (conversation_id, author_type, body) VALUES (999, 'owner', 'x')`) }
    expect(() => migrate(db, [...MIGRATIONS.slice(0, 8), broken])).toThrow(/foreign key violations/)
    expect(schemaVersion(db)).toBe(8)
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 0 })
  })
})

describe('the 27 roles', () => {
  it('have unique French names and @mention slugs, and the production roles of the plan', () => {
    expect(ROLES).toHaveLength(27)
    const names = ROLES.map((r) => r.name)
    expect(new Set(names).size).toBe(27)
    expect(new Set(names.map((n) => mentionSlug(n).toLowerCase())).size).toBe(27)
    expect(ROLES.find((r) => r.role === 'engine_operator')?.name).toBe('Opérateur production')
    expect(ROLES.slice(-5).map((r) => r.role)).toEqual(['engine_operator', 'art_director', 'revenue_manager', 'analyst', 'director'])
    expect(AGENT_DEFAULTS.every((a) => a.instructions.length > 40 && a.job.length > 5)).toBe(true)
  })

  it('give the Supervisor its production tools, the operator its run tools, and map the Claude nodes to roles', () => {
    const tools = (role: string) => AGENT_DEFAULTS.find((a) => a.role === role)!.tools
    expect(tools('supervisor')).toEqual(expect.arrayContaining(['create_video', 'ask_agent', 'list_videos', 'list_runs', 'estimate', 'analyse_channel', 'run_pipeline']))
    expect(tools('engine_operator')).toEqual(expect.arrayContaining(['list_runs', 'run_status', 'retry_node', 'cancel_run']))
    expect(tools('engine_operator')).not.toContain('run_pipeline')
    expect(tools('scriptwriter')).not.toContain('run_pipeline')
    expect(roleForNode('script.write@1')).toBe('scriptwriter')
    expect(roleForNode('director.plan')).toBe('director')
    expect(roleForNode('voice.tts@1')).toBeNull()
    expect(Object.values(NODE_ROLES).every((r) => ROLES.some((x) => x.role === r))).toBe(true)
  })

  it('upgrade at startup: new tools are added, an old default text moves on, an edited one is kept', () => {
    const { db, agents } = memoryCore()
    db.prepare(`UPDATE agents SET tools = '["get_brief"]', instructions = ? WHERE id = 'supervisor'`).run(PREVIOUS_INSTRUCTIONS.supervisor![0]!)
    db.prepare(`UPDATE agents SET tools = '["post_message"]', instructions = 'Mon style à moi.' WHERE id = 'scriptwriter'`).run()
    expect(new AgentsStore(db).seed()).toBe(0)
    const sup = agents.get('supervisor')
    expect(sup.tools[0]).toBe('get_brief')
    expect(sup.tools).toEqual(expect.arrayContaining(['run_pipeline', 'ask_agent']))
    expect(sup.instructions).toBe(AGENT_DEFAULTS.find((a) => a.role === 'supervisor')!.instructions)
    expect(sup.customized).toBe(false)
    const sw = agents.get('scriptwriter')
    expect(sw.instructions).toBe('Mon style à moi.')
    expect(sw.tools).toEqual(expect.arrayContaining(['post_message', 'save_version', 'ask_agent']))
  })
})

describe('pure helpers', () => {
  it('reads the lane token and holds back only what could still be it', () => {
    expect(offTopic('OFF_TOPIC')).toBe('')
    expect(offTopic(' OFF_TOPIC:voiceover \n')).toBe('voiceover')
    expect(offTopic('OFF_TOPIC : qc.')).toBe('qc')
    // Anything that starts with the token is a lane answer; what follows names the agent, by id or name.
    expect(offTopic('OFF_TOPIC:Voix off')).toBe('Voix off')
    expect(offTopic('OFF_TOPIC — Scénariste\nphrase de trop')).toBe('Scénariste')
    expect(offTopic('Bonjour, OFF_TOPIC')).toBeNull()
    expect(offTopic('Bonjour')).toBeNull()
    for (const p of ['', ' O', 'OFF_T', 'OFF_TOPIC', 'OFF_TOPIC:', 'OFF_TOPIC:voice', 'OFF_TOPIC: Voix off']) expect(mayBeOffTopic(p), p).toBe(true)
    for (const p of ['OFFRE', 'Bon', `OFF_TOPIC ${'x'.repeat(81)}`]) expect(mayBeOffTopic(p), p).toBe(false)
  })

  it('finds an agent by id, name or mention slug, ignoring case and accents', () => {
    const team = [
      { id: 'voiceover', name: 'Voix off' },
      { id: 'scriptwriter', name: 'Scénariste' },
      { id: 'publisher', name: 'Préparateur d’upload' }
    ]
    expect(findAgent(team, 'voiceover')?.id).toBe('voiceover')
    expect(findAgent(team, '@Voix_off')?.id).toBe('voiceover')
    expect(findAgent(team, 'scenariste')?.id).toBe('scriptwriter')
    expect(findAgent(team, 'Préparateur d_upload')?.id).toBe('publisher')
    expect(findAgent(team, 'Monteur')).toBeNull()
    expect(findAgent(team, '  ')).toBeNull()
  })
})
