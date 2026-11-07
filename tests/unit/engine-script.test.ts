// Lot P4: script lint and clean-up, language detection, the research brief and the script writer (fake and scripted Claude).
import { afterAll, describe, expect, it } from 'vitest'
import { EngineError, type ClaudeService } from '../../src/engine'
import { Outline } from '../../src/engine/formats/outline'
import { researchTopic } from '../../src/engine/nodes/research-topic'
import { fakeScript, fitSentences } from '../../src/engine/nodes/script-fake'
import { scriptWrite } from '../../src/engine/nodes/script-write'
import { cleanScript, detectLanguage, lintScript, wpmFor } from '../../src/engine/text/lint'
import { anchorOf, countWords, findAnchor, parseScript } from '../../src/engine/text/script'
import { art, makeCtx, tempDir, testServices } from './engine-node-helpers'

const tmp = tempDir('script')
afterAll(() => tmp.cleanup())

type Req = Parameters<ClaudeService['ask']>[0]
function scripted(handler: (req: Req, n: number) => string): { claude: ClaudeService; calls: Req[] } {
  const calls: Req[] = []
  return {
    calls,
    claude: {
      ask: (req) => {
        calls.push(req)
        return Promise.resolve({ text: handler(req, calls.length) })
      }
    }
  }
}

const rParams = (o: Record<string, unknown> = {}) => researchTopic.params.parse(o) as never
const sParams = (o: Record<string, unknown> = {}) => scriptWrite.params.parse({ revise: false, ...o }) as never
const text = (v: string) => art('text.input', { value: v })

async function fakeBrief(topic = 'Le canal du Midi', language = 'fr') {
  const r = await researchTopic.fake(makeCtx(testServices(tmp.dir), { node: researchTopic }), { topic: text(topic) }, rParams({ language }))
  return art('text.brief', { value: r.brief?.value ?? '', meta: r.brief?.meta ?? {} })
}

describe('cleanScript', () => {
  it('strips preamble, fences, Markdown, directions, editor lines and trailing offers', () => {
    const raw = [
      'Here is the script:',
      '',
      '```',
      '# Titre du film',
      '',
      '**Un matin** de 1881, le *canal* change [pause] de visage.',
      '',
      '- Une idée simple.',
      '2. Une autre idée.',
      '---',
      'Note to editor: add a map here.',
      '',
      'La fin arrive.',
      '```',
      '',
      'Let me know if you want changes.'
    ].join('\n')
    expect(cleanScript(raw)).toBe('Un matin de 1881, le canal change de visage.\n\nUne idée simple.\nUne autre idée.\n\nLa fin arrive.')
  })

  it('drops a French preamble and keeps plain text untouched', () => {
    expect(cleanScript('Voici le script :\n\nPremier paragraphe.\n\nSecond paragraphe.')).toBe('Premier paragraphe.\n\nSecond paragraphe.')
    expect(cleanScript('Rien à changer ici.')).toBe('Rien à changer ici.')
    expect(cleanScript('Un_mot_avec_tirets et 2*3 restent.')).toBe('Un_mot_avec_tirets et 2*3 restent.')
  })
})

describe('lintScript', () => {
  it('measures words, ratio, sentences, density, openings and numbers', () => {
    const t = 'Il pleut. Il neige. Il vente. Pourquoi? Vraiment! En 1850, 12 hommes partent.'
    const l = lintScript(t, { targetWords: 20, forbidden: ['neig'] })
    expect(l.words).toBe(13)
    expect(l.lengthRatio).toBe(0.65)
    expect(l.sentences).toBe(6)
    expect(l.avgSentenceWords).toBe(2.17)
    expect(l.questionDensity).toBe(0.167)
    expect(l.exclamationDensity).toBe(0.167)
    expect(l.repeatedOpenings).toEqual(['il'])
    expect(l.forbiddenHits).toEqual([{ stem: 'neig', count: 1 }])
    expect(l.numbersPer100).toBe(15.38)
    expect(l.failures).toEqual(expect.arrayContaining(['length', 'sentence_length', 'forbidden', 'questions', 'exclamations', 'repeated_openings', 'numbers']))
  })

  it('counts long sentences', () => {
    const long = Array.from({ length: 30 }, (_, i) => `mot${i}`).join(' ') + '.'
    const l = lintScript(`${long} Court.`)
    expect(l.longShare).toBe(0.5)
    expect(l.failures).toContain('long_sentences')
    expect(lintScript('Un récit calme avance sans hâte vers sa fin logique.').failures).toEqual([])
  })
})

