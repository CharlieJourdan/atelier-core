// The second look of the documentary cards, « parchemin » (spec `theme: 'light'`, motion/doc-parchment.ts, map-parchment.ts): without a browser,
// the pages differ from the dark ones (paper, serif, no Oswald) and the dark pages are byte for byte what they were before the second look
// existed; in a real Chromium (skipped, with the reason, where there is none) one frame of every template in the light theme is opaque, its
// texts fit and stay inside the frame, and the frames are saved to os.tmpdir()/atelier-screens/style-markets/parchment-*.
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CardAssets, MapCardProps } from '../../src/engine/formats/cards'
import { MapCardProps as MapCardSchema } from '../../src/engine/formats/cards'
import { checkMotion, type MotionSpecInput } from '../../src/engine/formats/motion'
import { chromiumService, findBrowser } from '../../src/engine/media/browser'
import { motionHtml } from '../../src/engine/motion'
import { DARK_STYLE, PARCH, docStyleOf } from '../../src/engine/motion/doc-parchment'
import { docFontCssOf } from '../../src/engine/motion/fonts'
import { loadCountries, mapGeometry, prepareMapAssets } from '../../src/engine/motion/geo'
import { MEDIA, RESOURCES } from './engine-node-helpers'

const W = 1920
const H = 1080
const PW = 1080
const PH = 1920

const MAP: MapCardProps = MapCardSchema.parse({
  kicker: 'June 1940',
  title: 'Complaints to Bern',
  view: { west: -12, south: 36, east: 34, north: 62 },
  zoomTo: { west: 3, south: 44, east: 15, north: 55 },
  regions: [
    { countries: ['Switzerland'], tone: 'gold', label: 'Switzerland', atS: 1.2 },
    { countries: ['DEU'], tone: 'red', atS: 0.9 },
    { countries: ['Italy'], tone: 'pale' }
  ],
  pins: [
    { lat: 52.52, lon: 13.4, label: 'Berlin', note: 'The complaints leave by courier.', atS: 2.4 },
    { lat: 46.95, lon: 7.45, label: 'Bern', atS: 3.2 }
  ],
  routes: [{ from: { lat: 52.52, lon: 13.4 }, to: { lat: 46.95, lon: 7.45 }, label: 'Diplomatic note', atS: 2.6 }],
  names: [
    { lat: 47.6, lon: 1.5, text: 'France' },
    { lat: 56.5, lon: 3, text: 'North Sea' }
  ]
})
const archive = (props: Record<string, unknown>): MotionSpecInput => ({ template: 'archive', props } as MotionSpecInput)
const SPECS: Record<string, MotionSpecInput> = {
  bars: { template: 'bars', props: { kicker: 'Black Monday', title: 'Market value lost', source: 'Script figures', rows: [{ label: 'U.S. loss', value: 500, display: '$500B' }, { label: 'Global loss', value: 1700, display: '$1.7T', accent: true }, { label: 'Shares', value: 604 }] } },
  timeline: { template: 'timeline', props: { kicker: 'Silver', title: 'How the empire paid', events: ['A', 'B', 'C', 'D', 'E'].map((l, i) => ({ when: `${1550 + i * 37}`, label: `Event ${l}`, accent: i === 3 })) } } as MotionSpecInput,
  full: archive({ frame: 'full', label: 'Mexico City', sub: 'c. 1695', lines: ['Own taxes.'], punch: 'Belonged to Madrid' }),
  board: archive({ frame: 'board', label: 'Silver bar, 1622', sub: 'Atocha' }),
  paper: archive({ frame: 'paper', label: 'The Daily Ledger', excerpt: 'Stocks plunge 508 points, a drop.', mark: 'plunge 508 points', source: 'Ledger' }),
  tv: archive({ frame: 'tv', label: 'Trading floor' })
}
const light = (s: MotionSpecInput): MotionSpecInput => ({ ...s, theme: 'light' }) as MotionSpecInput
const page = (s: MotionSpecInput, w = W, h = H, assets: CardAssets = {}): string => motionHtml(s, { width: w, height: h, durationS: 8, fontCss: '' }, assets)

