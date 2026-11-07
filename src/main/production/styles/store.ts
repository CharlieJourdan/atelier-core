// The brick styles store (decision 0021, migration 029): a style belongs to the team and dresses one brick family
// (fixed at its first save); each save is a new immutable version holding the whole `atelier.brickstyle/1` document.
// The founder's base styles are inserted once, lazily, as version 1. Export / import is one `.atelier-style.json` file.
import {
  BrickStyleSchema,
  parseStyleRef,
  type BrickStyle,
  type BrickStyleDetail,
  type BrickStyleSummary,
  type StyleFamily
} from '../../../shared/brick-styles'
import { transaction, type Db } from '../../db'
import { BASE_STYLES, SHIPPED_NOTE, SHIPPED_UPDATES, type ShippedUpdate } from './seeds'

interface StyleRow {
  name: string
  family: StyleFamily
  builtin: number
  created_at: string
  updated_at: string
}

interface VersionRow {
  number: number
  json: string
  note: string
  created_at: string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export class BrickStyleStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  private iso(): string {
    return this.now().toISOString()
  }

  /** Inserts version 1 of each builtin style that is absent, then the shipped updates (`SHIPPED_UPDATES`) of a builtin style
   *  whose latest version is still a shipped one (an owner's own edits are never covered). Idempotent. */
  ensureBuiltins(seeds: readonly BrickStyle[] = BASE_STYLES, updates: readonly ShippedUpdate[] = SHIPPED_UPDATES): void {
    const missing = seeds.filter((s) => !this.db.prepare('SELECT 1 FROM brick_styles WHERE name = ?').get(s.id))
    if (missing.length > 0) this.insertSeeds(missing)
    for (const u of updates) this.applyUpdate(u)
  }

  private applyUpdate(u: ShippedUpdate): void {
    const style = this.db.prepare('SELECT builtin FROM brick_styles WHERE name = ?').get(u.style.id) as { builtin: number } | undefined
    if (!style || style.builtin !== 1) return
    if (this.db.prepare('SELECT 1 FROM brick_style_versions WHERE style_name = ? AND note = ?').get(u.style.id, u.note)) return
    const last = this.db.prepare('SELECT number, note FROM brick_style_versions WHERE style_name = ? ORDER BY number DESC LIMIT 1').get(u.style.id) as
      | { number: number; note: string }
      | undefined
    if (!last || !last.note.startsWith(SHIPPED_NOTE)) return
    const number = last.number + 1
    const at = this.iso()
    const doc = this.validate({ ...u.style, version: number })
    transaction(this.db, () => {
      this.db.prepare('INSERT INTO brick_style_versions (style_name, number, json, note, created_at) VALUES (?, ?, ?, ?, ?)').run(doc.id, number, JSON.stringify(doc), u.note, at)
      this.db.prepare('UPDATE brick_styles SET updated_at = ? WHERE name = ?').run(at, doc.id)
    })
  }

