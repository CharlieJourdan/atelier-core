// Lot P4, beats and director (docs/ENGINE-SPEC.md §20, §21): beat splitting from timed words, the deterministic cut,
// label, list and budget passes, the stretch scene pass with a scripted fake Claude, and the template pipeline.
import { describe, expect, it } from 'vitest'
import { isArtefactType } from '../../src/engine/artefacts'
import { checkEditPlan, checkTimeline, EditPlan, GenList, type EditPlan as EditPlanT, type GenList as GenListT } from '../../src/engine/formats/editplan'
import { FPS, framesFor, toFrame, type Beat, type Word } from '../../src/engine/formats/timing'
import { DirectorParams, type BeatDraft, baseCuts, buildPlan, fallbackDraft } from '../../src/engine/nodes/director-cuts'
import { directorPlan, stretches } from '../../src/engine/nodes/director-plan'
import { BeatsParams, beatsSplit, splitBeats } from '../../src/engine/nodes/beats-split'
import { P4_NODES, productionRegistry } from '../../src/engine/nodes'
import { DEFAULT_SIMPLE_STYLE, simpleVideoPipeline } from '../../src/engine/pipelines/simple-video'
import type { ClaudeService } from '../../src/engine/services'
import { validatePipeline } from '../../src/engine/validate'
import { normWord, parseScript } from '../../src/engine/text/script'
import { art, makeCtx, tempDir, testServices } from './engine-node-helpers'


import { makeFilm, type Film } from './film-fixture'

const FILM60 = makeFilm(60)
const FILM600 = makeFilm(600)

const params = (over: Record<string, unknown> = {}): DirectorParams => DirectorParams.parse(over)
const plan = (f: Film, over: Record<string, unknown> = {}, drafts: Map<number, BeatDraft> = new Map(), seed = 3, diagnostics: string[] = []) =>
  buildPlan({ beats: f.beats, words: f.words, durationS: f.durationS, title: f.outline.title, script: f.script, drafts, p: params(over), seed, diagnostics })
const baseShots = (p: EditPlanT) => p.shots.filter((s) => p.tracks.base.includes(s.id))
const check = (r: { plan: EditPlanT; list: GenListT }, f: Film): string[] => checkEditPlan(r.plan, r.list, toFrame(f.durationS))

describe('beats.split (§20)', () => {
  it('covers [0, D] with no gap and no overlap, beats of 2-10 s', () => {
    for (const f of [FILM60, FILM600]) {
      const b = f.beats
      expect(b[0]?.start).toBe(0)
      expect(b.at(-1)?.end).toBeCloseTo(f.durationS, 3) // times are rounded to the millisecond
      for (let i = 1; i < b.length; i++) expect(b[i]?.start).toBe(b[i - 1]?.end)
      for (const x of b) expect(x.end - x.start).toBeLessThanOrEqual(10.5)
      expect(b.map((x) => x.i)).toEqual(b.map((_, i) => i))
      expect(b.reduce((n, x) => n + (x.lastWord - x.firstWord + 1), 0)).toBe(f.words.length)
    }
  })

  it('carries the outline tags and chapters onto the beats, and keeps cut points inside each beat', () => {
    const b = FILM60.beats
    expect(b[0]?.tags).toContain('hook')
    expect(b.some((x) => x.chapter === 'Le départ' && x.tags.includes('chapter'))).toBe(true)
    expect(b.some((x) => x.tags.includes('pivot'))).toBe(true)
    for (const x of b) for (const c of x.cutPoints) expect(c).toBeGreaterThanOrEqual(x.start)
    expect(b.some((x) => x.cutPoints.length > 0)).toBe(true)
    expect(b[0]?.keyTerms.length).toBeGreaterThan(0)
  })

  it('the node gives the same beats with their meta, and flags weak timing', async () => {
    const ctx = makeCtx({})
    const words = art('json.words', {
      value: FILM60.words as never,
      meta: { durationS: FILM60.durationS, alignment: 'weak', matched: 0.5, language: 'fr' }
    })
    const inputs = { script: art('text.script', { value: FILM60.script }), words, outline: art('json.outline', { value: FILM60.outline as never }) }
    const out = await beatsSplit.run(ctx, inputs, BeatsParams.parse({}))
    expect(out.beats?.value).toEqual(FILM60.beats)
    expect(out.beats?.meta).toMatchObject({ durationS: FILM60.durationS, frames: framesFor(FILM60.durationS), weak: true, count: FILM60.beats.length })
    expect((await beatsSplit.fake(ctx, inputs, BeatsParams.parse({}))).beats?.value).toEqual(FILM60.beats)
    const noMeta = { ...inputs, words: art('json.words', { value: FILM60.words as never }) }
    // wrapped: beats.split throws synchronously instead of rejecting (see report), both are fine for the scheduler
    await expect((async () => beatsSplit.run(ctx, noMeta, BeatsParams.parse({})))()).rejects.toMatchObject({ code: 'bad_input' })
  })
})