describe('detectLanguage and wpmFor', () => {
  it('tells French from English and refuses to guess otherwise', () => {
    expect(detectLanguage('Le canal est long et il traverse les villes dans le sud de la France pour relier deux mers.')).toBe('fr')
    expect(detectLanguage('The canal is long and it crosses the towns in the south of the country to join two seas.')).toBe('en')
    expect(detectLanguage('El canal es largo y cruza los pueblos del sur del país para unir los dos mares.')).toBe('other')
    expect(detectLanguage('Oui.')).toBe('other')
  })

  it('gives the speaking rate of R17.1', () => {
    expect([wpmFor('fr'), wpmFor('en-US'), wpmFor('es'), wpmFor('it'), wpmFor('pt'), wpmFor('nl'), wpmFor('de'), wpmFor('pl'), wpmFor('ru'), wpmFor('ja')]).toEqual([
      150, 150, 150, 145, 145, 140, 125, 120, 120, 140
    ])
  })
})

describe('fake script', () => {
  const ctxFor = (minutes: number, seed = 0) => makeCtx(testServices(tmp.dir), { node: scriptWrite, minutes, seed })

  it.each([
    [1, 'fr', 150],
    [1, 'en', 150],
    [10, 'fr', 1500],
    [10, 'en', 1500]
  ])('has exactly W words for T=%i (%s)', async (T, lang, W) => {
    const brief = await fakeBrief('Le canal du Midi', lang)
    const r = await scriptWrite.fake(ctxFor(T), { brief }, sParams({ language: lang }))
    const t = r.text?.value as string
    expect(countWords(t)).toBe(W)
    expect(r.text?.meta).toMatchObject({ words: W, targetWords: W, lengthRatio: 1, language: lang, pasted: false, demo: true, warnings: [] })
    expect(detectLanguage(t)).toBe(lang)
    const first = parseScript(t).paragraphs[0] ?? ''
    expect(first).toMatch(/\?/)
    expect(first).toMatch(/\d/)
    expect(first).not.toMatch(/bienvenue|welcome|in this video|dans cette vid/i)
    expect(countWords(first)).toBeGreaterThanOrEqual(25)
    expect(countWords(first)).toBeLessThanOrEqual(50)
    expect(parseScript(t).paragraphs.length).toBeGreaterThanOrEqual(4)
    expect(parseScript(t).paragraphs.at(-1)).toMatch(/opening question|question du début/)
  })

  it('is deterministic per seed and differs for another seed', async () => {
    const brief = await fakeBrief()
    const a = await scriptWrite.fake(ctxFor(5, 1), { brief }, sParams())
    const b = await scriptWrite.fake(ctxFor(5, 1), { brief }, sParams())
    const c = await scriptWrite.fake(ctxFor(5, 2), { brief }, sParams())
    expect(a.text?.value).toBe(b.text?.value)
    expect(c.text?.value).not.toBe(a.text?.value)
    expect(countWords(c.text?.value as string)).toBe(750)
  })

  it('is exact for any length, down to a few words', () => {
    for (const language of ['fr', 'en']) {
      for (let w = 1; w <= 400; w++) expect(countWords(fakeScript({ topic: 'Un sujet', language, words: w, seed: w }))).toBe(w)
    }
    for (let n = 1; n <= 60; n++) expect(countWords(fitSentences({ closers: ['Voilà.', 'C’est tout.', 'Le reste suit.', 'Tout se tient ici.', 'Il reste pourtant beaucoup à comprendre.', 'On comprend mieux ce dossier quand on le relit sans hâte.'] }, n, () => 0.3).join(' '))).toBeLessThanOrEqual(n)
  })

  it.each([
    [1, 3, 0],
    [10, 10, 3]
  ])('builds a valid outline with resolving anchors (T=%i)', async (T, beats, chapters) => {
    const brief = await fakeBrief()
    const r = await scriptWrite.fake(ctxFor(T), { brief }, sParams())
    const outline = Outline.parse(r.outline?.value)
    const parsed = parseScript(r.text?.value as string)
    expect(outline.beats).toHaveLength(beats)
    expect(outline.chapters).toHaveLength(chapters)
    expect(outline.beats.reduce((a, b) => a + b.wordBudget, 0)).toBe(T * 150)
    expect(outline.beats[0]?.tags).toContain('hook')
    expect(outline.beats.at(-1)?.tags).toContain('payoff')
    for (const b of outline.beats) expect(findAnchor(parsed, b.anchor)).not.toBeNull()
    for (const c of outline.chapters) expect(findAnchor(parsed, c.anchor)).not.toBeNull()
    expect(outline.beats[0]?.anchor).toBe(anchorOf(parsed.sentences[0]?.text ?? ''))
    const marks = outline.beats.flatMap((b) => b.marks)
    expect(marks.some((m) => m.tag === 'figure')).toBe(true)
    for (const m of marks) expect(findAnchor(parsed, m.anchor)).not.toBeNull()
  })

  it('treats a pasted script by cleaning it only', async () => {
    const pasted = 'Voici le script :\n\nLe **vent** se lève sur la plaine, et le soir tombe sans bruit.\n\nLe lendemain, tout est calme.'
    const r = await scriptWrite.fake(ctxFor(1), { pasted: text(pasted) }, sParams())
    expect(r.text?.value).toBe('Le vent se lève sur la plaine, et le soir tombe sans bruit.\n\nLe lendemain, tout est calme.')
    expect(r.text?.meta).toMatchObject({ pasted: true, demo: true })
    expect(Outline.parse(r.outline?.value).beats.length).toBeGreaterThan(0)
  })

  it('needs a brief or a pasted script', async () => {
    await expect(scriptWrite.fake(ctxFor(1), {}, sParams())).rejects.toMatchObject({ code: 'bad_input' })
  })
})

