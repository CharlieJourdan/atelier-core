// Demo fixtures, lab: Outils / Mes outils — three invented tools (a local script, an http service on this computer, an MCP
// server), their permissions, secrets (never a value: only « set » or not), versions, and the test console's dry runs.
// The manifest checks are the app's own pure helpers (src/shared/tools.ts).
import {
  coerceInputs,
  compareSemver,
  parseManifest,
  prettyManifest,
  renderCall,
  requestedPermissions,
  type DryRunCheck,
  type ToolDetail,
  type ToolManifest,
  type ToolRow,
  type ToolRunRow
} from '../../../shared/tools'
import { changed, wait, type DemoHandlers } from './bridge'
import { ago, nextId } from './world'

interface Tool {
  manifest: ToolManifest
  enabled: boolean
  granted: Set<string>
  secretsSet: Set<string>
  agents: string[]
  versions: { version: string; createdAt: string; manifestText: string }[]
}

const SEED: { text: object; granted: 'all' | string[]; secrets: string[]; agents: string[]; enabled: boolean; older?: string }[] = [
  {
    text: {
      id: 'voix-maison',
      name: 'Voix maison',
      version: '1.2.0',
      kind: 'script',
      description: 'Lit un script avec la voix enregistrée de l’équipe (script local, sans réseau).',
      entry: { command: 'python', args: ['voix.py', '--texte', '{{texte}}', '--vitesse', '{{vitesse}}'] },
      inputs: [
        { name: 'texte', type: 'string', required: true, description: 'Le texte à dire' },
        { name: 'vitesse', type: 'number', required: false, description: 'De 0,8 à 1,2', default: 1 }
      ],
      outputs: [{ name: 'audio', type: 'file', description: 'Le fichier WAV' }],
      permissions: { fs: { read: ['./voix'], write: ['./sorties'] }, network: [], env: [] },
      secrets: [],
      expose: { agents: [], production: { slot: 'narration', ports: [{ name: 'audio', type: 'audio', direction: 'out' }] } }
    },
    granted: 'all',
    secrets: [],
    agents: ['script', 'production'],
    enabled: true,
    older: '1.1.0'
  },
  {
    text: {
      id: 'miniatures-studio',
      name: 'Miniatures studio',
      version: '0.4.1',
      kind: 'http',
      description: 'Le petit service de miniatures qui tourne sur l’ordinateur de l’équipe.',
      entry: { url: 'http://127.0.0.1:8123/miniature', method: 'POST', headers: { Authorization: 'Bearer {{secret:STUDIO_JETON}}' }, body: '{"titre":"{{titre}}","style":"{{style}}"}' },
      inputs: [
        { name: 'titre', type: 'string', required: true, description: 'Le titre de la vidéo' },
        { name: 'style', type: 'string', required: false, description: 'contraste, sobre…', default: 'contraste' }
      ],
      outputs: [{ name: 'image', type: 'file', description: 'La miniature PNG' }],
      secrets: ['STUDIO_JETON'],
      expose: { agents: [], production: { slot: 'thumbnail', ports: [{ name: 'image', type: 'image', direction: 'out' }] } }
    },
    granted: ['network:127.0.0.1:8123'],
    secrets: [],
    agents: ['packaging'],
    enabled: true
  },
  {
    text: {
      id: 'notes-equipe',
      name: 'Notes de l’équipe',
      version: '2.0.0',
      kind: 'mcp',
      description: 'Le carnet partagé de l’équipe, en serveur MCP local : les agents y lisent les consignes.',
      entry: { transport: 'stdio', command: 'node', args: ['serveur-notes.mjs'], tool: 'chercher' },
      inputs: [{ name: 'requete', type: 'string', required: true, description: 'Ce qu’on cherche' }],
      permissions: { fs: { read: ['./notes'], write: [] }, network: [], env: [] }
    },
    granted: 'all',
    secrets: [],
    agents: [],
    enabled: false
  }
]

