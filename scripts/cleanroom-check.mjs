#!/usr/bin/env node
// Clean-room check (PLAN-V2-PRODUCTION §0 and §6.4). Atelier will be sold; the third-party video engine that v1 and
// lot 3 drove may not be resold, so no identifier specific to it may ship. This script refuses:
//   - the engine's name, in any case. The ONLY exception is two legacy SQL table names created by migration 006 and
//     renamed or abandoned by 008, which must stay byte-identical so older databases upgrade (LEGACY_TOKENS below).
//     In the source tree they are allowed only in src/main/db/migrations/ (LEGACY_DIR); in a packaged app.asar the
//     main process is one bundle, so they are allowed in any file there. They are removed from a line before the name
//     is searched, nothing else is;
//   - identifiers of that engine (stage tables, progress functions, environment switches, routes, log keys) and of
//     the adapter, extension and producer tool that lot P1 removed (DENYLIST below: exact, case-sensitive substrings).
//
// What is scanned:
//   - the source folders src/, cloud/, workers/, resources/ under the repository root (those that exist);
//   - the repository's own tooling and prose: scripts/, docs/, tests/ and the text files at the root (package.json,
//     *.config.*, tsconfig*.json, CLAUDE.md, README...). Historical docs and a few test fixtures may name the engine
//     and Atelier's own removed tools (HISTORICAL_ALLOW, FIXTURE_ALLOW, OWN_REMOVED) but never the engine's internals;
//     only this script is never scanned;
//   - always skipped: node_modules/ and .git/ at any depth (out/ and dist/ sit at the root, which is not walked).
//   - with `--asar <path>`: every file inside a packaged app.asar (and its app.asar.unpacked folder), except
//     node_modules/ (third-party packages under their own licences; their text is not ours).
// Binary files (by extension, or a NUL byte in the first 8 KB) are skipped.
//
//   node scripts/cleanroom-check.mjs                     scan the source folders of this repository
//   node scripts/cleanroom-check.mjs --root <dir>        scan the source folders under <dir> (tests)
//   node scripts/cleanroom-check.mjs --asar <app.asar>   scan a packaged app
//
// Output: findings as `path:line: <token>`, then one summary line starting with `cleanroom: ` (mac-verify.sh reads
// it). Exit code 0 when clean, 1 on any finding, 2 on a usage or read error. Wired into `npm test`
// (tests/unit/cleanroom.test.ts) and into scripts/mac-verify.sh (source tree and installed app).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The engine's name, searched case-insensitively. Written split so this file does not match a plain text search. */
export const ENGINE_NAME = ['fron', 'tier'].join('')

/** The only places the name may appear: legacy SQL table names kept unchanged in migrations 006 and 008. */
export const LEGACY_TOKENS = [`${ENGINE_NAME}_jobs`, `${ENGINE_NAME}_channels`]

/** The only source folder where LEGACY_TOKENS may appear. */
export const LEGACY_DIR = 'src/main/db/migrations/'

/** Exact, case-sensitive identifiers that may not appear anywhere scanned. */
export const DENYLIST = [
  // the engine's progress estimator (stage table, weights, parallel stages, functions) and its job internals
  '_EST_STAGES',
  '_EST_W',
  '_EST_PAR',
  '_est_stages',
  '_progress_est',
  '_est_ok',
  '_open_browser',
  'stages_done',
  'est_usd',
  '--queue-child',
  // its environment switches
  'WORKFLOWS_CLOCK',
  'IDEATION_DAILY',
  'UPDESK_WORKER',
  // its routes and download paths
  '/api/studio/spending',
  '/api/tl/',
  '/api/ideation/',
  '/api/queue/clear',
  '/f/video/',
  '/f/audio/',
  // what lot P1 removed: the Python extension, its routes and the v1 producer tool that queued renders
  'atelier_ext',
  'atelier-ext',
  '/api/atelier/events',
  '/api/atelier/invalidate',
  'make_video'
]

/** Atelier's OWN removed names (lot P1): history may still mention them, like the engine's name. */
export const OWN_REMOVED = new Set(['atelier_ext', 'atelier-ext', '/api/atelier/events', '/api/atelier/invalidate', 'make_video'])

export const SOURCE_DIRS =['src', 'cloud', 'workers', 'resources', 'scripts', 'docs', 'tests']

/** Never entered, at any depth (build output folders sit at the root, which is not walked: only SOURCE_DIRS are). */
export const SKIP_DIRS = new Set(['node_modules', '.git'])

/** The check itself holds every forbidden name (that is its job): the only file never scanned. */
export const SELF = 'scripts/cleanroom-check.mjs'

/**
 * Files outside src/ that may still name the old engine (its NAME only), because they are history. They are still
 * scanned for the DENYLIST: its internals (routes, switches, functions) may not appear even there. Repo-relative paths,
 * forward slashes; a pattern is a RegExp over the whole path. Keep this list short and explicit: a new doc is NOT
 * allowed by default.
 */
export const HISTORICAL_ALLOW = [
  /^docs\/archive\/STATUS-LOG\.md$/,
  /^docs\/archive\/LOTS\.md$/,
  /^docs\/archive\/REVIEW-[^/]*\.md$/,
  /^docs\/archive\/PLAN-V2[^/]*\.md$/
]

/** Deliberate fixtures that name the old engine on purpose (its NAME only, like HISTORICAL_ALLOW). Narrow, commented. */
export const FIXTURE_ALLOW = [
  // none today: add a narrow, commented pattern only for a fixture that must name the old engine
]

