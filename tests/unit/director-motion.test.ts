// director-motion: the director writes the motion kit's cards and the camera follows what was measured on the reference.
import { describe, expect, it } from 'vitest'
import { DocumentCardProps, PrintsCardProps } from '../../src/engine/formats/cards'
import { checkEditPlan } from '../../src/engine/formats/editplan'
import { MotionSpec, checkMotion } from '../../src/engine/formats/motion'
import { glideExpr, cameraFilter } from '../../src/engine/render/camera'
import { segmentArgs, type SegmentSpec } from '../../src/engine/render/segments'
import { printsCard } from '../../src/engine/motion/doc-prints'
import { documentCard } from '../../src/engine/motion/doc-highlight'
import { buildDoc2 } from '../../src/engine/nodes/director-doc2'
import { boardMove, filmMove, map3dProps, mapCamera, spreadRegions, stillMove } from '../../src/engine/nodes/doc2-map'
import { DOC2_PROFILE } from '../../src/engine/nodes/doc2-profile'
import { checkScene, factSaid, lenientScene, type Doc2Scene } from '../../src/engine/nodes/doc2-scene'
import { seededRng, sequenceDoc2, sequenceProblems, type Doc2Slot } from '../../src/engine/nodes/doc2-sequence'
import { buildCueSheet, voicePauses } from '../../src/engine/nodes/sound-music'
import type { Word } from '../../src/engine/formats/timing'

const P = DOC2_PROFILE
const ctx = { width: 1920, height: 1080, durationS: 8 } as Parameters<typeof printsCard>[1]
const map = (over: Partial<NonNullable<Doc2Scene['map']>> = {}): NonNullable<Doc2Scene['map']> => ({ title: 'Europe', center: { lat: 47, lon: 8 }, zoom: 5, regions: [], pins: [], routes: [], facts: [], ...over })
const atNone = (): undefined => undefined

describe('the measured camera', () => {
  it('a still zooms 9 % at one even speed whatever its length, sometimes out, never a pan', () => {
    const moves = Array.from({ length: 200 }, (_, i) => stillMove(P, seededRng(`s${i}`)))
    for (const m of moves) {
      expect(m.ease).toBe('linear')
      expect(['push', 'pull']).toContain(m.kind)
      expect(Math.max(m.from, m.to)).toBeCloseTo(1.09)
    }
    const out = moves.filter((m) => m.kind === 'pull').length / moves.length
    expect(out).toBeGreaterThan(0.03)
    expect(out).toBeLessThan(0.2)
  })
  it('a linear move has no eased ends in its filter', () => {
    const f = cameraFilter({ kind: 'push', from: 1, to: 1.09, ease: 'linear' }, 150)
    expect(f).not.toContain('cos')
    expect(f).toContain('perspective=')
    expect(glideExpr(150)).not.toBe(f)
  })
  it('a film pushes 0.9 % a second', () => {
    expect(filmMove(P, 4).to).toBeCloseTo(1.036)
    expect(filmMove(P, 4).ease).toBe('linear')
  })
  it('a film in the old-TV frame is pushed by a sub-pixel camera, not stepped by a scale filter', () => {
    const s = { shotId: 'a', frames: 120, image: 'x.jpg', clip: { file: 'c.mp4', durationS: 4 }, film: 'tv', filmMask: 'm.png', motion: filmMove(P, 4), grade: 'archive-film', dipIn: false, dipOut: false } as unknown as SegmentSpec
    const graph = segmentArgs(s, 'o.mp4').join(' ')
    expect(graph).toContain('perspective=')
    expect(graph).not.toContain('trunc(iw')
  })
  it('a film that fills the frame gets the same push; an ordinary clip does not', () => {
    const base = { shotId: 'a', frames: 120, image: 'x.jpg', clip: { file: 'c.mp4', durationS: 4 }, motion: filmMove(P, 4), grade: 'none', dipIn: false, dipOut: false } as unknown as SegmentSpec
    expect(segmentArgs({ ...base, film: 'full' }, 'o.mp4').join(' ')).toContain('perspective=')
    expect(segmentArgs(base, 'o.mp4').join(' ')).not.toContain('perspective=')
  })
  it('boards hold: a centred print almost never moves, a large one sometimes settles by a measured amount', () => {
    // (qualite-montage) measured on boards up to the hold limit; a longer board always settles (nothing held ~5 s with nothing moving)
    const count = (pattern: string, s = 4): number => Array.from({ length: 400 }, (_, i) => boardMove(P, pattern, s, seededRng(`${pattern}${i}`))).filter((m) => m.move === 'settle').length / 400
    expect(count('print-centre')).toBeLessThan(0.1)
    expect(count('print-centre', P.camera.holdMaxS + 0.5)).toBe(1)
    expect(count('print-large')).toBeGreaterThan(0.3)
    expect(count('print-large')).toBeLessThan(0.6)
    const z = boardMove({ ...P, camera: { ...P.camera, settleShare: { large: 1, several: 1, small: 1 } } }, 'print-large', 30, seededRng('x'))
    expect(z.moveZoom).toBeLessThanOrEqual(P.camera.settleMax)
  })
  it('a map arrives with a move near ×1.9, later ones near ×1.3, settled at 55 % of the shot', () => {
    const move = (arrival: boolean): number[] => {
      const k = mapCamera(map(), { d: 8, arrival, rnd: () => 0.9, P, atOf: atNone })
      expect(k[1]?.atS).toBeCloseTo(4.4)
      return k.map((x) => x.zoom)
    }
    expect(2 ** ((move(true)[1] as number) - (move(true)[0] as number))).toBeCloseTo(1.9, 1)
    expect(2 ** ((move(false)[1] as number) - (move(false)[0] as number))).toBeCloseTo(1.3, 1)
    const out = mapCamera(map(), { d: 8, arrival: true, rnd: () => 0, P, atOf: atNone })
    expect(out[1]?.zoom).toBeLessThan(out[0]?.zoom as number)
  })
})

