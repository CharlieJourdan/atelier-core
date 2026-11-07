// The 3D map card (formats/map3d.ts, motion/map3d-plan.ts, motion/map3d-data.ts, motion/map3d-dem.ts, motion/map3d.ts): its props, the camera
// (keys with the measured push ease, a route followed while it draws), the ground the camera sees and the tiles it will ask for, the
// preparation with a fake network (tiles kept in a cache, the page's weight kept under its budget, the library made to run in a page without
// an origin), the light terrain tiles, and the page itself (everything inline, its data safe inside a <script>). No network, no browser
// (the real drawing: map3d-browser.test.ts).
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Map3dProps, type Map3dPropsInput } from '../../src/engine/formats/map3d'
import { FPS } from '../../src/engine/formats/timing'
import { pageHtml, themeOf } from '../../src/engine/motion/base'
import { map3dCard, scriptJson } from '../../src/engine/motion/map3d'
import { prepareMap3d, type FetchBytes } from '../../src/engine/motion/map3d-data'
import { decodePng, encodePngRgb, lightenDem, terrarium } from '../../src/engine/motion/map3d-dem'
import { EASES, alongLine, cameraAt, cameraFrames, greatCircle, groundAt, latOf, lineKm, lonOf, mercX, mercY, tilesFor, timesOf, type Cam } from '../../src/engine/motion/map3d-plan'
import { RESOURCES, tempDir } from './engine-node-helpers'

const BERLIN = { lon: 13.405, lat: 52.52 }
const BERN = { lon: 7.447, lat: 46.948 }
const SAMPLE: Map3dPropsInput = {
  kicker: '1933–1940',
  title: 'Complaints to Bern',
  camera: {
    keys: [
      { atS: 0, center: { lon: 10, lat: 49 }, zoom: 5, pitch: 50, bearing: 0 },
      { atS: 4, center: { lon: 8, lat: 47 }, zoom: 6, pitch: 55, bearing: -10 }
    ]
  },
  regions: [{ countries: ['CHE'], tone: 'gold', label: 'Switzerland', raise: 5, atS: 2 }],
  pins: [
    { ...BERLIN, label: 'Berlin', atS: 0.5 },
    { ...BERN, label: 'Bern', note: 'The Federal Palace', atS: 3 }
  ],
  routes: [{ from: BERLIN, to: BERN, atS: 1 }],
  names: [{ lon: 10.4, lat: 51, text: 'Germany' }],
  facts: [{ text: '26 cantons', atS: 4 }]
}

/** A Terrarium tile: a smooth hill (or a sea floor at −200 m) so terrain code has something real to read. */
function demTile(z: number, x: number, y: number): Buffer {
  const n = 64
  const rgb = new Uint8Array(n * n * 3)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const e = (x + y + z) % 3 === 0 ? -200 : Math.round(1500 * Math.exp(-((i - 32) ** 2 + (j - 32) ** 2) / 300))
      const v = e + 32768
      rgb.set([Math.floor(v / 256), v % 256, 0], (j * n + i) * 3)
    }
  }
  return encodePngRgb(n, n, rgb)
}
const fakeNet = (): { fetch: FetchBytes; urls: string[] } => {
  const urls: string[] = []
  return {
    urls,
    fetch: async (url) => {
      urls.push(url)
      const m = /\/(\d+)\/(\d+)\/(\d+)\.(png|jpeg)$/.exec(url)
      if (!m) throw new Error(`unexpected ${url}`)
      const [, a, b, c, ext] = m
      // the imagery is z/y/x (GIBS), the terrain z/x/y
      return ext === 'png' ? demTile(+a!, +b!, +c!) : new Uint8Array(1200).fill(+a! + 1)
    }
  }
}

