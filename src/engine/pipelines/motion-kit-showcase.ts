// The motion-montage showcase (`npm run engine:motion-kit-demo`): a 60 s film about the tulip mania of 1637 that shows the toolkit's
// bricks, each where it means something — kinetic type on the title and the last words, a moving map following the bulbs' road, 2.5D
// parallax on a print, gliding moves towards each picture's subject, a punch-in that lands on a word and holds to the cut, a document
// highlighted on its words, a line chart and a counter, a flash on the crash, the portraits changing hands in pushes, numbers said aloud
// set on their word (« ×20 »), and a few recorded sound effects. Pure: the narration's timed words and the pictures' item ids in, the edit
// plan out (the shots land on the words' times; the kit `edit.fx` then adds the rest).
import { EDITPLAN_SCHEMA, EditPlan, type Shot } from '../formats/editplan'
import { FPS, type Word } from '../formats/timing'

/** The narration: one sentence per section, in French (the system voice says it; numbers in letters so it says them well). */
export const SHOWCASE_SCRIPT = [
  'Amsterdam, mille six cent trente-sept.',
  "Une seule tulipe vaut alors plus qu'une maison.",
  "Les bulbes arrivent de Constantinople, traversent les Balkans et remontent toute l'Europe jusqu'aux Provinces-Unies.",
  'Dans les tavernes enfumées de Haarlem, on signe des contrats sur des fleurs encore cachées sous la terre.',
  "Le contrat promet la livraison au printemps, à un prix fixé d'avance, quoi qu'il arrive.",
  'En trois mois à peine, le prix d’un bulbe est multiplié par vingt.',
  'Un seul Semper Augustus atteint dix mille florins.',
  "Puis, en février, plus personne n'achète.",
  'Les marchands se ruinent, les maisons sont vendues, et les portraits des riches bourgeois changent de mains.',
  "C'est la première bulle spéculative de l'histoire, et sans doute pas la dernière."
]

/** The pictures the showcase needs, by item id (public-domain prints and paintings of the period, or drawn stand-ins). */
export const SHOWCASE_PICTURES = ['flora', 'stilllife', 'tavern', 'crash', 'hals', 'ruychaver', 'shipping', 'glass', 'engraving'] as const
export type ShowcasePicture = (typeof SHOWCASE_PICTURES)[number]

const CONTRACT =
  "Par-devant le notaire de Haarlem, le marchand Pieter Jansz s'engage à livrer au printemps prochain dix bulbes de tulipe, " +
  "à un prix fixé d'avance de mille florins, payable à la livraison, la marchandise restant en terre jusqu'au jour convenu."

/** The first and last word of each sentence. */
function sentences(words: readonly Word[]): { start: number; end: number; words: Word[] }[] {
  const out: { start: number; end: number; words: Word[] }[] = []
  for (const w of words) {
    const s = (out[w.sentence] ??= { start: w.start, end: w.end, words: [] })
    s.end = w.end
    s.words.push(w)
  }
  return out
}

/** The time of the first word of `s` that starts with `prefix` (folded), else the sentence's start. */
function wordAt(s: { start: number; words: Word[] }, prefix: string): number {
  const fold = (x: string): string => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return s.words.find((w) => fold(w.w).startsWith(fold(prefix)))?.start ?? s.start
}

