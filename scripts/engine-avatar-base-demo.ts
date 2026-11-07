// `npm run engine:avatar-base-demo` — the first avatar video on fakes (production-3): a project on the base pipeline `avatar@1`,
// compiled from the pipeline document (its default options, engines and styles pinned by brick), renders a 16:9 film on this
// machine, free and offline (demo mode: template research and script, the system voice, drawn pictures, a drawn generated clip
// and a drawn presenter; cuts, captions, music, render and quality check are the real code). Then it checks, and exits 1 if
// any check fails:
//   1. the pipeline is avatar@1's (its fifteen bricks: production-4's idea, support videos, presenter's script and sponsor
//      mentions, production-8's clips from their still) and pins the eco engines and the base styles;
//   2. ffprobe: 1920×1080, 30 fps, one video and one audio stream, about 30 s;
//   3. the plan has the presenter on the hook and at least one generated clip;
//   4. the quality check ran and passed, and the thumbnails were made;
//   5. four frames saved for a look (docs/screens/engine/avatar-base-*.png);
//   6. the presenter is generated once, then cut (production-7): every presenter shot comes from one call, the generated
//      seconds are the shown ones plus the handles and silences, each clip as long as its shot;
//   7. the same film with the option « Présentateur : plusieurs plans » and a presenter with two extra angles: each angle is
//      its own call, two neighbouring presenter shots never share a framing, frames saved (avatar-multi-*.png);
//   8. production-8: the pictures wear the phone-real look, the clips are made from their still, two shots share one
//      generation (eco), and a contact sheet of every still and clip is saved (docs/screens/engine/avatar-base-contact-sheet.png);
//   9. production-9, the editing: the film is the full avatar pipeline with a sponsor (the channel's asset), the chapter marks on and
//      the presenter in its three layouts (full, half screen beside a picture, inset); frames of each layout, of the sponsor's card
//      with its QR code and of a chapter mark are saved (avatar-edit-*.png); the QR code read back from the film is the sponsor's
//      link; the sponsor's slot starts and ends on the mention's words; captions as SRT and WebVTT; music under the voice.
// Options: --data <dir> (default <tmp>/atelier-avatar-base-demo) --frames <dir> --tone-voice.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import type { TalkClip } from '../src/engine/presenter/talk'
import os from 'node:os'
import path from 'node:path'
import { DRAW_FILTERS } from '../src/engine/media/draw'
import { DRAW_VIDEO_FILTERS } from '../src/engine/media/draw-video'
import { probe } from '../src/engine/media/probe'
import { FULL_FFMPEG_HINT, locateTool, RENDER_ENCODERS, RENDER_FILTERS, requireFilters, systemMediaService } from '../src/engine/media/tools'
import { runAvatarBaseDemo } from '../src/engine/pipelines/avatar-base-demo'
import { BASE_STYLES } from '../src/main/production/styles/seeds'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const dataDir = path.resolve(arg('data', path.join(os.tmpdir(), 'atelier-avatar-base-demo')))
const framesDir = path.resolve(arg('frames', path.join(ROOT, 'docs', 'screens', 'engine')))
const out = (s: string): void => void process.stdout.write(s + '\n')
// the channel's sponsor (production-9): its first mention near one minute, a reminder before the end, a card and a QR code
const SPONSOR_LINK = 'https://poeloclean.example/atelier'
const SPONSOR = JSON.stringify({
  name: 'Poêlo Clean',
  pitch: 'Le spray au bicarbonate qui décape sans rayer.',
  link: SPONSOR_LINK,
  rule: { windowS: [55, 75], seconds: 8, reminder: true, reminderSeconds: 5 }
})
let failed = 0
const check = (name: string, ok: boolean, detail: string): void => {
  if (!ok) failed++
  out(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

const toolEnv = { platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' }
const media = systemMediaService(toolEnv)
if (!media) {
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run engine:avatar-base-demo ».`)
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

out(`Atelier avatar@1 demo — data ${dataDir}`)
const r = await runAvatarBaseDemo({
  dataDir,
  resourcesDir: path.join(ROOT, 'resources'),
  services: process.argv.includes('--tone-voice') ? { speech: undefined } : {},
  // production-9: a 1 min 30 film with every editing brick: the sponsor, the chapter marks, the presenter in its three layouts (a
  // larger presenter share than the default, so that a short film still has a half-screen and an inset shot)
  minutes: 1.5,
  options: { chapters: true },
  sponsor: SPONSOR,
  mix: { presenter: 0.45, imageAi: 0.34 },
  settings: { 'director.plan': { layouts: ['full', 'split', 'pip'] }, 'script.write': { chapters: 3 } },
  // the base styles at their shipped version, as a project pins them
  styles: Object.fromEntries(BASE_STYLES.map((s) => [s.id, s])),
  onEvent: (e) => {
    if (e.kind === 'start') out(`  ▶ ${e.nodeId}`)
    else if (e.kind === 'error') out(`  ✗ ${e.nodeId}: ${e.message}`)
  }
})
out(`\nrun: ${r.status} in ${(r.ms / 1000).toFixed(1)} s · nodes: ${r.nodes.join(', ')} · gates approved: ${r.gates.join(', ') || 'none'}`)
if (r.status !== 'done' || !r.video || !r.plan) {
  check('the project on avatar@1 produces a video', false, `${r.status} ${JSON.stringify(r.errors)}`)
  process.exit(1)
}
out(`video: ${r.video}`)

// 1. the pipeline and its pins
const pin = (b: string): string => `${r.pins[b]?.engine ?? '—'} → [${r.pins[b]?.fallbacks.join(', ') ?? ''}] (${r.pins[b]?.fallbackScope ?? '—'}) style ${r.pins[b]?.style ?? '—'}`
out(`pins: presenter ${pin('avatar.speak')}; pictures ${pin('visuals.fulfil')}; clips ${pin('clip.make')}; voice ${pin('voice.tts')}`)
check(
  'avatar@1 compiled with its default engines and styles',
  Object.keys(r.pins).length === 17 &&
    r.pins['clip.make']?.engine === 'clip:veo31-lite-relaxed' &&
    r.pins['visuals.fulfil']?.engine === 'image:gpt-image-25-low' && r.pins['script.write']?.tech === 'script.write@2' && r.pins['script.sponsor'] !== undefined && r.pins['avatar.speak']?.engine === 'presenter:heygen-mcp' && r.pins['visuals.fulfil']?.style === 'phone-real' && r.pins['voice.tts']?.fallbackScope === 'video',
  `${Object.keys(r.pins).length} bricks`
)

// 2. ffprobe
const info = await probe(media, r.video, signal, true)
const v = info.streams.find((s) => s.codec_type === 'video')
const audio = info.streams.filter((s) => s.codec_type === 'audio')
out(`ffprobe: ${v?.width}×${v?.height} ${v?.codec_name} ${v?.pix_fmt} ${v?.r_frame_rate} fps, ${v?.nb_read_frames} frames, ${info.durationS.toFixed(3)} s; audio ${audio.map((a) => `${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch`).join(', ')}`)
check('1920×1080, 30 fps, one video and one audio stream', v?.width === 1920 && v?.height === 1080 && v?.r_frame_rate === '30/1' && audio.length === 1, `${v?.width}×${v?.height}, ${v?.r_frame_rate}, ${audio.length} audio`)
check('about 1 min 30', info.durationS >= 70 && info.durationS <= 130, `${info.durationS.toFixed(2)} s`)

// 3. the plan
const hook = r.plan.shots.find((s) => s.kind === 'avatar')
const clips = r.plan.shots.filter((s) => s.kind === 'video.gen')
out(`plan: ${r.plan.shots.length} shots (${[...new Set(r.plan.shots.map((s) => s.kind))].join(', ')}); credits in the list: ${r.genlist?.totals.credits ?? '—'}`)
check('the presenter on the hook, from the first frame', hook !== undefined && hook.startFrame === 0 && r.avatar.length > 0, hook ? `${hook.startFrame}–${hook.endFrame} frames, ${r.avatar.length} presenter clip(s)` : 'no presenter shot')
check('at least one generated clip', clips.length > 0 && r.clips.length > 0, `${clips.length} shot(s), ${r.clips.length} file(s)`)

// 4. the check and the package
const qc = r.qc as { pass?: boolean; checks?: { id: string; status: string }[] } | null
check('the quality check ran and passed', qc?.pass === true, (qc?.checks ?? []).map((c) => `${c.id} ${c.status}`).join(', ') || 'no report')
check('thumbnails made', r.thumbnails.length > 0, `${r.thumbnails.length}`)

// 5. four frames to look at: the hook, a generated clip, a still, the end
const clipMid = clips[0] ? (clips[0].startFrame + clips[0].endFrame) / 60 : info.durationS * 0.3
const still = r.plan.shots.find((s) => s.kind !== 'avatar' && s.kind !== 'video.gen' && s.startFrame / 30 > clipMid)
const times: [string, number][] = [
  ['avatar-base-1-hook.png', Math.min(2, (hook?.endFrame ?? 60) / 60)],
  ['avatar-base-2-clip.png', clipMid],
  ['avatar-base-3-still.png', still ? (still.startFrame + still.endFrame) / 60 : info.durationS * 0.6],
  ['avatar-base-4-end.png', Math.max(0, info.durationS - 1.5)]
]
for (const [name, t] of times) await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', r.video, '-frames:v', '1', '-vf', 'scale=960:-1', path.join(framesDir, name)], { signal })
check('four frames saved', true, times.map(([n, t]) => `${n} @ ${t.toFixed(1)} s`).join(', '))

// 6. one generation, then cut
const talk = r.avatarMeta as { calls?: number; generatedS?: number; shownS?: number; engine?: string | null }
const records = (r.avatarClips ?? []) as TalkClip[]
const presenterShots = r.plan.shots.filter((s) => s.kind === 'avatar')
const sameLength = records.every((c) => Math.abs(c.durationS - (c.endFrame - c.startFrame) / 30) < 1e-3)
out(`presenter: ${presenterShots.length} shot(s) from ${talk.calls ?? '?'} generation(s); ${talk.shownS ?? '?'} s shown, ${talk.generatedS ?? '?'} s generated`)
check(
  'the presenter is generated once, then cut on the shots',
  talk.calls === 1 && records.length === presenterShots.length && records.every((c) => c.call === 0) && sameLength && (talk.generatedS ?? 0) <= (talk.shownS ?? 0) + presenterShots.length * 0.5 + 1e-6,
  `${records.length} clip(s), ${talk.calls} call(s), generated ${talk.generatedS} s for ${talk.shownS} s shown`
)

// 9. production-9, the editing: the layouts, the sponsor's card and QR code, a chapter mark, captions and music
const grab = async (name: string, t: number): Promise<string> => {
  await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', r.video as string, '-frames:v', '1', '-vf', 'scale=960:-1', path.join(framesDir, name)], { signal })
  return `${name} @ ${t.toFixed(1)} s`
}
const sponsorWindows = ((r.sponsor.meta.windows ?? []) as { kind: string; startS: number; endS: number; anchor: string }[])
const inSponsor = (a: number, b: number): boolean => sponsorWindows.some((w) => a < w.endS && b > w.startS)
const midOf = (s: { startFrame: number; endFrame: number }): number => (s.startFrame + s.endFrame) / 60
const plan = r.plan
const layoutShot = (layout: 'full' | 'split' | 'pip') =>
  plan.shots.find((s) => s.kind === 'avatar' && (s.layout ?? 'full') === layout && !inSponsor(s.startFrame / 30, s.endFrame / 30) && s.startFrame > 0) ??
  plan.shots.find((s) => s.kind === 'avatar' && (s.layout ?? 'full') === layout)
const layoutFrames: string[] = []
for (const layout of ['full', 'split', 'pip'] as const) {
  const s = layoutShot(layout)
  if (s) layoutFrames.push(await grab(`avatar-edit-layout-${layout}.png`, midOf(s)))
}
const meta = r.renderMeta as { avatarSplit?: number; avatarPip?: number; layers?: string[] }
check('the presenter in its three layouts: full, half screen beside a picture, inset', layoutFrames.length === 3 && (meta.avatarSplit ?? 0) > 0 && (meta.avatarPip ?? 0) > 0, `${layoutFrames.join(', ')}; ${meta.avatarSplit ?? 0} split, ${meta.avatarPip ?? 0} inset`)
// the sponsor's slot on the mention's words: from just before its first word to the start of the sentence after it
const words = (r.words ?? []) as { w: string; start: number; end: number; sentence: number }[]
const slotOk = sponsorWindows.length > 0 && sponsorWindows.every((w) => {
  const first = words.find((x) => x.start >= w.startS - 1e-6)
  const lastIn = words.filter((x) => x.end <= w.endS + 1e-6).at(-1)
  const next = words.find((x) => x.start > w.endS - 1e-6)
  return first !== undefined && first.start - w.startS < 0.5 && lastIn !== undefined && (next === undefined || next.sentence !== lastIn.sentence) && first.w.startsWith(w.anchor.split(' ')[0] as string)
})
out(`sponsor: ${sponsorWindows.map((w) => `${w.kind} ${w.startS.toFixed(2)}–${w.endS.toFixed(2)} s « ${w.anchor} »`).join('; ') || 'none'}`)
check('the sponsor slot starts and ends on the mention’s words', slotOk, `${sponsorWindows.length} slot(s)`)
const sw = sponsorWindows[0]
if (sw) {
  const t = Math.min(sw.endS - 0.6, sw.startS + 1.5)
  const frame = await grab('avatar-edit-sponsor.png', t)
  // the QR code, read back from the film itself (full size frame)
  const full = path.join(dataDir, 'sponsor-full.png')
  await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', r.video, '-frames:v', '1', full], { signal })
  const { stderr } = await media.run('ffmpeg', ['-v', 'info', '-i', full, '-vf', 'format=gray,quirc', '-f', 'null', '-'], { signal })
  const payload = /payload: (\S+)/.exec(stderr)?.[1] ?? null
  check('the sponsor card with its QR code, which decodes to the link', payload === SPONSOR_LINK && (meta.layers ?? []).includes('sponsor-card'), `${frame}; QR → ${payload ?? 'not read'}`)
} else check('the sponsor card with its QR code, which decodes to the link', false, 'no sponsor slot')
const marks = (r.chapters.value ?? []) as { startS: number; endS: number }[]
const firstMark = marks[0]
check('a chapter mark pops at the top right when a numbered part starts', firstMark !== undefined && (meta.layers ?? []).includes('chapter'), firstMark ? `${marks.length} mark(s); ${await grab('avatar-edit-chapter.png', firstMark.startS + 0.8)}; ${await grab('avatar-edit-chapter-pop.png', firstMark.startS + 0.06)}` : 'none')
const subsNames = r.subs.map((f) => path.extname(f))
check('captions as SRT and WebVTT (burnt in only when the option says so), music under the voice', subsNames.includes('.srt') && subsNames.includes('.vtt') && r.nodes.includes('sound'), `${subsNames.join(' ')}; music: ${r.nodes.includes('sound') ? 'library' : 'none'}`)

// 7. several presenter shots: the portrait and two angles (plain stand-ins of the asset's pictures; the fake draws the framing)
const angleDir = path.join(dataDir, 'presenter')
mkdirSync(angleDir, { recursive: true })
const picture = async (name: string, colour: string): Promise<string> => {
  const file = path.join(angleDir, name)
  await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${colour}:s=640x360:d=1`, '-frames:v', '1', file], { signal })
  return file
}
const multi = await runAvatarBaseDemo({
  dataDir: path.join(dataDir, 'multi'),
  resourcesDir: path.join(ROOT, 'resources'),
  services: process.argv.includes('--tone-voice') ? { speech: undefined } : {},
  options: { presenterShots: 'multi' },
  presenter: {
    id: 'demo-presenter',
    portrait: await picture('portrait.png', '0x334455'),
    angles: [
      { framing: 'wide', file: await picture('wide.png', '0x445566') },
      { framing: 'close', file: await picture('close.png', '0x556677') }
    ],
    registrations: {}
  }
})
if (multi.status !== 'done' || !multi.video || !multi.plan) {
  check('the film with several presenter shots is made', false, `${multi.status} ${JSON.stringify(multi.errors)}`)
} else {
  const mClips = (multi.avatarClips ?? []) as TalkClip[]
  const framings = mClips.map((c) => c.framing)
  const neighbours = mClips.every((c, i) => i === 0 || c.framing !== mClips[i - 1]?.framing)
  const callsPerFraming = new Set(mClips.map((c) => `${c.framing}:${c.call}`)).size
  out(`several shots: ${framings.join(', ')} from ${(multi.avatarMeta as { calls?: number }).calls} generation(s)`)
  check('several presenter shots: each angle its own generation, neighbours never alike', mClips.length >= 2 && new Set(framings).size >= 2 && neighbours && callsPerFraming === new Set(framings).size, framings.join(', '))
  const saved: string[] = []
  for (const [i, c] of mClips.entries()) {
    const name = `avatar-multi-${i + 1}-${c.framing}.png`
    await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', ((c.startFrame + c.endFrame) / 60).toFixed(2), '-i', multi.video, '-frames:v', '1', '-vf', 'scale=960:-1', path.join(framesDir, name)], { signal })
    saved.push(name)
  }
  check('frames of the several-shots layout saved', saved.length === mClips.length, saved.join(', '))
}

// 8. production-8: the look, the clips from their still, the shared generations, and a contact sheet
const pics = (r.imageRecord ?? []) as { itemId: string; kind: string; prompt: string; style?: string; sameAs?: string }[]
const made = (r.clipRecord ?? []) as { itemId: string; part?: string }[]
const generated = pics.filter((p) => (p.kind === 'image.gen' || p.kind === 'video.gen') && p.sameAs === undefined)
out(`pictures: ${pics.length} (${generated.length} generated); clips: ${made.length} (${made.filter((c) => c.part).length} from shared generations)`)
for (const p of generated.slice(0, 3)) out(`  ${p.itemId} [${p.style ?? 'no style'}]: ${p.prompt.slice(0, 160)}…`)
check('the pictures wear the phone-real look', generated.length > 0 && generated.every((p) => p.style === 'phone-real@1' && p.prompt.includes('phone camera')), `${generated.length} generated`)
check('the clips are made from their still by clip.make', made.length > 0 && made.length === r.clips.length, `${made.length} clip(s)`)
check('eco: two shots share one generation (wide, then tight)', made.some((c) => c.part === 'tight'), made.map((c) => `${c.itemId}${c.part ? `:${c.part}` : ''}`).join(', '))
const sheetDir = path.join(dataDir, 'sheet')
mkdirSync(sheetDir, { recursive: true })
const tiles = [...r.images]
for (const [k, c] of r.clips.entries()) {
  const f = path.join(sheetDir, `clip-${k}.jpg`)
  // the stills' pixel format, so the tile filter never restarts mid-sequence
  await media.run('ffmpeg', ['-v', 'error', '-y', '-ss', '0.8', '-i', c, '-frames:v', '1', '-vf', 'format=yuvj444p', f], { signal })
  tiles.push(f)
}
tiles.forEach((f, k) => copyFileSync(f, path.join(sheetDir, `t${String(k).padStart(3, '0')}.jpg`)))
const cols = 4
const sheet = path.join(framesDir, 'avatar-base-contact-sheet.png')
await media.run(
  'ffmpeg',
  ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(sheetDir, 't%03d.jpg'), '-vf', `scale=480:270,tile=${cols}x${Math.ceil(tiles.length / cols)}:padding=6:color=white`, '-frames:v', '1', sheet],
  { signal }
)
check('contact sheet saved', true, `${tiles.length} tiles (stills, then a frame of each clip) → ${sheet}`)

out(failed === 0 ? '\nOK — the first avatar video on fakes.' : `\n${failed} check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
