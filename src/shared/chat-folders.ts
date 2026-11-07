// The conversation list of lot 12, as pure data: one "folder" per channel with the Supervisor on top, the new replies,
// the channel Manager, the videos, and the team by department (room first, then private messages). Built from the v1
// chat api (`chat.conversations`, `channels.list`, `videos.list`, `agents.list`) plus typed rooms that lot 13 feeds.
import type { ConversationInput, ConversationRow } from './chat'
import { DEPARTMENT_OF_GROUP, DEPARTMENTS, type Department, type RoomInfo } from './chat-rich'
import { ROLES } from './roles'

export interface FolderChannel {
  id: number
  name: string
}
export interface FolderVideo {
  id: number
  channelId: number
  title: string
}
export interface FolderAgent {
  id: string
  name: string
}

export interface ListEntry {
  /** Stable React key. */
  key: string
  kind: 'supervisor' | 'manager' | 'room' | 'video' | 'agent'
  title: string
  subtitle: string
  unread: number
  /** Existing conversation, or null: it is opened on first click (`open`). */
  conversationId: number | null
  open: ConversationInput | null
  /** Colour index of the agent dot. */
  index: number
  /** Last activity, to order entries that have one. */
  updatedAt: string
}

export interface TeamGroup {
  department: Department
  room: ListEntry | null
  agents: ListEntry[]
}

export interface FolderView {
  supervisor: ListEntry | null
  newReplies: ListEntry[]
  manager: ListEntry | null
  videos: ListEntry[]
  team: TeamGroup[]
}

export interface FolderInput {
  conversations: readonly ConversationRow[]
  channels: readonly FolderChannel[]
  videos: readonly FolderVideo[]
  agents: readonly FolderAgent[]
  rooms: readonly RoomInfo[]
  /** The selected channel folder (null = none yet). */
  channelId: number | null
  query: string
  /** Strings that depend on the language. */
  labels: { noMessage: string; you: string; card: string; manager: string; room: (department: Department) => string; supervisor?: string }
}

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const prettify = (id: string): string => id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** Colour index of an agent: its place in the role list (so the dot never changes between screens). */
export function agentIndex(agentId: string | null): number {
  const i = ROLES.findIndex((r) => r.role === agentId)
  return i < 0 ? 0 : i
}

/** The department (= role group) of an agent. */
export function departmentOf(agentId: string): Department {
  const group = ROLES.find((r) => r.role === agentId)?.group
  return (group && DEPARTMENT_OF_GROUP[group]) ?? 'operations'
}

function preview(c: ConversationRow | undefined, l: FolderInput['labels']): string {
  if (!c?.lastMessage) return l.noMessage
  const text = c.lastMessage.body.replace(/\s+/g, ' ').trim() || l.card
  return c.lastMessage.authorType === 'owner' ? `${l.you}${text}` : text
}

export function buildFolders(input: FolderInput): FolderView {
  const { conversations, channelId, labels } = input
  const q = norm(input.query.trim())
  const match = (e: ListEntry): boolean => q === '' || norm(e.title).includes(q) || norm(e.subtitle).includes(q)
  const byKey = (kind: ConversationRow['kind'], key: 'videoId' | 'agentId', v: number | string): ConversationRow | undefined =>
    conversations.find((c) => c.kind === kind && c[key] === v)

  const sup = conversations.find((c) => c.kind === 'supervisor')
  const supervisor: ListEntry | null = sup
    ? {
        key: `c${sup.id}`,
        kind: 'supervisor',
        title: labels.supervisor ?? sup.title,
        subtitle: preview(sup, labels),
        unread: sup.unread,
        conversationId: sup.id,
        open: null,
        index: 0,
        updatedAt: sup.updatedAt
      }
    : null

  const videoEntries: ListEntry[] = input.videos
    .filter((v) => v.channelId === channelId)
    .map((v) => {
      const c = byKey('video', 'videoId', v.id)
      return {
        key: `v${v.id}`,
        kind: 'video' as const,
        title: v.title || `#${v.id}`,
        subtitle: preview(c, labels),
        unread: c?.unread ?? 0,
        conversationId: c?.id ?? null,
        open: c ? null : { kind: 'video' as const, videoId: v.id },
        index: 3,
        updatedAt: c?.updatedAt ?? ''
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const agentEntry = (id: string, name: string): ListEntry => {
    const c = byKey('agent', 'agentId', id)
    return {
      key: `a${id}`,
      kind: 'agent',
      title: name,
      subtitle: preview(c, labels),
      unread: c?.unread ?? 0,
      conversationId: c?.id ?? null,
      open: c ? null : { kind: 'agent', agentId: id },
      index: agentIndex(id),
      updatedAt: c?.updatedAt ?? ''
    }
  }
  const known = input.agents.length > 0 ? input.agents : ROLES.filter((r) => r.role !== 'supervisor').map((r) => ({ id: r.role, name: prettify(r.role) }))
  const agentEntries = known.filter((a) => a.id !== 'supervisor').map((a) => agentEntry(a.id, a.name))

  const roomEntry = (r: RoomInfo): ListEntry => ({
    key: r.key,
    kind: r.kind,
    title: r.title,
    subtitle: r.kind === 'manager' ? labels.manager : r.department ? labels.room(r.department) : '',
    unread: r.unread,
    conversationId: r.conversationId,
    // A room or Manager not opened yet is created on first click (lot 13).
    open:
      r.conversationId !== null
        ? null
        : r.kind === 'manager'
          ? { kind: 'channel', channelId: r.channelId }
          : r.department
            ? { kind: 'room', channelId: r.channelId, department: r.department }
            : null,
    index: r.department ? DEPARTMENTS.indexOf(r.department) + 1 : 1,
    updatedAt: ''
  })
  const rooms = input.rooms.filter((r) => r.channelId === channelId)
  const managerRoom = rooms.find((r) => r.kind === 'manager')

  const team: TeamGroup[] = DEPARTMENTS.map((department) => {
    const room = rooms.find((r) => r.kind === 'room' && r.department === department)
    return {
      department,
      room: room ? roomEntry(room) : null,
      agents: agentEntries.filter((e) => departmentOf(e.key.slice(1)) === department).filter(match)
    }
  }).filter((g) => g.agents.length > 0 || (g.room && match(g.room)))

  const all = [
    ...(supervisor ? [supervisor] : []),
    ...videoEntries,
    ...agentEntries,
    ...rooms.map(roomEntry)
  ]
  // Unread replies of the other channels' videos are not hidden by the folder choice.
  const shown = new Set(input.videos.filter((v) => v.channelId === channelId).map((v) => v.id))
  const elsewhere: ListEntry[] = conversations
    .filter((c) => c.kind === 'video' && c.unread > 0 && (c.videoId === null || !shown.has(c.videoId)))
    .map((c) => ({
      key: `c${c.id}`,
      kind: 'video' as const,
      title: c.title,
      subtitle: preview(c, labels),
      unread: c.unread,
      conversationId: c.id,
      open: null,
      index: 3,
      updatedAt: c.updatedAt
    }))
  const newReplies = [...all, ...elsewhere].filter((e) => e.unread > 0).filter(match)

  return {
    supervisor: supervisor && match(supervisor) ? supervisor : null,
    newReplies,
    manager: managerRoom && match(roomEntry(managerRoom)) ? roomEntry(managerRoom) : null,
    videos: videoEntries.filter(match),
    team: team.map((g) => ({ ...g, room: g.room && match(g.room) ? g.room : null }))
  }
}
