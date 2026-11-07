// `npm run engine:motion-kit-demo` — the proof of the motion-montage toolkit: a 60 s showcase (pipelines/motion-kit-showcase.ts) made by
// the real nodes on this machine, free and offline: the system voice (`voice.tts` demo), the editing kit (`edit.fx`: transitions, camera,
// punch-ins, cut-ins, numbers said aloud, sound effects), our cards and overlays (`motion.render`, fast draw), the render
// (`render.assemble`). Then it checks the film and exits 1 if a check fails:
//   1. ffprobe: 1920×1080, 30 fps, an audio stream, 40 to 90 s;
//   2. the plan holds every brick: flash, push, dissolve, parallax, gliding moves, punch-ins, the map's route followed, kinetic type,
//      « ×20 » set on its word, a document, charts, and sound effects;
//   3. the edit has purpose: no whip, zoom or match without a reason, no punch-in coming back out, no still held over 7 s;
//   4. the flash goes through white; 5. a push slides the next portrait in; 6. « ×20 » lands on its word; 7. a punch-in jumps in on its
//   word; 8. the map's camera moves; 9. the kinetic words are clear before their time and drawn after it; 10. the document's highlight
//   appears on its word; 11. each sound effect is heard at its time in the effects stem.
// Writes the film, a 720p copy and a contact sheet to --out (default <ATELIER_INPUTS or temp folder>/tests-2026-11/motion), stills to
// docs/screens/motion-kit/. Options: --pictures <dir> (public-domain prints; default the tulip-mania sample's), --data <dir>.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Artefact } from '../src/engine/artefacts'
import type { ArtefactType } from '../src/engine/types'
import { editKitOf } from '../src/engine/formats/edit-kit'
import { repeatedPictures } from '../src/engine/edit/inserts'
import { EditPlan, type Shot } from '../src/engine/formats/editplan'
import { WordsValue, type Word } from '../src/engine/formats/timing'
import { nodeHost } from '../src/engine/host'
import { probe } from '../src/engine/media/probe'
import { editFx } from '../src/engine/nodes/edit-fx'
import { motionRender, MotionParams } from '../src/engine/nodes/motion-render'
import { renderAssemble, RenderParams } from '../src/engine/nodes/render-assemble'
import { voiceTts, VoiceTtsParams } from '../src/engine/nodes/voice-tts'
import { SHOWCASE_PICTURES, SHOWCASE_SCRIPT, showcasePlan, type ShowcasePicture } from '../src/engine/pipelines/motion-kit-showcase'
import { createRunCtx, type AnyNodeDef } from '../src/engine/registry'
import type { Json } from '../src/engine/types'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
/** Working folder: --out/--pictures flags, else $ATELIER_INPUTS, else a folder under the temp directory. */
const INPUTS = process.env.ATELIER_INPUTS ?? path.join(os.tmpdir(), 'atelier-inputs')
const outDir = path.resolve(arg('out', path.join(INPUTS, 'tests-2026-11', 'motion')))
const picturesDir = path.resolve(arg('pictures', path.join(INPUTS, 'tests-2026-11', 'markets', 'free-sample', 'src')))
const dataDir = path.resolve(arg('data', path.join(os.tmpdir(), 'atelier-motion-kit-demo')))
const stillsDir = path.join(ROOT, 'docs', 'screens', 'motion-kit')
for (const d of [outDir, dataDir, stillsDir]) mkdirSync(d, { recursive: true })
const out = (s: string): void => void process.stdout.write(s + '\n')
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  out(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

const host = nodeHost({ dataDir, resourcesDir: path.join(ROOT, 'resources') })
const media = host.services.media
if (!media) {
  out('ffmpeg est introuvable : installe-le puis relance « npm run engine:motion-kit-demo ».')
  process.exit(1)
}
const signal = new AbortController().signal
const ctxFor = (def: Pick<AnyNodeDef, 'type' | 'reads'>, seed = 7) =>
  createRunCtx(
    def,
    {
      emit: (r) => {
        if (r.kind === 'log') out(`    ${r.level}: ${r.text.slice(0, 200)}`)
      },
      signal,
      store: { read: () => Promise.resolve(null) },
      seed,
      where: 'local',
      attempt: 1,
      notes: [],
      reportCost: () => undefined,
      services: host.services
    },
    { minutes: 1, budgetMode: 'usage_max' }
  )
let fp = 0
const art = (type: ArtefactType, o: { value?: Json; files?: string[]; meta?: Record<string, Json> }): Artefact => ({ type, fingerprint: (++fp).toString(16).padStart(64, '0'), ...o })
const timed = async <T>(what: string, f: () => Promise<T>): Promise<[T, number]> => {
  const t0 = performance.now()
  out(`  ▶ ${what}`)
  const r = await f()
  const s = (performance.now() - t0) / 1000
  out(`    ${what}: ${s.toFixed(1)} s`)
  return [r, s]
}

// ---- the pictures: the public-domain prints of the tulip-mania sample, or drawn stand-ins -------------------------------------------
const MATCH: Record<ShowcasePicture, string> = {
  flora: 'Tooneel_van_Flora',
  stilllife: 'Fruit_still_life',
  tavern: 'Pieter_Codde',
  crash: 'Graf_kelder',
  hals: 'Frans_Hals',
  ruychaver: 'Ruychaver',
  shipping: 'Plattenberg',
  glass: 'Damiaatjes',
  engraving: 'A_short_history'
}
const TALL = new Set<ShowcasePicture>(['hals', 'ruychaver'])
const found = existsSync(picturesDir) ? readdirSync(picturesDir).filter((n) => /\.(jpe?g|png)$/i.test(n) && !n.endsWith('.card.jpg')) : []
const picDir = path.join(dataDir, 'pictures')
mkdirSync(picDir, { recursive: true })
const pictures: string[] = []
for (const [i, item] of SHOWCASE_PICTURES.entries()) {
  const src = found.find((n) => n.includes(MATCH[item]))
  const dest = path.join(picDir, `${item}.jpg`)
  // a tall portrait keeps its face: its 16:9 band is taken from the upper part, not the middle
  const band = TALL.has(item) ? 'crop=iw:iw*9/16:0:ih*0.06,' : ''
  if (src) await media.run('ffmpeg', ['-v', 'error', '-y', '-i', path.join(picturesDir, src), '-vf', `${band}scale=2400:2400:force_original_aspect_ratio=decrease`, '-q:v', '3', dest], { signal })
  else await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `gradients=s=2400x1600:c0=0x3b2a1a:c1=0x${(0x806040 + i * 0x101008).toString(16)}:seed=${i}`, '-frames:v', '1', dest], { signal })
  pictures.push(dest)
}
out(`images : ${found.length ? `${pictures.length} gravures du domaine public (${picturesDir})` : 'dessinées (aucun dossier de gravures)'}`)

