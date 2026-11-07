// `npm run engine:dialogue-demo` — the proof of several voices in one video (docs/ENGINE-SPEC.md §19.5): our engine makes a real
// ~20 s vertical short from a two-character dialogue on this machine, free (demo mode: the operating system's voices, one per
// character; the gameplay background, the captions and the render are the real code; nothing recorded, nothing downloaded).
// Then it checks, and exits 1 if any check fails:
//   1. ffprobe: 1080×1920, 14 to 32 s, one audio stream;
//   2. the voice node cut the script into one segment per turn, with two different system voices for the two characters;
//   3. the track is the segments end to end with a gap at every change of speaker (durations add up);
//   4. every script word has a time, in order, and the speaker tags are not words;
//   5. "hear-proxy": the median pitch of each character, measured on its own words in the final track, is far from the
//      other's and stable from one turn of the same character to the next.
// Options: --data <dir> (default <tmp>/atelier-dialogue-demo), --language en|fr (default en: Windows has two English voices).
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DRAW_FILTERS } from '../src/engine/media/draw'
import { probe } from '../src/engine/media/probe'
import { FULL_FFMPEG_HINT, locateTool, RENDER_ENCODERS, RENDER_FILTERS, requireFilters, systemMediaService } from '../src/engine/media/tools'
import { runRedditShort } from '../src/engine/pipelines/reddit-short-demo'
import { CARD_FILTERS } from '../src/engine/nodes/card-intro'
import { parseScript, speakerSegments } from '../src/engine/text/script'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const dataDir = path.resolve(arg('data', path.join(os.tmpdir(), 'atelier-dialogue-demo')))
const language = arg('language', 'en')
const out = (s: string): void => void process.stdout.write(s + '\n')
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  out(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

const SCRIPTS: Record<string, string> = {
  en: [
    'ALICE: Did you see the moon tonight? It looks enormous over the lake.',
    'BOB: I know. I have never seen it so big and so bright in my whole life.',
    'ALICE: Then let us stay a little longer, just you and me.',
    'BOB: Fine, but only until the lights of the village go out.',
    'ALICE: Deal. And tomorrow we tell nobody about it.',
    'BOB: Not a soul. It will be our secret.'
  ].join('\n'),
  fr: [
    'ALICE: Tu as vu la lune ce soir ? Elle est immense au-dessus du lac.',
    'BOB: Oui, je ne l’avais jamais vue aussi grosse ni aussi brillante.',
    'ALICE: Alors restons encore un peu, juste toi et moi.',
    'BOB: D’accord, mais seulement jusqu’à ce que les lumières du village s’éteignent.',
    'ALICE: Marché conclu. Et demain nous n’en parlons à personne.',
    'BOB: Pas une âme. Ce sera notre secret.'
  ].join('\n')
}
const script = SCRIPTS[language] ?? (SCRIPTS.en as string)

const toolEnv = { platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' }
const media = systemMediaService(toolEnv)
if (!media) {
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run engine:dialogue-demo ».`)
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
const clips = path.join(dataDir, 'gameplay')
mkdirSync(clips, { recursive: true })
copyFileSync(path.join(ROOT, 'resources', 'fake-media', 'sample.mp4'), path.join(clips, 'a-sample.mp4'))
await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=12', '-vf', 'hue=h=120', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', path.join(clips, 'b-green.mp4')], { signal })

const parsed = parseScript(script)
const segments = speakerSegments(parsed)
out(`Atelier dialogue — ${segments.length} turns, characters ${parsed.speakers?.join(', ')} — data ${dataDir}`)
const run = await runRedditShort({
  dataDir,
  resourcesDir: path.join(ROOT, 'resources'),
  clipsDir: clips,
  script,
  topic: language === 'en' ? 'The moon over the lake' : 'La lune sur le lac',
  channel: 'Dialogues',
  minutes: 0.33,
  style: { language, speakers: { ALICE: 'demo-ava', BOB: 'demo-hugo' } },
  onEvent: (e) => (e.kind === 'start' ? out(`  ▶ ${e.nodeId}`) : e.kind === 'error' ? out(`  ✗ ${e.nodeId}: ${e.message}`) : undefined)
})
out(`\n— run: ${run.status} in ${(run.ms / 1000).toFixed(1)} s`)
if (run.status !== 'done' || !run.video || !run.voice.file) {
  check('the pipeline produces a video', false, `${run.status} ${JSON.stringify(run.errors)}`)
  process.exit(1)
}
out(`video: ${run.video}`)
out(`voice: ${run.voice.file}`)

// 1. ffprobe
const info = await probe(media, run.video, signal)
const v = info.streams.find((s) => s.codec_type === 'video')
const audio = info.streams.filter((s) => s.codec_type === 'audio')
check('1080×1920 (9:16), one audio stream, 14 to 32 s', v?.width === 1080 && v?.height === 1920 && audio.length === 1 && info.durationS >= 14 && info.durationS <= 32, `${v?.width}×${v?.height}, ${audio.length} audio, ${info.durationS.toFixed(2)} s`)

// 2. the voice node's segments and voices
const meta = run.voice.meta as { segments?: number; speakers?: Record<string, string>; systemVoice?: string; segmentS?: number[]; durationS?: number; source?: string }
const names = (meta.systemVoice ?? '').split(', ').filter(Boolean)
out(`voice meta: ${JSON.stringify({ source: meta.source, segments: meta.segments, speakers: meta.speakers, systemVoice: meta.systemVoice })}`)
check('one segment per turn, two different voices', meta.segments === segments.length && new Set(names).size >= 2, `${meta.segments} segments for ${segments.length} turns; system voices: ${names.join(' | ') || 'none (tone voice)'}`)

// 3. durations
const segS = meta.segmentS ?? []
const gaps = 0.25 * (segS.length - 1)
const sum = segS.reduce((a, b) => a + b, 0)
const voiceInfo = await probe(media, run.voice.file, signal)
out('durations per segment (s): ' + segments.map((s, i) => `${s.speaker ?? 'narrator'}#${i + 1} ${segS[i]?.toFixed(2)}`).join(' · '))
out(`sum ${sum.toFixed(2)} s + ${segS.length - 1} gaps × 0.25 s = ${(sum + gaps).toFixed(2)} s; the voice file is ${voiceInfo.durationS.toFixed(2)} s`)
check('segments end to end with a gap at every change of speaker', segS.length === segments.length && Math.abs(voiceInfo.durationS - (sum + gaps)) < 1.0 && voiceInfo.durationS <= sum + gaps + 0.01, `voice ${voiceInfo.durationS.toFixed(2)} s vs ${(sum + gaps).toFixed(2)} s (the final trim takes at most the outer margins)`)

// 4. words
const words = run.voice.words as { w: string; start: number; end: number }[]
const tokens = parsed.tokens
let ordered = true
let prev = 0
for (const w of words) {
  if (w.start < prev - 1e-6 || w.end < w.start) ordered = false
  prev = w.start
}
check('every script word has a time, in order; no tag is a word', words.length === tokens.length && ordered && words.every((w, i) => w.w === tokens[i]?.w) && !words.some((w) => /^(ALICE|BOB):?$/.test(w.w)), `${words.length} timed words for ${tokens.length} script words`)

// 5. hear-proxy: the median pitch (autocorrelation on 40 ms frames of the voiced parts) of each turn's words
const RATE = 16_000
async function pitchOf(from: number, to: number): Promise<number> {
  const r = await (media as NonNullable<typeof media>).run('ffmpeg', ['-v', 'error', '-ss', from.toFixed(3), '-t', Math.max(0.3, to - from).toFixed(3), '-i', run.voice.file as string, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { signal })
  const x = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength - (r.stdout.byteLength % 4)))
  const frame = Math.round(0.04 * RATE)
  const minLag = Math.round(RATE / 400)
  const maxLag = Math.round(RATE / 70)
  const f0s: number[] = []
  for (let at = 0; at + frame + maxLag < x.length; at += Math.round(0.02 * RATE)) {
    let e0 = 0
    for (let k = 0; k < frame; k++) e0 += (x[at + k] as number) ** 2
    if (e0 / frame < 1e-4) continue // silence or breath
    let best = 0
    let bestLag = 0
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0
      let e1 = 0
      for (let k = 0; k < frame; k++) {
        c += (x[at + k] as number) * (x[at + k + lag] as number)
        e1 += (x[at + k + lag] as number) ** 2
      }
      const n = c / Math.sqrt(e0 * e1 + 1e-12)
      if (n > best) {
        best = n
        bestLag = lag
      }
    }
    if (best > 0.6) f0s.push(RATE / bestLag)
  }
  f0s.sort((a, b) => a - b)
  return f0s.length >= 5 ? (f0s[Math.floor(f0s.length / 2)] as number) : NaN
}
const perSpeaker = new Map<string, number[]>()
const lines: string[] = []
for (const [i, seg] of segments.entries()) {
  const a = words[seg.first] as { start: number }
  const b = words[seg.last] as { end: number }
  const f0 = await pitchOf(a.start, b.end)
  lines.push(`${seg.speaker}#${i + 1} ${a.start.toFixed(2)}–${b.end.toFixed(2)} s pitch ${f0.toFixed(0)} Hz`)
  perSpeaker.set(seg.speaker ?? '', [...(perSpeaker.get(seg.speaker ?? '') ?? []), f0])
}
out(lines.join(String.fromCharCode(10)))
const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length
const alice = mean(perSpeaker.get('ALICE') ?? [NaN])
const bob = mean(perSpeaker.get('BOB') ?? [NaN])
const within = (xs: number[] | undefined, m: number): number => Math.max(...(xs ?? [NaN]).map((x) => Math.abs(x - m) / m))
const spread = Math.max(within(perSpeaker.get('ALICE'), alice), within(perSpeaker.get('BOB'), bob))
const apart = Math.abs(alice - bob) / Math.min(alice, bob)
check('the two characters sound different, each stays itself', Number.isFinite(apart) && apart > 2 * spread && apart > 0.15, `median pitch ALICE ${alice.toFixed(0)} Hz vs BOB ${bob.toFixed(0)} Hz (${(apart * 100).toFixed(0)} % apart; a character varies by at most ${(spread * 100).toFixed(0)} % between its own turns)`)

const failed = checks.filter((c) => !c.ok)
writeFileSync(path.join(dataDir, 'dialogue-demo-report.json'), JSON.stringify({ video: run.video, voice: run.voice.file, meta, checks }, null, 2))
out(`\n===== DIALOGUE: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${checks.length - failed.length}/${checks.length} checks) =====`)
out(`video: ${run.video}`)
process.exit(failed.length === 0 ? 0 : 1)
