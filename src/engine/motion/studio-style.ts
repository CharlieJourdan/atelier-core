// The motion studio's director side (decision 0111): a channel's MEASURED motion style (the analysis' `motion.elements[]`: palette,
// fonts, texture, easing) turned into a studio look, and the scene recipes the director calls with the words of a beat (a total that
// splits into parts, one total equal to a stack of others, a named entity with its traits, a hero object, a place that grows over the
// years). A recipe gives a `studio` card's props (formats/studio.ts) on a 16 × 9 stage (x −8…8, y −4.5…4.5); its timings are shares of
// the card's length unless the caller gives the words' times. Pure: the same inputs always give the same card.
import type { StudioItemInput, StudioPropsInput } from '../formats/studio'

type Look = NonNullable<StudioPropsInput['look']>
export interface MeasuredMotion {
  palette?: readonly string[]
  fonts?: readonly string[]
  texture?: string
  easing?: string
}

const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
const lum = (h: string): number => {
  const [r, g, b] = rgb(h)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const hsl = (h: string): { h: number; s: number; l: number } => {
  const [r, g, b] = rgb(h)
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: hh * 60, s, l }
}
const mix = (a: string, b: string, k: number): string => {
  const x = rgb(a)
  const y = rgb(b)
  return '#' + x.map((v, i) => Math.round((v + ((y[i] as number) - v) * k) * 255).toString(16).padStart(2, '0')).join('')
}
const isHex = (s: string): boolean => /^#[0-9a-fA-F]{6}$/.test(s)

/**
 * The studio look of a measured style. Dark ground = its darkest colour (when the palette is mostly dark, or the texture says « dark »),
 * accent = its warmest saturated colour, cool = its bluest; the face from the fonts' words; glow, grain and the light from the texture's
 * words; springs from the easing's (« overshoot », « snappy » → livelier; « slow », « gentle » → heavier).
 */
export function studioLookOf(m: MeasuredMotion): Look {
  const pal = (m.palette ?? []).filter(isHex)
  const words = `${(m.fonts ?? []).join(' ')}`.toLowerCase()
  const tex = (m.texture ?? '').toLowerCase()
  const ease = (m.easing ?? '').toLowerCase()
  const dark = [...pal].sort((a, b) => lum(a) - lum(b))[0] ?? '#0b1020'
  const sat = pal.filter((c) => hsl(c).s > 0.35 && hsl(c).l > 0.25 && hsl(c).l < 0.85)
  const warm = sat.filter((c) => {
    const h = hsl(c).h
    return h < 60 || h > 330
  })
  const accent = [...warm].sort((a, b) => hsl(b).s * hsl(b).l - hsl(a).s * hsl(a).l)[0] ?? '#f6a465'
  const cool = [...sat].filter((c) => hsl(c).h > 190 && hsl(c).h < 260).sort((a, b) => hsl(b).s - hsl(a).s)[0] ?? '#3b5bd6'
  const face = /condensed|narrow/.test(words) ? 'condensed' : /serif/.test(words) && !/sans/.test(words) ? 'serif' : /wide|extended|geometric|grotesque/.test(words) ? 'wide' : 'sans'
  const glossy = /gloss|glass|glow|3d|render|neon/.test(tex)
  const springs = /overshoot|bounc|snappy|pop/.test(ease)
    ? { ui: { k: 360, d: 26 }, type: { k: 200, d: 22 }, heavy: { k: 110, d: 17 } }
    : /slow|gentle|soft|drift/.test(ease)
      ? { ui: { k: 220, d: 30 }, type: { k: 120, d: 24 }, heavy: { k: 70, d: 18 } }
      : { ui: { k: 320, d: 30 }, type: { k: 170, d: 26 }, heavy: { k: 90, d: 19 } }
  return {
    background: { kind: 'vignette', top: mix(dark, cool, 0.12), spot: mix(dark, cool, 0.16), bottom: mix(dark, '#000000', 0.45), spotAt: [0.5, 0.4] },
    palette: { accent, accent2: mix(accent, '#ffffff', 0.55), cool, panel: mix(dark, cool, 0.22), dark, fg: '#f2f3f7', muted: mix('#ffffff', cool, 0.45) },
    face,
    labelFace: 'semi',
    glow: glossy ? 0.55 : 0.2,
    grain: /grain|film|noise/.test(tex) ? 0.05 : 0.02,
    vignette: 0.5,
    springs,
    stagger: 0.25,
    light: 'studio'
  }
}

const pick = <T>(xs: readonly T[], i: number): T => xs[Math.min(i, xs.length - 1)] as T

