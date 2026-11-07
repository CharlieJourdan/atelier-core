// Lot Z1, Mes outils: the manifest schema with French errors per path, permissions, inputs, dry-run rendering, diff.
import { describe, expect, it } from 'vitest'
import {
  coerceInputs,
  compareSemver,
  diffLines,
  parseManifest,
  quoteArg,
  renderCall,
  requestedPermissions,
  type ToolManifest
} from '../../src/shared/tools'

const COMMAND = {
  id: 'voix-maison',
  name: 'Voix maison',
  version: '1.2.0',
  kind: 'command',
  description: 'Lit un script.',
  entry: { command: 'python3', args: ['cli.py', '--vitesse', '{{vitesse}}', '{{option}}'] },
  inputs: [
    { name: 'script', type: 'string', required: true },
    { name: 'vitesse', type: 'number', default: 1 },
    { name: 'option', type: 'string' },
    { name: 'actif', type: 'boolean' },
    { name: 'meta', type: 'json' }
  ],
  permissions: { fs: { read: ['$TOOL_DIR'], write: ['$OUTPUT_DIR'] } },
  secrets: ['MA_CLE']
}

const ok = (raw: unknown): ToolManifest => {
  const r = parseManifest(JSON.stringify(raw))
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r.manifest
}
const errors = (raw: unknown) => {
  const r = parseManifest(typeof raw === 'string' ? raw : JSON.stringify(raw))
  if (r.ok) throw new Error('expected errors')
  return r.errors
}

describe('manifest validation', () => {
  it('accepts a complete manifest and fills the defaults', () => {
    const m = ok(COMMAND)
    expect(m.inputs[0]).toMatchObject({ name: 'script', required: true })
    expect(m.permissions.network).toEqual([])
    expect(m.expose.agents).toEqual([])
  })

  it('names the field of every error, in French', () => {
    const e = errors({ ...COMMAND, id: 'Voix Maison', version: '1.2', kind: 'wasm', name: '', unknownField: 1 })
    const byPath = Object.fromEntries(e.map((i) => [i.path || '(racine)', i.message]))
    expect(byPath.id).toContain('kebab-case')
    expect(byPath.version).toContain('semver')
    expect(byPath.kind).toBe('valeur attendue parmi : command, script, http, mcp')
    expect(byPath.name).toContain('vide')
    expect(byPath['(racine)']).toContain('champ inconnu : unknownField')
  })

  it('reports a missing required field and wrong types with the path', () => {
    const { id: _id, ...noId } = COMMAND
    expect(errors(noId)).toEqual([{ path: 'id', message: 'champ obligatoire' }])
    const e = errors({ ...COMMAND, inputs: [{ name: 'a', type: 'string', required: 'oui' }] })
    expect(e).toEqual([{ path: 'inputs[0].required', message: 'doit être vrai ou faux' }])
  })

  it('refuses a placeholder that is not declared, and an undeclared secret', () => {
    const e = errors({ ...COMMAND, entry: { command: 'python3', args: ['{{inconnue}}', '{{secret:AUTRE}}'] } })
    expect(e.map((i) => i.path)).toEqual(['entry.args[0]', 'entry.args[1]'])
    expect(e[0]!.message).toContain('« inconnue »')
    expect(e[1]!.message).toContain('« AUTRE »')
  })

  it('refuses shell syntax and paths that leave the tool folder for a command', () => {
    expect(errors({ ...COMMAND, entry: { command: 'python3 | tee x' } })[0]).toMatchObject({ path: 'entry.command' })
    expect(errors({ ...COMMAND, entry: { command: '../evil.sh' } })[0]!.message).toContain('dossier de l’outil')
    expect(errors({ ...COMMAND, entry: { command: 'ok', args: ['../../etc/passwd'] } })[0]).toMatchObject({ path: 'entry.args[0]' })
    expect(errors({ ...COMMAND, entry: {} })[0]).toEqual({ path: 'entry.command', message: 'champ obligatoire pour ce type d’outil' })
  })

  it('accepts http only on https or localhost, never file:', () => {
    const http = (url: string) => ({ ...COMMAND, kind: 'http', entry: { url, method: 'POST' }, secrets: [] })
    expect(ok(http('https://api.exemple.fr/run')).entry.method).toBe('POST')
    expect(ok(http('http://127.0.0.1:8123/run')).entry.url).toBe('http://127.0.0.1:8123/run')
    expect(ok(http('http://localhost:9000/x')).kind).toBe('http')
    expect(errors(http('http://exemple.fr/run'))[0]!.message).toContain('https://')
    expect(errors(http('file:///etc/passwd'))[0]!.message).toContain('file:')
    expect(errors(http('pas une adresse'))[0]!.message).toContain('invalide')
    expect(errors({ ...http('https://a.fr'), entry: {} })[0]).toMatchObject({ path: 'entry.url' })
  })

  it('validates an MCP server by transport', () => {
    const mcp = (entry: unknown) => ({ ...COMMAND, kind: 'mcp', entry, secrets: [] })
    expect(ok(mcp({ transport: 'stdio', command: 'uv', args: ['run', 'mon_mcp'] })).kind).toBe('mcp')
    expect(ok(mcp({ transport: 'http', url: 'http://127.0.0.1:9000/mcp' })).kind).toBe('mcp')
    expect(errors(mcp({ command: 'uv' }))[0]).toMatchObject({ path: 'entry.transport' })
    expect(errors(mcp({ transport: 'http' }))[0]).toMatchObject({ path: 'entry.url' })
  })

  it('refuses invalid JSON, YAML and non-objects with a clear message', () => {
    expect(errors('')[0]!.message).toContain('vide')
    expect(errors('id: voix\nname: x')[0]!.message).toContain('JSON')
    expect(errors('{"id": ')[0]!.message).toContain('JSON invalide')
    expect(errors('[1,2]')[0]!.message).toContain('objet')
  })

  it('refuses duplicate inputs and duplicate secrets', () => {
    const e = errors({ ...COMMAND, inputs: [{ name: 'a', type: 'string' }, { name: 'a', type: 'string' }], secrets: ['X', 'X'], entry: { command: 'p' } })
    expect(e.map((i) => i.path).sort()).toEqual(['inputs[1].name', 'secrets'])
  })

  it('checks the production ports', () => {
    const m = ok({ ...COMMAND, expose: { agents: ['voiceover'], production: { slot: 'narration', ports: [{ name: 'audio', type: 'audio', direction: 'out' }] } } })
    expect(m.expose.production?.slot).toBe('narration')
    expect(errors({ ...COMMAND, expose: { production: { slot: 'cuisine', ports: [] } } })[0]!.path).toBe('expose.production.slot')
  })
})

