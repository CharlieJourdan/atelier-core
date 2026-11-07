// `npm run engine:demo` — lot P4's proof (PLAN-V2-PRODUCTION §7 P4): our engine makes a real one-minute MP4 from a
// topic, on this machine, free (demo mode: template research and script, the system voice, drawn pictures; the music,
// captions, edit and render are the real code). Then it checks, and exits 1 if any check fails:
//   1. ffprobe: 1920×1080, 60 s ± 1 s, exactly one audio stream;
//   2. burned-in subtitles visible on 3 frames, compared with the same film rendered without captions;
//   3. a rerun without change takes less than 5 s (everything reused from the artefact store);
//   4. changing the voice redoes the voice and what follows, never the research or the script.
// Output (git-ignored): the data folder (default <tmp>/atelier-engine-demo) holds the artefact store and caches;
// the final video path is printed. Options: --topic "…" --minutes 1 --data <dir> --keep (reuse the data folder)
// --frames <dir> (save the 3 compared frames as JPEG, e.g. docs/screens/v2).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runTemplate, type TemplateRunResult } from '../src/engine/demo'
import { probe } from '../src/engine/media/probe'
import { DRAW_FILTERS } from '../src/engine/media/draw'
import { FULL_FFMPEG_HINT, locateTool, RENDER_ENCODERS, RENDER_FILTERS, requireFilters, systemMediaService } from '../src/engine/media/tools'
import { MemoryNodeStateStore } from '../src/engine/state'
import { FsArtefactStore } from '../src/engine/store'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const topic = arg('topic', 'Le phare oublié de la côte sauvage')
const minutes = Number(arg('minutes', '1'))
const dataDir = path.resolve(arg('data', path.join(os.tmpdir(), 'atelier-engine-demo')))
const framesDir = process.argv.includes('--frames') ? path.resolve(arg('frames', path.join(ROOT, 'docs', 'screens', 'v2'))) : null
const keep = process.argv.includes('--keep')

