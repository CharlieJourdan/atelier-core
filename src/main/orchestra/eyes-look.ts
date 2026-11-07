// `eyes.look`: an agent looks at a video WITHOUT any paid key. From a local file, a finished run or a team file, ffmpeg
// takes N frames (half evenly spaced, the rest at scene changes) as small JPEGs under the workspace, ffprobe gives the
// duration / fps / size, and the transcript comes with it when Atelier has one (its own runs keep word timings; a .srt or
// .vtt next to a local file is read too). The frames go back to the agent's own model (Claude Code reads images through
// the MCP answer), so the analysis runs on the user's subscription: zero API cost. A YouTube link goes through Atelier
// Cloud's video analysis only when the Cloud has it on (its Gemini key); otherwise the answer gives the facts Atelier
// already read and the thumbnail links, and says that this is all it could see.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { probe } from '../../engine/media/probe'
import type { MediaService } from '../../engine/services'
import { logDigest, type WholeVideoLog } from '../../shared/shot-log'
import type { AnalysisResult } from '../../shared/video-analysis'
import { truncate } from './util'

export const MAX_FRAMES = 16
export const PASSES = {
  quick: { frames: 6, width: 384 },
  detailed: { frames: 12, width: 768 }
} as const
const SCENE_THRESHOLD = 0.35
/** Frames closer than this to one already taken are skipped (seconds). */
const MIN_GAP_S = 0.75
const TRANSCRIPT_CHARS = 6000

export interface LookInput {
  file?: string
  run?: number
  teamFile?: string
  url?: string
  pass?: 'quick' | 'detailed'
  frames?: number
}

export interface RunMedia {
  /** Absolute path of the run's final video (null before the render). */
  video: string | null
  words: { word: string; start: number; end: number }[]
  title: string
}

export interface YoutubeFacts {
  title: string
  views: number | null
  durationS: number | null
  publishedAt: string | null
}

export interface LookDeps {
  /** ffmpeg + ffprobe of this computer; null when they are not installed. */
  media: MediaService | null
  /** Where the frames are written (a folder under the workspace). */
  outDir: string
  /** The team folder (team files are relative to it). */
  teamDir: string
  runMedia?: (runId: number) => Promise<RunMedia>
  youtube?: {
    /** The Cloud is connected AND its video analysis is real (its Gemini key is set, paid calls on). */
    ready: (signal: AbortSignal) => Promise<boolean>
    analyse: (url: string, minutes: number, signal: AbortSignal) => Promise<{ analysis: AnalysisResult; demo: boolean }>
    facts: (videoId: string) => YoutubeFacts | null
    /** « Watch a whole video »: the shot log of the whole video (cached), null when it cannot be read whole. */
    whole?: (url: string, durationS: number | null, signal: AbortSignal) => Promise<{ log: WholeVideoLog; line: string } | null>
  }
  signal: AbortSignal
  /** A name for the frames folder (unique per call). */
  stamp: string
}

export interface LookResult {
  text: string
  /** The frames, in time order: what the agent's model sees. */
  images: { path: string; mimeType: 'image/jpeg'; atS: number }[]
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/^(www\.|m\.)?(youtube\.com|youtu\.be)$/i.test(u.hostname)) return null
    if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1).split('/')[0] || null
    const v = u.searchParams.get('v')
    if (v) return v
    const m = /^\/(shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname)
    return m?.[2] ?? null
  } catch {
    return null
  }
}

/** Keeps `file` inside `root` (a team file can never point outside the team folder). */
export function inside(root: string, rel: string): string {
  if (typeof rel !== 'string' || !rel.trim() || rel.includes('\0') || path.isAbsolute(rel) || path.win32.isAbsolute(rel)) throw new Error('A team file is a path relative to the team folder')
  if (rel.split(/[\\/]/).includes('..')) throw new Error('A team file cannot leave the team folder')
  return path.resolve(root, rel)
}

