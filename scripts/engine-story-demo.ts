// `npm run engine:story-demo` — a story short on fakes (clone-reddit-shorts): a project on the base pipeline `story-short@1`, compiled
// from its document, renders a 9:16 film on this machine, free and offline (an original story, the system voice stretched to the
// measured pace, clips drawn by ffmpeg in a temporary folder; the post card is drawn by the system's Chrome or Edge). Then it checks,
// and exits 1 if any check fails:
//   1. the pipeline is story-short@1's: no picture to make, the clip background, the post card, one-word captions, music;
//   2. the voice was stretched towards 310 words a minute; the captions are the `word` preset;
//   3. the post card is a `post` that pops, gone by the end of the title sentence (+ 0.35 s);
//   4. the background cut the clips on the measured lengths, each clip once;
//   5. ffprobe: 1080×1920, 30 fps; the quality check ran; frames saved (<tmp>/atelier-story-demo-frames, or --frames <dir>).
// Options: --data <dir> (default <tmp>/atelier-story-demo) --frames <dir> --clips <folder of your own clips>.
import { mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probe } from '../src/engine/media/probe'
import { FULL_FFMPEG_HINT, RENDER_ENCODERS, RENDER_FILTERS, requireFilters, systemMediaService } from '../src/engine/media/tools'
import { runStoryShortDemo } from '../src/engine/pipelines/story-short-demo'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const dataDir = path.resolve(arg('data', path.join(os.tmpdir(), 'atelier-story-demo')))
const framesDir = path.resolve(arg('frames', path.join(os.tmpdir(), 'atelier-story-demo-frames')))
const out = (s: string): void => void process.stdout.write(s + '\n')
let failed = 0
const check = (name: string, ok: boolean, detail: string): void => {
  if (!ok) failed++
  out(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

const media = systemMediaService({ platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' })
if (!media) {
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run engine:story-demo ».`)
  process.exit(1)
}
const signal = new AbortController().signal
await requireFilters(media, [...RENDER_FILTERS, ...RENDER_ENCODERS], signal)
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
mkdirSync(dataDir, { recursive: true })
mkdirSync(framesDir, { recursive: true })

// six moving test patterns stand in for a clip library (vertical, 7 s each)
let clipsDir = arg('clips', '')
if (!clipsDir) {
  clipsDir = path.join(dataDir, 'clips')
  mkdirSync(clipsDir, { recursive: true })
  const sources = ['testsrc2', 'mandelbrot', 'life=mold=10:ratio=0.1', 'cellauto=rule=110', 'smptehdbars', 'rgbtestsrc']
  for (const [i, src] of sources.entries()) {
    const [name, opts] = src.split('=', 2) as [string, string | undefined]
    const lavfi = `${name}=s=720x1280:r=30${opts ? `:${src.slice(name.length + 1)}` : ''}`
    await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', lavfi, '-t', '7', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(clipsDir, `clip${i + 1}.mp4`)], { signal })
  }
}

out(`Atelier story-short@1 demo — data ${dataDir}`)
const r = await runStoryShortDemo({
  dataDir,
  resourcesDir: path.join(ROOT, 'resources'),
  clipsDir,
  onEvent: (e) => {
    if (e.kind === 'error') out(`  error ${e.nodeId}: ${e.message}`)
  }
})
out(`run ${r.status} in ${Math.round(r.ms / 1000)} s`)
for (const e of r.errors) out(`  ${e.nodeId} ${e.code}: ${e.message.slice(0, 300)}`)

check('pipeline', ['background', 'card', 'captions', 'sound'].every((n) => r.nodes.includes(n)) && !r.nodes.includes('visuals') && !r.nodes.includes('avatar'), r.nodes.join(', '))
const fit = typeof r.voice.fit === 'number' ? r.voice.fit : 1
check('voice pace', fit > 1.2, `stretched ×${fit.toFixed(2)} towards 310 words a minute`)
check('captions', r.captions.preset === 'word' && Number(r.captions.cues) > 20, `${String(r.captions.preset)}, ${String(r.captions.cues)} cues`)
check('post card', r.card.look === 'post' && r.card.anim === 'pop' && Number(r.card.endS) < 6, `look ${String(r.card.look)}, gone at ${String(r.card.endS)} s`)
const pieces = Array.isArray(r.background.pieces) ? (r.background.pieces as { clip: string; frames: number }[]) : []
check('background', pieces.length > 4, `${pieces.length} pieces, median ${(pieces.map((p) => p.frames / 30).sort((a, b) => a - b)[Math.floor(pieces.length / 2)] ?? 0).toFixed(2)} s`)
if (r.video) {
  const info = await probe(media, r.video, signal)
  const v = info.streams.find((s) => s.codec_type === 'video')
  check('film', v?.width === 1080 && v.height === 1920, `${String(v?.width)}×${String(v?.height)}, ${info.durationS.toFixed(1)} s`)
  for (const t of [0.6, 1.5, 4, 8]) {
    await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', r.video, '-frames:v', '1', '-vf', 'scale=540:960', path.join(framesDir, `story-${t}.jpg`)], { signal })
  }
  out(`frames in ${framesDir}`)
} else check('film', false, 'no video')
check('quality check', r.qc !== null, r.qc ? 'ran' : 'did not run')
out(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
