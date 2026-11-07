// The presenter and the generated video in the director's plan (docs/ENGINE-SPEC.md §21): which stretches an avatar speaks (the
// hook and the outro by default), full frame or in picture-in-picture, priced in the generation list, given back when the budget
// is short, and the meta the next nodes estimate their bill from. A plan without an avatar is the plan it always was.
import { describe, expect, it } from 'vitest'
import { checkEditPlan, type EditPlan, type GenList } from '../../src/engine/formats/editplan'
import { FPS, toFrame } from '../../src/engine/formats/timing'
import { AVATAR_MAX_S } from '../../src/engine/nodes/director-avatar'
import { DirectorParams, buildPlan } from '../../src/engine/nodes/director-cuts'
import { directorPlan } from '../../src/engine/nodes/director-plan'
import { art, makeCtx } from './engine-node-helpers'
import { makeFilm, type Film } from './film-fixture'

const FILM = makeFilm(60)
const SHORT = makeFilm(30)
const params = (over: Record<string, unknown> = {}): DirectorParams => DirectorParams.parse(over)
const plan = (f: Film, over: Record<string, unknown> = {}) =>
  buildPlan({ beats: f.beats, words: f.words, durationS: f.durationS, title: f.outline.title, script: f.script, drafts: new Map(), p: params(over), seed: 3, diagnostics: [] })
const problems = (r: { plan: EditPlan; list: GenList }, f: Film): string[] => checkEditPlan(r.plan, r.list, toFrame(f.durationS))
const avatars = (r: { plan: EditPlan }) => r.plan.shots.filter((s) => s.kind === 'avatar')
const base = (r: { plan: EditPlan }) => r.plan.shots.filter((s) => r.plan.tracks.base.includes(s.id))

describe('a plan without a presenter', () => {
  it('has none: no avatar shot, no overlay, no avatar item, nothing in the params', () => {
    const r = plan(FILM)
    expect(avatars(r)).toEqual([])
    expect(r.plan.tracks.overlay).toEqual([])
    expect(r.list.items.some((i) => i.kind === 'avatar')).toBe(false)
    expect(r.plan.diagnostics.some((d) => d.startsWith('avatar'))).toBe(false)
    expect(params().avatar).toBeUndefined()
    expect(problems(r, FILM)).toEqual([])
  })
})

