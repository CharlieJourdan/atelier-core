// reverse-pipeline (docs/METHODE-REVERSE-PIPELINE.md): a request runs the cloning engine on fakes without the
// intake, and the reverse-engineered pipeline built from its artefacts parses against the contract — every brick with its
// settings (measured ones with their evidence), the human inputs and their stand-ins, what cannot be made, the proof; a
// transform (translate / adapt / bend / mix) makes a new valid pipeline from the same analyses; the API checks its args.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PipelinePlan, StyleDefinition, VideoAnalysis } from '../../src/shared/clone'
import { REVERSE_METHODS } from '../../src/shared/api/reverse'
import { API_METHODS } from '../../src/shared/api'
import { ReversePipeline } from '../../src/shared/reverse/pipeline'
import { CloneEngine } from '../../src/main/production/clone/engine'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { buildReversePipeline, distributionsOf } from '../../src/main/production/clone/reverse/build'
import { ownerOf, sourcedSetting } from '../../src/main/production/clone/reverse/build-graph'
import { REVERSE_FILES, loadReverseInputs } from '../../src/main/production/clone/reverse/load'
import { ReverseService } from '../../src/main/production/clone/reverse/service'
import { CloneStore } from '../../src/main/production/clone/store'
import { reverseApi } from '../../src/main/api/reverse'

function setup(kind: 'presenter-motion' | 'full-3d' = 'presenter-motion') {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'reverse-'))
  const ch = fakeChannel(kind)
  const engine = new CloneEngine({ dataDir, services: () => fakeServices(ch).services, notify: () => {}, now: () => new Date('2026-11-06T10:00:00Z') })
  return { dataDir, ch, engine, reverse: new ReverseService(engine) }
}

const request = (url: string, over: Record<string, unknown> = {}) => ({ links: [{ url }], testBudgetUsd: 10, ...over })

async function finished(kind: 'presenter-motion' | 'full-3d' = 'presenter-motion') {
  const t = setup(kind)
  const { id } = t.reverse.start(request(t.ch.url))
  await t.reverse.settled(id)
  return { ...t, id }
}

