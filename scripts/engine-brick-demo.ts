// `npm run engine:brick-demo` — the proof of the custom bricks (« briques sur mesure », docs/ENGINE-SPEC.md §25.2): a channel's own animated
// card (our sample brick: data, not code of the app) drawn ONLY by the headless browser of this machine, in a sandboxed page. Free and offline.
// It checks, and exits 1 if any check fails:
//   1. the preview: three stills and the lint pass (nothing overflows, text in the safe area, readable, no error, no request);
//   2. the preview clip is a real MP4: ffprobe says H.264, 30 fps, the brick's length, 960 px wide;
//   3. `motion.render` (the real node) draws the brick of a plan's `custom:<id>` shot to ProRes 4444 with alpha, as many frames as the shot;
//      drawn again with the same brick, it comes from the cache; a new version of the brick is drawn again;
//   4. the walls: the static checks refuse a brick with a script tag or a web address; in the real page, the CSP refuses a web picture and
//      eval; a frame that never ends is cut within its budget and the error names the brick.
// One frame of the clip goes to docs/screens/engine/brick-card.png (and the middle still to brick-card-still.png): look at it.
// Options: --data <dir> (default <tmp>/atelier-brick-demo) --frames <dir> (default docs/screens/engine).
import { mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EngineError } from '../src/engine/errors'
import { Brick, resolveValues, staticProblems, type BrickInput } from '../src/engine/formats/brick'
import { EDITPLAN_SCHEMA, type EditPlan } from '../src/engine/formats/editplan'
import { chromiumService, findBrowser } from '../src/engine/media/browser'
import { probe } from '../src/engine/media/probe'
import { FULL_FFMPEG_HINT, locateTool, RENDER_ENCODERS, requireFilters, systemMediaService } from '../src/engine/media/tools'
import { brickPage } from '../src/engine/motion/brick-page'
import { drawBrick, previewBrick } from '../src/engine/motion/brick-render'
import { fontCssOf } from '../src/engine/motion/fonts'
import { MotionParams, motionRender } from '../src/engine/nodes/motion-render'
import type { NodeOutputs } from '../src/engine/artefacts'
import { createRunCtx, type RunCtx } from '../src/engine/registry'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const dataDir = path.resolve(arg('data', path.join(os.tmpdir(), 'atelier-brick-demo')))
const framesDir = path.resolve(arg('frames', path.join(ROOT, 'docs', 'screens', 'engine')))
const out = (s: string): void => void process.stdout.write(s + '\n')
const checks: { name: string; ok: boolean }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok })
  out(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

const toolEnv = { platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' }
const media = systemMediaService(toolEnv)
if (!media) {
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run engine:brick-demo ».`)
  process.exit(1)
}
const exe = findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })
out(`ffmpeg: ${locateTool('ffmpeg', toolEnv)}\nnavigateur: ${exe ?? 'introuvable'}`)
if (!exe) {
  out('Aucun Chromium, Chrome ou Edge sur cet ordinateur : installe-en un (ou donne ATELIER_CHROMIUM) puis relance « npm run engine:brick-demo ».')
  process.exit(1)
}
const signal = new AbortController().signal
await requireFilters(media, [...RENDER_ENCODERS, 'prores_ks'], signal)
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
mkdirSync(dataDir, { recursive: true })
mkdirSync(framesDir, { recursive: true })
const browser = chromiumService({ executablePath: exe })
const fontCss = await fontCssOf(path.join(ROOT, 'resources'))
const look = { accent: '#E8590C', theme: 'dark' as const }

// ===== our sample brick: a channel presentation card ===========================================================================================
const CARD: Omit<BrickInput, 'version'> = {
  id: 'carte-chaine',
  name: 'Carte de la chaîne',
  description: 'Présente la chaîne au début d’une vidéo : son nom, sa promesse, un trait de sa couleur qui se dessine.',
  html: [
    '<div class="card" data-anim="rise" data-at="0.15" data-dur="0.6" data-out="3.4">',
    '<div class="tag" data-anim="fade" data-at="0.45" data-dur="0.4">{{kicker}}</div>',
    '<div class="title" data-fit="40">{{title}}</div>',
    '<div class="bar"></div>',
    '<div class="line" data-anim="left" data-at="0.8" data-dur="0.5" data-dx="40">{{tagline}}</div>',
    '</div>'
  ].join(''),
  css: [
    '.card{position:absolute;left:var(--safe-left);top:calc(var(--safe-top) + 120px);width:980px;padding:40px 52px 44px;border-radius:28px;background:rgba(12,14,20,0.92);box-shadow:0 24px 60px rgba(0,0,0,0.35)}',
    '.tag{display:inline-block;padding:6px 14px;border-radius:999px;background:var(--f-color);color:#14161c;font-size:26px;letter-spacing:0.06em;text-transform:uppercase}',
    '.title{margin-top:22px;font-size:84px;line-height:96px;font-weight:700;white-space:nowrap;overflow:hidden}',
    '.bar{height:8px;border-radius:4px;background:var(--f-color);width:0;margin:18px 0 22px}',
    '.line{font-size:38px;line-height:48px;color:rgba(255,255,255,0.86)}'
  ].join('\n'),
  script: "var bar = document.querySelector('.bar');\nbrick.render = function (t) { bar.style.width = (520 * brick.ease.out(brick.at(t, 0.6, 0.9))).toFixed(1) + 'px'; };",
  fields: [
    { type: 'text', name: 'title', max: 40, default: 'Les Grandes Énigmes' },
    { type: 'text', name: 'tagline', max: 70, default: 'Une énigme de l’Histoire, chaque semaine' },
    { type: 'text', name: 'kicker', max: 24, default: 'La chaîne' },
    { type: 'color', name: 'color', default: '#E8590C' }
  ],
  sample: { title: 'Les Grandes Énigmes' },
  seconds: { min: 2.5, max: 6 },
  use: { on: 'start', seconds: 4 }
}
const v1 = Brick.parse({ ...CARD, version: 1 })

// ===== 1-2. the preview ========================================================================================================================
out(`Atelier brick demo — data ${dataDir}\n\n— 1. the preview`)
const pv = await previewBrick({ brick: v1, size: [1920, 1080], look, fontCss, browser, media, outDir: path.join(dataDir, 'preview'), signal })
out(`stills: ${pv.stills.map((s) => `${Math.round(s.share * 100)} % → ${(s.coverage * 100).toFixed(1)} % drawn`).join(' · ')} (${Math.round(pv.ms)} ms)`)
for (const i of pv.lint) out(`  lint: ${i.rule}: ${i.message}`)
check('three stills, the lint passes, no console error, no request', pv.stills.length === 3 && pv.lint.length === 0 && pv.error === null && pv.blocked.length === 0, `${pv.lint.length} issue(s), ${pv.blocked.length} blocked`)
const clipInfo = pv.clip ? await probe(media, pv.clip, signal, true) : null
const cv = clipInfo?.streams.find((s) => s.codec_type === 'video')
out(`clip: ${pv.clip} · ${cv?.codec_name} ${cv?.width}×${cv?.height} ${cv?.r_frame_rate} ${cv?.nb_read_frames} frames ${clipInfo?.durationS.toFixed(2)} s`)
check('the preview clip is an H.264 MP4, 30 fps, 960 px wide, the brick’s 4 s', cv?.codec_name === 'h264' && cv.width === 960 && cv.r_frame_rate === '30/1' && Number(cv.nb_read_frames) === 120, `${cv?.codec_name} ${cv?.width} ${cv?.r_frame_rate} ${cv?.nb_read_frames}`)
if (pv.clip) {
  await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', '2.0', '-i', pv.clip, '-frames:v', '1', path.join(framesDir, 'brick-card.png')], { signal })
  const mid = pv.stills.find((s) => s.share === 0.5)?.jpeg
  if (mid) await media.run('ffmpeg', ['-v', 'error', '-y', '-i', mid, path.join(framesDir, 'brick-card-still.png')], { signal })
  out(`frames: ${path.join(framesDir, 'brick-card.png')}, brick-card-still.png`)
}

// ===== 3. the real node ========================================================================================================================
out('\n— 3. motion.render draws custom:carte-chaine')
const frames = 120
const plan: EditPlan = {
  schema: EDITPLAN_SCHEMA,
  fps: 30,
  size: [1920, 1080],
  frames: 180,
  tracks: { base: ['s001'], overlay: ['b001'], labels: [] },
  captionsPreset: 'highlight',
  shots: [
    { id: 's001', track: 'base', startFrame: 0, endFrame: 180, kind: 'stock.photo', genItem: 'i', transitionIn: 'cut', role: 'base', beat: 0 },
    { id: 'b001', track: 'overlay', startFrame: 6, endFrame: 6 + frames, kind: 'motion', transitionIn: 'cut', role: 'scene', beat: 0, graphic: { template: 'custom:carte-chaine', props: { title: 'Les Grandes Énigmes' }, accent: look.accent, theme: 'dark' } }
  ],
  chapters: [],
  diagnostics: []
}
let scratch = 0
const ctx = (): RunCtx =>
  createRunCtx(motionRender, {
    emit: () => undefined,
    signal,
    store: { read: () => Promise.resolve(null) },
    seed: 1,
    where: 'local',
    attempt: 1,
    notes: [],
    reportCost: () => undefined,
    services: {
      media,
      browser,
      library: { root: path.join(ROOT, 'resources') },
      workspace: {
        scratch: async (l: string) => {
          const d = path.join(dataDir, 'scratch', `${++scratch}-${l}`)
          mkdirSync(d, { recursive: true })
          return d
        },
        cache: async (k: string) => {
          const d = path.join(dataDir, 'cache', k)
          mkdirSync(d, { recursive: true })
          return d
        }
      }
    }
  }, { minutes: 1, budgetMode: 'usage_max' })
const inputs = { plan: { type: 'json.editplan', value: plan, files: [], meta: {} } } as never
const draw = (bricks: Brick[]): Promise<NodeOutputs> => motionRender.run(ctx(), inputs, MotionParams.parse({ bricks }))
const first = await draw([v1])
const file = first.graphics?.files?.[0] as string
const info = await probe(media, file, signal, true)
const fv = info.streams.find((s) => s.codec_type === 'video')
out(`overlay: ${file} · ${fv?.codec_name} ${fv?.pix_fmt} ${fv?.width}×${fv?.height} ${fv?.nb_read_frames} frames`)
check('the overlay is ProRes 4444 with alpha, 1920×1080, the shot’s 120 frames', fv?.codec_name === 'prores' && /^yuva/.test(fv.pix_fmt ?? '') && fv.width === 1920 && Number(fv.nb_read_frames) === frames, `${fv?.codec_name} ${fv?.pix_fmt} ${fv?.nb_read_frames}`)
const again = await draw([v1])
const v2 = await draw([Brick.parse({ ...CARD, version: 2 })])
check('the same brick comes from the cache; a new version is drawn again', (again.graphics?.meta as { cached: number }).cached === 1 && (v2.graphics?.meta as { drawn: number }).drawn === 1, `cached ${(again.graphics?.meta as { cached: number }).cached}, v2 drawn ${(v2.graphics?.meta as { drawn: number }).drawn}`)

// ===== 4. the walls ============================================================================================================================
out('\n— 4. the walls')
const refused = staticProblems({ ...v1, html: v1.html + '<script>fetch("https://example.com")</script><img src="https://example.com/x.png">' })
check('the static checks refuse a script tag and a web address before any drawing', refused.some((p) => /<script>/.test(p)) && refused.some((p) => /no network/.test(p)), refused.join(' | '))
const values = resolveValues(v1, v1.sample)
if (!values.ok) throw new Error(values.problems.join())
const SANDBOX = { loadMs: 5000, frameMs: 1500 }
const spy = await browser.open({ html: brickPage({ ...v1, html: v1.html + '<img src="http://127.0.0.1:9/spy.png">', script: "brick.render = function () { var ran = false; try { eval('1'); ran = true } catch (e) { ran = false } if (ran) throw new Error('eval ran'); };" }, values.values, { width: 1920, height: 1080, durationS: 4, fontCss }, look), width: 1920, height: 1080, signal, sandbox: SANDBOX })
// the frame throws « eval ran » if eval worked
const evalRefused = await spy.frame(1).then(
  () => true,
  () => false
)
const found = spy.problems?.() ?? { console: [], blocked: [] }
await spy.close()
check('in the real page the CSP refuses the web picture and eval', found.console.some((c) => /Content Security Policy|Refused to load/i.test(c)) && evalRefused, `eval ${evalRefused ? 'refused' : 'RAN'}; ${found.console.slice(0, 2).join(' | ').slice(0, 260)}`)
const loop = Brick.parse({ ...CARD, id: 'boucle', name: 'Boucle sans fin', script: 'brick.render = function (t) { if (t > 0.5) { for (;;) {} } };', version: 1 })
const t0 = Date.now()
const err = await drawBrick({ brick: loop, values: values.values, ctx: { width: 1920, height: 1080, durationS: 1, fontCss }, look, browser, media, frames: 30, out: path.join(dataDir, 'loop.mov'), signal, sandbox: SANDBOX }).catch((e: unknown) => e)
const ms = Date.now() - t0
check('a frame that never ends is cut within its budget; the permanent error names the brick', err instanceof EngineError && err.permanent && /« Boucle sans fin » \(custom:boucle v1\).*took more than 1500 ms/.test(err.message) && ms < 15_000, `${ms} ms: ${(err as Error).message?.slice(0, 160)}`)

await browser.close?.()
const failed = checks.filter((c) => !c.ok)
out(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
