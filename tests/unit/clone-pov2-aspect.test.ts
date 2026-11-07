// moteur-pov-2 — the reference's frame format is measured and drives the render: a vertical 9:16 Short was rendered 16:9 because
// nothing measured its frame (the beta resume proof, 2026-11-04: layout 8).
import { describe, expect, it } from 'vitest'
import { withAtPath, type Sourced, type StyleDefinition } from '../../src/shared/clone'
import { frameOfLink, frameOfProbe } from '../../src/main/production/clone/analysis/frame'
import { allFramesArgs, frameSize } from '../../src/main/production/clone/analysis/frames'
import { deriveFields } from '../../src/main/production/clone/definition/derive'
import { MONDE_POV } from '../../src/main/production/clone/definition/fixtures/profiles'
import { runDefinition } from '../../src/main/production/clone/definition/fixtures/run'
import { compilePlan } from '../../src/main/production/clone/pipeline/compile'
import { settingsFromDefinition } from '../../src/main/production/clone/plan-rules'

const field = (out: ReturnType<typeof deriveFields>, f: string) => out.find((x) => x.field === f)

describe('the frame measure', () => {
  it('reads the display size from ffprobe, a ±90° rotation swaps the sides', () => {
    expect(frameOfProbe(JSON.stringify({ streams: [{ width: 1080, height: 1920 }] }))).toEqual({ width: 1080, height: 1920, from: 'file' })
    expect(frameOfProbe(JSON.stringify({ streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }] }))).toEqual({ width: 1080, height: 1920, from: 'file' })
    expect(frameOfProbe(JSON.stringify({ streams: [{ width: 1920, height: 1080, tags: { rotate: '180' } }] }))).toEqual({ width: 1920, height: 1080, from: 'file' })
    expect(frameOfProbe('{"streams":[]}')).toBeNull()
    expect(frameOfProbe('not json')).toBeNull()
  })

  it('a Shorts link says vertical when no file was served; another link says nothing', () => {
    expect(frameOfLink('https://www.youtube.com/shorts/abcdefghijk')).toEqual({ width: 1080, height: 1920, from: 'link' })
    expect(frameOfLink('https://www.youtube.com/watch?v=abcdefghijk')).toBeNull()
  })

  it('a vertical video is drawn upright for the vision passes (never shrunk inside a wide frame)', () => {
    expect(frameSize(true)).toEqual({ w: 216, h: 384 })
    expect(allFramesArgs('v.mp4', 'out', frameSize(true)).join(' ')).toContain('scale=216:384')
    expect(allFramesArgs('v.mp4', 'out').join(' ')).toContain('scale=384:216')
  })
})

describe('the format reaches the definition and the render', () => {
  it('a corpus of vertical videos measures 9:16 with evidence; a wide one 16:9; unmeasured says nothing', async () => {
    const r = await runDefinition(MONDE_POV)
    const tall = r.analyses.map((a) => ({ ...a, frame: { width: 1080, height: 1920, from: 'file' as const } }))
    const f = field(deriveFields(tall), 'editing.aspect')
    expect(f?.value).toBe('9:16')
    expect(f?.evidence[0]?.note).toContain('1080×1920')
    expect(field(deriveFields(r.analyses.map((a) => ({ ...a, frame: { width: 1920, height: 1080, from: 'file' as const } }))), 'editing.aspect')?.value).toBe('16:9')
    expect(field(deriveFields(r.analyses), 'editing.aspect')).toBeUndefined()
  })

  it('the recipe renders in the measured format', async () => {
    const { definition } = await runDefinition(MONDE_POV)
    const wide = compilePlan({ bricks: [], settings: settingsFromDefinition(definition) }, definition)
    expect(wide.format.aspect).toBe('16:9')
    const tallDef = withAtPath(definition, 'editing.aspect', { value: '9:16', source: 'measured', evidence: [{ video: 'v1', atS: 0, frames: ['f.jpg'] }] } as Sourced) as StyleDefinition
    const settings = settingsFromDefinition(tallDef)
    expect(settings.find((s) => s.key === 'recipe.aspect')?.value).toBe('9:16')
    expect(compilePlan({ bricks: [], settings }, tallDef).format.aspect).toBe('9:16')
  })
})
