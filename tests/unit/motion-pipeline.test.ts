// The motion step of a drawn pipeline (src/engine/pipelines/from-drawing.ts): it becomes `motion.render`, the director gets the budget (the drawn
// share) and the script (the turns of a conversation), the render gets the files; a drawing without a motion step compiles as it always did.
import { describe, expect, it } from 'vitest'
import { productionRegistry } from '../../src/engine/nodes'
import { MOTION_CHAT_DRAWING, MOTION_FILM_DRAWING } from '../../src/engine/pipelines/motion-demo'
import { pipelineFromDrawing } from '../../src/engine/pipelines/from-drawing'
import { validatePipeline } from '../../src/engine/validate'
import type { DrawingStep, PipelineDrawing } from '../../src/shared/pipeline-drawing'

const STYLE = ['language', 'voice', 'pace', 'captions', 'burn', 'speakers']
const step = (id: string, kind: DrawingStep['kind'], label: string, more: Partial<DrawingStep> = {}): DrawingStep => ({ id, kind, label, runner: 'agent', ...more })
const node = (c: ReturnType<typeof pipelineFromDrawing>, id: string) => c.pipeline.nodes.find((n) => n.id === id)

describe('a motion step in a drawing', () => {
  it('the documentary of the demo: motion.render after the visuals, the share is the director’s budget, the render lays its files', () => {
    const c = pipelineFromDrawing(MOTION_FILM_DRAWING, { minutes: 0.33 })
    expect(validatePipeline(c.pipeline, productionRegistry(), { styleFields: STYLE }).ok).toBe(true)
    expect(c.pipeline.nodes.map((n) => n.id)).toEqual(['research', 'script', 'voice', 'beats', 'director', 'visuals', 'motion', 'captions', 'sound', 'render', 'qc'])
    expect(node(c, 'motion')).toMatchObject({ type: 'motion.render@1', in: { plan: 'director.plan' } })
    expect(node(c, 'director')?.params).toMatchObject({ motion: { share: 0.6 } })
    expect(node(c, 'director')?.in).toMatchObject({ script: 'script.text' })
    expect(node(c, 'render')?.in).toMatchObject({ motion: 'motion.graphics', images: 'visuals.images' })
    expect(c.mapping['f-motion']).toBe('motion')
    expect(c.notes.filter((n) => n.code === 'not_executable')).toEqual([])
  })

  it('the conversation short: 9:16 for the director, motion over a gameplay background, no share asked for means the director’s default', () => {
    const c = pipelineFromDrawing(MOTION_CHAT_DRAWING, { minutes: 0.25 })
    expect(validatePipeline(c.pipeline, productionRegistry(), { styleFields: STYLE }).ok).toBe(true)
    expect(c.pipeline.format).toMatchObject({ aspect: '9:16' })
    expect(node(c, 'director')?.params).toMatchObject({ aspect: '9:16', motion: {} })
    expect(node(c, 'render')?.in).toMatchObject({ background: 'background.layer', motion: 'motion.graphics' })
    // motion.render reads the plan, whose size is the film's: it has no aspect to set (and none to get wrong)
    expect(node(c, 'motion')?.params).toBeUndefined()
  })

  it('shares of several motion steps add up and stay under 80 %', () => {
    const many: PipelineDrawing = { name: 'm', steps: [step('i', 'idea', 'Sujet'), step('a', 'motion', 'Cartes', { share: 50 }), step('b', 'motion', 'Chiffres', { share: 60 })] }
    expect(node(pipelineFromDrawing(many), 'director')?.params).toMatchObject({ motion: { share: 0.8 } })
  })

  it('a drawing without a motion step compiles as it always did: no motion node, nothing extra on the director or the render', () => {
    const plain: PipelineDrawing = { name: 'p', steps: [step('i', 'idea', 'Sujet'), step('s', 'stock', 'Images', { share: 100 }), step('e', 'edit', 'Montage')] }
    const c = pipelineFromDrawing(plain)
    expect(node(c, 'motion')).toBeUndefined()
    expect(node(c, 'director')?.in).toEqual({ beats: 'beats.beats', words: 'voice.words', outline: 'script.outline', brief: 'research.brief' })
    expect(JSON.stringify(node(c, 'director')?.params)).not.toContain('motion')
    expect(node(c, 'render')?.in).not.toHaveProperty('motion')
  })
})
