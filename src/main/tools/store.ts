// Mes outils store: tools, their versions and their runs. Secret VALUES are written to the encrypted `secrets` store
// under `tools.<slug>.<NAME>` and are never read back into a row (rows only say « défini / non défini »).
import {
  coerceInputs,
  compareSemver,
  parseManifest,
  prettyManifest,
  renderCall,
  requestedPermissions,
  type DryRunCheck,
  type DryRunResult,
  type ManifestIssue,
  type RenderedCall,
  type ToolDetail,
  type ToolManifest,
  type ToolRow,
  type ToolRunRow,
  type ToolStatus,
  type ToolValidation
} from '../../shared/tools'
import type { ToolVersionImport } from '../../shared/api/tools'
import type { Db } from '../db'
import { SecretsUnavailableError, type SecretsStore } from '../secrets'

interface ToolDb {
  slug: string
  name: string
  kind: ToolRow['kind']
  version: string
  manifest_json: string
  status: ToolStatus
  error: string
  permissions_json: string
  granted_json: string
  granted_agents_json: string
  secrets_json: string
  example: number
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function secretKey(slug: string, name: string): string {
  return `tools.${slug}.${name}`
}

function formatIssues(errors: readonly ManifestIssue[]): string {
  return errors
    .slice(0, 5)
    .map((e) => (e.path ? `${e.path} : ${e.message}` : e.message))
    .join(' ; ')
}

function requireSlug(slug: unknown): string {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new Error('Outil : identifiant invalide.')
  return slug
}

export class ToolsStore {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretsStore,
    private readonly agentIds: () => string[],
    private readonly now: () => Date = () => new Date()
  ) {}

  private row(slug: string): ToolDb {
    const r = this.db.prepare('SELECT * FROM tools WHERE slug = ?').get(requireSlug(slug)) as ToolDb | undefined
    if (!r) throw new Error('Outil introuvable.')
    return r
  }

  private secretsMissing(slug: string, names: readonly string[]): string[] {
    return names.filter((n) => !this.secrets.has(secretKey(slug, n)))
  }

  private toRow(r: ToolDb): ToolRow {
    const manifest = JSON.parse(r.manifest_json) as ToolManifest
    const requested = JSON.parse(r.permissions_json) as string[]
    const granted = new Set(JSON.parse(r.granted_json) as string[])
    return {
      slug: r.slug,
      name: r.name,
      kind: r.kind,
      version: r.version,
      description: manifest.description,
      status: r.status,
      error: r.error,
      grantedAgents: JSON.parse(r.granted_agents_json) as string[],
      permissionsRequested: requested.length,
      permissionsGranted: requested.filter((p) => granted.has(p)).length,
      secretsMissing: this.secretsMissing(r.slug, manifest.secrets),
      example: r.example === 1
    }
  }

  list(): ToolRow[] {
    return (this.db.prepare('SELECT * FROM tools ORDER BY name COLLATE NOCASE').all() as unknown as ToolDb[]).map((r) => this.toRow(r))
  }

  get(slug: string): ToolDetail {
    const r = this.row(slug)
    const manifest = JSON.parse(r.manifest_json) as ToolManifest
    const granted = new Set(JSON.parse(r.granted_json) as string[])
    const versions = this.db.prepare('SELECT version, manifest_json, created_at FROM tool_versions WHERE tool = ?').all(r.slug) as {
      version: string
      manifest_json: string
      created_at: string
    }[]
    versions.sort((a, b) => compareSemver(b.version, a.version))
    return {
      ...this.toRow(r),
      manifest,
      manifestText: prettyManifest(manifest),
      permissions: requestedPermissions(manifest).map((p) => ({ ...p, granted: granted.has(p.id) })),
      secrets: manifest.secrets.map((name) => ({ name, set: this.secrets.has(secretKey(r.slug, name)) })),
      versions: versions.map((v) => ({
        version: v.version,
        createdAt: v.created_at,
        manifestText: prettyManifest(JSON.parse(v.manifest_json) as ToolManifest),
        active: v.version === r.version
      }))
    }
  }