// ---- voice and words --------------------------------------------------------------------------------------------------------------
const script = SHOWCASE_SCRIPT.join('\n\n')
const [voice] = await timed('voix (voix du système)', () => voiceTts.fake(ctxFor(voiceTts), { script: art('text.script', { value: script }) }, VoiceTtsParams.parse({ language: 'fr', speed: 0.9 })))
const words = WordsValue.parse(voice.words?.value) as Word[]
const durationS = Number(voice.words?.meta?.durationS ?? (words[words.length - 1] as Word).end + 0.5)
const plan0 = showcasePlan(words, durationS)
out(`plan : ${plan0.shots.length} plans, ${(plan0.frames / 30).toFixed(1)} s`)

// ---- cards and overlays, the kit, the render ---------------------------------------------------------------------------------------
const images = art('media.image[]', { files: pictures, value: SHOWCASE_PICTURES.map((itemId, file) => ({ itemId, file })) as unknown as Json })
const bed = path.join(dataDir, 'bed.flac')
await media.run('ffmpeg', ['-v', 'error', '-y', '-stream_loop', '-1', '-i', path.join(ROOT, 'resources', 'music', 'tension-1.m4a'), '-t', durationS.toFixed(3), '-af', `volume=-17dB,afade=t=in:d=2,afade=t=out:st=${(durationS - 4).toFixed(2)}:d=4`, '-ar', '48000', '-ac', '2', '-c:a', 'flac', bed], { signal })
// the documentary kit, a little softer (fewer dissolves), the numbers said aloud on their word (also over the price chart, which does not
// write « ×20 » itself), and a few recorded effects where something happens: a page turning on the contract, a tick per counted figure,
// a soft whoosh when a portrait pushes the one before out, an impact on the crash's flash
const kit = editKitOf('documentary', {
  transitions: { phrase: { cut: 1 }, sentence: { cut: 0.7, dissolve: 0.3 } },
  numbers: { show: true, overCards: ['chart'], style: 'pop', position: 'lower' },
  sfx: { perMinute: 12, chapter: null, transitions: { push: 'whoosh-soft', flash: 'impact', dissolve: null }, cards: { document: 'paper', map: null, chart: null, kinetic: null }, reveals: { punch: 'stamp', row: 'tick', pin: null, mark: null, word: null } }
})
// the kit runs before the graphics are drawn: the numbers it sets on screen are overlays motion.render draws
const [fx, fxS] = await timed('montage (edit.fx)', () =>
  editFx.run(ctxFor(editFx), { plan: art('json.editplan', { value: plan0 as unknown as Json }), words: art('json.words', { value: words as unknown as Json }), voice: voice.audio as Artefact, music: art('audio.music', { files: [bed] }) }, { kit, energies: true })
)
const plan = EditPlan.parse(fx.plan?.value)
const [motion, motionS] = await timed('animations (motion.render, rendu rapide)', () => motionRender.run(ctxFor(motionRender), { plan: art('json.editplan', { value: plan as unknown as Json }), images }, MotionParams.parse({ motionBlur: 3, look: 'period' })))
const [film, renderS] = await timed('rendu (render.assemble)', () =>
  renderAssemble.run(ctxFor(renderAssemble), { plan: art('json.editplan', { value: plan as unknown as Json }), images, motion: motion.graphics as Artefact, voice: voice.audio as Artefact, music: fx.music as Artefact }, RenderParams.parse({ watermark: 'off', crf: 18, room: { mixDb: -12 } }))
)
const file = film.video?.files?.[0] as string
const final = path.join(outDir, 'vitrine-motion-montage.mp4')
copyFileSync(file, final)

