// Lot P4, packaging and Claude plumbing (docs/ENGINE-SPEC.md §30, R32.1-R32.2): chapters, titles, tags, sources,
// JSON extraction from a reply and the structured ask with one repair.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EngineError } from '../../src/engine/errors'
import type { Outline } from '../../src/engine/formats/outline'
import type { Word } from '../../src/engine/formats/timing'
import { askJson, firstJson } from '../../src/engine/nodes/common'
import { chaptersFrom, cleanTags, cleanTitles, sourcesFrom } from '../../src/engine/nodes/package-youtube'
import { anchorOf, parseScript } from '../../src/engine/text/script'
import type { ClaudeService } from '../../src/engine/services'
import { makeCtx } from './engine-node-helpers'

// ---- chapters ----

/** Sentences of 8, 3, 8, 8, 8, 8 words, each word 1.5 s apart, the first word at 0.4 s. */
function chapterFixture(chapterSentences: number[], titles?: string[]): { outline: Outline; script: string; words: Word[]; starts: number[] } {
  const lengths = [8, 3, 8, 8, 8, 8]
  const sentences = lengths.map((n, i) => `${Array.from({ length: n }, (_, k) => `mot${i}x${k}`).join(' ')}.`)
  const script = sentences.join(' ')
  const parsed = parseScript(script)
  const words: Word[] = parsed.tokens.map((t, i) => ({ w: t.w, start: 0.4 + i * 1.5, end: 0.4 + i * 1.5 + 1, sentence: t.sentence, paragraph: 0 }))
  const outline = {
    language: 'fr',
    title: 'Titre',
    shape: 'chronicle',
    kind: 'story',
    promise: 'p',
    hook: 'h',
    beats: [],
    chapters: chapterSentences.map((s, k) => ({ title: titles?.[k] ?? `Chapitre ${k + 1}`, firstBeat: 0, anchor: anchorOf(parsed.sentences[s]?.text ?? '') })),
    planted: [],
    dropped: []
  } as unknown as Outline
  return { outline, script, words, starts: parsed.sentences.map((s) => (words[s.first] as Word).start) }
}

describe('chaptersFrom (§30 step 3)', () => {
  it('gives at least 3 chapters, the first at 0:00, timed from the word times', () => {
    const f = chapterFixture([0, 2, 3, 5])
    const c = chaptersFrom(f.outline, f.script, f.words)
    expect(c.map((x) => x.title)).toEqual(['Chapitre 1', 'Chapitre 2', 'Chapitre 3', 'Chapitre 4'])
    expect(c[0]?.at).toBe(0) // even though the first word comes at 0.4 s
    expect(c.slice(1).map((x) => x.at)).toEqual([f.starts[2], f.starts[3], f.starts[5]])
  })

  it('drops a chapter less than 10 s after the previous one', () => {
    const f = chapterFixture([0, 1, 2, 3, 5]) // sentence 2 starts 4.5 s after sentence 1
    const c = chaptersFrom(f.outline, f.script, f.words)
    expect(c.map((x) => x.title)).toEqual(['Chapitre 1', 'Chapitre 2', 'Chapitre 4', 'Chapitre 5'])
    for (let i = 1; i < c.length; i++) expect((c[i] as { at: number }).at - (c[i - 1] as { at: number }).at).toBeGreaterThanOrEqual(10)
  })

  it('gives no chapter at all when fewer than 3 remain', () => {
    expect(chaptersFrom(chapterFixture([0, 3]).outline, chapterFixture([0, 3]).script, chapterFixture([0, 3]).words)).toEqual([])
    const f = chapterFixture([0, 1, 2]) // the third is too close to the second
    expect(chaptersFrom(f.outline, f.script, f.words)).toEqual([])
  })

  it('cuts titles to 60 characters and skips a chapter whose anchor is not found', () => {
    const f = chapterFixture([0, 2, 3, 4], ['x'.repeat(70)])
    const lost = f.outline.chapters[1] as { anchor: string }
    lost.anchor = 'ces mots ne sont nulle part dans le texte'
    const c = chaptersFrom(f.outline, f.script, f.words)
    expect(c).toHaveLength(3)
    expect(c[0]?.title).toBe('x'.repeat(60))
  })

  it('skips a chapter with an empty anchor', () => {
    const f = chapterFixture([0, 2, 3, 5])
    ;(f.outline.chapters[1] as { anchor: string }).anchor = ''
    expect(chaptersFrom(f.outline, f.script, f.words).map((x) => x.title)).toEqual(['Chapitre 1', 'Chapitre 3', 'Chapitre 4'])
  })
})

