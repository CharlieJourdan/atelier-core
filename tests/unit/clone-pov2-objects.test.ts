// moteur-pov-2 — what an independent blind judge still missed on Le Monde en POV's free demo (2026-11-05): the opening handles a
// ticket and a phone in almost every shot, the cast is thin black silhouettes with a light rim and expressive faces, and the held
// things carry their details (a ticket's numbers, a results screen). Each is measured, written into the definition, and drawn.
import { describe, expect, it } from 'vitest'
import { OPENING_S, withAtPath, type Sourced, type StyleDefinition, type VideoAnalysis } from '../../src/shared/clone'
import { GlobalLook } from '../../src/main/production/clone/analysis/look'
import { deriveFields, heldObjectsOf } from '../../src/main/production/clone/definition/derive'
import { MONDE_POV } from '../../src/main/production/clone/definition/fixtures/profiles'
import { runDefinition } from '../../src/main/production/clone/definition/fixtures/run'
import { BRICK_SETTINGS } from '../../src/main/production/clone/pipeline/settings'
import { figuresFrom, heldFrom, openingFrom, scriptObjectsFrom } from '../../src/main/production/clone/pipeline/values-pov'
import { fakeDrafts, heldDetail, heldNamed, sentencesOf, setNamed } from '../../src/engine/nodes/director-pov'
import { fakeScript } from '../../src/engine/nodes/script-fake'
import { topicOf } from '../../src/engine/nodes/script-outline'
import { PovShot, type PovFigures } from '../../src/engine/formats/pov'
import { figure, PALETTES } from '../../src/engine/motion/pov-kit'
import { handShot } from '../../src/engine/motion/pov-hand'
import { countWords } from '../../src/engine/text/script'

const set = <T>(def: StyleDefinition, field: string, value: T): StyleDefinition => withAtPath(def, field, { value, source: 'measured', evidence: [{ video: 'v', atS: 1, frames: ['f.jpg'] }] } as Sourced)
const field = (out: ReturnType<typeof deriveFields>, f: string) => out.find((x) => x.field === f)

/** The POV analyses with their opening's first-person shots described as the shot log does (2026-11-04 proof, v1 0:00–1:30). */
function withHook(analyses: readonly VideoAnalysis[]): VideoAnalysis[] {
  const opening: [string, string][] = [
    ['Hand with red sleeve slides ticket toward a washing machine', ''],
    ['Phone screen showing Euromillions draw numbers and stars', 'EUROMILLIONS'],
    ['Euromillions ticket beside phone with draw numbers, hand pointing', 'EUROMILLIONS'],
    ['Phone shows purple results page confirming all numbers match', 'RÉSULTATS / ✓ TOUT CORRESPOND'],
    ['Phone screen with incoming call from Maman, green answer button', 'Maman']
  ]
  return analyses.map((a) => ({
    ...a,
    shots: a.shots.map((s, i) => {
      const k = i % 2 === 0 && s.startS < OPENING_S ? opening[(i / 2) % opening.length] : undefined
      return k ? { ...s, origin: 'drawn' as const, pov: true, shows: k[0], onScreenText: k[1] } : { ...s, pov: false }
    })
  }))
}

