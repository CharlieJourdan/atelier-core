// Lot Z1, Mes outils: the tools IPC methods (add, permissions, secrets, versions, access, dry run) and the example rows.
import { describe, expect, it } from 'vitest'
import { TOOLS_METHODS } from '../../src/shared/api'
import { memoryCore } from './helpers'

const manifest = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    id: 'recherche',
    name: 'Recherche',
    version: '1.0.0',
    kind: 'http',
    description: 'Cherche.',
    entry: { url: 'https://api.exemple.fr/s?q={{q}}', method: 'GET', headers: { Authorization: 'Bearer {{secret:CLE}}' } },
    inputs: [{ name: 'q', type: 'string', required: true }],
    permissions: { network: ['api.exemple.fr'] },
    secrets: ['CLE'],
    ...over
  })

describe('tools module', () => {
  it('lists its IPC methods (one comment per method)', () => {
    expect([...TOOLS_METHODS]).toEqual([
      'tools.list', // tools with status, kind, version, granted agents
      'tools.get', // one tool: manifest, permissions, secrets state, versions
      'tools.validate', // French errors per path and the permissions a manifest asks for
      'tools.add', // adds a tool, every requested permission accepted
      'tools.delete', // deletes a tool and its secrets
      'tools.setEnabled', // enables or disables a tool
      'tools.setPermission', // grants or revokes one permission
      'tools.setAgents', // which agents may use the tool
      'tools.setSecret', // stores a secret value (write-only)
      'tools.clearSecret', // clears a secret value
      'tools.importVersion', // imports a new manifest version
      'tools.activateVersion', // goes back to (or forward to) a stored version
      'tools.dryRun', // test console: validates, renders, records a dry run
      'tools.runs' // run history
    ])
  })

  it('validates a manifest without saving anything, then adds it with every permission granted', async () => {
    const core = memoryCore()
    try {
      const bad = await core.api['tools.validate']('{"id":"X"}')
      expect(bad.ok).toBe(false)
      expect(bad.errors.map((e) => e.path)).toContain('id')
      const v = await core.api['tools.validate'](manifest())
      expect(v).toMatchObject({ ok: true, exists: false, summary: { id: 'recherche', kind: 'http' } })
      expect(v.permissions.map((p) => p.id)).toEqual(['network:api.exemple.fr', 'secret:CLE'])
      expect(await core.api['tools.list']()).toEqual([])

      const tool = await core.api['tools.add'](manifest())
      expect(tool).toMatchObject({ slug: 'recherche', status: 'error', error: 'Secret manquant : CLE.', permissionsRequested: 2, permissionsGranted: 2, example: false })
      expect(tool.permissions.every((p) => p.granted)).toBe(true)
      expect(tool.versions).toEqual([expect.objectContaining({ version: '1.0.0', active: true })])
      expect((await core.api['tools.validate'](manifest())).exists).toBe(true)
      expect(() => core.api['tools.add'](manifest())).toThrow('existe déjà')
      expect(() => core.api['tools.add']('{"id":"X"}')).toThrow('Manifeste invalide')
    } finally {
      core.close()
    }
  })

  it('stores a secret write-only: the status follows and the value never comes back', async () => {
    const core = memoryCore()
    try {
      await core.api['tools.add'](manifest())
      const set = await core.api['tools.setSecret']('recherche', 'CLE', 'sk-très-secret')
      expect(set).toMatchObject({ status: 'ok', error: '', secrets: [{ name: 'CLE', set: true }] })
      expect(JSON.stringify(set)).not.toContain('sk-très-secret')
      expect(JSON.stringify(await core.api['tools.list']())).not.toContain('sk-très-secret')
      expect(core.context.secrets.get('tools.recherche.CLE')).toBe('sk-très-secret')
      const raw = core.db.prepare('SELECT ciphertext FROM secrets WHERE name = ?').get('tools.recherche.CLE') as { ciphertext: Uint8Array }
      expect(Buffer.from(raw.ciphertext).toString('utf8')).not.toContain('sk-très-secret')
      expect((await core.api['tools.clearSecret']('recherche', 'CLE')).status).toBe('error')
      expect(core.context.secrets.has('tools.recherche.CLE')).toBe(false)
      expect(() => core.api['tools.setSecret']('recherche', 'AUTRE', 'x')).toThrow('pas déclaré')
      expect(() => core.api['tools.setSecret']('recherche', 'CLE', '  ')).toThrow('vide')
    } finally {
      core.close()
    }
  })

  it('grants and revokes permissions, enables and disables, and refuses unknown ones', async () => {
    const core = memoryCore()
    try {
      await core.api['tools.add'](manifest())
      const t = await core.api['tools.setPermission']('recherche', 'network:api.exemple.fr', false)
      expect(t.permissionsGranted).toBe(1)
      expect(t.permissions.find((p) => p.id === 'network:api.exemple.fr')!.granted).toBe(false)
      expect((await core.api['tools.setPermission']('recherche', 'network:api.exemple.fr', true)).permissionsGranted).toBe(2)
      expect(() => core.api['tools.setPermission']('recherche', 'network:evil.example', true)).toThrow('pas demandée')
      expect((await core.api['tools.setEnabled']('recherche', false)).status).toBe('disabled')
      await core.api['tools.setSecret']('recherche', 'CLE', 'x') // a disabled tool stays disabled
      expect((await core.api['tools.get']('recherche')).status).toBe('disabled')
      expect((await core.api['tools.setEnabled']('recherche', true)).status).toBe('ok')
      expect(() => core.api['tools.get']('inconnu')).toThrow('introuvable')
      expect(() => core.api['tools.get']('../etc')).toThrow('invalide')
    } finally {
      core.close()
    }
  })

  it('grants a tool to known agents only', async () => {
    const core = memoryCore()
    try {
      await core.api['tools.add'](manifest())
      const agents = await core.api['agents.list']()
      const first = agents[0]!.id
      expect((await core.api['tools.setAgents']('recherche', [first, first])).grantedAgents).toEqual([first])
      expect(() => core.api['tools.setAgents']('recherche', ['fantome'])).toThrow('Agent inconnu')
      expect((await core.api['tools.list']())[0]!.grantedAgents).toEqual([first])
    } finally {
      core.close()
    }
  })

  it('imports a new version, keeps granted permissions, leaves new ones off, and goes back in one call', async () => {
    const core = memoryCore()
    try {
      await core.api['tools.add'](manifest())
      const v2 = manifest({ version: '1.1.0', permissions: { network: ['api.exemple.fr', 'cdn.exemple.fr'] } })
      const r = await core.api['tools.importVersion']('recherche', v2)
      expect(r.tool.version).toBe('1.1.0')
      expect(r.newPermissions).toEqual(['network:cdn.exemple.fr'])
      expect(r.tool.permissions.find((p) => p.id === 'network:cdn.exemple.fr')!.granted).toBe(false)
      expect(r.tool.permissions.find((p) => p.id === 'network:api.exemple.fr')!.granted).toBe(true)
      expect(r.tool.versions.map((v) => [v.version, v.active])).toEqual([
        ['1.1.0', true],
        ['1.0.0', false]
      ])
      expect(() => core.api['tools.importVersion']('recherche', v2)).toThrow('existe déjà')
      expect(() => core.api['tools.importVersion']('recherche', manifest({ id: 'autre', version: '2.0.0' }))).toThrow('doit rester')
      expect(() => core.api['tools.importVersion']('recherche', manifest({ version: '2.0.0', kind: 'command', entry: { command: 'x' }, inputs: [], secrets: [] }))).toThrow('type de l’outil')
      const back = await core.api['tools.activateVersion']('recherche', '1.0.0')
      expect(back.tool.version).toBe('1.0.0')
      expect(back.tool.permissions.map((p) => p.id)).toEqual(['network:api.exemple.fr', 'secret:CLE'])
      expect(() => core.api['tools.activateVersion']('recherche', '9.9.9')).toThrow('Version introuvable')
    } finally {
      core.close()
    }
  })

  it('runs a real dry run: inputs, the exact request, permission and secret checks, a recorded row', async () => {
    const core = memoryCore()
    try {
      await core.api['tools.add'](manifest())
      await core.api['tools.setPermission']('recherche', 'network:api.exemple.fr', false)
      const r = await core.api['tools.dryRun']('recherche', { q: 'bermudes' })
      expect(r.ok).toBe(false)
      expect(r.rendered).toEqual({
        kind: 'http',
        method: 'GET',
        url: 'https://api.exemple.fr/s?q=bermudes',
        headers: { Authorization: 'Bearer •••' },
        body: null
      })
      expect(r.checks).toEqual([
        { id: 'inputs', ok: true, items: [] },
        { id: 'permissions', ok: false, items: ['network:api.exemple.fr'] },
        { id: 'secrets', ok: false, items: ['CLE'] },
        { id: 'enabled', ok: true, items: [] }
      ])
      expect(r.run).toMatchObject({ tool: 'recherche', status: 'dry_run', input: { q: 'bermudes' } })
      expect(r.run.outputText).toContain('GET https://api.exemple.fr/s?q=bermudes')

      await core.api['tools.setPermission']('recherche', 'network:api.exemple.fr', true)
      await core.api['tools.setSecret']('recherche', 'CLE', 'sk-secret')
      const ok = await core.api['tools.dryRun']('recherche', { q: 'atlantide' })
      expect(ok.ok).toBe(true)
      expect(JSON.stringify(ok)).not.toContain('sk-secret') // a dry run never resolves a secret
      const runs = await core.api['tools.runs']('recherche')
      expect(runs.map((x) => x.status)).toEqual(['dry_run', 'dry_run'])
      expect(runs[0]!.input).toEqual({ q: 'atlantide' })
    } finally {
      core.close()
    }
  })

  it('refuses invalid inputs in the console, records the error and renders nothing', async () => {
    const core = memoryCore()
    try {
      await core.api['tools.add'](manifest())
      const r = await core.api['tools.dryRun']('recherche', { autre: 1 })
      expect(r.ok).toBe(false)
      expect(r.rendered).toBeNull()
      expect(r.checks[0]).toEqual({ id: 'inputs', ok: false, items: ['autre : entrée inconnue pour cet outil', 'q : champ obligatoire'] })
      expect(r.run.status).toBe('error')
      expect(() => core.api['tools.dryRun']('recherche', [] as never)).toThrow('objet attendu')
      expect(() => core.api['tools.dryRun']('absent', {})).toThrow('introuvable')
      expect((await core.api['tools.runs']()).length).toBe(1)
    } finally {
      core.close()
    }
  })

  it('deletes a tool with its secrets, versions and runs', async () => {
    const core = memoryCore()
    try {
      await core.api['tools.add'](manifest())
      await core.api['tools.setSecret']('recherche', 'CLE', 'x')
      await core.api['tools.dryRun']('recherche', { q: 'a' })
      await core.api['tools.delete']('recherche')
      expect(await core.api['tools.list']()).toEqual([])
      expect(core.context.secrets.has('tools.recherche.CLE')).toBe(false)
      expect(core.db.prepare('SELECT COUNT(*) AS n FROM tool_versions').get()).toEqual({ n: 0 })
      expect(core.db.prepare('SELECT COUNT(*) AS n FROM tool_runs').get()).toEqual({ n: 0 })
      expect(() => core.api['tools.delete']('recherche')).toThrow('introuvable')
    } finally {
      core.close()
    }
  })
})

