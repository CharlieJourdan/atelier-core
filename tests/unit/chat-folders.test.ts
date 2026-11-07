import { describe, expect, it } from 'vitest'
import type { ConversationRow } from '../../src/shared/chat'
import { agentIndex, buildFolders, departmentOf, type FolderInput } from '../../src/shared/chat-folders'
import type { RoomInfo } from '../../src/shared/chat-rich'

const conv = (over: Partial<ConversationRow> & Pick<ConversationRow, 'id' | 'kind'>): ConversationRow => ({
  title: `c${over.id}`, videoId: null, agentId: null, channelId: null, department: null, unread: 0, lastMessage: null, updatedAt: '2026-10-19T10:00:00.000Z', ...over
})

const labels: FolderInput['labels'] = { noMessage: 'vide', you: 'Toi : ', card: '(carte)', manager: 'Manager', room: (d) => `Salon ${d}` }

function input(over: Partial<FolderInput> = {}): FolderInput {
  return {
    conversations: [
      conv({ id: 1, kind: 'supervisor', title: 'Superviseur', unread: 1, lastMessage: { body: 'Salut', authorType: 'agent', createdAt: '' } }),
      conv({ id: 2, kind: 'video', videoId: 10, title: 'Ys', unread: 2 }),
      conv({ id: 3, kind: 'agent', agentId: 'scriptwriter', title: 'Scénariste', lastMessage: { body: '', authorType: 'owner', createdAt: '' } })
    ],
    channels: [{ id: 1, name: 'Histoires' }, { id: 2, name: 'Autre' }],
    videos: [{ id: 10, channelId: 1, title: 'Ys' }, { id: 11, channelId: 1, title: 'Le phare' }, { id: 12, channelId: 2, title: 'Hors dossier' }],
    agents: [{ id: 'scriptwriter', name: 'Scénariste' }, { id: 'voiceover', name: 'Voix off' }, { id: 'researcher', name: 'Chercheur' }, { id: 'supervisor', name: 'Superviseur' }],
    rooms: [],
    channelId: 1,
    query: '',
    labels,
    ...over
  }
}

describe('buildFolders', () => {
  it('puts the supervisor on top and only the videos of the selected channel in the folder', () => {
    const v = buildFolders(input())
    expect(v.supervisor?.conversationId).toBe(1)
    expect(v.supervisor?.subtitle).toBe('Salut')
    expect(v.videos.map((e) => e.title)).toEqual(['Ys', 'Le phare'])
    // A video without conversation opens one on click.
    expect(v.videos[1]).toMatchObject({ conversationId: null, open: { kind: 'video', videoId: 11 } })
    expect(buildFolders(input({ channelId: 2 })).videos.map((e) => e.title)).toEqual(['Hors dossier'])
  })

  it('lists unread conversations under "new replies"', () => {
    const v = buildFolders(input())
    expect(v.newReplies.map((e) => e.key).sort()).toEqual(['c1', 'v10'])
  })

  it('groups the team by department, supervisor excluded, with the owner prefix in previews', () => {
    const v = buildFolders(input())
    const byDept = Object.fromEntries(v.team.map((g) => [g.department, g.agents.map((a) => a.title)]))
    expect(byDept).toEqual({ production: ['Scénariste', 'Voix off', 'Chercheur'] })
  })

  it('draws rooms and the manager from typed data, only for the selected channel', () => {
    const rooms: RoomInfo[] = [
      { key: 'room:1:production', channelId: 1, kind: 'room', department: 'production', title: 'Salon production', conversationId: null, unread: 3 },
      { key: 'manager:1', channelId: 1, kind: 'manager', title: 'Manager', conversationId: 40, unread: 0 },
      { key: 'room:2:production', channelId: 2, kind: 'room', department: 'production', title: 'Autre salon', conversationId: 41, unread: 0 }
    ]
    const v = buildFolders(input({ rooms }))
    expect(v.manager).toMatchObject({ kind: 'manager', conversationId: 40 })
    const production = v.team.find((g) => g.department === 'production')
    expect(production?.room).toMatchObject({ key: 'room:1:production', unread: 3, subtitle: 'Salon production' })
    expect(v.newReplies.map((e) => e.key)).toContain('room:1:production')
    expect(buildFolders(input({ rooms, channelId: 2 })).manager).toBeNull()
  })

  it('keeps unread videos of other channels visible, and filters the manager by the search', () => {
    const conversations = [conv({ id: 9, kind: 'video', videoId: 12, title: 'Hors dossier', unread: 4 })]
    const v = buildFolders(input({ conversations, videos: [{ id: 12, channelId: 2, title: 'Hors dossier' }] }))
    expect(v.newReplies.map((e) => e.key)).toEqual(['c9'])
    const rooms: RoomInfo[] = [{ key: 'm', channelId: 1, kind: 'manager', title: 'Manager', conversationId: 5, unread: 0 }]
    expect(buildFolders(input({ rooms, query: 'zzz' })).manager).toBeNull()
  })

  it('searches titles and previews, ignoring accents and case', () => {
    const v = buildFolders(input({ query: 'scenar' }))
    expect(v.videos).toEqual([])
    expect(v.supervisor).toBeNull()
    expect(v.team.flatMap((g) => g.agents.map((a) => a.title))).toEqual(['Scénariste'])
  })

  it('falls back on the built-in roles when the agents are not loaded yet', () => {
    const v = buildFolders(input({ agents: [] }))
    expect(v.team.flatMap((g) => g.agents).length).toBeGreaterThan(15)
  })

  it('gives stable agent colours and departments', () => {
    expect(agentIndex('supervisor')).toBe(0)
    expect(agentIndex('scriptwriter')).toBe(agentIndex('scriptwriter'))
    expect(agentIndex('nobody')).toBe(0)
    expect(departmentOf('scriptwriter')).toBe('production')
    expect(departmentOf('channel_strategist')).toBe('direction')
    expect(departmentOf('publisher')).toBe('operations')
  })
})
