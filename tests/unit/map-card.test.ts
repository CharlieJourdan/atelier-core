// The documentary map card (formats/cards.ts, motion/geo.ts, motion/map-card.ts): countries found by code and name, views fitted to the page,
// the projection, the paths, the template's markup, the plan's check; and, where there is a Chromium and an ffmpeg, the card drawn for real:
// three frames of a 1940 Europe map (Switzerland in gold, Berlin to Bern) saved under docs/screens/style-markets/; a route along the way whose
// head rides the drawn end of its line, measured on the frames.
import { mkdirSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CardAssets, MapCardProps } from '../../src/engine/formats/cards'
import { MapCardProps as MapCardSchema } from '../../src/engine/formats/cards'
import { checkMotion, type MotionSpecInput } from '../../src/engine/formats/motion'
import { chromiumService, findBrowser } from '../../src/engine/media/browser'
import { motionHtml } from '../../src/engine/motion'
import { GIBS_LAYER, bundledEarth, cropArgs, cropEarth, cropPlan, gibsCrop, type FetchFile } from '../../src/engine/motion/earth'
import { RUNTIME_JS } from '../../src/engine/motion/runtime'
import { promoFontCssOf } from '../../src/engine/motion/fonts'
import { boxOf, curveLength, findCountries, fitView, loadCountries, mapGeometry, pointAlong, project, routeCurve, routeEase, type Country, type MapGeometry } from '../../src/engine/motion/geo'
import { routeTimes } from '../../src/engine/motion/map-card'
import { prepareMapAssets } from '../../src/engine/motion/geo'
import { MEDIA, RESOURCES, ROOT, hasFfmpeg, tempDir } from './engine-node-helpers'

const SAMPLE: MapCardProps = MapCardSchema.parse({
  kicker: 'June 1940',
  title: 'Complaints to Bern',
  view: { west: -12, south: 36, east: 34, north: 62 },
  zoomTo: { west: 3, south: 44, east: 15, north: 55 },
  regions: [
    { countries: ['Switzerland'], tone: 'gold', label: 'Switzerland', atS: 1.2 },
    { countries: ['DEU', 'Autriche'], tone: 'red', atS: 0.9 },
    { countries: ['Italy'], tone: 'pale' }
  ],
  pins: [
    { lat: 52.52, lon: 13.4, label: 'Berlin', note: 'The complaints leave the Reich Chancellery by courier.', atS: 2.4 },
    { lat: 46.95, lon: 7.45, label: 'Bern', note: 'The Federal Palace receives them.', atS: 3.2 }
  ],
  routes: [{ from: { lat: 52.52, lon: 13.4 }, to: { lat: 46.95, lon: 7.45 }, label: 'Diplomatic note', atS: 2.6 }],
  names: [
    { lat: 47.6, lon: 1.5, text: 'France' },
    { lat: 43.3, lon: 11.5, text: 'Italy' },
    { lat: 52.8, lon: -0.5, text: 'United Kingdom' },
    { lat: 56.5, lon: 3, text: 'North Sea' }
  ]
})
const W = 1920
const H = 1080

describe('countries', () => {
  let all: Country[]
  beforeAll(async () => {
    all = await loadCountries(RESOURCES)
  })

  it('loads every country of the world with its rings', () => {
    expect(all.length).toBeGreaterThan(230)
    const swiss = findCountries(all, ['CHE']).countries[0] as Country
    expect(swiss.name).toBe('Switzerland')
    expect(swiss.box.west).toBeCloseTo(5.97, 1)
    expect(swiss.rings[0]?.pts.length).toBeGreaterThan(100)
  })

  it('finds a country by ISO code, English name, French name, in any case and accent, and reports the names it does not know', () => {
    const iso = (n: string): string | undefined => findCountries(all, [n]).countries[0]?.iso
    expect(iso('CHE')).toBe('CHE')
    expect(iso('che')).toBe('CHE')
    expect(iso('Switzerland')).toBe('CHE')
    expect(iso('Suisse')).toBe('CHE')
    expect(iso('SUISSE')).toBe('CHE')
    expect(iso('Allemagne')).toBe('DEU')
    expect(iso('Autriche')).toBe('AUT')
    expect(iso('États-Unis')).toBe('USA')
    expect(iso('Etats Unis')).toBe('USA')
    expect(iso('USA')).toBe('USA')
    expect(iso('United States')).toBe('USA')
    expect(iso('Côte d’Ivoire')).toBe('CIV')
    expect(iso('Norvège')).toBe('NOR')
    expect(iso('France')).toBe('FRA')
    const r = findCountries(all, ['Suisse', 'Narnia', 'CHE', 'Atlantis'])
    expect(r.countries.map((c) => c.iso)).toEqual(['CHE'])
    expect(r.unknown).toEqual(['Narnia', 'Atlantis'])
  })

  it('keeps a far-away territory out of the box of a country’s mainland', () => {
    const fr = findCountries(all, ['France']).countries[0] as Country
    expect(fr.box.west).toBeLessThan(-50)
    expect(fr.main.west).toBeGreaterThan(-6)
    expect(fr.main.east).toBeLessThan(10)
  })
})

