// vrais-tests Part C (research note reference-video-2026-11 (old repository) « Reproduced »): the cheap clip rules of avatar@1. Motion only where it
// is seen (a clip shot showing a place or an object becomes a still with a camera move), two shots per clip only on one continuous
// action, short single shots on a per-second engine (never a face, never a pair). Pure parts and the director on its fixture.
import { describe, expect, it } from 'vitest'
import { EDITPLAN_SCHEMA, type EditPlan, type GenItem, type GenList, type Shot } from '../../src/engine/formats/editplan'
import type { GenList as GenListT } from '../../src/engine/formats/editplan'
import { enginesFor, SCENE_CHANGE_BITS } from '../../src/engine/nodes/clip-make'
import { shareClips } from '../../src/engine/nodes/director-clips'
import type { DirectorParams } from '../../src/engine/nodes/director-cuts'
import { needsMotion, sameAction } from '../../src/engine/nodes/director-needs-motion'
import { directorPlan } from '../../src/engine/nodes/director-plan'
import type { ClaudeService } from '../../src/engine/services'
import { art, makeCtx } from './engine-node-helpers'
import { makeFrenchFilm } from './film-fixture-fr12'

describe('motion only where it is seen', () => {
  it('hands, people, water and actions need a clip; places, objects and ceilings do not (the reference’s shots)', () => {
    for (const s of [
      'Close-up of a hand brushing thick white lime wash onto a rough grey wall',
      'a man in a checked shirt repainting a bedroom corner white with a paint roller',
      'rain pouring from a broken gutter down the stone wall',
      'steam rising from a radiator under the window',
      'the finger slides along the pencil sketch'
    ]) expect(needsMotion(s), s).toBe(true)
    for (const s of [
      'Wide low-angle shot of the dry stone vault of an old cellar, a single bulb lamp hanging',
      'Medium shot of a paper bag of aerial lime standing on a dusty workshop floor next to a black bucket',
      'a small digital hygrometer on a wooden desk showing 23 degrees, a potted plant beside it',
      'the top corner of a white bedroom wall covered in grey mould spots'
    ]) expect(needsMotion(s), s).toBe(false)
  })

  it('one action: the same subject in other words pairs, a new subject does not', () => {
    expect(sameAction('a hand brushing lime wash on a rough wall', 'the hand brushing lime wash on the wall near the window')).toBe(true)
    expect(sameAction('lime brushing', 'brushing lime on the wall')).toBe(true)
    expect(sameAction('an open notebook in front of a house', 'a finger on a pencil sketch of a wall section')).toBe(false)
    expect(sameAction('', 'x')).toBe(false)
  })
})

/** Base shots end to end: [kind, seconds, subject]. */
function planOf(spec: [Shot['kind'], number, string][]): { plan: EditPlan; list: GenList } {
  const shots: Shot[] = []
  const items: GenItem[] = []
  let at = 0
  spec.forEach(([kind, s, subject], i) => {
    const frames = Math.round(s * 30)
    const id = `s${i + 1}`
    const gen = `g${i + 1}`
    shots.push({ id, track: 'base', startFrame: at, endFrame: at + frames, kind, genItem: gen, transitionIn: 'cut', role: 'scene', beat: 0 })
    items.push({
      id: gen,
      kind: kind as GenItem['kind'],
      prompt: `medium shot of ${subject}`,
      shot: { size: 'medium shot', scene: subject },
      constraints: { durationS: s, aspect: '16:9' },
      context: { beatText: `sentence ${i + 1}`, subject, keyTerms: [] },
      unitPrice: 12,
      units: Math.ceil(s),
      priority: 1,
      shotIds: [id]
    })
    at += frames
  })
  const credits = items.reduce((n, it) => n + it.unitPrice * it.units, 0)
  return {
    plan: { schema: EDITPLAN_SCHEMA, fps: 30, size: [1920, 1080], frames: at, tracks: { base: shots.map((s) => s.id), overlay: [], labels: [] }, captionsPreset: 'highlight', shots, chapters: [], diagnostics: [] },
    list: { items, totals: { credits, items: items.length, byKind: {} }, budget: null }
  }
}

