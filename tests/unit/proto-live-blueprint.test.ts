// Real mode, the published blueprint on the screens: its pipelines become « Modèles Atelier » (drawings the production editor can
// run), its unmapped agents become templates to recruit, « Version publiée N » shows in Équipe and in Production, and demo mode
// never sees any of it.
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { blueprintPipelines, blueprintRecruits, isBlueprintPipeline, withBlueprintPipelines } from '../../src/renderer/proto/live/mapping-blueprint'
import { toDrawing } from '../../src/renderer/proto/live/mapping-production'
import { setLiveDriver, type LiveDriver, type LiveSnapshot } from '../../src/renderer/proto/live/registry'
import { applySnapshot, createProtoStore, initialState, ProtoProvider, storeActions, type ProtoState } from '../../src/renderer/proto/store'
import { BlueprintBar } from '../../src/renderer/screens/team/BlueprintBar'
import { Blueprint } from '../../src/shared/cloud-api'
import { NO_BLUEPRINT, type BlueprintStatus } from '../../src/shared/blueprint'
import { DRAWING_KINDS } from '../../src/shared/pipeline-drawing'
import { setLocale } from '../../src/shared/fr'
import { viewOf } from '../../src/main/blueprint/map'
import { checkPipeline } from '../../src/main/analysis/catalog'
import { checkDrawing } from '../../src/main/analysis/drawing'
import { pipelineFromDrawing } from '../../src/engine/pipelines/from-drawing'
import { PUBLISHED_V3 } from '../../web/src/admin/blueprint'

afterEach(() => {
  setLocale('fr')
  setLiveDriver(null)
})

function status(edit: (bp: typeof PUBLISHED_V3) => void = () => undefined, version = 3): BlueprintStatus {
  const doc = structuredClone(PUBLISHED_V3)
  doc.version = version
  edit(doc)
  return viewOf(Blueprint.parse(doc), version, { publishedAt: '2026-10-23T10:00:00.000Z', fetchedAt: '2026-10-26T08:00:00.000Z', stale: false })
}

function snap(extra: Partial<LiveSnapshot> = {}): LiveSnapshot {
  const base = initialState()
  return {
    status: { enabled: false, running: 0, maxConcurrent: 3, tasks: {}, agents: 1, accountsReady: 1, accountsLimited: 0, resumesAt: null, openInbox: 0 } as unknown as LiveSnapshot['status'],
    channels: base.channels,
    agents: base.agents,
    videos: [],
    pipelines: [],
    inbox: [],
    accounts: [],
    threads: base.threads,
    messages: [],
    ...extra
  }
}