describe('views and projection', () => {
  const ASPECT = 16 / 9
  const shape = (b: { west: number; east: number; south: number; north: number }, cosLat: number): number => ((b.east - b.west) * cosLat) / (b.north - b.south)

  it('fits a box to the page’s aspect (shapes are not stretched), about its centre, holding the box', () => {
    const box = { west: 5, south: 45, east: 11, north: 48 }
    const v = fitView(box, ASPECT)
    expect(shape(v, Math.cos(((box.south + box.north) / 2) * (Math.PI / 180)))).toBeCloseTo(ASPECT, 6)
    expect(v.west).toBeLessThanOrEqual(box.west)
    expect(v.east).toBeGreaterThanOrEqual(box.east)
    expect(v.south).toBeLessThanOrEqual(box.south)
    expect(v.north).toBeGreaterThanOrEqual(box.north)
    expect((v.west + v.east) / 2).toBeCloseTo(8, 6)
    expect((v.south + v.north) / 2).toBeCloseTo(46.5, 6)
    // a tall box is widened instead
    const tall = fitView({ west: 8, south: 30, east: 9, north: 60 }, ASPECT)
    expect(shape(tall, Math.cos(45 * (Math.PI / 180)))).toBeCloseTo(ASPECT, 6)
    expect(tall.south).toBeCloseTo(30, 6)
    // a margin grows each side by its fraction
    const m = fitView({ west: 0, south: 40, east: 20, north: 50 }, 2, 0.1)
    expect(m.north - m.south).toBeGreaterThanOrEqual(12 - 1e-9)
  })

  it('uses the cosine it is given, moves a box that leaves the Earth back inside it, and shrinks one that cannot fit', () => {
    const a = fitView({ west: 0, south: 40, east: 10, north: 50 }, ASPECT, 0, { cosLat: 0.5 })
    expect(shape(a, 0.5)).toBeCloseTo(ASPECT, 6)
    const edge = fitView({ west: 170, south: 60, east: 180, north: 66 }, ASPECT)
    expect(edge.east).toBeLessThanOrEqual(180 + 1e-9)
    expect(edge.east - edge.west).toBeGreaterThan(10)
    const world = fitView({ west: -180, south: -80, east: 180, north: 80 }, ASPECT)
    expect(world.north - world.south).toBeLessThanOrEqual(180 + 1e-9)
    expect(world.south).toBeGreaterThanOrEqual(-90 - 1e-9)
  })

  it('boxOf gathers boxes and points', () => {
    expect(boxOf([])).toBeNull()
    expect(boxOf([{ lat: 10, lon: 20 }, { west: -5, south: 0, east: 5, north: 3 }])).toEqual({ west: -5, south: 0, east: 20, north: 10 })
  })

  it('projects a known point linearly in the picture', () => {
    const view = { west: 0, south: 40, east: 20, north: 50 }
    const size = { width: 2000, height: 1000 }
    expect(project(10, 45, view, size)).toEqual({ x: 1000, y: 500 })
    expect(project(0, 50, view, size)).toEqual({ x: 0, y: 0 })
    expect(project(20, 40, view, size)).toEqual({ x: 2000, y: 1000 })
    expect(project(5, 47.5, view, size)).toEqual({ x: 500, y: 250 })
  })
})