describe('a reverse-engineered pipeline from the engine’s artefacts (fakes)', () => {
  it('a presenter + motion channel: graph, measured settings with evidence, human inputs, proof, cost, state proven', async () => {
    const t = await finished()
    expect(t.reverse.status(t.id)).toMatchObject({ id: t.id, state: 'done', stoppedBecause: null, budgetUsd: 10 })
    const p = t.reverse.result(t.id)!
    expect(ReversePipeline.parse(p)).toBeTruthy()
    expect(p.state).toBe('proven')
    expect(p.request.links[0]!.url).toBe(t.ch.url)
    expect(p.derivedFrom).toBeNull()
    // one node per plan brick, settings on the brick they belong to
    const store = new CloneStore(t.dataDir, t.id)
    const plan = store.load('p5-pipeline-plan.json', PipelinePlan)!
    for (const b of plan.bricks) expect(p.graph.nodes.some((n) => n.id === b.node && n.role === b.role)).toBe(true)
    const all = p.graph.nodes.flatMap((n) => n.settings)
    expect(all.map((s) => s.key).sort()).toEqual(plan.settings.map((s) => s.key).sort())
    expect(p.graph.nodes.find((n) => n.id === 'director.plan')?.settings.some((s) => s.key === 'director.meanShotS')).toBe(true)
    expect(p.graph.nodes.find((n) => n.id === 'recipe')?.settings.some((s) => s.key === 'recipe.language')).toBe(true)
    // a measured setting carries its evidence; a setting is measured only when all its fields are
    const def = store.load('p4-style-definition.json', StyleDefinition)!
    const measured = all.filter((s) => s.source === 'measured')
    expect(measured.length).toBeGreaterThan(3)
    for (const s of measured) expect(s.evidence.length).toBeGreaterThan(0)
    const music = all.find((s) => s.key === 'music')!
    expect(music.fields).toEqual(['sound.music', 'sound.musicGenre'])
    expect(music.source).toBe([def.sound.music.source, def.sound.musicGenre.source].includes('default') ? 'default' : 'measured')
    expect(all.find((s) => s.key === 'voice.ref')?.source).toBe('user')
    // edges from the compiled recipe
    expect(p.graph.edges.length).toBeGreaterThan(0)
    for (const e of p.graph.edges) expect(p.graph.nodes.some((n) => n.id === e.from) && p.graph.nodes.some((n) => n.id === e.to)).toBe(true)
    // the presenter is a human input stood in by a look-alike
    expect(p.humanInputs).toHaveLength(1)
    expect(p.humanInputs[0]).toMatchObject({ slot: 'presenter', kind: 'presenter-footage', userSupplies: false })
    expect(p.humanInputs[0]!.placeholder?.description).toMatch(/placeholder/)
    expect(p.notPossible).toEqual([])
    // the presenter's presence per part (no `sourcing.distributions` yet on this definition)
    expect(p.distributions.map((d) => d.element)).toEqual(['presenter'])
    // the corpus was read whole, the proof is the example the blind judge passed
    expect(p.corpus.length).toBeGreaterThanOrEqual(5)
    expect(p.corpus.every((c) => c.whole)).toBe(true)
    expect(p.proof).toMatchObject({ sameChannel: 'yes', rounds: 3, judge: 'fake-judge' })
    expect(p.proof!.pairs.length).toBeGreaterThanOrEqual(6)
    expect(p.cost.measured).toBe(true)
    expect(p.cost.usdPerMinute).toBeCloseTo(0.5, 2)
    expect(p.spentUsd).toBeGreaterThan(0)
    expect(p.recipe).not.toBeNull()
    expect(p.definitionVersion).toBe(def.version)
    expect(p.summary).toMatch(/proven/)
    // saved in the folder once done
    expect(ReversePipeline.parse(JSON.parse(readFileSync(store.file(REVERSE_FILES.pipeline), 'utf8'))).id).toBe(t.id)
    expect(t.reverse.list().map((x) => x.id)).toEqual([t.id])
  })

  it('an all-3D channel: not reproducible, the missing technology named, alternatives faithful to it', async () => {
    const t = await finished('full-3d')
    const p = ReversePipeline.parse(t.reverse.result(t.id))
    expect(p.state).toBe('not-reproducible')
    expect(p.feasibility.verdict).toBe('not-reproducible')
    expect(p.notPossible[0]).toMatchObject({ what: '3d animation', technology: '3d scene generation', buildCostUsd: 400, reason: 'no engine brick makes it' })
    expect(p.graph.nodes.some((n) => n.status === 'missing')).toBe(true)
    expect(p.alternatives.length).toBeGreaterThan(0)
    expect(p.proof).toBeNull()
    expect(p.cost.measured).toBe(false)
    expect(p.summary).toMatch(/not reproducible/)
  })

  it('reads `sourcing.distributions` when the definition has it (curve kept, at most ten windows), skips one without evidence', async () => {
    const t = await finished()
    const def = new CloneStore(t.dataDir, t.id).load('p4-style-definition.json', StyleDefinition)!
    const ev = [{ video: 'v1', atS: 3, frames: [] }]
    const value = [{ element: 'presenter', overall: 0.5, byPart: [{ part: 'hook', share: 0.7 }, { part: 'end', share: 0.2 }], curve: [0.7, 0.6, 0.5, 0.5, 0.4, 0.4, 0.3, 0.3, 0.2, 0.2, 0.1] }]
    const withField = { ...def, sourcing: { ...def.sourcing, distributions: { value, source: 'measured', evidence: ev } } } as typeof def
    const d = distributionsOf(withField)
    expect(d).toHaveLength(1)
    expect(d[0]!.curve).toHaveLength(10)
    expect(d[0]!.byPart).toEqual([{ part: 'hook', share: 0.7 }, { part: 'end', share: 0.2 }])
    expect(d[0]!.evidence).toEqual([{ video: 'v1', atS: 3, frames: [] }])
    // an unmeasured (default) value is never reported: the presenter's MEASURED presence per part stands instead
    const unmeasured = distributionsOf({ ...def, sourcing: { ...def.sourcing, distributions: { value, source: 'default', evidence: [] } } } as typeof def)
    expect(unmeasured).toEqual(distributionsOf({ ...def, sourcing: { ...def.sourcing, distributions: { value: [], source: 'default', evidence: [] } } } as typeof def))
    expect(unmeasured.every((x) => x.curve.length === 0 && x.byPart.every((b) => b.share !== 0.7))).toBe(true)
  })

  it('a setting is measured only when all its fields are, default when one is, else user', async () => {
    const t = await finished()
    const def = new CloneStore(t.dataDir, t.id).load('p4-style-definition.json', StyleDefinition)!
    const measuredPath = (['editing.meanShotS', 'presenter.angleCount'] as const)[0]
    expect(sourcedSetting({ key: 'k', value: 1, fields: [measuredPath] }, def).source).toBe(def.editing.meanShotS.source)
    expect(sourcedSetting({ key: 'k', value: 1, fields: ['editing.meanShotS', 'voice.voiceRef'] }, def).source).toBe('user')
    expect(sourcedSetting({ key: 'k', value: 1, fields: ['editing.meanShotS', 'no.such.field'] }, def).source).toBe('default')
    const many = sourcedSetting({ key: 'k', value: 1, fields: ['editing.meanShotS'] }, def)
    expect(many.evidence.length).toBeLessThanOrEqual(3)
    expect(ownerOf('director.meanShotS', ['director.plan', 'avatar.speak'])).toBe('director.plan')
    expect(ownerOf('music', ['sound.music'])).toBe('sound.music')
    expect(ownerOf('recipe.mix', ['director.plan'])).toBe('recipe')
    expect(ownerOf('clipShare', ['director.plan'])).toBe('recipe')
  })

  it('the builder is pure on the loaded artefacts (same inputs, same pipeline)', async () => {
    const t = await finished()
    const inputs = loadReverseInputs(new CloneStore(t.dataDir, t.id))
    expect(buildReversePipeline(inputs, 'x')).toEqual(buildReversePipeline(inputs, 'x'))
  })
})

