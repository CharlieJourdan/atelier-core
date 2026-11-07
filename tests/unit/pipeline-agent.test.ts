// The agent that prepares and edits pipelines in the app (production-12, decisions 0024 and 0032), on a fake LLM: from a fake
// channel profile it proposes three variants whose costs come from the estimator (the Cloud's engines), drafting with the
// best tier; « moins cher » produces only valid operations and a lower average, saved as a new version once accepted; an
// invalid operation is refused with a typed error; a model without tools uses the fenced block; the team agents get the same
// tools; a pipeline serves several channels with their inputs pre-filled.
import { describe, expect, it } from 'vitest'
import { applyOps, avatarBase, optionProblem, technologyRegistry, type RecipeDoc } from '../../src/engine/technologies'
import { FakeProvider, type FakeReply } from '../../src/main/llm/fake'
import type { CompletionRequest } from '../../src/main/llm/types'
import { EyesStore } from '../../src/main/eyes/store'
import { ENGINES_CACHE_KEY } from '../../src/main/production/estimates'
import { callPipelineTool } from '../../src/main/production/pipeline-agent'
import { catalogue, roleTechnologies } from '../../src/main/orchestra/technologies'
import { PIPELINE_AGENT_METHODS, type EngineInfo, type RecipeDocument } from '../../src/shared/api'
import type { AnalysisResult } from '../../src/shared/video-analysis'
import { cloudHelpers } from './cloud-app-helpers'
import { memoryCore } from './helpers'

const ENGINES_MODULE = 'engines'
const engineMod = (await import(`../../cloud/src/providers/${ENGINES_MODULE}.ts`)) as {
  FAKE_ENGINES: unknown[]
  publishEngines(decls: unknown[], registry: { resolve(u: string): { status: 'real' | 'demo' } }, grid: unknown): EngineInfo[]
}
const cloudEngines = (): EngineInfo[] => {
  const t = cloudHelpers.makeCloud() as unknown as { cloud: { pricing: { current(): unknown } } }
  return engineMod.publishEngines(engineMod.FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, t.cloud.pricing.current())
}

const analysis = (cuts: number): AnalysisResult => ({
  summary: '',
  hook: { text: '', endsAtS: 10, technique: '' },
  structure: [{ fromS: 0, toS: 840, kind: 'body', summary: '' }],
  pacing: { cutsPerMinute: cuts, tempo: 'medium', notes: '' },
  shotTypes: ['talking presenter', 'AI generated image', 'stock footage'],
  onScreenText: [],
  music: { present: true, mood: '', notes: '' },
  callsToAction: [{ atS: 80, text: 'Code promo dans la description' }]
})

/** A core on a fake LLM, the Cloud's engines kept as if read once, and a channel with three analysed videos. */
function rig(responder: (req: CompletionRequest, i: number) => FakeReply | string, opts: { tools?: boolean } = {}) {
  const fake = new FakeProvider(responder)
  if (opts.tools === false) fake.acceptsTools = () => false
  const core = memoryCore({ chatProvider: () => fake })
  core.context.settings.set(ENGINES_CACHE_KEY, { at: '2026-11-01T10:00:00Z', engines: cloudEngines() as never })
  const channelId = Number(core.db.prepare("INSERT INTO channels (name, niche) VALUES ('Mamie cuisine', 'recettes de grand-mère')").run().lastInsertRowid)
  const eyes = new EyesStore(core.db)
  for (const n of [1, 2, 3]) {
    eyes.saveAnalysis({ channelId, sourceKey: 0, videoId: `v${n}`, url: `https://youtu.be/v${n}`, title: `Vidéo ${n}`, durationS: 840, outlier: false, analysis: analysis(14 + n), demo: false, analysedAt: `2026-10-0${n}T10:00:00Z` })
  }
  return { fake, core, api: core.api, channelId }
}

const reg = technologyRegistry()
const valid = (doc: RecipeDocument, ops: unknown[]): boolean => applyOps(doc as unknown as RecipeDoc, ops, reg, { checkOption: (o, v) => optionProblem(avatarBase.options, o, v) }).ok