describe('the geometry of the sample card', () => {
  let geo: MapGeometry
  beforeAll(async () => {
    geo = mapGeometry(SAMPLE, { width: W, height: H, countries: await loadCountries(RESOURCES) })
  })

  it('has the first view as written, the end of the move at the page’s shape, and a point where it should be', () => {
    expect(geo.startView).toEqual(fitView(SAMPLE.view as never, W / H))
    expect(geo.start).toEqual({ x: 0, y: 0, w: W, h: H })
    expect(geo.end.w / geo.end.h).toBeCloseTo(W / H, 4)
    expect(geo.end.w).toBeLessThan(W / 2)
    // Bern is east of the western edge and north of the southern one; Berlin is north-east of Bern
    const [berlin, bern] = geo.pins as [{ x: number; y: number }, { x: number; y: number }]
    expect(berlin.x).toBeGreaterThan(bern.x)
    expect(berlin.y).toBeLessThan(bern.y)
    expect(bern.x).toBeCloseTo(((7.45 - geo.startView.west) / (geo.startView.east - geo.startView.west)) * W, 3)
    expect(geo.routes[0]).toMatchObject({ x1: berlin.x, y1: berlin.y, x2: bern.x, y2: bern.y })
    expect(geo.names).toHaveLength(4)
  })

  it('has one path per region, borders, and the label of the region that has one', () => {
    expect(geo.regions).toHaveLength(3)
    for (const d of geo.regions) expect(d).toMatch(/^M[-\d. ]+L.*Z$/)
    expect(geo.regions[0]?.length).toBeLessThan((geo.regions[1] as string).length) // Switzerland is smaller than Germany + Austria
    expect(geo.borders.length).toBeGreaterThan(5000)
    expect(geo.labels?.[0]?.x).toBeGreaterThan(0)
    expect(geo.labels?.[1]?.x).toBeLessThan(-1000) // no label: parked off the page
  })

  it('names the countries it does not know, and a view with nothing in it still has a shape', async () => {
    const all = await loadCountries(RESOURCES)
    expect(() => mapGeometry({ ...SAMPLE, regions: [{ countries: ['Suisse', 'Narnia'], tone: 'red' }] }, { width: W, height: H, countries: all })).toThrow(/Narnia/)
    const bare = mapGeometry(MapCardSchema.parse({ title: 'Nothing' }), { width: W, height: H, countries: all })
    expect(bare.end.w).toBeCloseTo(W * 0.95, 0)
    // with no view: the regions, the pins and the routes, with a margin, are in the first view
    const dflt = mapGeometry(MapCardSchema.parse({ title: 'X', regions: [{ countries: ['Switzerland'], tone: 'red' }], pins: [{ lat: 46.95, lon: 7.45, label: 'Bern' }] }), { width: W, height: H, countries: all })
    const p = dflt.pins[0] as { x: number; y: number }
    expect(p.x).toBeGreaterThan(0)
    expect(p.x).toBeLessThan(W)
    expect(p.y).toBeGreaterThan(0)
    expect(p.y).toBeLessThan(H)
  })
})

