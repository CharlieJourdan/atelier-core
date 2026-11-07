// Mes outils (lot Z1, PLAN-V2 §4): the tool manifest `atelier-tool.json` as a zod schema, French validation errors per
// path, requested permissions, input coercion, the dry-run rendering and a JSON line diff. Pure: no I/O.
//
// Manifest format: JSON only. A YAML subset was left out on purpose (no dependency, and a half parser would give
// confusing errors); the add dialog says so when it meets something that is not JSON.
import { z } from 'zod'

export const TOOL_KINDS = ['command', 'script', 'http', 'mcp'] as const
export type ToolKind = (typeof TOOL_KINDS)[number]
export const TOOL_STATUSES = ['ok', 'error', 'disabled'] as const
export type ToolStatus = (typeof TOOL_STATUSES)[number]
export const PARAM_TYPES = ['string', 'number', 'boolean', 'json', 'file'] as const
export type ParamType = (typeof PARAM_TYPES)[number]
export const PRODUCTION_SLOTS = ['narration', 'thumbnail', 'metadata', 'visuals'] as const
export const PORT_TYPES = ['audio', 'image', 'text', 'json', 'file'] as const
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i
const SHELL_CHARS = /[|&;<>`$\n\r]/

const param = z.strictObject({
  name: z.string().regex(IDENT, 'doit être un identifiant (lettres, chiffres, _)'),
  type: z.enum(PARAM_TYPES),
  required: z.boolean().default(false),
  description: z.string().default(''),
  default: z.unknown().optional()
})
export type ToolParam = z.infer<typeof param>

export const toolManifestSchema = z
  .strictObject({
    $schema: z.string().optional(),
    id: z.string().regex(KEBAB, 'doit être en kebab-case (exemple : voix-maison)').max(64, 'au plus 64 caractères'),
    name: z.string().trim().min(1, 'ne peut pas être vide').max(120, 'au plus 120 caractères'),
    version: z.string().regex(SEMVER, 'doit être une version semver (exemple : 1.2.0)'),
    kind: z.enum(TOOL_KINDS),
    description: z.string().default(''),
    entry: z.strictObject({
      command: z.string().optional(),
      args: z.array(z.string()).default([]),
      url: z.string().optional(),
      method: z.enum(HTTP_METHODS).default('GET'),
      headers: z.record(z.string(), z.string()).default({}),
      body: z.string().optional(),
      transport: z.enum(['stdio', 'http']).optional(),
      tool: z.string().optional()
    }),
    inputs: z.array(param).default([]),
    outputs: z
      .array(z.strictObject({ name: z.string().min(1, 'ne peut pas être vide'), type: z.enum(PARAM_TYPES), description: z.string().default('') }))
      .default([]),
    permissions: z
      .strictObject({
        fs: z
          .strictObject({ read: z.array(z.string()).default([]), write: z.array(z.string()).default([]) })
          .default({ read: [], write: [] }),
        network: z.array(z.string().regex(HOST, 'doit être un nom d’hôte (exemple : api.exemple.fr)')).default([]),
        env: z.array(z.string().regex(SECRET_NAME, 'doit être en MAJUSCULES_ET_TIRETS_BAS')).default([])
      })
      .default({ fs: { read: [], write: [] }, network: [], env: [] }),
    secrets: z.array(z.string().regex(SECRET_NAME, 'doit être en MAJUSCULES_ET_TIRETS_BAS')).default([]),
    expose: z
      .strictObject({
        agents: z.array(z.string()).default([]),
        production: z
          .strictObject({
            slot: z.enum(PRODUCTION_SLOTS),
            ports: z
              .array(
                z.strictObject({ name: z.string().min(1, 'ne peut pas être vide'), type: z.enum(PORT_TYPES), direction: z.enum(['in', 'out']) })
              )
              .default([])
          })
          .optional()
      })
      .default({ agents: [] })
  })
  .superRefine((m, ctx) => {
    const bad = (path: (string | number)[], message: string): void => void ctx.addIssue({ code: 'custom', path, message })
    const e = m.entry
    const inputNames = new Set<string>()
    m.inputs.forEach((p, i) => {
      if (inputNames.has(p.name)) bad(['inputs', i, 'name'], `entrée en double : ${p.name}`)
      inputNames.add(p.name)
    })
    const secretNames = new Set(m.secrets)
    if (secretNames.size !== m.secrets.length) bad(['secrets'], 'noms de secrets en double')
    // Every {{placeholder}} must name a declared input, or {{secret:NAME}} a declared secret.
    const checkText = (text: string, path: (string | number)[]): void => {
      for (const match of text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
        const ref = match[1]!
        if (ref.startsWith('secret:')) {
          if (!secretNames.has(ref.slice(7))) bad(path, `le secret « ${ref.slice(7)} » n’est pas déclaré dans « secrets »`)
        } else if (!inputNames.has(ref)) bad(path, `l’entrée « ${ref} » n’est pas déclarée dans « inputs »`)
      }
    }
    const checkUrl = (value: string | undefined, path: (string | number)[]): void => {
      if (!value) return bad(path, 'champ obligatoire pour ce type d’outil')
      const probe = value.replace(/\{\{[^}]*\}\}/g, 'x')
      let u: URL
      try {
        u = new URL(probe)
      } catch {
        return bad(path, 'adresse invalide (exemple : http://127.0.0.1:8123/run)')
      }
      if (u.protocol === 'file:') return bad(path, 'une adresse file: est interdite')
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) bad(path, 'seules les adresses https:// ou http://localhost sont acceptées')
      checkText(value, path)
    }
    const checkCommand = (): void => {
      if (!e.command || !e.command.trim()) return bad(['entry', 'command'], 'champ obligatoire pour ce type d’outil')
      if (SHELL_CHARS.test(e.command)) bad(['entry', 'command'], 'le programme est lancé sans shell : pas de |, &, ;, <, >, $ ni retour à la ligne')
      if (/(^|[\\/])\.\.([\\/]|$)/.test(e.command)) bad(['entry', 'command'], 'le chemin doit rester à l’intérieur du dossier de l’outil (pas de « .. »)')
      e.args.forEach((a, i) => {
        if (/(^|[\\/])\.\.([\\/]|$)/.test(a) && !a.includes('{{')) bad(['entry', 'args', i], 'le chemin doit rester à l’intérieur du dossier de l’outil (pas de « .. »)')
        checkText(a, ['entry', 'args', i])
      })
    }
    if (m.kind === 'command' || m.kind === 'script') {
      checkCommand()
      if (e.url) bad(['entry', 'url'], 'une adresse n’a pas de sens pour un outil de ce type')
    } else if (m.kind === 'http') {
      checkUrl(e.url, ['entry', 'url'])
      if (e.command) bad(['entry', 'command'], 'un programme n’a pas de sens pour un outil http')
      if (e.body) checkText(e.body, ['entry', 'body'])
      for (const [k, v] of Object.entries(e.headers)) checkText(v, ['entry', 'headers', k])
    } else {
      if (!e.transport) bad(['entry', 'transport'], 'champ obligatoire pour un serveur MCP (stdio ou http)')
      else if (e.transport === 'stdio') checkCommand()
      else checkUrl(e.url, ['entry', 'url'])
    }
    m.expose.production?.ports.forEach((p, i, all) => {
      if (all.findIndex((q) => q.name === p.name && q.direction === p.direction) !== i) bad(['expose', 'production', 'ports', i, 'name'], `port en double : ${p.name}`)
    })
  })

export type ToolManifest = z.infer<typeof toolManifestSchema>

export interface ManifestIssue {
  path: string
  message: string
}

function pathText(path: readonly PropertyKey[]): string {
  return path.reduce<string>((s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${String(p)}` : String(p)), '')
}

