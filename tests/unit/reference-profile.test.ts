// Record 0055 (Charlie 01/11: « c'est pour apporter un niveau d'exigence plutôt que mettre des barrières pour plus tard, et c'est
// vraiment propre à cette pipeline »): every requirement of avatar-qualite is a setting of the pipeline, derived from its
// measured profile, and off in the engine unless a pipeline sets it. The method is reusable: measure a reference, derive the
// settings, compare a render with it; « Créer une pipeline » derives the same settings from its own references.
import { describe, expect, it } from 'vitest'
import { directorPlan } from '../../src/engine/nodes/director-plan'
import { VisualsParams } from '../../src/engine/nodes/visuals-fulfil'
import { ClipParams, DEFAULT_MOTION } from '../../src/engine/nodes/clip-make'
import { AVATAR_PROFILE } from '../../src/engine/technologies/bases/avatar-profile'
import { compareProfiles, measureEditing, settingsFromProfile, type ProfileShot } from '../../src/engine/technologies/reference-profile'
import { avatarBase, compileRecipe, fromBase, technologyRegistry, voiceoverBase } from '../../src/engine/technologies'
import { styleOps } from '../../src/engine/technologies/likeness'

const reg = technologyRegistry()
const params = (id: string, doc = fromBase(avatarBase)): Record<string, unknown> => {
  const r = compileRecipe(doc, reg)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r.pipeline.nodes.find((n) => n.id === id)?.params as Record<string, unknown>
}

describe('measure → settings → compare (the reusable method)', () => {
  // a 60 s reference: presenter 0–5.5 and 11–19.5 (8.5 s, two shots back to back), pictures between; words every 0.5 s
  const shots: ProfileShot[] = [
    { start: 0, end: 5.5, presenter: true },
    { start: 5.5, end: 11, presenter: false, link: 'problem' },
    { start: 11, end: 15, presenter: true },
    { start: 15, end: 19.5, presenter: true },
    { start: 19.5, end: 24, presenter: false, link: 'noun' },
    { start: 24, end: 60, presenter: false, link: 'generic' }
  ]
  const words = Array.from({ length: 120 }, (_, i) => ({ w: i % 3 === 0 ? 'la' : 'moisissure', start: i * 0.5 + 0.12 }))

  it('measures the presenter runs, the cut lead on the named word and the literal share', () => {
    const p = measureEditing(shots, words)
    expect(p.presenterRunMaxS).toBeCloseTo(8.5, 6)
    expect(p.presenterRunMedianS).toBeCloseTo(5.5, 6)
    expect(p.cutLeadS).toBeGreaterThan(0)
    expect(p.cutLeadS).toBeLessThan(0.7)
    expect(p.literalShare).toBeCloseTo(2 / 3, 6)
  })

  it('derives the settings only from what is measured; a metaphoric reference keeps the free director', () => {
    expect(settingsFromProfile({})).toEqual({ 'director.plan': {}, 'visuals.fulfil': {}, 'clip.make': {} })
    const literal = settingsFromProfile({ presenterRunMaxS: 8.56, cutLeadS: 0.12, literalShare: 0.93, labelsPerMinute: 0 })
    expect(literal['director.plan']).toEqual({ presenterRunMaxS: 8.5, cutLeadS: 0.1, labelsPerMin: 0, illustration: 'reference-literal', presenterOnTalk: true })
    const free = settingsFromProfile({ presenterRunMaxS: 30, literalShare: 0.4, labelsPerMinute: 5 })
    expect(free['director.plan']).toEqual({ presenterRunMaxS: 30, labelsPerMin: 5 })
  })

  it('compares a render with its reference in plain words, within a tolerance per measure', () => {
    const gaps = compareProfiles(AVATAR_PROFILE, { presenterRunMaxS: 12.6, cutLeadS: 0.15, literalShare: 0.6 })
    expect(gaps.map((g) => g.field)).toEqual(['presenterRunMaxS', 'literalShare'])
    expect(gaps[0]?.text).toMatch(/12\.6 s au plus, la référence 8\.6 s/)
  })
})

describe('the requirements are avatar@1’s settings, never the engine’s limits', () => {
  it('avatar@1 carries its measured profile and the settings derived from it', () => {
    expect(avatarBase.profile).toBe(AVATAR_PROFILE)
    const screen = params('director').screen as Record<string, unknown>
    expect(screen).toMatchObject({ presenterRunMaxS: 8.5, presenterOnTalk: true, cutLeadS: 0.1, repeatWindowS: 20, illustration: 'reference-literal' })
    expect(params('director').labelsPerMin).toBe(0)
    expect(params('visuals')).toMatchObject({ illustrationBar: 8, alikeWindowS: 20 })
    expect(params('clips').motion).toMatch(/steady at eye level/)
  })

  it('without them the engine allows anything: long presenter runs, labels, any light, metaphors, no checks', () => {
    const p = directorPlan.params.parse({ avatar: { segments: ['hook'], layout: 'full' }, screen: { mix: { presenter: 0.5, imageAi: 0.5, curve: 'flat' } } }) as { screen: Record<string, unknown>; labelsPerMin: number }
    expect(p.screen.presenterRunMaxS).toBeUndefined()
    expect(p.screen.presenterOnTalk).toBe(false)
    expect(p.screen.cutLeadS).toBeUndefined()
    expect(p.screen.repeatWindowS).toBe(0)
    expect(p.screen.illustration).toBeUndefined()
    expect(p.labelsPerMin).toBe(4)
    const v = VisualsParams.parse({})
    expect(v.illustrationBar).toBeUndefined()
    expect(v.alikeWindowS).toBeUndefined()
    expect(ClipParams.parse({}).motion).toBeUndefined()
    expect(DEFAULT_MOTION).not.toMatch(/steady/)
    // another base sets none of them
    const voiceover = params('director', fromBase(voiceoverBase))
    expect(JSON.stringify(voiceover)).not.toMatch(/presenterRunMaxS|cutLeadS|repeatWindowS|reference-literal/)
  })

  it('« Créer une pipeline » derives the same settings from its own references’ measures', () => {
    const ops = styleOps(fromBase(avatarBase), [{ presenterShare: 0.3, presenterRunMaxS: 6.2, cutLeadS: 0.2, literalShare: 0.4 }], reg)
    expect(ops).toEqual(expect.arrayContaining([
      { op: 'setSetting', brick: 'director.plan', key: 'presenterRunMaxS', value: 6 },
      { op: 'setSetting', brick: 'director.plan', key: 'cutLeadS', value: 0.2 }
    ]))
    // a metaphoric reference never gets the literal grammar
    expect(ops.some((o) => 'key' in o && o.key === 'illustration')).toBe(false)
    // unmeasured references change none of them
    expect(styleOps(fromBase(avatarBase), [{ presenterShare: 0.3 }], reg).some((o) => 'key' in o && ['presenterRunMaxS', 'cutLeadS', 'illustration'].includes(o.key as string))).toBe(false)
  })
})
