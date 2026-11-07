// Channels CRUD. JSON list columns (auto_approve, owner_gates) are validated against the deliverable types.
import {
  DEFAULT_OWNER_GATES,
  isDeliverableType,
  type ChannelInput,
  type ChannelPatch,
  type ChannelRow,
  type DeliverableType
} from '../../shared/workflow'
import { nowIso, type Db } from '../db'

interface ChannelDbRow {
  id: number
  name: string
  youtube_channel_id: string | null
  niche: string
  standards: string
  monthly_budget_usd: number | null
  autopilot_on: number
  autopilot_target: number | null
  autopilot_weekly_max: number | null
  auto_approve: string
  owner_gates: string
  thumbnail_style: string
  script_style: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

function parseTypes(json: string): DeliverableType[] {
  try {
    const v: unknown = JSON.parse(json)
    return Array.isArray(v) ? v.filter(isDeliverableType) : []
  } catch {
    return []
  }
}

function toRow(r: ChannelDbRow): ChannelRow {
  return {
    id: r.id,
    name: r.name,
    youtubeChannelId: r.youtube_channel_id,
    niche: r.niche,
    standards: r.standards,
    monthlyBudgetUsd: r.monthly_budget_usd,
    autopilotOn: r.autopilot_on === 1,
    autopilotTarget: r.autopilot_target,
    autopilotWeeklyMax: r.autopilot_weekly_max,
    autoApprove: parseTypes(r.auto_approve),
    ownerGates: parseTypes(r.owner_gates),
    thumbnailStyle: r.thumbnail_style,
    scriptStyle: r.script_style,
    archived: r.archived_at !== null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function typeList(value: unknown, field: string): DeliverableType[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be a list of deliverable types`)
  for (const v of value) if (!isDeliverableType(v)) throw new Error(`${field}: unknown deliverable type "${String(v)}"`)
  return [...new Set(value as DeliverableType[])]
}

function optionalNumber(value: unknown, field: string, integer = false): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${field} must be a non-negative ${integer ? 'integer' : 'number'} or null`)
  }
  return value
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

/** Turns a validated patch into column → value pairs. */
function columns(patch: ChannelPatch | null): Record<string, string | number | null> {
  if (typeof patch !== 'object' || patch === null) throw new Error('A channel patch must be an object')
  const out: Record<string, string | number | null> = {}
  if (patch.name !== undefined) {
    const name = text(patch.name, 'name').trim()
    if (!name) throw new Error('Channel name is required')
    out.name = name
  }
  if (patch.youtubeChannelId !== undefined) out.youtube_channel_id = patch.youtubeChannelId === null ? null : text(patch.youtubeChannelId, 'youtubeChannelId')
  if (patch.niche !== undefined) out.niche = text(patch.niche, 'niche')
  if (patch.standards !== undefined) out.standards = text(patch.standards, 'standards')
  if (patch.monthlyBudgetUsd !== undefined) out.monthly_budget_usd = optionalNumber(patch.monthlyBudgetUsd, 'monthlyBudgetUsd')
  if (patch.autopilotOn !== undefined) out.autopilot_on = patch.autopilotOn ? 1 : 0
  if (patch.autopilotTarget !== undefined) out.autopilot_target = optionalNumber(patch.autopilotTarget, 'autopilotTarget', true)
  if (patch.autopilotWeeklyMax !== undefined) out.autopilot_weekly_max = optionalNumber(patch.autopilotWeeklyMax, 'autopilotWeeklyMax', true)
  if (patch.autoApprove !== undefined) {
    const list = typeList(patch.autoApprove, 'autoApprove')
    if (list.includes('publish_package')) throw new Error('publish_package can never be auto-approved')
    out.auto_approve = JSON.stringify(list)
  }
  // SPEC: the publish package is always validated by the owner, whatever the channel says.
  if (patch.ownerGates !== undefined) {
    out.owner_gates = JSON.stringify([...new Set<DeliverableType>([...typeList(patch.ownerGates, 'ownerGates'), 'publish_package'])])
  }
  if (patch.thumbnailStyle !== undefined) out.thumbnail_style = text(patch.thumbnailStyle, 'thumbnailStyle')
  if (patch.scriptStyle !== undefined) out.script_style = text(patch.scriptStyle, 'scriptStyle')
  return out
}

export class ChannelsStore {
  constructor(private readonly db: Db) {}

  list(includeArchived = false): ChannelRow[] {
    const sql = `SELECT * FROM channels ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY name COLLATE NOCASE, id`
    return (this.db.prepare(sql).all() as unknown as ChannelDbRow[]).map(toRow)
  }

  find(id: number): ChannelRow | null {
    const r = this.db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelDbRow | undefined
    return r ? toRow(r) : null
  }

  get(id: number): ChannelRow {
    const row = this.find(id)
    if (!row) throw new Error(`Channel ${id} not found`)
    return row
  }

  create(input: ChannelInput): ChannelRow {
    const cols = columns({ ownerGates: [...DEFAULT_OWNER_GATES], ...input })
    if (!cols.name) throw new Error('Channel name is required')
    const names = Object.keys(cols)
    const res = this.db
      .prepare(`INSERT INTO channels (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
      .run(...Object.values(cols))
    return this.get(Number(res.lastInsertRowid))
  }

  update(id: number, patch: ChannelPatch): ChannelRow {
    this.get(id)
    const cols = columns(patch)
    const names = Object.keys(cols)
    if (names.length > 0) {
      this.db
        .prepare(`UPDATE channels SET ${names.map((n) => `${n} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...Object.values(cols), nowIso(), id)
    }
    return this.get(id)
  }

  setArchived(id: number, archived: boolean): ChannelRow {
    this.get(id)
    this.db.prepare('UPDATE channels SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? nowIso() : null, nowIso(), id)
    return this.get(id)
  }

  /**
   * Deletes a channel and what hangs on it (the foreign keys cascade or set null): only for a channel the « Ajouter une
   * chaîne » flow made and the owner then cancelled. A channel with a published video is never deleted (archive it).
   */
  discard(id: number): void {
    this.get(id)
    const published = this.db.prepare(`SELECT COUNT(*) AS n FROM videos WHERE channel_id = ? AND status = 'published'`).get(id) as { n: number }
    if (published.n > 0) throw new Error('A channel with a published video cannot be discarded: archive it')
    this.db.prepare('DELETE FROM channels WHERE id = ?').run(id)
  }
}
