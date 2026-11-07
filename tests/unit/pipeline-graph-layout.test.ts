// The drawing of a pipeline graph (production-13, docs/specs/production-model.md §11): stages as columns in order, every
// line going left to right, the parallel branches after the director side by side in one column, no two bricks on top of
// each other; and a brick's live state during a run put together from its engine nodes.
import { describe, expect, it } from 'vitest'
import { avatarBase, fromBase, pipelineGraph, technologyRegistry, STAGES } from '../../src/engine/technologies'
import { brickStates, withRunGates } from '../../src/renderer/screens/production/graphe/graph-run'
import { NODE_H, NODE_W, layoutGraph } from '../../src/renderer/screens/production/graphe/graph-layout'
import type { RunNode, RunNodeState } from '../../src/shared/runs'

const reg = technologyRegistry()
const graph = pipelineGraph({ ...fromBase(avatarBase), options: { music: 'none' } }, reg)
const layout = layoutGraph(graph)
const at = (id: string) => layout.nodes.get(id)!

describe('the layout of avatar@1', () => {
  it('places every brick, the stages in order, the inputs on the left and the finished video on the right', () => {
    expect(layout.nodes.size).toBe(graph.nodes.length)
    expect(layout.stages.map((s) => s.stage)).toEqual(STAGES.filter((s) => graph.nodes.some((n) => n.stage === s)))
    for (let i = 1; i < layout.stages.length; i++) expect(layout.stages[i]!.x).toBeGreaterThan(layout.stages[i - 1]!.x + layout.stages[i - 1]!.width)
    for (const n of graph.nodes) {
      const s = layout.stages.find((b) => b.stage === n.stage)!
      expect(at(n.id).x).toBeGreaterThanOrEqual(s.x)
      expect(at(n.id).x + NODE_W).toBeLessThanOrEqual(s.x + s.width)
    }
    expect(layout.side!.x).toBeLessThan(Math.min(...[...layout.nodes.values()].map((p) => p.x)))
    expect(layout.end!.x).toBeGreaterThan(Math.max(...[...layout.nodes.values()].map((p) => p.x)))
    expect(layout.sideEdges.map((e) => e.to)).toContain('idea.brief')
  })

  it('draws every line left to right, one per pair of bricks', () => {
    for (const e of layout.edges) expect(at(e.to).x).toBeGreaterThan(at(e.from).x)
    expect(layout.edges.length).toBe(new Set(graph.edges.map((e) => `${e.from}>${e.to}`)).size)
    const voiceToAvatar = layout.edges.find((e) => e.from === 'voice.tts' && e.to === 'avatar.speak')!
    expect(voiceToAvatar.slots.sort()).toEqual(['voice'])
    // the words' times come from « Minutage des mots » (record 0059)
    const timingToAvatar = layout.edges.find((e) => e.from === 'words.align' && e.to === 'avatar.speak')!
    expect(timingToAvatar.slots).toEqual(['words'])
  })

  it('stacks the parallel branches in one column and chains the dependent ones', () => {
    expect(at('visuals.fulfil').x).toBe(at('avatar.speak').x)
    expect(at('captions.make').x).toBe(at('sound.music').x)
    expect(at('render.assemble').x).toBeGreaterThan(at('captions.make').x)
    expect(at('script.sponsor').x).toBeGreaterThan(at('script.write').x)
    expect(at('idea.brief').x).toBe(at('idea.support').x)
  })

  it('never puts two bricks on top of each other', () => {
    const all = [...layout.nodes.values()]
    for (const a of all) for (const b of all) if (a !== b && a.x === b.x) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(NODE_H)
  })

  it('dashes the line to a brick an option removed', () => {
    expect(layout.edges.find((e) => e.from === 'sound.music' && e.to === 'render.assemble')?.off).toBe(true)
    expect(layout.edges.find((e) => e.from === 'voice.tts' && e.to === 'render.assemble')?.off).toBe(false)
  })
})