/** « One total that splits into parts »: the total counts in at the centre, rises, and branches draw down to one glossy box per part. */
export function branchScene(o: { value: number; unit?: string; parts: number; look: Look; d: number; times?: { rise?: number; branches?: number } }): StudioPropsInput {
  const rise = o.times?.rise ?? o.d * 0.26
  const br = o.times?.branches ?? rise + 0.75
  const n = Math.max(1, Math.min(6, o.parts))
  const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * (n > 4 ? 2.4 : 2.98))
  const items: StudioItemInput[] = [
    { kind: 'counter', from: o.value, to: o.value, countS: 0, suffix: o.unit ?? '', suffixScale: 0.52, size: 1.5, at: [0, 0, 0], atS: 0.05, enter: 'zoom', moves: [{ atS: rise, at: [0, 2.96, 0] }], role: 'accent', glow: true },
    { kind: 'curve', at: [0, 2.0, 0], to: xs.map((x) => [x, -1.6, 0] as [number, number, number]), atS: br, drawS: 0.85, bend: 0.62, width: 0.045, role: 'accent', role2: 'muted', glow: true }
  ]
  xs.forEach((x, i) => items.push({ kind: 'block', at: [x, -2.7, 0], size: [2.1, 2.1, 0.35], radius: 0.28, role: 'dark', role2: 'panel', material: 'glass', icon: 'case', edge: true, glow: true, atS: br + 0.55 + i * 0.25, enter: 'pop' }))
  return { look: o.look, items }
}

/** « One total equals a stack of others »: a glowing bar, an equals sign, and labelled blocks dropping one on the other (heaviest first). */
export function stackScene(o: { value: string; unit?: string; label: string; stack: { label: string; weight: number }[]; stackLabel?: string; look: Look; d: number; times?: { equals?: number; first?: number; every?: number } }): StudioPropsInput {
  const eq = o.times?.equals ?? o.d * 0.21
  const first = o.times?.first ?? eq + 0.5
  const every = o.times?.every ?? Math.min(0.55, (o.d - first - 1.4) / Math.max(1, o.stack.length))
  const top = 2.93
  const base = -3.27
  const total = o.stack.reduce((a, s) => a + s.weight, 0)
  const gap = 0.07
  const room = top - base - gap * (o.stack.length - 1)
  const items: StudioItemInput[] = [
    { kind: 'bar', at: [-3.63, base, 0], size: [3.15, top - base, 0.3], role: 'accent', role2: 'accent2', radius: 0.14, atS: 0.05, growS: 0.6, glow: true },
    { kind: 'text', text: o.value, at: [-3.63, 2.25, 0.3], size: 0.56, role: 'ground', atS: 0.75, enter: 'fade' },
    ...(o.unit ? [{ kind: 'text' as const, text: o.unit, at: [-3.63, 1.7, 0.3] as [number, number, number], size: 0.3, role: 'ground' as const, atS: 0.8, enter: 'fade' as const }] : []),
    { kind: 'text', text: o.label.toUpperCase(), at: [-3.63, -3.73, 0], size: 0.22, role: 'accent2', face: 'semi', tracking: 0.12, atS: 0.85, enter: 'fade' },
    { kind: 'block', at: [0, 0.2, 0], size: [0.56, 0.13, 0.05], radius: 0.02, role: 'fg', material: 'matte', atS: eq, enter: 'fade' },
    { kind: 'block', at: [0, -0.08, 0], size: [0.56, 0.13, 0.05], radius: 0.02, role: 'fg', material: 'matte', atS: eq, enter: 'fade' }
  ]
  let y = base
  o.stack.forEach((s, i) => {
    const h = (room * s.weight) / total
    items.push({ kind: 'block', at: [3.63, y + h / 2, 0], size: [3.35, h, 0.5], radius: 0.1, role: 'cool', role2: 'muted', material: 'glossy', label: s.label.toUpperCase(), labelSize: 0.27, labelFace: 'wide', atS: first + i * every, enter: i === 0 ? 'grow' : 'drop', from: [0, 0.9, 0] })
    y += h + gap
  })
  if (o.stackLabel) items.push({ kind: 'text', text: o.stackLabel.toUpperCase(), at: [3.63, -3.73, 0], size: 0.22, role: 'muted', face: 'semi', tracking: 0.12, atS: first + o.stack.length * every + 0.2, enter: 'fade', opacity: 0.85 })
  return { look: o.look, items }
}