const nameAllowed = (rel) => [...HISTORICAL_ALLOW, ...FIXTURE_ALLOW].some((re) => re.test(rel))

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.mp4', '.mov', '.webm', '.mp3', '.wav', '.ogg', '.m4a',
  '.aac', '.woff', '.woff2', '.ttf', '.otf', '.node', '.dll', '.exe', '.dylib', '.so', '.wasm', '.zip', '.gz', '.asar'
])

/**
 * Findings in one text: `{ line, token }` for each forbidden token on each line. `allowLegacy`: see LEGACY_TOKENS.
 * `allowName`: the engine's name and OWN_REMOVED are allowed (HISTORICAL_ALLOW, FIXTURE_ALLOW); the rest of the
 * DENYLIST (the third-party engine's internals) still applies.
 */
export function scanText(text, allowLegacy = false, allowName = false) {
  const found = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let rest = line
    if (allowLegacy) for (const legacy of LEGACY_TOKENS) rest = rest.split(legacy).join('')
    if (!allowName && rest.toLowerCase().includes(ENGINE_NAME)) found.push({ line: i + 1, token: ENGINE_NAME })
    for (const token of DENYLIST) {
      if (allowName && OWN_REMOVED.has(token)) continue
      if (line.includes(token)) found.push({ line: i + 1, token })
    }
  }
  return found
}

function isBinary(name, buf) {
  if (BINARY_EXT.has(path.extname(name).toLowerCase())) return true
  const head = buf.subarray(0, 8192)
  return head.includes(0)
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out)
    } else if (entry.isFile()) out.push(full)
  }
  return out
}

/** Scans the source folders under `root`. Returns `{ files, findings: [{ file, line, token }] }`. */
export function scanTree(root) {
  const findings = []
  let files = 0
  const scanned = []
  /** Scans one file unless it is the check itself or binary; true when it was scanned. */
  const scanFile = (file) => {
    const rel = path.relative(root, file).split(path.sep).join('/')
    if (rel === SELF) return false
    const buf = readFileSync(file)
    if (isBinary(file, buf)) return false
    files++
    for (const f of scanText(buf.toString('utf8'), rel.startsWith(LEGACY_DIR), nameAllowed(rel))) findings.push({ file: rel, ...f })
    return true
  }
  for (const sub of SOURCE_DIRS) {
    const dir = path.join(root, sub)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
    scanned.push(sub)
    for (const file of walk(dir, [])) scanFile(file)
  }
  // the text files at the root of the repository (package.json, configs, CLAUDE.md, README...)
  let rootFiles = false
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && scanFile(path.join(root, entry.name))) rootFiles = true
  }
  if (rootFiles) scanned.push('root files')
  return { files, scanned, findings }
}

/**
 * Reads an asar archive: a pickled header (UInt32 sizes, then a JSON tree of files with size and offset), then the
 * file bodies. Returns `[{ path, data }]` for every file, reading unpacked ones from `<asar>.unpacked/`.
 */
export function readAsar(asarPath) {
  const buf = readFileSync(asarPath)
  if (buf.length < 16) throw new Error(`${asarPath}: not an asar archive (too short)`)
  const headerPickleSize = buf.readUInt32LE(4)
  const jsonSize = buf.readUInt32LE(12)
  const header = JSON.parse(buf.subarray(16, 16 + jsonSize).toString('utf8'))
  const base = 8 + headerPickleSize
  const files = []
  const visit = (node, prefix) => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const rel = prefix ? `${prefix}/${name}` : name
      if (entry.files) visit(entry, rel)
      else if (entry.link) continue
      else if (entry.unpacked) {
        const full = path.join(`${asarPath}.unpacked`, ...rel.split('/'))
        if (existsSync(full)) files.push({ path: rel, data: readFileSync(full) })
      } else {
        const start = base + Number(entry.offset)
        files.push({ path: rel, data: buf.subarray(start, start + Number(entry.size)) })
      }
    }
  }
  visit(header, '')
  return files
}

/** Scans a packaged app.asar (node_modules excepted). */
export function scanAsar(asarPath) {
  const findings = []
  let files = 0
  for (const f of readAsar(asarPath)) {
    if (f.path === 'node_modules' || f.path.startsWith('node_modules/')) continue
    if (isBinary(f.path, f.data)) continue
    files++
    for (const x of scanText(f.data.toString('utf8'), true)) findings.push({ file: `app.asar/${f.path}`, ...x })
  }
  return { files, findings }
}

function main(argv) {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  let asar = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root' && argv[i + 1]) root = path.resolve(argv[++i])
    else if (a === '--asar' && argv[i + 1]) asar = path.resolve(argv[++i])
    else {
      console.error('usage: node scripts/cleanroom-check.mjs [--root <dir>] [--asar <app.asar>]')
      return 2
    }
  }
  let result
  let what
  try {
    if (asar) {
      if (!existsSync(asar)) throw new Error(`${asar} does not exist`)
      result = scanAsar(asar)
      what = asar
    } else {
      result = scanTree(root)
      what = `${root} (${result.scanned.join(', ') || 'no source folder'})`
    }
  } catch (err) {
    console.error(`cleanroom: ERROR ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
  for (const f of result.findings) console.log(`${f.file}:${f.line}: ${f.token}`)
  if (result.findings.length > 0) {
    console.log(`cleanroom: FAIL ${result.findings.length} finding(s) in ${result.files} files scanned in ${what}`)
    return 1
  }
  console.log(`cleanroom: OK ${result.files} files scanned in ${what}, no forbidden identifier`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
