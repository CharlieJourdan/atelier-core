// The real `eyes` service of the cloning engine (chantier moteur-analyse, spec §2 P2): the WHOLE video, in two halves.
//   prepare: the whole-video log (eyes 0085, cached), a normal download (fixed yt-dlp arguments, no cookies), word timings
//            by whisper (an error when no recogniser runs: words never go missing silently), loudness and the music bed,
//            the voice pitch, the evidence frames and the look sheets → `prepared.json` + the look prompts;
//   finish:  the answers of the look and script passes → the VideoAnalysis (assemble.ts).
// `analyse` runs both with the injected model (`Labeller`); a proof can answer the same prompts with a subagent between the
// halves. The downloaded file and the scratch frames are deleted at the end; evidence frames stay in the clone folder.
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CorpusVideo} from '../../../../shared/clone';
import { type VideoAnalysis } from '../../../../shared/clone'
import { WholeVideoLog } from '../../../../shared/shot-log'
import { probeDuration } from '../../../../engine/sourcing/measure-video'
import type { AsrService } from '../../../../engine/services'
import type { Labeller } from '../../../../engine/watch/label'
import type { RunFn } from '../../../../engine/sourcing/types'
import { DEFAULT_WATCH_USD, downloadArgs } from '../../../eyes/whole'
import type { Folder } from '../store'
import { measureLoudness, medianPitchHz, musicLevel, pcmArgs, type LoudnessLog, type MusicLevel } from './audio'
import { assembleAnalysis } from './assemble'
import { measureLetterbox, type LetterboxMeasure } from './letterbox'
import { frameOfLink, isPortrait, measureFrame, type FrameMeasure } from './frame'
import { frameSize, allFramesArgs, buildLookSheets, evidenceName, frameIndex, keepFrames, scratchName, shotFrameTime, tileArgs, type LookSheet } from './frames'
import { GlobalLook, IdentityRead, ScriptRead, globalLookPrompt, identityPrompt, identityShots, parseJsonObject, parseShotLooks, scriptPrompt, shotLookPrompt, transcriptLines, type ShotLook } from './look'
import { readForensics, type ShotForensics } from '../../../../engine/watch/forensics'
import { denseTimes, type Word } from './measures'

/** Sheets per model call (the labeller's own batching). */
export const SHEETS_PER_LOOK = 3

export interface AnalysisEyesDeps {
  /** The whole-video log of a link (eyes 0085 WholeWatcher.watch, cached). */
  /** With `file`: read that downloaded copy locally (scene detection, whisper, labels), cached apart from the link. */
  watch(input: { url: string; title: string; durationS: number | null; file?: string }, signal?: AbortSignal): Promise<WholeVideoLog>
  run: RunFn
  /** The speech recogniser (faster-whisper large-v3 on this computer). */
  asr: AsrService
  /** The vision/reading model; null in a proof that answers the prompts with a subagent. */
  looker: Labeller | null
  /** Scratch space for the download and the 0.5 s frames (deleted after each video). */
  scratchDir: string
  cloneId: string
  now(): string
  /** Dollars a video's model passes may cost (a subscription bills nothing). */
  maxLookUsd?: number
  /** A copy of the video already on this computer (a file the user supplied, or an earlier normal download kept for the
   *  side-by-side): measured instead of downloading again. */
  localCopy?(video: CorpusVideo): Promise<string | null>
  /** Fetches a public image (the thumbnail); absent in tests. */
  fetchImage?(url: string): Promise<Uint8Array | null>
  /** True when the whole-video log of a link is already cached (its reading costs nothing more). */
  cached?(url: string): Promise<boolean>
  /** The model runs on the user's subscription (bills nothing): its passes are quoted 0. */
  lookerOnSubscription?: boolean
  /** Dollars the reading of a link may cost when it is not cached (the model's reading when the download is refused). */
  watchMaxUsd?: number
}

export interface LookPrompt { id: string; prompt: string; images: string[] }