/** sha256 (first 16 hex) of the dark pages as they were before the parchment look existed: the dark cards must not move. */
// motion-montage: the runtime every page carries grew (new presets, counters frozen per frame); the markup is unchanged (checked
// against the previous runtime swapped back in): the hashes below are those of the pages with the new runtime.
// Map routes along the way: the runtime's data-cpath rides a polyline (every page carries it; the twelve non-map pages were checked
// equal to their previous hashes with the previous runtime swapped back in); the map's route is a curve drawn with a head (map, and the
// map's CSS without assets: .tip → .rh)
// director-motion: the runtime gained the print's soft settle, the board's reflow and the film inside a print (every page carries it); all
// fourteen pages were checked equal to the hashes before with the previous runtime swapped back in
const DARK_HASHES: Record<string, string> = {
  bars: '2fe680349c9aead5',
  'bars-p': '8d1e4415146fdd55',
  timeline: '9c390bba07942876',
  'timeline-p': '2573f48cf19c3ebf',
  full: '1aad51ebeb919dd8',
  'full-p': '1c28ed215abecec6',
  board: '3fcd552eafd9f7a6',
  'board-p': 'd200a20b88f99e34',
  paper: '59845a5cceee6d9c',
  'paper-p': '2b2f69935431547f',
  tv: 'b82295a6a94936e2',
  'tv-p': 'c586fb1f8042ea82',
  map: 'cce585cc8bf44b62',
  mapNoAssets: '17deaf9001d0b3cf'
}
const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

describe('the parchment look: the pages', () => {
  let mapAssets: CardAssets
  beforeAll(async () => {
    const geo = mapGeometry(MAP, { width: W, height: H, countries: await loadCountries(RESOURCES) })
    const { startView: _a, endView: _b, kx: _c, ky: _d, ...a } = geo
    mapAssets = { map: { ...a, image: 'data:image/jpeg;base64,AAAA', imageBox: geo.imageBox } }
  })
  const mapSpec: MotionSpecInput = { template: 'map', props: MAP }

  it('the dark pages are exactly what they were (the default theme, and an explicit dark one)', () => {
    for (const [k, s] of Object.entries(SPECS)) {
      expect(hash(page(s)), k).toBe(DARK_HASHES[k])
      expect(hash(page({ ...s, theme: 'dark' } as MotionSpecInput)), k).toBe(DARK_HASHES[k])
      expect(hash(page(s, PW, PH)), `${k}-p`).toBe(DARK_HASHES[`${k}-p`])
    }
    expect(hash(page(mapSpec, W, H, mapAssets))).toBe(DARK_HASHES.map)
    expect(hash(page(mapSpec))).toBe(DARK_HASHES.mapNoAssets)
  })

  it('the light theme draws the parchment: paper, ink, serif titles, no Oswald, no dark slate', () => {
    for (const [k, s] of Object.entries(SPECS)) {
      if (k === 'tv') continue // the old television stays as it is
      const l = page(light(s))
      expect(l, k).not.toBe(page(s))
      expect(l, k).not.toContain('Oswald')
      expect(l, k).toContain("'Source Serif 4'")
      // the full frame is the picture itself: its paper is the caption's and the lines' cream
      expect(l, k).toContain(k === 'full' ? PARCH.tag : PARCH.paper)
      if (k !== 'full') expect(l, k).toContain(PARCH.ink)
      expect(l, k).not.toContain('#14110f') // the dark card's background
    }
    const m = page(light(mapSpec), W, H, mapAssets)
    expect(m).not.toContain('Oswald')
    expect(m).toContain(PARCH.paper)
    expect(m).toContain('sepia(')
    expect(m).toContain('mix-blend-mode:multiply')
    expect(m).toContain('mask="url(#rm0)"') // the route is a dashed ink line, drawn on through a mask
    expect(m.match(/class="reg"/g)).toHaveLength(3) // an ink outline per region
    expect(m).toContain('class="pr1"') // the atlas plate's double rule
    expect(m).toContain('Complaints to Bern')
    expect(page(light(mapSpec))).not.toContain('Oswald') // and without assets
  })

  it('the light cards keep the times and the layout of the dark ones (only the look changes)', () => {
    const times = (html: string): string[] => [...html.matchAll(/data-at="([\d.]+)"/g)].map((x) => x[1] as string).filter((t) => t !== '0.05') // 0.05: the dark grid's fade
    for (const k of ['bars', 'board', 'paper']) {
      const d = new Set(times(page(SPECS[k] as MotionSpecInput)))
      const l = new Set(times(page(light(SPECS[k] as MotionSpecInput))))
      for (const t of d) expect(l.has(t), `${k} ${t}`).toBe(true)
    }
    const dm = new Set(times(page(mapSpec, W, H, mapAssets)))
    const lm = new Set(times(page(light(mapSpec), W, H, mapAssets)))
    for (const t of dm) expect(lm.has(t), `map ${t}`).toBe(true)
  })

  it('the paper frame loses its graph grid, the bars are hatched, the timeline has diamonds, the board has a lighter shadow', () => {
    const paper = page(light(SPECS.paper as MotionSpecInput))
    expect(paper).not.toContain('class="pgrid"')
    expect(paper).not.toContain('filter id="warp"')
    expect(page(SPECS.paper as MotionSpecInput)).toContain('class="pgrid"')
    expect(page(light(SPECS.bars as MotionSpecInput))).toContain('repeating-linear-gradient(135deg')
    expect(page(light(SPECS.timeline as MotionSpecInput))).toContain('clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)')
    expect(page(light(SPECS.board as MotionSpecInput))).toContain('rgba(72,46,16')
    expect(page(light(SPECS.board as MotionSpecInput))).not.toContain('rgba(0,0,0,.55)')
  })

  it('picks the accent: the red-brown unless the spec chose its own (not the schema default blue, not the dark red)', () => {
    expect(docStyleOf('dark', '#112233')).toBe(DARK_STYLE)
    expect(docStyleOf('light', '#3B82F6').accent).toBe(PARCH.brown)
    expect(docStyleOf('light', '#D5412F').accent).toBe(PARCH.brown)
    const own = docStyleOf('light', '#2E6B4F').accent
    expect(own).not.toBe(PARCH.brown)
    expect(page({ ...(SPECS.bars as object), theme: 'light', accent: '#2E6B4F' } as MotionSpecInput)).toContain(own)
    expect(page(light(SPECS.bars as MotionSpecInput))).toContain(PARCH.brown)
  })

  it('light specs are valid plans like the dark ones', () => {
    for (const s of Object.values(SPECS)) expect(checkMotion(light(s), 8)).toEqual([])
  })
})

