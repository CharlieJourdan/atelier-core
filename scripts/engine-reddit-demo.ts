// `npm run engine:reddit-demo` — the proof of the faceless formats (PLAN-V2-PRODUCTION, nodes `background.clips`, `card.intro`,
// `qc.check`): our engine makes a real Reddit-style story short on this machine, free (demo mode: template research, the
// system or tone voice; the background, the card, the captions, the render and the quality check are the real code).
// The script is given by a person, the gameplay is a folder of clips (made here with ffmpeg: nothing recorded, nothing
// downloaded). Then it checks, and exits 1 if any check fails:
//   1. ffprobe: 1080×1920 (a vertical short), about 15 s, one audio stream;
//   2. the intro card is on the picture at the start and gone after it (compared with the background alone);
//   3. burned captions (shorts style) are visible later in the safe area, and nothing is burned in the bottom UI zone;
//   4. the quality check ran and passed (black, silence, freeze, loudness, duration, format);
//   5. the same seed gives the same pieces of gameplay, another seed other pieces.
// Options: --data <dir> (default <tmp>/atelier-reddit-demo) --frames <dir> (save the frames at 1 s and 5 s as reddit-short-1s.png and reddit-short-5s.png)
// --system-voice (use the operating system's voice instead of the deterministic tone voice).
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runRedditShort } from '../src/engine/pipelines/reddit-short-demo'
import { DRAW_FILTERS } from '../src/engine/media/draw'
import { probe } from '../src/engine/media/probe'
import { CARD_FILTERS } from '../src/engine/nodes/card-intro'
import { FULL_FFMPEG_HINT, locateTool, RENDER_ENCODERS, RENDER_FILTERS, requireFilters, systemMediaService } from '../src/engine/media/tools'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const dataDir = path.resolve(arg('data', path.join(os.tmpdir(), 'atelier-reddit-demo')))
const framesDir = process.argv.includes('--frames') ? path.resolve(arg('frames', path.join(ROOT, 'docs', 'screens', 'v2'))) : null
const out = (s: string): void => void process.stdout.write(s + '\n')
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  out(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

const toolEnv = { platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' }
const media = systemMediaService(toolEnv)
if (!media) {
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run engine:reddit-demo ».`)
  process.exit(1)
}
const signal = new AbortController().signal
out(`ffmpeg: ${locateTool('ffmpeg', toolEnv)}`)
try {
  await requireFilters(media, [...RENDER_FILTERS, ...RENDER_ENCODERS, ...DRAW_FILTERS, ...CARD_FILTERS], signal)
} catch (e) {
  out(`FAIL  ffmpeg complete — ${(e as Error).message}`)
  process.exit(1)
}

rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
mkdirSync(dataDir, { recursive: true })

// the « gameplay »: three short clips of different looks, in a folder
const clips = path.join(dataDir, 'gameplay')
mkdirSync(clips, { recursive: true })
copyFileSync(path.join(ROOT, 'resources', 'fake-media', 'sample.mp4'), path.join(clips, 'a-sample.mp4'))
const enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an']
await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=7', '-vf', 'hue=h=120', ...enc, path.join(clips, 'b-green.mp4')], { signal })
await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'life=s=640x360:r=30:mold=10:ratio=0.12:death_color=#C83232:life_color=#00ff00,scale=1280:720:flags=neighbor', '-t', '7', ...enc, path.join(clips, 'c-life.mp4')], { signal })

const base = {
  dataDir,
  resourcesDir: path.join(ROOT, 'resources'),
  clipsDir: clips,
  topic: 'Mon voisin m’a confié sa clé',
  channel: 'Histoires Vraies',
  minutes: 0.25,
  services: process.argv.includes('--system-voice') ? {} : { speech: undefined }
}
out(`Atelier Reddit short — data ${dataDir}`)
const first = await runRedditShort({ ...base, onEvent: (e) => (e.kind === 'start' ? out(`  ▶ ${e.nodeId}`) : e.kind === 'error' ? out(`  ✗ ${e.nodeId}: ${e.message}`) : undefined) })
out(`\n— first run: ${first.status} in ${(first.ms / 1000).toFixed(1)} s · ran: ${first.ran.join(', ')}`)
if (first.status !== 'done' || !first.video || !first.backgroundFile) {
  check('the pipeline produces a video', false, `${first.status} ${JSON.stringify(first.errors)}`)
  process.exit(1)
}
out(`video: ${first.video}`)
out(`drawing → engine: ${JSON.stringify(first.compiled.mapping)}; notes: ${JSON.stringify(first.compiled.notes.map((n) => `${n.stepId}:${n.code}`))}`)

// 1. ffprobe
const info = await probe(media, first.video, signal)
const v = info.streams.find((s) => s.codec_type === 'video')
const audio = info.streams.filter((s) => s.codec_type === 'audio')
out(`ffprobe: ${v?.width}×${v?.height} ${v?.codec_name} ${v?.pix_fmt} ${v?.r_frame_rate} fps, ${v?.nb_frames} frames, ${info.durationS.toFixed(3)} s; audio ${audio.map((a) => `${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch`).join(', ')}`)
check('1080×1920 (9:16), 30 fps, one audio stream', v?.width === 1080 && v?.height === 1920 && v?.r_frame_rate === '30/1' && audio.length === 1, `${v?.width}×${v?.height}, ${v?.r_frame_rate}, ${audio.length} audio`)
check('the background layer is 1080×1920 too', (first.background as { width?: number; height?: number } | null)?.width === 1080 && (first.background as { height?: number } | null)?.height === 1920, JSON.stringify({ w: (first.background as { width?: number } | null)?.width, h: (first.background as { height?: number } | null)?.height }))
check('about 15 s', info.durationS >= 8 && info.durationS <= 25, `${info.durationS.toFixed(2)} s`)

// 2 and 3. the card and the captions, against the background alone
const card = first.card as { endS?: number } | null
const endS = typeof card?.endS === 'number' ? card.endS : 3
const grab = async (file: string, t: number, crop: string): Promise<Buffer> =>
  (await media.run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${crop},scale=480:-1,format=gray`, '-f', 'rawvideo', '-'], { signal })).stdout