describe('transforming a pipeline', () => {
  it('translate: a new clone folder, the voice re-picked in the new language, the analyses reused, not proven', async () => {
    const t = await finished()
    const before = readdirCount(t.dataDir)
    const { id } = await t.reverse.transform(t.id, { action: 'translate', language: 'en' })
    expect(id).not.toBe(t.id)
    expect(readdirCount(t.dataDir)).toBe(before + 1)
    const p = ReversePipeline.parse(t.reverse.result(id))
    expect(p.derivedFrom).toMatchObject({ pipelineId: t.id, transform: { action: 'translate', language: 'en' } })
    expect(p.state).toBe('not-proven')
    expect(p.proof).toBeNull()
    expect(p.request.action).toBe('translate')
    expect(p.request.language).toBe('en')
    const store = new CloneStore(t.dataDir, id)
    const def = store.load('p4-style-definition.json', StyleDefinition)!
    const source = new CloneStore(t.dataDir, t.id).load('p4-style-definition.json', StyleDefinition)!
    expect(def.version).toBe(source.version + 1)
    expect(def.voice.language).toMatchObject({ value: 'en', source: 'user' })
    expect(def.voice.voiceRef.note).toMatch(/re-picked for en/)
    expect(def.channel.language).toBe('en')
    expect(p.graph.nodes.flatMap((n) => n.settings).find((s) => s.key === 'recipe.language')?.value).toBe('en')
    // the analyses were copied, not paid again
    expect(store.load('p2-analysis-v1.json', VideoAnalysis)?.cloneId).toBe(id)
    expect(store.spent()).toBe(0)
    expect(JSON.parse(readFileSync(store.file('p0-brief.json'), 'utf8'))).toMatchObject({ intent: 'translate', language: 'en', sourceLanguage: 'fr' })
    expect(t.reverse.list().find((x) => x.id === id)?.derivedFrom).toBe(t.id)
    await expect(t.reverse.transform(t.id, { action: 'translate', language: 'fr' })).rejects.toThrow(/already in fr/)
  })

  it('bend: the field changes, its setting says « user »; an unknown path is refused', async () => {
    const t = await finished()
    const { id } = await t.reverse.transform(t.id, { action: 'bend', instructions: 'plus nerveux', bend: [{ field: 'editing.meanShotS', value: 2.5 }] })
    const p = ReversePipeline.parse(t.reverse.result(id))
    const s = p.graph.nodes.flatMap((n) => n.settings).find((x) => x.key === 'director.meanShotS')!
    expect(s).toMatchObject({ value: 2.5, source: 'user' })
    const def = new CloneStore(t.dataDir, id).load('p4-style-definition.json', StyleDefinition)!
    expect(def.editing.meanShotS.note).toMatch(/bent by the user/)
    await expect(t.reverse.transform(t.id, { action: 'bend', bend: [{ field: 'editing.nothing', value: 1 }] })).rejects.toThrow(/not a Style Definition field/)
    await expect(t.reverse.transform(t.id, { action: 'bend', bend: [{ field: 'editing.meanShotS', value: 'fast' }] })).rejects.toThrow(/not valid/)
  })

  it('adapt keeps the style and his words; mix takes the other pipeline’s sections per axis', async () => {
    const t = await finished()
    const adapted = await t.reverse.transform(t.id, { action: 'adapt', instructions: 'mon sujet : la cuisine japonaise' })
    const a = ReversePipeline.parse(t.reverse.result(adapted.id))
    expect(JSON.parse(readFileSync(new CloneStore(t.dataDir, adapted.id).file('p0-brief.json'), 'utf8')).said.at(-1)).toMatch(/cuisine japonaise/)
    expect(a.request.instructions).toMatch(/cuisine japonaise/)
    const other = await t.reverse.transform(t.id, { action: 'bend', bend: [{ field: 'sound.loudnessLufs', value: -20 }] })
    const mixed = await t.reverse.transform(t.id, { action: 'mix', mixWith: { pipelineId: other.id, axes: ['sound'] } })
    const m = ReversePipeline.parse(t.reverse.result(mixed.id))
    expect(m.graph.nodes.flatMap((n) => n.settings).find((s) => s.key === 'sound.loudnessLufs')).toMatchObject({ value: -20, source: 'user' })
    expect(m.request.links.length).toBe(2)
    const def = new CloneStore(t.dataDir, mixed.id).load('p4-style-definition.json', StyleDefinition)!
    expect(def.sound.music.note).toMatch(new RegExp(`taken from pipeline ${other.id}`))
    await expect(t.reverse.transform(t.id, { action: 'mix', mixWith: { pipelineId: t.id, axes: ['sound'] } })).rejects.toThrow(/itself/)
  })

  it('prove: a transformed pipeline runs its rounds within the budget given and can end proven', async () => {
    const t = await finished()
    const { id } = await t.reverse.transform(t.id, { action: 'bend', bend: [{ field: 'sound.loudnessLufs', value: -16 }] })
    const st = t.reverse.prove(id, 10)
    expect(st.budgetUsd).toBe(10)
    await t.reverse.settled(id)
    const p = ReversePipeline.parse(t.reverse.result(id))
    expect(new CloneStore(t.dataDir, id).list('p2-analysis-').length).toBe(5)
    expect(['proven', 'not-proven']).toContain(p.state)
    expect(p.proof).not.toBeNull()
    expect(p.spentUsd).toBeGreaterThan(0)
    expect(p.spentUsd).toBeLessThanOrEqual(10)
  })
})

