// A pipeline's conversation with the agent in SQLite (migration 031): its messages and the changes proposed to it. A change
// is a batch of edit operations made on one version: `pending` until the owner accepts (a new version, `saved_version`) or
// rejects it; a newer proposal replaces a pending one, so a pipeline has at most one change waiting.
import type { Db } from '../../db'

export interface ChangeRow {
  id: number
  recipe_id: number
  base_version: number
  ops_json: string
  note: string
  author: 'agent' | 'team'
  status: 'pending' | 'accepted' | 'rejected' | 'replaced'
  saved_version: number | null
  created_at: string
  decided_at: string | null
}

export interface MessageRow {
  id: number
  recipe_id: number
  role: 'user' | 'agent' | 'system'
  text: string
  change_id: number | null
  errors_json: string | null
  created_at: string
}

export interface MessageErrors {
  op: number
  code: string
  message: string
}

/** How many messages of a pipeline's conversation are kept in view (and in the agent's prompt). */
export const THREAD_LIMIT = 80

export class ThreadStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  private iso(): string {
    return this.now().toISOString()
  }

  messages(recipeId: number, limit = THREAD_LIMIT): MessageRow[] {
    const rows = this.db.prepare('SELECT * FROM pipeline_messages WHERE recipe_id = ? ORDER BY id DESC LIMIT ?').all(recipeId, limit) as unknown as MessageRow[]
    return rows.reverse()
  }

  addMessage(recipeId: number, role: MessageRow['role'], text: string, changeId: number | null = null, errors: MessageErrors[] = []): number {
    const r = this.db
      .prepare('INSERT INTO pipeline_messages (recipe_id, role, text, change_id, errors_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(recipeId, role, text.slice(0, 8000), changeId, errors.length > 0 ? JSON.stringify(errors.slice(0, 20)) : null, this.iso())
    return Number(r.lastInsertRowid)
  }

  changes(recipeId: number, limit = 30): ChangeRow[] {
    return this.db.prepare('SELECT * FROM pipeline_changes WHERE recipe_id = ? ORDER BY id DESC LIMIT ?').all(recipeId, limit) as unknown as ChangeRow[]
  }

  change(recipeId: number, id: number): ChangeRow {
    const r = this.db.prepare('SELECT * FROM pipeline_changes WHERE id = ? AND recipe_id = ?').get(id, recipeId) as ChangeRow | undefined
    if (!r) throw new Error('Modification inconnue.')
    return r
  }

  pending(recipeId: number): ChangeRow | null {
    return (this.db.prepare(`SELECT * FROM pipeline_changes WHERE recipe_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`).get(recipeId) as ChangeRow | undefined) ?? null
  }

  /** A new proposed change; the one waiting (if any) is replaced. */
  addChange(recipeId: number, baseVersion: number, ops: readonly unknown[], note: string, author: ChangeRow['author']): number {
    const now = this.iso()
    this.db.prepare(`UPDATE pipeline_changes SET status = 'replaced', decided_at = ? WHERE recipe_id = ? AND status = 'pending'`).run(now, recipeId)
    const r = this.db
      .prepare('INSERT INTO pipeline_changes (recipe_id, base_version, ops_json, note, author, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(recipeId, baseVersion, JSON.stringify(ops), note.trim().slice(0, 500), author, 'pending', now)
    return Number(r.lastInsertRowid)
  }

  decide(id: number, status: 'accepted' | 'rejected', savedVersion: number | null = null): void {
    this.db.prepare('UPDATE pipeline_changes SET status = ?, saved_version = ?, decided_at = ? WHERE id = ?').run(status, savedVersion, this.iso(), id)
  }
}
