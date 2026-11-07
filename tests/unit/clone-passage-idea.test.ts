// The passage idea a round sends to the app stays within the app's limits (title 200, idea 2000 characters): a long measured
// outline (Markets of the Past, the reverse-pipeline proof of 2026-11-06) made the app refuse the round.
import { describe, expect, it } from 'vitest'
import { IDEA_MAX_CHARS, passageIdea } from '../../src/main/production/clone/compare/runner'
import { definitionDefaults } from '../../src/main/production/clone/definition-defaults'

describe('passageIdea', () => {
  it('keeps the essentials and fits 2000 characters whatever the outline length', () => {
    const def = { ...definitionDefaults(), channel: { name: 'Markets of the Past', language: 'en' } } as never
    const structure = Array.from({ length: 120 }, (_, k) => `chapter ${k}: a very long measured section title about trade routes and prices`)
    const a = { title: 'T'.repeat(400), script: { structure, hookPattern: 'h'.repeat(900), promise: 'p'.repeat(900), tone: 't'.repeat(900) } } as never
    const { title, idea } = passageIdea(a, def, 90)
    expect(title.length).toBeLessThanOrEqual(200)
    expect(idea.length).toBeLessThanOrEqual(IDEA_MAX_CHARS)
    expect(idea).toMatch(/Write OUR OWN script/)
    expect(idea).toMatch(/words a minute/)
    expect(idea).toMatch(/Outline of the reference: chapter 0/)
  })
})
