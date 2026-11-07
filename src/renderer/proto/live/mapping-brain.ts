// Real mode, Cerveau: turns the database's ideas (`ideas.list`) into the idea board of the screen, and the board's
// moves back into idea statuses. Pure functions, no IPC: unit-tested. Ideas are `idea-<id>`, channels `db-<id>`
// (same keys as the other live mappings). Nothing is invented: a potential is the agent's own score or nothing, a
// views estimate does not exist.
import type { IdeaRow, IdeaStatus } from '../../../shared/api/ideas'
import type { Idea, IdeaColumn } from '../data-brain'
import { channelKey } from './mapping'

export const ideaKey = (id: number): string => `idea-${id}`

/** The database id behind a board id (`idea-7` → 7), or null for a demo idea. */
export function ideaIdOf(key: string): number | null {
  const m = /^idea-(\d+)$/.exec(key)
  return m ? Number(m[1]) : null
}

/** The board's column of a status: new ideas are « proposées », kept ones « validées », used ones « en production ». */
export function columnOfStatus(status: IdeaStatus): IdeaColumn | null {
  if (status === 'new') return 'proposed'
  if (status === 'kept') return 'validated'
  if (status === 'used') return 'production'
  return null
}

/** The status a card gets when it moves to a column (« en production » is reached through `ideas.toVideo`). */
export function statusOfColumn(column: IdeaColumn): IdeaStatus {
  return column === 'proposed' ? 'new' : column === 'validated' ? 'kept' : 'used'
}

export function mapIdea(row: IdeaRow): Idea | null {
  const column = columnOfStatus(row.status)
  if (column === null) return null
  const scored = row.score !== null
  return {
    id: ideaKey(row.id),
    channelId: channelKey(row.channelId),
    title: row.title,
    angle: row.angle,
    source: row.source === 'agent' ? 'atlas' : 'manual',
    potential: scored ? Math.max(0, Math.min(100, Math.round(row.score as number))) : 0,
    estViews: 0,
    column,
    liveId: row.id,
    ...(scored ? {} : { unscored: true })
  }
}

/** The board: every kept, new or used idea (rejected ones are gone from it), newest first. */
export function mapIdeas(rows: readonly IdeaRow[]): Idea[] {
  return rows
    .slice()
    .sort((a, b) => b.id - a.id)
    .map(mapIdea)
    .filter((i): i is Idea => i !== null)
}

/** The database id of a channel key (`db-7` → 7), or null when it is a demo channel. */
export function channelIdOf(key: string): number | null {
  const m = /^db-(\d+)$/.exec(key)
  return m ? Number(m[1]) : null
}