/** « A named entity and its traits »: a glass card with its name and a line below it, then branches to one pill per trait, said one by one. */
export function nodeScene(o: { title: string; sub?: string[]; traits: string[]; look: Look; d: number; times?: { rise?: number; traits?: number[] } }): StudioPropsInput {
  const rise = o.times?.rise ?? 0.75
  const n = Math.max(1, Math.min(5, o.traits.length))
  const widths = o.traits.map((t) => 0.9 + t.length * 0.165)
  const span = widths.reduce((a, w) => a + w, 0) + 0.7 * (n - 1)
  let x = -span / 2 - 1.5
  const xs = widths.map((w) => {
    const c = x + w / 2
    x += w + 0.7
    return c
  })
  const times = o.traits.map((_, i) => o.times?.traits?.[i] ?? 1.45 + i * 0.6)
  const card = (dy: number): [number, number, number] => [0, dy, 0]
  const items: StudioItemInput[] = [
    { kind: 'block', at: card(0.2), size: [4.25, 2.06, 0.24], radius: 0.18, role: 'dark', role2: 'panel', material: 'glass', edge: true, glow: true, atS: 0.05, enter: 'pop', moves: [{ atS: rise, at: card(1.63) }] },
    { kind: 'text', text: o.title, at: [0, 0.45, 0.2], size: 0.7, role: 'accent', role2: 'accent2', atS: 0.1, enter: 'fade', glow: true, moves: [{ atS: rise, at: [0, 1.88, 0.2] }] },
    ...(o.sub ?? []).slice(0, 2).map((s, i): StudioItemInput => ({ kind: 'text', text: s.toUpperCase(), at: [0, -0.16 - i * 0.21, 0.2], size: 0.17, role: 'muted', face: 'semi', tracking: 0.1, atS: 0.2, enter: 'fade', opacity: 0.8, moves: [{ atS: rise, at: [0, 1.27 - i * 0.21, 0.2] }] })),
    // one branch per trait, drawn just before its pill lands (the line leads, the pill sits at its end)
    ...xs.map((cx, i): StudioItemInput => ({ kind: 'curve', at: [0, 0.6, 0.1], to: [[cx, -1.88, 0.1]], atS: (times[i] as number) - 0.5, drawS: 0.5, bend: 0.7, width: 0.04, role: 'accent', role2: 'muted', glow: true }))
  ]
  o.traits.forEach((t, i) => {
    const w = pick(widths, i)
    items.push({ kind: 'block', at: [pick(xs, i), -2.36, 0], size: [w, 0.9, 0.12], radius: 0.45, role: 'dark', material: 'glossy', edge: true, label: t, labelSize: 0.32, labelFace: 'semi', atS: times[i] as number, enter: 'fade' })
  })
  return { look: o.look, items }
}

/** « The thing the story is about »: one hero object, lit from behind, turning slowly, with its pills arriving below on their words. */
export function heroScene(o: { shape: 'vault' | 'coin' | 'ingot' | 'cube'; pills: string[]; look: Look; d: number; times?: number[] }): StudioPropsInput {
  const look: Look = { ...o.look, light: 'rim', exposure: 1.05 }
  const widths = o.pills.map((t) => 0.8 + t.length * 0.19)
  const span = widths.reduce((a, w) => a + w, 0) + 0.3 * (o.pills.length - 1)
  let x = -span / 2
  const items: StudioItemInput[] = [{ kind: 'object', shape: o.shape, size: 2.9, at: [0, 0.1, 0], rot: [10, 30, 0], spin: [0, -2.2, 0], role: 'muted', material: 'frost', atS: 0, enter: 'fade' }]
  o.pills.forEach((t, i) => {
    const w = pick(widths, i)
    items.push({ kind: 'block', at: [x + w / 2, -3.05, 0], size: [w, 0.78, 0.08], radius: 0.39, role: 'dark', material: 'glossy', edge: true, label: t, labelSize: 0.3, labelFace: 'semi', atS: o.times?.[i] ?? o.d * 0.38 + i * 0.7, enter: 'fade' })
    x += w + 0.3
  })
  return { look, camera: { fov: 30, keys: [{ atS: 0, pos: [0.4, 1.6, 16.2], target: [0, 0.1, 0] }, { atS: o.d, pos: [-0.5, 1.4, 15.6], target: [0, 0.1, 0] }], ease: 'linear', drift: 0 }, items }
}

