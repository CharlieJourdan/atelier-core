// `npm run engine:avatar-demo` — the proof of generated video and of the talking presenter in the render (nodes `visuals.fulfil`
// with video items, `avatar.speak`, `render.assemble`): our engine makes a real 16:9 film of about twenty seconds on this machine,
// free and offline (demo mode: template research and script, the system voice, drawn pictures; the generated clip and the
// presenter are drawn here; the cuts, captions, music, render and quality check are the real code). Then it checks, and exits 1
// if any check fails:
//   1. ffprobe: 1920×1080, 30 fps, one audio stream, about 20 s;
//   2. the plan has a presenter on the hook (a full-frame base shot starting at 0) and a generated-video shot, priced in the list;
//   3. the film shows the presenter’s own clip during the hook (and not after it);
//   4. the film shows the generated clip during its shot, and the clip moves;
//   5. the quality check ran and passed;
//   6. the same film with the presenter in picture-in-picture keeps the picture track and shows a small square at the bottom right.
// Options: --data <dir> (default <tmp>/atelier-avatar-demo) --frames <dir> (default docs/screens/engine: avatar-hook.png,
// generated-clip.png and avatar-pip.png) --tone-voice (the deterministic tone instead of the operating system’s voice).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DRAW_FILTERS } from '../src/engine/media/draw'
import { DRAW_VIDEO_FILTERS } from '../src/engine/media/draw-video'
import { probe } from '../src/engine/media/probe'
import { FULL_FFMPEG_HINT, locateTool, RENDER_ENCODERS, RENDER_FILTERS, requireFilters, systemMediaService } from '../src/engine/media/tools'
import { runAvatarDemo, type AvatarDemoResult } from '../src/engine/pipelines/avatar-demo'
import { pipBox } from '../src/engine/render/final'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const dataDir = path.resolve(arg('data', path.join(os.tmpdir(), 'atelier-avatar-demo')))
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
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run engine:avatar-demo ».`)
  process.exit(1)
}
const signal = new AbortController().signal
out(`ffmpeg: ${locateTool('ffmpeg', toolEnv)}`)
try {
  await requireFilters(media, [...RENDER_FILTERS, ...RENDER_ENCODERS, ...DRAW_FILTERS, ...DRAW_VIDEO_FILTERS], signal)
} catch (e) {
  out(`FAIL  ffmpeg complete — ${(e as Error).message}`)
  process.exit(1)
}

rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
mkdirSync(dataDir, { recursive: true })
mkdirSync(framesDir, { recursive: true })

const grab = async (file: string, t: number, crop: string): Promise<Buffer> =>
  (await media.run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${crop},scale=480:-1,format=gray`, '-f', 'rawvideo', '-'], { signal })).stdout
const meanDiff = (a: Buffer, b: Buffer): number => {
  let s = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += Math.abs((a[i] as number) - (b[i] as number))
  return s / Math.max(1, Math.min(a.length, b.length))
}
const png = async (file: string, t: number, name: string): Promise<void> => {
  await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=960:-1', path.join(framesDir, name)], { signal })
}
// the picture without the DÉMO mark (top right) and the captions (bottom band)
const BODY = '1500:620:0:150'

const base = {
  dataDir,
  resourcesDir: path.join(ROOT, 'resources'),
  services: process.argv.includes('--tone-voice') ? { speech: undefined } : {}
}
const quiet = (e: { kind: string; nodeId?: string; message?: string }): void => {
  if (e.kind === 'start') out(`  ▶ ${e.nodeId}`)
  else if (e.kind === 'error') out(`  ✗ ${e.nodeId}: ${e.message}`)
}
out(`Atelier avatar demo — data ${dataDir}`)
const full: AvatarDemoResult = await runAvatarDemo({ ...base, onEvent: quiet as never })
out(`\n— full-frame presenter: ${full.status} in ${(full.ms / 1000).toFixed(1)} s · ran: ${full.ran.join(', ')}`)
if (full.status !== 'done' || !full.video || !full.plan || !full.genlist) {
  check('the pipeline produces a video', false, `${full.status} ${JSON.stringify(full.errors)}`)
  process.exit(1)
}
out(`video: ${full.video}`)

