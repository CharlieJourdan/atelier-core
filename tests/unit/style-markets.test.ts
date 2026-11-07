// style-markets, the documentary base: the
// references without a presenter but with archives and cards land on it; the director frames archives and places maps, data cards and
// timelines on their words within the cards' share (director-cards.ts), the plan checks out, and a card is the base shot itself.
import { describe, expect, it } from 'vitest'
import type { Directive, DirectiveFrame } from '../../src/engine/formats/directives'
import { checkEditPlan, type EditPlan, type GenItem, type GenList, type Shot } from '../../src/engine/formats/editplan'
import { checkMotion } from '../../src/engine/formats/motion'
import type { Beat, Word } from '../../src/engine/formats/timing'
import { archiveProps, placeCards, wordOn } from '../../src/engine/nodes/director-cards'
import type { DirectorParams } from '../../src/engine/nodes/director-cuts'
import { directorPlan } from '../../src/engine/nodes/director-plan'
import { sceneRules } from '../../src/engine/nodes/director-scenes'
import { ScreenParams } from '../../src/engine/nodes/director-screen'
import { DOCUMENTARY_PROFILE } from '../../src/engine/technologies'
import { settingsFromProfile } from '../../src/engine/technologies/reference-profile'
import type { VideoMeasure } from '../../src/engine/technologies/fit'
import { baseForReferences } from '../../src/engine/technologies/style-propose'
import { art, makeCtx } from './engine-node-helpers'
import { makeFrenchFilm } from './film-fixture-fr12'

describe('the references pick the documentary base', () => {
  const ref = (o: Partial<VideoMeasure>): VideoMeasure => ({ presenterShare: 0, ...o }) as VideoMeasure
  // documentary-2: archive references now get the measured archive documentary 
  it('archives and cards without a presenter → documentary@2; plain stills → voiceover@1; a presenter → avatar@1', () => {
    expect(baseForReferences([ref({ kinds: { archive: 0.7, motion: 0.2 } }), ref({ kinds: { archive: 0.5, motion: 0.15, imageAi: 0.35 } })])).toEqual({ baseId: 'documentary@2', reason: 'documentary' })
    expect(baseForReferences([ref({ lookFamily: 'archive' }), ref({ lookFamily: 'archive' }), ref({ lookFamily: 'photoreal' })]).baseId).toBe('documentary@2')
    expect(baseForReferences([ref({ kinds: { imageAi: 0.8, stock: 0.2 } })])).toEqual({ baseId: 'voiceover@1', reason: 'no-presenter' })
    expect(baseForReferences([ref({ presenterShare: 0.3, kinds: { archive: 0.7 } })]).baseId).toBe('avatar@1')
  })
})

/** Ten sentences of four words, one second a word. */
function film(): { words: Word[]; sentences: { n: number; first: number; last: number; start: number; end: number }[]; beats: Beat[] } {
  const texts = ['In 1940 Europe burned', 'Switzerland stood alone there', 'Berlin sent its complaints', 'Bern answered with silence', 'The bank held gold', 'Losses reached five hundred', 'Then one point seven', 'Nobody saw it coming', 'The crash came fast', 'History repeats its lessons']
  const words: Word[] = []
  texts.forEach((t, s) => t.split(' ').forEach((w) => words.push({ w, start: words.length, end: words.length + 0.9, sentence: s, paragraph: Math.floor(s / 5) } as Word)))
  const sentences = texts.map((_, i) => ({ n: i + 1, first: i * 4, last: i * 4 + 3, start: i * 4, end: i * 4 + 4 }))
  return { words, sentences, beats: [{ i: 0, start: 0, end: 40, firstWord: 0, lastWord: 39, text: '' } as unknown as Beat] }
}
/** One archive still per sentence. */
function track(): { shots: Shot[]; items: GenItem[] } {
  const shots: Shot[] = []
  const items: GenItem[] = []
  for (let i = 0; i < 10; i++) {
    const id = `s${i}`
    shots.push({ id, track: 'base', startFrame: i * 120, endFrame: (i + 1) * 120, kind: 'stock.photo', genItem: `item-${i}`, motion: { kind: 'push', from: 1.02, to: 1.14 }, transitionIn: 'cut', role: 'scene', beat: 0 })
    items.push({ id: `item-${i}`, kind: 'stock.photo', query: 'x', constraints: { durationS: 4, aspect: '16:9' }, context: { beatText: '', subject: `subject ${i}`, keyTerms: [] }, unitPrice: 0, units: 1, priority: 0, shotIds: [id] })
  }
  return { shots, items }
}