describe('the map card', () => {
  it('a region of many countries spreads over about 1.5 s, in the order given', () => {
    const r = spreadRegions([{ countries: ['Poland', 'France', 'Belgium', 'Netherlands', 'Denmark', 'Norway'], tone: 'red', label: 'Axis', on: 'Axis' }], () => 2, 1.5)
    expect(r.length).toBe(3)
    expect(r[0]?.countries).toEqual(['Poland', 'France'])
    expect(r[0]?.label).toBe('Axis')
    expect(r[1]?.label).toBeUndefined()
    expect(r.map((x) => x.atS)).toEqual([2, 2.5, 3])
  })
  it('never more regions than the card holds', () => {
    const many = Array.from({ length: 4 }, () => ({ countries: Array.from({ length: 12 }, (_, i) => `C${i}`), tone: 'red' as const }))
    expect(spreadRegions(many, atNone, 1.5).length).toBeLessThanOrEqual(6)
  })
  it('a route draws along its way while the camera opens from its start', () => {
    const route = { from: { lat: 52, lon: 13 }, to: { lat: 47, lon: 8 }, via: [{ lat: 50, lon: 9 }], on: 'marched' }
    const props = map3dProps(map({ routes: [route] }), { d: 8, arrival: true, rnd: () => 0.9, P, look: 'satellite', atOf: () => 1 })
    const parsed = MotionSpec.parse({ template: 'map3d', props, accent: '#cc3333', theme: 'dark' })
    const cam = (parsed.props as { camera: { keys: { center: { lat: number } }[] } }).camera
    expect(cam.keys[0]?.center.lat).toBe(52)
    const r = (parsed.props as { routes: { via: unknown[]; drawS: number }[] }).routes[0]
    expect(r?.via.length).toBe(1)
    expect(r?.drawS).toBe(3.5)
  })
  it('places said one after the other are visited on their words in a long shot', () => {
    const m = map({ pins: [{ lat: 46, lon: 7, label: 'Bern' }, { lat: 47, lon: 8.5, label: 'Zurich' }] })
    const keys = mapCamera(m, { d: 10, arrival: true, rnd: () => 0.9, P, atOf: (on) => (on === 'Bern' ? 3 : on === 'Zurich' ? 6 : undefined) })
    // (qualite-montage) then the camera creeps on to the shot's end: a map never stops before its cut
    expect(keys.map((k) => k.atS)).toEqual([0, 2.7, 5.7, 9.65])
    // every camera the grammar writes passes the card's own check (qualite-montage q4: a key at the card's very end turned all maps to film)
    for (const d of [3.9, 4.1, 6, 9.2]) {
      for (const mm of [m, map({}), map({ routes: [{ from: { lat: 52, lon: 13 }, to: { lat: 47, lon: 8 }, via: [], on: 'x' }] })]) {
        const props = map3dProps(mm, { d, arrival: true, rnd: () => 0.9, P, look: 'satellite', atOf: () => 1 })
        expect(checkMotion({ template: 'map3d', props, accent: '#cc3333', theme: 'dark' } as never, d)).toEqual([])
      }
    }
    expect(keys[2]?.center.lon).toBe(8.5)
  })
  it('fact boxes are written with their figure, kept only when said', () => {
    expect(factSaid('26 CANTONS', 'Switzerland has twenty-six cantons and four languages')).toBe(true)
    expect(factSaid('4 LANGUAGES', 'Switzerland has twenty-six cantons and four languages')).toBe(true)
    expect(factSaid('9 CANTONS', 'Switzerland has twenty-six cantons')).toBe(false)
    expect(factSaid('26 ARMIES', 'Switzerland has twenty-six cantons')).toBe(false)
    const { scene, dropped } = checkScene({ sentence: 1, map: map({ facts: [{ text: '26 CANTONS' }, { text: '9 BANKS' }] }) }, 'twenty-six cantons', 'twenty-six cantons')
    expect(scene.map?.facts.map((f) => f.text)).toEqual(['26 CANTONS'])
    expect(dropped).toContain('1 map fact(s)')
  })
  it('a document the model gave without a title keeps its marked words as its title', () => {
    const s = lenientScene({ sentence: 1, document: { on: 'timetables', text: 'The timetables were written', mark: 'timetables were written', scan: 'Operation Tannenbaum timetable 1940' } })
    expect(s?.document?.title).toBe('timetables were written')
    expect(s?.document?.scan).toBe('Operation Tannenbaum timetable 1940')
  })
  it('a route written with loose waypoints and facts as plain strings still reads', () => {
    const s = lenientScene({ sentence: 1, map: { title: 'X', lat: 47, lon: 8, zoom: 12, routes: [{ from: [52, 13], to: { lat: 47, lng: 8 }, via: [[50, 9], 'x'] }], facts: ['26 CANTONS'] } })
    expect(s?.map?.routes[0]?.via).toEqual([{ lat: 50, lon: 9 }])
    expect(s?.map?.facts[0]?.text).toBe('26 CANTONS')
  })
})