  validate(text: string): ToolValidation {
    if (typeof text !== 'string') throw new Error('Manifeste : texte attendu.')
    if (text.length > 500_000) throw new Error('Manifeste trop gros (500 Ko au plus).')
    const parsed = parseManifest(text)
    if (!parsed.ok) return { ok: false, errors: parsed.errors, summary: null, permissions: [], exists: false }
    const m = parsed.manifest
    return {
      ok: true,
      errors: [],
      summary: { id: m.id, name: m.name, version: m.version, kind: m.kind, description: m.description },
      permissions: requestedPermissions(m),
      exists: this.db.prepare('SELECT 1 FROM tools WHERE slug = ?').get(m.id) !== undefined
    }
  }

  private mustParse(text: string): ToolManifest {
    if (typeof text !== 'string') throw new Error('Manifeste : texte attendu.')
    if (text.length > 500_000) throw new Error('Manifeste trop gros (500 Ko au plus).')
    const parsed = parseManifest(text)
    if (!parsed.ok) throw new Error(`Manifeste invalide — ${formatIssues(parsed.errors)}`)
    return parsed.manifest
  }

  /** Status of a tool that is not disabled: a missing secret is an error the user can fix. */
  private statusFor(slug: string, m: ToolManifest): { status: ToolStatus; error: string } {
    const missing = this.secretsMissing(slug, m.secrets)
    return missing.length > 0
      ? { status: 'error', error: `Secret manquant : ${missing.join(', ')}.` }
      : { status: 'ok', error: '' }
  }