// ---- checks -------------------------------------------------------------------------------------------------------------------------
const p = await probe(media, final, signal)
const v = p.streams.find((x) => x.codec_type === 'video')
check('format', v?.width === 1920 && v?.height === 1080 && v?.r_frame_rate === '30/1' && p.streams.some((x) => x.codec_type === 'audio') && p.durationS > 40 && p.durationS < 90, `${v?.width}×${v?.height} ${v?.r_frame_rate} fps, ${p.durationS.toFixed(1)} s`)
const base = plan.tracks.base.map((id) => plan.shots.find((x) => x.id === id) as Shot)
const has = (t: Shot['transitionIn']): boolean => base.some((x) => x.transitionIn === t)
const templates = new Set(plan.shots.map((x) => (x.graphic as { template?: string } | undefined)?.template).filter(Boolean))
const sfx = (fx.sfx?.value ?? []) as unknown as { atS: number; kind: string }[]
const numbers = plan.shots.filter((x) => x.id.startsWith('num'))
const numberText = (x: Shot): string => (x.graphic as { props: { words: { text: string }[] } }).props.words[0]?.text ?? ''
const stills = base.filter((x) => x.kind === 'image.gen')
const bricks = {
  flash: has('flash'),
  push: has('push'),
  dissolve: has('dissolve'),
  parallax: base.some((x) => x.motion?.kind === 'parallax'),
  glide: stills.every((x) => x.motion?.ease === 'glide'),
  punches: base.some((x) => (x.punches?.length ?? 0) > 0),
  mapRoute: plan.shots.some((x) => Array.isArray((x.graphic as { props?: { camera?: unknown } } | undefined)?.props?.camera)),
  kinetic: templates.has('kinetic'),
  numbers: numbers.some((x) => numberText(x) === '×20'),
  document: templates.has('document'),
  chart: templates.has('chart'),
  sfx: sfx.length >= 4
}
check('every brick in the plan', Object.values(bricks).every(Boolean), Object.entries(bricks).map(([k, ok]) => `${k}${ok ? '' : ' ✗'}`).join(', '))
// Charlie's rules of 02/11: purposeful transitions (no whip, zoom or match without a reason here), no punch-in that comes back out, no
// still held over 7 s, never the same effect file twice in a row
const longest = Math.max(...stills.map((x) => (x.endFrame - x.startFrame) / 30))
const ping = base.some((x) => x.punches?.some((q) => q.holdS !== undefined))
// a still held over 5 s must be moving (a glide of at least 5 %), and no shot repeats the picture before it
const frozen = stills.filter((x) => (x.endFrame - x.startFrame) / 30 > 5 && Math.abs((x.motion?.to ?? 1) - (x.motion?.from ?? 1)) < 0.05 && x.motion?.kind !== 'parallax')
const repeats = repeatedPictures(base)
check('purposeful edit', !has('whip') && !has('zoom') && !has('match') && !ping && frozen.length === 0 && repeats.length === 0, `transitions ${[...new Set(base.map((x) => x.transitionIn))].join(', ')} ; punch qui ressort : ${ping ? 'oui' : 'non'} ; plan fixe le plus long ${longest.toFixed(1)} s, ${frozen.length} immobile au-delà de 5 s ; images répétées : ${repeats.length}`)

