// The published JSON Schema of `atelier.pipeline/1` (resources/schemas/atelier.pipeline-1.json) must stay equal to
// what the zod schema generates. Regenerate it with `npm run schemas` (this file, with ATELIER_WRITE_SCHEMAS=1).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PipelineSchema, pipelineJsonSchema } from '../../src/engine'
import { videoPipeline } from './engine-fakes'

const FILE = path.join(__dirname, '..', '..', 'resources', 'schemas', 'atelier.pipeline-1.json')
const generated = (): string => JSON.stringify(pipelineJsonSchema(), null, 2) + '\n'

describe('atelier.pipeline/1 JSON Schema', () => {
  it('the published file matches the zod schema', () => {
    if (process.env.ATELIER_WRITE_SCHEMAS === '1') {
      mkdirSync(path.dirname(FILE), { recursive: true })
      writeFileSync(FILE, generated())
    }
    expect(existsSync(FILE), 'run `npm run schemas`').toBe(true)
    expect(readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n'), 'out of date: run `npm run schemas`').toBe(generated())
  })

  it('describes the document: required fields, closed objects, the reference and type id patterns', () => {
    const s = pipelineJsonSchema() as {
      $schema: string
      required: string[]
      additionalProperties: boolean
      properties: { $schema: { const: string }; nodes: { items: { properties: { type: { pattern: string } } } } }
    }
    expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(s.required.sort()).toEqual(['$schema', 'budget', 'format', 'id', 'inputs', 'name', 'nodes', 'version'])
    expect(s.additionalProperties).toBe(false)
    expect(s.properties.$schema.const).toBe('atelier.pipeline/1')
    expect(new RegExp(s.properties.nodes.items.properties.type.pattern).test('voice.tts@1')).toBe(true)
    expect(PipelineSchema.safeParse(videoPipeline()).success).toBe(true)
  })
})