describe('map3d props', () => {
  it('fills the defaults (satellite look, push ease, a slow drift, a raised relief) and keeps every part', () => {
    const p = Map3dProps.parse(SAMPLE)
    expect(p.look).toBe('satellite')
    expect(p.camera.ease).toBe('push')
    expect(p.camera.drift).toBeCloseTo(0.007)
    expect(p.exaggeration).toBeGreaterThan(1)
    expect(p.regions[0]?.raise).toBe(5)
    expect(p.routes[0]?.via).toEqual([])
  })
  it('refuses a camera without keys or follow, keys out of time order, an over-tilted camera and too many pins', () => {
    expect(Map3dProps.safeParse({ ...SAMPLE, camera: {} }).success).toBe(false)
    expect(Map3dProps.safeParse({ ...SAMPLE, camera: { keys: [{ atS: 2, center: BERN, zoom: 5 }, { atS: 1, center: BERN, zoom: 6 }] } }).success).toBe(false)
    expect(Map3dProps.safeParse({ ...SAMPLE, camera: { keys: [{ atS: 0, center: BERN, zoom: 5, pitch: 80 }] } }).success).toBe(false)
    expect(Map3dProps.safeParse({ ...SAMPLE, pins: Array.from({ length: 9 }, () => ({ ...BERN, label: 'x' })) }).success).toBe(false)
    expect(Map3dProps.safeParse({ ...SAMPLE, camera: { follow: { route: 0, zoom: 6 } } }).success).toBe(true)
  })
})

describe('map3d camera and geometry', () => {
  const p = Map3dProps.parse(SAMPLE)
  it('Web-Mercator goes there and back', () => {
    for (const [lon, lat] of [[0, 0], [13.4, 52.5], [-120, -33]] as const) {
      expect(lonOf(mercX(lon))).toBeCloseTo(lon, 9)
      expect(latOf(mercY(lat))).toBeCloseTo(lat, 9)
    }
  })
  it('the push ease is the measured one: monotonic, a third of the way at about 0.27, past 90 % at 0.7', () => {
    let last = 0
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const v = EASES.push(x)
      expect(v).toBeGreaterThanOrEqual(last - 1e-9)
      last = v
    }
    expect(EASES.push(0)).toBe(0)
    expect(EASES.push(1)).toBe(1)
    expect(EASES.push(0.27)).toBeGreaterThan(0.2)
    expect(EASES.push(0.27)).toBeLessThan(0.45)
    expect(EASES.push(0.7)).toBeGreaterThan(0.9)
  })
  it('the camera sits on its keys at their times, between them on the way, and drifts in after the last', () => {
    const at0 = cameraAt(p, 0, 8)
    const at4 = cameraAt(p, 4, 8)
    expect(at0).toEqual([10, 49, 5, 50, 0])
    expect(at4[0]).toBeCloseTo(8, 6)
    expect(at4[2]).toBeCloseTo(6, 6)
    const mid = cameraAt(p, 2, 8)
    expect(mid[2]).toBeGreaterThan(5)
    expect(mid[2]).toBeLessThan(6)
    expect(cameraAt(p, 8, 8)[2]).toBeCloseTo(6 + 4 * 0.007, 6)
    const frames = cameraFrames(p, 8)
    expect(frames).toHaveLength(8 * FPS + 1)
    expect(frames[4 * FPS]?.[2]).toBeCloseTo(6, 4)
  })
  it('a followed route keeps its head in the middle of the frame while it draws', () => {
    const f = Map3dProps.parse({ ...SAMPLE, camera: { follow: { route: 0, zoom: 6.5, pitch: 50, bearing: 200 } } })
    const start = timesOf(f, 8).routes[0]! + 0.4
    expect(cameraAt(f, 0, 8).slice(0, 2).map((v) => +v.toFixed(3))).toEqual([BERLIN.lon, BERLIN.lat])
    const end = cameraAt(f, start + 5, 8)
    expect(end[0]).toBeCloseTo(BERN.lon, 3)
    expect(end[1]).toBeCloseTo(BERN.lat, 3)
    expect(end.slice(2)).toEqual([6.5, 50, 200])
  })
  it('a route is a great circle from its start to its end (about 750 km from Berlin to Bern)', () => {
    const line = greatCircle(BERLIN, BERN)
    expect(line[0]![0]).toBeCloseTo(BERLIN.lon, 9)
    expect(line[0]![1]).toBeCloseTo(BERLIN.lat, 9)
    expect(line.at(-1)![0]).toBeCloseTo(BERN.lon, 6)
    expect(lineKm(line)).toBeGreaterThan(700)
    expect(lineKm(line)).toBeLessThan(800)
    expect(alongLine(line, 0.5).at[1]).toBeGreaterThan(BERN.lat)
  })
  it('the centre of the frame meets the ground at the camera centre; the top of a tilted frame is farther than the bottom', () => {
    const cam: Cam = [8, 47, 6, 55, 30]
    const c = groundAt(cam, 1920, 1080, 960, 540)
    expect(lonOf(c.x)).toBeCloseTo(8, 6)
    expect(latOf(c.y)).toBeCloseTo(47, 6)
    expect(c.rel).toBeCloseTo(1, 6)
    expect(groundAt(cam, 1920, 1080, 960, 0).rel).toBeGreaterThan(groundAt(cam, 1920, 1080, 960, 1080).rel)
  })
  it('plans the tiles of the whole path: the centre tile at the deepest zoom, every ancestor, nothing deeper than asked', () => {
    const set = tilesFor(cameraFrames(p, 6), 1920, 1080, 7)
    const z7 = 2 ** 7
    expect(set.keys.has(`7/${Math.floor(mercX(8) * z7)}/${Math.floor(mercY(47) * z7)}`)).toBe(true)
    expect(set.keys.has('0/0/0')).toBe(true)
    for (const k of set.keys) {
      const [z, x, y] = k.split('/').map(Number) as [number, number, number]
      expect(z).toBeLessThanOrEqual(7)
      if (z > 0) expect(set.keys.has(`${z - 1}/${x >> 1}/${y >> 1}`)).toBe(true)
    }
    expect(set.box.west).toBeLessThan(8)
    expect(set.box.north).toBeGreaterThan(49)
  })
})

