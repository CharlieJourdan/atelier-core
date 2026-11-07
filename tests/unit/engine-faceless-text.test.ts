// The faceless formats' text and scheduling parts: `script.translate` (with a fake Claude: no real call), a script given by a
// person (the pasted-script port the human-script drawing wires), and a node that flags its own result for review.
import { describe, expect, it } from 'vitest'
import { MemoryArtefactStore, MemoryNodeStateStore, startRun, validatePipeline, type ClaudeService, type EngineEvent } from '../../src/engine'
import { Outline } from '../../src/engine/formats/outline'
import { chunkParagraphs, scriptTranslate, TranslateParams } from '../../src/engine/nodes/script-translate'
import { parseScript } from '../../src/engine/text/script'
import { art, makeCtx, testServices, tempDir } from './engine-node-helpers'
import { fakeClock, harness, videoPipeline } from './engine-fakes'

const SOURCE = [
  'Je n’aurais jamais cru raconter ça un jour. Mon voisin m’a demandé de garder une clé pour lui.',
  'Dimanche soir, la clé avait disparu. Et ce que j’ai trouvé derrière sa porte m’a coupé le souffle.',
  'Voilà pourquoi je ne prête plus rien à personne.'
].join('\n\n')

const TRANSLATED = [
  'I would never have believed I would tell this one day. My neighbour asked me to look after a key for him.',
  'On Sunday evening, the key was gone. And what I found behind his door took my breath away.',
  'That is why I no longer lend anything to anyone.'
]

const outline = (anchor = (i: number) => parseScript(SOURCE).sentences[i]?.text.split(' ').slice(0, 8).join(' ') ?? '') =>
  art('json.outline', {
    value: Outline.parse({
      language: 'fr',
      title: 'Le voisin et la clé',
      shape: 'essay',
      kind: 'story',
      promise: 'Ce que cachait une porte.',
      hook: 'Je n’aurais jamais cru.',
      beats: [
        { index: 0, purpose: 'Accroche', summary: 'La clé confiée.', wordBudget: 20, tags: ['hook'], anchor: anchor(0), marks: [] },
        { index: 1, purpose: 'Bascule', summary: 'La clé disparaît.', wordBudget: 20, tags: ['pivot'], anchor: anchor(2), marks: [{ tag: 'pivot', anchor: anchor(3) }] },
        { index: 2, purpose: 'Chute', summary: 'La leçon.', wordBudget: 10, tags: ['payoff'], anchor: anchor(4), marks: [] }
      ],
      chapters: [{ title: 'La clé', firstBeat: 0, anchor: anchor(0) }, { title: 'La porte', firstBeat: 1, anchor: anchor(2) }],
      planted: [{ detail: 'la clé', plantedBeat: 0, payoffBeat: 1 }]
    }) as never
  })

interface Call {
  system: string
  prompt: string
}
/** A fake Claude playing a translator; `wrongCount` makes its first paragraph answer one paragraph short. */
function fakeClaude(o: { wrongCount?: boolean } = {}): { claude: ClaudeService; calls: Call[] } {
  const calls: Call[] = []
  let paragraphCalls = 0
  const claude: ClaudeService = {
    ask: (req) => {
      calls.push({ system: req.system, prompt: req.prompt })
      if (req.prompt.includes('"purpose"')) {
        return Promise.resolve({
          text: JSON.stringify({
            title: 'The neighbour and the key',
            promise: 'What a door was hiding.',
            hook: 'I would never have believed.',
            beats: [{ purpose: 'Hook', summary: 'The key handed over.' }, { purpose: 'Turn', summary: 'The key vanishes.' }, { purpose: 'Payoff', summary: 'The lesson.' }],
            chapters: ['The key', 'The door'],
            planted: ['the key']
          })
        })
      }
      paragraphCalls++
      const n = [...req.prompt.matchAll(/^\[(\d+)\] /gm)].length
      const paragraphs = TRANSLATED.slice(0, n)
      return Promise.resolve({ text: `Here you go:\n\`\`\`json\n${JSON.stringify({ paragraphs: o.wrongCount && paragraphCalls === 1 ? paragraphs.slice(1) : paragraphs })}\n\`\`\`` })
    }
  }
  return { claude, calls }
}

