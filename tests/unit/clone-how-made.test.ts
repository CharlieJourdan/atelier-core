// « How was it made → which Atelier brick » (chantier rea-video, decision 0110): every analysed shot gets one production
// method, every method a route that agrees with P3's element map, and the recipe's picture shares cover the whole screen
// time. Fakes only.
import { describe, expect, it } from 'vitest'
import type { AnalysedShot, Brief, MediaOrigin, VideoAnalysis } from '../../src/shared/clone'
import { measureElements } from '../../src/main/production/clone/definition/elements'
import { LAYER_METHODS, LAYER_ROUTES, METHOD_FR, PICTURE_METHODS, PICTURE_ROUTES, howMadeLines, howMadeOf, methodOfShot } from '../../src/main/production/clone/definition/how-made'
import { ELEMENT_RULES } from '../../src/main/production/clone/definition/elements'
import { fakeChannel, fakeCorpus } from '../../src/main/production/clone/fakes/channels'
import { productionRegistry } from '../../src/engine/nodes'

const brief = { ownChannel: false, humanInputs: { face: false, voice: false, footage: false } } as unknown as Brief

type Part = Pick<AnalysedShot, 'kind' | 'origin' | 'camera' | 'lengthS'> & Partial<AnalysedShot>
function analysisWith(shots: Part[], over: Partial<VideoAnalysis> = {}): VideoAnalysis {
  const ch = fakeChannel('presenter-motion')
  const a = ch.analyse(fakeCorpus(ch)[0]!, 'p2/v')
  let t = 0
  const out: AnalysedShot[] = shots.map((s, i) => {
    const shot: AnalysedShot = { layout: s.origin === 'presenter' ? 'full' : 'off', angle: s.origin === 'presenter' ? 0 : null, shows: 'x', words: 'w', illustrates: 'yes', onScreenText: '', frames: [`p2/v/f${i}.jpg`], ...s, n: i + 1, startS: t }
    t += s.lengthS
    return shot
  })
  const shares: Partial<Record<MediaOrigin, number>> = {}
  for (const s of out) shares[s.origin] = (shares[s.origin] ?? 0) + s.lengthS / t
  return { ...a, shots: out, coverage: { ...a.coverage, durationS: t, readS: t }, editing: { ...a.editing, originShares: shares }, ...over }
}

describe('the production method of a shot', () => {
  it('follows the measured origin, kind and camera move', () => {
    const s = (origin: MediaOrigin, kind: AnalysedShot['kind'], camera: AnalysedShot['camera'] = 'pan'): AnalysedShot => ({ n: 1, startS: 0, lengthS: 2, kind, origin, camera, layout: 'off', angle: null, shows: '', onScreenText: '', words: '', illustrates: null, frames: [] })
    expect(methodOfShot(s('found', 'archive-photo', 'push-in'), 'none')).toBe('still-move')
    expect(methodOfShot(s('found', 'document', 'still'), 'none')).toBe('still-hold')
    expect(methodOfShot(s('found', 'archive-film'), 'none')).toBe('camera-found')
    expect(methodOfShot(s('found', 'gameplay'), 'none')).toBe('gameplay')
    expect(methodOfShot(s('presenter', 'presenter'), 'real')).toBe('presenter-filmed')
    expect(methodOfShot(s('presenter', 'presenter'), 'avatar')).toBe('avatar')
    expect(methodOfShot(s('generated', 'illustration', 'still'), 'none')).toBe('ai-image')
    expect(methodOfShot(s('generated', 'stock-footage', 'tracking'), 'none')).toBe('ai-video')
    expect(methodOfShot(s('drawn', 'illustration'), 'none')).toBe('drawn-2d')
    expect(methodOfShot(s('motion', 'map'), 'none')).toBe('coded-motion')
    expect(methodOfShot(s('3d', 'other'), 'none')).toBe('3d-render')
    expect(methodOfShot(s('screen', 'screen-capture'), 'none')).toBe('screen')
  })
})

describe('every method has a route Atelier can execute', () => {
  it('each picture route names a P3 element, and every brick it can give is registered in the engine', () => {
    const types = new Set(productionRegistry().list().map((d) => d.type.split('@')[0]!))
    for (const m of PICTURE_METHODS) {
      const r = PICTURE_ROUTES[m]
      expect(ELEMENT_RULES.some((e) => e.id === r.element), m).toBe(true)
      expect(r.remake.length).toBeGreaterThan(10)
      expect(METHOD_FR[m]).toBeTruthy()
    }
    for (const m of LAYER_METHODS) {
      for (const b of [brief, { ...brief, ownChannel: true }]) {
        const route = LAYER_ROUTES[m].route(b as Brief)
        if (route.brick) expect(types.has(route.brick), `${m} → ${route.brick}`).toBe(true)
      }
      expect(METHOD_FR[m]).toBeTruthy()
    }
  })

  it('a human voice is his own recording on his own channel, a synthetic voice of the same kind otherwise', () => {
    expect(LAYER_ROUTES['voice-human'].route({ ...brief, ownChannel: true } as Brief).brick).toBe('voice.own')
    expect(LAYER_ROUTES['voice-human'].route(brief).brick).toBe('voice.tts')
  })
})

describe('the recipe of a corpus', () => {
  // Markets of the Past–like: found stills with moves, archive film, maps; a human voice and a music bed
  const a = analysisWith([
    { kind: 'archive-photo', origin: 'found', camera: 'push-in', lengthS: 6 },
    { kind: 'archive-film', origin: 'found', camera: 'pan', lengthS: 4 },
    { kind: 'map', origin: 'motion', camera: 'animated', lengthS: 5 },
    { kind: 'archive-photo', origin: 'found', camera: 'still', lengthS: 3 },
    { kind: 'other', origin: '3d', camera: 'tracking', lengthS: 2 }
  ])

  it('picture shares cover the whole screen time and agree with P3\'s elements', () => {
    const rows = howMadeOf([a], brief)
    const picture = rows.filter((r) => (PICTURE_METHODS as readonly string[]).includes(r.method))
    expect(picture.reduce((t, r) => t + r.share, 0)).toBeCloseTo(1, 2)
    expect(picture.find((r) => r.method === 'still-move')!.share).toBeCloseTo(6 / 20, 3)
    expect(picture.find((r) => r.method === 'still-hold')!.share).toBeCloseTo(3 / 20, 3)
    // a route is the same as P3's element for those shots
    const els = measureElements([a], brief)
    for (const r of picture) {
      const el = els.find((e) => e.id === PICTURE_ROUTES[r.method as keyof typeof PICTURE_ROUTES].element)!
      expect(r.route.how).toBe(el.how)
      expect(r.route.brick).toBe(el.brick)
    }
    expect(picture.find((r) => r.method === '3d-render')!.route.how).toBe('impossible')
    for (const r of rows) expect(r.evidence.length).toBeGreaterThan(0)
  })

  it('the layers and the sound measured by the analysis are routed too, and the report lines are in French', () => {
    const rows = howMadeOf([a], brief)
    const music = rows.find((r) => r.method === 'music-bed')
    expect(Boolean(music)).toBe(a.sound.music.present)
    if (music) expect(music.route.brick).toBe('sound.music')
    const lines = howMadeLines(rows)
    expect(lines.some((l) => l.startsWith('photo ou document avec mouvement de caméra — 30 % → visuals.fulfil'))).toBe(true)
    expect(lines.some((l) => l.includes('pas possible'))).toBe(true)
  })

  it('an empty corpus gives an empty recipe', () => {
    expect(howMadeOf([], brief)).toEqual([])
  })
})
