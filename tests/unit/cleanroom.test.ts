// The clean-room check (scripts/cleanroom-check.mjs, lot P1): the repository passes it, and it fails as soon as a
// forbidden name is added to a scanned folder or to a packaged app.asar. The forbidden names come from the script
// itself, so this file holds none of them.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

interface Finding {
  file: string
  line: number
  token: string
}
interface CleanroomModule {
  ENGINE_NAME: string
  LEGACY_TOKENS: string[]
  DENYLIST: string[]
  SOURCE_DIRS: string[]
  HISTORICAL_ALLOW: RegExp[]
  FIXTURE_ALLOW: RegExp[]
  OWN_REMOVED: Set<string>
  LEGACY_DIR: string
  scanText(text: string, allowLegacy?: boolean): { line: number; token: string }[]
  scanTree(root: string): { files: number; scanned: string[]; findings: Finding[] }
  scanAsar(asarPath: string): { files: number; findings: Finding[] }
}

const ROOT = path.join(__dirname, '..', '..')
const SCRIPT = path.join(ROOT, 'scripts', 'cleanroom-check.mjs')
let cr: CleanroomModule
let tmp: string

beforeAll(async () => {
  // A plain .mjs script (no type declarations): imported through a variable so tsc does not resolve it.
  const modPath = '../../scripts/cleanroom-check.mjs'
  cr = (await import(modPath)) as CleanroomModule
  tmp = mkdtempSync(path.join(os.tmpdir(), 'atelier-cleanroom-'))
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60_000 })