const meanDiff = (a: Buffer, b: Buffer): number => {
  let s = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += Math.abs((a[i] as number) - (b[i] as number))
  return s / Math.max(1, Math.min(a.length, b.length))
}
// crop = width:height:x:y on the 1080×1920 frame
const CARD_BAND = '960:700:60:200' // where the card sits (upper third)
const CAPTION_BAND = '1080:420:0:1000' // the captions' safe area: centred, above the bottom UI zone (the lowest 20 %)
const UI_ZONE = '1080:384:0:1536' // bottom 20 %: nothing may be burned there
const cardAt = Math.min(1.2, endS / 2)
const cardOn = meanDiff(await grab(first.video, cardAt, CARD_BAND), await grab(first.backgroundFile, cardAt, CARD_BAND))
const cardOff = meanDiff(await grab(first.video, endS + 1.5, CARD_BAND), await grab(first.backgroundFile, endS + 1.5, CARD_BAND))
check('the intro card is on the picture, then gone', cardOn > 15 && cardOff < 3, `card shown until ${endS} s: upper band differs by ${cardOn.toFixed(1)} at ${cardAt.toFixed(1)} s, ${cardOff.toFixed(2)} at ${(endS + 1.5).toFixed(1)} s`)
let bestCaption = 0
for (const f of [0.45, 0.6, 0.75, 0.9]) bestCaption = Math.max(bestCaption, meanDiff(await grab(first.video, info.durationS * f, CAPTION_BAND), await grab(first.backgroundFile, info.durationS * f, CAPTION_BAND)))
check('burned captions are visible in the safe area', bestCaption > 3, `caption band differs by up to ${bestCaption.toFixed(2)} (0–255 scale)`)
let worstUi = 0
for (const f of [0.45, 0.6, 0.75, 0.9]) worstUi = Math.max(worstUi, meanDiff(await grab(first.video, info.durationS * f, UI_ZONE), await grab(first.backgroundFile, info.durationS * f, UI_ZONE)))
// (a re-encode leaves a noise floor of about 1 against the background alone: burned text would be several times the captions' own)
check('nothing is burned in the bottom UI zone', worstUi < 2 && worstUi < bestCaption / 3, `bottom 20 % differs by up to ${worstUi.toFixed(2)} (noise floor), captions band ${bestCaption.toFixed(2)}`)
if (framesDir) {
  mkdirSync(framesDir, { recursive: true })
  for (const t of [1, 5]) {
    await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', first.video, '-frames:v', '1', '-vf', 'scale=720:-1', path.join(framesDir, `reddit-short-${t}s.png`)], { signal })
  }
}

// 4. the quality check
const qc = first.qc as { pass?: boolean; score?: number; checks?: { id: string; status: string; detail: string }[] } | null
out(`quality check: ${JSON.stringify(qc?.checks?.map((c) => `${c.id}:${c.status}`))}`)
check('the quality check ran and passed', qc?.pass === true && first.gates.length === 0, (qc?.checks ?? []).map((c) => `${c.id} ${c.status}`).join(', ') || 'no report')

// 5. the seed
const same = await runRedditShort({ ...base, dataDir: path.join(dataDir, 'again') })
const other = await runRedditShort({ ...base, dataDir: path.join(dataDir, 'other'), seed: 7 })
const pieces = (r: typeof first): string => JSON.stringify((r.background as { pieces?: unknown } | null)?.pieces ?? null)
check('the same seed picks the same pieces, another seed other pieces', pieces(same) === pieces(first) && pieces(other) !== pieces(first), `seed 0: ${pieces(first).slice(0, 120)}…`)

const failed = checks.filter((c) => !c.ok)
writeFileSync(path.join(dataDir, 'reddit-demo-report.json'), JSON.stringify({ video: first.video, ffprobe: { width: v?.width, height: v?.height, frames: v?.nb_frames, durationS: info.durationS }, qc, checks }, null, 2))
out(`\n===== REDDIT SHORT: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${checks.length - failed.length}/${checks.length} checks) =====`)
out(`video: ${first.video}`)
process.exit(failed.length === 0 ? 0 : 1)
