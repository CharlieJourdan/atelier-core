// `npm run engine:documentary2-demo` — the measured archive documentary on fakes (documentary-2): a project on the base pipeline
// `documentary@2`, compiled from its document, renders a 16:9 film on this machine, free and offline (template script, the system voice,
// drawn pictures and drawn clips standing for the archives, the scene pass replaced by each sentence's key terms; the boards, maps,
// charts and texts are drawn by the real motion runtime in the system's Chrome or Edge). Then it checks, and exits 1 if any check fails:
//   1. the pipeline is documentary@2's: the documentary-2 grammar, the archive-film grade, no editing kit (no sound effect);
//   2. the plan is varied like the reference: films cut into clips (most in the old-TV frame), prints boards in two layouts at least,
//      no non-film pattern twice in a row, nothing generated (every picture an archive to find);
//   3. the cards were drawn opaque and played as base shots, the texts over the films as overlays;
//   4. ffprobe: 1920×1080, 30 fps, about the asked length; the quality check ran;
//   5. frames saved for a look (<tmp>/atelier-documentary2-demo-frames/*.jpg, or --frames <dir>).
// Options: --data <dir> --frames <dir> --minutes <n>.
import { mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probe } from '../src/engine/media/probe'
import { FULL_FFMPEG_HINT, RENDER_ENCODERS, RENDER_FILTERS, requireFilters, systemMediaService } from '../src/engine/media/tools'
import { runDocumentaryDemo } from '../src/engine/pipelines/documentary-base-demo'
import { documentary2Base } from '../src/engine/technologies'
import { BASE_STYLES } from '../src/main/production/styles/seeds'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const dataDir = path.resolve(arg('data', path.join(os.tmpdir(), 'atelier-documentary2-demo')))
const framesDir = path.resolve(arg('frames', path.join(os.tmpdir(), 'atelier-documentary2-demo-frames')))
const minutes = Number(arg('minutes', '1.5'))
const out = (s: string): void => void process.stdout.write(s + '\n')
let failed = 0
const check = (name: string, ok: boolean, detail: string): void => {
  if (!ok) failed++
  out(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

const media = systemMediaService({ platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' })
if (!media) {
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run engine:documentary2-demo ».`)
  process.exit(1)
}
const signal = new AbortController().signal
await requireFilters(media, [...RENDER_FILTERS, ...RENDER_ENCODERS], signal)
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
mkdirSync(dataDir, { recursive: true })
mkdirSync(framesDir, { recursive: true })

out(`Atelier documentary@2 demo — data ${dataDir}`)
const r = await runDocumentaryDemo({
  base: documentary2Base,
  dataDir,
  resourcesDir: path.join(ROOT, 'resources'),
  minutes,
  topic: 'Why Hitler never invaded Switzerland in 1940',
  styles: Object.fromEntries(BASE_STYLES.map((s) => [s.id, s])),
  onEvent: (e) => {
    if (e.kind === 'error') out(`  error ${e.nodeId}: ${e.message}`)
  }
})
out(`run ${r.status} in ${Math.round(r.ms / 1000)} s`)
for (const e of r.errors) out(`  ${e.nodeId} ${e.code}: ${e.message.slice(0, 300)}`)

// 1. the pipeline
check('pipeline', !r.nodes.includes('avatar') && r.nodes.includes('motion') && !r.nodes.some((n) => n.startsWith('fx')), r.nodes.join(', '))

// 2. the plan
const plan = r.plan
const base = plan ? plan.tracks.base.map((id) => plan.shots.find((s) => s.id === id)).filter((s) => s !== undefined) : []
const films = base.filter((s) => s.kind === 'stock.video')
const cards = base.filter((s) => s.kind === 'motion')
const kindOf = (s: (typeof base)[number]): string =>
  s.kind === 'motion' ? `${(s.graphic as { template: string }).template}${(s.graphic as { template: string; props: { layout?: string; prints?: unknown[] } }).template === 'prints' ? `:${(s.graphic as { props: { layout?: string; prints: unknown[] } }).props.layout ?? 'auto'}:${(s.graphic as { props: { prints: unknown[] } }).props.prints.length}` : ''}` : s.kind
const sequence = base.map(kindOf)
out(`  sequence: ${sequence.join(' ')}`)
check('archive films', films.length >= 3 && films.filter((s) => s.film === 'tv').length >= films.length / 2, `${films.length} clips, ${films.filter((s) => s.film === 'tv').length} in the old-TV frame`)
const layouts = new Set(sequence.filter((k) => k.startsWith('prints')))
check('prints boards, varied', layouts.size >= 2, [...layouts].join(', ') || 'none')
const twice = sequence.filter((k, i) => i > 0 && k !== 'stock.video' && k === sequence[i - 1])
check('no pattern twice in a row', twice.length === 0, twice.length === 0 ? 'none' : twice.join(', '))
check('nothing generated', !(r.genlist?.items ?? []).some((i) => i.kind === 'image.gen' || i.kind === 'video.gen'), `${r.genlist?.items.length ?? 0} archives to find`)
for (const d of plan?.diagnostics.filter((d) => /documentary-2|sequence|text check/.test(d)) ?? []) out(`  ${d}`)

// 3. the cards and the texts
const records = (Array.isArray(r.motion.value) ? r.motion.value : []) as { base?: boolean; template: string }[]
check('cards drawn opaque', records.filter((x) => x.base).length === cards.length && cards.length > 0, `${records.filter((x) => x.base).length} of ${cards.length}`)
check('texts over the films', records.filter((x) => x.template === 'doc-tags' || x.template === 'kinetic').length === (plan?.tracks.overlay.length ?? -1), `${records.filter((x) => x.template === 'doc-tags' || x.template === 'kinetic').length} drawn, ${plan?.tracks.overlay.length ?? '?'} planned`)

// 4. the film
if (r.video) {
  const p = await probe(media, r.video, signal)
  const v = p.streams.find((x) => x.codec_type === 'video')
  check('film', v?.width === 1920 && v.height === 1080 && Math.abs(p.durationS - minutes * 60) < minutes * 40, `${String(v?.width)}×${String(v?.height)}, ${p.durationS.toFixed(1)} s`)
  // 5. a frame in the middle of every shot of the first minute
  for (const [i, s] of base.entries()) {
    if (s.startFrame / 30 > 75) break
    const t = ((s.startFrame + s.endFrame) / 2 / 30).toFixed(2)
    await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', t, '-i', r.video, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', path.join(framesDir, `${String(i + 1).padStart(2, '0')}-${kindOf(s).replace(/[:.]/g, '-')}.jpg`)], { signal })
  }
  out(`frames: ${framesDir}`)
} else check('film', false, 'no video')
check('quality check', r.qc !== null, r.qc ? 'report made' : 'no report')
out(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