/** What `prepare` measured, saved as `prepared.json` in the video's folder. */
export interface Prepared {
  video: CorpusVideo
  log: WholeVideoLog
  words: Word[]
  language: string
  loudness: LoudnessLog | null
  music: MusicLevel | null
  pitchHz: number | null
  frames: [number, string][]
  thumbnail: string | null
  /** Frames drawn every 0.5 s into `<dir>/_frames` (deleted by `finish`). */
  frameCount: number
  sheets: LookSheet[]
  prompts: LookPrompt[]
  costUsd: number
  /** Why no file could be measured (the download was refused): the analysis says it. */
  noFile?: string
  /** The black bars measured on the 0.5 s frames (null: none; undefined: an older prepared file). */
  letterbox?: LetterboxMeasure | null
  /** The video's display frame (null: not readable; undefined: an older prepared file). */
  frame?: FrameMeasure | null
  /** The shots' palettes (src/engine/watch/forensics.ts); undefined on an older prepared file or when the pass failed. */
  forensics?: ShotForensics[]
}

/** Frequent short words per language: the spoken language from the shot words (the recogniser needs it). */
const STOPWORDS: Record<string, RegExp> = {
  fr: /\b(le|la|les|des|est|une|que|pas|pour|dans|vous|nous|c'est)\b/gi,
  en: /\b(the|and|is|you|that|this|for|with|are|was|it's)\b/gi,
  es: /\b(el|los|las|que|por|para|una|con|pero|está|es)\b/gi,
  de: /\b(der|die|das|und|ist|nicht|ein|eine|mit|ich|sie)\b/gi,
  it: /\b(il|che|non|per|una|sono|della|questo|anche|gli)\b/gi,
  pt: /\b(o|os|que|não|para|uma|com|você|isso|está)\b/gi
}
export function guessLanguage(text: string): string {
  const scores = Object.entries(STOPWORDS).map(([lang, re]) => [lang, text.match(re)?.length ?? 0] as const).sort((a, b) => b[1] - a[1])
  return scores[0]![1] > 0 ? scores[0]![0] : 'en'
}

export class AnalysisEyes {
  constructor(private readonly d: AnalysisEyesDeps) {}

  /** The most this video's analysis may bill (P2 quotes before spending): the link's reading unless cached, plus the
   *  look passes' cap when the model is not on a subscription. */
  async quoteUsd(video: CorpusVideo): Promise<number> {
    const read = (await this.d.cached?.(video.url)) ? 0 : (this.d.watchMaxUsd ?? DEFAULT_WATCH_USD)
    return read + (this.d.looker && !this.d.lookerOnSubscription ? (this.d.maxLookUsd ?? 0.5) : 0)
  }

  /** Everything measurable without a model, plus the prompts of the look and script passes. */
  async prepare(video: CorpusVideo, dir: Folder, signal?: AbortSignal): Promise<Prepared> {
    const sig = signal ? { signal } : {}
    let log = WholeVideoLog.parse(await this.d.watch({ url: video.url, title: video.title, durationS: video.durationS }, signal))
    await mkdir(this.d.scratchDir, { recursive: true })
    const scratch = await mkdtemp(path.join(this.d.scratchDir, 'p2-'))
    try {
      let thumbnail: string | null = null
      try {
        await this.d.run('yt-dlp', ['--ignore-config', '--no-warnings', '--no-cookies-from-browser', '--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg', '-o', path.join(dir.abs, 'thumbnail'), '--', video.url], { timeoutMs: 120_000, ...sig })
        if (existsSync(path.join(dir.abs, 'thumbnail.jpg'))) thumbnail = `${dir.rel}/thumbnail.jpg`
      } catch { /* a missing thumbnail is said by a null path */ }
      // a normal download (YouTube often refuses this PC's address: never got around; the analysis then says what it
      // could not measure and keeps what the whole-video log read on the public link)
      if (!thumbnail) thumbnail = await this.publicThumbnail(video, dir)
      let refused: string | null = null
      const copy = (await this.d.localCopy?.(video)) ?? null
      if (!copy) {
        try {
          await this.d.run('yt-dlp', downloadArgs(video.url, scratch), { timeoutMs: 1_800_000, ...sig })
        } catch (e) {
          if (signal?.aborted) throw e
          refused = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 200)
        }
      }
      const file = copy ? null : (await readdir(scratch)).find((f) => /^v\.(mp4|mkv|webm|mov)$/.test(f))
      if (!copy && !file) return await this.withoutFile(video, dir, log, thumbnail, refused ?? 'the platform served no file')
      const media = copy ?? path.join(scratch, file!)
      // the link's reading must cover the whole file: a model's reading (its own cut times) or a shorter log is read again
      // locally from the downloaded copy, so the shots are counted by scene detection over the whole video
      const fileS = await probeDuration(media, this.d.run)
      if (fileS && (log.coverage.cutsFrom === 'model' || Math.abs(log.coverage.durationS - fileS) > fileS * 0.02)) {
        log = WholeVideoLog.parse(await this.d.watch({ url: video.url, title: video.title, durationS: fileS, file: media }, signal))
      }

      // words (whisper large-v3): an error, never a silent gap
      const wav = path.join(scratch, 'a.wav')
      await this.d.run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', media, '-vn', '-ac', '1', '-ar', '16000', '-y', wav], { timeoutMs: 600_000, ...sig })
      const language = guessLanguage(log.shots.map((s) => s.words).join(' '))
      const heard = await this.d.asr.transcribe({ audio: wav, language }, signal ?? new AbortController().signal)
      const words: Word[] = heard.words.map((w) => ({ word: w.word, start: w.start, end: w.end }))
      if (words.length === 0 && log.stats.wordsPerMinute) throw new Error(`${video.id}: whisper heard no word in a video that speaks`)

      // sound
      let loudness: LoudnessLog | null = null
      try { loudness = await measureLoudness(media, this.d.run, signal) } catch { loudness = null }
      const music = loudness ? musicLevel(loudness, words) : null
      const pcm = path.join(scratch, 'a.pcm')
      await this.d.run('ffmpeg', pcmArgs(media, pcm), { timeoutMs: 600_000, ...sig })
      const buf = await readFile(pcm)
      const pitchHz = medianPitchHz(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2)), words)

      // frames: every 0.5 s into `<dir>/_frames` (kept until `finish` knows the parts and copies the dense windows), the
      // shot middles copied now as evidence
      // the video's own frame first: a vertical Short's frames are drawn upright (not shrunk inside a wide frame)
      const frame = (await measureFrame(this.d.run, media, signal).catch(() => null)) ?? frameOfLink(video.url)
      const size = frameSize(frame ? isPortrait(frame) : false)
      const all = path.join(dir.abs, '_frames')
      await mkdir(all, { recursive: true })
      await this.d.run('ffmpeg', allFramesArgs(media, all, size), { timeoutMs: 1_800_000, ...sig })
      const count = (await readdir(all)).filter((f) => /^f_\d+\.jpg$/.test(f)).length
      const letterbox = await measureLetterbox(this.d.run, all, size.w, size.h, signal).catch(() => undefined)
      // the palette of every shot: one more small ffmpeg pass (≈ 5 s for 10 minutes); a failure only skips the guard
      const forensics = await readForensics(media, log.shots, this.d.run, scratch, signal).catch(() => undefined)
      const durationS = log.coverage.durationS
      const shotTimes = log.shots.filter((s) => s.lengthS > 0).map((s) => shotFrameTime({ startS: s.startS, lengthS: s.lengthS }))
      const frames = await keepFrames(all, count, shotTimes, dir)
      const sheets = await buildLookSheets(all, count, log.shots.filter((s) => s.lengthS > 0), dir, this.d.run, signal)
      const hookSheet = path.join(dir.abs, 'sheets', 'hook.jpg')
      await tile(all, count, denseTimes(Math.min(10, durationS), [], durationS).slice(0, 20), hookSheet, this.d.run, signal)
      const sampleSheet = path.join(dir.abs, 'sheets', 'sample.jpg')
      const step = Math.max(1, Math.floor(shotTimes.length / 20))
      await tile(all, count, shotTimes.filter((_, k) => k % step === 0).slice(0, 20), sampleSheet, this.d.run, signal)

      const prompts: LookPrompt[] = []
      for (let k = 0; k < sheets.length; k += SHEETS_PER_LOOK) {
        const group = sheets.slice(k, k + SHEETS_PER_LOOK)
        prompts.push({ id: `shots-${k / SHEETS_PER_LOOK + 1}`, prompt: shotLookPrompt(group, log.shots), images: group.map((g) => g.file) })
      }
      prompts.push({ id: 'global', prompt: globalLookPrompt({ presenterSheet: null, sampleSheet: `${dir.rel}/sheets/sample.jpg`, hookSheet: `${dir.rel}/sheets/hook.jpg`, thumbnail, title: log.title }), images: [sampleSheet, hookSheet, ...(thumbnail ? [path.join(dir.abs, 'thumbnail.jpg')] : [])] })
      const presence = log.shots.filter((s) => s.kind === 'presenter').reduce((t, s) => t + s.lengthS, 0) / Math.max(durationS, 1)
      prompts.push({ id: 'script', prompt: scriptPrompt({ title: log.title, durationS, lines: transcriptFromWords(words, log), presenterOnScreenShare: presence }), images: [] })

      const prepared: Prepared = {
        video, log, words, language, loudness, music, pitchHz, frames: [...frames.entries()], frameCount: count, thumbnail, sheets,
        prompts, costUsd: log.cost.subscription ? 0 : log.cost.usd, ...(letterbox !== undefined ? { letterbox } : {}), frame,
        ...(forensics ? { forensics } : {})
      }
      await writeFile(path.join(dir.abs, 'prepared.json'), JSON.stringify(prepared), 'utf8')
      return prepared
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** The video's public thumbnail image (the page's own picture link) when yt-dlp could not fetch it. */
  private async publicThumbnail(video: CorpusVideo, dir: Folder): Promise<string | null> {
    const id = /(?:[?&]v=|youtu\.be\/|\/shorts\/)([\w-]{11})/.exec(video.url)?.[1]
    if (!id || !this.d.fetchImage) return null
    const bytes = await this.d.fetchImage(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`).catch(() => null)
    if (!bytes) return null
    await writeFile(path.join(dir.abs, 'thumbnail.jpg'), bytes)
    return `${dir.rel}/thumbnail.jpg`
  }

  /** No file to measure: the analysis keeps the whole-video log (shots, kinds, words per shot, on-screen text) and only
   *  the script and global passes; frames, sound, word timings and the per-shot looks are said not read. */
  private async withoutFile(video: CorpusVideo, dir: Folder, log: WholeVideoLog, thumbnail: string | null, why: string): Promise<Prepared> {
    if (!thumbnail) throw new Error(`${video.id}: no file and no thumbnail to show (${why}); nothing can serve as evidence`)
    const durationS = log.coverage.durationS
    const presence = log.shots.filter((s) => s.kind === 'presenter').reduce((t, s) => t + s.lengthS, 0) / Math.max(durationS, 1)
    const thumb = path.join(dir.abs, 'thumbnail.jpg')
    const prompts: LookPrompt[] = [
      { id: 'global', prompt: globalLookPrompt({ presenterSheet: null, sampleSheet: thumbnail, hookSheet: thumbnail, thumbnail, title: log.title }), images: [thumb] },
      { id: 'script', prompt: scriptPrompt({ title: log.title, durationS, lines: transcriptLines(log.shots), presenterOnScreenShare: presence }), images: [] }
    ]
    const prepared: Prepared = {
      video, log, words: [], language: guessLanguage(log.shots.map((s) => s.words).join(' ')), loudness: null, music: null, pitchHz: null,
      frames: [], frameCount: 0, thumbnail, sheets: [], prompts, costUsd: log.cost.subscription ? 0 : log.cost.usd, noFile: why,
      frame: frameOfLink(video.url)
    }
    await writeFile(path.join(dir.abs, 'prepared.json'), JSON.stringify(prepared), 'utf8')
    return prepared
  }

  /** The answers of the passes (by prompt id) → the analysis; the dense frames of the hook and of every part change are
   *  copied from `_frames`, which is then deleted. */
  async finish(p: Prepared, dir: Folder, answers: Record<string, string>, extraUsd = 0): Promise<VideoAnalysis> {
    const looks = new Map<number, ShotLook>()
    for (const [id, text] of Object.entries(answers)) if (id.startsWith('shots')) for (const [n, l] of parseShotLooks(text).looks) looks.set(n, l)
    const script = answers['script'] ? parseJsonObject(answers['script'], ScriptRead) : null
    const input = {
      cloneId: this.d.cloneId, createdAt: this.d.now(), video: p.video, log: p.log, words: p.noFile ? null : p.words, loudness: p.loudness, music: p.music, pitchHz: p.pitchHz,
      looks, global: withIdentity(answers['global'] ? parseJsonObject(answers['global'], GlobalLook) : null, answers['identity'] ? parseJsonObject(answers['identity'], IdentityRead) : null), script,
      frames: new Map(p.frames), thumbnail: p.thumbnail, costUsd: p.costUsd + extraUsd, ...(p.noFile ? { noFile: p.noFile } : {}),
      ...(p.letterbox !== undefined ? { letterbox: p.letterbox } : {}),
      ...(p.frame ? { frame: p.frame } : {}),
      ...(p.forensics ? { forensics: p.forensics } : {})
    }
    // a first assembly gives the parts; their dense windows are copied, then the final assembly sees them
    const parts = assembleAnalysis(input).parts
    const all = path.join(dir.abs, '_frames')
    const dense = denseTimes(parts[0]!.toS, parts.slice(1).map((x) => x.fromS), p.log.coverage.durationS)
    if (existsSync(all)) {
      for (const [t, rel] of await keepFrames(all, p.frameCount, dense, dir)) input.frames.set(t, rel)
      await rm(all, { recursive: true, force: true })
    } else {
      // finished before: the dense frames it kept are already in frames/
      for (const t of dense) if (existsSync(path.join(dir.abs, 'frames', evidenceName(t)))) input.frames.set(t, `${dir.rel}/frames/${evidenceName(t)}`)
    }
    return assembleAnalysis(input)
  }

  /** The whole analysis with the injected model. */
  async analyse(video: CorpusVideo, dir: Folder, signal?: AbortSignal): Promise<VideoAnalysis> {
    if (!this.d.looker) throw new Error('no vision model: the looks cannot be read')
    try {
      return await this.analyseOnce(video, dir, signal)
    } finally {
      await rm(path.join(dir.abs, '_frames'), { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async analyseOnce(video: CorpusVideo, dir: Folder, signal?: AbortSignal): Promise<VideoAnalysis> {
    const p = await this.prepare(video, dir, signal)
    // the model's answers are evidence too, saved as they come (a resume asks only what is missing, never twice)
    const file = path.join(dir.abs, 'look-answers.json')
    const keysFile = path.join(dir.abs, 'look-answers.keys.json')
    const read = async <T>(f: string): Promise<T | null> => { try { return existsSync(f) ? (JSON.parse(await readFile(f, 'utf8')) as T) : null } catch { return null } }
    const keyOf = (q: LookPrompt): string => createHash('sha256').update(JSON.stringify([q.prompt, q.images])).digest('hex').slice(0, 16)
    const savedKeys = (await read<Record<string, string>>(keysFile)) ?? {}
    const saved = (await read<Record<string, string>>(file)) ?? {}
    // an answer is reused only for the very prompt and pictures it answered
    const answers: Record<string, string> = Object.fromEntries(p.prompts.filter((q) => saved[q.id] && savedKeys[q.id] === keyOf(q)).map((q) => [q.id, saved[q.id]!]))
    const keys: Record<string, string> = Object.fromEntries(Object.keys(answers).map((id) => [id, savedKeys[id]!]))
    const put = async (f: string, v: unknown): Promise<void> => { await writeFile(`${f}.tmp`, JSON.stringify(v, null, 1), 'utf8'); await rename(`${f}.tmp`, f) }
    let usd = 0
    for (const q of p.prompts) {
      if (answers[q.id]) continue
      if (usd > (this.d.maxLookUsd ?? 0.5)) throw new Error(`${video.id}: the look passes passed their cap (${usd.toFixed(2)} $)`)
      const a = await this.d.looker!({ prompt: q.prompt, images: q.images, ...(signal ? { signal } : {}) })
      if (!a.subscription) usd += a.usd
      answers[q.id] = a.text
      keys[q.id] = keyOf(q)
      await put(file, answers)
      await put(keysFile, keys)
    }
    // the global pass sees a sample of the whole video: a presenter the shot passes saw but it did not describe is looked at
    // again on his own shots, so one sample without him never stops the clone (Finary v3)
    const looks = new Map<number, ShotLook>()
    for (const [id, text] of Object.entries(answers)) if (id.startsWith('shots')) for (const [n, l] of parseShotLooks(text).looks) looks.set(n, l)
    const global = answers['global'] ? parseJsonObject(answers['global'], GlobalLook) : null
    const ns = identityShots(looks)
    const frameOf = new Map(p.frames)
    const pics = ns.map((n) => p.log.shots.find((s) => s.n === n)).filter((s): s is NonNullable<typeof s> => !!s && s.lengthS > 0)
      .map((s) => frameOf.get(shotFrameTime({ startS: s.startS, lengthS: s.lengthS }))).filter((r): r is string => !!r)
      .map((rel) => path.join(dir.abs, 'frames', path.basename(rel))).filter((f) => existsSync(f))
    if (global && !global.identity && (global.presenterKind || ns.length > 0) && pics.length > 0) {
      const q: LookPrompt = { id: 'identity', prompt: identityPrompt({ title: p.log.title, shots: ns }), images: pics }
      if (!(saved['identity'] && savedKeys['identity'] === keyOf(q))) {
        const a = await this.d.looker!({ prompt: q.prompt, images: q.images, ...(signal ? { signal } : {}) })
        if (!a.subscription) usd += a.usd
        answers['identity'] = a.text
        keys['identity'] = keyOf(q)
        await put(file, answers)
        await put(keysFile, keys)
      } else answers['identity'] = saved['identity']
    }
    return this.finish(p, dir, answers, usd)
  }
}

/** The global look with the identity of the second look when the first gave none. */
export function withIdentity(g: GlobalLook | null, id: IdentityRead | null): GlobalLook | null {
  if (!g || g.identity) return g
  // the second look saw a drawn character of the story: no presenter (Le Monde en POV v4: its hero's face close-ups)
  if (id?.drawn) return { ...g, identity: null, presenterKind: null, drawnPresenter: true }
  if (!id?.identity) return g
  return { ...g, identity: id.identity, presenterKind: g.presenterKind ?? id.presenterKind }
}

async function tile(scratch: string, count: number, times: readonly number[], out: string, run: RunFn, signal?: AbortSignal): Promise<void> {
  const list = path.join(scratch, `${path.basename(out)}.txt`)
  await writeFile(list, times.map((t) => `file '${path.join(scratch, scratchName(frameIndex(t, count))).replace(/\\/g, '/').replace(/'/g, "'\\''")}'\nduration 0.04`).join('\n') + '\n', 'utf8')
  await run('ffmpeg', tileArgs(list, out), { timeoutMs: 120_000, ...(signal ? { signal } : {}) })
}

/** The timed transcript for the script pass, from the words (the log's shot words when whisper heard nothing). */
function transcriptFromWords(words: readonly Word[], log: WholeVideoLog): string[] {
  if (words.length === 0) return transcriptLines(log.shots)
  const pseudo: { startS: number; words: string }[] = []
  let from = words[0]!.start
  let buf: string[] = []
  for (const w of words) {
    if (w.start - from >= 15 && buf.length) { pseudo.push({ startS: from, words: buf.join(' ') }); buf = []; from = w.start }
    buf.push(w.word)
  }
  if (buf.length) pseudo.push({ startS: from, words: buf.join(' ') })
  return transcriptLines(pseudo, 0)
}
