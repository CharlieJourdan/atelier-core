// The 3D map card's proof (formats/map3d.ts): two ~10 s maps at 1920×1080 drawn by MapLibre GL JS in headless Chromium.
//   europe-1940  — the reference's « Europe, summer 1940 » shot (Markets of the Past, 36J1tL9ulGA 0:21.5–0:27.5) rebuilt from its measures:
//                  same region, camera path (pose fitted on its frames), look, timings;
//   alps-route   — the 3D: tilted Alps, Switzerland raised, a camera flight, the route Berlin → Bern drawn on the ground.
// Writes the videos and a side-by-side sheet (reference frame | ours at the same moment) to <ATELIER_INPUTS or temp folder>/tests-2026-11/motion/maps
// (or --out), stills (960 px) to docs/screens/motion-kit/map3d-*.png, and prints seconds of work per minute of map. Tiles are downloaded
// once (NASA GIBS, AWS Terrain Tiles) into <out>/cache. Exits 1 when something fails.
// Options: --out <dir>  --gpu (WebGL on the GPU; default: software, SwiftShader)  --only europe|alps  --stills <t1,t2,…> (stills only)
//          --ref <folder of reference frames 36J-<t>.jpg> (default <ATELIER_INPUTS or temp folder>/tests-2026-11/motion/maps-ref)
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Map3dProps, type Map3dPropsInput } from '../src/engine/formats/map3d'
import { FPS } from '../src/engine/formats/timing'
import { chromiumService, findBrowser } from '../src/engine/media/browser'
import { systemMediaService } from '../src/engine/media/tools'
import { pageHtml, themeOf } from '../src/engine/motion/base'
import { renderFast } from '../src/engine/motion/fast'
import { docFontCssOf } from '../src/engine/motion/fonts'
import { map3dCard } from '../src/engine/motion/map3d'
import { prepareMap3d } from '../src/engine/motion/map3d-data'
import { CARD_ENCODER } from '../src/engine/motion/render'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const out = (s: string): void => void process.stdout.write(s + '\n')
/** Working folder: --out/--ref flags, else , else a folder under the temp directory. */
const INPUTS = process.env.ATELIER_INPUTS ?? path.join(os.tmpdir(), 'atelier-inputs')
const dir = path.resolve(arg('out', path.join(INPUTS, 'tests-2026-11', 'motion', 'maps')))
const refDir = path.resolve(arg('ref', path.join(INPUTS, 'tests-2026-11', 'motion', 'maps-ref')))
const gpu = process.argv.includes('--gpu')
const only = arg('only', '')
const stills = arg('stills', '')
const media = systemMediaService({ platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' })
if (!media || !findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })) {
  out('ffmpeg or a browser (Chromium, Chrome, Edge) is missing.')
  process.exit(1)
}
mkdirSync(dir, { recursive: true })
const signal = new AbortController().signal
const browser = chromiumService({ gpu })
const W = 1920
const H = 1080
const libraryRoot = path.join(ROOT, 'resources')
const fontCss = await docFontCssOf(libraryRoot)

/** The reference shot, measured (research note maps-reference-2026-11 (old repository) §Europe): cut at 0:21.5, 6 s; we keep its first 6 s and hold 4 s more. */
const EUROPE: Map3dPropsInput = {
  kicker: '1940',
  title: 'Europe, summer 1940',
  look: 'satellite',
  // the reference's continent shows no raised relief (its picture carries its own shading): a flat tilted Earth, fast on any machine
  exaggeration: 0,
  camera: {
    keys: [
      { atS: 0, center: { lon: 8.97, lat: 48.66 }, zoom: 4.69, pitch: 53.2, bearing: 3.1 },
      { atS: 4.25, center: { lon: 8.51, lat: 47.2 }, zoom: 5.61, pitch: 49, bearing: 1.9 }
    ],
    ease: 'push',
    drift: 0.008
  },
  regions: [
    { countries: ['FRA', 'BEL', 'NLD', 'LUX', 'DEU', 'AUT', 'CZE', 'POL', 'ITA', 'DNK', 'SVN'], tone: 'red', atS: 0.25 },
    { countries: ['CHE'], tone: 'gold', label: 'Switzerland', atS: 3.65 }
  ],
  names: [
    { lon: 10.6, lat: 51.4, text: 'Germany', atS: 1.0 },
    { lon: 2.6, lat: 46.9, text: 'France', atS: 1.0 },
    { lon: 12.6, lat: 43.0, text: 'Italy', atS: 1.2 }
  ]
}