/** A minimal asar archive (pickled header + JSON tree + bodies), like electron-builder writes. */
function writeAsar(file: string, entries: Record<string, string>, unpacked: Record<string, string> = {}): void {
  const root: { files: Record<string, unknown> } = { files: {} }
  const bodies: Buffer[] = []
  let offset = 0
  const place = (rel: string, node: Record<string, unknown>) => {
    const parts = rel.split('/')
    let dir = root
    for (const p of parts.slice(0, -1)) {
      dir.files[p] ??= { files: {} }
      dir = dir.files[p] as typeof root
    }
    dir.files[parts[parts.length - 1]!] = node
  }
  for (const [rel, text] of Object.entries(entries)) {
    const body = Buffer.from(text, 'utf8')
    place(rel, { size: body.length, offset: String(offset) })
    bodies.push(body)
    offset += body.length
  }
  for (const [rel, text] of Object.entries(unpacked)) {
    place(rel, { size: Buffer.byteLength(text), unpacked: true })
    const full = path.join(`${file}.unpacked`, ...rel.split('/'))
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  const json = Buffer.from(JSON.stringify(root), 'utf8')
  const padded = Math.ceil(json.length / 4) * 4
  const headerPickle = Buffer.alloc(8 + padded)
  headerPickle.writeUInt32LE(4 + padded, 0)
  headerPickle.writeUInt32LE(json.length, 4)
  json.copy(headerPickle, 8)
  const sizePickle = Buffer.alloc(8)
  sizePickle.writeUInt32LE(4, 0)
  sizePickle.writeUInt32LE(headerPickle.length, 4)
  writeFileSync(file, Buffer.concat([sizePickle, headerPickle, ...bodies]))
}

describe('clean-room check', () => {
  it('passes on this repository (source folders, scripts/, docs/, tests/ and the root files)', { timeout: 60_000 }, () => {
    const r = run()
    expect(r.stdout).toMatch(/^cleanroom: OK \d+ files scanned/m)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(cr.SOURCE_DIRS).toEqual(['src', 'cloud', 'workers', 'resources', 'scripts', 'docs', 'tests'])
  })

  it('fails when a forbidden name is added to a scanned folder, and says where', { timeout: 60_000 }, () => {
    const repo = path.join(tmp, 'repo')
    mkdirSync(path.join(repo, 'src', 'main'), { recursive: true })
    writeFileSync(path.join(repo, 'src', 'main', 'ok.ts'), 'export const a = 1\n')
    expect(run('--root', repo).status).toBe(0)
    // the engine's name, in any case
    const name = cr.ENGINE_NAME
    writeFileSync(path.join(repo, 'src', 'main', 'bad.ts'), `export const a = 1\n// talks to ${name[0]!.toUpperCase()}${name.slice(1)}\n`)
    const r = run('--root', repo)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`src/main/bad.ts:2: ${name}`)
    expect(r.stdout).toMatch(/^cleanroom: FAIL 1 finding\(s\)/m)
    rmSync(path.join(repo, 'src', 'main', 'bad.ts'))
    // resources/, cloud/ and workers/ are scanned too
    for (const dir of ['resources', 'cloud', 'workers']) {
      mkdirSync(path.join(repo, dir), { recursive: true })
      writeFileSync(path.join(repo, dir, 'x.md'), `${name.toUpperCase()}_PORT\n`)
      expect(run('--root', repo).status, dir).toBe(1)
      rmSync(path.join(repo, dir, 'x.md'))
    }
    expect(run('--root', repo).status).toBe(0)
  })

  it('scans docs/, scripts/, tests/ and the root files, except an explicit list of historical docs', { timeout: 60_000 }, () => {
    const name = cr.ENGINE_NAME
    const repo = path.join(tmp, 'wide')
    mkdirSync(path.join(repo, 'docs'), { recursive: true })
    writeFileSync(path.join(repo, 'docs', 'NOTES.md'), 'clean notes\n')
    expect(run('--root', repo).status).toBe(0)
    // a forbidden name in a doc that is not allowlisted fails, with its path
    writeFileSync(path.join(repo, 'docs', 'NOTES.md'), `notes\nthe ${name} API\n`)
    const bad = run('--root', repo)
    expect(bad.status).toBe(1)
    expect(bad.stdout).toContain(`docs/NOTES.md:2: ${name}`)
    rmSync(path.join(repo, 'docs', 'NOTES.md'))
    // the same text in the historical docs passes, and so do Atelier's own removed tools
    const own = [...cr.OWN_REMOVED][0]
    mkdirSync(path.join(repo, 'docs', 'archive'), { recursive: true })
    for (const doc of ['STATUS-LOG.md', 'LOTS.md', 'REVIEW-v2-PA.md', 'PLAN-V2.md', 'PLAN-V2-PRODUCTION.md']) {
      writeFileSync(path.join(repo, 'docs', 'archive', doc), `${name} was removed (${own})\n`)
    }
    const ok = run('--root', repo)
    expect(ok.stdout + ok.stderr).toMatch(/^cleanroom: OK /m)
    expect(ok.status).toBe(0)
    // but not the third-party engine's internals, even in history
    const internal = cr.DENYLIST.find((t) => !cr.OWN_REMOVED.has(t)) as string
    writeFileSync(path.join(repo, 'docs', 'archive', 'STATUS-LOG.md'), `${name} was removed\nits ${internal} table\n`)
    const leak = run('--root', repo)
    expect(leak.status).toBe(1)
    expect(leak.stdout).toContain(`docs/archive/STATUS-LOG.md:2: ${internal}`)
    writeFileSync(path.join(repo, 'docs', 'archive', 'STATUS-LOG.md'), `${name} was removed\n`)
    // scripts/, tests/ and the root text files are scanned; node_modules, out, dist and binary files are not
    const spots: Record<string, string> = { 'scripts/x.mjs': name, 'tests/unit/x.test.ts': name, 'package.json': `{"a":"${name}"}`, 'CLAUDE.md': name }
    for (const [rel, text] of Object.entries(spots)) {
      const full = path.join(repo, ...rel.split('/'))
      mkdirSync(path.dirname(full), { recursive: true })
      writeFileSync(full, text)
      const r = run('--root', repo)
      expect(r.status, rel).toBe(1)
      expect(r.stdout, rel).toContain(`${rel}:1: ${name}`)
      rmSync(full)
    }
    for (const rel of ['node_modules/p/README.md', 'out/a.js', 'dist/a.js', 'docs/pic.png', 'src/x/node_modules/p/a.js']) {
      const full = path.join(repo, ...rel.split('/'))
      mkdirSync(path.dirname(full), { recursive: true })
      writeFileSync(full, name)
      expect(run('--root', repo).status, rel).toBe(0)
    }
    // a folder named out/ or dist/ inside a scanned folder is scanned (only the root build output is not walked)
    const nested = path.join(repo, 'src', 'engine', 'out', 'a.ts')
    mkdirSync(path.dirname(nested), { recursive: true })
    writeFileSync(nested, name)
    expect(run('--root', repo).status).toBe(1)
    rmSync(nested)
    // the allowlist is explicit: historical docs by name, nothing else under docs/
    expect(cr.HISTORICAL_ALLOW.some((re) => re.test('docs/NOTES.md'))).toBe(false)
    expect(cr.HISTORICAL_ALLOW.some((re) => re.test('docs/SPEC.md'))).toBe(false)
    // the short current-state file and the other archived docs are not history for this rule
    expect(cr.HISTORICAL_ALLOW.some((re) => re.test('docs/STATUS.md'))).toBe(false)
    expect(cr.HISTORICAL_ALLOW.some((re) => re.test('docs/archive/RECAP.md'))).toBe(false)
    expect([...cr.HISTORICAL_ALLOW, ...cr.FIXTURE_ALLOW].some((re) => re.test('src/main/index.ts'))).toBe(false)
  })

  it('flags every denylisted identifier exactly; only the two legacy SQL table names are allowed, only in migrations', () => {
    expect(cr.DENYLIST.length).toBeGreaterThanOrEqual(20)
    for (const token of cr.DENYLIST) expect(cr.scanText(`const x = '${token}'`), token).toEqual([{ line: 1, token }])
    // legacy table names of migrations 006/008 are allowed where allowed, the name next to them is not
    for (const legacy of cr.LEGACY_TOKENS) {
      expect(cr.scanText(`ALTER TABLE ${legacy} ADD x; CREATE INDEX idx_${legacy}_active`, true), legacy).toEqual([])
      expect(cr.scanText(`SELECT * FROM ${legacy} -- ${cr.ENGINE_NAME}`, true).map((f) => f.token)).toEqual([cr.ENGINE_NAME])
      expect(cr.scanText(`SELECT * FROM ${legacy}`).map((f) => f.token), 'outside the migrations').toEqual([cr.ENGINE_NAME])
    }
    expect(cr.LEGACY_DIR).toBe('src/main/db/migrations/')
    const legacyRepo = path.join(tmp, 'legacy')
    mkdirSync(path.join(legacyRepo, 'src', 'main', 'db', 'migrations'), { recursive: true })
    writeFileSync(path.join(legacyRepo, 'src', 'main', 'db', 'migrations', '006_x.ts'), `CREATE TABLE ${cr.LEGACY_TOKENS[0]} (id)
`)
    expect(cr.scanTree(legacyRepo).findings).toEqual([])
    writeFileSync(path.join(legacyRepo, 'src', 'main', 'other.ts'), `SELECT * FROM ${cr.LEGACY_TOKENS[0]}
`)
    expect(cr.scanTree(legacyRepo).findings).toEqual([{ file: 'src/main/other.ts', line: 1, token: cr.ENGINE_NAME }])
    expect(cr.LEGACY_TOKENS).toEqual([`${cr.ENGINE_NAME}_jobs`, `${cr.ENGINE_NAME}_channels`])
    // binary files are skipped, text is read line by line
    const repo = path.join(tmp, 'bin')
    mkdirSync(path.join(repo, 'resources'), { recursive: true })
    writeFileSync(path.join(repo, 'resources', 'clip.mp4'), Buffer.from(`\0${cr.ENGINE_NAME}`))
    expect(cr.scanTree(repo).findings).toEqual([])
  })

  it('scans a packaged app.asar (and its unpacked files), not its node_modules', { timeout: 60_000 }, () => {
    const clean = path.join(tmp, 'clean.asar')
    writeAsar(
      clean,
      { 'package.json': '{"name":"atelier"}', 'out/main/index.js': 'console.log(1)', 'node_modules/x/README.md': `a ${cr.ENGINE_NAME} of science` },
      { 'out/main/mcp.js': 'module.exports = 1' }
    )
    const ok = run('--asar', clean)
    expect(ok.stdout).toMatch(/^cleanroom: OK 3 files scanned/m)
    expect(ok.status).toBe(0)

    const bad = path.join(tmp, 'bad.asar')
    writeAsar(bad, { 'package.json': '{}', 'out/renderer/assets/index.js': `fetch('${cr.DENYLIST[0]}')` }, { 'out/main/mcp.js': `// ${cr.ENGINE_NAME}` })
    const r = run('--asar', bad)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`app.asar/out/renderer/assets/index.js:1: ${cr.DENYLIST[0]}`)
    expect(r.stdout).toContain(`app.asar/out/main/mcp.js:1: ${cr.ENGINE_NAME}`)
    expect(run('--asar', path.join(tmp, 'missing.asar')).status).toBe(2)
  })
})