describe('routes along the way', () => {
  let all: Country[]
  beforeAll(async () => {
    all = await loadCountries(RESOURCES)
  })
  const ist = { lat: 41.01, lon: 28.98 }
  const ams = { lat: 52.37, lon: 4.9 }
  const via = [{ lat: 42.7, lon: 23.32 }, { lat: 44.79, lon: 20.45 }, { lat: 48.21, lon: 16.37 }, { lat: 50.11, lon: 8.68 }]

  it('passes through every waypoint, in order, from the start to the end', () => {
    const p = MapCardSchema.parse({ title: 'Bulbs', routes: [{ from: ist, to: ams, via }] })
    const geo = mapGeometry(p, { width: W, height: H, countries: all })
    const r = geo.routes[0] as { x1: number; y1: number; x2: number; y2: number; pts: number[] }
    const at = (q: { lat: number; lon: number }): { x: number; y: number } => project(q.lon, q.lat, geo.startView, { width: W, height: H })
    expect(r.pts.length / 2).toBe(32 * 5 + 1)
    expect(r.pts.slice(0, 2)).toEqual([expect.closeTo(at(ist).x, 1), expect.closeTo(at(ist).y, 1)])
    expect(r.pts.slice(-2)).toEqual([expect.closeTo(at(ams).x, 1), expect.closeTo(at(ams).y, 1)])
    // each waypoint is a point of the curve (the start of its piece), and they come in order
    via.forEach((v, j) => {
      const q = at(v)
      expect(r.pts[(j + 1) * 32 * 2]).toBeCloseTo(q.x, 1)
      expect(r.pts[(j + 1) * 32 * 2 + 1]).toBeCloseTo(q.y, 1)
    })
    // a smooth curve: no step is long, no turn between two steps is sharp
    for (let i = 2; i + 3 < r.pts.length; i += 2) {
      const a = Math.atan2((r.pts[i + 1] as number) - (r.pts[i - 1] as number), (r.pts[i] as number) - (r.pts[i - 2] as number))
      const b = Math.atan2((r.pts[i + 3] as number) - (r.pts[i + 1] as number), (r.pts[i + 2] as number) - (r.pts[i] as number))
      expect(Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))).toBeLessThan(0.35)
    }
  })

  it('frames the waypoints with the places when the card has no view', () => {
    const far = { lat: 60.2, lon: 24.9 }
    const p = MapCardSchema.parse({ title: 'Detour', routes: [{ from: ist, to: ams, via: [far] }] })
    const geo = mapGeometry(p, { width: W, height: H, countries: all })
    expect(geo.startView.north).toBeGreaterThan(far.lat)
    expect(geo.startView.east).toBeGreaterThan(ist.lon)
    for (let i = 0; i + 1 < (geo.routes[0]?.pts ?? []).length; i += 2) {
      const [x, y] = (geo.routes[0]?.pts ?? []).slice(i, i + 2) as [number, number]
      expect(x >= 0 && x <= W && y >= 0 && y <= H).toBe(true)
    }
  })

  it('bows a route with no waypoint into a gentle arc towards the north, not a ruler line', () => {
    const c = routeCurve([{ x: 1500, y: 800 }, { x: 300, y: 300 }])
    expect(c[0]).toEqual({ x: 1500, y: 800 })
    expect(c[c.length - 1]).toEqual({ x: 300, y: 300 })
    const len = Math.hypot(1200, 500)
    const mid = c[(c.length - 1) / 2] as { x: number; y: number }
    // its middle stands off the chord by ≈ 11 % of its length, on the upper side
    const off = ((mid.x - 900) * 500 - (mid.y - 550) * 1200) / len
    expect(Math.abs(off)).toBeCloseTo(0.11 * len, 0)
    expect(mid.y).toBeLessThan(550)
    // a route straight down the page bows east; the same places always make the same shape, at any scale
    const down = routeCurve([{ x: 100, y: 100 }, { x: 100, y: 900 }])
    expect((down[(down.length - 1) / 2] as { x: number }).x).toBeGreaterThan(100)
    const big = routeCurve([{ x: 3000, y: 1600 }, { x: 600, y: 600 }])
    big.forEach((q, i) => expect(q.x / 2).toBeCloseTo((c[i] as { x: number }).x, 6))
  })

  it('draws for as long as its way is long (calm), or for its own drawS', () => {
    const p = MapCardSchema.parse({ title: 'T', routes: [{ from: ist, to: ams, via }, { from: ist, to: { lat: 41.5, lon: 27 } }, { from: ist, to: ams, drawS: 9 }] })
    const geo = mapGeometry(p, { width: W, height: H, countries: all })
    const t = routeTimes(p, geo as never, { width: W, height: H, durationS: 12 })
    expect(curveLength(geo.routes[0]?.pts ?? [])).toBeGreaterThan(1000)
    expect(t[0]?.dur).toBeGreaterThan(4)
    expect(t[0]?.dur).toBeLessThanOrEqual(6)
    expect(t[1]?.dur).toBe(2.5)
    expect(t[2]?.dur).toBe(9)
    // the same card at 4K draws at the same pace
    const geo4 = mapGeometry(p, { width: 2 * W, height: 2 * H, countries: all })
    expect(routeTimes(p, geo4 as never, { width: 2 * W, height: 2 * H, durationS: 12 })[0]?.dur).toBeCloseTo(t[0]?.dur as number, 2)
  })
})