describe('variety', () => {
  const slots = (n: number): Doc2Slot[] => Array.from({ length: n }, (_, i) => ({ sentence: i + 1, start: i * 4, end: (i + 1) * 4, part: 0, scene: { sentence: i + 1, film: `film ${i}` } }))
  it('no pattern three times in a row, even when the words only give films', () => {
    const units = sequenceDoc2(slots(120), { seed: '7' })
    expect(sequenceProblems(units).filter((p) => p.includes('three times'))).toEqual([])
    expect(units.some((u) => u.pattern !== 'film')).toBe(true)
  })
  it('a stretch too short for a board is a still', () => {
    const short = Array.from({ length: 30 }, (_, i) => ({ sentence: i + 1, start: i * 2, end: (i + 1) * 2, part: 0, scene: { sentence: i + 1, film: `film ${i}` } }))
    const units = sequenceDoc2(short, { seed: '1' })
    expect(units.some((u) => u.pattern === 'still')).toBe(true)
    expect(sequenceProblems(units).filter((p) => p.includes('three times'))).toEqual([])
  })
  it('the first map comes early when the words give one, whatever the share', () => {
    const s = slots(30).map((x, i) => (i === 5 ? { ...x, scene: { ...x.scene, map: map() } } : x))
    expect(sequenceDoc2(s, { seed: '2', profile: { ...P, hookShares: { ...P.hookShares, map: 0.01 } } }).some((u) => u.pattern === 'map')).toBe(true)
  })
})