// ---- baseCuts ----

/** Candidate cut times as R21.2 defines them: beat starts and cut points, ~3 frames before (8 on a pivot beat). */
function candidates(beats: readonly Beat[]): number[] {
  const out: number[] = []
  for (const b of beats) {
    const pivot = b.tags.includes('pivot')
    const lead = (pivot ? 8 : 3) / FPS
    if (b.i > 0) out.push(Math.max(0, b.start - (pivot ? lead : 0)))
    for (const c of b.cutPoints) out.push(Math.max(0, c - lead))
  }
  return out
}

describe('baseCuts (R21.1-R21.3)', () => {
  const p = params()
  const gaps = (c: number[]): number[] => c.slice(1).map((x, i) => x - (c[i] as number))
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)

  it.each([
    ['60 s', FILM60],
    ['600 s', FILM600]
  ])('the %s film: boundaries on the frame grid from 0 to D, shots between min and max length', (_n, f) => {
    const c = baseCuts(f.beats, f.durationS, p)
    expect(c[0]).toBe(0)
    expect(c.at(-1)).toBeCloseTo(f.durationS, 9)
    for (const x of c) expect(Math.abs(x * FPS - Math.round(x * FPS))).toBeLessThan(1e-6)
    for (const g of gaps(c)) {
      expect(g).toBeGreaterThanOrEqual(p.minShotS - 1 / FPS)
      expect(g).toBeLessThanOrEqual(p.maxShotS + 1 / FPS)
    }
  })

  it('cuts faster over the hook and slower over the last 20 s (average shot lengths)', () => {
    const c = baseCuts(FILM600.beats, FILM600.durationS, p)
    const D = FILM600.durationS
    const g = (from: number, to: number): number[] => gaps(c).filter((_, i) => (c[i] as number) >= from && (c[i] as number) < to)
    const intro = mean(g(0, 60))
    const body = mean(g(60, D - 20))
    const outro = mean(g(D - 20, D))
    expect(intro).toBeLessThan(body)
    expect(outro).toBeGreaterThan(body)
  })

  it('lands on candidate cut points (beat starts, commas, sentence ends) a few frames before the word', () => {
    for (const f of [FILM60, FILM600]) {
      const cands = candidates(f.beats).map((x) => Math.round(x * FPS) / FPS)
      const c = baseCuts(f.beats, f.durationS, p)
      const off = c.slice(1, -1).filter((x) => !cands.some((k) => Math.abs(k - x) <= 1.5 / FPS))
      expect(off).toEqual([])
    }
  })

})

// ---- buildPlan ----