describe.skipIf(!hasFfmpeg)('the Earth picture', () => {
  it('plans a crop of the bundled picture aligned on whole pixels, and lays several sources out on one canvas', () => {
    const earth = bundledEarth('/lib')
    const one = cropPlan({ west: 5, south: 45, east: 10, north: 48 }, [earth])
    expect(one.pieces).toHaveLength(1)
    expect(one).toMatchObject({ ppd: 15, width: 75, height: 45 })
    expect(one.pieces[0]).toMatchObject({ x: (5 + 180) * 15, y: (90 - 48) * 15, w: 75, h: 45, dx: 0, dy: 0 })
    const half = (file: string, west: number) => ({ file, west, north: 90, widthDeg: 90, heightDeg: 90, ppd: 240 })
    const sources = [half('/b.jpg', -90), half('/c.jpg', 0)]
    const two = cropPlan({ west: -2, south: 10, east: 3, north: 20 }, sources)
    expect(two.pieces).toHaveLength(2)
    expect(two.pieces[0]).toMatchObject({ dx: 0, w: 2 * 240 })
    expect(two.pieces[1]).toMatchObject({ x: 0, dx: 2 * 240, w: 3 * 240 })
    const args = cropArgs(two, sources, 1000, 500, 5).join(' ')
    expect(args).toContain('overlay=480:0')
    expect(args).toContain('scale=1000:500')
  })

  it('asks NASA GIBS for the box, keeps the picture in the cache folder and does not ask twice; gives up quietly when it cannot be had', async () => {
    const t = tempDir('gibs')
    try {
      const calls: string[] = []
      const jpg = (await cropEarth({ media: MEDIA as NonNullable<typeof MEDIA>, signal: new AbortController().signal, sources: [bundledEarth(RESOURCES)], box: { west: 0, south: 40, east: 20, north: 50 }, outW: 300, outH: 150, maxBytes: 1e6 })).image
      const fetchFile: FetchFile = async (url, dest) => {
        calls.push(url)
        await writeFile(dest, Buffer.from(jpg.split(',')[1] as string, 'base64'))
      }
      const box = { west: 3.5, south: 44, east: 12.25, north: 49 }
      const a = await gibsCrop({ cacheDir: t.dir, box, w: 1000, h: 570, maxBytes: 1.5e6, signal: new AbortController().signal, fetchFile })
      const b = await gibsCrop({ cacheDir: t.dir, box, w: 1000, h: 570, maxBytes: 1.5e6, signal: new AbortController().signal, fetchFile })
      expect(a?.image).toBe(b?.image)
      expect(a?.box).toEqual(box)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toContain('BBOX=3.50000,44.00000,12.25000,49.00000')
      expect(calls[0]).toContain('WIDTH=1000&HEIGHT=570')
      expect(calls[0]).toContain(`LAYERS=${GIBS_LAYER}`)
      // too big for the budget: asked again smaller; nothing reachable: null
      const small = await gibsCrop({ cacheDir: t.dir, box, w: 1000, h: 570, maxBytes: 100, signal: new AbortController().signal, fetchFile })
      expect(small).toBeNull()
      const down = await gibsCrop({ cacheDir: t.dir, box: { west: 1, south: 1, east: 2, north: 2 }, w: 100, h: 100, maxBytes: 1e6, signal: new AbortController().signal, fetchFile: () => Promise.reject(new Error('offline')) })
      expect(down).toBeNull()
      // and a card prepared with a cache folder uses it for the wide picture and for where the camera arrives; the bundled one when it is down
      const map = await prepareMapAssets(SAMPLE, { width: W, height: H, libraryRoot: RESOURCES, cacheDir: t.dir, media: MEDIA as NonNullable<typeof MEDIA>, fetchFile })
      expect(map.detail).toBeDefined()
      expect(map.warnings).toBeUndefined()
      const off = await prepareMapAssets(SAMPLE, { width: W, height: H, libraryRoot: RESOURCES, cacheDir: path.join(t.dir, 'off'), media: MEDIA as NonNullable<typeof MEDIA>, fetchFile: () => Promise.reject(new Error('offline')) })
      expect(off.detail).toBeUndefined()
      expect(off.warnings?.[0]).toMatch(/not available/)
      expect(off.image.startsWith('data:image/jpeg')).toBe(true)
    } finally {
      t.cleanup()
    }
  }, 120_000)
})