/** The times to look at: half evenly spaced, the rest at scene changes (spread), never two too close (0.75 s, less on a short clip). */
export function pickTimes(durationS: number, scenes: readonly number[], n: number): number[] {
  const count = Math.max(1, Math.min(MAX_FRAMES, Math.round(n)))
  const even = scenes.length ? Math.ceil(count / 2) : count
  const times: number[] = []
  const end = Math.max(0, durationS - 0.05)
  for (let i = 0; i < even; i++) times.push(Math.min(end, ((i + 0.5) * durationS) / even))
  const free = scenes.filter((s) => s > 0.2 && s < end).sort((a, b) => a - b)
  const want = count - times.length
  // the scene picks are spread over the whole list (not the first cuts only), then the rest fills the gaps
  const spread = Array.from({ length: Math.min(want, free.length) }, (_, j) => free[Math.floor(((j + 0.5) * free.length) / Math.min(want, free.length))] as number)
  const gap = Math.min(MIN_GAP_S, durationS / (count * 2))
  for (const s of [...spread, ...free]) {
    if (times.length >= count) break
    if (times.every((t) => Math.abs(t - s) >= gap)) times.push(s)
  }
  // too few distinct scene changes: the middle of the widest gaps fills the budget
  while (times.length < count) {
    const sorted = [0, ...times, durationS].sort((x, y) => x - y)
    let best = 0
    for (let i = 1; i < sorted.length; i++) if ((sorted[i] as number) - (sorted[i - 1] as number) > (sorted[best + 1] as number) - (sorted[best] as number)) best = i - 1
    const mid = ((sorted[best] as number) + (sorted[best + 1] as number)) / 2
    if (times.some((t) => Math.abs(t - mid) < 0.01)) break
    times.push(Math.min(end, mid))
  }
  return [...new Set(times.map((t) => Math.round(t * 100) / 100))].sort((x, y) => x - y)
}

const fps = (rate: string | undefined): number | null => {
  const [a, b] = (rate ?? '').split('/').map(Number)
  if (!a || !Number.isFinite(a)) return null
  const v = b ? a / b : a
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null
}

async function sceneTimes(media: MediaService, file: string, signal: AbortSignal): Promise<number[]> {
  const times: number[] = []
  try {
    await media.run('ffmpeg', ['-i', file, '-an', '-vf', `scale=160:-2,select='gt(scene,${SCENE_THRESHOLD})',showinfo`, '-f', 'null', '-'], {
      signal,
      onStderrLine: (line) => {
        const m = /pts_time:([\d.]+)/.exec(line)
        if (m && times.length < 200) times.push(Number(m[1]))
      }
    })
  } catch (e) {
    if (signal.aborted) throw e
    // scene detection is a bonus: evenly spaced frames still come
  }
  return times
}

/** A transcript beside a local file (`clip.srt` / `clip.vtt`), as plain text. */
function sidecarTranscript(file: string): string | null {
  for (const ext of ['.srt', '.vtt']) {
    const p = file.replace(/\.[^.\\/]+$/, '') + ext
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l) && l.trim() !== 'WEBVTT')
      .join(' ')
    return text.trim() || null
  }
  return null
}

/** Word timings as lines of about ten seconds: « [0:12] text… ». */
export function transcriptOf(words: readonly { word: string; start: number }[]): string {
  const lines: string[] = []
  let cur: string[] = []
  let at = 0
  for (const w of words) {
    if (cur.length && w.start - at >= 10) {
      lines.push(`[${clock(at)}] ${cur.join(' ')}`)
      cur = []
    }
    if (!cur.length) at = w.start
    cur.push(w.word)
  }
  if (cur.length) lines.push(`[${clock(at)}] ${cur.join(' ')}`)
  return lines.join('\n')
}

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