describe('two shots per clip, on one action only', () => {
  it('pairs the two brush shots, keeps the notebook and its sketch apart', () => {
    const { plan, list } = planOf([
      ['video.gen', 2.5, 'a hand brushing lime wash on a rough wall'],
      ['video.gen', 3, 'the hand brushing lime wash on the wall near the window'],
      ['video.gen', 2.6, 'a hand holding an open notebook in front of a house'],
      ['video.gen', 3.4, 'a finger on a pencil sketch of a wall section']
    ])
    const r = shareClips(plan, list, { maxSeconds: 8, windowS: 12, sameAction: true })
    expect(r.pairs).toBe(1)
    const by = new Map(r.list.items.map((it) => [it.id, it]))
    expect(by.get('g2')?.sameAs).toBe('g1')
    expect(by.get('g4')?.sameAs).toBeUndefined()
    // without the rule (the forced « tous »), the notebook and the sketch share one clip: the sketch would show the notebook
    expect(shareClips(plan, list, { maxSeconds: 8, windowS: 12 }).pairs).toBe(2)
  })
})

describe('short shots on a per-second engine', () => {
  const p = { engine: 'clip:veo31-lite-relaxed', fallbacks: ['clip:grok-imagine-15-lite', 'clip:veo31-lite-kie'], shortEngine: 'clip:grok-imagine-15-lite', shortMaxS: 3 }
  it('a short single shot without a face tries the short engine first, once', () => {
    expect(enginesFor(p, 2.4, 1, 'Close shot of a hand holding a hygrometer. Gentle motion.')).toEqual(['clip:grok-imagine-15-lite', 'clip:veo31-lite-relaxed', 'clip:veo31-lite-kie'])
  })
  it('a longer shot, a pair, a face, or no short engine keep the main chain', () => {
    const main = ['clip:veo31-lite-relaxed', 'clip:grok-imagine-15-lite', 'clip:veo31-lite-kie']
    expect(enginesFor(p, 3.4, 1, 'a hand rolls paint')).toEqual(main)
    expect(enginesFor(p, 2.4, 2, 'a hand rolls paint')).toEqual(main)
    expect(enginesFor(p, 2.4, 1, 'Close-up portrait of an old man, he looks at the camera')).toEqual(main)
    expect(enginesFor({ ...p, shortEngine: undefined }, 2.4, 1, 'a hand rolls paint')).toEqual(main)
  })
  it('the scene-change guard only fires on a near-total change (camera moves reached 36 bits on the benchmark)', () => {
    expect(SCENE_CHANGE_BITS).toBeGreaterThan(36)
  })
})