const tools: Tool[] = SEED.map((s, i) => {
  const text = JSON.stringify(s.text, null, 2)
  const parsed = parseManifest(text)
  if (!parsed.ok) throw new Error(`Démo : manifeste invalide (${parsed.errors[0]?.message ?? ''})`)
  const m = parsed.manifest
  const versions = [{ version: m.version, createdAt: ago(60 * 24 * (3 + i)), manifestText: prettyManifest(m) }]
  if (s.older) versions.unshift({ version: s.older, createdAt: ago(60 * 24 * (20 + i)), manifestText: prettyManifest({ ...m, version: s.older }) })
  const granted = new Set(s.granted === 'all' ? requestedPermissions(m).map((p) => p.id) : s.granted)
  return { manifest: m, enabled: s.enabled, granted, secretsSet: new Set(s.secrets), agents: s.agents, versions }
})

const runs: ToolRunRow[] = [
  { id: nextId(), tool: 'voix-maison', input: { texte: 'Bonjour et bienvenue dans ce nouvel épisode.', vitesse: 1 }, outputText: 'Appel préparé (essai à blanc) : rien n’a été lancé.', status: 'dry_run', ms: 12, createdAt: ago(60 * 3), example: false },
  { id: nextId(), tool: 'voix-maison', input: { texte: 'Ce soir, une énigme de plus.', vitesse: 0.95 }, outputText: 'sorties/voix-0042.wav (38 s)', status: 'ok', ms: 8420, createdAt: ago(60 * 26), example: false },
  { id: nextId(), tool: 'miniatures-studio', input: { titre: 'Le phare du 13', style: 'contraste' }, outputText: 'Le service ne répond pas sur 127.0.0.1:8123.', status: 'error', ms: 3010, createdAt: ago(60 * 50), example: false }
]

function find(slug: string): Tool {
  const t = tools.find((x) => x.manifest.id === slug)
  if (!t) throw new Error('Outil introuvable.')
  return t
}

function row(t: Tool): ToolRow {
  const asked = requestedPermissions(t.manifest)
  const missing = t.manifest.secrets.filter((s) => !t.secretsSet.has(s))
  const status: ToolRow['status'] = !t.enabled ? 'disabled' : missing.length > 0 || asked.some((p) => !t.granted.has(p.id)) ? 'error' : 'ok'
  return {
    slug: t.manifest.id,
    name: t.manifest.name,
    kind: t.manifest.kind,
    version: t.manifest.version,
    description: t.manifest.description,
    status,
    error: status === 'error' ? (missing.length > 0 ? `Secret à renseigner : ${missing.join(', ')}` : 'Une permission n’est pas accordée.') : '',
    grantedAgents: [...t.agents],
    permissionsRequested: asked.length,
    permissionsGranted: asked.filter((p) => t.granted.has(p.id)).length,
    secretsMissing: missing,
    example: false
  }
}

function detail(t: Tool): ToolDetail {
  return {
    ...row(t),
    manifest: structuredClone(t.manifest),
    manifestText: prettyManifest(t.manifest),
    permissions: requestedPermissions(t.manifest).map((p) => ({ ...p, granted: t.granted.has(p.id) })),
    secrets: t.manifest.secrets.map((name) => ({ name, set: t.secretsSet.has(name) })),
    versions: [...t.versions].reverse().map((v) => ({ ...v, active: v.version === t.manifest.version }))
  }
}

function parseOrThrow(text: string): ToolManifest {
  const p = parseManifest(text)
  if (!p.ok) throw new Error(`Manifeste invalide : ${p.errors.slice(0, 3).map((e) => `${e.path || 'manifeste'} ${e.message}`).join(' ; ')}`)
  return p.manifest
}

function touch<T>(value: T): T {
  changed('tools')
  return value
}

