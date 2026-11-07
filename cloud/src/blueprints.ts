// Blueprints (PLAN-COMPLEXITE §E.9): the default agent organisation and the preset pipelines every workspace gets. The
// founder edits them in the console without code and publishes a version; the apps read the current one. Versions are
// kept (append only), so a publish can be compared or restored.
import { Blueprint } from '../../src/shared/cloud-api.ts'
import type { Audit } from './audit.ts'
import type { Clock } from './clock.ts'
import type { CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'

type BlueprintDoc = ReturnType<typeof Blueprint.parse>

export interface BlueprintVersion {
  version: number
  note: string
  publishedBy: string
  publishedAt: string
}

export class Blueprints {
  private readonly db: CloudDb
  private readonly clock: Clock
  private readonly audit: Audit
  constructor(db: CloudDb, clock: Clock, audit: Audit) {
    this.db = db
    this.clock = clock
    this.audit = audit
  }

  current(): { version: number; blueprint: BlueprintDoc; publishedAt: string } | null {
    const row = this.db.prepare('SELECT version, json, published_at FROM blueprints ORDER BY version DESC LIMIT 1').get() as
      | { version: number; json: string; published_at: string }
      | undefined
    return row ? { version: row.version, blueprint: JSON.parse(row.json) as BlueprintDoc, publishedAt: row.published_at } : null
  }

  get(version: number): BlueprintDoc {
    const row = this.db.prepare('SELECT json FROM blueprints WHERE version = ?').get(version) as { json: string } | undefined
    if (!row) throw new CloudError('not_found', `no blueprint v${version}`)
    return JSON.parse(row.json) as BlueprintDoc
  }

  versions(): BlueprintVersion[] {
    const rows = this.db.prepare('SELECT version, note, published_by, published_at FROM blueprints ORDER BY version DESC').all() as {
      version: number
      note: string
      published_by: string
      published_at: string
    }[]
    return rows.map((r) => ({ version: r.version, note: r.note, publishedBy: r.published_by, publishedAt: r.published_at }))
  }

  /** Publishes a checked blueprint as the next version (the version number is the server's). */
  publish(raw: unknown, note: string, actor: string): { version: number } {
    const parsed = Blueprint.safeParse(raw)
    if (!parsed.success) {
      const i = parsed.error.issues[0]
      throw new CloudError('bad_request', `blueprint${i?.path.length ? '.' + i.path.join('.') : ''}: ${i?.message ?? 'invalid'}`)
    }
    const doc = parsed.data
    const dup = (ids: string[]): string | undefined => ids.find((id, i) => ids.indexOf(id) !== i)
    const d = dup(doc.agents.map((a) => a.id)) ?? dup(doc.pipelines.map((p) => p.id)) ?? doc.pipelines.map((p) => dup(p.nodes.map((n) => n.id))).find(Boolean)
    if (d) throw new CloudError('bad_request', `blueprint: duplicate id ${d}`)
    const last = (this.db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM blueprints').get() as { v: number }).v
    const version = last + 1
    const stored = { ...doc, version }
    this.db
      .prepare('INSERT INTO blueprints (version, json, note, published_by, published_at) VALUES (?, ?, ?, ?, ?)')
      .run(version, JSON.stringify(stored), note.slice(0, 300), actor, new Date(this.clock.now()).toISOString())
    this.audit.record(actor, 'blueprint.publish', `v${version}`, { agents: doc.agents.length, pipelines: doc.pipelines.length })
    return { version }
  }
}