const out = (s: string): void => void process.stdout.write(s + '\n')
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  out(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

const toolEnv = { platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' }
const media = systemMediaService(toolEnv)
if (!media) {
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run engine:demo ».`)
  process.exit(1)
}
const signal = new AbortController().signal
out(`ffmpeg: ${locateTool('ffmpeg', toolEnv)}`)
// a slim build (Homebrew's plain `ffmpeg` since 2026) is told before anything runs, not after the voice
try {
  await requireFilters(media, [...RENDER_FILTERS, ...RENDER_ENCODERS, ...DRAW_FILTERS], signal)
} catch (e) {
  out(`FAIL  ffmpeg complete — ${(e as Error).message}`)
  process.exit(1)
}

if (!keep) rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
mkdirSync(dataDir, { recursive: true })
const store = new FsArtefactStore(path.join(dataDir, 'artefacts'))
const state = new MemoryNodeStateStore()
const base = { dataDir, resourcesDir: path.join(ROOT, 'resources'), topic, minutes, store, state }
// the proof asks for 60 s: the narration is fitted to the target length (pitch-preserving, at most ±15 %)
const style = { pace: 'fit' }

const say = (label: string, r: TemplateRunResult): void =>
  out(`\n— ${label}: ${r.status} in ${(r.ms / 1000).toFixed(1)} s · ran: ${r.ran.join(', ') || '(nothing)'}${r.errors.length ? ` · errors: ${JSON.stringify(r.errors)}` : ''}`)

out(`Atelier engine demo — « ${topic} », ${minutes} min, data ${dataDir}`)
const first = await runTemplate({
  ...base,
  style,
  onEvent: (e) => {
    if (e.kind === 'start') out(`  ▶ ${e.nodeId}`)
    if (e.kind === 'log' && e.level === 'warn') out(`  ! ${e.nodeId}: ${e.text}`)
    if (e.kind === 'error') out(`  ✗ ${e.nodeId}: ${e.message}`)
  }
})
say('first run', first)
if (first.status !== 'done' || !first.video) {
  check('the pipeline produces a video', false, first.status)
  process.exit(1)
}
out(`video: ${first.video}`)

// 1. ffprobe
const info = await probe(media, first.video, signal)
const v = info.streams.find((s) => s.codec_type === 'video')
const audio = info.streams.filter((s) => s.codec_type === 'audio')
check('1920×1080', v?.width === 1920 && v?.height === 1080, `${v?.width}×${v?.height}, ${v?.codec_name} ${v?.pix_fmt}, ${v?.r_frame_rate} fps, ${v?.color_primaries ?? '?'}`)
check(`${minutes * 60} s ± 1 s`, Math.abs(info.durationS - minutes * 60) <= 1, `${info.durationS.toFixed(3)} s, ${v?.nb_frames} frames`)
check('exactly one audio stream', audio.length === 1, audio.map((a) => `${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch`).join(', '))

// 3. rerun without change
const again = await runTemplate({ ...base, style })
say('rerun without change', again)
check('a rerun without change takes < 5 s', again.status === 'done' && again.ms < 5000 && again.ran.length === 0, `${(again.ms / 1000).toFixed(2)} s, nodes run: ${again.ran.length}`)

// 2. subtitles: the same film without captions (only the captions file and the final pass change)
const plain = await runTemplate({ ...base, style: { ...style, burn: false } })
say('same film without burned captions', plain)
const D = info.durationS
const times = [0.12, 0.5, 0.85].map((f) => Math.round(D * f * 10) / 10)
const band = async (file: string, t: number, crop: string): Promise<Buffer> =>
  (await media.run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${crop},scale=480:-1,format=gray`, '-f', 'rawvideo', '-'], { signal })).stdout
const meanDiff = (a: Buffer, b: Buffer): number => {
  let s = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += Math.abs((a[i] as number) - (b[i] as number))
  return s / Math.max(1, Math.min(a.length, b.length))
}
if (plain.video) {
  for (const t of times) {
    // bottom band where captions sit vs. the middle of the picture, which must be identical
    const bottom = meanDiff(await band(first.video, t, '1920:220:0:800'), await band(plain.video, t, '1920:220:0:800'))
    const middle = meanDiff(await band(first.video, t, '1200:400:360:300'), await band(plain.video, t, '1200:400:360:300'))
    check(`subtitles visible at ${t.toFixed(1)} s`, bottom > 3 && middle < 1.5, `bottom band differs by ${bottom.toFixed(2)}, middle by ${middle.toFixed(2)} (0–255 scale)`)
    if (framesDir) {
      mkdirSync(framesDir, { recursive: true })
      const name = `p4-engine-demo-${String(Math.round(t)).padStart(2, '0')}s.jpg`
      await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', first.video, '-frames:v', '1', '-vf', 'scale=960:-1', '-q:v', '4', path.join(framesDir, name)], { signal })
    }
  }
} else check('the film without captions renders', false, plain.status)

// 4. a voice change does not redo the script
const voiced = await runTemplate({ ...base, style: { ...style, voice: 'demo-hugo' } })
say('voice changed (demo-hugo)', voiced)
const fp = (r: TemplateRunResult, id: string): string => (r.fingerprints[id] ?? '?').slice(0, 12)
check(
  'changing the voice does not redo the script',
  voiced.status === 'done' &&
    !voiced.ran.includes('script') &&
    !voiced.ran.includes('research') &&
    fp(voiced, 'script') === fp(first, 'script') &&
    fp(voiced, 'voice') !== fp(first, 'voice') &&
    fp(voiced, 'render') !== fp(first, 'render'),
  `script ${voiced.states.script} (${fp(voiced, 'script')} = ${fp(first, 'script')}), voice ${voiced.states.voice} (${fp(voiced, 'voice')} ≠ ${fp(first, 'voice')}), new film ${fp(voiced, 'render')}; ran: ${voiced.ran.join(', ') || '(all reused)'}`
)

const failed = checks.filter((c) => !c.ok)
writeFileSync(path.join(dataDir, 'engine-demo-report.json'), JSON.stringify({ topic, minutes, video: first.video, checks, runs: { first, again, plain, voiced } }, null, 2))
out(`\n===== ENGINE DEMO: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${checks.length - failed.length}/${checks.length} checks) =====`)
out(`video: ${first.video}`)
process.exit(failed.length === 0 ? 0 : 1)