  add(text: string, example = false): ToolDetail {
    const m = this.mustParse(text)
    if (this.db.prepare('SELECT 1 FROM tools WHERE slug = ?').get(m.id)) {
      throw new Error(`Un outil « ${m.id} » existe déjà : importe une nouvelle version depuis sa fiche.`)
    }
    const perms = requestedPermissions(m).map((p) => p.id)
    const { status, error } = this.statusFor(m.id, m)
    this.db
      .prepare(
        `INSERT INTO tools (slug, name, kind, version, manifest_json, status, error, permissions_json, granted_json, secrets_json, example)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(m.id, m.name, m.kind, m.version, JSON.stringify(m), status, error, JSON.stringify(perms), JSON.stringify(perms), JSON.stringify(m.secrets), example ? 1 : 0)
    this.db.prepare('INSERT INTO tool_versions (tool, version, manifest_json) VALUES (?,?,?)').run(m.id, m.version, JSON.stringify(m))
    return this.get(m.id)
  }

  delete(slug: string): void {
    const r = this.row(slug)
    for (const n of (JSON.parse(r.secrets_json) as string[]) ?? []) this.secrets.clear(secretKey(r.slug, n))
    this.db.prepare('DELETE FROM tools WHERE slug = ?').run(r.slug)
  }

  private refreshStatus(slug: string): void {
    const r = this.row(slug)
    if (r.status === 'disabled') return
    const { status, error } = this.statusFor(slug, JSON.parse(r.manifest_json) as ToolManifest)
    this.db.prepare(`UPDATE tools SET status=?, error=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug=?`).run(status, error, slug)
  }

  setEnabled(slug: string, enabled: boolean): ToolDetail {
    if (typeof enabled !== 'boolean') throw new Error('Activation : vrai ou faux attendu.')
    const r = this.row(slug)
    if (enabled) {
      const { status, error } = this.statusFor(r.slug, JSON.parse(r.manifest_json) as ToolManifest)
      this.db.prepare(`UPDATE tools SET status=?, error=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug=?`).run(status, error, r.slug)
    } else {
      this.db.prepare(`UPDATE tools SET status='disabled', error='', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug=?`).run(r.slug)
    }
    return this.get(r.slug)
  }

  setPermission(slug: string, permissionId: string, granted: boolean): ToolDetail {
    const r = this.row(slug)
    if (typeof granted !== 'boolean') throw new Error('Permission : vrai ou faux attendu.')
    const requested = JSON.parse(r.permissions_json) as string[]
    if (typeof permissionId !== 'string' || !requested.includes(permissionId)) throw new Error('Cette permission n’est pas demandée par l’outil.')
    const set = new Set(JSON.parse(r.granted_json) as string[])
    if (granted) set.add(permissionId)
    else set.delete(permissionId)
    this.db.prepare(`UPDATE tools SET granted_json=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug=?`).run(JSON.stringify([...set]), r.slug)
    return this.get(r.slug)
  }

  setAgents(slug: string, agentIds: string[]): ToolDetail {
    const r = this.row(slug)
    if (!Array.isArray(agentIds) || agentIds.some((a) => typeof a !== 'string')) throw new Error('Agents : liste attendue.')
    const known = new Set(this.agentIds())
    const unknown = agentIds.find((a) => !known.has(a))
    if (unknown) throw new Error(`Agent inconnu : ${unknown}.`)
    this.db
      .prepare(`UPDATE tools SET granted_agents_json=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug=?`)
      .run(JSON.stringify([...new Set(agentIds)]), r.slug)
    return this.get(r.slug)
  }

  private declaredSecret(slug: string, name: string): string {
    const r = this.row(slug)
    if (typeof name !== 'string' || !(JSON.parse(r.secrets_json) as string[]).includes(name)) throw new Error('Ce secret n’est pas déclaré par l’outil.')
    return secretKey(r.slug, name)
  }

  setSecret(slug: string, name: string, value: string): ToolDetail {
    const key = this.declaredSecret(slug, name)
    if (typeof value !== 'string' || value.trim() === '') throw new Error('La valeur du secret est vide.')
    if (value.length > 20_000) throw new Error('Valeur trop longue.')
    try {
      this.secrets.set(key, value)
    } catch (err) {
      if (err instanceof SecretsUnavailableError) throw new Error('Le chiffrement du système n’est pas disponible : le secret n’a pas été enregistré.', { cause: err })
      throw err
    }
    this.refreshStatus(slug)
    return this.get(slug)
  }

  clearSecret(slug: string, name: string): ToolDetail {
    this.secrets.clear(this.declaredSecret(slug, name))
    this.refreshStatus(slug)
    return this.get(slug)
  }

  // --- versions -----------------------------------------------------------------------------------------------

  /** Makes `m` the active manifest. Permissions already granted stay granted; new ones wait for the user. */
  private apply(slug: string, m: ToolManifest): ToolVersionImport {
    const r = this.row(slug)
    const oldRequested = JSON.parse(r.permissions_json) as string[]
    const oldGranted = new Set(JSON.parse(r.granted_json) as string[])
    const requested = requestedPermissions(m).map((p) => p.id)
    const granted = requested.filter((p) => oldGranted.has(p))
    const newPermissions = requested.filter((p) => !oldRequested.includes(p))
    const status: { status: ToolStatus; error: string } = r.status === 'disabled' ? { status: 'disabled', error: '' } : this.statusFor(slug, m)
    this.db
      .prepare(
        `UPDATE tools SET name=?, version=?, manifest_json=?, status=?, error=?, permissions_json=?, granted_json=?, secrets_json=?,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug=?`
      )
      .run(m.name, m.version, JSON.stringify(m), status.status, status.error, JSON.stringify(requested), JSON.stringify(granted), JSON.stringify(m.secrets), slug)
    return { tool: this.get(slug), newPermissions }
  }

  importVersion(slug: string, text: string): ToolVersionImport {
    const r = this.row(slug)
    const m = this.mustParse(text)
    if (m.id !== r.slug) throw new Error(`L’identifiant du manifeste (« ${m.id} ») doit rester « ${r.slug} ».`)
    if (m.kind !== r.kind) throw new Error('Le type de l’outil ne peut pas changer d’une version à l’autre.')
    if (this.db.prepare('SELECT 1 FROM tool_versions WHERE tool = ? AND version = ?').get(r.slug, m.version)) {
      throw new Error(`La version ${m.version} existe déjà : change le numéro de version du manifeste.`)
    }
    this.db.prepare('INSERT INTO tool_versions (tool, version, manifest_json) VALUES (?,?,?)').run(r.slug, m.version, JSON.stringify(m))
    return this.apply(r.slug, m)
  }

  activateVersion(slug: string, version: string): ToolVersionImport {
    const r = this.row(slug)
    const v = this.db.prepare('SELECT manifest_json FROM tool_versions WHERE tool = ? AND version = ?').get(r.slug, String(version)) as
      | { manifest_json: string }
      | undefined
    if (!v) throw new Error('Version introuvable.')
    return this.apply(r.slug, JSON.parse(v.manifest_json) as ToolManifest)
  }

  // --- runs ---------------------------------------------------------------------------------------------------

  private toRun(r: {
    id: number
    tool: string
    input_json: string
    output_text: string
    status: ToolRunRow['status']
    ms: number
    created_at: string
    example: number
  }): ToolRunRow {
    return {
      id: r.id,
      tool: r.tool,
      input: JSON.parse(r.input_json) as Record<string, unknown>,
      outputText: r.output_text,
      status: r.status,
      ms: r.ms,
      createdAt: r.created_at,
      example: r.example === 1
    }
  }

  runs(slug?: string): ToolRunRow[] {
    const rows =
      slug === undefined
        ? this.db.prepare('SELECT * FROM tool_runs ORDER BY id DESC LIMIT 200').all()
        : this.db.prepare('SELECT * FROM tool_runs WHERE tool = ? ORDER BY id DESC LIMIT 200').all(this.row(slug).slug)
    return (rows as unknown as Parameters<ToolsStore['toRun']>[0][]).map((r) => this.toRun(r))
  }

  /** Test console: a REAL dry run. Nothing is executed (real execution is lot 18); the call is rendered exactly. */
  dryRun(slug: string, input: Record<string, unknown>): DryRunResult {
    const started = this.now().getTime()
    const r = this.row(slug)
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Entrées : objet attendu.')
    const m = JSON.parse(r.manifest_json) as ToolManifest
    const { values, errors } = coerceInputs(m, input)
    const granted = new Set(JSON.parse(r.granted_json) as string[])
    const notGranted = (JSON.parse(r.permissions_json) as string[]).filter((p) => !granted.has(p))
    const missing = this.secretsMissing(r.slug, m.secrets)
    const checks: DryRunCheck[] = [
      { id: 'inputs', ok: errors.length === 0, items: errors.map((e) => `${e.path} : ${e.message}`) },
      { id: 'permissions', ok: notGranted.length === 0, items: notGranted },
      { id: 'secrets', ok: missing.length === 0, items: missing },
      { id: 'enabled', ok: r.status !== 'disabled', items: [] }
    ]
    const rendered: RenderedCall | null = errors.length === 0 ? renderCall(m, values) : null
    const outputText = rendered ? describe(rendered) : checks[0]!.items.join('\n')
    const status: ToolRunRow['status'] = rendered ? 'dry_run' : 'error'
    const ms = Math.max(0, this.now().getTime() - started)
    const info = this.db
      .prepare('INSERT INTO tool_runs (tool, input_json, output_text, status, ms) VALUES (?,?,?,?,?)')
      .run(r.slug, JSON.stringify(values), outputText, status, ms)
    const run = this.toRun(this.db.prepare('SELECT * FROM tool_runs WHERE id = ?').get(Number(info.lastInsertRowid)) as never)
    return { ok: checks.every((c) => c.ok), checks, rendered, run }
  }
}

/** The text stored with a dry run: what would have run. */
export function describe(c: RenderedCall): string {
  switch (c.kind) {
    case 'command':
      return `${c.line}\nstdin: ${c.stdin}`
    case 'http':
      return `${c.method} ${c.url}${c.body ? `\n${c.body}` : ''}`
    case 'mcp':
      return `MCP ${c.transport} ${c.target}\ntools/call ${c.tool} ${JSON.stringify(c.arguments)}`
  }
}
