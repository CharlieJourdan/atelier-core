import { describe, expect, it } from 'vitest'
import {
  asAnyCard,
  BLOCK_NAMES,
  filterMentions,
  insertMention,
  MAX_MENTION_SUGGESTIONS,
  mentionQuery,
  mentionsIn,
  nextRevealLength,
  splitBody,
  validateBlock,
  type MentionTarget
} from '../../src/shared/chat-rich'
import { BLOCK_SAMPLES, CARD_SAMPLES, blockMessageBody } from '../../src/renderer/components/conversations/fixtures'

const fence = (name: string, json: string): string => '```' + name + '\n' + json + '\n```'

describe('rich blocks', () => {
  it('every block name has a sample that validates', () => {
    for (const name of BLOCK_NAMES) {
      expect(validateBlock(name, BLOCK_SAMPLES[name]), name).not.toBeNull()
    }
  })

  it('splits markdown and blocks, keeping their order', () => {
    const body = `Intro **gras**\n\n${blockMessageBody('stats')}\n\nSuite\n${blockMessageBody('tags')}`
    const segs = splitBody(body)
    expect(segs.map((s) => (s.kind === 'block' ? s.name : s.kind))).toEqual(['md', 'stats', 'md', 'tags'])
  })

  it('keeps ordinary code fences in the markdown', () => {
    const segs = splitBody('avant\n```ts\nconst a = 1\n```\naprès')
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ kind: 'md' })
    expect((segs[0] as { text: string }).text).toContain('const a = 1')
  })

  it('treats odd fence lines as plain code fences, never as blocks', () => {
    const bodies = [['```c++', 'x', '```'].join('\n'), '```npm run dev```', ['```stats {"items":[]}', '```'].join('\n')]
    for (const body of bodies) {
      expect(splitBody(body).every((sg) => sg.kind === 'md'), body).toBe(true)
    }
  })

  it('shows a placeholder, never raw JSON, for an unfinished or invalid block', () => {
    const streaming = splitBody('Voici :\n```stats\n{"items": [{"lab')
    expect(streaming.map((s) => s.kind)).toEqual(['md', 'pending'])
    expect(streaming[1]).toMatchObject({ kind: 'pending', raw: '' })
    const invalid = splitBody(fence('chart', '{not json}'))
    expect(invalid).toEqual([{ kind: 'pending', name: 'chart', raw: '{not json}' }])
    const wrongShape = splitBody(fence('stats', '{"items": [{"nope": 1}]}'))
    expect(wrongShape[0]?.kind).toBe('pending')
  })

  it('drops unusable fields and bounds the lists', () => {
    expect(validateBlock('trend', { points: [1] })).toBeNull()
    expect(validateBlock('tags', { items: ['a', 3, ' '] })).toEqual({ items: ['a'] })
    const many = { items: Array.from({ length: 80 }, (_, i) => ({ label: `l${i}`, value: i })) }
    expect((validateBlock('stats', many) as { items: unknown[] }).items).toHaveLength(50)
    expect(validateBlock('steps', { items: [{ label: 'x', state: 'weird' }] })).toEqual({ items: [{ label: 'x', state: 'todo' }] })
  })
})

describe('cards', () => {
  it('accepts the eight card types and nothing else', () => {
    for (const card of CARD_SAMPLES) expect(asAnyCard(card), card.type).not.toBeNull()
    // Known type but missing fields (model-made data) is refused instead of crashing the renderer.
    for (const type of ['approval', 'budget', 'proposal', 'task', 'qc', 'goal', 'engine', 'handoff']) {
      expect(asAnyCard({ type }), type).toBeNull()
    }
    expect(asAnyCard({ type: 'engine', title: 'x', stage: 's', percent: 3, state: 'weird' })).toBeNull()
    expect(asAnyCard({ type: 'qc', passed: true, summary: 's', items: [1] })).toBeNull()
    expect(asAnyCard({ type: 'unknown' })).toBeNull()
    expect(asAnyCard(null)).toBeNull()
    expect(asAnyCard('approval')).toBeNull()
  })
})

describe('smooth streaming', () => {
  it('never overshoots, always progresses, and catches up with a big backlog', () => {
    let shown = 0
    const total = 400
    let frames = 0
    while (shown < total && frames < 1000) {
      const next = nextRevealLength(shown, total, 16)
      expect(next).toBeGreaterThan(shown)
      expect(next).toBeLessThanOrEqual(total)
      shown = next
      frames++
    }
    expect(shown).toBe(total)
    // ~400 chars of backlog are revealed in about a second of 16 ms frames, not instantly and not slowly.
    expect(frames).toBeGreaterThan(10)
    expect(frames).toBeLessThan(90)
  })

  it('stays put when caught up, and caps a long frame', () => {
    expect(nextRevealLength(10, 10, 16)).toBe(10)
    expect(nextRevealLength(0, 10_000, 5000)).toBe(nextRevealLength(0, 10_000, 100))
  })
})

const TARGETS: MentionTarget[] = [
  'Scénariste', 'Voix_off', 'Chercheur', 'Miniatures', 'Qualité', 'Superviseur', 'Analyste', 'Éditeur', 'Stratège'
].map((name, index) => ({ id: name.toLowerCase(), name, index }))

describe('@mentions', () => {
  it('detects the query before the caret', () => {
    expect(mentionQuery('salut @sc', 9)).toEqual({ start: 6, query: 'sc' })
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionQuery('mail a@b', 8)).toBeNull()
    expect(mentionQuery('salut @sc et plus', 9)).toEqual({ start: 6, query: 'sc' })
    expect(mentionQuery('salut @sc ', 10)).toBeNull()
  })

  it('lists at most 7 names, prefix matches first, accents ignored', () => {
    expect(filterMentions(TARGETS, '')).toHaveLength(MAX_MENTION_SUGGESTIONS)
    expect(filterMentions(TARGETS, 'sc').map((t) => t.name)).toEqual(['Scénariste'])
    expect(filterMentions(TARGETS, 'EDITEUR').map((t) => t.name)).toEqual(['Éditeur'])
    // "e" is a prefix of Éditeur, a substring of the others.
    expect(filterMentions(TARGETS, 'e')[0]?.name).toBe('Éditeur')
    expect(filterMentions(TARGETS, 'zzz')).toEqual([])
  })

  it('inserts @Name and a space, and finds the mentions of a text in order', () => {
    const target = TARGETS[1] as MentionTarget
    const out = insertMention('dis @vo stp', 4, 7, target)
    expect(out.text).toBe('dis @Voix_off  stp')
    expect(out.caret).toBe(14)
    const found = mentionsIn('@Voix_off puis @Scénariste, et encore @voix_off', TARGETS)
    expect(found.map((t) => t.name)).toEqual(['Voix_off', 'Scénariste'])
    // Names with punctuation round-trip through insert and detection.
    const odd: MentionTarget = { id: 'x', name: "Chargé d'études (QC)", index: 0 }
    const ins = insertMention('@ch', 0, 3, odd)
    expect(ins.text).toBe('@Chargé_d_études_QC_ ')
    expect(mentionsIn(ins.text, [odd]).map((t) => t.id)).toEqual(['x'])
  })
})