describe('requested permissions', () => {
  it('lists the program, declared paths, hosts, env and secrets once each', () => {
    const ids = requestedPermissions(ok(COMMAND)).map((p) => p.id)
    expect(ids).toEqual(['process:python3', 'fs-read:$TOOL_DIR', 'fs-write:$OUTPUT_DIR', 'secret:MA_CLE'])
  })

  it('derives the network host from an http entry', () => {
    const m = ok({ ...COMMAND, kind: 'http', entry: { url: 'https://api.exemple.fr/v1/{{script}}' }, secrets: [], permissions: { network: ['api.exemple.fr', 'cdn.exemple.fr'] } })
    expect(requestedPermissions(m).map((p) => p.id)).toEqual(['network:api.exemple.fr', 'network:cdn.exemple.fr'])
  })
})

describe('inputs and rendering', () => {
  const m = ok(COMMAND)

  it('coerces and checks the inputs', () => {
    const r = coerceInputs(m, { script: 'Bonjour', vitesse: '1,5', actif: 'oui', meta: '{"a":1}' })
    expect(r.errors).toEqual([])
    expect(r.values).toEqual({ script: 'Bonjour', vitesse: 1.5, actif: true, meta: { a: 1 } })
  })

  it('applies defaults and reports required, type and unknown inputs', () => {
    expect(coerceInputs(m, { script: 'x' }).values).toEqual({ script: 'x', vitesse: 1 })
    const r = coerceInputs(m, { vitesse: 'vite', actif: 'peut-être', meta: '{', autre: 1 })
    expect(r.errors).toEqual([
      { path: 'autre', message: 'entrée inconnue pour cet outil' },
      { path: 'script', message: 'champ obligatoire' },
      { path: 'vitesse', message: 'doit être un nombre' },
      { path: 'actif', message: 'doit être vrai ou faux' },
      { path: 'meta', message: 'JSON invalide' }
    ])
  })

  it('renders the exact command line, dropping an empty optional placeholder, with the JSON on stdin', () => {
    const c = renderCall(m, { script: 'Bonjour le monde', vitesse: 1.2 })
    expect(c).toEqual({
      kind: 'command',
      program: 'python3',
      args: ['cli.py', '--vitesse', '1.2'],
      line: 'python3 cli.py --vitesse 1.2',
      stdin: '{"script":"Bonjour le monde","vitesse":1.2}'
    })
    const withOption = renderCall(m, { option: "l'été" })
    // `{{vitesse}}` is empty here so it is dropped; `{{option}}` is given and quoted for display
    expect(withOption.kind === 'command' && withOption.args).toEqual(['cli.py', '--vitesse', "l'été"])
    expect(withOption.kind === 'command' && withOption.line).toBe("python3 cli.py --vitesse 'l'\\''été'")
  })

  it('renders an http request with the secret masked, never resolved', () => {
    const h = ok({
      ...COMMAND,
      kind: 'http',
      entry: { url: 'https://api.exemple.fr/search?q={{script}}', method: 'POST', headers: { Authorization: 'Bearer {{secret:MA_CLE}}' }, body: '{"q":"{{script}}"}' }
    })
    expect(renderCall(h, { script: 'bermudes' })).toEqual({
      kind: 'http',
      method: 'POST',
      url: 'https://api.exemple.fr/search?q=bermudes',
      headers: { Authorization: 'Bearer •••' },
      body: '{"q":"bermudes"}'
    })
  })

  it('renders an MCP call', () => {
    const c = renderCall(ok({ ...COMMAND, kind: 'mcp', secrets: [], entry: { transport: 'stdio', command: 'uv', args: ['run', 'mon mcp'], tool: 'chercher' } }), { script: 'x' })
    expect(c).toMatchObject({ kind: 'mcp', transport: 'stdio', target: "uv run 'mon mcp'", tool: 'chercher', arguments: { script: 'x' } })
  })

  it('quotes awkward arguments for display', () => {
    expect(quoteArg('simple-1.mp3')).toBe('simple-1.mp3')
    expect(quoteArg('a b')).toBe("'a b'")
    expect(quoteArg("it's")).toBe("'it'\\''s'")
  })
})

describe('versions', () => {
  it('compares semver numerically', () => {
    expect(compareSemver('1.10.0', '1.2.0')).toBeGreaterThan(0)
    expect(compareSemver('1.2.0', '1.2.0-beta')).toBe(0)
    expect(compareSemver('0.9.9', '1.0.0')).toBeLessThan(0)
  })

  it('diffs two manifests line by line', () => {
    const d = diffLines('a\nb\nc', 'a\nc\nd')
    expect(d).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'same', text: 'c' },
      { type: 'add', text: 'd' }
    ])
    expect(diffLines('x', 'x').every((l) => l.type === 'same')).toBe(true)
  })
})