describe('tools example rows', () => {
  it('seeds three tools (ready, missing secret, disabled) with runs, then clears only them', async () => {
    const core = memoryCore()
    try {
      await core.api['tools.add'](manifest({ id: 'mon-outil', name: 'Mon outil', secrets: [], entry: { url: 'https://api.exemple.fr/x', method: 'GET' }, inputs: [] }))
      await core.api['example.load']()
      const tools = await core.api['tools.list']()
      const example = tools.filter((t) => t.example)
      expect(example.map((t) => [t.slug, t.status]).sort()).toEqual([
        ['convertisseur-ffmpeg', 'disabled'],
        ['recherche-web', 'error'],
        ['voix-maison', 'ok']
      ])
      expect(example.find((t) => t.slug === 'recherche-web')!.secretsMissing).toEqual(['SEARCH_API_KEY'])
      expect(example.find((t) => t.slug === 'voix-maison')!.grantedAgents).toEqual(['voiceover', 'supervisor'])
      const runs = await core.api['tools.runs']()
      expect(runs).toHaveLength(3)
      expect(runs.every((r) => r.example && r.status === 'dry_run')).toBe(true)

      await core.api['example.delete']()
      expect((await core.api['tools.list']()).map((t) => t.slug)).toEqual(['mon-outil'])
      expect(await core.api['tools.runs']()).toEqual([])
    } finally {
      core.close()
    }
  })
})

describe('manifest size cap', () => {
  it('add and importVersion refuse a manifest over 500 KB with a French message', () => {
    const core = memoryCore()
    try {
      core.api['tools.add'](manifest())
      const big = ' '.repeat(500_001)
      expect(() => core.api['tools.add'](big)).toThrow('Manifeste trop gros')
      expect(() => core.api['tools.importVersion']('recherche', big)).toThrow('Manifeste trop gros')
    } finally {
      core.close()
    }
  })
})
