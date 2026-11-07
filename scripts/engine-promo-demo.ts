// `npm run engine:promo-demo` — the channel's own promo rebuilt in motion design (promo-motion, research note promo-motion-2026-11 (old repository)),
// then dropped into a film. Free and offline (ffmpeg and a Chromium already on the machine). Exits 1 if a check fails.
//   1. The reference: Charlie's own video (his channel's promo is the card from 84.60 s to 94.32 s). The book is cut out of its own frames:
//      the card's empty first frame against a frame where the book stands, so its shadow comes with it (a matte, not a rectangle).
//   2. The promo rebuilt piece by piece by our motion bricks (motion/promo.ts), drawn at 1080p, 30 fps, as long as the reference's card.
//   3. Frame by frame against the reference: the difference of each piece at every 0.08 s (how far its entrance is) and on the held card,
//      side-by-side pictures (docs/screens/promo/compare-*.png) and a side-by-side film (outside git); the QR code read back.
//   4. The promo as the channel's input: a 2-minute film on the avatar@1 fakes with the promo after the hook, about 1:25, as its own
//      asset says (« type : promo », « place : après l'accroche », « mode : identique »); the clip in the film at that moment is ours.
// Options: --ref <reference mp4> --out <folder outside git> --frames <screens folder> --skip-film.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encodePng } from '../src/engine/media/png'
import { probe } from '../src/engine/media/probe'
import { FULL_FFMPEG_HINT, systemMediaService } from '../src/engine/media/tools'
import { chromiumService } from '../src/engine/media/browser'
import { PromoCard } from '../src/engine/formats/promo'
import { PROMO_TIMELINE } from '../src/engine/motion/promo'
import { drawPromo } from '../src/engine/motion/promo-render'
import { runAvatarBaseDemo } from '../src/engine/pipelines/avatar-base-demo'
import { BASE_STYLES } from '../src/main/production/styles/seeds'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const REF = path.resolve(arg('ref', path.join(os.homedir(), 'Downloads', 'cette-vieille-astuce-de-ma-on-arr-te-la-.mp4')))
/** The working folder: $ATELIER_INPUTS, else the temp folder. */
const inputs = process.env.ATELIER_INPUTS ?? path.join(os.tmpdir(), 'atelier-inputs')
const OUT = path.resolve(arg('out', path.join(inputs, 'tests-2026-11', 'promo')))
const SCREENS = path.resolve(arg('frames', path.join(ROOT, 'docs', 'screens', 'promo')))
/** The reference's card: from its first frame to the cut (measured with ffmpeg's scene detection, 25 fps). */
const CARD_AT = 84.6
const CARD_S = 9.72
const W = 1920
const H = 1080
const out = (s: string): void => void process.stdout.write(s + '\n')
let failed = 0
const check = (name: string, ok: boolean, detail: string): void => {
  if (!ok) failed++
  out(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

const media = systemMediaService({ platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' })
if (!media) {
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run engine:promo-demo ».`)
  process.exit(1)
}
if (!existsSync(REF)) {
  out(`La vidéo de référence est introuvable (${REF}) : donne-la avec --ref <fichier>.`)
  process.exit(1)
}
const signal = new AbortController().signal
mkdirSync(path.join(OUT, 'assets'), { recursive: true })
mkdirSync(SCREENS, { recursive: true })

/** One frame of a video at `t` seconds, as raw RGB. */
async function rgbAt(file: string, t: number, w = W, h = H): Promise<Buffer> {
  const r = await media!.run('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { signal })
  if (r.stdout.length !== w * h * 3) throw new Error(`frame at ${t} s of ${file}: ${r.stdout.length} bytes`)
  return r.stdout
}

// ---- 1. the book, cut out of the reference's own frames ------------------------------------------------------------------------------

const BOX = { x: 30, y: 40, w: 432, h: 626 }
async function cutOutBook(file: string): Promise<void> {
  const empty = await rgbAt(REF, CARD_AT + 0.02)
  const full = await rgbAt(REF, CARD_AT + 7.4)
  const rgba = new Uint8Array(BOX.w * BOX.h * 4)
  for (let y = 0; y < BOX.h; y++) {
    for (let x = 0; x < BOX.w; x++) {
      const i = ((BOX.y + y) * W + BOX.x + x) * 3
      const d = Math.max(...[0, 1, 2].map((c) => Math.abs((full[i + c] as number) - (empty[i + c] as number))))
      // the matte: the difference with the empty card (below 4 levels it is the video's noise), faded out at the box's edges
      const edge = Math.min(1, Math.min(x, BOX.w - 1 - x, y, BOX.h - 1 - y) / 10)
      const a = Math.min(1, Math.max(0, (d - 4) / 22)) * edge
      const o = (y * BOX.w + x) * 4
      for (let c = 0; c < 3; c++) {
        // the colour under the matte: what the frame shows minus the share of the background that shows through
        const fg = a > 0.02 ? ((full[i + c] as number) - (1 - a) * (empty[i + c] as number)) / a : (full[i + c] as number)
        rgba[o + c] = Math.round(Math.max(0, Math.min(255, fg)))
      }
      rgba[o + 3] = Math.round(a * 255)
    }
  }
  writeFileSync(file, encodePng({ width: BOX.w, height: BOX.h, rgba }))
}
const book = path.join(OUT, 'assets', 'livre.png')
await cutOutBook(book)
out(`book cut out of the reference: ${book}`)

// ---- 2. the promo rebuilt ------------------------------------------------------------------------------------------------------------

/** Charlie's promo as a card (the same text, colours from the reference, the book cut out above). */
const CARD = PromoCard.parse({
  headline: 'Tout le cahier, au même endroit',
  subline: 'Le Cahier d’Gaston · par Gaston Martin, compagnon charpentier',
  site: 'exemple-compagnon.fr',
  link: 'https://exemple-compagnon.fr/yt',
  visual: { kind: 'product', image: book },
  seconds: CARD_S
})
const browser = chromiumService()
const frames = Math.round(CARD_S * 30)
const cacheDir = path.join(OUT, 'cache')
rmSync(cacheDir, { recursive: true, force: true })
mkdirSync(cacheDir, { recursive: true })
const t0 = Date.now()
const drawn = await drawPromo({ card: CARD, libraryRoot: path.join(ROOT, 'resources'), browser, media, width: W, height: H, frames, cacheDir, signal })
const ours = path.join(OUT, 'promo-recree.mp4')
rmSync(ours, { force: true })
writeFileSync(ours, await import('node:fs/promises').then((f) => f.readFile(drawn.file)))
const info = await probe(media, ours, signal, true)
const v = info.streams.find((s) => s.codec_type === 'video')
out(`rebuilt promo: ${ours} (${((Date.now() - t0) / 1000).toFixed(1)} s to draw)`)
check('drawn at 1080p, 30 fps, as long as the reference’s card', v?.width === W && v?.height === H && v?.r_frame_rate === '30/1' && Math.abs(info.durationS - CARD_S) < 0.05, `${v?.width}×${v?.height} ${v?.r_frame_rate} ${info.durationS.toFixed(2)} s, ${v?.nb_read_frames} frames`)
const again = await drawPromo({ card: CARD, libraryRoot: path.join(ROOT, 'resources'), browser, media, width: W, height: H, frames, cacheDir, signal })
check('the same card is drawn once (cache)', again.cached && again.file === drawn.file, again.file)

// ---- 3. frame by frame against the reference ----------------------------------------------------------------------------------------

const PIECES: Record<string, [number, number, number, number]> = {
  book: [30, 40, 462, 666],
  headline: [575, 140, 1260, 320],
  subline: [575, 350, 1300, 445],
  qr: [1395, 70, 1880, 555],
  qrCaption: [1395, 590, 1875, 725],
  site: [40, 790, 1120, 910],
  linkLine: [50, 925, 985, 985]
}
const lum = (b: Buffer, i: number): number => ((b[i] as number) + (b[i + 1] as number) + (b[i + 2] as number)) / 3
/** Mean difference of two frames over a piece (levels, 0–255), in luminance. */
const diff = (a: Buffer, b: Buffer, [x0, y0, x1, y1]: [number, number, number, number]): number => {
  let s = 0
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) s += Math.abs(lum(a, (y * W + x) * 3) - lum(b, (y * W + x) * 3))
  return s / (((y1 - y0) / 2) * ((x1 - x0) / 2))
}
const refAt = (t: number): Promise<Buffer> => rgbAt(REF, CARD_AT + t)
const oursAt = (t: number): Promise<Buffer> => rgbAt(ours, t)
const [refEmpty, refHeld, ourEmpty, ourHeld] = await Promise.all([refAt(0.02), refAt(7.4), oursAt(0.02), oursAt(7.4)])
/** How far a piece has come in (0 = not there, 1 = as on the held card): 1 − its distance to the held card over the empty one's. */
const progressOf = (f: Buffer, empty: Buffer, held: Buffer, box: [number, number, number, number]): number => 1 - diff(f, held, box) / Math.max(1e-6, diff(empty, held, box))
const times = Array.from({ length: 46 }, (_, i) => Math.round(i * 0.08 * 100) / 100)
const lag: Record<string, number[]> = Object.fromEntries(Object.keys(PIECES).map((k) => [k, []]))
out('\nentrances (reference / ours, 0 = not there, 1 = in place):')
out(`  t     ${Object.keys(PIECES).map((k) => k.padStart(11)).join(' ')}`)
for (const t of times) {
  const [r, o] = await Promise.all([refAt(t), oursAt(t)])
  const row = Object.entries(PIECES).map(([k, box]) => {
    const pr = Math.max(0, Math.min(1, progressOf(r, refEmpty, refHeld, box)))
    const po = Math.max(0, Math.min(1, progressOf(o, ourEmpty, ourHeld, box)))
    lag[k]?.push(Math.abs(pr - po))
    return `${pr.toFixed(2)}/${po.toFixed(2)}`.padStart(11)
  })
  out(`  ${t.toFixed(2)}  ${row.join(' ')}`)
}
const worst = Object.entries(lag).map(([k, l]) => [k, Math.max(...l), l.reduce((a, b) => a + b, 0) / l.length] as const)
out(`\nentrance gap per piece (max / mean over 0–3.6 s): ${worst.map(([k, m, a]) => `${k} ${m.toFixed(2)}/${a.toFixed(2)}`).join(', ')}`)
check('every piece comes in when the reference’s does (mean gap ≤ 0.08 of its entrance)', worst.every(([, , a]) => a <= 0.08), worst.map(([k, , a]) => `${k} ${a.toFixed(3)}`).join(', '))
const held = Object.entries(PIECES).map(([k, box]) => [k, diff(refHeld, ourHeld, box)] as const)
// the QR code's modules are its own pattern (same link, another encoder's mask): the frame is compared without that square
const QR_MODULES: [number, number, number, number] = [1436, 112, 1838, 514]
const area = (b: [number, number, number, number]): number => (b[2] - b[0]) * (b[3] - b[1])
const whole = (diff(refHeld, ourHeld, [0, 0, W, H]) * area([0, 0, W, H]) - diff(refHeld, ourHeld, QR_MODULES) * area(QR_MODULES)) / (area([0, 0, W, H]) - area(QR_MODULES))
const bg = diff(refEmpty, ourEmpty, [0, 0, W, H])
out(`held card, mean difference (levels of 255): ${held.map(([k, d]) => `${k} ${d.toFixed(1)}`).join(', ')}; whole frame without the QR modules ${whole.toFixed(1)}; empty background ${bg.toFixed(1)}`)
check('the background light: the empty card within 4 levels of the reference', bg <= 4, `${bg.toFixed(1)}`)
check('the held card: the frame (but the QR modules) within 10 levels of the reference on average', whole <= 10, `${whole.toFixed(1)}`)
/** The box of a piece's bright pixels (its text, its card) in a frame. */
const inkBox = (f: Buffer, [x0, y0, x1, y1]: [number, number, number, number], min: number): [number, number, number, number] => {
  let [a, b, c, d] = [x1, y1, x0, y0]
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (lum(f, (y * W + x) * 3) > min) [a, b, c, d] = [Math.min(a, x), Math.min(b, y), Math.max(c, x), Math.max(d, y)]
  return [a, b, c, d]
}
const LAYOUT: [string, [number, number, number, number], number][] = [
  ['headline', [560, 120, 1340, 340], 170],
  ['qr card', [1300, 40, 1910, 580], 235],
  ['qr caption', [1380, 570, 1900, 760], 170],
  ['site', [20, 760, 1300, 935], 140],
  ['link line', [20, 915, 1100, 1000], 160]
]
const placed = LAYOUT.map(([k, box, min]) => {
  const r = inkBox(refHeld, box, min)
  const o = inkBox(ourHeld, box, min)
  return [k, Math.max(...r.map((v, i) => Math.abs(v - (o[i] as number)))), r, o] as const
})
out(`layout (left, top, right, bottom of each piece's ink, reference → ours): ${placed.map(([k, , r, o]) => `${k} ${r.join(',')} → ${o.join(',')}`).join('; ')}`)
check('every piece sits where the reference’s does (each edge within 18 px)', placed.every(([, e]) => e <= 18), placed.map(([k, e]) => `${k} ${e} px`).join(', '))

// the QR code read back from our frame
const png = path.join(OUT, 'ours-held.png')
await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', '7.4', '-i', ours, '-frames:v', '1', png], { signal })
const quirc = await media.run('ffmpeg', ['-v', 'info', '-i', png, '-vf', 'format=gray,quirc', '-f', 'null', '-'], { signal }).catch((e: unknown) => ({ stderr: String(e), stdout: Buffer.alloc(0) }))
check('the QR code of the rebuilt promo opens the reference’s link', quirc.stderr.includes('payload: https://exemple-compagnon.fr/yt'), /payload: \S+/.exec(quirc.stderr)?.[0] ?? 'not read (no quirc filter?)')

// side-by-side pictures: the reference on the left, ours on the right, at the moments that show each entrance
const MOMENTS: [string, number][] = [
  ['01-livre', PROMO_TIMELINE.visual.at + 0.4],
  ['02-titre', PROMO_TIMELINE.headline.at + 0.3],
  ['03-url', PROMO_TIMELINE.site.at + 0.3],
  ['04-qr', PROMO_TIMELINE.qr.at + 0.32],
  ['05-legende', PROMO_TIMELINE.qrCaption.at + 0.25],
  ['06-carte', 7.4]
]
for (const [name, t] of MOMENTS) {
  await media.run(
    'ffmpeg',
    ['-v', 'error', '-y', '-ss', (CARD_AT + t).toFixed(3), '-i', REF, '-ss', t.toFixed(3), '-i', ours, '-filter_complex', '[0:v]scale=800:-2[a];[1:v]scale=800:-2[b];[a][b]hstack=inputs=2,pad=iw+0:ih+0', '-frames:v', '1', path.join(SCREENS, `compare-${name}.png`)],
    { signal }
  )
}
out(`side-by-side pictures: ${SCREENS}${path.sep}compare-*.png`)
const film = path.join(OUT, 'compare-cote-a-cote.mp4')
await media.run(
  'ffmpeg',
  ['-v', 'error', '-y', '-ss', CARD_AT.toFixed(3), '-t', CARD_S.toFixed(3), '-i', REF, '-i', ours, '-filter_complex', '[0:v]fps=30,scale=960:-2,setpts=PTS-STARTPTS[a];[1:v]scale=960:-2[b];[a][b]hstack=inputs=2', '-map', '0:a?', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', film],
  { signal }
)
out(`side-by-side film: ${film}`)

// ---- 4. the promo as the channel's input, in a 2-minute film -------------------------------------------------------------------------

if (!process.argv.includes('--skip-film')) {
  const dataDir = path.join(os.tmpdir(), 'atelier-promo-demo')
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  mkdirSync(dataDir, { recursive: true })
  const asset = [
    'type : promo',
    'nom : Le Cahier d’Gaston',
    'lien : https://exemple-compagnon.fr/yt',
    'titre : Tout le cahier, au même endroit',
    'sous-titre : Le Cahier d’Gaston · par Gaston Martin, compagnon charpentier',
    'site : exemple-compagnon.fr',
    `image : ${book}`,
    "place : après l'accroche",
    'moment : 1:25',
    'mode : identique'
  ].join('\n')
  out(`\nthe channel's promo asset:\n${asset.replace(/^/gmu, '    ')}`)
  const r = await runAvatarBaseDemo({
    dataDir,
    resourcesDir: path.join(ROOT, 'resources'),
    topic: 'Le mur noir de la chambre du fond',
    minutes: 2,
    sponsor: asset,
    styles: Object.fromEntries(BASE_STYLES.map((s) => [s.id, s])),
    onEvent: (e) => {
      if (e.kind === 'error') out(`  ✗ ${e.nodeId}: ${e.message}`)
    }
  })
  check('the 2-minute film on the avatar@1 fakes is made', r.status === 'done' && r.video !== null, `${r.status} in ${(r.ms / 1000).toFixed(0)} s ${JSON.stringify(r.errors).slice(0, 300)}`)
  if (r.video) {
    const fi = await probe(media, r.video, signal, true)
    const meta = r.sponsor.meta as { screen?: string; promo?: { mode: string; place: string; reused: boolean }; windows?: { startS: number; endS: number; anchor: string }[] }
    const w = meta.windows?.[0]
    out(`film: ${r.video} (${fi.durationS.toFixed(1)} s); promo slot ${w ? `${w.startS.toFixed(2)}–${w.endS.toFixed(2)} s « ${w.anchor} »` : 'none'}; ${JSON.stringify(meta.promo)}`)
    check('about 2 minutes', fi.durationS >= 100 && fi.durationS <= 150, `${fi.durationS.toFixed(1)} s`)
    check('the promo is drawn by our bricks, the same clip as above', meta.screen === 'motion' && meta.promo?.mode === 'same' && (r.sponsor.files[0] ?? '').endsWith(path.basename(drawn.file)), `${meta.screen} ${r.sponsor.files[0] ?? ''}`)
    check('it starts after the hook, about 1:25 (the paragraph break nearest to it, within 15 s)', w !== undefined && Math.abs(w.startS - 85) <= 15, w ? `${w.startS.toFixed(1)} s` : 'no slot')
    if (w) {
      // the film at 5 s into the slot is our clip at 5 s (only the encoding differs)
      const [inFilm, inClip] = await Promise.all([rgbAt(r.video, w.startS + 5), oursAt(5)])
      const d = diff(inFilm, inClip, [0, 0, W, H])
      check('the film shows the promo in its slot', d <= 6, `${d.toFixed(1)} levels from the clip`)
      for (const [name, t] of [['film-avant', w.startS - 1.5], ['film-promo', w.startS + 5], ['film-apres', w.endS + 1.5]] as const) {
        await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', r.video, '-frames:v', '1', '-vf', 'scale=960:-2', path.join(SCREENS, `${name}.png`)], { signal })
      }
      const copy = path.join(OUT, 'film-2min-promo.mp4')
      writeFileSync(copy, await import('node:fs/promises').then((f) => f.readFile(r.video as string)))
      out(`film copied to ${copy}; frames ${SCREENS}${path.sep}film-*.png`)
    }
  }
}

await browser.close?.()
out(failed === 0 ? '\nALL PASS' : `\n${failed} check(s) FAILED`)
process.exit(failed === 0 ? 0 : 1)