describe('buildPlan', () => {
  it.each([
    ['60 s', FILM60],
    ['600 s', FILM600]
  ])('the %s film: the base track covers [0, F) exactly and the checker finds nothing (R21.7)', (_n, f) => {
    const r = plan(f)
    expect(check(r, f)).toEqual([])
    expect(r.plan.frames).toBe(toFrame(f.durationS))
    expect(EditPlan.safeParse(r.plan).success).toBe(true)
    expect(GenList.safeParse(r.list).success).toBe(true)
    const base = baseShots(r.plan)
    expect(base[0]?.startFrame).toBe(0)
    expect(base.at(-1)?.endFrame).toBe(r.plan.frames)
  })

  it('consecutive stills never creep the same way (R21.6)', () => {
    for (const seed of [0, 1, 2, 3]) {
      const stills = baseShots(plan(FILM600, {}, new Map(), seed).plan).filter((s) => s.kind === 'stock.photo' || s.kind === 'image.gen')
      expect(stills.length).toBeGreaterThan(20)
      for (let i = 1; i < stills.length; i++) expect(stills[i]?.motion?.kind).not.toBe(stills[i - 1]?.motion?.kind)
    }
  })

  it('transitions: dip on chapter beats, dissolve on paragraph changes, cut otherwise (R21.5)', () => {
    const r = plan(FILM600)
    const base = baseShots(r.plan)
    const seen = new Set<string>()
    base.forEach((s, k) => {
      const b = FILM600.beats[s.beat] as Beat
      const prev = k > 0 ? (FILM600.beats[(base[k - 1] as { beat: number }).beat] as Beat) : null
      const expected = prev && prev.i !== b.i ? (b.chapter ? 'dip' : prev.paragraph !== b.paragraph ? 'dissolve' : 'cut') : 'cut'
      expect(s.transitionIn).toBe(expected)
      seen.add(expected)
    })
    expect([...seen].sort()).toEqual(['cut', 'dip', 'dissolve'])
  })

  describe('labels (§21.9: only words said in the script)', () => {
    const beat = FILM60.beats.find((b) => b.i > 1 && /\p{Lu}/u.test(b.text.slice(8))) as Beat
    const place = (b: Beat): string => (b.text.match(/\b(Valmont|Brest|Lyon|Verdun|Marseille|Rouen|Nantes|Reims)\b/u) as RegExpMatchArray)[1] as string
    const draftFor = (b: Beat, labels: { text: string; anchorWords: string }[]): BeatDraft => ({
      beat: b.i,
      subject: 'sujet',
      stockQuery: 'harbor crane',
      imagePrompt: 'a harbor at dawn',
      labels
    })

    it('refuses a label with a word that is not in the script, and counts it in the diagnostics', () => {
      const good = place(beat)
      // no other label competes for the quota
      const drafts = new Map(FILM60.beats.map((b) => [b.i, draftFor(b, [])]))
      drafts.set(beat.i, draftFor(beat, [{ text: good, anchorWords: good }, { text: 'Zanzibar', anchorWords: good }]))
      const diag: string[] = []
      const r = plan(FILM60, {}, drafts, 3, diag)
      const texts = r.plan.shots.filter((s) => s.track === 'labels').map((s) => s.text)
      expect(texts).toContain(good)
      expect(texts).not.toContain('Zanzibar')
      expect(r.plan.diagnostics.some((d) => /1 refused/.test(d))).toBe(true)
    })

    it('every kept label is made of words the script says', () => {
      const r = plan(FILM600)
      const said = new Set(FILM600.script.split(/\s+/).map(normWord))
      const labels = r.plan.shots.filter((s) => s.track === 'labels')
      expect(labels.length).toBeGreaterThan(0)
      for (const l of labels) for (const w of (l.text ?? '').split(/\s+/)) expect(said.has(normWord(w))).toBe(true)
    })

    it('never overlaps two labels, stays in the film and respects the per-minute quota', () => {
      const drafts = new Map<number, BeatDraft>()
      for (const b of FILM600.beats) {
        const t = b.text.split(/\s+/).find((w) => /^\d{3}$/.test(w)) // a figure said once in the whole script
        if (t) drafts.set(b.i, draftFor(b, [{ text: t, anchorWords: t }]))
      }
      const r = plan(FILM600, { labelsPerMin: 3 }, drafts)
      const labels = r.plan.shots.filter((s) => s.track === 'labels').sort((a, b) => a.startFrame - b.startFrame)
      expect(labels.length).toBe(Math.round((3 * FILM600.durationS) / 60))
      for (let i = 1; i < labels.length; i++) expect((labels[i] as { startFrame: number }).startFrame).toBeGreaterThanOrEqual(((labels[i - 1] as { endFrame: number }).endFrame))
      for (const l of labels) {
        expect(l.startFrame).toBeGreaterThanOrEqual(0)
        expect(l.endFrame).toBeLessThanOrEqual(r.plan.frames)
      }
      expect(r.plan.tracks.labels).toEqual(labels.map((l) => l.id).sort())
      expect(check(r, FILM600)).toEqual([])
    })

    it('labels a name written with an elision (d’Elbe) from the fallback draft', () => {
      const text = 'Il quitta le port pour revenir près d’Elbe avec ses hommes fidèles, sans un mot de plus ce soir.'
      const parsed = parseScript(text)
      const words: Word[] = parsed.tokens.map((t, i) => ({ w: t.w, start: 1 + i * 0.4, end: 1.35 + i * 0.4, sentence: 0, paragraph: 0 }))
      const D = 8
      const beats = splitBeats(text, words, null, D, BeatsParams.parse({}))
      const draft = fallbackDraft(beats[0] as Beat, 'Titre')
      expect(draft.labels.map((l) => l.text)).toContain('Elbe')
      const r = buildPlan({ beats, words, durationS: D, title: 'Titre', script: text, drafts: new Map(), p: params(), seed: 1, diagnostics: [] })
      expect(r.plan.shots.filter((s) => s.track === 'labels').map((s) => s.text)).toContain('Elbe')
    })
  })

  describe('budget (R12.3: image.gen then stock.photo, the first shot last)', () => {
    const imageOnly = { mix: { stock: 0, image: 1 } }
    it('downgrades image.gen to stock.photo until within the budget, keeping the most valuable ones', () => {
      const r = plan(FILM60, { ...imageOnly, budgetCredits: 10 })
      expect(check(r, FILM60)).toEqual([])
      expect(r.list.totals.credits).toBeLessThanOrEqual(10)
      expect(r.list.totals.credits).toBe(10) // 5 images kept at 2 credits
      const kept = r.list.items.filter((i) => i.kind === 'image.gen')
      const down = r.list.items.filter((i) => i.kind === 'stock.photo')
      expect(kept).toHaveLength(5)
      expect(down.length).toBe(r.list.items.length - 5)
      expect(Math.min(...kept.map((i) => i.priority))).toBeGreaterThanOrEqual(Math.max(...down.map((i) => i.priority)))
      expect(r.list.items[0]?.kind).toBe('image.gen') // first shot, priority 10, goes last
      expect(down.every((i) => i.query && i.unitPrice === 0 && i.units === 1)).toBe(true)
      expect(r.plan.diagnostics.some((d) => d.startsWith('budget:'))).toBe(true)
      // the plan's shots follow their items
      const kind = new Map(r.list.items.map((i) => [i.id, i.kind]))
      for (const s of baseShots(r.plan)) expect(s.kind).toBe(kind.get(s.genItem as string))
      expect(r.list.totals.byKind).toEqual({ 'image.gen': 5, 'stock.photo': down.length })
    })

    it('downgrades even the first shot when nothing else is left', () => {
      const r = plan(FILM60, { ...imageOnly, budgetCredits: 0 })
      expect(r.list.totals.credits).toBe(0)
      expect(r.list.items.every((i) => i.kind === 'stock.photo')).toBe(true)
      expect(check(r, FILM60)).toEqual([])
    })

    it('downgrades video.gen step by step (video, image, stock) and keeps the first shot to the end', () => {
      const open = plan(FILM600, { ...imageOnly, videoShare: 0.5, maxVideoClips: 12 })
      const first = open.list.items[0] as GenListT['items'][number]
      expect(first.kind).toBe('video.gen')
      const budget = first.unitPrice * first.units + 4 // the first shot and two images
      const r = plan(FILM600, { ...imageOnly, videoShare: 0.5, maxVideoClips: 12, budgetCredits: budget })
      expect(check(r, FILM600)).toEqual([])
      expect(r.list.totals.credits).toBeLessThanOrEqual(budget)
      expect(r.list.items[0]?.kind).toBe('video.gen')
      expect(r.list.items.filter((i) => i.kind === 'video.gen')).toHaveLength(1) // another clip costs 12 or more
      expect(r.list.items.filter((i) => i.kind === 'image.gen').length).toBeLessThanOrEqual(2)
      expect(r.list.items.filter((i) => i.kind === 'stock.photo').length).toBeGreaterThanOrEqual(r.list.items.length - 3)
    })
  })

  describe('generated video (§21.7)', () => {
    it('upgrades videoShare of the images to video.gen, hook and first shot first', () => {
      const r = plan(FILM600, { mix: { stock: 0, image: 1 }, videoShare: 0.1, maxVideoClips: 12 })
      const images = r.list.items.length
      const videos = r.list.items.filter((i) => i.kind === 'video.gen')
      expect(videos).toHaveLength(Math.min(Math.round(images * 0.1), 12))
      expect(videos.length).toBeGreaterThan(0)
      expect(r.list.items[0]?.kind).toBe('video.gen')
      const rest = r.list.items.filter((i) => i.kind === 'image.gen')
      expect(Math.min(...videos.map((i) => i.priority))).toBeGreaterThanOrEqual(Math.max(...rest.map((i) => i.priority)))
      for (const v of videos) {
        expect(v.unitPrice).toBe(12)
        expect(v.units).toBe(Math.ceil(v.constraints.durationS))
      }
      const kind = new Map(r.list.items.map((i) => [i.id, i.kind]))
      for (const s of baseShots(r.plan)) expect(s.kind).toBe(kind.get(s.genItem as string))
      expect(r.plan.diagnostics.some((d) => /upgraded to generated video/.test(d))).toBe(true)
      expect(check(r, FILM600)).toEqual([])
    })

  })

  it('genlist totals are the sum of unitPrice × units, with a count per kind', () => {
    const r = plan(FILM600, { videoShare: 0.2, maxVideoClips: 12, mix: { stock: 0.3, image: 0.7 } })
    expect(r.list.totals.credits).toBeCloseTo(r.list.items.reduce((s, i) => s + i.unitPrice * i.units, 0), 9)
    expect(r.list.totals.items).toBe(r.list.items.length)
    expect(Object.values(r.list.totals.byKind).reduce((a, b) => a + b, 0)).toBe(r.list.items.length)
    expect(r.list.budget).toBeNull()
  })

})

