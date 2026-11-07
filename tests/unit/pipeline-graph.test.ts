// The read-only graph of a pipeline (production-13, decision 0023, docs/specs/production-model.md §11): built from the
// compiled pipeline, the graph of `avatar@1` has one node per compiled brick and one edge per slot wired between two
// bricks; switching an option off greys exactly the bricks its operations remove (their edges dashed), and nothing the
// run does is drawn otherwise; gates, engines and styles are the compiler's.
import { describe, expect, it } from 'vitest'
import { avatarBase, compileRecipe, fromBase, pipelineGraph, techName, technologyRegistry, type RecipeDoc } from '../../src/engine/technologies'

const reg = technologyRegistry()
const avatar = (options: RecipeDoc['options'] = {}): RecipeDoc => ({ ...fromBase(avatarBase), options })

/** The (from, to, slot) triples the compiled pipeline wires between two different bricks, computed independently. */
function wiredSlots(doc: RecipeDoc): string[] {
  const c = compileRecipe(doc, reg)
  if (!c.ok) throw new Error('does not compile')
  const owner = new Map<string, string>()
  for (const b of c.doc.bricks) for (const n of reg.get(b.tech)!.nodes) owner.set(n.id, b.tech)
  const out = new Set<string>()
  for (const n of c.pipeline.nodes) {
    for (const ref of Object.values(n.in ?? {})) {
      if (ref.startsWith('$')) continue
      const [node] = ref.split('.')
      const from = owner.get(node!)
      const to = owner.get(n.id)!
      if (!from || from === to) continue
      const slot = Object.entries(reg.get(from)!.provides).find(([, r]) => r === ref)![0]
      out.add(`${techName(from as `${string}@${number}`)}>${techName(to as `${string}@${number}`)}:${slot}`)
    }
  }
  return [...out].sort()
}

const active = (g: ReturnType<typeof pipelineGraph>) => g.nodes.filter((n) => n.off === null)
const edgeKeys = (g: ReturnType<typeof pipelineGraph>, off: boolean) => g.edges.filter((e) => e.off === off).map((e) => `${e.from}>${e.to}:${e.slot}`).sort()

describe('the graph of avatar@1', () => {
  const doc = avatar()
  const g = pipelineGraph(doc, reg)
  const compiled = compileRecipe(doc, reg)
  if (!compiled.ok) throw new Error('avatar@1 does not compile')

  it('has one node per compiled brick, in the compiled order, each with its pipeline nodes', () => {
    expect(g.ok).toBe(true)
    expect(active(g).map((n) => n.tech)).toEqual(compiled.doc.bricks.map((b) => b.tech))
    const allNodes = active(g).flatMap((n) => n.nodeIds).sort()
    expect(allNodes).toEqual(compiled.pipeline.nodes.map((n) => n.id).sort())
  })

  it('has one edge per wired slot, and none more', () => {
    expect(edgeKeys(g, false)).toEqual(wiredSlots(doc))
    // the sponsor mentions replace the script: the voice reads the script from them, not from the writer
    expect(edgeKeys(g, false)).toContain('script.sponsor>voice.tts:script')
    expect(edgeKeys(g, false)).not.toContain('script.write>voice.tts:script')
    // the parallel branches after the director
    for (const b of ['visuals.fulfil', 'avatar.speak', 'captions.make', 'sound.music']) expect(edgeKeys(g, false)).toContain(`director.plan>${b}:${b === 'visuals.fulfil' || b === 'avatar.speak' ? 'genlist' : 'plan'}`)
  })

  it('takes gates, engines and styles from the compiler', () => {
    const by = new Map(g.nodes.map((n) => [n.id, n]))
    const gated = compiled.pipeline.nodes.filter((n) => n.gate === 'owner').map((n) => n.id)
    expect(g.nodes.filter((n) => n.gate).flatMap((n) => n.nodeIds).filter((id) => gated.includes(id)).sort()).toEqual([...gated].sort())
    expect(by.get('idea.brief')?.gate).toBe(true)
    expect(by.get('thumbnail.make')?.gate).toBe(true)
    expect(by.get('voice.tts')).toMatchObject({ engine: 'voice:ai33', engineDefault: false, fallbacks: ['voice:minimax-28-hd'] })
    expect(by.get('avatar.speak')).toMatchObject({ engine: compiled.pins['avatar.speak']?.engine, style: 'presenter-studio' })
    expect(by.get('visuals.fulfil')?.style).toBe('phone-real')
    expect(by.get('render.assemble')?.engine).toBeNull()
    expect(g.output).toBe('package.youtube')
    expect(g.inputs.find((i) => i.id === 'sponsor')?.source).toBe('channel')
  })

  it('shows the fact check and the chapter marks (production-9), off by default, greyed', () => {
    expect(g.nodes.filter((n) => n.off).map((n) => [n.id, n.off?.option])).toEqual([
      ['script.factcheck', 'factcheck'],
      ['edit.chapters', 'chapters']
    ])
    expect(g.edges.filter((e) => e.off).every((e) => ['script.factcheck', 'edit.chapters'].includes(e.from) || ['script.factcheck', 'edit.chapters'].includes(e.to))).toBe(true)
    expect(g.edges.some((e) => e.off)).toBe(true)
  })
})

