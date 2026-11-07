// The 3D map card drawn for real by MapLibre GL JS in headless Chromium (software WebGL, the path a CPU-only server has), from tiles made up
// here (no network): the frames change along the camera path and the same moment gives the same picture; the relief is really raised and
// lit (a mountain against a flat world); the labels ride the map inside the frame and never overlap, even two pins a few km apart; the
// tiles the map asks for are the ones the preparation planned. Skipped, with the reason, where there is no Chromium / Chrome / Edge.
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Map3dProps, type Map3dPropsInput } from '../../src/engine/formats/map3d'
import { chromiumService, findBrowser, launchArgs } from '../../src/engine/media/browser'
import { pageHtml, themeOf } from '../../src/engine/motion/base'
import { map3dCard } from '../../src/engine/motion/map3d'
import { hasMapLibrary, prepareMap3d, type FetchBytes } from '../../src/engine/motion/map3d-data'
import { decodePng, encodePngRgb } from '../../src/engine/motion/map3d-dem'
import { RESOURCES, ROOT, tempDir } from './engine-node-helpers'

const exe = findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })
const skip = !exe ? 'no Chromium, Chrome or Edge found (set ATELIER_CHROMIUM)' : !hasMapLibrary() ? 'maplibre-gl is not installed' : ''
const W = 640
const H = 360
const signal = new AbortController().signal

/** A made-up world: imagery in tile-coloured squares with a gradient, and a 3 km mountain at 8°E 46.5°N (or flat). */
const RAD = Math.PI / 180
const tileLonLat = (z: number, x: number, y: number, i: number, j: number, n: number): [number, number] => {
  const fx = (x + i / n) / 2 ** z
  const fy = (y + j / n) / 2 ** z
  return [fx * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * fy))) / RAD]
}
function fakeNet(flat: boolean): FetchBytes {
  return async (url) => {
    const m = /\/(\d+)\/(\d+)\/(\d+)\.(png|jpeg)$/.exec(url)
    if (!m) throw new Error(url)
    const n = m[4] === 'png' ? 256 : 64
    const rgb = new Uint8Array(n * n * 3)
    if (m[4] === 'png') {
      const [z, x, y] = [+m[1]!, +m[2]!, +m[3]!]
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const [lon, lat] = tileLonLat(z, x, y, i, j, n)
          const e = flat ? 0 : Math.round(3000 * Math.exp(-((lon - 8) ** 2 + (lat - 46.5) ** 2) / 0.3))
          const v = e + 32768
          rgb.set([Math.floor(v / 256), v % 256, 0], (j * n + i) * 3)
        }
      }
    } else {
      const [z, y, x] = [+m[1]!, +m[2]!, +m[3]!]
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) rgb.set([60 + ((x * 37) % 120), 80 + ((y * 53) % 100) + (j >> 1), 40 + z * 10 + (i >> 1)], (j * n + i) * 3)
    }
    return encodePngRgb(n, n, rgb)
  }
}

const SPEC: Map3dPropsInput = {
  title: 'A test of the 3D map',
  kicker: '1940',
  exaggeration: 2,
  camera: {
    keys: [
      { atS: 0, center: { lon: 10.5, lat: 49.5 }, zoom: 5, pitch: 45, bearing: 0 },
      { atS: 3, center: { lon: 8, lat: 46.8 }, zoom: 6.2, pitch: 60, bearing: 20 }
    ]
  },
  regions: [{ countries: ['CHE'], tone: 'gold', label: 'Switzerland', raise: 4, atS: 0.5 }],
  pins: [
    { lon: 13.405, lat: 52.52, label: 'Berlin', atS: 0.2 },
    { lon: 13.06, lat: 52.4, label: 'Potsdam', atS: 0.2 },
    { lon: 7.447, lat: 46.948, label: 'Bern', atS: 0.4 }
  ],
  routes: [{ from: { lon: 13.405, lat: 52.52 }, to: { lon: 7.447, lat: 46.948 }, atS: 0.3, drawS: 1.5 }],
  names: [
    { lon: 10.4, lat: 51, text: 'Germany' },
    { lon: 10.6, lat: 50.9, text: 'Thuringia' },
    { lon: 9.5, lat: 46.2, text: 'Alps' }
  ],
  facts: [{ text: '26 cantons', atS: 1 }]
}

async function pageOf(flat: boolean, over: Partial<Map3dPropsInput> = {}): Promise<string> {
  const p = Map3dProps.parse({ ...SPEC, ...over })
  const a = await prepareMap3d(p, { width: W, height: H, durationS: 4, libraryRoot: RESOURCES, cacheDir: tempDir(`map3d-b-${flat ? 'flat' : 'hill'}`).dir, fetch: fakeNet(flat), maxSatZoom: 7, maxDemZoom: 6 })
  // the tests raise the relief in software too (a CPU-only host draws it flat by default: too slow there)
  const c = { width: W, height: H, durationS: 4, fontCss: '' }
  const part = map3dCard(p, c, { ...a, terrainOnSoftware: true })
  return pageHtml(c, themeOf('#d5412f', 'dark'), '#d5412f', part.css, part.body)
}