const PROPOSAL = '```atelier-proposal\n{"summary": "Ta chaîne montre peu le présentateur et beaucoup d’images : je garde ça.", "why": {"faithful": "Comme tes vidéos.", "cheap": "Moins de clips.", "premium": "Les meilleurs moteurs."}}\n```'
const CHEAPER = [
  { op: 'setOption', option: 'quality.images', value: 'eco' },
  { op: 'setOption', option: 'clipShare', value: 0.05 },
  { op: 'setMix', kind: 'clipAi', share: 0.05 }
]

describe('pipelineAgent: the proposal', () => {
  it('from the channel profile: three variants priced by the estimator, the agent’s draft on the best tier', async () => {
    const { fake, api, channelId } = rig(() => ({ text: `J’ai regardé les variantes.\n${PROPOSAL}`, toolCalls: [{ name: 'pipeline_read', args: { variant: 'faithful' } }] }))
    const p = await api['pipelineAgent.propose']({ kind: 'channel', channelId }, { agent: true })
    expect(p.measured).toBe(3)
    expect(p.pricesAvailable).toBe(true)
    expect(p.variants.map((v) => v.kind)).toEqual(['faithful', 'cheap', 'premium'])
    expect(p.recommended).toBe('faithful')
    for (const v of p.variants) {
      const est = await api['estimates.pipeline'](v.doc)
      expect(v.perMinute?.avg).toBeCloseTo(est.perMinute.avg, 9)
      expect(v.fit).not.toBeNull()
    }
    const avg = p.variants.map((v) => v.perMinute?.avg ?? NaN)
    expect(avg[1]).toBeLessThan(avg[0] as number)
    expect(avg[0]).toBeLessThan(avg[2] as number)
    expect(p.draft?.summary).toContain('présentateur')
    expect(p.variants[1]?.why).toBe('Moins de clips.')
    expect(fake.calls[0]?.model).toBe('claude-opus-5-5')
    expect(fake.toolResults[0]).toMatchObject({ name: 'pipeline_read', isError: false })
    expect(fake.toolResults[0]?.text).toContain('quality.images = "standard"')
    // answering a question re-uses the draft: no new model call
    const again = await api['pipelineAgent.propose']({ kind: 'channel', channelId }, { answers: { script: 'import' }, draft: p.draft })
    expect(fake.calls).toHaveLength(1)
    expect(again.variants.every((v) => v.doc.options.script === 'import')).toBe(true)
  })

  it('a concept with no measured video: the base, the open questions, and the agent’s adjustments as operations', async () => {
    const { api } = rig(() => ({ text: PROPOSAL, toolCalls: [{ name: 'pipeline_propose', args: { variant: 'faithful', ops: [{ op: 'setOption', option: 'captions', value: true }], note: 'Sous-titres' } }] }))
    const p = await api['pipelineAgent.propose']({ kind: 'concept', text: 'Une grand-mère japonaise qui donne des astuces de rangement', language: 'fr' }, { agent: true })
    expect(p.measured).toBe(0)
    expect(p.variants[0]?.fit).toBeNull()
    expect(p.questions.map((q) => q.id)).toEqual(['script', 'sponsor', 'captions', 'presenter'])
    expect(p.variants[0]?.doc.options.captions).toBe(true)
    expect(p.variants[0]?.ops.at(-1)).toEqual({ op: 'setOption', option: 'captions', value: true })
    expect(p.variants[1]?.doc.options.captions).toBeUndefined()
  })

  it('the agent unavailable or failing: the code’s proposal, said plainly', async () => {
    const { api, channelId } = rig(() => ({ text: '', error: 'boom' }))
    const p = await api['pipelineAgent.propose']({ kind: 'channel', channelId }, { agent: true })
    expect(p.draft).toBeNull()
    expect(p.agentNote).toContain('boom')
    expect(p.variants).toHaveLength(3)
  })
})