describe('P2/P4: the things held up, the opening apart, the cast', () => {
  it('names each held thing and what is on it from the shot descriptions, most frequent first', async () => {
    const r = await runDefinition(MONDE_POV)
    const h = heldObjectsOf(withHook(r.analyses))
    expect(h.objects.map((o) => `${o.hold}/${o.detail}`)).toEqual(expect.arrayContaining(['ticket/numbers', 'phone/results', 'phone/call']))
    expect(h.objects[0]!.share).toBeGreaterThanOrEqual(h.objects.at(-1)!.share)
    expect(h.evidence.length).toBeGreaterThan(0)
    expect(heldNamed('Tu ouvres le site sur ton téléphone')).toBe('phone')
    expect(heldNamed('Tu glisses la grille dans ta poche')).toBe('ticket')
    expect(heldNamed('Le monde continue comme avant')).toBeNull()
    expect(heldDetail('phone', 'tu compares les numéros du tirage', [])).toBe('results')
  })

  it('the opening has its own first-person share, measured above the whole video one', async () => {
    const r = await runDefinition(MONDE_POV)
    const out = deriveFields(withHook(r.analyses))
    const opening = field(out, 'sourcing.povOpeningShare')!.value as number
    const whole = field(out, 'sourcing.povShare')!.value as number
    expect(opening).toBeGreaterThan(whole)
    expect(field(out, 'sourcing.heldObjects')!.evidence.length).toBeGreaterThan(0)
    // older analyses (no pov column) say nothing
    expect(field(deriveFields(r.analyses), 'sourcing.povOpeningShare')).toBeUndefined()
  })

  it('the global look reads the cast in a fixed vocabulary, and the corpus agrees on each key', async () => {
    expect(GlobalLook.parse({ identity: null, presenterKind: null, figures: { body: 'silhouette', rim: true, faces: 'expressive', colour: 'hero' } }).figures?.body).toBe('silhouette')
    const r = await runDefinition(MONDE_POV)
    const fig = { body: 'silhouette', rim: true, faces: 'expressive', colour: 'hero' } as const
    const out = deriveFields(r.analyses.map((a, i) => ({ ...a, figures: i === 0 ? { ...fig, rim: false } : fig })))
    expect(field(out, 'sourcing.figures')?.value).toEqual(fig)
    expect(field(deriveFields(r.analyses), 'sourcing.figures')).toBeUndefined()
  })
})

describe('P5: the measures become brick settings, nothing when not measured', () => {
  it('held things, the opening and the cast reach director.pov; the object pattern reaches the script', async () => {
    const { definition: d0 } = await runDefinition(MONDE_POV)
    expect(heldFrom(d0) ?? openingFrom(d0) ?? figuresFrom(d0) ?? scriptObjectsFrom(d0)).toBeUndefined()
    let d = set(d0, 'sourcing.heldObjects', [{ hold: 'ticket', detail: 'numbers', share: 0.5 }, { hold: 'phone', detail: 'results', share: 0.3 }])
    d = set(d, 'sourcing.povShare', 0.12)
    d = set(d, 'sourcing.povOpeningShare', 0.42)
    d = set(d, 'sourcing.figures', { body: 'silhouette', rim: true, faces: 'expressive', colour: 'hero' })
    expect(openingFrom(d)).toEqual({ s: OPENING_S, handShare: 0.42 })
    expect(figuresFrom(d)?.rim).toBe(true)
    const o = scriptObjectsFrom(d)!
    expect(o.openingShare).toBe(0.42)
    expect(o.bodyShare).toBe(0.12)
    expect(o.openingWords).toBe(Math.round((OPENING_S * d.script.wordsPerMinute.value) / 60))
    const keys = BRICK_SETTINGS.map((r) => r.key)
    for (const k of ['director.pov.held', 'director.pov.opening', 'director.pov.figures', 'script.write.objects', 'recipe.aspect']) expect(keys).toContain(k)
  })
})