// ---- titles, tags, sources ----

describe('cleanTitles (§30 step 1)', () => {
  it('removes angle brackets and extra spaces', () => {
    expect(cleanTitles(['Le <secret>   de  Valmont'], [])).toEqual(['Le secret de Valmont'])
  })

  it('drops duplicates (case, accents, spacing) and titles already used by the channel', () => {
    const out = cleanTitles(['Le secret de Valmont', 'LE SECRET  de valmont', 'Été brûlant', 'Une autre idée'], ['été  BRULANT'])
    expect(out).toEqual(['Le secret de Valmont', 'Une autre idée'])
  })

  it('cuts at 100 characters and drops what is too short', () => {
    const out = cleanTitles(['a'.repeat(130), 'ab', '  '], [])
    expect(out).toHaveLength(1)
    expect(out[0]).toHaveLength(100)
  })

  it('keeps the order', () => {
    expect(cleanTitles(['Un titre', 'Deux titres', 'Trois titres'], [])).toEqual(['Un titre', 'Deux titres', 'Trois titres'])
  })
})

describe('cleanTags (§30 step 4)', () => {
  it('lowercases, strips brackets, commas and hashes, and deduplicates', () => {
    expect(cleanTags(['Histoire', 'HISTOIRE', '#Napoléon', 'La  Marche, <ouverte>', 'x'])).toEqual(['histoire', 'napoléon', 'la marche ouverte'])
  })

  it('keeps at most 18 tags', () => {
    const tags = Array.from({ length: 30 }, (_, i) => `tag numéro ${String(i).padStart(2, '0')}`)
    const out = cleanTags(tags)
    expect(out).toHaveLength(18)
    expect(out[0]).toBe('tag numéro 00')
  })

  it('keeps the whole list within 500 characters', () => {
    const tags = Array.from({ length: 16 }, (_, i) => `${String.fromCharCode(97 + i)}${'z'.repeat(39)}`) // 40 chars each
    const out = cleanTags(tags)
    expect(out.length).toBe(12)
    expect(out.reduce((n, t) => n + t.length + 1, 0)).toBeLessThanOrEqual(500)
  })
})

describe('sourcesFrom (§30)', () => {
  const brief = [
    '# Brief : la marche',
    '',
    '## 6. Faits',
    '- Un fait',
    '',
    '## 7. Sources',
    '- [Le Monde](https://example.org/a)',
    '* Archives nationales, carton 12',
    '1. Livre de référence',
    '',
    '## 8. Notes',
    '- pas une source'
  ].join('\n')

  it('reads the lines of the Sources section of a numbered Markdown brief, bullets removed', () => {
    expect(sourcesFrom(brief)).toEqual(['[Le Monde](https://example.org/a)', 'Archives nationales, carton 12', 'Livre de référence'])
  })

  it('reads a last section and an unnumbered heading', () => {
    expect(sourcesFrom('Intro\n\n# Sources\n- a\n- b\n')).toEqual(['a', 'b'])
    expect(sourcesFrom('## Source\n- seule')).toEqual(['seule'])
  })

  it('gives nothing without a Sources section, or without a brief', () => {
    expect(sourcesFrom('# Brief\n\n## 1. Faits\n- a')).toEqual([])
    expect(sourcesFrom(null)).toEqual([])
    expect(sourcesFrom('')).toEqual([])
  })

  it('keeps at most 20 lines', () => {
    const many = ['## Sources', ...Array.from({ length: 30 }, (_, i) => `- source ${i}`)].join('\n')
    expect(sourcesFrom(many)).toHaveLength(20)
  })
})

// ---- firstJson ----

