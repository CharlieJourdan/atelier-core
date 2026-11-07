// The production engine's layout (src/engine: skeleton from lot P1, core from lot P2) and its lint rule: src/engine may
// not load Electron nor anything of src/main, however it tries (PLAN-V2-PRODUCTION §1.12, ENGINE-SPEC R13.1).
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { ARTEFACT_TYPES, ENGINE_CONTRACT_VERSION, EXECUTORS, GATES, PIPELINE_SCHEMA } from '../../src/engine'

const ROOT = path.join(__dirname, '..', '..')

// lot P2's core files, then lot P4's (services, host, Cloud client, template runner) and folders (nodes and their parts),
// then lot P5's (executors, the GPU executor through Atelier Cloud, the worker program)
const ENGINE_ENTRIES = [
  // style-markets: the public archives' search
  'archive',
  'artefacts.ts',
  'canonical.ts',
  'cloud-busy.ts',
  'cloud-demo.ts',
  'cloud-gpu.ts',
  'cloud-http.ts',
  'demo.ts',
  // motion-montage: the editing kit's rhythm and grammar
  'edit',
  'errors.ts',
  'estimate.ts',
  'events.ts',
  'executor.ts',
  'formats',
  'host.ts',
  'index.ts',
  'limits.ts',
  'media',
  'motion',
  'nodes',
  'outputs.ts',
  'pipeline-schema.ts',
  'pipelines',
  'plan.ts',
  'presenter',
  'registry.ts',
  'remote-render',
  'render',
  'review',
  'scheduler.ts',
  'services.ts',
  'sourcing',
  'state.ts',
  'store.ts',
  'technologies',
  'text',
  'types.ts',
  'validate.ts',
  'watch', // « watch a whole video » (chantier regarder-videos)
  'worker'
]

/** Every source file under src/engine, relative (posix), for the lint check. */
function engineFiles(dir = path.join(ROOT, 'src', 'engine'), rel = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? engineFiles(path.join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]
  )
}

describe('src/engine layout', () => {
  it('exposes the spec vocabulary, the core of lot P2 and the nodes of lot P4 (contract version 2)', () => {
    expect(ENGINE_CONTRACT_VERSION).toBe(2)
    expect(PIPELINE_SCHEMA).toBe('atelier.pipeline/1')
    expect(EXECUTORS).toEqual(['local', 'cloud', 'gpu'])
    expect(GATES).toEqual(['none', 'review', 'owner'])
    expect(ARTEFACT_TYPES).toContain('json.editplan')
    expect(new Set(ARTEFACT_TYPES).size).toBe(ARTEFACT_TYPES.length)
    expect(readdirSync(path.join(ROOT, 'src', 'engine')).sort()).toEqual(ENGINE_ENTRIES)
    expect(engineFiles().length).toBeGreaterThan(ENGINE_ENTRIES.length)
  })
})

describe('the src/engine lint rule (atelier/engine-boundary)', () => {
  let eslint: ESLint | null = null
  const lint = async (code: string, file = 'src/engine/probe.ts'): Promise<string[]> => {
    eslint ??= new ESLint({ cwd: ROOT })
    const [res] = await eslint.lintText(code, { filePath: path.join(ROOT, file) })
    return (res?.messages ?? []).filter((m) => m.ruleId === 'atelier/engine-boundary').map((m) => m.message)
  }
  const BAD = [
    "import { app } from 'electron'\nexport const a = app",
    "import { ipcRenderer } from 'electron/renderer'\nexport const a = ipcRenderer",
    "import type { Db } from '../main/db'\nexport type A = Db",
    "export { Ledger } from '../main/ledger'",
    "export * from '../main/core'",
    "export const m = import('electron')",
    "export const m = require('../main/settings')",
    "import x from '../../src/main/index'\nexport const a = x",
    // bypasses found in the review: path tricks, a template literal, other require forms, a computed name
    "import { x } from './../main/core'\nexport const a = x",
    "import { x } from '../shared/../main/core'\nexport const a = x",
    'export const m = import(`electron`)',
    "import { createRequire } from 'node:module'\nexport const m = createRequire(import.meta.url)('electron')",
    "export const m = module.require('../main/ledger')",
    "const name = 'electron'\nexport const m = import(name)",
    // review PA finding 12: an aliased loader, and the renderer (also through its alias) and preload folders
    "const r = require\nexport const m = r('electron')",
    "const r = module.require\nexport const m = r('electron')",
    "import { createRequire } from 'node:module'\nconst req = createRequire(import.meta.url)\nexport const m = req('electron')",
    "import { x } from '../renderer/lib/theme'\nexport const a = x",
    "import { x } from '@/lib/theme'\nexport const a = x",
    "import x from '@'\nexport const a = x",
    "export { x } from '../preload/index'",
    "import { x } from '../../src/renderer/App'\nexport const a = x",
    // lot PAF review: destructured, renamed and namespaced loaders
    "const { require: r } = module\nexport const m = r('electron')",
    "import { createRequire as cr } from 'node:module'\nexport const m = cr(import.meta.url)('electron')",
    "import * as m from 'node:module'\nexport const x = m.createRequire(import.meta.url)('electron')"
  ]
  // what the engine may use: node built-ins, its own files, shared pure data
  const GOOD = [
    "import { createHash } from 'node:crypto'\nexport const h = createHash",
    "import { GATES } from './types'\nexport const g = GATES",
    "import { t } from '../shared/fr'\nexport const f = t",
    "import { x } from './maintenance'\nexport const a = x",
    "import { z } from '@scope/pkg'\nexport const a = z",
    "import { x } from './renderers'\nexport const a = x",
    'export const o = { require: 1 }'
  ]

  it.each(BAD)('refuses %s', { timeout: 60_000 }, async (code) => {
    expect(await lint(code)).toHaveLength(1)
  })

  it.each(GOOD)('allows %s', { timeout: 60_000 }, async (code) => {
    expect(await lint(code)).toEqual([])
  })

  it('catches deeper files and every script kind under src/engine, and only there', { timeout: 60_000 }, async () => {
    const electronApp = "import { app } from 'electron'\nexport const a = app"
    expect(await lint("import { x } from '../../main/core'\nexport const a = x", 'src/engine/render/probe.ts')).toHaveLength(1)
    for (const ext of ['tsx', 'mts', 'js', 'mjs']) {
      expect(await lint(electronApp, `src/engine/probe.${ext}`), ext).toHaveLength(1)
    }
    // the main process may import Electron
    expect(await lint(electronApp, 'src/main/probe.ts')).toEqual([])
  })

  it('the real engine files are clean', { timeout: 60_000 }, async () => {
    for (const f of engineFiles()) {
      expect(await lint(readFileSync(path.join(ROOT, 'src', 'engine', f), 'utf8'), `src/engine/${f}`), f).toEqual([])
    }
  })
})