const TYPE_WORDS: Record<string, string> = {
  string: 'un texte',
  number: 'un nombre',
  boolean: 'vrai ou faux',
  array: 'une liste',
  object: 'un objet',
  record: 'un objet'
}

function describeIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      if (/received undefined/.test(issue.message)) return 'champ obligatoire'
      return `doit être ${TYPE_WORDS[issue.expected] ?? issue.expected}`
    case 'invalid_value':
      return `valeur attendue parmi : ${issue.values.map(String).join(', ')}`
    case 'unrecognized_keys':
      return `champ inconnu : ${issue.keys.join(', ')}`
    default:
      return issue.message
  }
}

export type ManifestParse = { ok: true; manifest: ToolManifest } | { ok: false; errors: ManifestIssue[] }

/** Parses and validates the text of a manifest (JSON). Every error names its field and is in French. */
export function parseManifest(text: string): ManifestParse {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, errors: [{ path: '', message: 'Le manifeste est vide.' }] }
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch (err) {
    const yaml = !/^[{[]/.test(trimmed)
    return {
      ok: false,
      errors: [
        {
          path: '',
          message: yaml
            ? 'Le manifeste doit être du JSON (le YAML n’est pas accepté pour l’instant).'
            : `JSON invalide : ${err instanceof Error ? err.message : String(err)}`
        }
      ]
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [{ path: '', message: 'Le manifeste doit être un objet JSON.' }] }
  }
  const r = toolManifestSchema.safeParse(raw)
  if (r.success) return { ok: true, manifest: r.data }
  return { ok: false, errors: r.error.issues.map((i) => ({ path: pathText(i.path), message: describeIssue(i) })) }
}

export function prettyManifest(m: ToolManifest): string {
  return JSON.stringify(m, null, 2)
}

// ---------------------------------------------------------------------------------------------------------------
// Permissions

export const PERMISSION_KINDS = ['process', 'fs-read', 'fs-write', 'network', 'env', 'secret'] as const
export type PermissionKind = (typeof PERMISSION_KINDS)[number]

export interface PermissionRequest {
  /** `kind:value`, stable: it is what is stored as granted. */
  id: string
  kind: PermissionKind
  value: string
}

function hostOf(url: string): string | null {
  try {
    return new URL(url.replace(/\{\{[^}]*\}\}/g, 'x')).host
  } catch {
    return null
  }
}

