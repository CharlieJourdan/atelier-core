// production-6, the director that follows the pipeline's mix and curve (production-model §6.2, §7; pipeline-avatar §2.4, §4):
// on a 12-minute French narration with a scripted LLM (and with the node's fake), for the presets avatar-eco, avatar-mix and
// avatar-premium: the screen-time shares of every part of the video stay within 5 points of the curve; the opening has no
// still; no presenter shot is under minShotS; every shot's anchor is in the words; the timeline validates and covers the voice
// with no gap. Also: json.directives never carries a time, recurring objects keep one description, the base pipeline compiles
// to the mix director, the people / brand options reach the prompts, and the quote prices the director by backend.
import { describe, expect, it } from 'vitest'
import { DirectivesValue, Timeline, checkTimelineDoc, findAnchorWord, type Directive, type Timeline as TimelineT } from '../../src/engine/formats/directives'
import { checkEditPlan, type EditPlan, type GenList } from '../../src/engine/formats/editplan'
import { toFrame } from '../../src/engine/formats/timing'
import { directorPlan } from '../../src/engine/nodes/director-plan'
import type { DirectorParams } from '../../src/engine/nodes/director-cuts'
import { mergeAnswers } from '../../src/engine/nodes/director-scenes'
import type { ClaudeService } from '../../src/engine/services'
import { avatarBase, compileRecipe, fromBase, technologyRegistry, type Mix, type RecipeDoc } from '../../src/engine/technologies'
import { llmCredits } from '../../src/main/production/runs/quote'
import { art, makeCtx } from './engine-node-helpers'
import { makeFrenchFilm } from './film-fixture-fr12'