describe('blueprint pipelines → Modèles Atelier', () => {
  it('each blueprint pipeline becomes a preset with its steps in order, runners, gates, credits and the founder’s kinds', () => {
    const out = blueprintPipelines(status((bp) => void (bp.pipelines[0]!.nodes[0]!.kind = 'human-input')))
    expect(out.map((p) => p.id)).toEqual(['bp-documentaire-narre', 'bp-reddit-gameplay', 'bp-top-10'])
    const docu = out[0]!
    expect(docu).toMatchObject({ name: 'Documentaire narré', preset: true, version: 3, creditsPerVideo: 445, kind: 'documentary', format: 'long', channelIds: [] })
    expect(docu.description).toBe('Modèle de la version publiée 3.')
    expect(docu.nodes.map((n) => n.kind)).toEqual(['human-input', 'script', 'director', 'stock', 'image-gen', 'voice', 'edit', 'thumbnail', 'qc'])
    expect(docu.nodes.map((n) => n.col)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(docu.nodes[1]).toMatchObject({ runner: 'agent', gate: true, provider: 'Claude Code' })
    expect(docu.nodes[4]).toMatchObject({ runner: 'api', credits: 180 })
    expect(docu.edges).toHaveLength(8)
    expect(out[1]).toMatchObject({ kind: 'reddit', format: 'short' })
    expect(out[2]).toMatchObject({ kind: 'top10' })
    expect(out.every((p) => isBlueprintPipeline(p.id))).toBe(true)
  })

  it('no blueprint (not connected, nothing published): no pipeline', () => {
    expect(blueprintPipelines(null)).toEqual([])
    expect(blueprintPipelines(NO_BLUEPRINT)).toEqual([])
    expect(blueprintPipelines({ ...NO_BLUEPRINT, state: 'none' })).toEqual([])
  })

  it('a blueprint pipeline runs as a drawing: the editor’s drawing is valid and the engine’s library accepts it', () => {
    const [docu] = blueprintPipelines(status())
    const drawing = toDrawing(docu!)
    expect(drawing.steps).toHaveLength(9)
    for (const s of drawing.steps) expect(DRAWING_KINDS).toContain(s.kind)
    expect(drawing.steps[0]).toMatchObject({ id: 'sujet', kind: 'idea', runner: 'agent', gate: true })
  })

  it('swaps the blueprint’s templates into the store (a new version replaces the old one, a demo template of the same name gives way)', () => {
    const demo = initialState().pipelines
    const v3 = withBlueprintPipelines(demo, status())
    expect(v3.filter((p) => isBlueprintPipeline(p.id))).toHaveLength(3)
    const v4 = withBlueprintPipelines(v3, status((bp) => void bp.pipelines.splice(1), 4))
    expect(v4.filter((p) => isBlueprintPipeline(p.id)).map((p) => `${p.name} v${p.version}`)).toEqual(['Documentaire narré v4'])
    const named = withBlueprintPipelines([{ ...demo[0]!, id: 'pl-x', name: 'Top 10 illustré', preset: true }], status())
    expect(named.filter((p) => p.name === 'Top 10 illustré')).toHaveLength(1)
    expect(named.find((p) => p.name === 'Top 10 illustré')!.id).toBe('bp-top-10')
    expect(withBlueprintPipelines(v3, null).some((p) => isBlueprintPipeline(p.id))).toBe(false)
  })
})

describe('blueprint templates to recruit', () => {
  it('only the agents the runtime has no role for, with their tier as a model', () => {
    const s = status((bp) => void bp.agents.push({ id: 'community', role: 'Community manager', tier: 'deep', routines: [], instructions: 'Tu réponds.' }))
    expect(blueprintRecruits(s)).toEqual([{ id: 'community', name: 'Community manager', model: 'opus', instructions: 'Tu réponds.' }])
    expect(blueprintRecruits(status())).toEqual([])
    expect(blueprintRecruits(null)).toEqual([])
  })
})

describe('the store', () => {
  it('a live snapshot brings the published version and its templates; the next snapshot without it keeps them; demo mode drops them', () => {
    const live = applySnapshot(initialState({ mode: 'live' }), snap({ blueprint: status() }))
    expect(live.liveBlueprint).toMatchObject({ state: 'ok', version: 3 })
    expect(live.pipelines.filter((p) => isBlueprintPipeline(p.id))).toHaveLength(3)
    expect(live.pipelines.filter((p) => p.preset && isBlueprintPipeline(p.id))).toHaveLength(3)
    const again = applySnapshot(live, snap()) // the blueprint could not be read this time: the previous one stays
    expect(again.liveBlueprint?.version).toBe(3)
    expect(again.pipelines.filter((p) => isBlueprintPipeline(p.id))).toHaveLength(3)
    const unpublished = applySnapshot(again, snap({ blueprint: { ...NO_BLUEPRINT, state: 'none' } }))
    expect(unpublished.pipelines.some((p) => isBlueprintPipeline(p.id))).toBe(false)
    const store = createProtoStore(live)
    storeActions(store).setMode('demo')
    expect(store.get().liveBlueprint).toBeNull()
    expect(store.get().pipelines.some((p) => isBlueprintPipeline(p.id))).toBe(false)
  })

  it('demo mode ignores a snapshot altogether', () => {
    const demo = initialState({ mode: 'demo' })
    expect(applySnapshot(demo, snap({ blueprint: status() }))).toBe(demo)
  })
})

function render(el: ReactElement, state: Partial<ProtoState>): string {
  const store = createProtoStore(initialState(state))
  return renderToStaticMarkup(createElement(ProtoProvider, { store, children: createElement(TooltipProvider, { children: el }) }))
}

describe('the screens', () => {
  const live = (): Partial<ProtoState> => applySnapshot(initialState({ mode: 'live' }), snap({ blueprint: status() }))

  // production-2 (decision 0008): Production no longer shows pipelines, the blueprint's included (the « Production ›
  // Pipelines » screen tests left with that screen); the store still carries them for the other screens.

  it('Équipe: « Version publiée 3 » in real mode; nothing in demo or without a published version', () => {
    expect(render(createElement(BlueprintBar), live())).toContain('Version publiée 3')
    expect(render(createElement(BlueprintBar), { mode: 'demo', liveBlueprint: status() })).toBe('')
    expect(render(createElement(BlueprintBar), { ...live(), liveBlueprint: { ...NO_BLUEPRINT, state: 'none' } })).toBe('')
  })

  it('English: the same screen says « Published version 3 »', () => {
    setLocale('en')
    expect(render(createElement(BlueprintBar), live())).toContain('Published version 3')
  })

  it('the live driver exposes the plan and the apply to the Équipe screen', async () => {
    const calls: string[] = []
    const driver = {
      blueprint: {
        plan: vi.fn(async () => ({ version: 3, changes: [], appliedVersion: null })),
        apply: vi.fn(async (v: number, ids: number[]) => (calls.push(`apply:${v}:${ids.join(',')}`), { version: v, applied: ids.length, skipped: 0 })),
        refresh: vi.fn(async () => status())
      }
    } as unknown as LiveDriver
    setLiveDriver(driver)
    expect(await driver.blueprint!.plan()).toMatchObject({ version: 3 })
    await driver.blueprint!.apply(3, [4, 5])
    expect(calls).toEqual(['apply:3:4,5'])
  })
})

describe('running a blueprint pipeline', () => {
  it('every blueprint pipeline, drawn by the editor, passes the drawing check and compiles into a valid engine pipeline', () => {
    for (const p of blueprintPipelines(status())) {
      const drawing = checkDrawing(JSON.parse(JSON.stringify(toDrawing(p))))
      expect(drawing.steps.map((s) => s.id)).toEqual(p.nodes.map((n) => n.id))
      const compiled = pipelineFromDrawing(drawing, { id: `drawn-${p.id}` })
      const check = checkPipeline(JSON.stringify(compiled.pipeline))
      expect(check.ok, `${p.name}: ${JSON.stringify(check)}`).toBe(true)
    }
  })
})
