// production-8 (decision 0035): the brick's style is the « carrosserie » of a picture. The director says what to show (shot
// size, scene); the style says how it looks (suffix, negatives, people, brands, references). Pure, no ffmpeg.
import { describe, expect, it } from 'vitest'
import { BASE_STYLES } from '../../src/main/production/styles/seeds'
import type { BrickStyle } from '../../src/shared/brick-styles'
import type { GenItem } from '../../src/engine/formats/editplan'
import { composePicture, lookOf, mentionsPerson, plainer } from '../../src/engine/nodes/visuals-look'

const style = (id: string): BrickStyle => BASE_STYLES.find((s) => s.id === id) as BrickStyle

function item(scene: string, o: Partial<GenItem> = {}): GenItem {
  return {
    id: 'i1',
    kind: 'image.gen',
    prompt: `medium shot of ${scene}, documentary photograph, natural light, never the presenter`,
    shot: { size: 'medium shot', scene },
    constraints: { durationS: 3.4, aspect: '16:9' },
    context: { beatText: 'On sort le plat du four.', subject: 'the dish', keyTerms: ['plat', 'four', 'dish', 'oven'] },
    unitPrice: 1,
    units: 1,
    priority: 1,
    shotIds: ['s1'],
    ...o
  }
}

describe('the same item under two styles', () => {
  it('gives two different prompts, both from the director’s scene, each with its own style’s look', () => {
    const it1 = item('a gloved hand takes a gratin dish out of the oven')
    const phone = composePicture(it1, lookOf(style('phone-real')), { aspect: '16:9' })
    const clean = composePicture(it1, lookOf(style('clean-stock')), { aspect: '16:9' })
    expect(phone.prompt).not.toBe(clean.prompt)
    for (const c of [phone, clean]) expect(c.prompt.startsWith('medium shot of a gloved hand takes a gratin dish out of the oven')).toBe(true)
    expect(phone.prompt).toContain(style('phone-real').promptSuffix)
    expect(clean.prompt).toContain(style('clean-stock').promptSuffix)
    // the director's own suffix gives way to the style's
    expect(phone.prompt).not.toContain('documentary photograph')
    // the negatives are the style's (and its brand rule: clean-stock has no brands)
    expect(phone.negative).toContain('extra or fused fingers')
    expect(clean.negative).toContain('logos')
    expect(clean.prompt).toContain('plain unbranded packaging')
    expect(phone.prompt).not.toContain('unbranded')
  })

  it('without a look nor a rule, the director’s prompt is sent as it is (pipelines made before production-8)', () => {
    const it1 = item('a dish')
    expect(composePicture(it1, undefined, { aspect: '16:9' })).toEqual({ prompt: it1.prompt, negative: undefined, presenter: false, room: false })
  })

  it('the look keeps the style’s version and the reference uses', () => {
    expect(lookOf(style('phone-real'), 3)).toMatchObject({ style: 'phone-real@3', people: 'not-presenter', brands: 'real', references: ['room-shots'] })
  })
})

describe('people rules are enforced by code', () => {
  const SCENES = [
    'a gloved hand takes a gratin dish out of the oven',
    'the presenter scrubs a burnt pan in the sink',
    'an elderly woman reads a label, her fingers on the jar',
    'two children laugh at the table, a cake in front of them',
    'a man in an apron, close on his face, tasting the sauce',
    'close-up of a burnt pan; someone pours baking soda into it',
    'the presenter’s kitchen, wide, morning light',
    'a plumber kneels under the sink with a wrench',
    'a student revising at a desk, open notebook',
    'face-to-face at the counter, two mugs',
    'a thumb presses the button, the kettle lights up'
  ]

  it('« personne »: no person, no hand, not even in the style’s words, whatever the scene pass wrote', () => {
    for (const s of BASE_STYLES.filter((x) => x.family === 'image')) {
      for (const scene of SCENES) {
        const c = composePicture(item(scene), lookOf(s), { people: 'nobody', aspect: '16:9' })
        expect(mentionsPerson(c.prompt), `${s.id}: ${c.prompt}`).toBe(false)
        expect(c.prompt).toContain('an empty scene with objects only')
        expect(c.negative).toContain('people')
        expect(c.negative).toContain('hands')
        expect(c.presenter).toBe(false)
      }
    }
    // without a look, the director's whole prompt is cleaned the same way
    for (const scene of SCENES) expect(mentionsPerson(composePicture(item(scene), undefined, { people: 'nobody', aspect: '16:9' }).prompt)).toBe(false)
  })

  it('a phone-camera « hand-held » framing is not a person', () => {
    expect(mentionsPerson('hand-held framing at eye level')).toBe(false)
    expect(mentionsPerson('a hand holds the jar')).toBe(true)
  })

  it('« d’autres personnes »: the presenter is never named, someone else does it', () => {
    const c = composePicture(item('the presenter scrubs a burnt pan in the sink'), lookOf(style('phone-real')), { people: 'not-presenter', aspect: '16:9' })
    expect(c.prompt).not.toMatch(/presenter/i)
    expect(c.prompt).toContain('a person scrubs a burnt pan')
    expect(c.negative).toContain("the presenter's face")
    expect(c.presenter).toBe(false)
  })

  it('« le présentateur joue l’action »: the portrait rides on the shots where someone acts, not on still lifes', () => {
    const look = lookOf(style('phone-real'))
    const acts = composePicture(item('the presenter scrubs a burnt pan in the sink'), look, { people: 'presenter-as-actor', aspect: '16:9' })
    expect(acts.presenter).toBe(true)
    expect(acts.prompt).toContain('the person is the one in the reference portrait')
    const still = composePicture(item('a burnt pan on a wooden table'), look, { people: 'presenter-as-actor', aspect: '16:9' })
    expect(still.presenter).toBe(false)
    expect(still.prompt).not.toContain('reference portrait')
  })

  it('the setting wins over the style (« Qui apparaît », « Marques »)', () => {
    const c = composePicture(item('a jar of jam'), lookOf(style('clean-stock')), { people: 'nobody', brands: 'real', aspect: '16:9' })
    expect(c.prompt).not.toContain('unbranded')
  })

  it('the room rides on a style that shoots in the room, on shots of the room', () => {
    const look = lookOf(style('phone-real'))
    expect(composePicture(item('the kitchen counter after dinner'), look, { aspect: '16:9' }).room).toBe(true)
    expect(composePicture(item('a jar of jam'), look, { aspect: '16:9' }).room).toBe(false)
    expect(composePicture(item('a jar of jam'), lookOf(style('clean-stock')), { aspect: '16:9' }).room).toBe(false)
  })

  it('a vertical list asks for a vertical composition', () => {
    expect(composePicture(item('a jar'), lookOf(style('phone-real')), { aspect: '9:16' }).prompt).toContain('vertical 9:16 composition')
  })
})

describe('after a refusal', () => {
  it('the plainer rewrite drops names, quotes, words of violence and the style’s sentences', () => {
    const p = plainer('medium shot of "Marie Curie" holding a knife near burning oil. Photo taken with a phone camera')
    expect(p).not.toMatch(/Marie|Curie|knife|burning|"|Photo taken/)
    expect(p).toContain('medium shot of')
  })
})
