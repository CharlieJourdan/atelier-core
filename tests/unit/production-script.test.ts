// production-4: from an idea to a timed script. The idea and its support videos, `script.write@2` (length from the measured
// words per minute, the avatar structure, « structure » videos shape the outline and « sujet » videos the content), the
// imported script that skips writing, the sponsor mentions where the rule says, the fact check by exact unique quote, the
// script gate of the option « Script », and the app's Claude service (model per use) on a FakeProvider.
import { afterAll, describe, expect, it } from 'vitest'
import type { ClaudeService } from '../../src/engine'
import { Outline } from '../../src/engine/formats/outline'
import { parseSponsor } from '../../src/engine/formats/sponsor'
import { Support, parseSupportList } from '../../src/engine/formats/support'
import { ideaBriefNode, ideaSupport } from '../../src/engine/nodes/idea'
import { fakeScript } from '../../src/engine/nodes/script-fake'
import { applyFixes, fixProblem, scriptFactcheck } from '../../src/engine/nodes/script-factcheck'
import { topicOf } from '../../src/engine/nodes/script-outline'
import { placeMentions, scriptSponsor } from '../../src/engine/nodes/script-sponsor'
import { scriptWrite2 } from '../../src/engine/nodes/script-write2'
import { avatarBase, compileRecipe, technologyRegistry, type RecipeDoc } from '../../src/engine/technologies'
import { countWords, findAnchor, parseScript } from '../../src/engine/text/script'
import { wpmMeasured } from '../../src/engine/text/lint'
import { openDatabase } from '../../src/main/db'
import { Ledger } from '../../src/main/ledger'
import { PricesStore } from '../../src/main/llm'
import { FakeProvider, type FakeResponder } from '../../src/main/llm/fake'
import { RoutesStore } from '../../src/main/llm/routes'
import { engineClaude } from '../../src/main/production/claude'
import { SettingsStore } from '../../src/main/settings'
import { art, makeCtx, tempDir, testServices } from './engine-node-helpers'

const tmp = tempDir('production-script')
afterAll(() => tmp.cleanup())

/** The app's Claude service over a FakeProvider: the real routing (tier → model) and ledger, no network. */
function appClaude(responder: FakeResponder): { claude: ClaudeService; fake: FakeProvider } {
  const db = openDatabase(':memory:')
  const settings = new SettingsStore(db)
  const fake = new FakeProvider(responder)
  const claude = engineClaude({ ledger: new Ledger(db, new PricesStore(db), settings), routes: new RoutesStore(db, settings), settings, getProvider: () => fake })
  return { claude, fake }
}

const text = (v: string) => art('text.input', { value: v })
const ctxFor = (node: { type: string; reads?: readonly ('minutes' | 'budgetMode')[] }, minutes: number, claude?: ClaudeService) =>
  makeCtx(testServices(tmp.dir, claude ? { claude } : {}), { node: node as never, minutes })
const w2 = (o: Record<string, unknown> = {}) => scriptWrite2.params.parse({ revise: false, ...o }) as never

async function briefOf(title: string, brief = '') {
  const r = await ideaBriefNode.run(ctxFor(ideaBriefNode, 1), { title: text(title), ...(brief ? { brief: text(brief) } : {}) }, ideaBriefNode.params.parse({}) as never)
  return art('text.brief', { value: r.brief?.value ?? '', meta: r.brief?.meta ?? {} })
}

async function supportOf(list: string) {
  const r = await ideaSupport.fake(ctxFor(ideaSupport, 1), { videos: text(list) }, ideaSupport.params.parse({}) as never)
  return art('json.support', { value: r.support?.value ?? {}, meta: r.support?.meta ?? {} })
}

/** A valid outline of `n` beats summing to `words`. */
function outlineJson(words: number, n = 4): string {
  const per = Math.round(words / n)
  return JSON.stringify({
    language: 'fr',
    title: 'Cinq erreurs de jardinage',
    shape: 'countdown',
    kind: 'lesson',
    promise: 'Éviter les erreurs qui coûtent cher.',
    hook: 'Vous perdez de l’argent au jardin.',
    beats: Array.from({ length: n }, (_, i) => ({ index: i, purpose: `Erreur ${i + 1}`, summary: `Point ${i + 1}`, wordBudget: per, tags: i === 0 ? ['hook'] : [], anchor: '', marks: [] })),
    chapters: [],
    planted: []
  })
}