describe('pipelineAgent: editing by conversation', () => {
  async function adopted(responder: (req: CompletionRequest, i: number) => FakeReply | string, opts: { tools?: boolean } = {}) {
    const r = rig(responder, opts)
    const p = await r.api['pipelineAgent.propose']({ kind: 'channel', channelId: r.channelId })
    const faithful = p.variants[0]
    if (!faithful) throw new Error('no variant')
    const d = r.api['pipelineAgent.adopt']({ doc: faithful.doc, kind: 'faithful', summary: 'Proposée pour Mamie cuisine.', channelIds: [r.channelId] })
    return { ...r, recipe: await d }
  }

  it('« moins cher » → only valid operations, a lower average, a new version once accepted', async () => {
    const { api, recipe, channelId, fake } = await adopted(() => ({ text: 'Je passe les images en éco et je réduis les clips.', toolCalls: [{ name: 'pipeline_propose', args: { ops: CHEAPER, note: 'Moins cher' } }] }))
    const t = await api['pipelineAgent.say'](recipe.id, 'moins cher', channelId)
    const pending = t.pending
    if (!pending) throw new Error(JSON.stringify(t.messages))
    expect(valid(recipe.doc, pending.ops)).toBe(true)
    expect(pending.perMinute?.after.avg).toBeLessThan(pending.perMinute?.before.avg as number)
    expect(pending.changes.map((c) => c.key ?? c.kind)).toEqual(expect.arrayContaining(['quality.images', 'clipShare', 'mix']))
    expect(pending.fit.before).not.toBeNull()
    expect(t.messages.map((m) => m.role)).toEqual(['agent', 'user', 'agent'])
    expect(t.messages[2]).toMatchObject({ changeId: pending.id, errors: [] })
    // the agent's prompt holds the pipeline and the conversation; the tools are the three pipeline tools
    expect(fake.calls[0]?.prompt).toContain('Pipeline « Avatar — Mamie cuisine »')
    expect(fake.calls[0]?.tools?.specs.map((s) => s.name)).toEqual(['pipeline_read', 'pipeline_try', 'pipeline_propose'])
    // nothing saved until accepted
    expect((await api['recipes.get'](recipe.id)).docVersion).toBe(1)
    const after = await api['pipelineAgent.accept'](recipe.id, pending.id)
    expect(after.pending).toBeNull()
    expect(after.version).toBe(2)
    expect(after.changes[0]).toMatchObject({ status: 'accepted', savedVersion: 2 })
    const saved = await api['recipes.get'](recipe.id)
    expect(saved.doc.options['quality.images']).toBe('eco')
    await expect(api['pipelineAgent.accept'](recipe.id, pending.id)).rejects.toThrow('n’attend plus')
  })

  it('an invalid operation is refused with a typed error: no pending change, the error shown', async () => {
    const bad = [{ op: 'setEngine', brick: 'avatar.speak', engine: 'image:nano-banana-2' }]
    const { api, recipe, fake } = await adopted(() => ({ text: 'Je change le moteur.', toolCalls: [{ name: 'pipeline_propose', args: { ops: bad, note: 'x' } }] }))
    const t = await api['pipelineAgent.say'](recipe.id, 'mets nano banana sur le présentateur')
    expect(t.pending).toBeNull()
    expect(fake.toolResults[0]).toMatchObject({ isError: true })
    expect(fake.toolResults[0]?.text).toContain('[engine_family] operation 1')
    expect(t.messages.at(-1)).toMatchObject({ role: 'agent', changeId: null, errors: [{ op: 0, code: 'engine_family' }] })
  })

  it('a model without tools proposes through the fenced block, checked the same way; rejecting keeps the version', async () => {
    const block = '```atelier-ops\n' + JSON.stringify({ ops: [{ op: 'setOption', option: 'captions', value: true }], note: 'Sous-titres' }) + '\n```'
    const { api, recipe, fake } = await adopted(() => `J’ajoute les sous-titres.\n${block}`, { tools: false })
    const t = await api['pipelineAgent.say'](recipe.id, 'ajoute des sous-titres')
    expect(fake.calls[0]?.tools).toBeUndefined()
    expect(fake.calls[0]?.system).toContain('atelier-ops')
    expect(t.pending?.ops).toEqual([{ op: 'setOption', option: 'captions', value: true }])
    // the price under the agent's words is the code's (parcours-utilisateur: « un peu » for ×3.7 seen live)
    expect(t.messages.at(-1)?.text).toMatch(/^J’ajoute les sous-titres\.\n\nPrix : /)
    const r = await api['pipelineAgent.reject'](recipe.id, t.pending?.id as number)
    expect(r.version).toBe(1)
    expect(r.changes[0]?.status).toBe('rejected')
  })

  // parcours-utilisateur, seen live: « une charte plus rouge » → `cardTheme: "red"` applied, priced, shown, then refused on « Accepter »
  it('a value a brick does not take never reaches the owner: refused at once, said plainly, the version kept', async () => {
    const block = '```atelier-ops\n' + JSON.stringify({ ops: [{ op: 'setSetting', brick: 'director.plan', key: 'cardTheme', value: 'red' }], note: 'Charte rouge' }) + '\n```'
    const { api, recipe } = await adopted(() => `Je passe les cartes en rouge.\n${block}`, { tools: false })
    const t = await api['pipelineAgent.say'](recipe.id, 'une charte plus rouge')
    expect(t.pending).toBeNull()
    expect(t.version).toBe(1)
    expect(t.messages.at(-1)?.text).toMatch(/^Ce changement n’est pas possible tel quel, rien n’a changé/)
  })

  it('the team agents get the same tools: their proposal waits for the owner in the pipeline’s conversation', async () => {
    const { core, recipe } = await adopted(() => 'ok')
    expect(roleTechnologies('pipeline_architect')).toEqual(expect.arrayContaining(['pipeline.read', 'pipeline.try', 'pipeline.propose']))
    expect(catalogue().find((c) => c.id === 'pipeline.propose')?.tool).toBe('pipeline_propose')
    const bench = await core.context.pipelineAgent.teamBench()
    expect(callPipelineTool(bench, 'pipeline_try', { pipeline: recipe.id, ops: [{ op: 'teleport' }] })).toMatchObject({ isError: true })
    const r = callPipelineTool(bench, 'pipeline_propose', { pipeline: recipe.id, ops: [{ op: 'setOption', option: 'music', value: 'library' }], note: 'Avec musique' })
    expect(r.isError).toBe(false)
    const t = await core.api['pipelineAgent.thread'](recipe.id)
    expect(t.pending).toMatchObject({ author: 'team', note: 'Avec musique' })
    // an option is stored as its value (its bricks follow at compile, decision 0027); one left at its default shows it
    expect(t.pending?.changes).toEqual([{ kind: 'option', key: 'music', before: 'none', after: 'library' }])
  })
})

