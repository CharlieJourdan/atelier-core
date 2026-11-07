// pipeline-ui (Charlie 01/11): what we do not sell is never shown. The pipeline views — the base cards, the estimate (with the
// Cloud's prices, so every line names an engine underneath), the graph of « Avatar », every option a user can see and an
// agent's change of engine — are rendered with real data and their text and attributes checked against the provider names.
// Also: the internal options are never shown, the visible ones each have their place, the beta tools tab is hidden.
import { statSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { avatarBase, fromBase } from '../../src/engine/technologies'
import { ENGINES_CACHE_KEY, EstimatesService } from '../../src/main/production/estimates'
import type { EngineInfo, RecipeDocument } from '../../src/shared/api'
import { setLocale } from '../../src/shared/fr'
import { INTERNAL_OPTIONS, MAIN_OPTIONS, OPTION_PREVIEWS, optionPlace, optionPreviewKey } from '../../src/shared/option-previews'
import type { PipelineEstimateView } from '../../src/shared/estimates'
import type { BasePipelineInfo } from '../../src/shared/recipes'
import { SECTION_TABS } from '../../src/shared/sections'
import { changeWords } from '../../src/renderer/screens/production/agent/parts'
import { GraphNode } from '../../src/renderer/screens/production/graphe/GraphNode'
import { PipelineEstimate } from '../../src/renderer/screens/production/recettes/PipelineEstimate'
import { OptionFields, optionsIn, PipelineOptions } from '../../src/renderer/screens/production/recettes/PipelineOptions'
import { ReadyCard } from '../../src/renderer/screens/production/lab/ReadyCard'
import { cloudHelpers } from './cloud-app-helpers'
import { memoryCore } from './helpers'
import { PROVIDER_NAMES, providerNamesIn } from '../fixtures/provider-names'

const ENGINES_MODULE = 'engines'
const engineMod = (await import(`../../cloud/src/providers/${ENGINES_MODULE}.ts`)) as {
  FAKE_ENGINES: unknown[]
  publishEngines(decls: unknown[], registry: { resolve(u: string): { status: 'real' | 'demo' } }, grid: unknown): EngineInfo[]
}

/** Text and attributes of a render: what a user reads, and what a tooltip or a reader would say. */
const readable = (html: string): string => html.replace(/<[^>]*?\s(?:title|aria-label|alt|placeholder)="([^"]*)"[^>]*>/g, ' $1 ').replace(/<[^>]+>/g, ' ')

let bases: BasePipelineInfo[] = []
let view: PipelineEstimateView
let graph: Awaited<ReturnType<ReturnType<typeof memoryCore>['api']['graph.pipeline']>>
const doc = fromBase(avatarBase) as unknown as RecipeDocument

beforeAll(async () => {
  setLocale('fr')
  const core = memoryCore()
  const ctx = core.context
  const cloud = (cloudHelpers.makeCloud() as unknown as { cloud: { pricing: { current(): unknown } } }).cloud
  const engines = engineMod.publishEngines(engineMod.FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, cloud.pricing.current())
  ctx.settings.set(ENGINES_CACHE_KEY, { at: '2026-11-01T09:00:00.000Z', engines: engines as never })
  const s = new EstimatesService({ db: core.db, settings: ctx.settings, prices: ctx.prices, routes: ctx.routes, liveEngines: () => Promise.resolve(null) })
  view = await s.pipeline(doc)
  bases = await core.api['recipes.bases']()
  graph = await core.api['graph.pipeline'](doc)
})