// ---- in a real browser ---------------------------------------------------------------------------------------------------------------------

const exe = findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })
const skip = !exe ? 'no Chromium, Chrome or Edge found (set ATELIER_CHROMIUM)' : !MEDIA ? 'no ffmpeg' : ''
const signal = new AbortController().signal
const service = chromiumService(exe ? { executablePath: exe } : {})
afterAll(() => service.close?.(), 60_000)
const SCREENS = path.join(os.tmpdir(), 'atelier-screens', 'style-markets')

type Pw = { chromium: { launch(o: { executablePath: string }): Promise<PwBrowser> } }
interface PwBrowser {
  newPage(o: unknown): Promise<PwPage>
  close(): Promise<void>
}
interface PwPage {
  setContent(html: string): Promise<void>
  evaluate<T, A>(fn: (a: A) => T, a: A): Promise<T>
  evaluate<T>(fn: () => T): Promise<T>
  screenshot(o: { type: 'jpeg'; quality: number }): Promise<Buffer>
  close(): Promise<void>
}

describe.skipIf(skip !== '')(`the parchment cards in a real browser (${skip || 'Chromium'})`, () => {
  const pw = createRequire(path.join(__dirname, '..', '..', 'package.json'))('playwright-core') as Pw
  let browser: PwBrowser | null = null
  const launch = async (): Promise<PwBrowser> => (browser ??= await pw.chromium.launch({ executablePath: exe as string }))
  afterAll(() => browser?.close(), 60_000)

  const draw = async (w: number, h: number, body: string): Promise<string> => {
    const p = await (await launch()).newPage({ viewport: { width: w, height: h } })
    try {
      await p.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;position:relative;font-family:Georgia,serif">${body}</body></html>`)
      return `data:image/jpeg;base64,${(await p.screenshot({ type: 'jpeg', quality: 82 })).toString('base64')}`
    } finally {
      await p.close()
    }
  }
  const pictures = { photo: '', document: '' }
  let fontCss = ''
  beforeAll(async () => {
    fontCss = await docFontCssOf(RESOURCES)
    pictures.photo = await draw(1600, 1000, `<div style="position:absolute;inset:0;background:linear-gradient(#d8c3a0 0%,#b99468 38%,#6c4f3a 60%,#2e211a 100%)"></div>
<div style="position:absolute;left:1100px;top:130px;width:150px;height:150px;border-radius:50%;background:#f1e2c0;box-shadow:0 0 90px 40px rgba(255,235,190,.5)"></div>
<div style="position:absolute;left:-100px;top:520px;width:1000px;height:600px;border-radius:50%;background:#4a3425"></div>
<div style="position:absolute;left:600px;top:560px;width:1300px;height:700px;border-radius:50%;background:#33231a"></div>
<div style="position:absolute;left:330px;top:280px;width:60px;height:300px;background:#2a1d15"></div>
<div style="position:absolute;left:760px;top:430px;width:380px;height:160px;background:#241912"></div><div style="position:absolute;left:740px;top:395px;width:420px;height:50px;background:#2c1f17;clip-path:polygon(8% 100%,50% 0,92% 100%)"></div>`)
    const lines = Array.from({ length: 30 }, (_, i) => `<div style="height:7px;margin:9px 0;background:#3a3a3a;opacity:${0.55 + (i % 4) * 0.1};width:${i % 7 === 6 ? 60 : 100}%"></div>`).join('')
    pictures.document = await draw(780, 1020, `<div style="position:absolute;inset:0;background:#f6f3ea"></div>
<div style="position:absolute;left:60px;right:60px;top:50px;text-align:center;font:700 54px Georgia,serif;color:#111;letter-spacing:2px;border-bottom:4px double #111;padding-bottom:12px">THE DAILY LEDGER</div>
<div style="position:absolute;left:60px;right:60px;top:170px;font:700 36px Georgia,serif;color:#111;line-height:1.1">STOCKS PLUNGE 508 POINTS, A DROP OF 22.6 PERCENT</div>
<div style="position:absolute;left:60px;right:60px;top:300px">${lines}</div>`)
  }, 60_000)

  /** The fit and the margins of the texts of a frame at moment t (the page of the real browser, as in doc-cards.test.ts). */
  const audit = async (html: string, w: number, h: number, t: number): Promise<{ overflow: string[]; outside: string[] }> => {
    const p = await (await launch()).newPage({ viewport: { width: w, height: h } })
    try {
      await p.setContent(html)
      await p.evaluate(() => document.fonts.ready.then(() => 0))
      await p.evaluate((time: number) => (window as unknown as { atelierRenderAt: (t: number) => void }).atelierRenderAt(time), t)
      return await p.evaluate(
        (size: { w: number; h: number }) => {
          const overflow = [...document.querySelectorAll<HTMLElement>('[data-fit]')].filter((e) => e.scrollWidth > e.clientWidth + 1 || (e.getAttribute('data-lines') === null && e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).whiteSpace !== 'nowrap')).map((e) => (e.className || e.tagName) + ': ' + (e.textContent ?? '').slice(0, 30))
          const outside = [...document.querySelectorAll<HTMLElement>('.cap,.punch,.lines,.tag,.qt,.qa,.ex,.ttl,.kick,.srcl,.src,.when,.elab,.lab,.val,.plabel,.vw,.vl,.hd,.box')]
            .filter((e) => {
              if (Number(getComputedStyle(e).opacity) === 0 && !e.closest('[data-anim]')) return false
              const r = e.getBoundingClientRect()
              return r.width > 0 && (r.left < 20 || r.top < 20 || r.right > size.w - 20 || r.bottom > size.h - 20)
            })
            .map((e) => (e.className || e.tagName) + ': ' + (e.textContent ?? '').slice(0, 30))
          return { overflow, outside }
        },
        { w, h }
      )
    } finally {
      await p.close()
    }
  }

  /** A frame through the page service (as the node draws it), saved as a JPEG, and whether every pixel is opaque. */
  const shoot = async (name: string, spec: MotionSpecInput, t: number, picture?: string, assets: CardAssets = {}, w = W, h = H): Promise<boolean> => {
    const html = motionHtml(spec, { width: w, height: h, durationS: 8, fontCss }, { ...(picture ? { picture } : {}), ...assets })
    const a = await audit(html, w, h, t)
    expect(a.overflow, `${name}: text that does not fit`).toEqual([])
    expect(a.outside, `${name}: text outside the frame`).toEqual([])
    const p = await service.open({ html, width: w, height: h, signal })
    try {
      const png = await p.frame(t)
      const m = MEDIA as NonNullable<typeof MEDIA>
      const raw = await m.run('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'], { signal, stdin: png })
      let opaque = raw.stdout.length === w * h * 4
      for (let i = 3; i < raw.stdout.length; i += 4) if (raw.stdout[i] !== 255) opaque = false
      const jpg = await m.run('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-frames:v', '1', '-c:v', 'mjpeg', '-pix_fmt', 'yuvj420p', '-q:v', '3', '-f', 'image2pipe', '-'], { signal, stdin: png })
      mkdirSync(SCREENS, { recursive: true })
      writeFileSync(path.join(SCREENS, `parchment-${name}.jpg`), jpg.stdout)
      return opaque
    } finally {
      await p.close()
    }
  }

  it.each([
    ['archive-full', 'full', 'photo', 7],
    ['archive-board', 'board', 'photo', 7],
    ['archive-board-quote', 'board-quote', 'photo', 7],
    ['archive-paper', 'paper', 'document', 7],
    ['archive-paper-excerpt', 'paper-excerpt', 'document', 7],
    ['bars', 'bars', 'photo', 7],
    ['bars-start', 'bars', 'photo', 0],
    ['timeline', 'timeline', 'photo', 7]
  ] as const)('%s: one frame in the light theme is opaque, its texts fit and stay inside the frame', { timeout: 120_000 }, async (name, key, pic, t) => {
    const specs: Record<string, MotionSpecInput> = {
      ...SPECS,
      full: archive({ frame: 'full', label: 'Mexico City, c. 1695', sub: 'Cristobal de Villalpando', lines: ['Own taxes.', 'Own militias.', 'Mini-republics.'], linesAtS: 1, punch: 'Belonged to Madrid', punchAtS: 2, source: 'Museo Nacional de Arte' }),
      board: archive({ frame: 'board', label: 'Silver bar, 1622', sub: 'from the Spanish treasure ship Atocha', punch: 'Belonged to Madrid', punchAtS: 2, source: 'Mel Fisher Museum' }),
      'board-quote': archive({ frame: 'board', label: 'Francisco Pizarro', sub: 'Conquistador, 1478-1541', quote: 'We came to take the gold, and the land was only a road to it.' }),
      paper: archive({ frame: 'paper', label: 'Leland & Rubinstein 1976', source: 'National Archives, 1987', lines: [] }),
      'paper-excerpt': archive({ frame: 'paper', label: 'The Daily Ledger', excerpt: 'Stocks plunge 508 points, a drop of 22.6 percent, as volume nearly doubles the record.', mark: 'plunge 508 points, a drop of 22.6 percent', markAtS: 4.5, source: 'The Daily Ledger, Oct 20 1987' }),
      timeline: { template: 'timeline', props: { kicker: 'Three centuries of silver', title: 'How the empire paid its debts', events: ['Treaty signed', 'Fleet leaves Cadiz', 'Silver reaches Seville after a long, rough crossing', 'The crown defaults', 'Mines of Potosi close', 'Smugglers take over'].map((label, i) => ({ when: `${1550 + i * 37}`, label, accent: i === 3 })) } } as MotionSpecInput
    }
    const spec = specs[key] as MotionSpecInput
    expect(await shoot(name, light(spec), t, pictures[pic])).toBe(true)
  })

  it('the data cards in a short, and the board and the paper in a short', { timeout: 120_000 }, async () => {
    expect(await shoot('bars-portrait', light(SPECS.bars as MotionSpecInput), 7, undefined, {}, PW, PH)).toBe(true)
    expect(await shoot('timeline-portrait', light(SPECS.timeline as MotionSpecInput), 7, undefined, {}, PW, PH)).toBe(true)
    expect(await shoot('archive-board-portrait', light(SPECS.board as MotionSpecInput), 5, pictures.photo, {}, PW, PH)).toBe(true)
    expect(await shoot('archive-paper-portrait', light(SPECS.paper as MotionSpecInput), 6, pictures.document, {}, PW, PH)).toBe(true)
  })

  it('the map in the light theme: three frames of 1940 Europe on the real pictures, opaque, text inside the frame', { timeout: 240_000 }, async () => {
    const map = await prepareMapAssets(MAP, { width: W, height: H, libraryRoot: RESOURCES, media: MEDIA as NonNullable<typeof MEDIA>, signal })
    for (const [name, t] of [['map-1-start', 0.6], ['map-2-route', 3.6], ['map-3-end', 7.5]] as const) expect(await shoot(name, light({ template: 'map', props: MAP }), t, undefined, { map })).toBe(true)
  })
})