describe('the demo script follows the measured object pattern', () => {
  const objects = { objects: [{ hold: 'ticket' as const, detail: 'numbers' as const, share: 0.5 }, { hold: 'phone' as const, detail: 'results' as const, share: 0.35 }], openingShare: 0.42, openingWords: 300, bodyShare: 0.1 }

  it('opens on the things, handles them at the opening rate, keeps the exact word count', () => {
    const text = fakeScript({ topic: 'tu gagnes 250 millions au loto', language: 'fr', words: 400, seed: 3, objects })
    expect(countWords(text)).toBe(400)
    const sentences = text.split(/(?<=[.?!])\s+/)
    expect(sentences.slice(0, 4).filter((s) => heldNamed(s)).length).toBeGreaterThanOrEqual(2)
    const opening = sentences.slice(0, 24)
    const handled = opening.filter((s) => heldNamed(s)).length / opening.length
    expect(handled).toBeGreaterThan(0.3)
    expect(text).not.toMatch(/Que sait-on vraiment/)
    // no objects: the template it always was
    expect(fakeScript({ topic: 'x', language: 'fr', words: 200, seed: 3 })).toMatch(/Que sait-on vraiment/)
  })

  it('a brief label is not the subject', () => {
    expect(topicOf('Subject: Your life after winning.\nWrite our own script')).toBe('Your life after winning')
  })

  it('the drawn director holds up each thing a sentence names, with its detail and the said numbers', () => {
    const text = 'Tu sors ton ticket et tu relis les numéros 7 14 23 38 46. Tu prends ton téléphone et tu ouvres la page des résultats. Ton cœur bat très fort.'
    let t = 0
    const words = text.split(/\s+/).map((w, i, all) => {
      const sentence = all.slice(0, i).join(' ').split(/[.?!]\s/).length
      return { w, start: (t += 0.3), end: t + 0.25, sentence }
    })
    const drafts = fakeDrafts(sentencesOf(words as never), 0.12, undefined, { held: objects.objects, openingS: 120, openingHandShare: 0.42, language: 'fr' })
    const hands = drafts.map((d) => d.shot).filter((s) => s.kind === 'hand') as { hold: string; detail: string; balls?: number[] }[]
    expect(hands.map((h) => `${h.hold}/${h.detail}`)).toEqual(['phone/results'])
    // the first sentence opens on a place; a named ticket later is a hand shot with its numbers
    const later = fakeDrafts(sentencesOf([{ w: 'Bonjour.', start: 0, end: 0.3, sentence: 1 }, ...words.map((w) => ({ ...w, sentence: w.sentence + 1 }))] as never), 0.12, undefined, { held: objects.objects, language: 'fr' })
    const ticket = later.map((d) => d.shot).find((s) => s.kind === 'hand' && s.hold === 'ticket') as { balls?: number[]; detail: string } | undefined
    expect(ticket?.detail).toBe('numbers')
    expect(ticket?.balls).toEqual([7, 14, 23, 38, 46])
    for (const d of later) expect(PovShot.safeParse(d.shot).success, JSON.stringify(d.shot)).toBe(true)
  })
})

describe('the bricks draw them', () => {
  const p = PALETTES.dusk
  it('a silhouette cast: black thin bodies, only the hero coloured, a light rim behind, a mouth on expressive faces', () => {
    const look: PovFigures = { body: 'silhouette', rim: true, faces: 'expressive', colour: 'hero' }
    const other = figure({ color: 'green', pose: 'stand', hair: 'none' }, p, 500, 900, 400, 0, look)
    expect(other).not.toContain(p.colors.green)
    expect(other).toContain(p.rim)
    expect(other).toMatch(/<path d="M[^"]+Q[^"]+" fill="none" stroke="#fff"/)
    const hero = figure({ color: 'hero', pose: 'stand', hair: 'none' }, p, 500, 900, 400, 0, look)
    expect(hero).toContain(p.colors.hero)
    // absent: the kit's own clothed figures, unchanged
    const kit = figure({ color: 'green', pose: 'stand', hair: 'none' }, p, 500, 900, 400)
    expect(kit).toContain(p.colors.green)
    expect(kit).not.toContain(p.rim)
  })

  it('a held ticket shows its grid and stars; a phone its results with a match badge, a call, or notifications', () => {
    const ticket = handShot(PovShot.parse({ kind: 'hand', hold: 'ticket', detail: 'numbers', balls: [3, 9, 21, 33, 47, 2, 11], title: 'MA GRILLE' }) as never, p, 'abc', 3)
    for (const n of ['>3<', '>47<', '>11<', '<polygon', 'N° ']) expect(ticket).toContain(n)
    const results = handShot(PovShot.parse({ kind: 'hand', hold: 'phone', detail: 'results', title: 'RÉSULTATS' }) as never, p, 'abc', 3)
    expect(results).toContain('✓ 5 + 2')
    expect(results).toContain('18:42')
    const call = handShot(PovShot.parse({ kind: 'hand', hold: 'phone', detail: 'call', title: 'APPEL' }) as never, p, 'abc', 3)
    expect(call).toContain('#2f9e5b')
    const plain = handShot(PovShot.parse({ kind: 'hand', hold: 'phone', title: 'X' }) as never, p, 'abc', 3)
    expect(plain).not.toContain('✓')
  })
})