/** The 3D: Berlin to Bern over the tilted Alps, Switzerland raised as it lands. */
const ALPS: Map3dPropsInput = {
  kicker: '1933–1940',
  title: 'Complaints to Bern',
  look: 'satellite',
  exaggeration: 2.2,
  camera: {
    keys: [
      { atS: 0, center: { lon: 13.1, lat: 51.9 }, zoom: 6.0, pitch: 50, bearing: 212 },
      { atS: 5.2, center: { lon: 7.9, lat: 47.2 }, zoom: 6.7, pitch: 58, bearing: 196 },
      { atS: 8.6, center: { lon: 7.95, lat: 46.75 }, zoom: 7.1, pitch: 62, bearing: 182 }
    ],
    follow: { route: 0, zoom: 6.2, pitch: 54, bearing: 208 },
    ease: 'inOut',
    drift: 0.01
  },
  regions: [{ countries: ['CHE'], tone: 'gold', label: 'Switzerland', raise: 6, atS: 5.4 }],
  pins: [
    { lon: 13.405, lat: 52.52, label: 'Berlin', atS: 0.5 },
    { lon: 7.447, lat: 46.948, label: 'Bern', atS: 4.0 }
  ],
  routes: [{ from: { lon: 13.405, lat: 52.52 }, to: { lon: 7.447, lat: 46.948 }, atS: 1.0, drawS: 3 }],
  names: [
    { lon: 10.4, lat: 50.6, text: 'Germany', atS: 0.8 },
    { lon: 5.2, lat: 47.6, text: 'France', atS: 5.0 },
    { lon: 9.6, lat: 45.6, text: 'Italy', atS: 5.6 },
    { lon: 13.4, lat: 47.4, text: 'Austria', atS: 5.8 }
  ],
  facts: [
    { text: '26 cantons', atS: 7.2 },
    { text: '4 languages', atS: 7.9 }
  ]
}

const maps = [
  { id: 'europe-1940', props: EUROPE, seconds: 10, ref: { start: 21.5, times: [21.6, 22.0, 22.4, 22.8, 23.3, 24.2, 25.4, 26.0, 27.4] } },
  { id: 'alps-route', props: ALPS, seconds: 10, ref: null }
].filter((m) => !only || m.id.startsWith(only))

async function htmlOf(id: string, input: Map3dPropsInput, seconds: number): Promise<string> {
  const props = Map3dProps.parse(input)
  const t0 = Date.now()
  const assets = await prepareMap3d(props, { width: W, height: H, durationS: seconds, libraryRoot, cacheDir: path.join(dir, 'cache'), signal })
  const tiles = Object.keys(assets.tiles).length
  const mb = Object.values(assets.tiles).reduce((a, b) => a + b.length, 0) / 1e6
  out(`${id}: ${tiles} tiles (${mb.toFixed(1)} MB inline, sat z≤${assets.maxzoom.sat}, dem z≤${assets.maxzoom.dem}) prepared in ${((Date.now() - t0) / 1000).toFixed(1)} s${assets.warnings ? ` — ${assets.warnings.join('; ')}` : ''}`)
  const part = map3dCard(props, { width: W, height: H, durationS: seconds, fontCss }, assets)
  return pageHtml({ width: W, height: H, durationS: seconds, fontCss }, themeOf('#d5412f', 'dark'), '#d5412f', part.css, part.body)
}

let failed = false
const shotsDir = path.join(ROOT, 'docs', 'screens', 'motion-kit')
mkdirSync(shotsDir, { recursive: true })
for (const m of maps) {
  try {
    const html = await htmlOf(m.id, m.props, m.seconds)
    await writeFile(path.join(dir, `${m.id}.html`), html)
    if (stills) {
      const page = await browser.open({ html, width: W, height: H, signal })
      for (const t of stills.split(',').map(Number)) {
        const t0 = Date.now()
        const png = await page.frame(t)
        await writeFile(path.join(dir, `${m.id}-${t.toFixed(2)}.png`), png)
        out(`  still ${t.toFixed(2)} s in ${Date.now() - t0} ms`)
      }
      await page.close()
      continue
    }
    const file = path.join(dir, `${m.id}${gpu ? '-gpu' : ''}.mp4`)
    const frames = m.seconds * FPS
    const t0 = Date.now()
    const stats = await renderFast({ browser, media, html, width: W, height: H, frames, out: file, signal, encoder: CARD_ENCODER, opaque: true, pages: gpu ? 2 : 4 })
    const s = (Date.now() - t0) / 1000
    out(`${m.id}: ${frames} frames (${stats.shot} photographed, ${stats.pages} pages, ${gpu ? 'GPU' : 'software WebGL'}) in ${s.toFixed(1)} s = ${((s / m.seconds) * 60).toFixed(0)} s per minute of map → ${file}`)
    // stills (960 px) for the docs, and the side-by-side sheet with the reference
    for (const [name, t] of [['a', 2], ['b', 6.5]] as const) {
      await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=960:-2', path.join(shotsDir, `map3d-${m.id}-${name}.png`)], { signal })
    }
    if (m.ref && existsSync(refDir)) {
      const inputs: string[] = []
      const rows: string[] = []
      m.ref.times.forEach((rt, i) => {
        const ours = rt - m.ref.start
        inputs.push('-i', path.join(refDir, `36J-${rt.toFixed(1).padStart(6, '0')}.jpg`), '-ss', ours.toFixed(3), '-i', file)
        rows.push(`[${2 * i}:v]scale=960:540,setsar=1[r${i}];[${2 * i + 1}:v]trim=end_frame=1,scale=960:540,setsar=1[o${i}];[r${i}][o${i}]hstack[h${i}]`)
      })
      const n = m.ref.times.length
      const graph = `${rows.join(';')};${Array.from({ length: n }, (_, i) => `[h${i}]`).join('')}vstack=inputs=${n}[s];[s]scale=1920:-2[out]`
      await media.run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-q:v', '3', path.join(dir, `${m.id}-sheet.jpg`)], { signal })
      out(`  sheet → ${path.join(dir, `${m.id}-sheet.jpg`)}`)
    }
  } catch (e) {
    failed = true
    out(`${m.id}: FAILED ${(e as Error).stack ?? String(e)}`)
  }
}
await browser.close?.()
process.exit(failed ? 1 : 0)