describe('the plan', () => {
  const words: Word[] = 'The price rose twenty times in a year and the banks of Bern kept every coin they had'.split(' ').map((w, i) => ({ w, start: i * 0.4, end: i * 0.4 + 0.35 })) as Word[]
  const sentences = [{ n: 1, first: 0, last: words.length - 1, start: 0, end: 7.2, text: words.map((w) => w.w).join(' ') }] as never
  const beats = [{ i: 0, start: 0, end: 7.2, firstWord: 0, lastWord: words.length - 1, text: '', tags: [], keyTerms: [] }] as never
  const build = (pattern: string, scene: Partial<Doc2Scene>, seed = 'a', spoken: Parameters<typeof buildDoc2>[0]['spoken'] = []): ReturnType<typeof buildDoc2> =>
    buildDoc2({ units: [{ pattern: pattern as never, start: 0, end: 7.2, slots: [{ sentence: 1, start: 0, end: 7.2, part: 0, scene: { sentence: 1, ...scene } }] }], words, sentences, beats, D: 7.2, seed, spoken })
  it('a film carries its measured push, a colour one keeps its colours', () => {
    const b = build('film', { film: 'bank vault 1940', colour: true })
    const film = b.shots.find((s) => s.kind === 'stock.video')
    expect(film?.motion?.ease).toBe('linear')
    expect(film?.colour).toBe(true)
  })
  it('a factor said aloud is written on its word in the serif, over the film', () => {
    const b = build('film', { film: 'bank vault 1940' }, 'a', [{ first: 3, last: 4, atS: 1.2, endS: 2, value: 20, kind: 'times', text: '×20' }])
    const k = b.shots.find((s) => s.id.startsWith('k'))
    expect(k?.track).toBe('overlay')
    expect(k?.startFrame).toBe(Math.round(1.05 * 30))
    const g = MotionSpec.parse(k?.graphic) as { props: { face: string; words: { text: string }[] } }
    expect(g.props.face).toBe('serif')
    expect(g.props.words[0]?.text).toBe('×20')
  })
  it('no factor beside a figure already written', () => {
    const b = build('film', { film: 'x', number: { text: '20' } }, 'a', [{ first: 3, last: 4, atS: 1.2, endS: 2, value: 20, kind: 'times', text: '×20' }])
    expect(b.shots.filter((s) => s.id.startsWith('k'))).toEqual([])
  })
  it('a document with a scan asks for the picture and keeps its typed page behind', () => {
    const b = build('document', { document: { title: 'Order', text: 'the banks kept every coin', mark: 'every coin', scan: 'Swiss bank order 1940' } })
    const card = b.shots.find((s) => s.kind === 'motion' && (s.graphic as { template: string }).template === 'document')
    expect(card?.genItem).toBeDefined()
    expect(b.items.find((i) => i.id === card?.genItem)?.query).toBe('Swiss bank order 1940')
    const props = DocumentCardProps.parse((card?.graphic as { props: unknown }).props)
    expect(props.scan?.find).toContain('every coin')
    expect(props.text).toBeDefined()
  })
  it('a board may play a film inside its print and the plan check accepts it; another card may not', () => {
    const hook = { ...P, printFilm: { hook: 1, body: 1 } }
    const b = buildDoc2({ units: [{ pattern: 'print-centre', start: 0, end: 7.2, slots: [{ sentence: 1, start: 0, end: 7.2, part: 0, scene: { sentence: 1, film: 'bern street 1930' } }] }], words, sentences, beats, D: 7.2, seed: 'a', profile: hook })
    const card = b.shots.find((s) => s.kind === 'motion')
    expect(b.items[0]?.kind).toBe('stock.video')
    const pr = PrintsCardProps.parse((card?.graphic as { props: unknown }).props)
    expect(pr.prints[0]?.film).toBe(true)
    const plan = { size: [1920, 1080], frames: 216, tracks: { base: [card?.id], overlay: [], labels: [] }, shots: [card], chapters: [] } as never
    const list = { items: b.items, totals: { credits: 0, items: 1, byKind: {} }, budget: null } as never
    expect(checkEditPlan(plan, list, 216).filter((p) => p.includes('frames a'))).toEqual([])
    const noFilm = { ...(card as object), graphic: { template: 'prints', props: { prints: [{ atS: 0.15 }], layout: 'centre' }, accent: '#aa0000', theme: 'dark' } }
    const bad = { size: [1920, 1080], frames: 216, tracks: { base: [card?.id], overlay: [], labels: [] }, shots: [noFilm], chapters: [] } as never
    expect(checkEditPlan(bad, list, 216).some((p) => p.includes('frames a stock.video'))).toBe(true)
  })
})