// 1. ffprobe
const info = await probe(media, full.video, signal, true)
const v = info.streams.find((s) => s.codec_type === 'video')
const audio = info.streams.filter((s) => s.codec_type === 'audio')
out(`ffprobe: ${v?.width}×${v?.height} ${v?.codec_name} ${v?.pix_fmt} ${v?.r_frame_rate} fps, ${v?.nb_read_frames} frames, ${info.durationS.toFixed(3)} s; audio ${audio.map((a) => `${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch`).join(', ')}`)
check('1920×1080, 30 fps, one audio stream', v?.width === 1920 && v?.height === 1080 && v?.r_frame_rate === '30/1' && audio.length === 1, `${v?.width}×${v?.height}, ${v?.r_frame_rate}, ${audio.length} audio`)
check('about 20 s', info.durationS >= 14 && info.durationS <= 28, `${info.durationS.toFixed(2)} s`)

// 2. the plan
const plan = full.plan
const hook = plan.shots.find((s) => s.kind === 'avatar')
const clipShot = plan.shots.find((s) => s.kind === 'video.gen')
const items = full.genlist.items
out(`plan: ${plan.tracks.base.length} base shots; presenter ${hook ? `${hook.startFrame / 30}–${hook.endFrame / 30} s (${hook.layout})` : 'none'}; generated clip ${clipShot ? `${clipShot.startFrame / 30}–${clipShot.endFrame / 30} s` : 'none'}; credits in the list: ${full.genlist.totals.credits} (${JSON.stringify(full.genlist.totals.byKind)})`)
check('a presenter on the hook, full frame, from the first frame', hook?.track === 'base' && hook.layout === 'full' && hook.startFrame === 0 && hook.endFrame > 90, hook ? `${hook.startFrame}–${hook.endFrame} frames` : 'no avatar shot')
check('one generated-video shot, priced in the list with the presenter', clipShot !== undefined && items.filter((i) => i.kind === 'video.gen').length === 1 && items.some((i) => i.kind === 'avatar' && i.unitPrice > 0), `video.gen ${items.filter((i) => i.kind === 'video.gen').length}, avatar ${items.filter((i) => i.kind === 'avatar').length}`)
const avatarClip = full.avatar.files[0]
const videoClip = full.clips.files[0]
check('the two clips exist', avatarClip !== undefined && videoClip !== undefined, `avatar ${avatarClip ? path.basename(avatarClip) : '—'}, generated ${videoClip ? path.basename(videoClip) : '—'}`)
if (!hook || !clipShot || !avatarClip || !videoClip) process.exit(1)

// 3. the presenter during the hook
const hookEnd = hook.endFrame / 30
const tHook = Math.min(2.5, hookEnd - 0.6)
const inClip = meanDiff(await grab(full.video, tHook, BODY), await grab(avatarClip, tHook, BODY))
const after = meanDiff(await grab(full.video, hookEnd + 1.2, BODY), await grab(avatarClip, tHook, BODY))
check('the film shows the presenter’s clip during the hook, and not after it', inClip < 14 && after > inClip + 8, `film vs clip at ${tHook.toFixed(1)} s differs by ${inClip.toFixed(2)}; after the hook (${(hookEnd + 1.2).toFixed(1)} s) by ${after.toFixed(2)} (0–255 scale)`)
await png(full.video, tHook, 'avatar-hook.png')

// 4. the generated clip during its shot
const s0 = clipShot.startFrame / 30
const tClip = Math.min(1.0, (clipShot.endFrame - clipShot.startFrame) / 30 - 0.3)
const same = meanDiff(await grab(full.video, s0 + tClip, BODY), await grab(videoClip, tClip, BODY))
const moves = meanDiff(await grab(full.video, s0 + 0.2, BODY), await grab(full.video, s0 + 0.2 + tClip + 0.5, BODY))
check('the film shows the generated clip during its shot, and it moves', same < 14 && moves > 1, `film vs clip at +${tClip.toFixed(1)} s differs by ${same.toFixed(2)}; two moments of the shot differ by ${moves.toFixed(2)}`)
await png(full.video, s0 + tClip, 'generated-clip.png')

// 5. the quality check
const qc = full.qc as { pass?: boolean; checks?: { id: string; status: string }[] } | null
out(`quality check: ${JSON.stringify(qc?.checks?.map((c) => `${c.id}:${c.status}`))}`)
check('the quality check ran and passed', qc?.pass === true && full.gates.length === 0, (qc?.checks ?? []).map((c) => `${c.id} ${c.status}`).join(', ') || 'no report')

// 6. the same film, the presenter in picture-in-picture
const pip: AvatarDemoResult = await runAvatarDemo({ ...base, dataDir: path.join(dataDir, 'pip'), layout: 'pip', onEvent: quiet as never })
out(`\n— presenter in picture-in-picture: ${pip.status} in ${(pip.ms / 1000).toFixed(1)} s`)
if (pip.status !== 'done' || !pip.video || !pip.plan) {
  check('the picture-in-picture film is made', false, `${pip.status} ${JSON.stringify(pip.errors)}`)
} else {
  const shot = pip.plan.shots.find((s) => s.kind === 'avatar')
  const baseKinds = pip.plan.shots.filter((s) => pip.plan?.tracks.base.includes(s.id)).map((s) => s.kind)
  check('the presenter is an overlay shot and the base track keeps its pictures', shot?.track === 'overlay' && shot.layout === 'pip' && !baseKinds.includes('avatar'), `${shot?.track}/${shot?.layout}, base kinds: ${[...new Set(baseKinds)].join(', ')}`)
  const box = pipBox([1920, 1080])
  const mid = ((shot?.startFrame ?? 0) + (shot?.endFrame ?? 0)) / 2 / 30
  // the square holds the centre of the presenter's clip (cover-cropped to a square), 30 px in from its edges
  const inner = box.side - 60
  const square = `${inner}:${inner}:${box.x + 30}:${box.y + 30}`
  const pipClip = pip.avatar.files[0] as string
  const side = Math.round((1080 * inner) / box.side)
  const centre = `${side}:${side}:${420 + Math.round((1080 * 30) / box.side)}:${Math.round((1080 * 30) / box.side)}`
  const inSquare = meanDiff(await grab(pip.video, mid, square), await grab(pipClip, mid, centre))
  const pipEnd = (shot?.endFrame ?? 0) / 30
  const gone = meanDiff(await grab(pip.video, pipEnd + 1.2, square), await grab(pipClip, mid, centre))
  check('a small square at the bottom right shows the presenter, then it leaves', inSquare < 14 && gone > inSquare + 8, `the square differs from the presenter’s clip by ${inSquare.toFixed(2)} during the hook, by ${gone.toFixed(2)} after it`)
  await png(pip.video, mid, 'avatar-pip.png')
}

const failed = checks.filter((c) => !c.ok)
writeFileSync(path.join(dataDir, 'avatar-demo-report.json'), JSON.stringify({ video: full.video, ffprobe: { width: v?.width, height: v?.height, frames: v?.nb_read_frames, durationS: info.durationS }, qc, checks }, null, 2))
out(`\n===== AVATAR DEMO: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${checks.length - failed.length}/${checks.length} checks) =====`)
out(`video: ${full.video}`)
out(`frames: ${framesDir}`)
process.exit(failed.length === 0 ? 0 : 1)
