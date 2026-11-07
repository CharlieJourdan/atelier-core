// Lot Z1 (analysis screens): the pure parts of the renderer: the graph layout of a pipeline, the gauge colour bands and
// arc, the coloured time band, the library grouping.
import { describe, expect, it } from 'vitest'
import { simpleVideoPipeline } from '../../src/engine/pipelines/simple-video'
import { bandSegments, clock, toneShares } from '../../src/renderer/screens/analysis/analyser/band'
import { arcPath, gaugeTone, polar } from '../../src/renderer/screens/analysis/shared/gauge-view'
import { COL_GAP, NODE_H, NODE_W, kindOfType, layoutGraph, parsePipelineDoc, refSource, type GraphNode } from '../../src/renderer/screens/analysis/shared/graph-layout'
import { groupByChannel } from '../../src/renderer/screens/analysis/pipeline/PipelineScreen'
import type { LibraryPipelineRow, TimelineSegment } from '../../src/shared/analysis'

const doc = () => {
  const parsed = parsePipelineDoc(JSON.stringify(simpleVideoPipeline(8)))
  if (!parsed) throw new Error('template did not parse')
  return parsed
}
const overlap = (a: GraphNode, b: GraphNode) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('pipeline graph layout', () => {
  it('puts every node one column right of its deepest parent', () => {
    const layout = layoutGraph(doc())
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    expect(byId.get('$inputs.topic')?.depth).toBe(0)
    expect(byId.get('research')?.depth).toBe(1)
    expect(byId.get('script')?.depth).toBe(2)
    expect(byId.get('voice')?.depth).toBe(3)
    // render joins the visuals, captions and sound branches; the package comes after it
    const d = (id: string) => (byId.get(id) as GraphNode).depth
    for (const branch of ['visuals', 'captions', 'sound']) expect(d('render')).toBeGreaterThan(d(branch))
    expect(d('package')).toBeGreaterThan(d('render'))
    for (const e of layout.edges) {
      expect((byId.get(e.from) as GraphNode).depth).toBeLessThan((byId.get(e.to) as GraphNode).depth)
      expect((byId.get(e.from) as GraphNode).x + NODE_W + COL_GAP).toBeLessThanOrEqual((byId.get(e.to) as GraphNode).x)
    }
  })

  it('never overlaps two nodes and keeps everything inside the canvas', () => {
    const layout = layoutGraph(doc())
    expect(layout.nodes).toHaveLength(doc().nodes.length + doc().inputs.length)
    for (const a of layout.nodes) {
      expect(a.x).toBeGreaterThanOrEqual(0)
      expect(a.y).toBeGreaterThanOrEqual(0)
      expect(a.x + a.w).toBeLessThanOrEqual(layout.width)
      expect(a.y + a.h).toBeLessThanOrEqual(layout.height)
      expect(a.h).toBe(NODE_H)
      for (const b of layout.nodes) if (a !== b) expect(overlap(a, b), `${a.id} / ${b.id}`).toBe(false)
    }
  })

  it('draws one edge per wired reference, none for $style, with finite paths', () => {
    const d = doc()
    const wired = d.nodes.flatMap((n) => Object.values(n.in ?? {})).filter((r) => !r.startsWith('$style.')).length
    const layout = layoutGraph(d)
    expect(layout.edges).toHaveLength(wired)
    for (const e of layout.edges) expect(e.path).toMatch(/^M [\d.]+ [\d.]+ C [\d., ]+$/)
    expect(layout.edges.some((e) => e.from === '$inputs.topic' && e.to === 'research')).toBe(true)
  })

  it('survives a cycle and an unknown reference without hanging', () => {
    const cyc = parsePipelineDoc(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'x.y@1', in: { p: 'b.out' } },
          { id: 'b', type: 'x.y@1', in: { p: 'a.out', q: 'ghost.out' } }
        ]
      })
    )
    expect(cyc).not.toBeNull()
    const layout = layoutGraph(cyc as NonNullable<typeof cyc>)
    expect(layout.nodes).toHaveLength(2)
    for (const a of layout.nodes) for (const b of layout.nodes) if (a !== b) expect(overlap(a, b)).toBe(false)
  })

  it('refuses text that is not a pipeline document', () => {
    expect(parsePipelineDoc('pas du json')).toBeNull()
    expect(parsePipelineDoc('{"nodes": 3}')).toBeNull()
    expect(parsePipelineDoc('[]')).toBeNull()
    const empty = layoutGraph({ name: '', minutes: null, budgetDefault: null, inputs: [], nodes: [] })
    expect(empty.nodes).toEqual([])
  })

  it('reads kinds from the node family and sources from references', () => {
    expect(kindOfType('voice.tts@1')).toBe('audio')
    expect(kindOfType('render.assemble@1')).toBe('output')
    expect(kindOfType('script.write@1')).toBe('text')
    expect(kindOfType('mystere.node@2')).toBe('other')
    expect(refSource('script.text')).toBe('script')
    expect(refSource('$inputs.topic')).toBe('$inputs.topic')
    expect(refSource('$style.voice')).toBeNull()
  })
})