describe('checkEditPlan / checkTimeline (R12.2, R21.7)', () => {
  const good = (): { plan: EditPlanT; list: GenListT } => plan(FILM60)
  const frames = FILM60.durationS

  it('reports a gap, an overlap, a wrong length and an unknown shot', () => {
    const { plan: p } = good()
    const base = p.tracks.base
    const second = p.shots.find((s) => s.id === base[1]) as EditPlanT['shots'][number]
    second.startFrame += 3
    expect(checkTimeline(p, toFrame(frames)).join(' ')).toMatch(/gap at frame/)
    second.startFrame -= 6
    expect(checkTimeline(p, toFrame(frames)).join(' ')).toMatch(/overlap at frame/)
    second.startFrame += 3
    expect(checkTimeline(p, toFrame(frames) + 1).join(' ')).toMatch(/plan has \d+ frames/)
    p.tracks.base.push('nope')
    expect(checkTimeline(p, toFrame(frames)).join(' ')).toMatch(/unknown shot/)
  })

})

// ---- stretches and the director node ----

describe('stretches (§21.2 step 1)', () => {
  it('makes the hook stretch, then stretches of about 150 s, in order and without loss', () => {
    const s = stretches(FILM600.beats, 60)
    expect(s.flat().map((b) => b.i)).toEqual(FILM600.beats.map((b) => b.i))
    expect((s[0] as Beat[]).every((b) => b.start < 60)).toBe(true)
    expect((s[1] as Beat[])[0]?.start).toBeGreaterThanOrEqual(60)
    for (const part of s.slice(1)) for (const b of part) expect(b.start).toBeLessThan((part[0] as Beat).start + 150)
    expect(s.length).toBeGreaterThanOrEqual(4)
    expect(s.length).toBeLessThanOrEqual(6)
  })

})