describe('the reverse API', () => {
  it('is on the contract and checks its arguments with the schemas', async () => {
    for (const m of REVERSE_METHODS) expect(API_METHODS).toContain(m)
    const t = setup()
    const api = reverseApi({ clones: t.engine })
    expect(() => api['reverse.start']({ links: [], testBudgetUsd: 5 })).toThrow(/Argument invalide \(request\)/)
    expect(() => api['reverse.start']({ links: [{ url: t.ch.url }], testBudgetUsd: 5000 })).toThrow(/request/)
    expect(() => api['reverse.status']('../x')).toThrow(/Argument invalide \(id\)/)
    expect(() => api['reverse.prove']('x', -1)).toThrow(/budgetUsd/)
    await expect(Promise.resolve().then(() => api['reverse.transform']('x', { action: 'nope' } as never))).rejects.toThrow(/transform/)
    const { id } = api['reverse.start']({ links: [{ url: t.ch.url }], testBudgetUsd: 10 }) as { id: string }
    await t.engine.settled(id)
    expect(existsSync(path.join(t.dataDir, 'clones', id, REVERSE_FILES.request))).toBe(true)
    expect((api['reverse.result'](id) as ReversePipeline).state).toBe('proven')
    expect((api['reverse.list']() as unknown[]).length).toBe(1)
  })
})

function readdirCount(dataDir: string): number {
  return new CloneEngine({ dataDir, services: () => { throw new Error('no') }, notify: () => {}, now: () => new Date() }).list().length
}