describe('gauge view', () => {
  it('colours by tier: 80 green, 50 blue, 30 amber, below red', () => {
    expect(gaugeTone(100)).toBe('ok')
    expect(gaugeTone(85)).toBe('ok')
    expect(gaugeTone(80)).toBe('ok')
    expect(gaugeTone(79)).toBe('info')
    expect(gaugeTone(62)).toBe('info')
    expect(gaugeTone(50)).toBe('info')
    expect(gaugeTone(49)).toBe('warn')
    expect(gaugeTone(34)).toBe('warn')
    expect(gaugeTone(30)).toBe('warn')
    expect(gaugeTone(29)).toBe('err')
    expect(gaugeTone(0)).toBe('err')
  })

  it('draws an arc that grows with the fraction and ends where the maths say', () => {
    const full = arcPath(100, 100, 80, 1)
    expect(full).toContain('A 80 80 0 1 1')
    expect(arcPath(100, 100, 80, 0.25)).toContain('A 80 80 0 0 1')
    expect(arcPath(100, 100, 80, 0)).toMatch(/^M ([\d.]+) ([\d.]+) A 80 80 0 0 1 \1 \2$/)
    expect(arcPath(100, 100, 80, Number.NaN)).toBe(arcPath(100, 100, 80, 0))
    expect(arcPath(100, 100, 80, 7)).toBe(full)
    const end = polar(100, 100, 80, 150 + 240)
    expect(full.endsWith(`${end.x} ${end.y}`)).toBe(true)
  })
})

describe('time band', () => {
  const segs: TimelineSegment[] = [
    { startS: 0, endS: 60, component: 'stock', note: 'décor' },
    { startS: 60, endS: 120, component: 'gameplay', note: 'partie' },
    { startS: 120, endS: 180, component: 'clip', note: 'extrait' }
  ]
  const state = (answers: Record<string, boolean> = {}) => ({ mode: 'usage_max' as const, answers, replace: {} })

  it('lays the segments out over 100 % and colours them by what we can remake', () => {
    const band = bandSegments(segs, state())
    expect(band.map((b) => b.tone)).toEqual(['green', 'red', 'red'])
    expect(band.reduce((s, b) => s + b.width, 0)).toBeCloseTo(100, 6)
    expect(band[1]?.left).toBeCloseTo(33.333, 2)
  })

  it('moves the colours with the answers: footage gives green, a refusal gives the replacement', () => {
    expect(bandSegments(segs, state({ gameplay: true }))[1]).toMatchObject({ tone: 'green', footage: true, replaced: false })
    const no = bandSegments(segs, state({ gameplay: false }))[1]
    expect(no).toMatchObject({ replaced: true, by: 'stock' })
    expect(no?.tone).toBe('amber')
  })

  it('shares add up to one and the clock reads minutes and seconds', () => {
    const shares = toneShares(bandSegments(segs, state()))
    expect(shares.green + shares.amber + shares.red).toBeCloseTo(1, 6)
    expect(clock(75)).toBe('1:15')
    expect(clock(-3)).toBe('0:00')
    expect(clock(Number.NaN)).toBe('0:00')
    expect(bandSegments([], state())).toEqual([])
  })
})

describe('library grouping', () => {
  const row = (id: number, channelId: number | null, channelName: string | null): LibraryPipelineRow => ({
    id,
    name: `p${id}`,
    description: '',
    origin: 'own',
    channelId,
    channelName,
    isDefault: false,
    latestVersion: 1,
    example: false,
    updatedAt: '2026-10-20T10:00:00.000Z'
  })
  it('puts the pipelines without a channel first, then one group per channel', () => {
    const groups = groupByChannel([row(1, 5, 'Alpha'), row(2, null, null), row(3, 5, 'Alpha'), row(4, 6, 'Beta')])
    expect(groups.map((g) => g.channel)).toEqual([null, 'Alpha', 'Beta'])
    expect(groups[1]?.rows.map((r) => r.id)).toEqual([1, 3])
  })
})