describe('director.plan node', () => {
  const FILM = makeFilm(300)
  const inputsOf = (f: Film, shift = 0) => ({
    beats: art('json.beats', { value: f.beats.map((b) => ({ ...b, start: b.start + shift, end: b.end + shift, cutPoints: b.cutPoints.map((c) => c + shift) })) as never }),
    words: art('json.words', {
      value: f.words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift })) as never,
      meta: { durationS: f.durationS + shift, alignment: 'aligned', matched: 1, language: 'fr' }
    }),
    outline: art('json.outline', { value: f.outline as never })
  })
  const P = (over: Record<string, unknown> = {}): DirectorParams => directorPlan.params.parse({ hookSpanS: 30, ...over }) as DirectorParams

  interface Call {
    role: string
    system: string
    prompt: string
  }
  /** A scripted Claude: answers each stretch for the beats listed in its prompt, or a chosen reply. */
  const claude = (reply: (req: Call, n: number) => string): { svc: ClaudeService; calls: Call[] } => {
    const calls: Call[] = []
    return {
      calls,
      svc: {
        ask: (req) => {
          calls.push({ role: req.role, system: req.system, prompt: req.prompt })
          return Promise.resolve({ text: reply(req, calls.length) })
        }
      }
    }
  }
  const answerAll = (req: Call): string => {
    const ids = [...req.prompt.matchAll(/^(\d+) · /gm)].map((m) => Number(m[1]))
    return `Voici :\n\`\`\`json\n${JSON.stringify({
      beats: ids.map((i) => ({ beat: i, subject: `SUBJ-${i}`, stockQuery: `harbor-${i}-crane`, imagePrompt: `lighthouse-${i}-scene`, labels: [] }))
    })}\n\`\`\``
  }

  it('fake works without Claude and checks out', async () => {
    const ctx = makeCtx({})
    const out = await directorPlan.fake(ctx, inputsOf(FILM), P())
    const plan = out.plan?.value as unknown as EditPlanT
    const list = out.genlist?.value as unknown as GenListT
    expect(checkEditPlan(plan, list, toFrame(FILM.durationS))).toEqual([])
    expect(out.plan?.meta).toMatchObject({ demo: true, frames: plan.frames })
    expect(out.genlist?.meta).toMatchObject({ items: list.items.length })
  })

  it('run asks Claude once per stretch (role director) and uses its subjects, queries and prompts', async () => {
    const c = claude(answerAll)
    const ctx = makeCtx({ claude: c.svc })
    const out = await directorPlan.run(ctx, inputsOf(FILM), P())
    const parts = stretches(FILM.beats, 30)
    expect(c.calls).toHaveLength(parts.length)
    expect(parts.length).toBeGreaterThanOrEqual(3)
    expect(new Set(c.calls.map((x) => x.role))).toEqual(new Set(['director']))
    expect(c.calls[0]?.prompt).toContain('Stretch 1 of')
    expect(c.calls[0]?.prompt).toContain('Output language: French')
    const plan = out.plan?.value as unknown as EditPlanT
    const list = out.genlist?.value as unknown as GenListT
    expect(checkEditPlan(plan, list, toFrame(FILM.durationS))).toEqual([])
    expect(out.plan?.meta).toMatchObject({ demo: false })
    for (const s of baseShots(plan)) {
      const it = list.items.find((x) => x.id === s.genItem) as GenListT['items'][number]
      expect(it.context.subject).toBe(`SUBJ-${s.beat}`)
      if (it.kind === 'stock.photo') expect(it.query?.startsWith(`harbor-${s.beat}-crane`)).toBe(true)
      else expect(it.prompt).toContain(`lighthouse-${s.beat}-scene`)
    }
    expect(plan.diagnostics.some((d) => d.includes('réalisation simplifiée'))).toBe(false)
  })

  it('a malformed answer twice sends one repair request, then the stretch falls back and says so', async () => {
    const c = claude((req) => (req.prompt.includes('Stretch 2 of') ? 'Désolé, je ne peux pas.' : answerAll(req)))
    const ctx = makeCtx({ claude: c.svc })
    const out = await directorPlan.run(ctx, inputsOf(FILM), P())
    const parts = stretches(FILM.beats, 30)
    expect(c.calls).toHaveLength(parts.length + 1) // the failing stretch is asked twice
    const second = c.calls.filter((x) => x.prompt.includes('Stretch 2 of'))
    expect(second).toHaveLength(2)
    expect(second[0]?.prompt).not.toContain('previous answer was not valid')
    expect(second[1]?.prompt).toContain('previous answer was not valid')
    expect(second[1]?.prompt).toContain('no JSON value')
    const plan = out.plan?.value as unknown as EditPlanT
    const list = out.genlist?.value as unknown as GenListT
    expect(plan.diagnostics.filter((d) => d.includes('réalisation simplifiée'))).toHaveLength(1)
    expect(checkEditPlan(plan, list, toFrame(FILM.durationS))).toEqual([])
    const failed = new Set((parts[1] as Beat[]).map((b) => b.i))
    for (const s of baseShots(plan)) {
      const subject = (list.items.find((x) => x.id === s.genItem) as GenListT['items'][number]).context.subject
      expect(subject.startsWith('SUBJ-')).toBe(!failed.has(s.beat))
    }
    expect(ctx.reports.some((r) => r.kind === 'log' && r.level === 'warn')).toBe(true)
  })

  it('a stretch answer is cached: the same texts at shifted times make no Claude call', async () => {
    const d = tempDir('director')
    try {
      const first = claude(answerAll)
      await directorPlan.run(makeCtx(testServices(d.dir, { claude: first.svc })), inputsOf(FILM), P())
      expect(first.calls.length).toBeGreaterThanOrEqual(3)
      const shifted = 0.2
      // the same stretches (no beat crosses a limit), only other minutes:seconds in the prompt
      expect(stretches(inputsOf(FILM, shifted).beats.value as unknown as Beat[], 30).map((s) => s.length)).toEqual(stretches(FILM.beats, 30).map((s) => s.length))
      const second = claude(answerAll)
      const out = await directorPlan.run(makeCtx(testServices(d.dir, { claude: second.svc })), inputsOf(FILM, shifted), P())
      expect(second.calls).toHaveLength(0)
      const list = out.genlist?.value as unknown as GenListT
      expect(list.items.every((i) => i.context.subject.startsWith('SUBJ-'))).toBe(true)
    } finally {
      d.cleanup()
    }
  })

})