  private insertSeeds(missing: readonly BrickStyle[]): void {
    const at = this.iso()
    transaction(this.db, () => {
      for (const seed of missing) {
        const doc = this.validate({ ...seed, version: 1 })
        this.db.prepare('INSERT OR IGNORE INTO brick_styles (name, family, builtin, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(doc.id, doc.family, at, at)
        this.db
          .prepare('INSERT OR IGNORE INTO brick_style_versions (style_name, number, json, note, created_at) VALUES (?, 1, ?, ?, ?)')
          .run(doc.id, JSON.stringify(doc), 'Livré avec Atelier', at)
      }
    })
  }

  private validate(doc: unknown): BrickStyle {
    const r = BrickStyleSchema.safeParse(doc)
    if (r.success) return r.data
    const list = r.error.issues
      .slice(0, 5)
      .map((i) => `${i.message}${i.path.length > 0 ? ` (${i.path.join('.')})` : ''}`)
      .join(' ; ')
    throw new Error(`Le style n’est pas valable : ${list}.`)
  }

  private row(name: string): StyleRow {
    this.ensureBuiltins()
    const r = this.db.prepare('SELECT * FROM brick_styles WHERE name = ?').get(name) as StyleRow | undefined
    if (!r) throw new Error(`Style introuvable : ${name}.`)
    return r
  }

  private version(name: string, version?: number): { doc: BrickStyle; number: number } {
    const r =
      version === undefined
        ? (this.db.prepare('SELECT number, json FROM brick_style_versions WHERE style_name = ? ORDER BY number DESC LIMIT 1').get(name) as
            | Pick<VersionRow, 'number' | 'json'>
            | undefined)
        : (this.db.prepare('SELECT number, json FROM brick_style_versions WHERE style_name = ? AND number = ?').get(name, version) as
            | Pick<VersionRow, 'number' | 'json'>
            | undefined)
    if (!r) throw new Error(`Version de style introuvable : ${name}${version !== undefined ? `@${version}` : ''}.`)
    return { doc: JSON.parse(r.json) as BrickStyle, number: r.number }
  }

  private summary(r: StyleRow): BrickStyleSummary {
    const { doc, number } = this.version(r.name)
    return { id: r.name, family: r.family, label: doc.label ?? null, version: number, builtin: r.builtin === 1, updatedAt: r.updated_at }
  }

  list(): BrickStyleSummary[] {
    this.ensureBuiltins()
    const rows = this.db.prepare('SELECT * FROM brick_styles ORDER BY builtin DESC, name').all() as unknown as StyleRow[]
    return rows.map((r) => this.summary(r))
  }

  get(name: unknown, version?: unknown): BrickStyleDetail {
    if (typeof name !== 'string') throw new Error('Nom de style invalide.')
    if (version !== undefined && (typeof version !== 'number' || !Number.isInteger(version) || version < 1)) throw new Error('Version invalide.')
    const r = this.row(name)
    const { doc, number } = this.version(r.name, version as number | undefined)
    const versions = this.db.prepare('SELECT number, note, created_at FROM brick_style_versions WHERE style_name = ? ORDER BY number DESC').all(r.name) as unknown as VersionRow[]
    return { ...this.summary(r), doc, docVersion: number, versions: versions.map((v) => ({ number: v.number, note: v.note, createdAt: v.created_at })) }
  }

  /** A new style, or a new immutable version of one (the family of a style never changes). */
  save(input: unknown): BrickStyleDetail {
    if (!isObj(input)) throw new Error('Style invalide.')
    const parsed = this.validate(input.doc)
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : ''
    this.ensureBuiltins()
    const at = this.iso()
    transaction(this.db, () => {
      const existing = this.db.prepare('SELECT * FROM brick_styles WHERE name = ?').get(parsed.id) as StyleRow | undefined
      if (existing && existing.family !== parsed.family) {
        throw new Error(`Le style « ${parsed.id} » est de la famille ${existing.family} : sa famille ne change pas.`)
      }
      if (existing) this.db.prepare('UPDATE brick_styles SET updated_at = ? WHERE name = ?').run(at, parsed.id)
      else this.db.prepare('INSERT INTO brick_styles (name, family, builtin, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(parsed.id, parsed.family, at, at)
      const last = this.db.prepare('SELECT MAX(number) AS n FROM brick_style_versions WHERE style_name = ?').get(parsed.id) as { n: number | null }
      const number = (last.n ?? 0) + 1
      const stored: BrickStyle = { ...parsed, version: number }
      this.db.prepare('INSERT INTO brick_style_versions (style_name, number, json, note, created_at) VALUES (?, ?, ?, ?, ?)').run(parsed.id, number, JSON.stringify(stored), note, at)
    })
    return this.get(parsed.id)
  }

  /** `name` (the latest version) or `name@n`; unknown → French error. */
  resolve(ref: string): { name: string; version: number; family: StyleFamily; doc: BrickStyle } {
    const p = typeof ref === 'string' ? parseStyleRef(ref) : null
    if (!p) throw new Error(`Référence de style invalide : ${String(ref)}.`)
    const r = this.row(p.name)
    const { doc, number } = this.version(r.name, p.version ?? undefined)
    return { name: r.name, version: number, family: r.family, doc }
  }

  exportFile(name: unknown, version?: unknown): { fileName: string; json: string } {
    const d = this.get(name, version)
    return { fileName: `${d.id}.atelier-style.json`, json: `${JSON.stringify(d.doc, null, 2)}\n` }
  }

  importFile(json: unknown): BrickStyleDetail {
    if (typeof json !== 'string' || json.length > 1_000_000) throw new Error('Fichier de style invalide.')
    let doc: unknown
    try {
      doc = JSON.parse(json)
    } catch {
      throw new Error('Ce fichier n’est pas du JSON.')
    }
    return this.save({ doc, note: 'Importé' })
  }
}