describe('the cards', () => {
  const printsProps = (over: Record<string, unknown>): PrintsCardProps => PrintsCardProps.parse({ prints: [{ atS: 0.15 }, { atS: 2.5 }], ...over })
  it('a held board has no zoom, a settling one the soft ease', () => {
    expect(printsCard(printsProps({ move: 'still' }), ctx, {}).body).not.toContain('data-zoom')
    expect(printsCard(printsProps({ move: 'settle', moveZoom: 0.08 }), ctx, {}).body).toContain('data-ease="settle"')
  })
  it('a board with reflow starts its first print large and alone, then glides as the next lands', () => {
    const b = printsCard(printsProps({ move: 'still', reflow: true }), ctx, {}).body
    expect(b).toContain('data-reframe=')
    expect(b).toContain('data-at="2.35"')
    expect(printsCard(PrintsCardProps.parse({ prints: [{ atS: 0.15 }, { atS: 0.6 }], reflow: true, move: 'still' }), ctx, {}).body).not.toContain('data-reframe=')
  })
  it('a film inside a print flips its frames; without frames it stays a photograph', () => {
    const p = PrintsCardProps.parse({ prints: [{ atS: 0.15, film: true }], layout: 'centre', move: 'still' })
    expect(printsCard(p, ctx, { films: [['a', 'b', 'c']], filmFps: 10 }).body).toContain('data-flip="10"')
    expect(printsCard(p, ctx, {}).body).not.toContain('data-flip')
  })
  it('a scan card with its key line goes pale around it and reads from the first frame', () => {
    const p = DocumentCardProps.parse({ marks: [{ atS: 1, rect: { x: 0.1, y: 0.6, w: 0.8, h: 0.04 }, style: 'band' }], camera: 'read' })
    const { body } = documentCard(p, ctx, { picture: 'data:image/jpeg;base64,AAAA' })
    expect(body).toContain('class="veil"')
    expect(body).toContain('clip-path:inset(59.60%')
    expect(body).toContain('data-ease="linear"')
    expect(body).toContain('data-shape="highlight"')
  })
  it('a document with `scan` needs no rect before the scan is read', () => {
    expect(DocumentCardProps.safeParse({ text: 'hello there', scan: { find: 'hello' }, marks: [{ phrase: 'hello', atS: 1 }] }).success).toBe(true)
  })
})

describe('the music', () => {
  const words: Word[] = Array.from({ length: 200 }, (_, i) => ({ w: i % 12 === 11 ? 'end.' : 'word', sentence: Math.floor(i / 12), start: i * 0.5 + Math.floor(i / 12) * 0.3, end: i * 0.5 + Math.floor(i / 12) * 0.3 + 0.48 })) as Word[]
  const tracks = [{ id: 'a', file: 'a', mood: 'tension' }, { id: 'b', file: 'b', mood: 'tension' }]
  const base = { durationS: 110, tracks, pauses: voicePauses(words, 100), boundaries: [{ t: 50, kind: 'chapter' as const }], crossfadeS: 1.5, minCueS: 25, mood: 'tension', seed: 1 } as unknown as Parameters<typeof buildCueSheet>[0]
  it('a voice with short pauses keeps one cue, unless the cue may change under it', () => {
    expect(buildCueSheet(base).length).toBe(1)
    const cues = buildCueSheet({ ...base, fadeUnderVoice: true })
    expect(cues.length).toBe(2)
  })
})