describe('the template', () => {
  const spec = (props: MapCardProps): MotionSpecInput => ({ template: 'map', props })
  let html = ''
  beforeAll(async () => {
    const geo = mapGeometry(SAMPLE, { width: W, height: H, countries: await loadCountries(RESOURCES) })
    const { startView: _a, endView: _b, kx: _c, ky: _d, ...assets } = geo
    const map: CardAssets['map'] = { ...assets, image: 'data:image/jpeg;base64,AAAA', imageBox: geo.imageBox }
    html = motionHtml(spec(SAMPLE), { width: W, height: H, durationS: 12, fontCss: '' }, { map })
  })

  it('draws a path per region, a dot and a callout per pin, a route that is drawn, the names, the title and the camera', () => {
    expect(html.match(/class="reg"/g)).toHaveLength(3)
    expect(html.match(/class="dot"/g)).toHaveLength(3) // the two pins and the start of the route
    expect(html.match(/class="box"/g)?.length).toBeGreaterThanOrEqual(3)
    expect(html).toContain('Berlin')
    expect(html).toContain('The Federal Palace receives them.')
    expect(html).toContain('data-draw')
    expect(html.match(/class="ct nm"/g)).toHaveLength(4)
    expect(html).toContain('>Switzerland<')
    expect(html).toContain('June 1940')
    expect(html).toContain('Complaints to Bern')
    expect(html).toMatch(/data-cam="0\.00 0\.00 1920\.00 /)
    expect(html).toContain('data-cl')
    expect(html).toContain('<img src="data:image/jpeg')
    expect(html).toContain('background:#050a12')
  })

  it('draws the route as a curve that draws itself with a head riding its end (no arrow), the label when it arrives', () => {
    expect(html).not.toContain('class="tip"')
    const draws = [...html.matchAll(/<path class="rt" pathLength="1" data-draw data-at="([\d.]+)" data-dur="([\d.]+)" data-ease="sine"[^>]* d="([^"]+)"/g)]
    expect(draws).toHaveLength(2) // the dark under-stroke and the red line
    const d = draws[0]?.[3] as string
    expect(d.match(/L/g)?.length).toBeGreaterThan(30)
    const head = html.match(/data-cpath="([^"]+)" data-at="([\d.]+)" data-dur="([\d.]+)" data-ease="sine"/)
    expect(head).not.toBeNull()
    // the head rides the same points, from the same time, over the same time, with the same ease as the line
    const pts = (head?.[1] as string).split(' ').map(Number)
    const fromD = d.replace(/^M/, '').split('L').flatMap((xy) => xy.split(' ').map(Number))
    expect(pts).toEqual(fromD)
    expect([head?.[2], head?.[3]]).toEqual([draws[0]?.[1], draws[0]?.[2]])
    expect(html).toContain('class="rh"')
    // the label fades in when the head arrives; the halo fades out then, the dot stays
    const end = (Number(head?.[2]) + Number(head?.[3])).toFixed(2)
    expect(html).toContain(`data-anim="fade" data-at="${end}" data-dur="0.6"><div class="box"`)
    expect(html).toContain(`data-out="${end}"`)
  })

  it('escapes what the director wrote', () => {
    const bad = motionHtml(spec(MapCardSchema.parse({ title: '<b>x</b> & "y"' })), { width: W, height: H, durationS: 6, fontCss: '' }, {})
    expect(bad).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;')
    expect(bad).not.toContain('<b>x')
  })

  it('draws parts without a time one after the other from just after the title, within the first 40 % of the card', () => {
    const loose = MapCardSchema.parse({ title: 'T', pins: [{ lat: 1, lon: 1, label: 'A' }, { lat: 2, lon: 2, label: 'B' }, { lat: 3, lon: 3, label: 'C' }] })
    const page = motionHtml(spec(loose), { width: W, height: H, durationS: 20, fontCss: '' }, { map: { start: { x: 0, y: 0, w: W, h: H }, end: { x: 0, y: 0, w: W, h: H }, borders: '', regions: [], pins: [{ x: 100, y: 100 }, { x: 600, y: 300 }, { x: 900, y: 500 }], routes: [], names: [], width: W, height: H, image: '', imageBox: { west: 0, south: 0, east: 1, north: 1 } } })
    const times = [...page.matchAll(/data-anim="pop" data-at="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(times).toHaveLength(3)
    expect(times[0]).toBeGreaterThan(0.5)
    expect(times).toEqual([...times].sort((x, y) => x - y))
    expect(times[2]).toBeLessThan(20 * 0.4)
  })

  it('is a valid plan for a card of 6 s, and is refused when a part comes too late or the spec is wrong', () => {
    expect(checkMotion(spec(SAMPLE), 12)).toEqual([])
    expect(checkMotion(spec(SAMPLE), 3.2).join('\n')).toMatch(/too late/)
    expect(checkMotion({ template: 'map', props: { title: '' } }, 10).length).toBeGreaterThan(0)
    expect(checkMotion({ template: 'map', props: { title: 'x', view: { west: 10, south: 0, east: 5, north: 1 } } }, 10).length).toBeGreaterThan(0)
  })

  it('still gives a page without assets (a title on a dark sea)', () => {
    const page = motionHtml(spec(MapCardSchema.parse({ title: 'Empty' })), { width: W, height: H, durationS: 5, fontCss: '' })
    expect(page).toContain('Empty')
    expect(page).not.toContain('data-cam="')
  })
})

describe('the camera of the runtime', () => {
  type Cam = (a: number[], b: number[], pw: number, ph: number, k: number) => { s: number; cx: number; cy: number; tx: number; ty: number }
  const root: { __atelierMotion?: { camera: Cam; ease: Record<string, (x: number) => number> } } = {}
  new Function('window', 'document', RUNTIME_JS)(root, undefined)
  const m = root.__atelierMotion as NonNullable<typeof root.__atelierMotion>

  it('starts on the first box, ends on the last, zooms steadily in between and keeps the view inside the two boxes', () => {
    const a = [0, 0, 1920]
    const b = [800, 300, 480]
    const c0 = m.camera(a, b, 1920, 1080, 0)
    expect(c0).toMatchObject({ s: 1, tx: 0, ty: 0 })
    const c1 = m.camera(a, b, 1920, 1080, 1)
    expect(c1.s).toBeCloseTo(4, 9)
    // the world point at the screen's centre is the box's centre; its top-left corner lands on the page's
    expect(c1.tx + 800 * c1.s).toBeCloseTo(0, 6)
    expect(c1.ty + 300 * c1.s).toBeCloseTo(0, 6)
    // the scale grows geometrically: halfway it is the geometric mean
    expect(m.camera(a, b, 1920, 1080, 0.5).s).toBeCloseTo(2, 9)
    expect(m.ease.sine?.(0.5)).toBeCloseTo(0.5, 9)
    expect(m.ease.sine?.(0)).toBe(0)
    expect(m.ease.sine?.(1)).toBeCloseTo(1, 12)
  })

  it('puts a route’s head where geo.ts says it is: the same polyline arithmetic, the same ease', () => {
    const tp = (root.__atelierMotion as unknown as { tracePoint: (pts: number[][], k: number) => { x: number; y: number } }).tracePoint
    const flat = routeCurve([{ x: 100, y: 900 }, { x: 600, y: 500 }, { x: 900, y: 650 }, { x: 1700, y: 120 }]).flatMap((q) => [q.x, q.y])
    const pairs: number[][] = []
    for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i] as number, flat[i + 1] as number])
    for (const k of [0, 0.13, 0.5, 0.77, 1]) {
      expect(tp(pairs, k).x).toBeCloseTo(pointAlong(flat, k).x, 9)
      expect(tp(pairs, k).y).toBeCloseTo(pointAlong(flat, k).y, 9)
      expect(m.ease.sine?.(k)).toBeCloseTo(routeEase(k), 12)
    }
  })
})