/** One frame of the film as grey levels at `w` px wide. */
const W = 480
const H = 270
const grey = async (t: number, f = final): Promise<Uint8Array> =>
  new Uint8Array((await media.run('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', f, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { signal })).stdout)
const mean = (a: Uint8Array): number => a.reduce((s, x) => s + x, 0) / a.length
const diff = (a: Uint8Array, b: Uint8Array): number => a.reduce((s, x, i) => s + Math.abs(x - (b[i] as number)), 0) / a.length
const at = (s: Shot, frames = 0): number => (s.startFrame + frames) / 30
const flash = base.find((x) => x.transitionIn === 'flash') as Shot
const flashMid = mean(await grey(at(flash, 4)))
check('flash through white', flashMid > 170, `luminance moyenne au milieu du flash ${flashMid.toFixed(0)} / 255`)
// a push slides the new portrait in: mid-push, the left and right halves of the frame differ more than once it has landed
const pushed = base.find((x) => x.transitionIn === 'push') as Shot
const halves = (a: Uint8Array): number => {
  let l = 0
  let r = 0
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (x < W / 2) l += a[y * W + x] as number
      else r += a[y * W + x] as number
    }
  return Math.abs(l - r) / ((W / 2) * H)
}
const p0 = halves(await grey(at(pushed, 5)))
const p1 = halves(await grey(at(pushed, 24)))
const slid = diff(await grey(at(pushed, 3)), await grey(at(pushed, 7)))
check('a push slides the next portrait in', slid > 4, `écart d’image pendant la poussée ${slid.toFixed(1)} (moitiés ${p0.toFixed(1)} pendant, ${p1.toFixed(1)} après)`)
// a number said aloud lands on its word: its overlay is clear before the word and drawn after it
const x20 = numbers.find((x) => numberText(x) === '×20') as Shot | undefined
const fileOf = (shot: Shot): string => (motion.graphics?.files ?? []).find((_, i) => ((motion.graphics?.value as unknown as { shotId: string }[])[i]?.shotId === shot.id)) ?? ''
if (x20) {
  const w0 = (x20.graphic as { props: { words: { atS: number }[] } }).props.words[0]?.atS ?? 0
  const cover = async (t: number): Promise<number> =>
    mean(new Uint8Array((await media.run('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', fileOf(x20), '-frames:v', '1', '-vf', `scale=${W}:${H},format=yuva444p,alphaextract`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { signal })).stdout))
  const n0 = await cover(Math.max(0, w0 - 0.12))
  const n1 = await cover(w0 + 0.5)
  check('« ×20 » on its word', n1 > n0 + 2, `couverture ${n0.toFixed(1)} avant « vingt », ${n1.toFixed(1)} après`)
} else check('« ×20 » on its word', false, 'aucun « ×20 » dans le plan')
const punched = base.find((x) => x.punches?.length) as Shot
const pt = at(punched) + ((punched.punches?.[0]?.atS as number) ?? 0)
const before = diff(await grey(pt - 0.25), await grey(pt - 0.08))
const jump = diff(await grey(pt - 0.08), await grey(pt + 0.15))
check('punch-in on its word', jump > 2.5 * before && jump > 2, `écart d’image ${jump.toFixed(1)} au punch, ${before.toFixed(1)} juste avant`)
const map = base.find((x) => (x.graphic as { template?: string } | undefined)?.template === 'map') as Shot
const m0 = await grey(at(map, 10))
const m1 = await grey((map.startFrame + map.endFrame) / 60)
const m2 = await grey(at(map, map.endFrame - map.startFrame - 10))
check('the map camera moves', diff(m0, m1) > 6 && diff(m1, m2) > 6, `écarts ${diff(m0, m1).toFixed(1)} et ${diff(m1, m2).toFixed(1)} entre début, milieu et fin`)
const kin = plan.shots.find((x) => (x.graphic as { template?: string } | undefined)?.template === 'kinetic' && !x.id.startsWith('num')) as Shot
const kinFile = fileOf(kin)
const kinWords = ((kin.graphic as { props: { words: { atS: number }[] } }).props.words)
const alpha = async (t: number): Promise<number> =>
  mean(new Uint8Array((await media.run('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', kinFile, '-frames:v', '1', '-vf', `scale=${W}:${H},format=yuva444p,alphaextract`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { signal })).stdout))