const FILM = makeFrenchFilm(720)
const D = FILM.durationS
const PRESETS: Record<string, Mix> = {
  'avatar-eco': { presenter: 0.25, clipAi: 0.1, imageAi: 0.65, curve: 'hook-heavy' },
  'avatar-mix': { presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' },
  'avatar-premium': { presenter: 0.35, clipAi: 0.3, imageAi: 0.35, curve: 'hook-heavy' }
}
const params = (mix: Mix, screen: Record<string, unknown> = {}): DirectorParams =>
  directorPlan.params.parse({ avatar: { segments: ['hook', 'outro'], layout: 'full' }, screen: { mix, ...screen } }) as DirectorParams
const inputs = (film = FILM) => ({
  beats: art('json.beats', { value: film.beats as never }),
  words: art('json.words', { value: film.words as never, meta: { durationS: film.durationS, alignment: 'provider', matched: 1, language: 'fr' } }),
  outline: art('json.outline', { value: film.outline as never })
})

/**
 * A scripted LLM: per stretch, directives on every sentence that shows pictures (an anchor every ~10 words, kinds taken in
 * turn from the budget, not in its proportions), one anchor that is not in the sentence, a split on every 4th P sentence,
 * and the starter « levain » with one fixed description.
 */
function scriptedLlm(): { svc: ClaudeService; prompts: string[] } {
  const prompts: string[] = []
  return {
    prompts,
    svc: {
      ask: (req) => {
        prompts.push(req.prompt)
        const kinds = [...req.prompt.matchAll(/(clipAi|imageAi|stock|archive) ≈/g)].map((m) => m[1] as string)
        const directives: Record<string, unknown>[] = []
        let turn = 0
        let p = 0
        for (const m of req.prompt.matchAll(/^(\d+) · (P\+|P|-)(?: from «(.+?)»)? · (.+)$/gm)) {
          const n = Number(m[1])
          const tokens = (m[4] as string).split(' ')
          const levain = /levain/i.test(m[4] as string)
          if (m[2] === 'P') {
            if (++p % 4 === 0 && kinds.length > 0) directives.push({ sentence: n, anchor: tokens.slice(0, 2).join(' '), kind: 'imageAi', subject: 'pain', prompt: 'a loaf on a board', layout: 'split', why: 'visual' })
            continue
          }
          if (kinds.length === 0) continue
          const from = m[3] ? Math.max(0, tokens.findIndex((_t, i) => tokens.slice(i, i + 3).join(' ') === m[3])) : 0
          for (let i = from; i < tokens.length - 2; i += 10) {
            directives.push({
              sentence: n,
              anchor: tokens.slice(i, i + 3).join(' '),
              kind: kinds[turn++ % kinds.length],
              subject: `sujet ${n}-${i}`,
              prompt: `close shot of bread ${n}-${i}`,
              ...(levain ? { ref: 'levain' } : {}),
              ...(/\d/.test(tokens[i + 1] ?? '') ? { text: (tokens[i + 1] as string).replace(/[^\d]/g, '') } : {}),
              why: 'what is said'
            })
          }
        }
        directives.push({ sentence: Number(/^(\d+) · /m.exec(req.prompt)?.[1] ?? 1), anchor: 'zzz introuvable', kind: 'imageAi', subject: 'x', prompt: 'x', why: 'noise' })
        const answer = { directives, recurring: [{ name: 'levain', description: 'a jar of bubbling sourdough starter' }] }
        return Promise.resolve({ text: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` })
      }
    }
  }
}

interface Proof {
  timeline: TimelineT
  plan: EditPlan
  list: GenList
  directives: Directive[]
  parts: { fromS: number; toS: number; target: Record<string, number>; achieved: Record<string, number> }[]
}

async function direct(mix: Mix, mode: 'run' | 'fake', screen: Record<string, unknown> = {}, film = FILM): Promise<Proof & { prompts: string[] }> {
  const llm = scriptedLlm()
  const ctx = makeCtx({ claude: llm.svc })
  const out = await (mode === 'run' ? directorPlan.run(ctx, inputs(film), params(mix, screen)) : directorPlan.fake(ctx, inputs(film), params(mix, screen)))
  return {
    timeline: out.timeline?.value as unknown as TimelineT,
    plan: out.plan?.value as unknown as EditPlan,
    list: out.genlist?.value as unknown as GenList,
    directives: out.directives?.value as unknown as Directive[],
    parts: (out.timeline?.meta as { parts: Proof['parts'] }).parts,
    prompts: llm.prompts
  }
}

function provesDone(r: Proof): void {
  // the curve, part by part, within 5 points
  for (const part of r.parts) {
    for (const k of new Set([...Object.keys(part.target), ...Object.keys(part.achieved)])) {
      expect(Math.abs((part.achieved[k] ?? 0) - (part.target[k] ?? 0)), `${k} in ${part.fromS}–${part.toS} s`).toBeLessThanOrEqual(0.05)
    }
  }
  // the opening: the presenter first, no still in the first part
  const opening = r.parts[0]?.toS ?? 30
  expect(r.timeline.shots[0]?.kind).toBe('presenter')
  for (const s of r.timeline.shots) if (s.startS < opening) expect(['imageAi', 'archive']).not.toContain(s.kind)
  // no presenter shot under minShotS (1.5 s)
  for (const s of r.timeline.shots) if (s.kind === 'presenter') expect(s.endS - s.startS).toBeGreaterThanOrEqual(1.5 - 1e-6)
  // every shot's anchor is in the words of its sentence, said within the shot (a phrase may come twice in a sentence)
  for (const s of r.timeline.shots) {
    const from = FILM.words.findIndex((w) => w.start >= s.startS - 1e-6)
    const k = findAnchorWord(FILM.words, s.sentence - 1, s.anchor, from)
    expect(k, `anchor « ${s.anchor} » of ${s.id}`).not.toBeNull()
    const t = FILM.words[k as number]?.start as number
    expect(t).toBeGreaterThanOrEqual(s.startS - 1e-6)
    expect(t).toBeLessThan(s.endS + 0.2)
  }
  // the timeline validates and covers the voice with no gap; the plan passes its checker
  expect(Timeline.safeParse(r.timeline).success).toBe(true)
  expect(checkTimelineDoc(r.timeline, D)).toEqual([])
  expect(checkEditPlan(r.plan, r.list, toFrame(D))).toEqual([])
  // directives: §7.2's shape, never a time
  expect(DirectivesValue.safeParse(r.directives).success).toBe(true)
  for (const d of r.directives) expect(Object.keys(d).some((k) => /start|end|time|second/i.test(k))).toBe(false)
}

const pct = (x: number | undefined): string => `${Math.round((x ?? 0) * 100)}`.padStart(3)
const mmss = (t: number): string => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`

describe('director.plan follows the mix and the curve (production-6)', () => {
  it('the fixture is a 12-minute French narration', () => {
    expect(D).toBeGreaterThan(700)
    expect(D).toBeLessThan(750)
    expect(FILM.words.length).toBeGreaterThan(1900)
  })

  const table: string[] = []
  for (const [name, mix] of Object.entries(PRESETS)) {
    it(`${name}: with a scripted LLM, every part within 5 points, opening without stills, anchors in the words, timeline without gap`, async () => {
      const r = await direct(mix, 'run')
      // the talk / show sort first (avatar-qualite part 2), then the opening minute and the ~2.5-minute stretches
      const stretches = r.prompts.filter((x) => x.includes('Picture budget of this stretch'))
      expect(stretches.length).toBeGreaterThanOrEqual(5)
      expect(stretches[0]).toContain('Output language: French')
      expect(stretches[0]).toMatch(/Picture budget of this stretch: .*clipAi/)
      provesDone(r)
      expect(r.plan.diagnostics.some((x) => x.includes('dropped, their anchor is not in the words'))).toBe(true)
      for (const p of r.parts) {
        table.push(`| ${name} | ${mmss(p.fromS)}–${mmss(p.toS)} | ${pct(p.achieved.presenter)} (${pct(p.target.presenter)}) | ${pct(p.achieved.clipAi)} (${pct(p.target.clipAi)}) | ${pct(p.achieved.imageAi)} (${pct(p.target.imageAi)}) |`)
      }
    })

    it(`${name}: the node's fake (no LLM) proves the same`, async () => {
      provesDone(await direct(mix, 'fake'))
    })
  }

  it('a 60 s hook (production-17): 50/50 then ≈ 28/60/12 as on a long video, each part on target, shots of ≈ 3–5 s', async () => {
    const hook = makeFrenchFilm(60)
    const r = await direct(PRESETS['avatar-mix'] as Mix, 'fake', {}, hook)
    expect(r.parts.length).toBe(2)
    const [a, b] = r.parts
    expect(a?.target.imageAi ?? 0).toBe(0)
    expect(b?.target.clipAi ?? 0).toBeGreaterThan(0.45)
    expect(b?.target.presenter ?? 0).toBeGreaterThan(0.2)
    for (const part of r.parts) for (const k of Object.keys(part.target)) expect(Math.abs((part.achieved[k] ?? 0) - (part.target[k] ?? 0)), `${k} in ${part.fromS}–${part.toS} s`).toBeLessThanOrEqual(0.12)
    const broll = r.timeline.shots.filter((s) => s.kind !== 'presenter')
    expect(broll.length).toBeGreaterThanOrEqual(7)
    for (const s of broll) expect(s.endS - s.startS, s.kind).toBeLessThanOrEqual(8)
    for (const s of r.timeline.shots.filter((x) => x.kind === 'presenter')) expect(s.endS - s.startS).toBeLessThanOrEqual(8.5)
  })

  it('prints the shares per part (achieved, target in brackets)', () => {
    console.log(['| preset | part | presenter % | clips % | stills % |', '|---|---|---|---|---|', ...table].join('\n'))
    expect(table.length).toBe(15)
  })

  it('recurring objects keep one description; split shots carry the picture beside the presenter', async () => {
    const r = await direct(PRESETS['avatar-mix'] as Mix, 'run')
    const levain = r.directives.filter((d) => d.prompt?.startsWith('a jar of bubbling sourdough starter'))
    expect(levain.length).toBeGreaterThan(2)
    const splits = r.plan.shots.filter((s) => s.layout === 'split')
    expect(splits.length).toBeGreaterThan(0)
    for (const s of splits) {
      expect(s.beside && r.list.items.some((i) => i.id === s.beside?.genItem && i.kind === 'image.gen')).toBe(true)
      expect(s.startFrame / 30).toBeGreaterThanOrEqual(30) // never in the opening
    }
    expect(r.timeline.shots.filter((s) => s.layout === 'split').every((s) => s.source.beside !== undefined)).toBe(true)
    // the first and the second stretch describe the starter the same way
    const merged = mergeAnswers([
      { directives: [{ sentence: 1, anchor: 'a', kind: 'imageAi', subject: 's', prompt: 'p1', ref: 'Levain', why: 'w' }], recurring: [{ name: 'Levain', description: 'D1' }] },
      { directives: [{ sentence: 9, anchor: 'b', kind: 'imageAi', subject: 's', prompt: 'p2', ref: 'levain', why: 'w' }], recurring: [{ name: 'levain', description: 'D2' }] }
    ])
    expect(merged.directives.map((d) => d.prompt)).toEqual(['D1; p1', 'D1; p2'])
    expect(merged.directives.every((d) => !('ref' in d))).toBe(true)
    // production-17: never the same subject twice in a row — the picture right after one of the same object keeps only its own action
    const row = mergeAnswers([
      {
        directives: [
          { sentence: 1, anchor: 'a', kind: 'imageAi', subject: 'mur', prompt: 'medium shot of the wall', ref: 'Mur', why: 'w' },
          { sentence: 2, anchor: 'b', kind: 'clipAi', subject: 'mur', prompt: 'a wide brush spreads lime on it', ref: 'mur', why: 'w' },
          { sentence: 5, anchor: 'c', kind: 'imageAi', subject: 'mur', prompt: 'the dry wall', ref: 'mur', why: 'w' }
        ],
        recurring: [{ name: 'Mur', description: 'Old rough plastered stone wall' }]
      }
    ])
    expect(row.directives.map((d) => d.prompt)).toEqual(['Old rough plastered stone wall; medium shot of the wall', 'a wide brush spreads lime on it', 'Old rough plastered stone wall; the dry wall'])
  })

  it('stretches placement uses the channel’s measured length; without it, short shots and a diagnostic', async () => {
    const long = await direct(PRESETS['avatar-mix'] as Mix, 'fake', { placement: 'stretches', presenterStretchS: 12 })
    const presenter = long.timeline.shots.filter((s) => s.kind === 'presenter').slice(1)
    expect(presenter.length).toBeGreaterThan(5)
    expect(presenter.reduce((n, s) => n + s.endS - s.startS, 0) / presenter.length).toBeGreaterThan(8)
    const none = await direct(PRESETS['avatar-mix'] as Mix, 'fake', { placement: 'stretches' })
    expect(none.plan.diagnostics).toContain('presenter: no measured stretch length for this channel, short shots instead')
  })

  it('without a presenter brick its share goes to the pictures; people and brand rules reach every prompt', async () => {
    const ctx = makeCtx({})
    const p = directorPlan.params.parse({ screen: { mix: PRESETS['avatar-mix'], people: 'nobody', brands: 'none' } }) as DirectorParams
    const out = await directorPlan.fake(ctx, inputs(), p)
    const plan = out.plan?.value as unknown as EditPlan
    const list = out.genlist?.value as unknown as GenList
    expect(plan.shots.some((s) => s.kind === 'avatar')).toBe(false)
    expect(plan.diagnostics).toContain('mix: no presenter brick, its share goes to the pictures')
    for (const it of list.items) expect(it.prompt).toMatch(/no people, no logos or brand names/)
    expect(checkEditPlan(plan, list, toFrame(D))).toEqual([])
  })
})

describe('the avatar base pipeline compiles to the mix director', () => {
  const reg = technologyRegistry()
  const compiled = (doc: RecipeDoc) => {
    const r = compileRecipe(doc, reg)
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    return r.pipeline.nodes.find((n) => n.id === 'director')?.params as Record<string, unknown>
  }

  it('the director gets the mix, the curve and the people / brand options', () => {
    const doc = fromBase(avatarBase)
    const p = compiled(doc)
    expect(p.screen).toMatchObject({ mix: { presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' }, people: 'not-presenter', brands: 'real' })
    expect(p.avatar).toBeDefined()
    const none = compiled({ ...doc, options: { brands: 'none', presenterInBroll: 'nobody' } })
    expect(none.screen).toMatchObject({ people: 'nobody', brands: 'none' })
  })

  it('#114: a pipeline with a clip brick plans clips; without one the director is told there is no clip engine and plans none', async () => {
    const doc = fromBase(avatarBase)
    expect(doc.bricks.some((b) => b.tech.startsWith('clip.make'))).toBe(true)
    expect((compiled(doc).screen as Record<string, unknown>).clips).toBeUndefined()
    const bare = compiled({ ...doc, bricks: doc.bricks.filter((b) => !b.tech.startsWith('clip.make')) })
    expect((bare.screen as Record<string, unknown>).clips).toBe(false)
    const r = await direct(PRESETS['avatar-mix'] as Mix, 'fake', { clips: false })
    expect(r.list.items.filter((i) => i.kind === 'video.gen')).toHaveLength(0)
    expect(r.list.items.filter((i) => i.kind === 'image.gen').length).toBeGreaterThan(0)
    expect(r.parts.every((p) => (p.target.clipAi ?? 0) === 0)).toBe(true)
  })

  it('a version 1 mix (pictures only, flat) keeps the rhythm director', () => {
    const doc = fromBase(avatarBase)
    const p = compiled({ ...doc, mix: { clipAi: 0.3, imageAi: 0.7, curve: 'flat' }, bricks: doc.bricks.filter((b) => !b.tech.startsWith('avatar.speak')) })
    expect(p.screen).toBeUndefined()
  })
})

describe('the quote prices the director on the team backend (decision 0026)', () => {
  it('0 on « mon abonnement » and on the user’s key, its tokens on « crédits Atelier »', () => {
    const per = { director: 3.5 }
    expect(llmCredits('director', 12, { backend: 'subscription', perMinute: per })).toBe(0)
    expect(llmCredits('director', 12, { backend: 'api-key', perMinute: per })).toBe(0)
    expect(llmCredits('director', 12, { backend: 'credits', perMinute: per })).toBe(42)
    expect(llmCredits('director', 12, null)).toBe(0)
  })
})
