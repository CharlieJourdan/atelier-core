// avatar-efficience: what Marcel's first full video got wrong, as pipeline settings (record 0055), never engine limits — the
// presenter's layouts as the references measure them (split screen and inset after the hook, not 51 full-frame shots), the
// pipeline's world (French homes and equipment, euros, metric units) set when a pipeline is cloned from a French channel, and
// object-accuracy notes (the condensate pipe is a thin tube, not a corrugated duct).
import { describe, expect, it } from 'vitest'
import type { GenItem } from '../../src/engine/formats/editplan'
import { plannedLayouts } from '../../src/engine/nodes/director-layouts'
import { sceneRules } from '../../src/engine/nodes/director-scenes'
import { ScreenParams } from '../../src/engine/nodes/director-screen'
import { composePicture } from '../../src/engine/nodes/visuals-look'
import { avatarBase, fromBase, technologyRegistry } from '../../src/engine/technologies'
import { applyOptions } from '../../src/engine/technologies/compile'
import { AVATAR_PROFILE } from '../../src/engine/technologies/bases/avatar-profile'
import { withLocale } from '../../src/engine/technologies/fit-gaps'
import { measureEditing, settingsFromProfile } from '../../src/engine/technologies/reference-profile'
import { cultureLine, localeOf, notesFor } from '../../src/engine/text/locale'

const CONDENSATE = 'condensate pipe/condensate drain/drain hose: a thin 16 mm flexible white PVC tube, never a wide corrugated duct'

/** Marcel's 46 presenter runs (run 2 of 2026-11-02): about 4.3 s every 15 s over 13 minutes. */
const SLOTS = Array.from({ length: 46 }, (_, i) => ({ start: 3 + i * 16.8, end: 3 + i * 16.8 + 4.5 }))

describe('the presenter as the references lay it out', () => {
  it('measures reference 2: full frame in the hook, then split screen and inset in their shares of its time', () => {
    // reference 2's shape: four full-frame shots in the hook, then splits and insets only
    const shots = [
      { start: 0, end: 3, presenter: true },
      { start: 3, end: 10, presenter: false },
      { start: 10, end: 17, presenter: true },
      { start: 77, end: 81.3, presenter: false, withPresenter: true, layout: 'split' as const },
      { start: 81.3, end: 85, presenter: false },
      { start: 90, end: 95, presenter: false, withPresenter: true, layout: 'pip' as const },
      { start: 95, end: 105, presenter: false, withPresenter: true, layout: 'split' as const },
      { start: 105, end: 110, presenter: false }
    ]
    const p = measureEditing(shots, [])
    expect(p.presenterLayouts).toEqual({ fromS: 77, full: 0, split: 0.74, pip: 0.26 })
    // a pipeline built from it allows the inset and splits on the measured shares
    const s = settingsFromProfile(p)['director.plan']
    expect(s).toMatchObject({ presenterLayouts: p.presenterLayouts, layouts: ['full', 'split', 'pip'] })
  })

  it('avatar@1 carries its two references’ layouts as its own settings', () => {
    // the shares are unchanged; avatar-layouts adds the side, the inset's geometry and spacing measured on the same shots
    expect(AVATAR_PROFILE.presenterLayouts).toMatchObject({ fromS: 88, full: 0, split: 0.77, pip: 0.23, presenterSide: 'left', insetGapS: 45 })
    // the allowed layouts are the option « Mises en page du présentateur » since avatar-reglages-voix: its default gives these three
    const applied = applyOptions(fromBase(avatarBase), technologyRegistry())
    const director = applied.ok ? applied.doc.bricks.find((b) => b.tech === 'director.plan@1') : undefined
    expect(director?.settings).toMatchObject({ presenterLayouts: AVATAR_PROFILE.presenterLayouts, layouts: ['full', 'split', 'pip'] })
  })

  it('plans Marcel’s presenter: full frame before 1:17, then split and inset on their shares, never full again', () => {
    const l = plannedLayouts(SLOTS, { fromS: 77, full: 0, split: 0.78, pip: 0.22 }, ['full', 'split', 'pip'])
    const time = (k: string, from = 0): number => SLOTS.reduce((t, s, i) => t + (l[i] === k && s.start >= from ? s.end - s.start : 0), 0)
    expect(l.slice(0, 5).every((x) => x === 'full')).toBe(true)
    const after = time('split', 77) + time('pip', 77) + time('full', 77)
    expect(time('full', 77)).toBe(0)
    expect(Math.abs(time('split', 77) / after - 0.78)).toBeLessThan(0.05)
    expect(Math.abs(time('pip', 77) / after - 0.22)).toBeLessThan(0.05)
    // a pipeline that does not allow the inset gets splits only
    expect(plannedLayouts(SLOTS, { fromS: 77, full: 0, split: 0.78, pip: 0.22 }, ['full', 'split']).includes('pip')).toBe(false)
  })

  it('asks the scene pass for a still on every presenter sentence when the layouts are measured', () => {
    const rules = sceneRules(ScreenParams.parse({ mix: { presenter: 0.26, imageAi: 0.74 }, layouts: ['full', 'split', 'pip'], presenterLayouts: { fromS: 77, full: 0, split: 0.78, pip: 0.22 } }))
    expect(rules).toMatch(/Every sentence marked P .* ONE directive with "layout":"split", kind imageAi/u)
    expect(sceneRules(ScreenParams.parse({ mix: { presenter: 0.26, imageAi: 0.74 } }))).toMatch(/at most one sentence in three/)
  })
})