/** What the tool asks for: the declared permissions plus what its entry implies (program, host, secrets). */
export function requestedPermissions(m: ToolManifest): PermissionRequest[] {
  const out: PermissionRequest[] = []
  const add = (kind: PermissionKind, value: string): void => {
    const id = `${kind}:${value}`
    if (value && !out.some((p) => p.id === id)) out.push({ id, kind, value })
  }
  if ((m.kind === 'command' || m.kind === 'script' || (m.kind === 'mcp' && m.entry.transport === 'stdio')) && m.entry.command) add('process', m.entry.command)
  if ((m.kind === 'http' || (m.kind === 'mcp' && m.entry.transport === 'http')) && m.entry.url) add('network', hostOf(m.entry.url) ?? '')
  for (const p of m.permissions.fs.read) add('fs-read', p)
  for (const p of m.permissions.fs.write) add('fs-write', p)
  for (const h of m.permissions.network) add('network', h)
  for (const e of m.permissions.env) add('env', e)
  for (const s of m.secrets) add('secret', s)
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Inputs and dry run

export type InputValues = Record<string, string | number | boolean | unknown>

/** Checks the values of the test form against the manifest's inputs and converts them to their declared types. */
export function coerceInputs(m: ToolManifest, raw: Record<string, unknown>): { values: Record<string, unknown>; errors: ManifestIssue[] } {
  const values: Record<string, unknown> = {}
  const errors: ManifestIssue[] = []
  for (const key of Object.keys(raw)) {
    if (!m.inputs.some((p) => p.name === key)) errors.push({ path: key, message: 'entrée inconnue pour cet outil' })
  }
  for (const p of m.inputs) {
    let v: unknown = raw[p.name]
    if (v === undefined || v === null || v === '') v = p.default
    if (v === undefined || v === null || v === '') {
      if (p.required) errors.push({ path: p.name, message: 'champ obligatoire' })
      continue
    }
    switch (p.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
        if (!Number.isFinite(n)) errors.push({ path: p.name, message: 'doit être un nombre' })
        else values[p.name] = n
        break
      }
      case 'boolean':
        if (typeof v === 'boolean') values[p.name] = v
        else if (/^(true|vrai|oui|1)$/i.test(String(v))) values[p.name] = true
        else if (/^(false|faux|non|0)$/i.test(String(v))) values[p.name] = false
        else errors.push({ path: p.name, message: 'doit être vrai ou faux' })
        break
      case 'json':
        if (typeof v === 'string') {
          try {
            values[p.name] = JSON.parse(v)
          } catch {
            errors.push({ path: p.name, message: 'JSON invalide' })
          }
        } else values[p.name] = v
        break
      default:
        values[p.name] = String(v)
    }
  }
  return { values, errors }
}

