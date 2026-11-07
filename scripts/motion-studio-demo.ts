// The motion studio's proof (decision 0111): three reference passages rebuilt as `studio` cards from their measures
// (research note motion-studio-2026-11 (old repository)) and drawn by three.js in headless Chromium, then laid side by side with the reference.
//   finary-data  — Finary « The most powerful man no one is talking about » (SCVvvIN3Azs) 3:11.2–3:24.3: a total that branches into four
//                  glossy boxes, then a glowing bar equal to a stack of five oil majors (2D motion design, glossy 3D-lite);
//   finary-vault — same video 6:09.7–6:22.0: the ADIA glass card branching to three pills, then a 3D glass vault turning, two pills;
//   paris-3d     — Cornerstone Timelapse « Evolution of Paris » (ehgZi6QnIv8) 0:56.7–1:06.7: Roman Lutetia, an island city growing house
//                  by house, a wall ringing it, the year counting (Blender-like 3D: terrain, river, trees, sun and shadows).
// Writes <out>/<name>.mp4 (ours), <name>-side.mp4 (reference | ours, 2560×720) and prints seconds of work per minute. Exits 1 on failure.
// Options: --out <dir>  --ref <dir with finary-v4.mp4 and paris-full.mp4>  --only <name>  --stills <t1,t2> (PNG stills only)  --gpu
import { existsSync, mkdirSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FPS } from '../src/engine/formats/timing'
import type { StudioPropsInput } from '../src/engine/formats/studio'
import { chromiumService, findBrowser } from '../src/engine/media/browser'
import { systemMediaService } from '../src/engine/media/tools'
import { renderFast } from '../src/engine/motion/fast'
import { CARD_ENCODER } from '../src/engine/motion/render'
import { prepareStudio, studioHtml } from '../src/engine/motion/studio'
import { branchScene, heroScene, nodeScene, stackScene, studioLookOf, timelapseScene } from '../src/engine/motion/studio-style'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const out = (s: string): void => void process.stdout.write(s + '\n')
/** Working folder: --out/--ref flags, else $ATELIER_INPUTS, else a folder under the temp directory. */
const INPUTS = process.env.ATELIER_INPUTS ?? path.join(os.tmpdir(), 'atelier-inputs')
const dir = path.resolve(arg('out', path.join(INPUTS, 'tests-2026-11', 'motion-studio', 'rounds', 'r1')))
const refDir = path.resolve(arg('ref', path.join(INPUTS, 'tests-2026-11', 'motion-studio', 'ref')))
const only = arg('only', '')
const stills = arg('stills', '')
const gpu = process.argv.includes('--gpu')
const media = systemMediaService({ platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' })
if (!media || !findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })) {
  out('ffmpeg or a browser (Chromium, Chrome, Edge) is missing.')
  process.exit(1)
}
mkdirSync(dir, { recursive: true })
const signal = new AbortController().signal
const browser = chromiumService({ gpu })
const W = 1280
const H = 720
const libraryRoot = path.join(ROOT, 'resources')

// Finary's measured motion style (p2-analysis-v4.json of the Finary analysis, motion.elements[0]) + the dark data
// scenes' own colours read on the frames (3:14.6, 3:23.6, 6:12.6, 6:16.0)
const finaryMeasured = {
  palette: ['#E9E4D8', '#B9BDE8', '#0B1020', '#F4A86A', '#FFE23B', '#FFFFFF'],
  fonts: ['bold condensed grotesque sans with outlined and filled variants', 'high-contrast serif for article headlines', 'small caps sans for UI data labels'],
  texture: 'flat paper-and-graph-grid look with halftone cut-outs; dark glossy 3D-glass cards for data scenes',
  easing: 'snappy ease-out pops and slides, text scaling in with slight overshoot, slow drift and zoom on cut-outs and maps'
}
const measured = studioLookOf(finaryMeasured)
// the frames' own measures override what the words cannot say: a WIDE grotesque (not condensed) on the data scenes, peach numbers
const finary = {
  ...measured,
  face: 'wide' as const,
  background: { kind: 'vignette' as const, top: '#151a2c', spot: '#161c30', bottom: '#06080f', spotAt: [0.5, 0.36] as [number, number] },
  palette: { ...measured.palette, ground: '#2b1a0e', accent: '#f4a263', accent2: '#ffe2bd', panel: '#2b3a7e', dark: '#10162e', muted: '#a3abe6', cool: '#3f5fd6', fg: '#f4f5fa' },
  glow: 0.75,
  grain: 0.03,
  vignette: 0.35
}