describe('avatar, full frame (the default layout)', () => {
  const r = plan(FILM, { avatar: {} })

  it('speaks the hook and the outro by default, as base shots cut on the base track’s own cuts', () => {
    expect(problems(r, FILM)).toEqual([])
    expect(avatars(r).map((s) => [s.id, s.track, s.layout, s.kind])).toEqual([
      ['av-hook', 'base', 'full', 'avatar'],
      ['av-outro', 'base', 'full', 'avatar']
    ])
    const [hook, outro] = avatars(r)
    expect(hook?.startFrame).toBe(0)
    // about 8 s of hook, at most 20 s, and the outro ends with the film
    expect((hook?.endFrame ?? 0) / FPS).toBeGreaterThanOrEqual(4)
    expect((hook?.endFrame ?? 0) / FPS).toBeLessThanOrEqual(AVATAR_MAX_S)
    expect(outro?.endFrame).toBe(r.plan.frames)
    expect((outro?.startFrame ?? 0) / FPS).toBeGreaterThan((hook?.endFrame ?? 0) / FPS + 2)
    // the base track still tiles the film with no gap, and the presenter replaced the shots it covers
    expect(base(r).map((s) => s.id)).toContain('av-hook')
    expect(r.plan.tracks.overlay).toEqual([])
  })

  it('has an item per stretch: the voice it speaks, its length billed by the second, and no item left for the shots it replaced', () => {
    const items = r.list.items.filter((i) => i.kind === 'avatar')
    expect(items.map((i) => i.id)).toEqual(['avatar-hook', 'avatar-outro'])
    for (const [k, it] of items.entries()) {
      const shot = avatars(r)[k]
      expect(it.voiceRange).toEqual({ startFrame: shot?.startFrame, endFrame: shot?.endFrame })
      expect(it).toMatchObject({ layout: 'full', unitPrice: 4, shotIds: [shot?.id] })
      expect(it.units).toBe(Math.ceil((it.voiceRange!.endFrame - it.voiceRange!.startFrame) / FPS))
      expect(it.context.beatText.length).toBeGreaterThan(10)
    }
    const ids = new Set(r.plan.shots.map((s) => s.id))
    for (const it of r.list.items) for (const id of it.shotIds) expect(ids.has(id), `${it.id} → ${id}`).toBe(true)
    // the list total counts the presenter
    expect(r.list.totals.credits).toBeCloseTo(r.list.items.reduce((n, i) => n + i.unitPrice * i.units, 0), 6)
    expect(r.list.totals.byKind.avatar).toBe(2)
  })

  it('does not change the shots between the two stretches: they are exactly the plan without a presenter', () => {
    const plain = plan(FILM)
    const [hook, outro] = avatars(r)
    const middle = (p: { plan: EditPlan }) => base(p).filter((s) => s.startFrame >= (hook?.endFrame ?? 0) && s.endFrame <= (outro?.startFrame ?? 0))
    expect(middle(r)).toEqual(middle(plain))
  })

  it('can speak only the hook, or only the outro, with the stretch lengths asked', () => {
    expect(avatars(plan(FILM, { avatar: { segments: ['hook'] } })).map((s) => s.id)).toEqual(['av-hook'])
    expect(avatars(plan(FILM, { avatar: { segments: ['outro'] } })).map((s) => s.id)).toEqual(['av-outro'])
    const long = plan(FILM, { avatar: { segments: ['hook'], hookS: 16 } })
    expect((avatars(long)[0]?.endFrame ?? 0) / FPS).toBeGreaterThan(12)
    expect(problems(long, FILM)).toEqual([])
  })
})

describe('avatar, picture in picture', () => {
  it('leaves the base track exactly as it was and puts the presenter on the overlay track', () => {
    const plain = plan(FILM)
    const r = plan(FILM, { avatar: { layout: 'pip' } })
    expect(problems(r, FILM)).toEqual([])
    expect(base(r)).toEqual(base(plain))
    expect(r.plan.tracks.overlay).toEqual(['av-hook', 'av-outro'])
    expect(avatars(r).map((s) => [s.track, s.layout])).toEqual([
      ['overlay', 'pip'],
      ['overlay', 'pip']
    ])
    // the base items are all still there, plus the two presenters
    expect(r.list.items).toHaveLength(plain.list.items.length + 2)
  })
})