/** Mean absolute difference of two PNG frames (0..255). */
function diff(a: Uint8Array, b: Uint8Array): number {
  const x = decodePng(a)
  const y = decodePng(b)
  let s = 0
  let n = 0
  for (let i = 0; i < x.data.length; i += x.channels) {
    for (let k = 0; k < 3; k++) s += Math.abs((x.data[i + k] as number) - (y.data[i + k] as number))
    n += 3
  }
  return s / n
}

interface PwPage {
  setContent(html: string, o: { waitUntil: 'load' }): Promise<void>
  evaluate<T>(expr: string): Promise<T>
  screenshot(o: { type: 'png' }): Promise<Uint8Array>
}
interface PwBrowser {
  newPage(o: { viewport: { width: number; height: number } }): Promise<PwPage>
  close(): Promise<void>
}

describe.skipIf(skip !== '')(`map3d in a real browser (${skip || 'Chromium, software WebGL'})`, () => {
  let browser: PwBrowser
  let hill: string
  beforeAll(async () => {
    const pw = createRequire(path.join(ROOT, 'noop.js'))('playwright-core') as { chromium: { launch(o: object): Promise<PwBrowser> } }
    browser = await pw.chromium.launch({ executablePath: exe as string, headless: true, args: launchArgs(process.platform, false) })
    hill = await pageOf(false)
  }, 120_000)
  afterAll(() => browser?.close(), 60_000)

  const seek = (page: PwPage, t: number): Promise<unknown> => page.evaluate(`(window.atelierRenderAt(${t}), window.atelierFrameReady())`)

  it('changes along the camera path, keeps every label inside the frame and apart, and asks only for planned tiles', { timeout: 240_000 }, async () => {
    const page = await browser.newPage({ viewport: { width: W, height: H } })
    await page.setContent(hill, { waitUntil: 'load' })
    const shots: Uint8Array[] = []
    for (const t of [0.7, 1.5, 2.5, 3.9]) {
      await seek(page, t)
      shots.push(await page.screenshot({ type: 'png' }))
      const boxes = await page.evaluate<{ x: number; y: number; w: number; h: number; text: string }[]>(`[...document.querySelectorAll('.ll')].filter((el) => parseFloat(el.style.opacity || '0') > 0.01).map((el) => {
        const box = el.querySelector('.tg') || el.querySelector('.nm');
        if (el.querySelector('.tg') && box.style.visibility === 'hidden') return null;
        const r = box.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height, text: box.textContent };
      }).filter(Boolean)`)
      expect(boxes.length, `labels shown at ${t} s`).toBeGreaterThan(0)
      for (const b of boxes) {
        expect(b.x, `${b.text} at ${t} s`).toBeGreaterThanOrEqual(0)
        expect(b.y, `${b.text} at ${t} s`).toBeGreaterThanOrEqual(0)
        expect(b.x + b.w, `${b.text} at ${t} s`).toBeLessThanOrEqual(W)
        expect(b.y + b.h, `${b.text} at ${t} s`).toBeLessThanOrEqual(H)
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!
          const b = boxes[j]!
          const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
          expect(overlap, `${a.text} / ${b.text} at ${t} s`).toBe(false)
        }
      }
    }
    for (let i = 1; i < shots.length; i++) expect(diff(shots[i - 1]!, shots[i]!), `frame ${i}`).toBeGreaterThan(2)
    expect(await page.evaluate('window.atelierMapInfo()')).toEqual({ software: true, terrain: true })
    const asked = await page.evaluate<Record<string, number>>('window.atelierMapAsked()')
    const keys = Object.keys(asked)
    expect(keys.length).toBeGreaterThan(10)
    // a tile the plan did not hold is drawn from its parent: allowed, but rare
    expect(keys.filter((k) => !asked[k]).length / keys.length).toBeLessThan(0.05)
  })

  it('raises and lights the relief: a mountain is not a flat world', { timeout: 240_000 }, async () => {
    // no raised country over the mountain here: the relief alone
    const bare = { regions: [], routes: [], exaggeration: 3 }
    const flat = await pageOf(true, bare)
    const a = await browser.newPage({ viewport: { width: W, height: H } })
    const b = await browser.newPage({ viewport: { width: W, height: H } })
    await a.setContent(await pageOf(false, bare), { waitUntil: 'load' })
    await b.setContent(flat, { waitUntil: 'load' })
    await seek(a, 3.9)
    await seek(b, 3.9)
    const sa = await a.screenshot({ type: 'png' })
    const sb = await b.screenshot({ type: 'png' })
    if (process.env.MAP3D_DUMP) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(path.join(process.env.MAP3D_DUMP, 'hill.png'), sa)
      writeFileSync(path.join(process.env.MAP3D_DUMP, 'flat.png'), sb)
    }
    expect(diff(sa, sb)).toBeGreaterThan(3)
  })

  it('draws through the engine’s browser service, waiting for the map, and the same moment gives the same picture', { timeout: 240_000 }, async () => {
    const service = chromiumService({ executablePath: exe as string })
    try {
      const page = await service.open({ html: hill, width: W, height: H, signal })
      const first = await page.frame(2)
      await page.frame(0.5)
      const again = await page.frame(2)
      expect(diff(first, again)).toBeLessThan(0.5)
      const cap = await page.capture?.(2.5, { format: 'jpeg' })
      expect(cap?.image?.length).toBeGreaterThan(1000)
      await page.close()
    } finally {
      await service.close?.()
    }
  })
})