describe('the template pipeline and the node catalogue (R37.1)', () => {
  const registry = productionRegistry()
  const styleFields = Object.keys(DEFAULT_SIMPLE_STYLE)

  it('registers the 29 production nodes (the 11 of the simple video, plus the faceless formats’ gameplay background, intro card, quality check and translation, the thumbnails, the talking avatar, the animated overlays, production-4’s idea, support videos, presenter script, sponsor mentions and fact check, production-8’s clips from their still, production-9’s chapter marks and sponsor slot, and record 0059’s word timing, and motion-montage’s editing kit, and clone-monde-pov’s POV director)', () => {
    expect(registry.list()).toHaveLength(29)
    expect(registry.list().map((n) => n.type)).toEqual(P4_NODES.map((n) => n.type).sort())
    expect(registry.list().map((n) => n.type)).toContain('director.plan@1')
  })

  it('every input and output of a P4 node is a declared artefact type', () => {
    for (const n of P4_NODES) {
      for (const [port, spec] of Object.entries(n.inputs)) expect(isArtefactType(spec.type), `${n.type}.${port}`).toBe(true)
      for (const [port, type] of Object.entries(n.outputs)) expect(isArtefactType(type), `${n.type}.${port}`).toBe(true)
      expect(n.executors.length).toBeGreaterThan(0)
    }
  })

  it('validates against the registry with the default style fields, and orders the stages', () => {
    const r = validatePipeline(simpleVideoPipeline(), registry, { styleFields })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const order = r.plan.order
    const before = (a: string, b: string): boolean => order.indexOf(a) < order.indexOf(b)
    expect(order).toHaveLength(10) // voice.own is in the catalogue, not in the template
    expect(before('research', 'script')).toBe(true)
    expect(before('script', 'voice')).toBe(true)
    expect(before('voice', 'beats')).toBe(true)
    expect(before('beats', 'director')).toBe(true)
    expect(before('director', 'visuals')).toBe(true)
    expect(before('render', 'package')).toBe(true)
  })

  it('owner on the package, review on script, voice, director and visuals', () => {
    const r = validatePipeline(simpleVideoPipeline(), registry, { styleFields })
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    const gate = (id: string): string | undefined => r.plan.nodes.get(id)?.gate
    expect(gate('package')).toBe('owner')
    for (const id of ['script', 'voice', 'director', 'visuals']) expect(gate(id)).toBe('review')
    expect(gate('research')).toBe('none')
  })
})