// ---- a real browser ---------------------------------------------------------------------------------------------------------------------

const exe = findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })
const skip = !exe ? 'no Chromium, Chrome or Edge found (set ATELIER_CHROMIUM)' : !hasFfmpeg ? 'no ffmpeg on PATH' : ''
const service = chromiumService(exe ? { executablePath: exe } : {})
afterAll(() => service.close?.(), 60_000)

describe.skipIf(skip !== '')(`the map card in a real browser (${skip || 'Chromium + ffmpeg'})`, () => {
  const signal = new AbortController().signal
  // saved for a look outside git; ATELIER_SAVE_SCREENS=1 writes them to docs/screens/style-markets/
  const SHOTS = process.env.ATELIER_SAVE_SCREENS ? path.join(ROOT, 'docs', 'screens', 'style-markets') : path.join(os.tmpdir(), 'atelier-screens', 'style-markets')

  /** A frame as a JPEG of at most 400 KB (the quality goes down by steps). */
  async function jpeg(png: Uint8Array): Promise<Buffer> {
    let last: Buffer = Buffer.alloc(0)
    for (const q of [3, 5, 8, 12, 18]) {
      const r = await (MEDIA as NonNullable<typeof MEDIA>).run('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-frames:v', '1', '-c:v', 'mjpeg', '-pix_fmt', 'yuvj420p', '-q:v', String(q), '-f', 'image2pipe', '-'], { signal, stdin: png })
      last = r.stdout
      if (last.length <= 400_000) break
    }
    return last
  }

  it('prepares the assets with the real pictures and draws the card: three frames of 1940 Europe, Switzerland in gold, Berlin to Bern', { timeout: 240_000 }, async () => {
    const map = await prepareMapAssets(SAMPLE, { width: W, height: H, libraryRoot: RESOURCES, media: MEDIA as NonNullable<typeof MEDIA>, signal })
    expect(map.image.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(map.image.length).toBeLessThanOrEqual(1_500_000)
    expect(map.warnings).toBeUndefined()
    const fontCss = await promoFontCssOf(RESOURCES)
    const html = motionHtml({ template: 'map', props: SAMPLE }, { width: W, height: H, durationS: 12, fontCss }, { map })
    const page = await service.open({ html, width: W, height: H, signal })
    mkdirSync(SHOTS, { recursive: true })
    try {
      const sizes: number[] = []
      for (const [name, t] of [['1-start', 0.6], ['2-route', 3.6], ['3-end', 11.5]] as const) {
        const png = await page.frame(t)
        const jpg = await jpeg(png)
        sizes.push(jpg.length)
        writeFileSync(path.join(SHOTS, `map-${name}.jpg`), jpg)
      }
      expect(Math.max(...sizes)).toBeLessThanOrEqual(400_000)
      // the same moment is the same picture whatever came before
      const a = await page.frame(5)
      await page.frame(1)
      expect(Buffer.from(await page.frame(5)).equals(Buffer.from(a))).toBe(true)
    } finally {
      await page.close()
    }
  })

  it('draws a route along the way whose head rides exactly the drawn end of its line', { timeout: 120_000 }, async () => {
    const w = 960
    const h = 540
    const flat = routeCurve([{ x: 820, y: 430 }, { x: 640, y: 350 }, { x: 520, y: 220 }, { x: 330, y: 190 }, { x: 140, y: 110 }]).flatMap((q) => [q.x, q.y])
    const props = MapCardSchema.parse({ title: 'T', routes: [{ from: { lat: 1, lon: 1 }, to: { lat: 2, lon: 2 }, via: [{ lat: 1.5, lon: 1.5 }], atS: 0.5, drawS: 4 }] })
    const map: CardAssets['map'] = { start: { x: 0, y: 0, w, h }, end: { x: 0, y: 0, w, h }, borders: '', regions: [], pins: [], routes: [{ x1: 820, y1: 430, x2: 140, y2: 110, pts: flat }], names: [], width: w, height: h, image: '', imageBox: { west: 0, south: 0, east: 1, north: 1 } }
    const ctx = { width: w, height: h, durationS: 8, fontCss: '' }
    const html = motionHtml({ template: 'map', props }, ctx, { map })
    const time = routeTimes(props, map, ctx)[0] as { start: number; dur: number }
    // two views of the same page: the line alone, and the head's dot alone (the start dot, the halo, the title and the shading hidden)
    const hide = (css: string): string => html.replace('</style>', `${css}</style>`)
    const lineOnly = hide('.rh,.dot,.vig,.corner,.hd{display:none!important}')
    const headOnly = hide('.rt,.dot,.rh b,.vig,.corner,.hd{display:none!important}')
    const raw = async (png: Uint8Array): Promise<Buffer> => (await (MEDIA as NonNullable<typeof MEDIA>).run('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { signal, stdin: png })).stdout
    const red = (px: Buffer, x: number, y: number): boolean => {
      const i = (Math.round(y) * w + Math.round(x)) * 3
      return (px[i] as number) > 170 && (px[i + 1] as number) < 120 && (px[i + 2] as number) < 110
    }
    const len = curveLength(flat)
    const pl = await service.open({ html: lineOnly, width: w, height: h, signal })
    const ph = await service.open({ html: headOnly, width: w, height: h, signal })
    try {
      for (const share of [0.2, 0.5, 0.8]) {
        const t = time.start + time.dur * share
        const k = routeEase(share)
        const at = pointAlong(flat, k)
        // the line: red along the curve up to where it is drawn, then nothing (within 3 px of the head's place along the way)
        const line = await raw(await pl.frame(t))
        let last = 0
        for (let s = 0; s <= 1.0001; s += 0.002) if (red(line, pointAlong(flat, s).x, pointAlong(flat, s).y)) last = s
        expect(Math.abs(last - k) * len, `line at ${share}`).toBeLessThan(3)
        // the head: its red dot is centred on that place
        const dot = await raw(await ph.frame(t))
        let sx = 0
        let sy = 0
        let n = 0
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (red(dot, x, y)) {
          sx += x
          sy += y
          n++
        }
        expect(n, `head at ${share}`).toBeGreaterThan(20) // a 7 px dot at this size
        expect(Math.hypot(sx / n - at.x, sy / n - at.y), `head at ${share}`).toBeLessThan(1.5)
      }
    } finally {
      await pl.close()
      await ph.close()
    }
  })
})