/** « A place that grows over the years »: a 3D island in a river, houses arriving, a wall that rings it, the year counting at the top. */
export function timelapseScene(o: {
  years: [number, number][]
  era: string
  caption?: { lead: string; text: string[]; atS: number }
  seed?: number
  houses: { start: number; end: number; growS: number }
  wallAtS?: number
  d: number
}): StudioPropsInput {
  const island: [number, number][] = [[-40, -10], [-24, -19], [0, -21], [22, -17], [40, -7], [38, 6], [20, 14], [-4, 16], [-26, 13], [-42, 4]]
  const plot: [number, number][] = [[-32, -9], [-14, -16], [8, -16], [28, -10], [32, -1], [18, 9], [-4, 11], [-24, 8], [-34, 1]]
  const items: StudioItemInput[] = [
    { kind: 'terrain', size: 520, seed: o.seed ?? 3, hills: 1.5, river: [[-140, -46], [-70, -14], [0, -2], [70, 8], [140, 34]], riverWidth: 78, island, trees: 5200, enter: 'none' },
    { kind: 'city', area: plot, towerEvery: 7, style: 'villa', count: o.houses.end, startCount: o.houses.start, growS: o.houses.growS, atS: 0.3, seed: o.seed ?? 7, house: { w: [3.0, 4.4], d: [2.2, 3.0], h: [1.0, 1.4] }, gap: 4.2, ...(o.wallAtS !== undefined ? { wallAtS: o.wallAtS, wallS: 2.2, wallHeight: 1.7 } : {}) },
    // the bridge to the right bank and the standard over the town
    { kind: 'block', at: [22, 0.55, -28], size: [2.6, 0.5, 22], radius: 0.05, role: 'dark', material: 'matte', enter: 'none' },
    { kind: 'block', at: [2, 3.6, -9], size: [0.16, 6.4, 0.16], radius: 0.02, role: 'ground', material: 'matte', enter: 'none' },
    { kind: 'block', at: [2.85, 5.9, -9], size: [1.7, 1.1, 0.06], radius: 0.02, role: 'roof', material: 'matte', enter: 'none' },
    { kind: 'counter', keys: o.years, to: 0, prefix: 'AD ', group: '', size: 0.66, face: 'sans', role: 'fg', at: [0, 3.69, 0], screen: true, atS: 0, enter: 'none', glow: false, shadow: true },
    { kind: 'text', text: o.era.toUpperCase(), size: 0.26, face: 'sans', role: 'gold', tracking: 0.1, at: [0, 2.84, 0], screen: true, atS: 0, enter: 'none', shadow: true }
  ]
  if (o.caption) {
    const c = o.caption
    c.text.forEach((line, i) => items.push({ kind: 'text', text: line, ...(i === 0 ? { lead: c.lead } : {}), size: 0.3, face: 'semi', role: 'fg', at: [0, -3.05 - i * 0.42, 0], screen: true, atS: c.atS, enter: 'fade', shadow: true }))
  }
  return {
    look: {
      background: { kind: 'sky', top: '#a9bfc9', bottom: '#b4c4c6', spotAt: [0.5, 0.4] },
      palette: { grass: '#4a8a2e', tree: '#24481a', ground: '#7d6350', water: '#7f8b7c', dark: '#4a3a2c', roof: '#e8814a', wall: '#e6d8bd', gold: '#e8b84a', fg: '#ffffff' },
      face: 'sans',
      labelFace: 'semi',
      glow: 0,
      grain: 0.01,
      vignette: 0.15,
      light: 'sun',
      shadows: true,
      exposure: 0.95,
      fog: { color: '#b4c4c6', near: 90, far: 230 },
      stagger: 0.1
    },
    camera: { fov: 42, ease: 'linear', drift: 0, keys: [{ atS: 0, pos: [-34, 32, 40], target: [4, 0, -6] }, { atS: o.d, pos: [-27, 31, 39], target: [9, 0, -7] }] },
    items
  }
}

/** One beat the director gives the studio: what the words say, in the shape a recipe takes. */
export type StudioBeat =
  | { kind: 'split'; value: number; unit?: string; parts: number }
  | { kind: 'equals'; value: string; unit?: string; label: string; stack: { label: string; weight: number }[]; stackLabel?: string }
  | { kind: 'entity'; title: string; sub?: string[]; traits: string[] }
  | { kind: 'hero'; shape: 'vault' | 'coin' | 'ingot' | 'cube'; pills: string[] }
  | { kind: 'timelapse'; years: [number, number][]; era: string; caption?: { lead: string; text: string[]; atS: number }; houses: { start: number; end: number; growS: number }; wallAtS?: number }

/**
 * The director's call: a `studio` card spec (formats/motion.ts) for one beat `d` seconds long, in the channel's measured motion style.
 * The card is a documentary card (the base shot itself, opaque); `checkMotion` says whether it fits its length.
 */
export function studioSpec(beat: StudioBeat, measured: MeasuredMotion, d: number): { template: 'studio'; props: StudioPropsInput; accent: string; theme: 'dark' } {
  const look = studioLookOf(measured)
  const props = ((): StudioPropsInput => {
    switch (beat.kind) {
      case 'split':
        return branchScene({ ...beat, look, d })
      case 'equals':
        return stackScene({ ...beat, look, d })
      case 'entity':
        return nodeScene({ ...beat, look, d })
      case 'hero':
        return heroScene({ ...beat, look, d })
      case 'timelapse':
        return timelapseScene({ ...beat, d })
    }
  })()
  return { template: 'studio', props, accent: look.palette?.accent ?? '#f6a465', theme: 'dark' }
}