describe('the pipeline’s world (locale / culture)', () => {
  it('says France, its equipment, euros and metric units; nothing without a locale', () => {
    const line = cultureLine('fr-FR')
    expect(line).toMatch(/Set in France/)
    expect(line).toMatch(/tableau électrique/)
    expect(line).toMatch(/euros, metric units/)
    expect(line).toMatch(/never another country's appliances, panels or outlets/)
    expect(cultureLine(undefined)).toBe('')
    expect(localeOf('fr')).toBe('fr-FR')
    expect(localeOf('fr-BE')).toBe('fr-BE')
    expect(localeOf(null)).toBeNull()
  })

  it('is in the director’s rules and closes every picture prompt, with only the notes the picture names', () => {
    const rules = sceneRules(ScreenParams.parse({ mix: { presenter: 0.26, imageAi: 0.74 }, locale: 'fr-FR', objectNotes: [CONDENSATE] }))
    expect(rules).toMatch(/Set in France/)
    expect(rules).toMatch(/Draw these objects exactly as they really are:\n {2}· condensate pipe/u)
    const item = (scene: string): GenItem => ({
      id: 'i1',
      kind: 'image.gen',
      prompt: `close-up of ${scene}`,
      shot: { size: 'close-up', scene },
      constraints: { durationS: 3, aspect: '16:9' },
      context: { beatText: '', subject: scene, keyTerms: [] },
      unitPrice: 1,
      units: 1,
      priority: 1,
      shotIds: ['s1']
    })
    const hose = composePicture(item('the end of the condensate pipe at the foot of the wall'), undefined, { aspect: '16:9', locale: 'fr-FR', notes: [CONDENSATE] })
    expect(hose.prompt).toMatch(/thin 16 mm flexible white PVC tube/)
    expect(hose.prompt).toMatch(/Set in France/)
    const copper = composePicture(item('a copper pipe with a brass valve'), undefined, { aspect: '16:9', locale: 'fr-FR', notes: [CONDENSATE] })
    expect(copper.prompt).not.toMatch(/16 mm/)
    expect(notesFor('a garden hose', [CONDENSATE])).toBe('')
    expect(notesFor('a drain hose in the flowerbed', [CONDENSATE])).toBe(CONDENSATE)
    // no locale, no notes: the prompt is the director's, as before
    expect(composePicture(item('a pipe'), undefined, { aspect: '16:9' }).prompt).toBe('close-up of a pipe')
  })

  it('is set when a pipeline is cloned for a French channel, and an explicit one stays', () => {
    const doc = withLocale(fromBase(avatarBase), 'fr')
    for (const t of ['director.plan@1', 'visuals.fulfil@1']) expect(doc.bricks.find((b) => b.tech === t)?.settings.locale).toBe('fr-FR')
    const belgian = withLocale(doc, 'fr-BE')
    expect(belgian.bricks.find((b) => b.tech === 'director.plan@1')?.settings.locale).toBe('fr-FR')
    expect(withLocale(fromBase(avatarBase), null).bricks.some((b) => b.settings.locale !== undefined)).toBe(false)
  })
})