describe('pipelineAgent: one pipeline, several channels', () => {
  it('assigns the pipeline to channels and pre-fills their inputs', async () => {
    const { api, channelId, core } = rig(() => 'ok')
    const other = Number(core.db.prepare("INSERT INTO channels (name) VALUES ('Mamie bricolage')").run().lastInsertRowid)
    core.db.prepare(`INSERT INTO channel_voices (channel_id, name, method, status, is_default, created_at, updated_at) VALUES (?, 'Mamie', 'design', 'active', 1, 'x', 'x')`).run(other)
    const p = await api['pipelineAgent.propose']({ kind: 'channel', channelId })
    const d = await api['pipelineAgent.adopt']({ doc: p.variants[0]?.doc as RecipeDocument, kind: 'faithful', channelIds: [channelId] })
    const view = await api['pipelineAgent.assign'](d.id, [channelId, other])
    expect(view.channels.map((c) => c.name)).toEqual(['Mamie cuisine', 'Mamie bricolage'])
    const inputs = view.channels[1]?.inputs ?? []
    expect(inputs.find((i) => i.input === 'voice')).toEqual({ input: 'voice', source: 'channel', value: 'Mamie' })
    expect(inputs.find((i) => i.input === 'presenter')).toEqual({ input: 'presenter', source: 'channel', value: null })
    expect((await api['recipes.channel'](other)).recipes['avatar-long']).toBe(d.id)
    const fewer = await api['pipelineAgent.assign'](d.id, [other])
    expect(fewer.channels.map((c) => c.channelId)).toEqual([other])
    expect(PIPELINE_AGENT_METHODS).toHaveLength(8)
  })
})