describe('independent judge, round 1 (2026-11-05): a story told to « you », in its places, phones held in hand', () => {
  it('the address is measured on the words heard; unclear says nothing', async () => {
    const { addressOf } = await import('../../src/main/production/clone/definition/derive')
    const r = await runDefinition(MONDE_POV)
    const said = (w: string) => r.analyses.map((a) => ({ ...a, shots: a.shots.map((s) => ({ ...s, words: w })) }))
    expect(addressOf(said('Tu prends ton ticket et tu regardes ta grille, toi seul.'))).toBe('you')
    expect(addressOf(said('Nous avons vu notre ville changer.'))).toBe('we')
    expect(addressOf(said('Le marché monte.'))).toBeUndefined()
    expect(field(deriveFields(said('Tu prends ton ticket et tu regardes ta grille.')), 'script.addressMode')?.value).toBe('you')
  })

  it('a « you » demo script tells a story (places, reactions, amounts), never a lecture about years', () => {
    const story = fakeScript({ topic: 'tu gagnes au loto', language: 'fr', words: 400, seed: 5, address: 'you' })
    expect(countWords(story)).toBe(400)
    expect(story).not.toMatch(/\bEn 1\d{3}\b|Autour de 1\d{3}|dans les sources disponibles/)
    expect(story).toMatch(/\bTu\b|\bTon\b/)
  })

  it('a place said is the place drawn; on a first-person channel a phone is held up, its notifications carry words', () => {
    expect(setNamed('Tu t’assois sur le bord de ton lit')).toBe('bedroom')
    // a bank is passed in the street (round 4: the drawn bank's temple front was out of place behind a phone)
    expect(setNamed('Tu passes devant la banque')).toBe('street')
    const s = (n: number, text: string) => ({ n, first: n, last: n, start: n * 3, end: n * 3 + 2, text })
    const drafts = fakeDrafts([s(1, 'Tu marches dans la rue sans but.'), s(2, 'Bonjour à toi.'), ...Array.from({ length: 12 }, (_, i) => s(i + 3, `la phrase ${i} sans rien`))], 0.2, { scene: 0.1, face: 0.1, data: 0.1, ui: 0.7 })
    const shots = drafts.map((d) => PovShot.parse(d.shot))
    expect(shots.some((x) => x.kind === 'scene' && x.set === 'street')).toBe(true)
    expect(shots.some((x) => x.kind === 'phone')).toBe(false)
    const msg = shots.find((x) => x.kind === 'hand' && x.detail === 'message') as Extract<PovShot, { kind: 'hand' }> | undefined
    expect(msg?.lines.length).toBe(2)
    expect(handShot(msg as never, PALETTES.dusk, 'm', 3)).toContain(msg!.lines[0]!.text)
    // no title card without a question
    expect(shots.some((x) => x.kind === 'title')).toBe(false)
  })
})

describe('a reproduced passage handles what its own video handles there (spec P6)', () => {
  it('the script and the drawn director get the passage video\'s own things and first-person share', async () => {
    const { withPassageObjects } = await import('../../src/main/production/clone/pipeline/values-pov')
    const r = await runDefinition(MONDE_POV)
    const a = withHook(r.analyses)[0]!
    const recipe = { bricks: [{ tech: 'script.write@2', settings: {} }, { tech: 'director.pov@1', settings: { handShare: 0.05 } }, { tech: 'render.assemble@1', settings: {} }] }
    const out = withPassageObjects(recipe, a, { videoId: a.videoId, fromS: 0, toS: 90 }, r.definition) as typeof recipe
    const script = out.bricks[0]!.settings as { objects?: { objects: { hold: string }[]; openingShare: number } }
    expect(script.objects?.objects.map((o) => o.hold)).toContain('ticket')
    expect(script.objects!.openingShare).toBeGreaterThan(0.2)
    expect(out.bricks[1]!.settings).toMatchObject({ handShare: 0.05, opening: { s: 90 } })
    expect(out.bricks[2]!.settings).toEqual({})
    // a passage without first-person shots keeps the channel's own pattern
    const flat = { ...a, shots: a.shots.map((s) => ({ ...s, pov: false })) }
    expect(withPassageObjects(recipe, flat, { videoId: a.videoId, fromS: 0, toS: 90 }, r.definition)).toBe(recipe)
  })
})