describe('map3d terrain tiles', () => {
  it('reads back what it writes, and lightens a Terrarium tile: sea floor to 0 m, heights rounded, smaller', () => {
    const tile = demTile(5, 1, 1)
    const px = decodePng(tile)
    expect(px.width).toBe(64)
    expect(terrarium(px.data[(32 * 64 + 32) * 3]!, px.data[(32 * 64 + 32) * 3 + 1]!, px.data[(32 * 64 + 32) * 3 + 2]!)).toBe(1500)
    const sea = decodePng(lightenDem(demTile(3, 0, 0)))
    expect(terrarium(sea.data[0]!, sea.data[1]!, sea.data[2]!)).toBe(0)
    const light = lightenDem(tile, 50)
    const back = decodePng(light)
    const e = terrarium(back.data[(32 * 64 + 32) * 3]!, back.data[(32 * 64 + 32) * 3 + 1]!, back.data[(32 * 64 + 32) * 3 + 2]!)
    expect(e % 50).toBe(0)
    expect(Math.abs(e - 1500)).toBeLessThanOrEqual(25)
  })
})

describe('map3d preparation (fake network)', () => {
  it('gathers the tiles once into the cache, the shapes, routes, camera frames, the library and the type', { timeout: 60_000 }, async () => {
    const dir = tempDir('map3d-prep').dir
    const net = fakeNet()
    const p = Map3dProps.parse(SAMPLE)
    const o = { width: 1920, height: 1080, durationS: 6, libraryRoot: RESOURCES, cacheDir: path.join(dir, 'cache'), fetch: net.fetch, maxSatZoom: 6, maxDemZoom: 5 }
    const a = await prepareMap3d(p, o)
    expect(a.maxzoom).toEqual({ sat: 6, dem: 5 })
    const keys = Object.keys(a.tiles)
    expect(keys.some((k) => k.startsWith('sat/6/'))).toBe(true)
    expect(keys.some((k) => k.startsWith('dem/5/'))).toBe(true)
    expect(net.urls.some((u) => u.includes('gibs.earthdata.nasa.gov') && u.includes('BlueMarble_ShadedRelief_Bathymetry'))).toBe(true)
    expect(net.urls.some((u) => u.includes('elevation-tiles-prod/terrarium'))).toBe(true)
    // the terrain tiles were made light before they were kept: a tile of the sea is all at 0 m
    const sea = Object.entries(a.tiles).find(([k]) => k.startsWith('dem/') && (k.split('/').slice(1).map(Number).reduce((s, v) => s + v, 0) % 3 === 0))
    const px = decodePng(Buffer.from(sea![1], 'base64'))
    expect(terrarium(px.data[0]!, px.data[1]!, px.data[2]!)).toBe(0)
    expect(a.regions[0]!.length).toBeGreaterThan(0)
    expect(a.labels[0]![0]).toBeGreaterThan(6)
    expect(a.routes[0]![0]).toEqual([BERLIN.lon, BERLIN.lat])
    expect(a.frames).toHaveLength(6 * FPS + 1)
    expect(a.borders.length).toBeGreaterThan(20)
    expect(a.land).toBeUndefined()
    expect(a.lib.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(a.lib.worker.slice(-300)).not.toMatch(/export\s*\{/)
    expect(a.lib.main).toContain('addProtocol')
    expect(a.fontCss).toContain("font-family:'Barlow'")
    expect(a.credits.join(' ')).toMatch(/NASA.*Natural Earth.*MapLibre/s)
    // the second time everything comes from the cache
    const fetched = net.urls.length
    await prepareMap3d(p, o)
    expect(net.urls.length).toBe(fetched)
    expect(readdirSync(path.join(dir, 'cache')).sort()).toEqual(['dem-l5', 'sat'])
  })
  it('keeps the page under its weight by lowering the deepest zoom, says when tiles could not be had, and draws land for the parchment', { timeout: 60_000 }, async () => {
    const dir = tempDir('map3d-budget').dir
    const net = fakeNet()
    const p = Map3dProps.parse({ ...SAMPLE, look: 'parchment' })
    const a = await prepareMap3d(p, { width: 1920, height: 1080, durationS: 6, libraryRoot: RESOURCES, cacheDir: path.join(dir, 'c'), fetch: net.fetch, maxDemZoom: 7, maxTileBytes: 60_000 })
    expect(a.maxzoom.sat).toBe(-1)
    expect(a.maxzoom.dem).toBeLessThan(7)
    expect(a.land?.length).toBeGreaterThan(0)
    const off = await prepareMap3d(Map3dProps.parse(SAMPLE), { width: 1920, height: 1080, durationS: 6, libraryRoot: RESOURCES, cacheDir: path.join(dir, 'off'), fetch: () => Promise.reject(new Error('offline')), maxSatZoom: 4, maxDemZoom: 4 })
    expect(Object.keys(off.tiles)).toHaveLength(0)
    expect(off.warnings?.[0]).toMatch(/could not be had/)
    expect(existsSync(path.join(dir, 'off'))).toBe(false)
  })
  it('names an unknown country', async () => {
    const p = Map3dProps.parse({ ...SAMPLE, regions: [{ countries: ['Atlantis'] }] })
    await expect(prepareMap3d(p, { width: 640, height: 360, durationS: 4, libraryRoot: RESOURCES, cacheDir: tempDir('map3d-x').dir, fetch: fakeNet().fetch })).rejects.toThrow(/Atlantis/)
  })
})

describe('map3d page', () => {
  it('carries everything inline: the library, the tiles, the labels that ride the map, the title, the facts; no request leaves the page', { timeout: 60_000 }, async () => {
    const p = Map3dProps.parse(SAMPLE)
    const a = await prepareMap3d(p, { width: 1920, height: 1080, durationS: 6, libraryRoot: RESOURCES, cacheDir: tempDir('map3d-page').dir, fetch: fakeNet().fetch, maxSatZoom: 4, maxDemZoom: 4 })
    const c = { width: 1920, height: 1080, durationS: 6, fontCss: '' }
    const part = map3dCard(p, c, a)
    const html = pageHtml(c, themeOf('#d5412f', 'dark'), '#d5412f', part.css, part.body)
    expect(html).toContain('<div id="map"></div>')
    expect(html).toContain('window.atelierFrameReady')
    expect(html.match(/data-kind="pin"/g)).toHaveLength(2)
    expect(html).toContain('data-kind="label"')
    expect(html).toContain('data-bb="5.9')
    expect(html).toContain('>26 cantons<')
    expect(html).toContain('Complaints to Bern')
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|@import/)
    // the page's data is valid JSON once read back, even with a « </script> » in it
    expect(scriptJson({ s: '</script><!--' })).not.toContain('</')
    expect(JSON.parse(scriptJson({ s: '</script> ' }))).toEqual({ s: '</script> ' })
    const data = /<script type="application\/json" id="m3d">([^<]*)<\/script>/.exec(html)
    const d = JSON.parse(data![1]!) as { frames: number[][]; tiles: Record<string, string>; times: { routes: number[] } }
    expect(d.frames).toHaveLength(6 * FPS + 1)
    expect(Object.keys(d.tiles).length).toBe(Object.keys(a.tiles).length)
    expect(d.times.routes).toEqual([1])
    // without its assets the card still draws its title on its background
    expect(map3dCard(p, c, undefined).body).toContain('Complaints to Bern')
  })
})
