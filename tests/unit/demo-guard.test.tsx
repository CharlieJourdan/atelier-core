// The demo guard-rails of PLAN-V2 §8.4 (review A #4): the lint rule that keeps src/renderer/demo away from the Atelier
// API, and the walk over every screen that checks a screen marked demo shows its DÉMO badge.
import path from 'node:path'
import { ESLint } from 'eslint'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FEATURES, featureState, isDemoLike, NO_FEATURES, type FeatureContext } from '../../src/shared/features'
import { SCREEN_FEATURES, SECTION_IDS, SECTION_PAGES, screenFeature, type Route } from '../../src/shared/sections'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { SectionScreen } from '../../src/renderer/screens/SectionScreen'

const ROOT = path.resolve(__dirname, '../..')
const noop = () => undefined

describe('demo code may not reach the API (lint rule)', () => {
  const lint = async (code: string, file: string) => {
    const eslint = new ESLint({ cwd: ROOT })
    const [res] = await eslint.lintText(code, { filePath: path.join(ROOT, file) })
    return res?.messages.map((m) => m.ruleId) ?? []
  }
  const DEMO = 'src/renderer/demo/x.tsx'

  it('flags the IPC client and window.atelier under src/renderer/demo, and nothing elsewhere', { timeout: 60_000 }, async () => {
    const viaImport = "import { api } from '../state/client'\nexport const x = api\n"
    const viaWindow = "export const x = () => window.atelier.call('videos.create', 1)\n"
    expect(await lint(viaImport, 'src/renderer/demo/a.ts')).toContain('no-restricted-imports')
    expect(await lint(viaWindow, 'src/renderer/demo/b.ts')).toContain('no-restricted-syntax')
    expect(await lint(viaWindow, 'src/renderer/lib/c.ts')).not.toContain('no-restricted-syntax')
    expect(await lint('export const x = 1\n', 'src/renderer/demo/d.ts')).toEqual([])
  })

  const BAD_SYNTAX: Array<[string, string]> = [
    ['window[\'atelier\']', "export const x = () => window['atelier'].call('a')\n"],
    ['window[`atelier`]', 'export const x = () => window[`atelier`].call(\'a\')\n'],
    ['concatenated key', "export const x = () => window['ate' + 'lier']\n"],
    ['const { atelier } = window', 'const { atelier } = window\nexport const x = atelier\n'],
    ['const { atelier: a } = globalThis', 'const { atelier: a } = globalThis\nexport const x = a\n'],
    ["const { 'atelier': a } = window", "const { 'atelier': a } = window\nexport const x = a\n"],
    ['globalThis.atelier', 'export const x = globalThis.atelier\n'],
    ['bare global atelier', 'export const x = () => atelier.call(\'a\')\n'],
    ['dynamic import', "export const x = () => import('../state/client')\n"],
    ['require', "const c = require('../state/client')\nexport const x = c\n"]
  ]
  it.each(BAD_SYNTAX)('flags %s under demo/', { timeout: 60_000 }, async (_name, code) => {
    const ids = await lint(code, DEMO)
    expect(ids.some((i) => i === 'no-restricted-syntax' || i === 'no-restricted-globals' || i === 'no-restricted-imports')).toBe(true)
  })

  it.each(BAD_SYNTAX)('does not apply the demo rules to %s outside demo/', { timeout: 60_000 }, async (_name, code) => {
    const ids = await lint(code, 'src/renderer/lib/outside.ts')
    expect(ids).not.toContain('no-restricted-syntax')
    expect(ids).not.toContain('no-restricted-globals')
  })

  const BAD_IMPORTS = [
    '@/state/whatever',
    '@/state/client',
    '../lib/router',
    '../state/client',
    '../../renderer/state/client',
    '@/views/ChatsView',
    '@/components/shell/Rail',
    '@/components/settings/ModelsPanel',
    '@/components/ui/../../state/client',
    './../state/client',
    '@/lib/router',
    'electron'
  ]
  it.each(BAD_IMPORTS)('flags import of %s from demo/', { timeout: 60_000 }, async (spec) => {
    expect(await lint(`import * as m from '${spec}'\nexport const x = m\n`, DEMO)).toContain('no-restricted-imports')
  })

  const GOOD_IMPORTS = [
    'react',
    'react/jsx-runtime',
    'lucide-react',
    '@/components/ui/button',
    '@/components/atelier/demo',
    '@/lib/utils',
    '@/lib/toast',
    '@/lib/features',
    '@/vendor/elevenlabs-ui/orb',
    './x',
    './sub/y',
    '../../shared/fr',
    '../../shared/features'
  ]
  it.each(GOOD_IMPORTS)('allows import of %s from demo/', { timeout: 60_000 }, async (spec) => {
    expect(await lint(`import * as m from '${spec}'\nexport const x = m\n`, DEMO)).not.toContain('no-restricted-imports')
  })

  it('the same imports are not restricted outside demo/', { timeout: 60_000 }, async () => {
    const out = "import * as m from '@/state/whatever'\nexport const x = m\n"
    expect(await lint(out, 'src/renderer/lib/outside.ts')).not.toContain('no-restricted-imports')
  })
})

describe('every screen marked demo shows its badge (PLAN-V2 §8.4)', () => {
  const routes: Route[] = SECTION_IDS.flatMap((section) => {
    const pages: readonly string[] = SECTION_PAGES[section]
    return pages.length ? pages.map((page) => ({ section, page })) : [{ section }]
  })

  const render = (route: Route, ctx: FeatureContext) =>
    renderToStaticMarkup(
      <FeaturesProvider value={ctx}>
        <TooltipProvider>
          <SectionScreen route={route} onRoute={noop} />
        </TooltipProvider>
      </FeaturesProvider>
    )

  it('walks every screen (not the registry) and finds at least one marked demo', { timeout: 60_000 }, () => {
    expect(routes.length).toBeGreaterThan(SECTION_IDS.length)
    let marked = 0
    for (const route of routes) {
      const featureId = screenFeature(route)
      if (!featureId) continue
      const state = featureState(featureId, NO_FEATURES)
      if (!isDemoLike(state.status)) continue
      marked++
      const out = render(route, NO_FEATURES)
      expect(out, `${route.section}/${route.page ?? ''}`).toContain('data-testid="demo-badge"')
    }
    expect(marked).toBeGreaterThan(0)
  })

  it('every mapping targets a real screen and a known feature', () => {
    const keys = new Set(routes.map((r) => (r.page ? `${r.section}/${r.page}` : r.section)))
    for (const [key, id] of Object.entries(SCREEN_FEATURES)) {
      expect(keys.has(key), key).toBe(true)
      expect(FEATURES.map((f) => f.id as string)).toContain(id)
    }
  })
})