const taskOf = (prompt: string): string => /^TASK: ([^\n]+)/.exec(prompt)?.[1] ?? ''

describe('the idea (idea.brief, idea.support)', () => {
  it('passes the title and the brief on, the title found as the topic', async () => {
    const b = await briefOf('Les 5 erreurs du potager', 'Pour les débutants, sans jargon.')
    expect(b.value).toContain('Pour les débutants')
    expect(topicOf(b.value as string, b.meta?.title)).toBe('Les 5 erreurs du potager')
  })

  it('reads the support videos with their tags, keeps at most supportMax and says why the others are dropped', async () => {
    expect(parseSupportList('sujet: https://y.t/a\nstructure : https://y.t/b\n https://y.t/c\nrien ici\nsujet: https://y.t/a')).toEqual([
      { url: 'https://y.t/a', tag: 'subject' },
      { url: 'https://y.t/b', tag: 'structure' },
      { url: 'https://y.t/c', tag: 'subject' }
    ])
    const r = await ideaSupport.fake(ctxFor(ideaSupport, 1), { videos: text('sujet: https://y.t/a\nstructure: https://y.t/b\nsujet: https://y.t/c') }, ideaSupport.params.parse({ supportMax: 2 }) as never)
    const s = Support.parse(r.support?.value)
    expect(s.videos.map((v) => v.tag)).toEqual(['subject', 'structure'])
    expect(s.videos[1]?.parts.length).toBeGreaterThan(3)
    expect(s.dropped).toEqual([{ url: 'https://y.t/c', reason: expect.stringMatching(/au-delà/) }])
  })

  it('drops a video the eyes cannot read, with a note, and goes on', async () => {
    const services = testServices(tmp.dir, {
      videos: { read: (req) => (req.url.endsWith('bad') ? Promise.reject(new Error('vidéo privée')) : Promise.resolve({ title: 'T', summary: 'S', hook: { text: 'H', endsAtS: 10, technique: 'q' }, parts: [{ kind: 'hook', fromS: 0, toS: 10, summary: 'h' }], durationS: 100, demo: false })) }
    })
    const r = await ideaSupport.run(makeCtx(services, { node: ideaSupport }), { videos: text('sujet: https://y.t/ok\nstructure: https://y.t/bad') }, ideaSupport.params.parse({}) as never)
    const s = Support.parse(r.support?.value)
    expect(s.videos.map((v) => v.url)).toEqual(['https://y.t/ok'])
    expect(s.dropped[0]?.reason).toMatch(/vidéo privée/)
  })
})