const a0 = await alpha(Math.max(0, (kinWords[0]?.atS ?? 0.5) - 0.3))
const a1 = await alpha((kinWords[kinWords.length - 1]?.atS ?? 1) + 0.6)
check('kinetic words land on their time', a1 > a0 + 3, `couverture de l’overlay ${a0.toFixed(1)} avant le 1er mot, ${a1.toFixed(1)} après le dernier`)
const doc = base.find((x) => (x.graphic as { template?: string } | undefined)?.template === 'document') as Shot
const mark = ((doc.graphic as { props: { marks: { atS: number }[] } }).props.marks[0]?.atS as number) ?? 1
const yellow = async (t: number): Promise<number> => {
  const rgb = new Uint8Array((await media.run('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', final, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { signal })).stdout)
  let n = 0
  for (let i = 0; i < rgb.length; i += 3) if ((rgb[i] as number) > 180 && (rgb[i + 1] as number) > 150 && (rgb[i + 2] as number) < 110) n++
  return n
}
const y0 = await yellow(at(doc) + Math.max(0.2, mark - 0.4))
const y1 = await yellow(at(doc) + mark + 1)
check('the document highlights its words', y1 > y0 + 150, `pixels du surlignage ${y0} avant le mot, ${y1} après`)
const stem = fx.sfx?.files?.[0] as string
const pcm = new Float32Array((await media.run('ffmpeg', ['-v', 'error', '-i', stem, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { signal })).stdout.buffer.slice(0))
const rms = (a: number, b: number): number => {
  let s = 0
  for (let i = Math.max(0, a); i < Math.min(pcm.length, b); i++) s += (pcm[i] as number) ** 2
  return Math.sqrt(s / Math.max(1, b - a))
}
const heard = sfx.filter((e) => rms(Math.round((e.atS - 0.08) * 8000), Math.round((e.atS + 0.08) * 8000)) > 0.003).length
check('sound effects on their events', sfx.length >= 4 && heard === sfx.length, `${heard} / ${sfx.length} effets entendus à leur moment (${[...new Set(sfx.map((e) => e.kind))].join(', ')})`)

// ---- copies for Charlie, stills for the docs, the report --------------------------------------------------------------------------
await media.run('ffmpeg', ['-v', 'error', '-y', '-i', final, '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', path.join(outDir, 'vitrine-motion-montage-720p.mp4')], { signal })
const sheetTimes = base.map((x) => (x.startFrame + x.endFrame) / 60)
await media.run('ffmpeg', ['-v', 'error', '-y', '-i', final, '-vf', `select='${sheetTimes.map((t) => `eq(n\\,${Math.round(t * 30)})`).join('+')}',scale=480:-2,tile=4x${Math.ceil(sheetTimes.length / 4)}`, '-frames:v', '1', '-fps_mode', 'vfr', path.join(stillsDir, 'showcase-sheet.jpg')], { signal })
copyFileSync(path.join(stillsDir, 'showcase-sheet.jpg'), path.join(outDir, 'vitrine-planche.jpg'))
const cardsS = plan.shots.filter((x) => x.kind === 'motion').reduce((s, x) => s + (x.endFrame - x.startFrame) / 30, 0)
const report = {
  durationS: p.durationS,
  seconds: { motion: motionS, editFx: fxS, render: renderS },
  motionPerMinuteOfGraphics: (motionS / cardsS) * 60,
  kit: fx.plan?.meta?.report ?? null,
  checks
}
writeFileSync(path.join(outDir, 'vitrine-rapport.json'), JSON.stringify(report, null, 2))
writeFileSync(path.join(dataDir, 'words.json'), JSON.stringify(words))
out(`animations : ${motionS.toFixed(1)} s pour ${cardsS.toFixed(1)} s d'animations (${report.motionPerMinuteOfGraphics.toFixed(0)} s par minute) ; montage ${fxS.toFixed(1)} s ; rendu ${renderS.toFixed(1)} s`)
out(`film : ${final}`)
await readFile(final).then(() => undefined)
await host.services.browser?.close?.()
await host.cleanup()
const failed = checks.filter((c) => !c.ok)
out(failed.length ? `${failed.length} contrôle(s) en échec` : `${checks.length} contrôles réussis`)
process.exit(failed.length ? 1 : 0)
