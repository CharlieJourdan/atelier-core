// The motion studio card « studio » (formats/studio.ts, decision 0111): the page around the three.js scene. Node prepares what the page
// needs beyond the spec (`StudioAssets`: three.js's two module files as text, the glyph outlines of every character the scene writes,
// from the bundled OFL fonts) and the page draws frame t with the script of studio-runtime.ts + studio-build.ts. Opaque, full frame: a
// base shot like the documentary cards. Runs in headless Chromium on the CPU (SwiftShader) or the GPU (`ATELIER_BROWSER_GPU=1`), the same
// pictures either way within rounding.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EngineError } from '../errors'
import { StudioProps, studioChars, type StudioAssets, type StudioPropsInput } from '../formats/studio'
import { esc, pageHtml, themeOf, type MotionCtx } from './base'
import type { Part } from './cards'
import { scriptJson } from './map3d'
import { STUDIO_BUILD_JS } from './studio-build'
import { glyphsOf, type GlyphSet, type StudioFace } from './studio-font'
import { STUDIO_HEAD_JS, STUDIO_TAIL_JS } from './studio-runtime'

export type { StudioAssets } from '../formats/studio'

function packageDir(name: string): string {
  for (const start of [path.dirname(fileURLToPath(import.meta.url)), process.cwd()]) {
    for (let dir = start; ; dir = path.dirname(dir)) {
      const at = path.join(dir, 'node_modules', name)
      if (existsSync(path.join(at, 'package.json'))) return at
      if (path.dirname(dir) === dir) break
    }
  }
  throw new EngineError('missing_tool', `The package ${name} is not installed: the motion studio cannot draw.`)
}

let libCache: Promise<StudioAssets['lib']> | null = null
/** three.js's core and main modules (ES modules, MIT), as text; the page links them through blob: URLs. */
export function studioLibrary(): Promise<StudioAssets['lib']> {
  libCache ??= (async () => {
    const dir = packageDir('three')
    const strip = (s: string): string => s.replace(/\/\/# sourceMappingURL=\S*\s*$/, '')
    const [core, main, pkg] = await Promise.all([readFile(path.join(dir, 'build', 'three.core.js'), 'utf8'), readFile(path.join(dir, 'build', 'three.module.js'), 'utf8'), readFile(path.join(dir, 'package.json'), 'utf8')])
    if (!main.includes("'./three.core.js'")) throw new EngineError('missing_tool', 'three: its module file has a shape this page cannot link')
    return { core: strip(core), main: strip(main), version: (JSON.parse(pkg) as { version: string }).version }
  })()
  libCache.catch(() => (libCache = null))
  return libCache
}

/** What the page of a studio card needs: the library and the outlines of the characters it writes (fonts from `<libraryRoot>/fonts`). */
export async function prepareStudio(input: StudioPropsInput, o: { libraryRoot: string }): Promise<StudioAssets> {
  const p = StudioProps.parse(input)
  const byFace = new Map<StudioFace, Set<string>>()
  for (const { face, chars } of studioChars(p)) {
    const set = byFace.get(face) ?? new Set<string>()
    for (const ch of chars) set.add(ch)
    byFace.set(face, set)
  }
  const fonts: Record<string, GlyphSet> = {}
  const dir = path.join(o.libraryRoot, 'fonts')
  await Promise.all([...byFace].map(async ([face, set]) => void (fonts[face] = await glyphsOf(dir, face, set))))
  return { lib: await studioLibrary(), fonts }
}

/** The grain: a seeded noise tile drawn once by the page (a still stretch keeps the same grain). */
const GRAIN_JS = String.raw`
(function () {
  var el = document.getElementById('stg'); if (!el) return;
  var c = document.createElement('canvas'); c.width = c.height = 256;
  var g = c.getContext('2d'), im = g.createImageData(256, 256), a = 12345;
  for (var i = 0; i < im.data.length; i += 4) { a = (a * 1664525 + 1013904223) >>> 0; var v = a >>> 24; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  g.putImageData(im, 0, 0);
  el.style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')';
})();
`

export function studioCard(input: StudioPropsInput, c: MotionCtx, a: StudioAssets | undefined): Part {
  const p = StudioProps.parse(input)
  // not prepared (a stub, a test of the page): the ground and the vignette only, like the 3D map's card
  if (!a) return { css: `#stv{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 42%,${p.look.background.spot ?? p.look.background.top},${p.look.background.bottom})}`, body: '<div id="stv"></div>' }
  const data = { width: c.width, height: c.height, durationS: c.durationS, look: p.look, camera: p.camera, items: p.items, fonts: a.fonts, shadowSpan: 80 }
  const css = `#stc{position:absolute;left:0;top:0;width:${c.width}px;height:${c.height}px}
#stv{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 55%,rgba(0,0,0,${p.look.vignette.toFixed(2)}) 100%)}
#stg{position:absolute;inset:0;pointer-events:none;opacity:${p.look.grain.toFixed(3)};mix-blend-mode:overlay}
#stk{display:none}`
  const body = `<canvas id="stc" width="${c.width}" height="${c.height}"></canvas>
<div id="stv"></div><div id="stg"></div><div id="stk" style="--k:0" data-v="${esc(a.lib.version)}"></div>
<script type="application/json" id="std">${scriptJson(data)}</script>
<script>var TH_CORE = ${scriptJson(a.lib.core)};
var TH_MAIN = ${scriptJson(a.lib.main)};</script>
<script>${GRAIN_JS}</script>
<script>${STUDIO_HEAD_JS}${STUDIO_BUILD_JS}${STUDIO_TAIL_JS}</script>`
  return { css, body }
}

/** The whole page of a studio card (the demo and the tests draw it without the motion node). */
export function studioHtml(input: StudioPropsInput, c: MotionCtx, a: StudioAssets): string {
  const part = studioCard(input, c, a)
  return pageHtml(c, themeOf('#3B82F6', 'dark'), '#3B82F6', part.css, part.body)
}