describe('script.translate', () => {
  const params = (p: object = {}) => TranslateParams.parse({ language: 'en', ...p })
  const inputs = { script: art('text.script', { value: SOURCE }), outline: outline() }

  it('translates paragraph by paragraph, keeps the structure and carries the anchors to the same sentences', async () => {
    const { claude, calls } = fakeClaude()
    const out = await scriptTranslate.run(makeCtx({ claude }), inputs, params())
    const text = out.text?.value as string
    expect(text.split(/\n\s*\n/)).toEqual(TRANSLATED)
    const src = parseScript(SOURCE)
    const tgt = parseScript(text)
    // the same number of paragraphs and of sentences: beats and captions line up with the original
    expect(tgt.paragraphs).toHaveLength(src.paragraphs.length)
    expect(tgt.sentences).toHaveLength(src.sentences.length)
    expect(out.text?.meta).toMatchObject({ translated: true, from: 'fr', language: 'en', calls: 2 })
    const o = Outline.parse(out.outline?.value)
    expect(o).toMatchObject({ language: 'en', title: 'The neighbour and the key', hook: 'I would never have believed.' })
    expect(o.beats.map((b) => b.purpose)).toEqual(['Hook', 'Turn', 'Payoff'])
    expect(o.chapters.map((c) => c.title)).toEqual(['The key', 'The door'])
    expect(o.planted[0]?.detail).toBe('the key')
    // each beat points at the translation of the sentence it pointed at (beat 1: sentence 2, the mark: sentence 3)
    expect(o.beats[0]?.anchor).toBe(tgt.sentences[0]?.text.split(' ').slice(0, 8).join(' '))
    expect(o.beats[1]?.anchor).toBe(tgt.sentences[2]?.text.split(' ').slice(0, 8).join(' '))
    expect(o.beats[1]?.marks[0]?.anchor).toBe(tgt.sentences[3]?.text.split(' ').slice(0, 8).join(' '))
    expect(o.chapters[1]?.anchor).toBe(o.beats[1]?.anchor)
    expect(o.dropped).toEqual([])
    // two calls: the text, then the outline's words; the target language leads the system prompt
    expect(calls).toHaveLength(2)
    expect(calls[0]?.system).toMatch(/^Output language: English/)
    expect(calls[0]?.prompt).toContain('[1] Je n’aurais jamais cru')
  })

  it('a reply with the wrong number of paragraphs is sent back once, quoting the problem', async () => {
    const { claude, calls } = fakeClaude({ wrongCount: true })
    const out = await scriptTranslate.run(makeCtx({ claude }), inputs, params())
    expect((out.text?.value as string).split(/\n\s*\n/)).toEqual(TRANSLATED)
    expect(calls).toHaveLength(3)
    expect(calls[1]?.prompt).toMatch(/not valid[\s\S]*exactly 3 paragraphs/)
  })

  it('a script already in the target language passes through untouched, with no call', async () => {
    const { claude, calls } = fakeClaude()
    const english = TRANSLATED.join('\n\n')
    const out = await scriptTranslate.run(makeCtx({ claude }), { script: art('text.script', { value: english }), outline: outline() }, params())
    expect(out.text?.value).toBe(english)
    expect(out.text?.meta).toMatchObject({ translated: false, from: 'en' })
    expect(Outline.parse(out.outline?.value).language).toBe('en')
    expect(calls).toHaveLength(0)
  })

  it('long scripts go by groups of paragraphs (a paragraph is never cut), and a translation that lost a paragraph or the language fails', async () => {
    expect(chunkParagraphs(['a b c', 'd e', 'f g h i', 'j'], 5)).toEqual([['a b c', 'd e'], ['f g h i', 'j']])
    expect(chunkParagraphs(['one two three four five six'], 3)).toEqual([['one two three four five six']])
    const { claude, calls } = fakeClaude()
    await scriptTranslate.run(makeCtx({ claude }), inputs, params({ chunkWords: 150 }))
    expect(calls).toHaveLength(2) // the whole sample fits in one group of 150 words
    const stubborn: ClaudeService = { ask: () => Promise.resolve({ text: JSON.stringify({ paragraphs: ['Only one.'] }) }) }
    await expect(scriptTranslate.run(makeCtx({ claude: stubborn }), inputs, params())).rejects.toMatchObject({ code: 'schema' })
    // no Claude connected: the node says so, in French
    await expect(scriptTranslate.run(makeCtx({}), inputs, params())).rejects.toMatchObject({ code: 'missing_tool' })
  })

  it('demo: the template script of the same length in the target language, flagged as a demo', async () => {
    const out = await scriptTranslate.fake(makeCtx({}), inputs, params())
    expect(out.text?.meta).toMatchObject({ translated: true, demo: true, language: 'en' })
    const words = (t: string) => t.split(/\s+/).filter(Boolean).length
    expect(words(out.text?.value as string)).toBe(words(SOURCE))
    expect(Outline.parse(out.outline?.value).language).toBe('en')
  })
})

describe('a node that flags its own result for review', () => {
  function setup(flag: boolean) {
    const h = harness()
    const r = validatePipeline(videoPipeline(), h.registry)
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    h.behave.set('render.assemble@1', () => Promise.resolve({ video: { files: ['film.bin'], meta: { needsReview: flag } } }))
    const tmp = tempDir('flag')
    const events: EngineEvent[] = []
    const run = startRun({
      plan: r.plan,
      store: new MemoryArtefactStore(),
      state: new MemoryNodeStateStore(),
      scope: 'video-flag',
      inputs: { topic: { value: 'Les pyramides' } },
      style: { voice: 'clara' },
      useFakes: true,
      clock: fakeClock(),
      // all-at-once: only the owner's gate would stop this run
      gateMode: 'all',
      services: testServices(tmp.dir),
      onEvent: (e) => events.push(e)
    })
    return { run, events, cleanup: tmp.cleanup }
  }
  const gates = (events: EngineEvent[]): string[] => events.filter((e) => e.kind === 'gate').map((e) => `${(e as { nodeId: string }).nodeId}:${(e as { gate: string }).gate}`)

  it('stops the run at a review gate, in any gate mode, until the user approves that result', async () => {
    const { run, events, cleanup } = setup(true)
    try {
      await run.idle()
      expect(run.state('render')).toBe('waiting_gate')
      expect(gates(events)).toContain('render:review')
      // the declared gate of that node is none: it is the result that asked for the review
      run.approve('render')
      await run.idle()
      await new Promise((r) => setTimeout(r, 20))
      expect(run.state('render')).toBe('done')
      expect(run.state('package')).toBe('waiting_gate') // the owner's gate, as always
      run.approve('package')
      expect((await run.done).status).toBe('done')
    } finally {
      cleanup()
    }
  })

  it('a result that does not flag itself never stops the run (only the owner’s gate does)', async () => {
    const { run, events, cleanup } = setup(false)
    try {
      await run.idle()
      await new Promise((r) => setTimeout(r, 20))
      expect(gates(events)).toEqual(['package:owner'])
      expect(run.state('render')).toBe('done')
      run.approve('package')
      expect((await run.done).status).toBe('done')
    } finally {
      cleanup()
    }
  })
})