describe('pipeline views name no provider or model', () => {
  it('the check itself finds the names (engine ids, labels, the plan line)', () => {
    expect(providerNamesIn('clip:veo31-lite-relaxed')).toContain('Veo')
    expect(providerNamesIn('Présentateur heygen-avatar4')).toEqual(expect.arrayContaining(['HeyGen', 'avatar4']))
    expect(providerNamesIn('le forfait de HeyGen')).toContain('forfait')
    expect(providerNamesIn('Écrit par l’agent · abonnement Claude · Présentateur · Voix · Images · Clips · Montage')).toEqual([])
    expect(PROVIDER_NAMES.length).toBeGreaterThan(20)
  })

  it('the estimate is priced (every line runs on a named engine underneath) yet shows none, nor a monthly plan', () => {
    expect(view.available).toBe(true)
    expect(view.lines.some((l) => l.engines.length > 0)).toBe(true)
    const html = renderToStaticMarkup(<PipelineEstimate view={view} base={bases[0]} channels={[]} channelId={null} onChannel={() => undefined} />)
    expect(html).toContain('data-testid="est-time"')
    expect(providerNamesIn(readable(html))).toEqual([])
  })

  it('the ready pipelines’ cards (the base pipelines, production-lab) say their name, render time, cost in credits and form, nothing else', () => {
    const estimates = { available: true, reason: null, creditEur: 0.01, bases: { 'avatar@1': { perMinute: view.perMinute, fit: null, renderTime: view.renderTimes[0] ?? null } }, recipes: {} }
    const html = bases.map((b) => renderToStaticMarkup(<ReadyCard base={b} estimates={estimates} actions={{ busy: false, onUse: () => undefined, onAdd: () => undefined }} />)).join('\n')
    expect(html).toMatch(/data-testid="base-est-avatar@1-time"[^>]*>(\d+ min|\d+ h \d+)</)
    expect(html).toMatch(/data-testid="base-est-avatar@1-cost"[^>]*>[\d  ]+ crédits</)

    expect(html).not.toContain('avatar@1<')
    expect(providerNamesIn(readable(html))).toEqual([])
  })

  it('the graph of « Avatar » says what makes each step in plain words', () => {
    expect(graph.nodes.some((n) => n.engine !== null)).toBe(true)
    const html = graph.nodes
      .map((n) => renderToStaticMarkup(<GraphNode node={n} x={0} y={0} cost={undefined} creditEur={0.01} run={null} hot={false} dim={false} orientation="vertical" onHover={() => undefined} />))
      .join('')
    expect(html).toContain('Présentateur Atelier')
    expect(html).not.toMatch(/moteur/i)
    expect(providerNamesIn(readable(html))).toEqual([])
  })

  it('the options a user sees: the main ones, then « Avancé »; the internal ones never', () => {
    const base = bases.find((b) => b.id === 'avatar@1')!
    const previews = new Map()
    const main = renderToStaticMarkup(<PipelineOptions base={base} doc={doc} previews={previews} onChange={() => undefined} />)
    const advanced = renderToStaticMarkup(<OptionFields options={optionsIn(base, 'advanced')} doc={doc} deltas={null} previews={previews} onChange={() => undefined} />)
    // the main options this base declares
    for (const id of MAIN_OPTIONS.filter((id) => base.options.some((o) => o.id === id))) expect(main).toContain(`data-testid="opt-${id}-field"`)
    for (const id of INTERNAL_OPTIONS) expect(main + advanced).not.toContain(`data-testid="opt-${id}-field"`)
    expect(main + advanced).not.toContain('Génération du présentateur')
    // every option of the base has a place, and a previewed one is on the main path
    for (const o of base.options) expect(['main', 'advanced', 'internal']).toContain(optionPlace(o.id))
    for (const p of OPTION_PREVIEWS) expect(optionPlace(p.option)).toBe('main')
    expect(providerNamesIn(readable(main + advanced))).toEqual([])
  })

  it("an agent's change of engine says that it changes, not to what", () => {
    const w = changeWords({ kind: 'engine', brick: 'clip.make', key: null, before: 'clip:veo31-lite-relaxed', after: 'clip:grok-imagine-15-lite' } as never)
    expect(providerNamesIn(`${w.what} ${w.before} ${w.after}`)).toEqual([])
  })

  it('ships a before / after loop of every previewed option, small, served free through previews.options', async () => {
    const items = await memoryCore().api['previews.options']()
    for (const p of OPTION_PREVIEWS) {
      for (const value of [p.before, p.after]) {
        const item = items.find((i) => i.key === optionPreviewKey(p.option, value))
        expect(item, `${p.option} = ${String(value)}`).toBeDefined()
        expect(item!.files[0]?.type).toBe('video')
        expect(statSync(path.join('resources', 'option-previews', item!.files[0]!.ref)).size).toBeLessThan(200_000)
      }
    }
    const file = await memoryCore().api['previews.file'](optionPreviewKey('chapters', true), items.find((i) => i.key === optionPreviewKey('chapters', true))!.files[0]!.ref)
    expect(file.mime).toBe('video/mp4')
  })

  it('hand editing is behind the dev flag only (decision 0051): off by default, on with ATELIER_PIPELINE_DEV=1', async () => {
    const { api } = memoryCore()
    const before = process.env.ATELIER_PIPELINE_DEV
    try {
      delete process.env.ATELIER_PIPELINE_DEV
      expect((await api['app.info']()).pipelineDev).toBe(false)
      process.env.ATELIER_PIPELINE_DEV = '1'
      expect((await api['app.info']()).pipelineDev).toBe(true)
    } finally {
      if (before === undefined) delete process.env.ATELIER_PIPELINE_DEV
      else process.env.ATELIER_PIPELINE_DEV = before
    }
  })

  it('the beta tools are not a Production tab any more (their route stays)', () => {
    expect(SECTION_TABS.production).not.toContain('outils')
  })
})
