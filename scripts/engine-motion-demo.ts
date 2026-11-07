// `npm run engine:motion-demo` — the proof of animated overlays in the render (nodes `director.plan` with `motion`, `motion.render`,
// `render.assemble`): our engine makes two real films on this machine, free and offline (demo mode: template research, the given script, the
// system voice, drawn pictures and a gameplay sample; the director's choices, the templates, the headless browser that draws them, the
// render and the quality check are the real code). Then it checks, and exits 1 if any check fails:
//   A. a ~20 s 16:9 documentary:
//      1. ffprobe: 1920×1080, 30 fps, one audio stream, 14 to 28 s;
//      2. the director chose a title card, a counter and a lower third from the narration, on the overlay track, inside the film;
//      3. each overlay file is ProRes 4444 with an alpha channel, the frame's size, exactly as many frames as its shot;
//      4. the film shows each overlay exactly where its shot lies (pixel check against the overlay's own opaque pixels) and no more after it;
//      5. the captions stay on top: white caption pixels remain in the caption band under the title card's scrim;
//      6. the quality check ran and passed.
//   B. a ~15 s 9:16 conversation short (two characters from the voice's own turns, over a gameplay background):
//      7. ffprobe: 1080×1920, 30 fps, one audio stream, 10 to 24 s;
//      8. one conversation overlay whose bubbles are the script's turns, each timed by the first word of its line in the voice;
//      9. in the film, every bubble appears when its line starts (the chat window changes at that moment and stays quiet between two lines);
//     10. the quality check ran and passed.
// Options: --data <dir> (default <tmp>/atelier-motion-demo) --frames <dir> (default docs/screens/engine: motion-title.png, motion-counter.png,
// motion-lowerthird.png, motion-chat-1.png … motion-chat-3.png).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Shot } from '../src/engine/formats/editplan'
import type { ConversationProps } from '../src/engine/formats/motion'
import type { Word } from '../src/engine/formats/timing'
import { DRAW_FILTERS } from '../src/engine/media/draw'
import { DRAW_VIDEO_FILTERS } from '../src/engine/media/draw-video'
import { probe } from '../src/engine/media/probe'
import { FULL_FFMPEG_HINT, locateTool, RENDER_ENCODERS, RENDER_FILTERS, requireFilters, systemMediaService } from '../src/engine/media/tools'
import { findBrowser } from '../src/engine/media/browser'
import { CARD_FILTERS } from '../src/engine/nodes/card-intro'
import { runMotionDemo, type MotionDemoResult } from '../src/engine/pipelines/motion-demo'
import type { z } from 'zod'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const dataDir = path.resolve(arg('data', path.join(os.tmpdir(), 'atelier-motion-demo')))
const framesDir = path.resolve(arg('frames', path.join(ROOT, 'docs', 'screens', 'engine')))
const out = (s: string): void => void process.stdout.write(s + '\n')
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  out(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

const toolEnv = { platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' }
const media = systemMediaService(toolEnv)
if (!media) {
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run engine:motion-demo ».`)
  process.exit(1)
}
const signal = new AbortController().signal
out(`ffmpeg: ${locateTool('ffmpeg', toolEnv)}`)
const browserPath = findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })
out(`navigateur: ${browserPath ?? 'introuvable'}`)
if (!browserPath) {
  out('Aucun Chromium, Chrome ou Edge sur cet ordinateur : installe-en un (ou donne ATELIER_CHROMIUM) puis relance « npm run engine:motion-demo ».')
  process.exit(1)
}
try {
  await requireFilters(media, [...RENDER_FILTERS, ...RENDER_ENCODERS, ...DRAW_FILTERS, ...DRAW_VIDEO_FILTERS, ...CARD_FILTERS, 'prores_ks'], signal)
} catch (e) {
  out(`FAIL  ffmpeg complete — ${(e as Error).message}`)
  process.exit(1)
}

rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
mkdirSync(dataDir, { recursive: true })
mkdirSync(framesDir, { recursive: true })

/** One frame of a video as raw pixels (rgb24 or rgba) at `t` seconds. */
const raw = async (file: string, t: number, fmt: 'rgb24' | 'rgba'): Promise<Buffer> =>
  (await media.run('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-pix_fmt', fmt, '-f', 'rawvideo', '-'], { signal })).stdout
const png = async (file: string, t: number, name: string): Promise<void> => {
  await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=iw*0.5:-1', path.join(framesDir, name)], { signal })
}
const quiet = (e: { kind: string; nodeId?: string; message?: string }): void => {
  if (e.kind === 'start') out(`  ▶ ${e.nodeId}`)
  else if (e.kind === 'error') out(`  ✗ ${e.nodeId}: ${e.message}`)
}
const base = { resourcesDir: path.join(ROOT, 'resources'), onEvent: quiet as never }
const fps = 30
const motionShots = (r: MotionDemoResult): Shot[] => (r.plan?.shots ?? []).filter((s) => s.kind === 'motion')

// ===== A. the documentary ===================================================================================================================
out(`Atelier motion demo — data ${dataDir}\n\n— A. the documentary (16:9)`)
const film = await runMotionDemo({ ...base, kind: 'film', dataDir: path.join(dataDir, 'film') })
out(`\nrun: ${film.status} in ${(film.ms / 1000).toFixed(1)} s · ran: ${film.ran.join(', ')}`)
if (film.status !== 'done' || !film.video || !film.plan) {
  check('the documentary is made', false, `${film.status} ${JSON.stringify(film.errors)}`)
  process.exit(1)
}
out(`video: ${film.video}`)
const info = await probe(media, film.video, signal, true)
const v = info.streams.find((s) => s.codec_type === 'video')
const audio = info.streams.filter((s) => s.codec_type === 'audio')
out(`ffprobe: ${v?.width}×${v?.height} ${v?.codec_name} ${v?.pix_fmt} ${v?.r_frame_rate} fps, ${v?.nb_read_frames} frames, ${info.durationS.toFixed(3)} s; audio ${audio.map((a) => `${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch`).join(', ')}`)
check('1920×1080, 30 fps, one audio stream, 14 to 28 s', v?.width === 1920 && v?.height === 1080 && v?.r_frame_rate === '30/1' && audio.length === 1 && info.durationS >= 14 && info.durationS <= 28, `${v?.width}×${v?.height}, ${v?.r_frame_rate}, ${audio.length} audio, ${info.durationS.toFixed(2)} s`)

const shots = motionShots(film)
const which = (t: string): Shot | undefined => shots.find((s) => s.graphic?.template === t)
out('motion shots: ' + shots.map((s) => `${s.id} ${s.graphic?.template} ${(s.startFrame / fps).toFixed(2)}–${(s.endFrame / fps).toFixed(2)} s ${JSON.stringify(s.graphic?.props).slice(0, 110)}`).join('\n               '))
out('director: ' + (film.plan.diagnostics.filter((d) => d.startsWith('motion')).join(' | ') || '—'))
const title = which('title')
const figure = which('figure')
const lower = which('lower-third')
check(
  'the director chose a title card, a counter and a lower third, on the overlay track, inside the film',
  !!title && !!figure && !!lower && shots.every((s) => s.track === 'overlay' && film.plan!.tracks.overlay.includes(s.id) && s.startFrame >= 0 && s.endFrame <= film.plan!.frames),
  shots.map((s) => s.graphic?.template).join(', ')
)
if (!title || !figure || !lower) process.exit(1)

// 3. the files
const g = film.graphics
const infos = await Promise.all(g.files.map((f) => probe(media, f, signal, true)))
const fileFacts = infos.map((p, i) => {
  const s = p.streams.find((x) => x.codec_type === 'video')
  return { codec: s?.codec_name, pix: s?.pix_fmt, size: `${s?.width}×${s?.height}`, frames: Number(s?.nb_read_frames), want: (shots[i]?.endFrame ?? 0) - (shots[i]?.startFrame ?? 0) }
})
out('overlay files: ' + fileFacts.map((f, i) => `${shots[i]?.graphic?.template}: ${f.codec} ${f.pix} ${f.size} ${f.frames}/${f.want} frames`).join(' · '))
check(
  'each overlay file is ProRes 4444 with alpha, the frame’s size and its shot’s frame count',
  g.files.length === shots.length && fileFacts.every((f) => f.codec === 'prores' && /^yuva/.test(f.pix ?? '') && f.size === '1920×1080' && f.frames === f.want),
  `${g.files.length} files`
)

// 4. where the film shows each overlay: its opaque pixels (above the caption band) equal the film's pixels during the shot, not after it
const W = 1920
const H = 1080
const bandTop = Math.round(H * 0.78)
async function matchRatio(overlayFile: string, relS: number, filmAtS: number): Promise<number> {
  const [o, f] = await Promise.all([raw(overlayFile, relS, 'rgba'), raw(film.video as string, filmAtS, 'rgb24')])
  let n = 0
  let sum = 0
  for (let y = 0; y < bandTop; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = y * W + x
      if ((o[i * 4 + 3] as number) < 250) continue
      n++
      sum += (Math.abs((o[i * 4] as number) - (f[i * 3] as number)) + Math.abs((o[i * 4 + 1] as number) - (f[i * 3 + 1] as number)) + Math.abs((o[i * 4 + 2] as number) - (f[i * 3 + 2] as number))) / 3
    }
  }
  return n < 200 ? Number.NaN : sum / n
}
for (const [name, shot] of [['title', title], ['counter', figure], ['lower third', lower]] as const) {
  const i = shots.indexOf(shot)
  const len = (shot.endFrame - shot.startFrame) / fps
  const rel = Math.min(len - 0.7, 2.4)
  const t0 = shot.startFrame / fps
  const inside = await matchRatio(g.files[i] as string, rel, t0 + rel)
  const after = await matchRatio(g.files[i] as string, rel, shot.endFrame / fps + 0.5)
  out(`  ${name}: at +${rel.toFixed(2)} s the opaque pixels of the overlay differ from the film by ${inside.toFixed(2)} (0–255); 0.5 s after the shot by ${after.toFixed(2)}`)
  check(`the film shows the ${name} exactly during its shot`, inside < 6 && after > inside + 8, `inside ${inside.toFixed(2)}, after ${after.toFixed(2)}`)
}
await png(film.video, title.startFrame / fps + 2.0, 'motion-title.png')
await png(film.video, figure.startFrame / fps + 2.2, 'motion-counter.png')
await png(film.video, lower.startFrame / fps + 1.8, 'motion-lowerthird.png')

// 5. captions stay on top: white pixels in the caption band during the title card (its scrim covers the whole frame)
{
  const t = title.startFrame / fps + 1.5
  const f = await raw(film.video, t, 'rgb24')
  let white = 0
  for (let y = bandTop; y < H; y++) for (let x = 0; x < W; x++) if ((f[(y * W + x) * 3] as number) > 235 && (f[(y * W + x) * 3 + 1] as number) > 235 && (f[(y * W + x) * 3 + 2] as number) > 235) white++
  const o = await raw(g.files[shots.indexOf(title)] as string, 1.5, 'rgba')
  let covered = 0
  for (let y = bandTop; y < H; y += 4) for (let x = 0; x < W; x += 4) if ((o[(y * W + x) * 4 + 3] as number) > 40) covered++
  check('the captions stay readable on top of the title card', white > 400 && covered > 1000, `${white} white caption pixels in the band under a scrim that covers ${covered * 16} px of it`)
}

// 6. quality
const qc = film.qc as { pass?: boolean; checks?: { id: string; status: string }[] } | null
out(`quality check: ${JSON.stringify(qc?.checks?.map((c) => `${c.id}:${c.status}`))}`)
check('the quality check ran and passed', qc?.pass === true && film.gates.length === 0, (qc?.checks ?? []).map((c) => `${c.id} ${c.status}`).join(', ') || 'no report')

// ===== B. the conversation short ============================================================================================================
out('\n— B. the conversation short (9:16)')
const clips = path.join(dataDir, 'gameplay')
mkdirSync(clips, { recursive: true })
// two smooth moving gradients stand in for gameplay (the chat window sits over them)
for (const [name, c0, c1] of [['a-violet', '0x1b1f3a', '0x7b3fb0'], ['b-teal', '0x10303a', '0x2f8f9d']] as const) {
  await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `gradients=s=1280x720:r=30:d=12:speed=0.015:c0=${c0}:c1=${c1}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', path.join(clips, `${name}.mp4`)], { signal })
}
const chat = await runMotionDemo({ ...base, kind: 'chat', dataDir: path.join(dataDir, 'chat'), clipsDir: clips })
out(`\nrun: ${chat.status} in ${(chat.ms / 1000).toFixed(1)} s · ran: ${chat.ran.join(', ')}`)
if (chat.status !== 'done' || !chat.video || !chat.plan) {
  check('the conversation short is made', false, `${chat.status} ${JSON.stringify(chat.errors)}`)
  process.exit(1)
}
out(`video: ${chat.video}`)
const cinfo = await probe(media, chat.video, signal, true)
const cv = cinfo.streams.find((s) => s.codec_type === 'video')
const caudio = cinfo.streams.filter((s) => s.codec_type === 'audio')
out(`ffprobe: ${cv?.width}×${cv?.height} ${cv?.codec_name} ${cv?.pix_fmt} ${cv?.r_frame_rate} fps, ${cv?.nb_read_frames} frames, ${cinfo.durationS.toFixed(3)} s; audio ${caudio.map((a) => `${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch`).join(', ')}`)
check('1080×1920, 30 fps, one audio stream, 10 to 24 s', cv?.width === 1080 && cv?.height === 1920 && cv?.r_frame_rate === '30/1' && caudio.length === 1 && cinfo.durationS >= 10 && cinfo.durationS <= 24, `${cv?.width}×${cv?.height}, ${cv?.r_frame_rate}, ${caudio.length} audio, ${cinfo.durationS.toFixed(2)} s`)

const cshots = motionShots(chat)
const talk = cshots[0]
const props = talk?.graphic?.template === 'conversation' ? (talk.graphic.props as z.infer<typeof ConversationProps>) : null
const words = (chat.voice.words ?? []) as Word[]
out('conversation: ' + (props ? `${props.speakers.map((s) => `${s.name} (${s.side})`).join(', ')}; ${props.turns.length} bubbles: ` + props.turns.map((t) => `${(((talk?.startFrame ?? 0) / fps) + t.atS).toFixed(2)} s « ${t.text.slice(0, 28)} »`).join(' · ') : 'none'))
check('one conversation overlay with two characters, whose bubbles are the script’s turns', cshots.length === 1 && props !== null && props.speakers.length === 2 && props.turns.length >= 5, `${cshots.length} overlay(s), ${props?.turns.length ?? 0} bubbles`)
if (!talk || !props) process.exit(1)

// 8. each bubble's time is the first word of its line in the voice
const tokens = props.turns.map((t) => t.text.split(/\s+/).length)
const firsts: number[] = []
{
  // the words are in the script's order; the bubbles cover the dialogue's tokens one after the other
  let at = Math.max(0, words.findIndex((w) => w.start >= talk.startFrame / fps - 0.01))
  for (const n of tokens) {
    firsts.push((words[at] as Word).start)
    at += n
  }
}
const drift = props.turns.map((t, i) => Math.abs(talk.startFrame / fps + t.atS - (firsts[i] as number)))
out(`bubble time vs first word of its line (s): ${drift.map((d) => d.toFixed(3)).join(' ')}`)
check('every bubble is timed by the first word of its line in the voice (within one frame)', drift.every((d) => d <= 1 / fps + 1e-3), `largest gap ${Math.max(...drift).toFixed(3)} s`)

// 9. in the film the chat window changes when a line starts (a bubble pops and the list moves up) and stays quiet between the lines:
// the mean difference of the chat window between just before the line and 0.45 s after it, against the same measure over a quiet stretch
const CW = 1080
const CH = 1920
const y0 = Math.round(CH * 0.12)
const y1 = Math.round(CH * 0.65)
async function windowDiff(a: number, b: number): Promise<number> {
  const [fa, fb] = await Promise.all([raw(chat.video as string, a, 'rgb24'), raw(chat.video as string, b, 'rgb24')])
  let sum = 0
  let n = 0
  for (let y = y0; y < y1; y += 3) {
    for (let x = 60; x < CW - 60; x += 3) {
      const k = (y * CW + x) * 3
      sum += (Math.abs((fa[k] as number) - (fb[k] as number)) + Math.abs((fa[k + 1] as number) - (fb[k + 1] as number)) + Math.abs((fa[k + 2] as number) - (fb[k + 2] as number))) / 3
      n++
    }
  }
  return sum / n
}
const shotStart = talk.startFrame / fps
const times = props.turns.map((t) => shotStart + t.atS)
// the quietest stretch: after a bubble, before the dots of the next one (they start about 0.9 s before it)
let quietS = 0
let quietAt = times[0] as number
for (const [i, t] of times.entries()) {
  const gap = (times[i + 1] ?? t + 3) - 0.95 - (t + 0.6)
  if (gap > quietS) {
    quietS = gap
    quietAt = t + 0.6
  }
}
const control = await windowDiff(quietAt, quietAt + Math.min(0.57, Math.max(0.1, quietS)))
const events: number[] = []
for (const t of times) events.push(await windowDiff(Math.max(0, t - 0.12), t + 0.45))
out(`chat window difference (0–255): quiet stretch of ${quietS.toFixed(2)} s ${control.toFixed(2)}; at each line: ${events.map((e) => e.toFixed(2)).join(' ')}`)
check('in the film the chat window changes when each line starts and stays quiet between lines', events.every((e) => e > Math.max(0.8, control * 4)), `quiet ${control.toFixed(2)}, lines ${events.map((e) => e.toFixed(2)).join(', ')}`)
const mids = [0.2, 0.55, 0.9].map((k) => talk.startFrame / fps + (props.turns.at(-1)?.atS ?? 1) * k)
await png(chat.video, mids[0] as number, 'motion-chat-1.png')
await png(chat.video, mids[1] as number, 'motion-chat-2.png')
await png(chat.video, (talk.startFrame / fps) + (props.turns.at(-1)?.atS ?? 1) + 0.3, 'motion-chat-3.png')

const cqc = chat.qc as { pass?: boolean; checks?: { id: string; status: string }[] } | null
out(`quality check: ${JSON.stringify(cqc?.checks?.map((c) => `${c.id}:${c.status}`))}`)
check('the quality check ran and passed', cqc?.pass === true && chat.gates.length === 0, (cqc?.checks ?? []).map((c) => `${c.id} ${c.status}`).join(', ') || 'no report')

const failed = checks.filter((c) => !c.ok)
writeFileSync(path.join(dataDir, 'motion-demo-report.json'), JSON.stringify({ film: film.video, chat: chat.video, checks }, null, 2))
out(`\n===== MOTION DEMO: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${checks.length - failed.length}/${checks.length} checks) =====`)
out(`films: ${film.video} · ${chat.video}`)
out(`frames: ${framesDir}`)
process.exit(failed.length === 0 ? 0 : 1)