describe('the director places the documentary cards', () => {
  const map: Directive = {
    sentence: 2,
    anchor: 'Switzerland stood',
    kind: 'motion.map',
    subject: 'Switzerland in 1940',
    card: { template: 'map', hold: 3, props: { kicker: '1940', title: 'Complaints to Bern', regions: [{ countries: ['CHE'], tone: 'gold', on: 'Switzerland' }], pins: [{ label: 'Berlin', lat: 52.52, lon: 13.4, on: 'Berlin' }, { label: 'Bern', lat: 46.95, lon: 7.45, on: 'Bern' }] } },
    why: 'a place'
  }
  const parts = [{ fromS: 0, toS: 40, shares: { archive: 0.75, motion: 0.25 } }]

  it('turns a map directive into a base card from its anchor over its held sentences, its parts on their words', () => {
    const f = film()
    const t = track()
    const r = placeCards({ ...t, framed: new Map(), directives: [map], words: f.words, sentences: f.sentences, beats: f.beats, parts, D: 40 })
    const card = r.shots.find((s) => s.kind === 'motion')
    // cut 3 frames before « Switzerland » (4 s), held to the end of « Bern answered with silence » (16 s)
    expect(card).toMatchObject({ track: 'base', startFrame: 117, endFrame: 480, transitionIn: 'dissolve' })
    const props = (card?.graphic as { props: { regions: { atS?: number }[]; pins: { atS?: number }[] } }).props
    // « Switzerland » at 4 s, « Berlin » at 8 s, « Bern » at 12 s, the card starting at 3.9 s
    expect(props.regions[0]?.atS).toBeCloseTo(0.3, 5)
    expect(props.pins.map((p) => p.atS)).toEqual([4.1, 8.1])
    expect(checkMotion(card?.graphic, 12)).toEqual([])
    // the three pictures under it are gone with their items; the next one cross-fades in
    expect(r.items.map((i) => i.id)).toEqual(['item-0', 'item-4', 'item-5', 'item-6', 'item-7', 'item-8', 'item-9'])
    expect(r.shots.find((s) => s.id === 's4')?.transitionIn).toBe('dissolve')
    expect(r.diagnostics.join(' ')).toMatch(/1 map\/data\/timeline card/)
  })

  it('keeps the cards within their share and never two side by side', () => {
    const f = film()
    const bars: Directive = { sentence: 6, anchor: 'Losses reached', kind: 'motion.bars', subject: 'losses', card: { template: 'bars', hold: 2, props: { title: 'LOSSES', rows: [{ label: 'US', value: 500, display: '$500B', on: 'five' }, { label: 'WORLD', value: 1700, display: '$1.7T', accent: true, on: 'seven' }] } }, why: 'figures' }
    const r = placeCards({ ...track(), framed: new Map(), directives: [map, bars], words: f.words, sentences: f.sentences, beats: f.beats, parts: [{ fromS: 0, toS: 40, shares: { archive: 0.8, motion: 0.2 } }], D: 40 })
    // a 10 s budget (×1.25): the 12 s map is over it, the 8 s data card fits
    expect(r.shots.filter((s) => s.kind === 'motion').map((s) => (s.graphic as { template: string }).template)).toEqual(['bars'])
    expect(r.diagnostics.join(' ')).toMatch(/over the cards' share/)
  })

  it('frames an archive around its own picture, and a plain full frame stays a still', () => {
    const f = film()
    const framed = new Map<string, DirectiveFrame>([
      ['s1', { frame: 'board', label: 'Henri Guisan', sub: 'General, 1940' }],
      ['s2', { frame: 'paper', excerpt: 'Switzerland will defend itself', mark: 'defend itself', source: 'FEDERAL ARCHIVES · 1940' }],
      ['s3', { frame: 'full' }]
    ])
    const r = placeCards({ ...track(), framed, directives: [], words: f.words, sentences: f.sentences, beats: f.beats, parts, D: 40 })
    expect(r.shots.filter((s) => s.kind === 'motion').map((s) => [s.id, s.genItem, (s.graphic as { props: { frame: string } }).props.frame])).toEqual([
      ['s1', 'item-1', 'board'],
      ['s2', 'item-2', 'paper']
    ])
    expect(r.items).toHaveLength(10)
    expect(archiveProps({ frame: 'paper', excerpt: 'a b c', mark: 'not in it' }, undefined)).not.toHaveProperty('mark')
  })

  it('a card is the base shot: the checker wants it on the base track, its picture item a still', () => {
    const t = track()
    const shots = t.shots.map((s, i) => (i === 1 ? { ...s, kind: 'motion' as const, graphic: { template: 'archive', props: { frame: 'board', label: 'X' } } } : s))
    const plan = { schema: 'atelier.editplan/1', fps: 30, size: [1920, 1080], frames: 1200, tracks: { base: shots.map((s) => s.id), overlay: [], labels: [] }, captionsPreset: 'x', shots, chapters: [], diagnostics: [] } as unknown as EditPlan
    const list = { schema: 'atelier.genlist/1', items: t.items, totals: { credits: 0, items: 10, byKind: {} }, budget: null } as unknown as GenList
    expect(checkEditPlan(plan, list, 1200)).toEqual([])
    const onOverlay = { ...plan, tracks: { ...plan.tracks, base: plan.tracks.base.filter((id) => id !== 's1'), overlay: ['s1'] }, shots: plan.shots.map((s) => (s.id === 's1' ? { ...s, track: 'overlay' as const } : s)) }
    expect(checkEditPlan(onOverlay, list, 1200).join(' ')).toMatch(/card s1 is not on the base track/)
  })

  it('finds a part\'s words, a number written in figures included', () => {
    const f = film()
    expect(wordOn(f.words, 0, 39, 'Bern answered')).toBe(12)
    expect(wordOn(f.words, 0, 39, 'nowhere')).toBeNull()
  })

  it('tells the scene pass about cards and archive frames only when the pipeline makes them', () => {
    const on = sceneRules(ScreenParams.parse({ mix: { archive: 0.8, motion: 0.2 }, cards: true, illustration: 'documentary-archive', people: 'anyone' }))
    expect(on).toMatch(/motion\.map/)
    expect(on).toMatch(/"frame"/)
    expect(on).toMatch(/A real named person only in a found archive/)
    expect(sceneRules(ScreenParams.parse({ mix: { archive: 1 } }))).not.toMatch(/motion\.map/)
  })
})

describe('the documentary director on a 12-minute narration (fake)', () => {
  it('frames archives, places a data card where figures are said, cross-fades on new sentences, and the plan checks out', async () => {
    const FILM = makeFrenchFilm(720)
    // the archive documentary's director settings: the measured general ones, without the presenter's grammar
    const { presenterOnTalk: _talk, illustration: _literal, ...general } = settingsFromProfile(DOCUMENTARY_PROFILE)['director.plan']
    const settings = { ...general, illustration: 'documentary-archive', cards: true, transitions: DOCUMENTARY_PROFILE.dissolveShare >= 0.25 ? 'sentence' : 'paragraph' }
    const p = directorPlan.params.parse({ screen: { mix: { archive: 0.65, imageAi: 0.15, motion: 0.2, curve: 'flat', shotLengthS: { archive: 5.5, imageAi: 5.5 } }, ...settings }, labelsPerMin: 0 }) as DirectorParams
    const out = await directorPlan.fake(makeCtx({}), {
      beats: art('json.beats', { value: FILM.beats as never }),
      words: art('json.words', { value: FILM.words as never, meta: { durationS: FILM.durationS, alignment: 'provider', matched: 1, language: 'fr' } }),
      outline: art('json.outline', { value: FILM.outline as never })
    }, p)
    const plan = out.plan?.value as unknown as EditPlan
    const list = out.genlist?.value as unknown as GenList
    expect(checkEditPlan(plan, list, plan.frames)).toEqual([])
    const base = plan.tracks.base.map((id) => plan.shots.find((s) => s.id === id) as Shot)
    const templates = base.filter((s) => s.kind === 'motion').map((s) => (s.graphic as { template: string }).template)
    expect(templates.filter((t) => t === 'archive').length).toBeGreaterThan(10)
    // a French video's data card speaks French, its figures without the clause's punctuation (clonage-traduction)
    const bars = base.filter((s) => s.kind === 'motion' && (s.graphic as { template: string }).template === 'bars').map((s) => (s.graphic as { props: { title: string; rows: { label: string; display: string }[] } }).props)
    expect(bars.length).toBeGreaterThan(0)
    for (const b of bars) {
      expect(b.title).toBe('LES CHIFFRES')
      for (const r of b.rows) {
        expect(r.label).toMatch(/^CHIFFRE \d$/)
        expect(r.display).not.toMatch(/[.,]$/)
      }
    }
    expect(base.some((s) => s.kind === 'avatar')).toBe(false)
    // about two changes in five are cross-fades (on sentences), like the references
    const soft = base.filter((s) => s.transitionIn === 'dissolve').length / base.length
    expect(soft).toBeGreaterThan(0.25)
    expect(plan.tracks.labels).toEqual([])
  })
})

describe('an archive card is captioned by what was found', () => {
  it('a painting gets its own title and maker, a print keeps the narration\'s name, a made picture gets no caption', async () => {
    const { captioned } = await import('../../src/engine/nodes/motion-cards')
    const found = { title: 'Fruit Still Life with Shells and Tulip', creator: 'Balthasar van der Ast' }
    // the director guessed « Hans Bollongier, 1639 » before the search found another painting
    expect(captioned({ frame: 'full', label: 'Still life with flowers', sub: 'Hans Bollongier, 1639', punch: 'WORTH A HOUSE' }, found)).toEqual({ frame: 'full', label: found.title, sub: found.creator, punch: 'WORTH A HOUSE' })
    expect(captioned({ frame: 'board', label: 'Lucas de Clercq', sub: 'a guess' }, { title: 'Portrait of Lucas de Clercq', creator: 'Frans Hals' })).toEqual({ frame: 'board', label: 'Lucas de Clercq', sub: 'Frans Hals' })
    // the search found a satire print, not the tulip the narration names: the print's own title, never « Semper Augustus »
    expect(captioned({ frame: 'board', label: 'Semper Augustus' }, { title: 'Graf kelder der Verongelukte Actionisten', creator: 'Anonymous' })).toEqual({ frame: 'board', label: 'Graf kelder der Verongelukte Actionisten', sub: 'Anonymous' })
    expect(captioned({ frame: 'paper', excerpt: 'x', source: 'A GUESS' }, found)).toEqual({ frame: 'paper', excerpt: 'x', source: 'FRUIT STILL LIFE WITH SHELLS AND TULIP · BALTHASAR VAN DER AST' })
    expect(captioned({ frame: 'full', label: 'Wall Street, 1929', sub: 'a guess', lines: ['Panic.'] }, undefined)).toEqual({ frame: 'full', lines: ['Panic.'] })
  })
})