describe('script.write@2', () => {
  it('lands on minutes × the measured words per minute (fake: exactly)', async () => {
    expect([wpmMeasured('fr'), wpmMeasured('en'), wpmMeasured('de'), wpmMeasured('pt'), wpmMeasured('pl'), wpmMeasured('es'), wpmMeasured('nl')]).toEqual([180, 180, 155, 145, 130, 160, 140])
    const brief = await briefOf('Les 5 erreurs du potager')
    const r = await scriptWrite2.fake(ctxFor(scriptWrite2, 12), { brief }, w2())
    expect(countWords(r.text?.value as string)).toBe(12 * 180)
    expect(r.text?.meta).toMatchObject({ targetWords: 2160, wpm: 180, lengthRatio: 1 })
    // the channel's own rate wins
    const own = await scriptWrite2.fake(ctxFor(scriptWrite2, 10), { brief }, w2({ wpm: 200 }))
    expect(countWords(own.text?.value as string)).toBe(2000)
  })

  it('lands within ±10 % of the target on the model: a short part is rewritten at full length by the fast tier', async () => {
    const target = 3 * 180
    const { claude, fake } = appClaude((req) => {
      const task = taskOf(req.prompt)
      if (task === 'outline') return outlineJson(target)
      if (task === 'write') return fakeScript({ topic: 'le potager', language: 'fr', words: 300, seed: 1 })
      if (task === 'rewrite at full length') return fakeScript({ topic: 'le potager', language: 'fr', words: 548, seed: 2 })
      return 'x'
    })
    const brief = await briefOf('Les 5 erreurs du potager')
    const r = await scriptWrite2.run(ctxFor(scriptWrite2, 3, claude), { brief }, w2())
    const words = countWords(r.text?.value as string)
    expect(words).toBeGreaterThanOrEqual(target * 0.9)
    expect(words).toBeLessThanOrEqual(target * 1.1)
    // models per use (0013): Sonnet plans and writes, Haiku fits the length
    expect(fake.calls.map((c) => [taskOf(c.prompt), c.model])).toEqual([
      ['outline', 'claude-sonnet-5-5'],
      ['write', 'claude-sonnet-5-5'],
      ['rewrite at full length', 'claude-haiku-5-5']
    ])
  })

  it('the channel’s standards and script style reach the outline AND the writer of script.write@2 (#107)', async () => {
    const target = Math.round(3 * 150)
    const STYLE = 'Standards: ton chaleureux, jamais de jargon' + String.fromCharCode(10) + 'Script style: phrases courtes, tutoiement, une question avant chaque conseil'
    const responder = (req: { prompt: string }) => {
      const task = taskOf(req.prompt)
      if (task === 'outline') return outlineJson(target)
      if (task === 'write') return fakeScript({ topic: 'le potager', language: 'fr', words: 300, seed: 1 })
      if (task === 'rewrite at full length') return fakeScript({ topic: 'le potager', language: 'fr', words: 548, seed: 2 })
      return 'x'
    }
    const { claude, fake } = appClaude(responder)
    const brief = await briefOf('Les 5 erreurs du potager')
    await scriptWrite2.run(ctxFor(scriptWrite2, 3, claude), { brief }, w2({ channelStyle: STYLE }))
    const outline = fake.calls.find((c) => taskOf(c.prompt) === 'outline')
    const write = fake.calls.find((c) => taskOf(c.prompt) === 'write')
    expect(outline?.prompt).toContain('tutoiement, une question avant chaque conseil')
    expect(String(write?.system)).toContain('ton chaleureux, jamais de jargon')
    // without it, no such line anywhere (a run without channel words is what it always was)
    const none = appClaude(responder)
    await scriptWrite2.run(ctxFor(scriptWrite2, 3, none.claude), { brief }, w2())
    expect(none.fake.calls.every((c) => !String(c.system).includes('own standards and script style') && !c.prompt.includes('own standards and script style'))).toBe(true)
  })

  it('a « structure » video changes the outline, a « sujet » video changes the content', async () => {
    const brief = await briefOf('Les 5 erreurs du potager')
    const plain = await scriptWrite2.fake(ctxFor(scriptWrite2, 8), { brief }, w2())
    const structure = await supportOf('structure: https://y.t/shape')
    const subject = await supportOf('sujet: https://y.t/topic')
    const shaped = await scriptWrite2.fake(ctxFor(scriptWrite2, 8), { brief, support: structure }, w2())
    const fed = await scriptWrite2.fake(ctxFor(scriptWrite2, 8), { brief, support: subject }, w2())
    const beats = (r: typeof plain) => Outline.parse(r.outline?.value).beats.map((b) => b.purpose)
    const parts = Support.parse(structure.value).videos[0]?.parts ?? []
    // structure: one beat per part of the support video, the text untouched
    expect(beats(shaped)).toHaveLength(parts.length)
    expect(beats(shaped)).not.toEqual(beats(plain))
    expect(shaped.text?.value).toBe(plain.text?.value)
    // subject: what is said changes
    expect(fed.text?.value).not.toBe(plain.text?.value)
    expect(fed.text?.value).toContain(Support.parse(subject.value).videos[0]?.title)

    // on the model: the structure goes to the outline prompt only, the subject to the writing prompts
    const prompts: Record<string, string[]> = {}
    const { claude } = appClaude((req) => {
      const task = taskOf(req.prompt)
      ;(prompts[task] ??= []).push(req.prompt)
      return task === 'outline' ? outlineJson(540) : fakeScript({ topic: 'le potager', language: 'fr', words: 540, seed: 3 })
    })
    const both = { videos: [...Support.parse(structure.value).videos, ...Support.parse(subject.value).videos], dropped: [] }
    await scriptWrite2.run(ctxFor(scriptWrite2, 3, claude), { brief, support: art('json.support', { value: both }) }, w2())
    expect(prompts.outline?.[0]).toMatch(/tagged « structure »/)
    expect(prompts.outline?.[0]).toContain(parts[0]?.summary)
    expect(prompts.write?.[0]).not.toMatch(/tagged « structure »/)
    expect(prompts.write?.[0]).toMatch(/tagged « sujet »/)
    expect(prompts.write?.[0]).toContain(Support.parse(subject.value).videos[0]?.summary)
  })

  it('an imported script skips writing: one fast tagging call, the text kept as it is', async () => {
    const pasted = fakeScript({ topic: 'le potager', language: 'fr', words: 400, seed: 4 })
    const { claude, fake } = appClaude((req) => (taskOf(req.prompt) === 'tags' ? outlineJson(400, 3) : 'unexpected'))
    const r = await scriptWrite2.run(ctxFor(scriptWrite2, 10, claude), { pasted: text(pasted) }, w2())
    expect(r.text?.value).toBe(pasted)
    expect(r.text?.meta).toMatchObject({ pasted: true })
    expect(fake.calls.map((c) => [taskOf(c.prompt), c.model])).toEqual([['tags', 'claude-haiku-5-5']])
  })

  it('an imported script never needs a model: an expired sign-in or no Claude at all, and it goes through cut into plain beats (production-17)', async () => {
    const pasted = fakeScript({ topic: 'le potager', language: 'fr', words: 400, seed: 4 })
    // the first real run: the PC's Claude Code sign-in had expired, and the imported script stopped the run
    const { claude, fake } = appClaude(() => ({ text: '', error: 'Failed to authenticate: OAuth session expired and could not be refreshed' }))
    const r = await scriptWrite2.run(ctxFor(scriptWrite2, 10, claude), { pasted: text(pasted) }, w2())
    expect(fake.calls).toHaveLength(1)
    expect(r.text?.value).toBe(pasted)
    expect(r.text?.meta).toMatchObject({ pasted: true })
    expect(JSON.stringify(r.text?.meta)).toMatch(/le découpage du script par Claude a échoué/)
    expect(r.outline?.value).toBeDefined()
    // no Claude service at all: nothing asked, the same plain beats
    const none = await scriptWrite2.run(ctxFor(scriptWrite2, 10), { pasted: text(pasted) }, w2())
    expect(none.text?.value).toBe(pasted)
    expect(JSON.stringify(none.text?.meta)).toMatch(/aucun modèle connecté/)
    // writing a script still needs Claude
    await expect(scriptWrite2.run(ctxFor(scriptWrite2, 10), { brief: art('text.brief', { value: 'Les 5 erreurs du potager' }) }, w2())).rejects.toMatchObject({ code: 'missing_tool' })
  })
})