describe('what the director cannot place, and what the budget gives back', () => {
  it('a film too short for a stretch says so and stays valid', () => {
    const r = plan(SHORT, { avatar: { hookS: 12, outroS: 12 } })
    expect(problems(r, SHORT)).toEqual([])
    expect(r.plan.diagnostics.filter((d) => d.startsWith('avatar'))).not.toHaveLength(0)
    // never more than half of the film speaks, hook and outro together
    const spoken = avatars(r).reduce((n, s) => n + (s.endFrame - s.startFrame), 0)
    expect(spoken).toBeLessThanOrEqual(r.plan.frames * 0.5)
  })

  it('a budget that cannot pay the presenter gives it back as stock footage, voice over stock, the outro first and the hook last', () => {
    const prices = { 'stock.photo': 0, 'stock.video': 0, 'image.gen': 2, 'video.gen': 12 }
    const rich = plan(FILM, { avatar: {}, prices })
    expect(rich.list.totals.credits).toBeGreaterThan(60)
    expect(avatars(rich).map((s) => s.id)).toEqual(['av-hook', 'av-outro'])
    // short of credits: the outro (the less valuable one) is given back, the hook stays
    const tight = plan(FILM, { avatar: {}, budgetCredits: 40, prices })
    expect(tight.list.totals.credits).toBeLessThanOrEqual(40)
    expect(problems(tight, FILM)).toEqual([])
    expect(tight.list.items.filter((i) => i.kind === 'avatar').map((i) => i.id)).toEqual(['avatar-hook'])
    const outro = tight.plan.shots.find((s) => s.id === 'av-outro')
    expect(outro).toMatchObject({ kind: 'stock.photo', track: 'base' })
    expect(outro?.layout).toBeUndefined()
    expect(tight.list.items.find((i) => i.id === 'avatar-outro')).toMatchObject({ kind: 'stock.photo', unitPrice: 0, units: 1 })
    expect(tight.list.items.find((i) => i.id === 'avatar-outro')?.voiceRange).toBeUndefined()
    // nothing left to pay for: both given back, the film is still whole
    const none = plan(FILM, { avatar: {}, budgetCredits: 20, prices })
    expect(none.list.items.some((i) => i.kind === 'avatar')).toBe(false)
    expect(avatars(none)).toEqual([])
    expect(problems(none, FILM)).toEqual([])
    expect(none.plan.diagnostics.some((d) => d.startsWith('budget:'))).toBe(true)
  })

  it('a pip presenter given back leaves no overlay shot behind', () => {
    const poor = plan(FILM, { avatar: { layout: 'pip' }, budgetCredits: 1, prices: { 'stock.photo': 0, 'stock.video': 0, 'image.gen': 0, 'video.gen': 12 } })
    expect(poor.list.items.some((i) => i.kind === 'avatar')).toBe(false)
    expect(poor.plan.tracks.overlay).toEqual([])
    expect(avatars(poor)).toEqual([])
    expect(problems(poor, FILM)).toEqual([])
  })
})

describe('director.plan reports what the next nodes bill', () => {
  const inputs = (f: Film) => ({
    beats: art('json.beats', { value: f.beats as unknown as never }),
    words: art('json.words', { value: f.words as unknown as never, meta: { durationS: f.durationS, alignment: 'provider', matched: 1, language: 'fr' } }),
    outline: art('json.outline', { value: f.outline as unknown as never })
  })

  it('avatarSeconds and avatarItems with a presenter, videoSeconds and videoItems with generated video, nothing otherwise', async () => {
    const plain = await directorPlan.fake(makeCtx({}), inputs(FILM), directorPlan.params.parse({}) as never)
    expect(Object.keys(plain.genlist?.meta ?? {}).sort()).toEqual(['credits', 'items', 'stock'])
    const withAvatar = await directorPlan.fake(makeCtx({}), inputs(FILM), directorPlan.params.parse({ avatar: {} }) as never)
    const list = withAvatar.genlist?.value as unknown as GenList
    const seconds = list.items.filter((i) => i.kind === 'avatar').reduce((n, i) => n + Math.ceil(i.constraints.durationS), 0)
    expect(withAvatar.genlist?.meta).toMatchObject({ avatarItems: 2, avatarSeconds: seconds })
    const withVideo = await directorPlan.fake(makeCtx({}), inputs(FILM), directorPlan.params.parse({ videoShare: 0.5, maxVideoClips: 60, mix: { stock: 0, image: 1 } }) as never)
    const vlist = withVideo.genlist?.value as unknown as GenList
    const clips = vlist.items.filter((i) => i.kind === 'video.gen')
    expect(clips.length).toBeGreaterThan(0)
    expect(withVideo.genlist?.meta).toMatchObject({ videoItems: clips.length })
    // a clip is billed at most the provider's longest
    const meta = withVideo.genlist?.meta as { videoSeconds: number }
    expect(meta.videoSeconds).toBe(clips.reduce((n, i) => n + Math.min(10, Math.ceil(i.constraints.durationS)), 0))
  })
})
