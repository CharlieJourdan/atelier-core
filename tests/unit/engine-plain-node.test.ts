// Lot P4M2: src/engine is erasable-syntax-only TypeScript, so plain Node (24 and 26, no experimental flag) runs it
// through the extension-less import resolver, exactly as the local worker, Atelier Cloud and RunPod images do.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.join(__dirname, '..', '..')

const PROBE = `
import { EngineError, RunEvents, Slots, DEFAULT_LIMITS, PIPELINE_SCHEMA, canonicalJson, contentFingerprint } from './src/engine/index.ts'
import { productionRegistry } from './src/engine/nodes/index.ts'
const slots = new Slots(DEFAULT_LIMITS)
await slots.acquire('local', 0)
const err = new EngineError('transient', 'boom')
const events = new RunEvents('run-1')
console.log(JSON.stringify({
  schema: PIPELINE_SCHEMA,
  runId: events.runId,
  code: err.code,
  permanent: err.permanent,
  canonical: canonicalJson({ b: 1, a: [2] }),
  fp: contentFingerprint({ value: { a: 1 } }).length,
  nodes: typeof productionRegistry
}))
`

describe('plain Node runs the engine without an experimental flag', () => {
  it('imports src/engine/index.ts through the resolver and runs a tiny scenario', () => {
    const r = spawnSync(
      process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', './scripts/ts-resolve.mjs', '--input-type=module', '-e', PROBE],
      { cwd: ROOT, encoding: 'utf8' }
    )
    expect(r.stderr).not.toMatch(/ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/)
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}')
    expect(out).toEqual({
      schema: 'atelier.pipeline/1',
      runId: 'run-1',
      code: 'transient',
      permanent: false,
      canonical: '{"a":[2],"b":1}',
      fp: 64,
      nodes: 'function'
    })
  })

  it('no package.json script (nor the resolver comment) uses the flag Node 26 removed', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      expect(cmd, name).not.toContain('experimental-transform-types')
    }
    expect(readFileSync(path.join(ROOT, 'scripts', 'ts-resolve.mjs'), 'utf8')).not.toContain('experimental-transform-types')
  })
})