describe('research.topic', () => {
  it('fake brief has the 7 sections and 3 demo sources, in French or English', async () => {
    for (const lang of ['fr', 'en']) {
      const r = await researchTopic.fake(makeCtx(testServices(tmp.dir), { node: researchTopic }), { topic: text('Les phares de Bretagne') }, rParams({ language: lang }))
      const b = r.brief?.value as string
      expect([...b.matchAll(/^## (\d)\. /gm)].map((m) => m[1])).toEqual(['1', '2', '3', '4', '5', '6', '7'])
      expect(b).toContain('Les phares de Bretagne')
      expect(b.match(lang === 'fr' ? /Source de démonstration n° \d \(inventée\)/g : /Demo source no\. \d \(invented\)/g)?.length).toBeGreaterThanOrEqual(3)
      expect(r.brief?.meta).toMatchObject({ language: lang, title: 'Les phares de Bretagne', shape: 'explainer', sources: 3, demo: true })
    }
  })

  it('run: one call, role researcher, language first, limits and avoid list in the prompt', async () => {
    const brief = await fakeBrief('Un sujet')
    const { claude, calls } = scripted(() => brief.value as string)
    const ctx = makeCtx(testServices(tmp.dir, { claude }), { node: researchTopic, minutes: 8, notes: ['Insiste sur les dates'] })
    const r = await researchTopic.run(ctx, { topic: text('Un sujet'), links: text('https://exemple.test/page') }, rParams({ maxSearches: 5, maxFetches: 2, avoidTitles: ['Ancien titre'] }))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ role: 'researcher', json: false })
    expect(calls[0]?.system.startsWith('Output language: French')).toBe(true)
    expect(calls[0]?.system).toContain('At most 5 searches and 2 page reads')
    expect(calls[0]?.prompt).toContain('Ancien titre')
    expect(calls[0]?.prompt).toContain('https://exemple.test/page')
    expect(calls[0]?.prompt).toContain('Insiste sur les dates')
    expect(r.brief?.meta).toMatchObject({ language: 'fr', sources: 3, demo: false })
  })

  it('run: caps the limits in the schema', () => {
    expect(researchTopic.params.safeParse({ maxSearches: 13 }).success).toBe(false)
    expect(researchTopic.params.safeParse({ maxFetches: 11 }).success).toBe(false)
  })

  it('run: one repair request quoting the missing sections, then a schema error', async () => {
    const full = (await fakeBrief('Un sujet')).value as string
    const partial = full.split('## 5.')[0] as string
    const a = scripted((_r, n) => (n === 1 ? partial : full))
    await researchTopic.run(makeCtx(testServices(tmp.dir, { claude: a.claude }), { node: researchTopic }), { topic: text('Un sujet') }, rParams())
    expect(a.calls).toHaveLength(2)
    expect(a.calls[1]?.prompt).toContain('lacks these sections: 5. Noms, lieux, dates et chiffres, 6. À éviter, 7. Sources')
    const b = scripted(() => partial)
    await expect(researchTopic.run(makeCtx(testServices(tmp.dir, { claude: b.claude }), { node: researchTopic }), { topic: text('Un sujet') }, rParams())).rejects.toMatchObject({ code: 'schema' })
    expect(b.calls).toHaveLength(2)
  })

  it('run: a refusal is retried once then a permanent refused error', async () => {
    const { claude, calls } = scripted(() => 'Je ne peux pas aider avec cela.')
    const err = await researchTopic.run(makeCtx(testServices(tmp.dir, { claude }), { node: researchTopic }), { topic: text('x') }, rParams()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect(err).toMatchObject({ code: 'refused', permanent: true, message: 'Le sujet a été refusé : reformule-le' })
    expect(calls).toHaveLength(2)
  })

  it('run: flags a missing web tool', async () => {
    const full = (await fakeBrief('Un sujet')).value as string
    const { claude } = scripted(() => `${full}\n\nWEB_UNAVAILABLE`)
    const r = await researchTopic.run(makeCtx(testServices(tmp.dir, { claude }), { node: researchTopic }), { topic: text('Un sujet') }, rParams())
    expect(r.brief?.value).not.toContain('WEB_UNAVAILABLE')
    expect(r.brief?.meta).toMatchObject({ warnings: ['recherche web indisponible'] })
  })
})

describe('script.write run (scripted Claude)', () => {
  const topic = 'Le canal du Midi'
  const outlineJson = (W: number, nb: number, minutes: number): string =>
    JSON.stringify({
      language: 'fr',
      title: topic,
      shape: 'chronicle',
      kind: 'story',
      promise: 'Comprendre le canal.',
      hook: 'Une date, 1666.',
      beats: Array.from({ length: nb }, (_, i) => ({
        index: i,
        purpose: `But ${i}`,
        summary: `Résumé ${i}`,
        wordBudget: Math.round(W / nb),
        tags: i === 0 ? ['hook'] : [],
        anchor: '',
        marks: []
      })),
      chapters: minutes >= 6 ? [{ title: 'Départ', firstBeat: 0 }, { title: 'Arrivée', firstBeat: nb - 1 }] : [],
      planted: []
    })
  const lang = (r: Req): string => (r.system.includes('English') ? 'en' : 'fr')
  /** A Claude double that answers each task with a fitting scripted text. */
  function writer(words: (task: string) => number, over: Partial<Record<string, string>> = {}, T = 1, W = 150) {
    return scripted((req, n) => {
      const task = /^TASK: (.*)$/m.exec(req.prompt)?.[1] ?? ''
      const key = task.startsWith('part') ? 'part' : task
      const hit = over[key]
      if (hit !== undefined) return hit
      if (task === 'outline') return outlineJson(W, Math.max(3, Math.round(T)), T)
      return fakeScript({ topic, language: lang(req), words: words(task), seed: n })
    })
  }
  const ctxWith = (claude: ClaudeService, minutes = 1, notes: string[] = []) => makeCtx(testServices(tmp.dir, { claude }), { node: scriptWrite, minutes, notes, seed: 3 })

  it('one outline call then one write call when W <= partsThreshold', async () => {
    const { claude, calls } = writer(() => 150)
    const brief = await fakeBrief()
    const r = await scriptWrite.run(ctxWith(claude), { brief }, sParams())
    expect(calls.map((c) => c.json)).toEqual([true, false])
    expect(calls[1]?.prompt).toContain('TASK: write')
    expect(countWords(r.text?.value as string)).toBe(150)
    expect(r.text?.meta).toMatchObject({ words: 150, targetWords: 150, lengthRatio: 1, language: 'fr', pasted: false, demo: false, warnings: [] })
    const outline = Outline.parse(r.outline?.value)
    expect(outline.beats.reduce((a, b) => a + b.wordBudget, 0)).toBe(150)
    const parsed = parseScript(r.text?.value as string)
    for (const b of outline.beats) expect(findAnchor(parsed, b.anchor)).not.toBeNull()
  })

  it('writes in parts for T = 12, each part knowing its position and what came before', async () => {
    const { claude, calls } = writer(() => 900, {}, 12, 1800)
    const brief = await fakeBrief()
    const r = await scriptWrite.run(ctxWith(claude, 12), { brief }, sParams())
    expect(calls).toHaveLength(3)
    expect(calls[1]?.prompt).toContain('TASK: part 1 of 2')
    expect(calls[2]?.prompt).toContain('part 2 of 2')
    expect(calls[2]?.prompt).toContain('Narration written so far')
    expect(calls[2]?.prompt).toContain('Part 1: Résumé 0')
    expect(calls[1]?.prompt).toContain('Open cold')
    expect(calls[2]?.prompt).toContain('pay the promise')
    expect(countWords(r.text?.value as string)).toBe(1800)
    expect(Outline.parse(r.outline?.value).chapters).toHaveLength(2)
  })

  it('fails with a permanent error when a late part stays far too short', async () => {
    const { claude } = writer((task) => (task.startsWith('part 2') || task.startsWith('rewrite') ? 300 : 900), {}, 12, 1800)
    const brief = await fakeBrief()
    await expect(scriptWrite.run(ctxWith(claude, 12), { brief }, sParams())).rejects.toMatchObject({ code: 'bad_output', permanent: true })
  })

  it('repairs an invalid outline once, and fails with a schema error when it stays invalid', async () => {
    const brief = await fakeBrief()
    const first = scripted((req, n) =>
      n === 1 ? '{"title": "x"}' : req.prompt.startsWith('TASK: outline') ? outlineJson(150, 3, 1) : fakeScript({ topic, language: 'fr', words: 150, seed: 1 })
    )
    await scriptWrite.run(ctxWith(first.claude), { brief }, sParams())
    expect(first.calls[1]?.prompt).toContain('was not valid')
    expect(first.calls).toHaveLength(3)
    const bad = scripted(() => 'pas du JSON')
    await expect(scriptWrite.run(ctxWith(bad.claude), { brief }, sParams())).rejects.toMatchObject({ code: 'schema' })
    expect(bad.calls).toHaveLength(2)
  })

  it('wrong language twice is a permanent error naming the detected language', async () => {
    const { claude, calls } = scripted((req) =>
      req.prompt.startsWith('TASK: outline') ? outlineJson(150, 3, 1) : fakeScript({ topic, language: 'en', words: 150, seed: 1 })
    )
    const err = await scriptWrite.run(ctxWith(claude), { brief: await fakeBrief() }, sParams()).catch((e: unknown) => e)
    expect(err).toMatchObject({ permanent: true, code: 'bad_output' })
    expect((err as Error).message).toContain('anglais')
    expect(calls).toHaveLength(3)
    expect(calls[2]?.prompt).toContain('not in the required language')
  })

  it('retries a reply that is far too short (non-answer by structure)', async () => {
    const { claude, calls } = scripted((req, n) =>
      req.prompt.startsWith('TASK: outline') ? outlineJson(150, 3, 1) : n === 2 ? 'Désolé, je ne peux pas.' : fakeScript({ topic, language: 'fr', words: 150, seed: 1 })
    )
    const r = await scriptWrite.run(ctxWith(claude), { brief: await fakeBrief() }, sParams())
    expect(calls).toHaveLength(3)
    expect(calls[2]?.prompt).toContain('was not the narration')
    expect(countWords(r.text?.value as string)).toBe(150)
  })

  it('asks for a full-length rewrite when a reply is short, and keeps it only if longer and in band', async () => {
    const { claude, calls } = writer((task) => (task.startsWith('rewrite') ? 150 : 105))
    const r = await scriptWrite.run(ctxWith(claude), { brief: await fakeBrief() }, sParams())
    expect(calls.map((c) => /^TASK: (.*)$/m.exec(c.prompt)?.[1])).toEqual(['outline', 'write', 'rewrite at full length'])
    expect(countWords(r.text?.value as string)).toBe(150)
    // a rewrite that is not better is dropped, and the script ends with a visible warning
    const worse = writer((task) => (task.startsWith('rewrite') ? 100 : 105))
    const w = await scriptWrite.run(ctxWith(worse.claude), { brief: await fakeBrief() }, sParams())
    expect(countWords(w.text?.value as string)).toBe(105)
    expect(w.text?.meta).toMatchObject({ warnings: ['script court : 0 min 42 au lieu de 1 min'] })
  })

  it('warns visibly when the length stays outside the band', async () => {
    const { claude } = writer(() => 125)
    const r = await scriptWrite.run(ctxWith(claude), { brief: await fakeBrief() }, sParams())
    expect(r.text?.meta).toMatchObject({ lengthRatio: 0.833, warnings: ['script court : 0 min 50 au lieu de 1 min'] })
  })

  it('rejects a revision that adds a number, keeps one that changes nothing risky', async () => {
    const brief = await fakeBrief()
    const draft = fakeScript({ topic, language: 'fr', words: 150, seed: 1 })
    const add = scripted((req) =>
      req.prompt.startsWith('TASK: outline') ? outlineJson(150, 3, 1) : req.prompt.startsWith('TASK: revise') ? fakeScript({ topic, language: 'fr', words: 145, seed: 1 }) + ' Il y avait 7777 barques.' : draft
    )
    const r = await scriptWrite.run(ctxWith(add.claude), { brief }, scriptWrite.params.parse({ revise: true }) as never)
    expect(add.calls).toHaveLength(3)
    expect(r.text?.value).toBe(draft)
    expect(r.text?.meta).toMatchObject({ revision: 'rejected' })
    const same = scripted((req) => (req.prompt.startsWith('TASK: outline') ? outlineJson(150, 3, 1) : draft))
    const k = await scriptWrite.run(ctxWith(same.claude), { brief }, scriptWrite.params.parse({ revise: true }) as never)
    expect(k.text?.meta).toMatchObject({ revision: 'kept' })
  })

  it('rewrites sentences with a forbidden stem in one batch', async () => {
    const draft = fakeScript({ topic, language: 'fr', words: 150, seed: 1 })
    const { claude, calls } = scripted((req) => {
      if (req.prompt.startsWith('TASK: outline')) return outlineJson(150, 3, 1)
      if (req.prompt.startsWith('TASK: forbidden words')) {
        return req.prompt
          .split('\n')
          .filter((l) => /^\d+: /.test(l))
          .map((l) => l.replace('sait-on', 'connaît-on'))
          .join('\n')
      }
      return draft
    })
    const r = await scriptWrite.run(ctxWith(claude), { brief: await fakeBrief() }, sParams({ forbidden: ['sait'] }))
    expect(calls).toHaveLength(3)
    expect(r.text?.value as string).not.toContain('sait-on')
    expect(r.text?.value as string).toContain('connaît-on')
    expect(countWords(r.text?.value as string)).toBe(150)
  })

  it('puts the change notes and the skills in the prompts, language line first', async () => {
    const { claude, calls } = writer(() => 150)
    await scriptWrite.run(ctxWith(claude, 1, ['Commence par une question']), { brief: await fakeBrief() }, sParams())
    for (const c of calls) expect(c.prompt).toContain('Commence par une question')
    expect(calls[0]?.system.startsWith('Output language: French')).toBe(true)
    const sys = calls[1]?.system ?? ''
    expect(sys.startsWith('Output language: French')).toBe(true)
    for (const s of ['# Skill: hook', '# Skill: retention', '# Skill: re-hooks', '# Skill: call to action']) expect(sys).toContain(s)
    const only = writer(() => 150)
    await scriptWrite.run(ctxWith(only.claude), { brief: await fakeBrief() }, sParams({ skills: ['cta'] }))
    expect(only.calls[1]?.system).toContain('# Skill: call to action')
    expect(only.calls[1]?.system).not.toContain('# Skill: hook')
  })

  it('an unknown skill is bad_params and no call is made', async () => {
    const { claude, calls } = writer(() => 150)
    const err = await scriptWrite.run(ctxWith(claude), { brief: await fakeBrief() }, sParams({ skills: ['hook', 'nope'] })).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'bad_params' })
    await expect(scriptWrite.run(ctxWith(claude), { brief: await fakeBrief() }, sParams({ skills: ['../x'] }))).rejects.toMatchObject({ code: 'bad_params' })
    expect(calls).toHaveLength(0)
  })

  it('needs a brief or a pasted script', async () => {
    const { claude, calls } = writer(() => 150)
    await expect(scriptWrite.run(ctxWith(claude), {}, sParams())).rejects.toMatchObject({ code: 'bad_input' })
    expect(calls).toHaveLength(0)
  })

  it('a pasted script is cleaned and tagged with one call, never rewritten', async () => {
    const pasted = `Voici le script :\n\n${fakeScript({ topic, language: 'fr', words: 150, seed: 5 })}`
    const clean = cleanScript(pasted)
    const first = parseScript(clean).sentences[0]?.text ?? ''
    const base = JSON.parse(outlineJson(150, 3, 1)) as { beats: { anchor: string }[] }
    const beat0 = base.beats[0]
    if (beat0) beat0.anchor = anchorOf(first)
    const { claude, calls } = scripted(() => JSON.stringify(base))
    const r = await scriptWrite.run(ctxWith(claude), { pasted: text(pasted) }, sParams())
    expect(calls).toHaveLength(1)
    expect(calls[0]?.prompt).toContain('TASK: tags')
    expect(r.text?.value).toBe(clean)
    expect(r.text?.meta).toMatchObject({ pasted: true, words: 150, language: 'fr' })
    expect(Outline.parse(r.outline?.value).beats[0]?.anchor).toBe(anchorOf(first))
  })
})