async function lookAtFile(file: string, deps: LookDeps, input: LookInput, transcript: string | null, origin: string): Promise<LookResult> {
  if (!deps.media) throw new Error('ffmpeg is not installed on this computer: eyes.look cannot take frames (Réglages › Moteur says how to install it)')
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`No video file at ${file}`)
  const pass = PASSES[input.pass === 'detailed' ? 'detailed' : 'quick']
  const n = Math.max(1, Math.min(MAX_FRAMES, input.frames !== undefined && Number.isInteger(input.frames) ? input.frames : pass.frames))
  const info = await probe(deps.media, file, deps.signal)
  const video = info.streams.find((s) => s.codec_type === 'video')
  if (!video) throw new Error(`${path.basename(file)} has no picture`)
  const scenes = await sceneTimes(deps.media, file, deps.signal)
  const times = pickTimes(info.durationS, scenes, n)
  const dir = path.join(deps.outDir, deps.stamp)
  mkdirSync(dir, { recursive: true })
  const images: LookResult['images'] = []
  for (const [i, t] of times.entries()) {
    const out = path.join(dir, `frame-${String(i + 1).padStart(2, '0')}-${t.toFixed(2)}s.jpg`)
    await deps.media.run('ffmpeg', ['-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${pass.width}:-2`, '-q:v', '5', out], { signal: deps.signal })
    if (existsSync(out)) images.push({ path: out, mimeType: 'image/jpeg', atS: t })
  }
  const rate = fps(video.avg_frame_rate) ?? fps(video.r_frame_rate)
  const lines = [
    `Looked at ${origin}: ${info.durationS.toFixed(1)} s, ${video.width ?? '?'}×${video.height ?? '?'}${rate ? `, ${rate} fps` : ''}, ${scenes.length} scene change(s) found.`,
    `${images.length} frame(s) (${input.pass === 'detailed' ? 'detailed' : 'quick'} pass, ${pass.width} px wide), attached in time order:`,
    ...images.map((im, i) => `${i + 1}. at ${clock(im.atS)} (${im.atS.toFixed(2)} s): ${im.path}`),
    '',
    transcript ? `Transcript:\n${truncate(transcript, TRANSCRIPT_CHARS)}` : 'No transcript: Atelier made none for this video (its own runs keep one).'
  ]
  return { text: lines.join('\n'), images }
}

async function lookAtYoutube(url: string, deps: LookDeps): Promise<LookResult> {
  const id = youtubeId(url)
  if (!id) throw new Error('Not a YouTube video link')
  const yt = deps.youtube
  if (yt && (await yt.ready(deps.signal).catch(() => false))) {
    const facts = yt.facts(id)
    const minutes = Math.min(15, Math.max(0.5, (facts?.durationS ?? 600) / 60))
    const { analysis, demo } = await yt.analyse(url, minutes, deps.signal)
    const a = analysis
    const lines = [
      `Atelier Cloud's video analysis of ${url}${demo ? ' (DEMO answer: an example, not a reading of this video)' : ''}, first ${minutes.toFixed(1)} min:`,
      `Summary: ${a.summary}`,
      `Hook (until ${a.hook.endsAtS} s, ${a.hook.technique}): ${a.hook.text}`,
      `Structure: ${a.structure.map((s) => `${s.kind} ${s.fromS}-${s.toS}s: ${s.summary}`).join(' | ')}`,
      `Pacing: ${a.pacing.cutsPerMinute} cuts/min, ${a.pacing.tempo}. ${a.pacing.notes}`,
      `Shots: ${a.shotTypes.join(', ')}`,
      `Music: ${a.music.present ? a.music.mood : 'none'}. ${a.music.notes}`,
      `Calls to action: ${a.callsToAction.length}`
    ]
    const whole = !demo && yt.whole ? await yt.whole(url, facts?.durationS ?? null, deps.signal).catch(() => null) : null
    lines.push(whole ? logDigest(whole.log) : `Only the first ${minutes.toFixed(1)} min were watched: the whole video could not be read, so say that cadence and structure hold for that start only.`)
    return { text: truncate(lines.join('\n'), 8000), images: [] }
  }
  const facts = yt?.facts(id) ?? null
  const whole = yt?.whole ? await yt.whole(url, facts?.durationS ?? null, deps.signal).catch(() => null) : null
  if (whole) return { text: truncate(`Whole-video reading of ${url}: ${whole.line}\n${logDigest(whole.log)}`, 8000), images: [] }
  const lines = [
    `I could not watch ${url}: video analysis is off on Atelier Cloud (it needs its Gemini key), and Atelier does not download YouTube videos.`,
    'What I have is only this:',
    facts
      ? `- ${facts.title} · ${facts.views ?? '?'} views · ${facts.durationS !== null ? `${Math.round(facts.durationS)} s` : 'length unknown'}${facts.publishedAt ? ` · published ${facts.publishedAt.slice(0, 10)}` : ''}`
      : '- no facts: this video is not among the channels Atelier read',
    `- thumbnails: https://i.ytimg.com/vi/${id}/maxresdefault.jpg and https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    'Say so in your answer: your judgement rests on the title, the numbers and the thumbnail, not on the video itself.'
  ]
  return { text: lines.join('\n'), images: [] }
}

export async function eyesLook(input: LookInput, deps: LookDeps): Promise<LookResult> {
  const sources = [input.file, input.run, input.teamFile, input.url].filter((v) => v !== undefined && v !== null && v !== '')
  if (sources.length !== 1) throw new Error('eyes.look needs exactly one source: file, run, teamFile or url')
  if (typeof input.url === 'string' && input.url) return lookAtYoutube(input.url, deps)
  if (typeof input.file === 'string' && input.file) {
    if (!path.isAbsolute(input.file)) throw new Error('file must be an absolute path')
    return lookAtFile(input.file, deps, input, sidecarTranscript(input.file), path.basename(input.file))
  }
  if (typeof input.teamFile === 'string' && input.teamFile) {
    const file = inside(deps.teamDir, input.teamFile)
    return lookAtFile(file, deps, input, sidecarTranscript(file), `team file ${input.teamFile}`)
  }
  if (typeof input.run !== 'number' || !Number.isInteger(input.run)) throw new Error('run must be a run id')
  if (!deps.runMedia) throw new Error('Production runs are not available here')
  const m = await deps.runMedia(input.run)
  if (!m.video) throw new Error(`Run #${input.run} has no final video yet`)
  return lookAtFile(m.video, deps, input, m.words.length ? transcriptOf(m.words) : null, `run #${input.run} « ${truncate(m.title, 80)} »`)
}