describe('independent judge, round 6: the passage\'s own shot mix, the channel\'s text devices', () => {
  it('the drawn shots\' mix is measured on the passage (faces were a default 20 %)', async () => {
    const { shotMixOf } = await import('../../src/main/production/clone/pipeline/values-pov')
    const r = await runDefinition(MONDE_POV)
    const a = r.analyses[0]!
    const shot = (shows: string, origin: string, lengthS: number, startS: number) => ({ ...a.shots[0]!, shows, origin: origin as never, lengthS, startS, pov: false })
    const mix = shotMixOf([shot('Round black-faced character turning to smile', 'drawn', 2, 0), shot('Shop interior, three figures queuing', 'drawn', 6, 2), shot('Glowing counter ticking up', 'motion', 2, 8)], 120)!
    expect(mix).toEqual({ scene: 0.6, face: 0.2, data: 0.2, ui: 0 })
    expect(shotMixOf([], 120)).toBeNull()
  })

  it('a time jump is a plain yellow corner card; a question is a white line then a larger coral one', async () => {
    const { povCard } = await import('../../src/engine/motion/pov-cards')
    const ctx = { width: 1920, height: 1080, durationS: 3 } as never
    const scene = povCard({ palette: 'dusk', depth: 'flat', seed: 's', shot: PovShot.parse({ kind: 'scene', set: 'room', cast: [{}], tag: { text: '4 JOURS PLUS TARD' } }) } as never, ctx)
    expect(scene.body).toMatch(/right:5%;top:9%/)
    expect(scene.body).not.toMatch(/border-radius:999px;background:rgba\(10,12,30/)
    const q = povCard({ palette: 'dusk', depth: 'flat', seed: 's', shot: PovShot.parse({ kind: 'title', lines: ['Le ticket peut-il', 'expirer ?'], set: 'room' }) } as never, ctx)
    expect(q.body).toContain(`color:${PALETTES.dusk.coral}`)
    expect(q.body).toMatch(/font-size:58px;color:#ffffff/)
  })

  it('a time jump said becomes its scene\'s corner card', () => {
    const s = (n: number, text: string) => ({ n, first: n, last: n, start: n * 3, end: n * 3 + 2, text })
    const drafts = fakeDrafts([s(1, 'Quatre jours plus tard, tu y penses encore sans arrêt.')], 0)
    expect((drafts[0]!.shot as { tag?: { text: string } }).tag?.text).toBe('QUATRE JOURS PLUS TARD')
  })
})

describe('independent judge, round 7: two things side by side, a place per shot', () => {
  it('a sentence naming two things holds one and lays the other beside it', () => {
    const s = (n: number, text: string) => ({ n, first: n, last: n, start: n * 3, end: n * 3 + 2, text })
    const drafts = fakeDrafts([s(1, 'Bonjour.'), s(2, 'Tu compares les résultats sur ton téléphone avec ta grille.')], 0.3)
    const hand = drafts[1]!.shot as { kind: string; hold: string; beside?: string }
    expect(hand.kind).toBe('hand')
    expect([hand.hold, hand.beside].sort()).toEqual(['phone', 'ticket'])
    const html = handShot(PovShot.parse({ kind: 'hand', hold: 'ticket', detail: 'numbers', beside: 'phone' }) as never, PALETTES.dusk, 'b', 3)
    expect(html).toContain('scale(0.82)')
  })
})