interface Passage {
  name: string
  ref: { file: string; from: number; to: number }
  cards: { d: number; props: StudioPropsInput }[]
}
const PASSAGES: Passage[] = [
  {
    name: 'finary-data',
    ref: { file: 'finary-v4.mp4', from: 191.2, to: 204.3 },
    cards: [
      { d: 7.0, props: branchScene({ value: 1500, unit: 'Mds $', parts: 4, look: finary, d: 7.0, times: { rise: 1.8, branches: 2.65 } }) },
      {
        d: 6.1,
        props: stackScene({
          value: '1\u202f500',
          unit: 'Mds $',
          label: "Fonds d'Abou Dabi",
          stack: [
            { label: 'ExxonMobil', weight: 2.15 },
            { label: 'Chevron', weight: 1.19 },
            { label: 'Shell', weight: 1.0 },
            { label: 'TotalEnergies', weight: 0.9 },
            { label: 'BP', weight: 0.71 }
          ],
          stackLabel: '5 majors pétrolières',
          look: finary,
          d: 6.1,
          times: { equals: 1.3, first: 2.0, every: 0.55 }
        })
      }
    ]
  },
  {
    name: 'finary-vault',
    ref: { file: 'finary-v4.mp4', from: 369.7, to: 382.0 },
    cards: [
      { d: 5.0, props: nodeScene({ title: 'ADIA', sub: ['Abu Dhabi Investment', 'Authority · 1976'], traits: ['Passif', 'Ultra diversifié', 'Aucun chiffre publié'], look: finary, d: 5.0, times: { rise: 0.75, traits: [1.45, 1.95, 2.6] } }) },
      { d: 7.3, props: heroScene({ shape: 'vault', pills: ['Fuites', 'Estimations'], look: finary, d: 7.3, times: [2.8, 3.5] }) }
    ]
  },
  {
    name: 'paris-3d',
    ref: { file: 'paris-full.mp4', from: 56.7, to: 66.7 },
    cards: [
      {
        d: 10,
        props: timelapseScene({
          years: [[0, 247], [1.3, 262], [2.6, 282], [4.0, 302], [5.3, 318], [6.6, 333], [7.9, 347], [9.3, 362], [10, 380]],
          era: 'Roman Lutetia',
          caption: { lead: 'Late Roman era', text: ['A wall rings the island;', 'then Lutetia becomes Paris'], atS: 5.3 },
          houses: { start: 12, end: 40, growS: 4.5 },
          wallAtS: 2.4,
          d: 10
        })
      }
    ]
  }
]

let failed = false
for (const p of PASSAGES) {
  if (only && p.name !== only) continue
  const parts: string[] = []
  let work = 0
  let frames = 0
  for (const [i, c] of p.cards.entries()) {
    const assets = await prepareStudio(c.props, { libraryRoot })
    const html = studioHtml(c.props, { width: W, height: H, durationS: c.d, fontCss: '' }, assets)
    if (stills) {
      const page = await browser.open({ html, width: W, height: H, signal })
      for (const t of stills.split(',').map(Number)) {
        if (t >= c.d) continue
        const png = await page.frame(t)
        const f = path.join(dir, `${p.name}-c${i}-${t.toFixed(2)}.png`)
        await writeFile(f, png)
        out(`still ${f}`)
      }
      await page.close()
      continue
    }
    const file = path.join(dir, `${p.name}-c${i}.mp4`)
    const n = Math.round(c.d * FPS)
    const t0 = performance.now()
    const st = await renderFast({ browser, media, html, width: W, height: H, frames: n, out: file, signal, encoder: CARD_ENCODER, opaque: true })
    const s = (performance.now() - t0) / 1000
    work += s
    frames += n
    out(`${p.name} card ${i}: ${n} frames in ${s.toFixed(1)} s (${st.shot} photographed, ${st.pages} pages) = ${((s / c.d) * 60).toFixed(0)} s a minute`)
    parts.push(file)
  }
  if (stills || parts.length === 0) continue
  const ours = path.join(dir, `${p.name}.mp4`)
  const list = path.join(dir, `${p.name}.txt`)
  await writeFile(list, parts.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n') + '\n')
  await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', ours], { signal })
  await rm(list, { force: true })
  out(`${p.name}: ${(frames / FPS).toFixed(1)} s drawn in ${work.toFixed(1)} s = ${((work / (frames / FPS)) * 60).toFixed(0)} s of work a minute (${gpu ? 'GPU' : 'CPU, SwiftShader'})`)
  const ref = path.join(refDir, p.ref.file)
  if (!existsSync(ref)) {
    out(`reference ${ref} missing: no side by side`)
    continue
  }
  const side = path.join(dir, `${p.name}-side.mp4`)
  const len = (p.ref.to - p.ref.from).toFixed(2)
  const lbl = (s: string): string => `drawtext=fontfile='${path.join(libraryRoot, 'fonts', 'Inter-SemiBold.ttf').replace(/\\/g, '/').replace(':', '\\:')}':text='${s}':x=16:y=14:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6`
  try {
    await media.run(
      'ffmpeg',
      ['-v', 'error', '-y', '-ss', String(p.ref.from), '-t', len, '-i', ref, '-i', ours, '-filter_complex', `[0:v]fps=30,scale=1280:720,setsar=1,${lbl('REFERENCE')}[a];[1:v]scale=1280:720,setsar=1,${lbl('ATELIER motion studio')}[b];[a][b]hstack=inputs=2[v]`, '-map', '[v]', '-t', len, '-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', side],
      { signal }
    )
    out(`side by side ${side}`)
  } catch (e) {
    failed = true
    out(`side by side failed: ${(e as Error).message}`)
  }
}
await browser.close?.()
process.exit(failed ? 1 : 0)