const SPONSOR = 'nom : Guide du potager\npitch : Un guide pas à pas pour réussir ses légumes.\nlien : https://exemple.fr/guide'

describe('script.sponsor', () => {
  async function written(minutes: number) {
    const brief = await briefOf('Les 5 erreurs du potager')
    const r = await scriptWrite2.fake(ctxFor(scriptWrite2, minutes), { brief }, w2())
    return { script: art('text.script', { value: r.text?.value ?? '', meta: r.text?.meta ?? {} }), outline: art('json.outline', { value: r.outline?.value ?? {} }) }
  }

  it('puts the mention right after the hook (70–150 s) and the reminder before the closing, listed in the outline', async () => {
    const w = await written(12)
    const r = await scriptSponsor.fake(ctxFor(scriptSponsor, 12), { ...w, sponsor: text(SPONSOR) }, scriptSponsor.params.parse({}) as never)
    const out = r.text?.value as string
    const outline = Outline.parse(r.outline?.value)
    expect(outline.sponsor?.map((m) => m.kind)).toEqual(['mention', 'reminder'])
    const parsed = parseScript(out)
    const startS = (anchor: string) => ((parsed.sentences[findAnchor(parsed, anchor) ?? -1]?.first ?? -1) / 180) * 60
    const [mention, reminder] = outline.sponsor ?? []
    // the paragraph break nearest to the window: within a paragraph's length of 70–150 s
    expect(startS(mention?.anchors[0] ?? '')).toBeGreaterThanOrEqual(60)
    expect(startS(mention?.anchors[0] ?? '')).toBeLessThanOrEqual(165)
    // every sentence of the mention is listed and found in the text
    for (const a of mention?.anchors ?? []) expect(findAnchor(parsed, a)).not.toBeNull()
    expect(parseScript(mention?.text ?? '').sentences).toHaveLength(mention?.anchors.length ?? -1)
    // the reminder is the paragraph just before the last one
    const paras = out.split(/\n\s*\n/)
    expect(paras.at(-2)).toBe(reminder?.text)
    expect(out).toContain('Guide du potager')
    expect(out).not.toMatch(/€|\$|euros/)
    // the beats keep their anchors
    for (const b of outline.beats) expect(findAnchor(parsed, b.anchor)).not.toBeNull()
  })

  it('places the mention in the middle when the rule says so, and leaves a script without sponsor as it is', async () => {
    const w = await written(10)
    const mid = await scriptSponsor.fake(ctxFor(scriptSponsor, 10), { ...w, sponsor: text(`${SPONSOR}\nplacement : milieu\nrappel : non`) }, scriptSponsor.params.parse({}) as never)
    const outline = Outline.parse(mid.outline?.value)
    expect(outline.sponsor?.map((m) => m.kind)).toEqual(['mention'])
    const parsed = parseScript(mid.text?.value as string)
    const at = parsed.sentences[findAnchor(parsed, outline.sponsor?.[0]?.anchors[0] ?? '') ?? -1]?.first ?? -1
    expect(Math.abs(at / parsed.tokens.length - 0.5)).toBeLessThan(0.1)
    const none = await scriptSponsor.fake(ctxFor(scriptSponsor, 10), w, scriptSponsor.params.parse({}) as never)
    expect(none.text?.value).toBe(w.script.value)
    expect(Outline.parse(none.outline?.value).sponsor).toBeUndefined()
  })

  it('refuses a spoken price the rule does not allow: the model is asked again', async () => {
    const w = await written(12)
    const mention = (extra: string) =>
      `Avant d’aller plus loin, un mot sur Guide du potager. ${extra} C’est un guide pas à pas pour réussir ses légumes sans se ruiner ni perdre de temps au jardin. Vous y trouverez chaque étape expliquée simplement avec des exemples concrets. Le lien est dans la description juste sous cette vidéo.`
    const replies = [
      JSON.stringify({ mention: mention('Il coûte 19 € seulement.'), reminder: 'Et n’oubliez pas Guide du potager, le lien est en description.' }),
      JSON.stringify({ mention: mention('Il est fait pour vous.'), reminder: 'Et n’oubliez pas Guide du potager, le lien est en description.' })
    ]
    const { claude, fake } = appClaude((_req, i) => replies[i] ?? 'x')
    const r = await scriptSponsor.run(ctxFor(scriptSponsor, 12, claude), { ...w, sponsor: text(SPONSOR) }, scriptSponsor.params.parse({}) as never)
    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[1]?.prompt).toMatch(/a price is spoken/)
    expect(r.text?.value).toContain('Il est fait pour vous.')
    expect(r.text?.value).not.toContain('19 €')
    expect(fake.calls[0]?.model).toBe('claude-sonnet-5-5')
  })

  it('reads the placement rule from the channel’s lines', () => {
    const s = parseSponsor(`${SPONSOR}\nplacement : fin\ndurée : 40 s\nprix dit : oui`)
    expect(s?.rule).toMatchObject({ where: 'before_end', seconds: 40, spokenPrice: true })
    expect(parseSponsor('')).toBe(null)
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraphe ${i} ${'mot '.repeat(40)}`.trim())
    if (!s) throw new Error('no sponsor')
    expect(placeMentions(paragraphs, 0, s, 180)).toEqual([{ kind: 'mention', at: 9, words: 120, seconds: 40 }])
  })
})

describe('script.factcheck', () => {
  it('applies a fix only to a unique quote; the others are listed as unapplied', () => {
    const t = 'Le canal ouvre en 1681. Le canal ouvre en 1681 selon certains. Il mesure 240 km.'
    expect(fixProblem(t, { quote: 'Il mesure 240 km.', replacement: 'Il mesure 241 km.' })).toBe(null)
    expect(fixProblem(t, { quote: 'Le canal ouvre en 1681', replacement: 'Le canal ouvre en 1682' })).toMatch(/2 times/)
    expect(fixProblem(t, { quote: 'absent', replacement: 'x' })).toMatch(/not in the script/)
    expect(fixProblem(t, { quote: '240 km', replacement: 'x'.repeat(200) })).toMatch(/3 times/)
    const r = applyFixes(t, [
      { type: 'error', quote: 'Il mesure 240 km.', replacement: 'Il mesure 241 km.', source: 'https://a', confidence: 'high' },
      { type: 'error', quote: 'Le canal ouvre en 1681', replacement: 'Le canal ouvre en 1682', source: 'https://b', confidence: 'high' }
    ])
    expect(r.text).toBe('Le canal ouvre en 1681. Le canal ouvre en 1681 selon certains. Il mesure 241 km.')
    expect(r.applied).toHaveLength(1)
    expect(r.unapplied[0]?.reason).toMatch(/2 times/)
  })

  it('on the model: keeps the original beside the corrected script and reports what it did', async () => {
    const script = fakeScript({ topic: 'le potager', language: 'fr', words: 300, seed: 5 })
    const unique = parseScript(script).sentences.find((s) => script.split(s.text).length === 2)?.text ?? ''
    const { claude, fake } = appClaude(() =>
      JSON.stringify({
        searches: 2,
        findings: [
          { type: 'overstated', quote: unique, replacement: `${unique.replace(/\.$/, '')}, selon les sources.`, source: 'https://exemple.fr', confidence: 'medium' },
          { type: 'error', quote: 'introuvable dans le texte', replacement: 'peu importe', source: 'https://exemple.fr', confidence: 'low' }
        ]
      })
    )
    const brief = await briefOf('Le potager')
    const outline = (await scriptWrite2.fake(ctxFor(scriptWrite2, 2), { pasted: text(script) }, w2())).outline?.value ?? {}
    const r = await scriptFactcheck.run(
      ctxFor(scriptFactcheck, 2, claude),
      { script: art('text.script', { value: script }), outline: art('json.outline', { value: outline }), brief },
      scriptFactcheck.params.parse({}) as never
    )
    expect(r.original?.value).toBe(script)
    expect(r.text?.value).toContain('selon les sources.')
    expect(r.report?.value).toMatchObject({ applied: 1, unapplied: 1, unchecked: 0 })
    expect(fake.calls[0]?.model).toBe('claude-sonnet-5-5')
  })
})

describe('the avatar pipeline wires the script bricks', () => {
  const reg = technologyRegistry()
  const doc = (options: RecipeDoc['options']): RecipeDoc => ({ ...structuredClone(avatarBase.doc), base: 'avatar@1', options })
  const compiled = (options: RecipeDoc['options']) => {
    const r = compileRecipe(doc(options), reg)
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    return r
  }

  it('idea → support → script (→ fact check) → sponsor → voice, in that order', () => {
    const ids = (o: RecipeDoc['options']) => compiled(o).pipeline.nodes.map((n) => n.id)
    expect(ids({}).slice(0, 4)).toEqual(['idea', 'support', 'script', 'sponsor'])
    // the fact check runs before the mentions: it never « corrects » the sponsor's own words
    expect(ids({ factcheck: true }).slice(0, 5)).toEqual(['idea', 'support', 'script', 'factcheck', 'sponsor'])
    expect(ids({ sponsor: 'off' })).not.toContain('sponsor')
    const voice = compiled({ factcheck: true }).pipeline.nodes.find((n) => n.id === 'voice')
    expect(voice?.in?.script).toBe('sponsor.text')
    expect(compiled({}).pipeline.nodes.find((n) => n.id === 'script')?.in).toEqual({ brief: 'idea.brief', support: 'support.support' })
  })

  it('the script gate: off when the agent writes, on (on the final script) when asked, absent when imported', () => {
    const gate = (o: RecipeDoc['options'], id: string) => compiled(o).pipeline.nodes.find((n) => n.id === id)?.gate
    expect(gate({}, 'script')).toBe('none')
    expect(gate({}, 'sponsor')).toBe('none')
    expect(gate({ script: 'agent-review' }, 'sponsor')).toBe('owner')
    expect(gate({ script: 'agent-review', factcheck: true }, 'sponsor')).toBe('owner')
    expect(gate({ script: 'agent-review', factcheck: true }, 'factcheck')).toBe('none')
    const imported = compiled({ script: 'import' })
    expect(imported.pipeline.nodes.find((n) => n.id === 'script')).toMatchObject({ type: 'script.write@2', gate: 'none', in: { pasted: '$inputs.script' } })
    expect(imported.pipeline.nodes.map((n) => n.id).slice(0, 4)).toEqual(['idea', 'support', 'script', 'sponsor'])
  })
})