describe('an option switched off', () => {
  // everything on: the fact check and the chapter marks (production-9) are off by default
  const ALL_ON = { factcheck: true, chapters: true }
  const removedBy = (options: RecipeDoc['options']): string[] => {
    const before = pipelineGraph(avatar(ALL_ON), reg)
    const after = pipelineGraph(avatar({ ...ALL_ON, ...options }), reg)
    const was = new Set(active(before).map((n) => n.id))
    const still = new Set(active(after).map((n) => n.id))
    const removed = [...was].filter((id) => !still.has(id)).sort()
    // exactly those are greyed, by that option
    expect(after.nodes.filter((n) => n.off).map((n) => n.id).sort()).toEqual(removed)
    for (const n of after.nodes.filter((x) => x.off)) expect(n.off?.option).toBe(Object.keys(options)[0])
    // and the active graph is still the compiled one
    expect(edgeKeys(after, false)).toEqual(wiredSlots(avatar({ ...ALL_ON, ...options })))
    return removed
  }

  it('greys exactly the bricks its operations remove', () => {
    expect(removedBy({ music: 'none' })).toEqual(['sound.music'])
    expect(removedBy({ sponsor: 'off' })).toEqual(['edit.sponsor', 'script.sponsor'])
    expect(removedBy({ factcheck: false })).toEqual(['script.factcheck'])
    expect(removedBy({ chapters: false })).toEqual(['edit.chapters'])
  })

  it('draws the removed branch dashed, where it would plug in', () => {
    const g = pipelineGraph(avatar({ music: 'none', ...ALL_ON }), reg)
    const dashed = edgeKeys(g, true)
    expect(dashed).toContain('sound.music>render.assemble:music')
    expect(dashed.every((k) => k.includes('sound.music'))).toBe(true)
    expect(g.nodes.find((n) => n.id === 'sound.music')?.gate).toBe(false)
  })

  it('does not count a swap as an option off (the script imported or written)', () => {
    const g = pipelineGraph(avatar({ script: 'import', ...ALL_ON }), reg)
    expect(g.nodes.filter((n) => n.off).map((n) => n.id)).toEqual([])
    expect(active(g).some((n) => n.id === 'script.import')).toBe(true)
  })

  it('a pipeline that does not compile has no graph, only its problems', () => {
    const g = pipelineGraph({ ...avatar(), bricks: avatar().bricks.filter((b) => !b.tech.startsWith('render.')) }, reg)
    expect(g.ok).toBe(false)
    expect(g.nodes).toEqual([])
    expect(g.errors.map((e) => e.code)).toContain('no_video')
  })
})