/** The showcase's edit plan for the narration's words (`durationS`: the voice's length). */
export function showcasePlan(words: readonly Word[], durationS: number): EditPlan {
  const S = sentences(words)
  const frames = Math.round(durationS * FPS)
  const f = (t: number): number => Math.max(0, Math.min(frames, Math.round(t * FPS)))
  // each section runs from its sentence's first word (the first from 0) to the next one's
  const edge = (i: number): number => (i === 0 ? 0 : i >= S.length ? frames : f((S[i] as { start: number }).start - 0.08))
  const base: Shot[] = []
  const overlay: Shot[] = []
  let n = 0
  const id = (): string => `k${String(++n).padStart(2, '0')}`
  const still = (a: number, b: number, item: ShowcasePicture, extra: Partial<Shot> = {}): void => {
    base.push({ id: id(), track: 'base', startFrame: a, endFrame: b, kind: 'image.gen', genItem: item, transitionIn: 'cut', role: 'scene', beat: 0, ...extra })
  }
  const card = (a: number, b: number, graphic: Record<string, unknown>, extra: Partial<Shot> = {}): void => {
    base.push({ id: id(), track: 'base', startFrame: a, endFrame: b, kind: 'motion', graphic: { accent: '#d5412f', theme: 'dark', ...graphic } as Shot['graphic'], transitionIn: 'dissolve', role: 'scene', beat: 0, ...extra })
  }
  const kinetic = (i: number, props: Record<string, unknown>): void => {
    const a = edge(i)
    const b = edge(i + 1)
    overlay.push({ id: id(), track: 'overlay', startFrame: a, endFrame: b, kind: 'motion', graphic: { template: 'kinetic', accent: '#d5412f', theme: 'dark', props } as Shot['graphic'], transitionIn: 'cut', role: 'scene', beat: 0 })
  }
  const rel = (i: number, t: number): number => Math.max(0, Math.round((t - edge(i) / FPS) * 100) / 100)
  const s = (i: number): { start: number; words: Word[] } => S[i] as { start: number; words: Word[] }

  // 0 — the title over a print of the period in 2.5D
  still(edge(0), edge(1), 'flora', { motion: { kind: 'parallax', from: 1.04, to: 1.04, focus: { x: 0.25, y: 0.25, w: 0.5, h: 0.6 }, depth: 2.6 } })
  kinetic(0, { style: 'slam', position: 'center', background: 'none', case: 'upper', words: [{ text: 'Amsterdam', atS: rel(0, wordAt(s(0), 'amsterdam')) }, { text: '1637', atS: rel(0, wordAt(s(0), 'mille')), emphasis: true }] })
  // 1 — a still life gliding towards its tulips, a punch-in on « maison » held to the cut, the words popping
  still(edge(1), edge(2), 'stilllife', { motion: { kind: 'push', from: 1.03, to: 1.08, focus: { x: 0.3, y: 0.05, w: 0.4, h: 0.45 }, ease: 'glide' }, punches: [{ atS: rel(1, wordAt(s(1), 'maison')), zoom: 1.12 }] })
  kinetic(1, { style: 'pop', position: 'lower', words: [{ text: 'une tulipe', atS: rel(1, wordAt(s(1), 'tulipe')) }, { text: '>', atS: rel(1, wordAt(s(1), 'plus')) }, { text: 'une maison', atS: rel(1, wordAt(s(1), 'maison')), emphasis: true }] })
  // 2 — the moving map: the bulbs' road drawn along the way (Constantinople, the Balkans, Vienna, the Rhine, the United Provinces), the
  //     camera riding its head, then the United Provinces framed
  const ams = { lat: 52.37, lon: 4.9 }
  const ist = { lat: 41.01, lon: 28.98 }
  const via = [
    { lat: 42.7, lon: 23.32 }, // Sofia
    { lat: 44.79, lon: 20.45 }, // Belgrade
    { lat: 48.21, lon: 16.37 }, // Vienna
    { lat: 50.11, lon: 8.68 }, // Frankfurt, on the way down the Rhine
    { lat: 50.94, lon: 6.96 } // Cologne
  ]
  const routeAt = rel(2, wordAt(s(2), 'traversent'))
  const arriveAt = rel(2, wordAt(s(2), 'provinces'))
  card(edge(2), edge(3), {
    template: 'map',
    props: {
      kicker: '1634 – 1637',
      title: 'La route des bulbes',
      regions: [{ countries: ['Netherlands'], tone: 'gold', label: 'Provinces-Unies', atS: arriveAt }],
      pins: [{ ...ist, label: 'Constantinople', atS: Math.max(0.3, rel(2, wordAt(s(2), 'constantinople'))) }, { ...ams, label: 'Amsterdam', note: 'Bourse aux fleurs', atS: arriveAt + 0.3 }],
      // the road ends about a second before the camera frames the provinces (the camera rides its head until then)
      routes: [{ from: ist, to: ams, via, atS: routeAt, drawS: Math.min(12, Math.max(2.5, arriveAt - routeAt - 0.8)) }],
      camera: [
        { atS: 0, view: { west: -6, south: 34, east: 36, north: 58 } },
        { atS: routeAt, follow: 0, zoom: 2 },
        { atS: arriveAt + 0.4, view: { west: -3, south: 47.5, east: 13, north: 56 } }
      ]
    }
  })
  // 3 — the tavern: the camera glides in towards the couple (who sign on a flower still in the ground)
  still(edge(3), edge(4), 'tavern', { transitionIn: 'dissolve', motion: { kind: 'push', from: 1.04, to: 1.17, focus: { x: 0.3, y: 0.18, w: 0.24, h: 0.42 }, ease: 'glide' } })
  // 4 — the contract, highlighted on its words, the camera following the marks
  card(edge(4), edge(5), {
    template: 'document',
    props: {
      paper: 'parchment',
      heading: 'Contrat de vente',
      date: 'Haarlem, 1636',
      text: CONTRACT,
      source: 'Reconstitution',
      marks: [
        { phrase: 'livrer au printemps prochain', atS: rel(4, wordAt(s(4), 'livraison')), style: 'highlight' },
        { phrase: "prix fixé d'avance de mille florins", atS: rel(4, wordAt(s(4), 'prix')), style: 'underline' }
      ]
    }
  })
  // 5 — the price line, drawn from « prix »; 6 — the counter on « dix mille »
  card(edge(5), edge(6), {
    template: 'chart',
    props: {
      kicker: 'Haarlem, 1636 – 1637',
      title: 'Le prix d’un bulbe',
      source: 'Estimations',
      kind: 'line',
      unit: 'fl',
      accentFrom: 3,
      atS: rel(5, wordAt(s(5), 'prix')),
      drawS: 2.2,
      points: [
        { label: 'nov.', value: 250 },
        { label: 'déc.', value: 600 },
        { label: 'janv.', value: 1800 },
        { label: 'fév.', value: 5000 }
      ]
    }
  })
  card(edge(6), edge(7), {
    template: 'chart',
    props: { kicker: 'Semper Augustus', title: 'Le bulbe le plus cher', kind: 'counters', counters: [{ label: 'florins', value: 10000, atS: rel(6, wordAt(s(6), 'atteint')) }] }
  }, { transitionIn: 'cut' })
  // 7 — the crash: a flash (the disclosure), the camera gliding in, a punch-in on « personne » held to the cut
  still(edge(7), edge(8), 'crash', { transitionIn: 'flash', motion: { kind: 'push', from: 1.03, to: 1.08, ease: 'glide' }, punches: [{ atS: rel(7, wordAt(s(7), 'personne')), zoom: 1.1 }] })
  // 8 — the portraits change hands: each pushes the one before out of the frame, always the same way (a series passed on, hand to hand),
  //     each gliding towards its sitter's face
  const a8 = edge(8)
  const b8 = edge(9)
  const sitters: [ShowcasePicture, NonNullable<Shot['motion']>['focus']][] = [
    ['hals', { x: 0.35, y: 0.08, w: 0.3, h: 0.4 }],
    ['ruychaver', { x: 0.35, y: 0.08, w: 0.3, h: 0.4 }],
    ['shipping', { x: 0.3, y: 0.25, w: 0.4, h: 0.4 }],
    ['glass', { x: 0.3, y: 0.1, w: 0.4, h: 0.45 }],
    ['engraving', { x: 0.3, y: 0.15, w: 0.4, h: 0.45 }]
  ]
  sitters.forEach(([item, focus], k) => {
    const a = a8 + Math.round(((b8 - a8) * k) / sitters.length)
    const b = a8 + Math.round(((b8 - a8) * (k + 1)) / sitters.length)
    still(a, b, item, { transitionIn: k === 0 ? 'cut' : 'push', ...(k === 0 ? {} : { transitionDir: 'left' as const }), motion: { kind: 'push', from: 1.04, to: 1.09, focus, ease: 'glide' } })
  })
  // 9 — back to the first print (the film closes on its opening picture), the last words stacked over it in 2.5D
  still(edge(9), frames, 'flora', { transitionIn: 'dissolve', motion: { kind: 'parallax', from: 1.06, to: 1.06, focus: { x: 0.3, y: 0.3, w: 0.4, h: 0.5 }, depth: 3, ease: 'glide' } })
  kinetic(9, { style: 'stack', position: 'center', background: 'none', words: [{ text: 'la première', atS: rel(9, wordAt(s(9), 'premiere')) }, { text: 'bulle', atS: rel(9, wordAt(s(9), 'bulle')), emphasis: true }, { text: 'spéculative', atS: rel(9, wordAt(s(9), 'speculative')) }] })

  return EditPlan.parse({
    schema: EDITPLAN_SCHEMA,
    fps: FPS,
    size: [1920, 1080],
    frames,
    tracks: { base: base.map((x) => x.id), overlay: overlay.map((x) => x.id), labels: [] },
    captionsPreset: 'classic',
    shots: [...base, ...overlay],
    chapters: [{ title: 'La fièvre', startFrame: 0 }, { title: 'Le krach', startFrame: edge(7) }],
    diagnostics: []
  })
}