describe('the bands, top to bottom, for a narrow canvas', () => {
  const v = layoutGraph(graph, 'vertical')
  const vat = (id: string) => v.nodes.get(id)!

  it('keeps the same bricks and steps, turned a quarter: the flow goes down, parallel branches side by side', () => {
    expect(v.orientation).toBe('vertical')
    expect([...v.nodes.keys()].sort()).toEqual([...layout.nodes.keys()].sort())
    for (const [id, p] of v.nodes) expect(p.col).toBe(at(id).col)
    for (const e of v.edges) expect(vat(e.to).y).toBeGreaterThan(vat(e.from).y)
    expect(vat('visuals.fulfil').y).toBe(vat('avatar.speak').y)
    expect(vat('visuals.fulfil').x).not.toBe(vat('avatar.speak').x)
    expect(v.side!.y + v.side!.height).toBeLessThan(Math.min(...[...v.nodes.values()].map((p) => p.y)))
    expect(v.end!.y).toBeGreaterThan(Math.max(...[...v.nodes.values()].map((p) => p.y)))
    for (let i = 1; i < v.stages.length; i++) expect(v.stages[i]!.y).toBeGreaterThan(v.stages[i - 1]!.y + v.stages[i - 1]!.height)
  })

  it('fits the editor’s column, where the columns would not', () => {
    expect(v.width).toBeLessThan(900)
    expect(layout.width).toBeGreaterThan(1500)
  })

  it('never puts two bricks on top of each other', () => {
    const all = [...v.nodes.values()]
    for (const a of all) for (const b of all) if (a !== b && a.y === b.y) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(NODE_W)
  })
})

const node = (nodeId: string, state: RunNodeState, extra: Partial<RunNode> = {}): RunNode => ({
  nodeId,
  position: 0,
  type: 'x',
  label: nodeId,
  state,
  progress: 0,
  step: null,
  quoteCredits: 0,
  credits: 0,
  engines: [],
  fingerprint: null,
  error: null,
  gate: 'none',
  gateKind: 'none',
  changeNote: null,
  startedAt: null,
  finishedAt: null,
  ...extra
})

describe('a brick during a run', () => {
  it('puts the states of its nodes together', () => {
    const st = (states: [string, RunNodeState][]) => brickStates(graph, states.map(([id, s]) => node(id, s))).get('director.plan')?.state
    expect(st([['beats', 'done'], ['director', 'pending']])).toBe('running')
    expect(st([['beats', 'done'], ['director', 'done']])).toBe('done')
    expect(st([['beats', 'cached'], ['director', 'cached']])).toBe('cached')
    expect(st([['beats', 'done'], ['director', 'error']])).toBe('error')
    expect(st([['beats', 'pending'], ['director', 'pending']])).toBe('pending')
    expect(st([['beats', 'done'], ['director', 'waiting_gate']])).toBe('waiting_gate')
  })

  it('adds its credits, opens the node that waits, and takes its gate from the run', () => {
    const nodes = [node('idea', 'waiting_gate', { quoteCredits: 2, credits: 1, gateKind: 'owner' }), node('beats', 'done', { credits: 3 }), node('director', 'running', { progress: 0.5, quoteCredits: 4 })]
    const s = brickStates(graph, nodes)
    expect(s.get('idea.brief')).toMatchObject({ state: 'waiting_gate', pick: 'idea', credits: 1, quote: 2 })
    expect(s.get('director.plan')).toMatchObject({ state: 'running', progress: 0.75, credits: 3, quote: 4, pick: 'beats' })
    expect(s.has('sound.music')).toBe(false)
    const gated = withRunGates(graph, [node('thumbnails', 'pending', { gateKind: 'none' }), node('idea', 'pending', { gateKind: 'owner' })])
    expect(gated.nodes.find((n) => n.id === 'thumbnail.make')?.gate).toBe(false)
    expect(gated.nodes.find((n) => n.id === 'idea.brief')?.gate).toBe(true)
  })
})
