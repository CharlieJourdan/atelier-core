// Guard (#111): the Cloud runs under plain Node type stripping (no bundler, no vitest resolver), where an import
// without its `.ts` extension in ANY file it reaches (cloud/** or src/engine/**) is ERR_MODULE_NOT_FOUND and the
// beta stays down while typecheck, lint and vitest are green (1cc19e15). This loads what cloud/src/main.ts imports,
// in a bare `node` child with the same flags as `npm run cloud:dev`, without starting the server.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const mainFile = resolve(root, 'cloud/src/main.ts')

/** The relative modules cloud/src/main.ts imports (static `import … from './x.ts'`). */
function mainImports(): string[] {
  const src = readFileSync(mainFile, 'utf8')
  return [...src.matchAll(/^import\s[^'"]*?from\s+'(\.[^']+)'/gm)].map((m) => pathToFileURL(resolve(root, 'cloud/src', m[1] ?? '')).href)
}

describe('the Cloud starts under plain Node', () => {
  it('every module main.ts imports loads with node type stripping (no extension-less import anywhere in the graph)', () => {
    const urls = mainImports()
    expect(urls.length).toBeGreaterThan(5)
    const code = `for (const u of ${JSON.stringify(urls)}) await import(u)`
    const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--input-type=module', '-e', code], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true
    })
    expect(r.stderr.split(/\r?\n/).filter((l) => /ERR_|Error/.test(l)).join('\n')).toBe('')
    expect(r.status).toBe(0)
  }, 90_000)
})
