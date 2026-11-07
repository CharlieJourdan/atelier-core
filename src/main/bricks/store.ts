// The custom bricks of the channels (« briques sur mesure », docs/ENGINE-SPEC.md §25.2, docs/AGENT-RUNTIME.md §23): the index in SQLite
// (migration 024) and the bricks themselves as files of the workspace data folder, one folder per version:
//   <root>/channel-<id>/<brick>/v<n>/brick.json        the brick (formats/brick.ts), checked when it is written
//   <root>/channel-<id>/<brick>/v<n>/preview-<k>/…      the stills (PNG + JPEG over grey) and the clip of each preview
// Life of a brick: an agent drafts it (brouillon), previews it (at most MAX_TRIES previews before it must propose it or ask), proposes it
// (à valider: an inbox item for Charlie), and Charlie's answer decides: « Valider » → validée (that version is what the channel's films use,
// and the channel uses it from now on), anything else → back to brouillon with his note, for the agent to revise. A new draft of a validated
// brick does not touch the validated version until Charlie validates the new one. Nothing here runs the brick: it is data.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Brick, staticProblems, type BrickInput } from '../../engine/formats/brick'
import type { LintIssue } from '../../engine/motion/brick-lint'
import type { CustomBrick, CustomBrickState } from '../../shared/api/bricks'
import type { Db } from '../db'

/** Previews of one draft before the agent must propose it (or ask Charlie). */
export const MAX_TRIES = 4

export interface PreviewRecord {
  version: number
  ok: boolean
  at: string
  aspect: '16:9' | '9:16'
  lint: LintIssue[]
  stills: { share: number; png: string; jpeg: string | null; coverage: number }[]
  clip: string | null
}

export interface BrickRow {
  id: number
  channelId: number
  slug: string
  name: string
  version: number
  state: CustomBrickState
  approvedVersion: number | null
  enabled: boolean
  contentHash: string
  tries: number
  preview: PreviewRecord | null
  note: string | null
  inboxId: number | null
  agentId: number | null
  taskId: number | null
  createdAt: string
  updatedAt: string
}

interface Raw {
  id: number
  channel_id: number
  slug: string
  name: string
  version: number
  state: CustomBrickState
  approved_version: number | null
  enabled: number
  content_hash: string
  tries: number
  preview_json: string | null
  note: string | null
  inbox_id: number | null
  agent_id: number | null
  task_id: number | null
  created_at: string
  updated_at: string
}

/** Everything the agent wrote but the version number: a change of any of it makes a new version. */
const contentHash = (b: Brick): string => createHash('sha256').update(JSON.stringify({ ...b, version: 0 })).digest('hex').slice(0, 32)