describe('the director keeps clips for the shots that move', () => {
  const FILM = makeFrenchFilm(240)
  // a scene pass that alternates a still subject (bread on a board) and a moving one (hands kneading)
  const llm: ClaudeService = {
    ask: (req) => {
      const kinds = [...req.prompt.matchAll(/(clipAi|imageAi) ≈/g)].map((m) => m[1] as string)
      const directives: Record<string, unknown>[] = []
      let k = 0
      for (const m of req.prompt.matchAll(/^(\d+) · (P\+|P|-)(?: from «(.+?)»)? · (.+)$/gm)) {
        if (m[2] === 'P' || kinds.length === 0) continue
        const tokens = (m[4] as string).split(' ')
        for (let i = 0; i < tokens.length - 2; i += 10) {
          const moving = k++ % 2 === 0
          directives.push({ sentence: Number(m[1]), anchor: tokens.slice(i, i + 3).join(' '), kind: 'clipAi', subject: moving ? 'hands kneading dough' : 'a loaf on a board', prompt: moving ? 'close shot of hands kneading dough on a table' : 'a loaf of bread on a wooden board', why: 'w' })
        }
      }
      return Promise.resolve({ text: `\`\`\`json\n${JSON.stringify({ directives, recurring: [] })}\n\`\`\`` })
    }
  }
  const run = async (motionOnly: boolean): Promise<GenListT> => {
    const ctx = makeCtx({ claude: llm })
    const params = directorPlan.params.parse({
      avatar: { segments: ['hook', 'outro'], layout: 'full' },
      screen: { mix: { presenter: 0.25, clipAi: 0.45, imageAi: 0.3, curve: 'flat' } },
      ...(motionOnly ? { clipMotionOnly: true } : {})
    }) as DirectorParams
    const out = await directorPlan.run(ctx, { beats: art('json.beats', { value: FILM.beats as never }), words: art('json.words', { value: FILM.words as never, meta: { durationS: FILM.durationS, alignment: 'provider', matched: 1, language: 'fr' } }), outline: art('json.outline', { value: FILM.outline as never }) }, params)
    return out.genlist?.value as unknown as GenListT
  }
  it('every generated clip shows the hands; the bread on its board is a still', async () => {
    const on = await run(true)
    const clips = on.items.filter((it) => it.kind === 'video.gen')
    expect(clips.length).toBeGreaterThan(0)
    for (const it of clips) expect(needsMotion(`${it.context.subject} ${it.shot?.scene ?? ''}`), it.context.subject).toBe(true)
    const off = await run(false)
    expect(off.items.filter((it) => it.kind === 'video.gen').some((it) => !needsMotion(`${it.context.subject} ${it.shot?.scene ?? ''}`))).toBe(true)
  })

  it('without the scene pass (the node’s fake, a failed stretch) the subjects are key terms: no clip is turned into a still', async () => {
    const ctx = makeCtx({})
    const params = directorPlan.params.parse({ avatar: { segments: ['hook', 'outro'], layout: 'full' }, screen: { mix: { presenter: 0.25, clipAi: 0.45, imageAi: 0.3, curve: 'flat' } }, clipMotionOnly: true }) as DirectorParams
    const out = await directorPlan.fake(ctx, { beats: art('json.beats', { value: FILM.beats as never }), words: art('json.words', { value: FILM.words as never, meta: { durationS: FILM.durationS, alignment: 'provider', matched: 1, language: 'fr' } }), outline: art('json.outline', { value: FILM.outline as never }) }, params)
    const list = out.genlist?.value as unknown as GenListT
    expect(list.items.filter((it) => it.kind === 'video.gen').length).toBeGreaterThan(0)
  })
})

describe('the shot size the scene pass names is kept', () => {
  it('« Close-up of … » stays a close-up instead of the rotation', async () => {
    const FILM = makeFrenchFilm(240)
    // a different object per sentence: the director refuses the same subject twice within 20 s (avatar-qualite)
    const objects = ['grey mould spots in the corner of a white wall', 'a dripping tap over a steel sink', 'a cracked window seal', 'a wet towel on a radiator', 'a hygrometer on a shelf', 'a bucket of lime wash', 'a flat brush on a board', 'a rolled carpet against a wall']
    const llm: ClaudeService = {
      ask: (req) => {
        const directives: Record<string, unknown>[] = []
        for (const m of req.prompt.matchAll(/^(\d+) · (P\+|P|-)(?: from «(.+?)»)? · (.+)$/gm)) {
          if (m[2] === 'P') continue
          const tokens = (m[4] as string).split(' ')
          directives.push({ sentence: Number(m[1]), anchor: tokens.slice(0, 3).join(' '), kind: 'imageAi', subject: `objet ${m[1]}`, prompt: `Close-up of ${objects[Number(m[1]) % objects.length]}`, why: 'w' })
        }
        return Promise.resolve({ text: `\`\`\`json\n${JSON.stringify({ directives, recurring: [] })}\n\`\`\`` })
      }
    }
    const ctx = makeCtx({ claude: llm })
    const params = directorPlan.params.parse({ avatar: { segments: ['hook', 'outro'], layout: 'full' }, screen: { mix: { presenter: 0.25, imageAi: 0.75, curve: 'flat' } } }) as DirectorParams
    const out = await directorPlan.run(ctx, { beats: art('json.beats', { value: FILM.beats as never }), words: art('json.words', { value: FILM.words as never, meta: { durationS: FILM.durationS, alignment: 'provider', matched: 1, language: 'fr' } }), outline: art('json.outline', { value: FILM.outline as never }) }, params)
    const items = (out.genlist?.value as unknown as GenListT).items.filter((it) => it.kind === 'image.gen' && it.context.subject.startsWith('objet ') && !it.context.subject.includes(' — '))
    expect(items.length).toBeGreaterThan(0)
    for (const it of items) {
      expect(it.shot?.size).toBe('close-up')
      expect(it.prompt?.startsWith('close-up of ')).toBe(true)
    }
  })
})