export const toolsHandlers: DemoHandlers = {
  'tools.list': () => tools.map(row),
  'tools.get': (slug) => detail(find(slug)),
  'tools.validate': (text) => {
    const p = parseManifest(text)
    if (!p.ok) return { ok: false, errors: p.errors, summary: null, permissions: [], exists: false }
    const m = p.manifest
    return { ok: true, errors: [], summary: { id: m.id, name: m.name, version: m.version, kind: m.kind, description: m.description }, permissions: requestedPermissions(m), exists: tools.some((t) => t.manifest.id === m.id) }
  },
  'tools.add': (text) => {
    const m = parseOrThrow(text)
    if (tools.some((t) => t.manifest.id === m.id)) throw new Error('Un outil porte déjà cet identifiant : importe plutôt une nouvelle version.')
    const t: Tool = { manifest: m, enabled: true, granted: new Set(), secretsSet: new Set(), agents: [], versions: [{ version: m.version, createdAt: new Date().toISOString(), manifestText: prettyManifest(m) }] }
    tools.unshift(t)
    return touch(detail(t))
  },
  'tools.delete': (slug) => {
    const at = tools.findIndex((t) => t.manifest.id === slug)
    if (at >= 0) tools.splice(at, 1)
    changed('tools')
  },
  'tools.setEnabled': (slug, enabled) => {
    const t = find(slug)
    t.enabled = enabled
    return touch(detail(t))
  },
  'tools.setPermission': (slug, id, granted) => {
    const t = find(slug)
    if (granted) t.granted.add(id)
    else t.granted.delete(id)
    return touch(detail(t))
  },
  'tools.setAgents': (slug, agentIds) => {
    const t = find(slug)
    t.agents = [...agentIds]
    return touch(detail(t))
  },
  // the value is never kept, not even in memory: the demo only remembers that it was given
  'tools.setSecret': (slug, name, value) => {
    const t = find(slug)
    if (!value.trim()) throw new Error('Le secret est vide.')
    t.secretsSet.add(name)
    return touch(detail(t))
  },
  'tools.clearSecret': (slug, name) => {
    const t = find(slug)
    t.secretsSet.delete(name)
    return touch(detail(t))
  },
  'tools.importVersion': (slug, text) => {
    const t = find(slug)
    const m = parseOrThrow(text)
    if (m.id !== slug) throw new Error(`Ce manifeste est celui de « ${m.id} », pas de « ${slug} ».`)
    if (t.versions.some((v) => v.version === m.version)) throw new Error(`La version ${m.version} existe déjà.`)
    if (compareSemver(m.version, t.manifest.version) <= 0) throw new Error(`La version doit être plus récente que ${t.manifest.version}.`)
    const before = new Set(requestedPermissions(t.manifest).map((p) => p.id))
    t.versions.push({ version: m.version, createdAt: new Date().toISOString(), manifestText: prettyManifest(m) })
    t.manifest = m
    return touch({ tool: detail(t), newPermissions: requestedPermissions(m).map((p) => p.id).filter((id) => !before.has(id)) })
  },
  'tools.activateVersion': (slug, version) => {
    const t = find(slug)
    const v = t.versions.find((x) => x.version === version)
    if (!v) throw new Error('Version introuvable.')
    t.manifest = parseOrThrow(v.manifestText)
    return touch({ tool: detail(t), newPermissions: requestedPermissions(t.manifest).map((p) => p.id).filter((id) => !t.granted.has(id)) })
  },
  'tools.dryRun': async (slug, input) => {
    const t = find(slug)
    await wait(400)
    const { values, errors } = coerceInputs(t.manifest, input)
    const asked = requestedPermissions(t.manifest)
    const checks: DryRunCheck[] = [
      { id: 'inputs', ok: errors.length === 0, items: errors.map((e) => `${e.path} : ${e.message}`) },
      { id: 'permissions', ok: asked.every((p) => t.granted.has(p.id)), items: asked.filter((p) => !t.granted.has(p.id)).map((p) => p.id) },
      { id: 'secrets', ok: t.manifest.secrets.every((s) => t.secretsSet.has(s)), items: t.manifest.secrets.filter((s) => !t.secretsSet.has(s)) },
      { id: 'enabled', ok: t.enabled, items: [] }
    ]
    const ok = checks.every((c) => c.ok)
    const run: ToolRunRow = {
      id: nextId(),
      tool: slug,
      input,
      outputText: ok ? 'Appel préparé (essai à blanc) : rien n’a été lancé.' : 'Essai à blanc refusé : voir les vérifications.',
      status: 'dry_run',
      ms: 9,
      createdAt: new Date().toISOString(),
      example: false
    }
    runs.unshift(run)
    changed('tools')
    return { ok, checks, rendered: errors.length === 0 ? renderCall(t.manifest, values) : null, run }
  },
  'tools.runs': (slug) => runs.filter((r) => slug === undefined || r.tool === slug)
}