const YES = /^(oui|ok|okay|valider|valide|validé|validée|approuver|approuvé|go|d['’]accord|yes|approve|accept)/i

const toRow = (r: Raw): BrickRow => ({
  id: r.id,
  channelId: r.channel_id,
  slug: r.slug,
  name: r.name,
  version: r.version,
  state: r.state,
  approvedVersion: r.approved_version,
  enabled: r.enabled === 1,
  contentHash: r.content_hash,
  tries: r.tries,
  preview: r.preview_json ? (JSON.parse(r.preview_json) as PreviewRecord) : null,
  note: r.note,
  inboxId: r.inbox_id,
  agentId: r.agent_id,
  taskId: r.task_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export class BrickStore {
  constructor(
    private readonly db: Db,
    /** `<data>/bricks`. */
    readonly root: string,
    private readonly now: () => number = Date.now,
    private readonly notify: () => void = () => undefined
  ) {}

  private iso(): string {
    return new Date(this.now()).toISOString()
  }

  dirOf(channelId: number, slug: string, version: number): string {
    return path.join(this.root, `channel-${channelId}`, slug, `v${version}`)
  }

  /** Writes a draft: a new version when the content changed (the same content keeps its version). Throws on a bad brick, naming the field. */
  draft(channelId: number, input: Omit<BrickInput, 'version'>, who: { agentId: number | null; taskId: number | null }): { row: BrickRow; brick: Brick; changed: boolean } {
    const cur = this.get(channelId, String(input.id))
    const probe = Brick.safeParse({ ...input, version: cur?.version ?? 1 })
    if (!probe.success) throw new Error(`The brick is not valid: ${probe.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'brick'} ${i.message}`).join(' ; ')}`)
    const bad = staticProblems(probe.data)
    if (bad.length > 0) throw new Error(`The brick is refused before any drawing: ${bad.join(' ; ')}`)
    if (cur !== null && contentHash(probe.data) === cur.contentHash) return { row: cur, brick: probe.data, changed: false }
    const version = cur === null ? 1 : cur.version + 1
    const brick = Brick.parse({ ...input, version })
    const hash = contentHash(brick)
    const dir = this.dirOf(channelId, brick.id, version)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'brick.json'), JSON.stringify(brick, null, 2), 'utf8')
    const at = this.iso()
    if (cur === null) {
      this.db
        .prepare('INSERT INTO bricks (channel_id, slug, name, version, state, content_hash, agent_id, task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(channelId, brick.id, brick.name, version, 'draft', hash, who.agentId, who.taskId, at, at)
    } else {
      // a changed brick is a draft again (a validated version stays what the films use until the new one is validated)
      this.db
        .prepare(`UPDATE bricks SET name = ?, version = ?, state = 'draft', content_hash = ?, agent_id = ?, task_id = ?, updated_at = ? WHERE id = ?`)
        .run(brick.name, version, hash, who.agentId, who.taskId, at, cur.id)
    }
    this.notify()
    return { row: this.get(channelId, brick.id) as BrickRow, brick, changed: true }
  }

  /** A version of a brick (default: its latest). */
  brick(row: BrickRow, version = row.version): Brick {
    const file = path.join(this.dirOf(row.channelId, row.slug, version), 'brick.json')
    return Brick.parse(JSON.parse(readFileSync(file, 'utf8')))
  }

  get(channelId: number, slug: string): BrickRow | null {
    const r = this.db.prepare('SELECT * FROM bricks WHERE channel_id = ? AND slug = ?').get(channelId, slug) as Raw | undefined
    return r ? toRow(r) : null
  }

  byId(id: number): BrickRow {
    const r = this.db.prepare('SELECT * FROM bricks WHERE id = ?').get(id) as Raw | undefined
    if (!r) throw new Error(`Unknown brick: ${String(id)}`)
    return toRow(r)
  }

  list(channelId?: number): BrickRow[] {
    const rows = (channelId === undefined
      ? this.db.prepare('SELECT * FROM bricks ORDER BY updated_at DESC, id DESC').all()
      : this.db.prepare('SELECT * FROM bricks WHERE channel_id = ? ORDER BY updated_at DESC, id DESC').all(channelId)) as unknown as Raw[]
    return rows.map(toRow)
  }

  /** The folder of the next preview of the current version. */
  previewDir(row: BrickRow): string {
    return path.join(this.dirOf(row.channelId, row.slug, row.version), `preview-${row.tries + 1}`)
  }

  recordPreview(id: number, rec: PreviewRecord): BrickRow {
    this.db.prepare('UPDATE bricks SET tries = tries + 1, preview_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(rec), this.iso(), id)
    this.notify()
    return this.byId(id)
  }

  /** The brick goes to Charlie (its inbox item); the tries start again for the next round. */
  propose(id: number, inboxId: number): BrickRow {
    this.db.prepare(`UPDATE bricks SET state = 'review', inbox_id = ?, tries = 0, updated_at = ? WHERE id = ?`).run(inboxId, this.iso(), id)
    this.notify()
    return this.byId(id)
  }

  /**
   * Charlie answered a proposal's inbox item: « Valider » (or a yes) validates the proposed version and the channel uses it; anything else
   * sends it back as a draft with his note. Returns the brick, or null when the item is not a brick's.
   */
  decide(inboxId: number, answer: { choice?: string; text?: string }): BrickRow | null {
    const r = this.db.prepare(`SELECT * FROM bricks WHERE inbox_id = ? AND state = 'review'`).get(inboxId) as Raw | undefined
    if (!r) return null
    const yes = [answer.choice, answer.text].some((s) => typeof s === 'string' && YES.test(s.trim()))
    const at = this.iso()
    if (yes) this.db.prepare(`UPDATE bricks SET state = 'approved', approved_version = version, enabled = 1, note = NULL, updated_at = ? WHERE id = ?`).run(at, r.id)
    else {
      const note = (answer.text ?? '').trim() || (answer.choice ?? '').trim() || 'Refusée'
      this.db.prepare(`UPDATE bricks SET state = 'draft', note = ?, tries = 0, updated_at = ? WHERE id = ?`).run(note.slice(0, 2000), at, r.id)
    }
    this.notify()
    return this.byId(r.id)
  }

  /** Whether the channel's films use a validated brick (Production › Briques). */
  setEnabled(id: number, on: boolean): BrickRow {
    const row = this.byId(id)
    if (row.approvedVersion === null) throw new Error('Only a validated brick can be used in the films')
    this.db.prepare('UPDATE bricks SET enabled = ?, updated_at = ? WHERE id = ?').run(on ? 1 : 0, this.iso(), id)
    this.notify()
    return this.byId(id)
  }

  /** The validated version of every brick the channel uses in its films: what a run gets (motion.render, the director). */
  approvedFor(channelId: number): Brick[] {
    const out: Brick[] = []
    for (const row of this.list(channelId)) {
      if (!row.enabled || row.approvedVersion === null) continue
      try {
        out.push(this.brick(row, row.approvedVersion))
      } catch {
        // a brick whose file is gone is left out (the screen shows it)
      }
    }
    return out
  }

  /** What the screens show: the brick and its last preview's stills as small data URLs. */
  view(row: BrickRow): CustomBrick {
    let description = ''
    try {
      description = this.brick(row).description
    } catch {
      // missing file
    }
    const stills = (row.preview?.stills ?? [])
      .map((s) => {
        if (!s.jpeg || !existsSync(s.jpeg)) return null
        const data = readFileSync(s.jpeg)
        return data.length <= 400_000 ? { share: s.share, dataUrl: `data:image/jpeg;base64,${data.toString('base64')}` } : null
      })
      .filter((x): x is { share: number; dataUrl: string } => x !== null)
    return {
      id: row.id,
      channelId: row.channelId,
      slug: row.slug,
      template: `custom:${row.slug}`,
      name: row.name,
      description,
      version: row.version,
      approvedVersion: row.approvedVersion,
      state: row.state,
      enabled: row.enabled,
      note: row.note,
      inboxId: row.inboxId,
      lintOk: row.preview ? row.preview.ok && row.preview.version === row.version : null,
      lint: (row.preview?.lint ?? []).map((i) => i.message).slice(0, 12),
      stills,
      updatedAt: row.updatedAt
    }
  }
}