export type RenderedCall =
  | { kind: 'command'; program: string; args: string[]; line: string; stdin: string }
  | { kind: 'http'; method: string; url: string; headers: Record<string, string>; body: string | null }
  | { kind: 'mcp'; transport: 'stdio' | 'http'; target: string; tool: string; arguments: Record<string, unknown> }

const asText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))

/** Fills `{{input}}`; `{{secret:NAME}}` is shown as ••• and never resolved (a dry run never reads a secret value). */
export function fillTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_all, ref: string) => {
    if (ref.startsWith('secret:')) return '•••'
    const v = values[ref]
    return v === undefined ? '' : asText(v)
  })
}

export function quoteArg(s: string): string {
  return /^[A-Za-z0-9_@%+=:,./\\-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

/** Exactly what a real run would do, without doing it. */
export function renderCall(m: ToolManifest, values: Record<string, unknown>): RenderedCall {
  const e = m.entry
  const args = e.args
    .map((a) => ({ a, filled: fillTemplate(a, values) }))
    .filter(({ a, filled }) => !(filled === '' && /^\{\{[^}]*\}\}$/.test(a.trim())))
    .map(({ filled }) => filled)
  if (m.kind === 'http') {
    const headers = Object.fromEntries(Object.entries(e.headers).map(([k, v]) => [k, fillTemplate(v, values)]))
    return { kind: 'http', method: e.method, url: fillTemplate(e.url ?? '', values), headers, body: e.body ? fillTemplate(e.body, values) : null }
  }
  if (m.kind === 'mcp') {
    const stdio = e.transport === 'stdio'
    return {
      kind: 'mcp',
      transport: stdio ? 'stdio' : 'http',
      target: stdio ? [e.command ?? '', ...args].map(quoteArg).join(' ') : fillTemplate(e.url ?? '', values),
      tool: e.tool ?? m.id,
      arguments: values
    }
  }
  const program = e.command ?? ''
  return { kind: 'command', program, args, line: [program, ...args].map(quoteArg).join(' '), stdin: JSON.stringify(values) }
}

// ---------------------------------------------------------------------------------------------------------------
// Versions

export function compareSemver(a: string, b: string): number {
  const pa = a.split('-')[0]!.split('.').map(Number)
  const pb = b.split('-')[0]!.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

export interface DiffLine {
  type: 'same' | 'add' | 'del'
  text: string
}

/** Line diff (longest common subsequence) of two texts. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ type: 'del', text: a[i++]! })
    else out.push({ type: 'add', text: b[j++]! })
  }
  while (i < a.length) out.push({ type: 'del', text: a[i++]! })
  while (j < b.length) out.push({ type: 'add', text: b[j++]! })
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// IPC row types

export interface ToolRow {
  slug: string
  name: string
  kind: ToolKind
  version: string
  description: string
  status: ToolStatus
  error: string
  grantedAgents: string[]
  permissionsRequested: number
  permissionsGranted: number
  secretsMissing: string[]
  example: boolean
}

export interface ToolDetail extends ToolRow {
  manifest: ToolManifest
  manifestText: string
  permissions: (PermissionRequest & { granted: boolean })[]
  secrets: { name: string; set: boolean }[]
  versions: { version: string; createdAt: string; manifestText: string; active: boolean }[]
}

export interface ToolRunRow {
  id: number
  tool: string
  input: Record<string, unknown>
  outputText: string
  status: 'ok' | 'error' | 'dry_run'
  ms: number
  createdAt: string
  example: boolean
}

export interface ToolValidation {
  ok: boolean
  errors: ManifestIssue[]
  summary: { id: string; name: string; version: string; kind: ToolKind; description: string } | null
  permissions: PermissionRequest[]
  /** A tool with this id already exists (use Versions to update it). */
  exists: boolean
}

export interface DryRunCheck {
  id: 'inputs' | 'permissions' | 'secrets' | 'enabled'
  ok: boolean
  /** Field errors, permission ids not granted, secret names not set. */
  items: string[]
}

export interface DryRunResult {
  ok: boolean
  checks: DryRunCheck[]
  rendered: RenderedCall | null
  run: ToolRunRow
}