describe('firstJson (R32.2)', () => {
  it('finds an object inside prose', () => {
    expect(firstJson('Voici la réponse : {"a": 1, "b": [1, 2]} Voilà.')).toEqual({ a: 1, b: [1, 2] })
  })

  it('finds JSON inside a code fence', () => {
    expect(firstJson('```json\n{"titles": ["x"]}\n```')).toEqual({ titles: ['x'] })
    expect(firstJson('Texte\n```\n[1, 2, 3]\n```\nfin')).toEqual([1, 2, 3])
  })

  it('is not fooled by braces and quotes inside strings', () => {
    expect(firstJson('{"a": "}{ [ \\" ]", "b": 2}')).toEqual({ a: '}{ [ " ]', b: 2 })
    expect(firstJson('{"code": "if (x) { return [1]; }"} suite }')).toEqual({ code: 'if (x) { return [1]; }' })
  })

  it('reads nested structures and returns the first value only', () => {
    expect(firstJson('{"a": {"b": {"c": [ {"d": 1} ]}}} {"z": 0}')).toEqual({ a: { b: { c: [{ d: 1 }] } } })
    expect(firstJson('[1] {"a": 1}')).toEqual([1])
  })

  it('skips a brace that opens no JSON and goes on', () => {
    expect(firstJson('Voir {pas du json} puis {"ok": true}')).toEqual({ ok: true })
    expect(firstJson('Liste [à faire] : {"ok": 1}')).toEqual({ ok: 1 })
  })

  it('gives undefined when there is no complete JSON value', () => {
    expect(firstJson('pas de json ici')).toBeUndefined()
    expect(firstJson('{"a": [1, 2')).toBeUndefined()
    expect(firstJson('')).toBeUndefined()
  })
})

// ---- askJson ----

describe('askJson (R32.1, R32.2)', () => {
  const schema = z.object({ n: z.number() })
  const claude = (replies: string[]): { svc: ClaudeService; calls: { role: string; system: string; prompt: string; json: boolean }[] } => {
    const calls: { role: string; system: string; prompt: string; json: boolean }[] = []
    return {
      calls,
      svc: {
        ask: (req) => {
          calls.push({ role: req.role, system: req.system, prompt: req.prompt, json: req.json })
          return Promise.resolve({ text: replies[Math.min(calls.length - 1, replies.length - 1)] as string })
        }
      }
    }
  }
  const ask = (c: ReturnType<typeof claude>): Promise<{ n: number }> => askJson(makeCtx({ claude: c.svc }), { role: 'packager', system: 'SYS', prompt: 'PROMPT', schema })

  it('answers with one call when the reply is valid', async () => {
    const c = claude(['Voilà : ```json\n{"n": 4}\n```'])
    await expect(ask(c)).resolves.toEqual({ n: 4 })
    expect(c.calls).toEqual([{ role: 'packager', system: 'SYS', prompt: 'PROMPT', json: true }])
  })

  it('sends one repair request quoting the validation error, then accepts the fixed answer', async () => {
    const c = claude(['{"n": "quatre"}', '{"n": 4}'])
    await expect(ask(c)).resolves.toEqual({ n: 4 })
    expect(c.calls).toHaveLength(2)
    const repair = c.calls[1]?.prompt ?? ''
    expect(repair).not.toBe('PROMPT')
    expect(repair.startsWith('PROMPT')).toBe(true)
    expect(repair).toContain('Your previous answer was not valid (n: ')
    expect(c.calls[1]?.system).toBe('SYS')
  })

  it('says so when the reply held no JSON at all', async () => {
    const c = claude(['Je ne sais pas.', '{"n": 1}'])
    await ask(c)
    expect(c.calls[1]?.prompt).toContain('the reply holds no JSON value')
  })

  it('fails with a schema error after the single repair, never a third call', async () => {
    const c = claude(['{"n": "a"}', '{"n": "b"}', '{"n": 3}'])
    const err = await ask(c).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect(err).toMatchObject({ code: 'schema', permanent: true })
    expect((err as Error).message).toContain('packager')
    expect(c.calls).toHaveLength(2)
    expect(c.calls[1]?.prompt).not.toBe(c.calls[0]?.prompt)
    expect(c.calls[1]?.prompt.match(/previous answer/g)).toHaveLength(1)
  })

  it('needs the Claude service: a permanent missing_tool error otherwise', async () => {
    const err = await askJson(makeCtx({}), { role: 'packager', system: 's', prompt: 'p', schema }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'missing_tool' })
  })
})
