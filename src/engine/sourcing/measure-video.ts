// Measures of a reference video that a vision model can only guess: how long its shots are and how fast the voice speaks (issue #93,
// « Le Monde en POV »: the model said 135 words a minute and 4.5 s shots, the truth was 219 and 2.7 s). Here they are COUNTED, not
// estimated: shot cuts from ffmpeg's per-frame scene score, speech rate from real word times (faster-whisper on the audio when it is
// installed, else the video's own captions). Pure arithmetic except the programs run through an injectable `run` (tests never start
// one). Nothing here talks to YouTube or to a model.
import type { RunFn } from './types.ts'

/** The scene score above which two frames are a cut. 0.3 (ffmpeg's usual) misses soft cuts, fades and cuts between similar
 *  pictures: the reference studies measured with 0.08 on a 320 px, 24 fps copy and a 0.3 s refractory gap, and that is kept. */
export const CUT_SCORE = 0.08
/** Two cuts closer than this are one (a flash, a double detection on one transition). */
export const CUT_GAP_S = 0.3
/** A pause longer than this is not speech: it is left out of the speaking time. */
export const SPEECH_PAUSE_S = 2

export interface TimedWord {
  atS: number
  word: string
}

export interface ShotMeasure {
  durationS: number
  /** Number of shots (cuts + 1). */
  shots: number
  meanS: number
  medianS: number
  cutsPerMinute: number
  tempo: 'slow' | 'medium' | 'fast'
}

export interface SpeechMeasure {
  words: number
  /** Seconds of speech: first to last word, minus pauses over SPEECH_PAUSE_S. */
  speakingS: number
  wordsPerMinute: number
}

const r1 = (n: number): number => Math.round(n * 10) / 10
const r2 = (n: number): number => Math.round(n * 100) / 100

/** Cut times from `[time, score]` rows (one per frame), with the refractory gap. */
export function cutsFromScores(rows: readonly (readonly [number, number])[], threshold = CUT_SCORE, gapS = CUT_GAP_S): number[] {
  const cuts: number[] = []
  for (const [t, s] of rows) {
    if (s <= threshold || t <= gapS) continue
    const last = cuts[cuts.length - 1]
    if (last !== undefined && t - last < gapS) continue
    cuts.push(t)
  }
  return cuts
}

/** Parses ffmpeg's `metadata=print` output (frame lines `pts_time:`, then `lavfi.scene_score=`) into `[time, score]` rows. */
export function parseSceneScores(text: string): [number, number][] {
  const rows: [number, number][] = []
  let t: number | null = null
  for (const line of text.split(/\r?\n/)) {
    const pt = /pts_time:([0-9.]+)/.exec(line)
    if (pt) t = Number(pt[1])
    const sc = /lavfi\.scene_score=([0-9.]+)/.exec(line)
    if (sc && t !== null && Number.isFinite(t)) rows.push([t, Number(sc[1])])
  }
  return rows
}

/** Shot lengths and cut rate from the cut times and the video's duration. */
export function shotMeasure(cuts: readonly number[], durationS: number): ShotMeasure | null {
  if (!(durationS > 5)) return null
  const edges = [0, ...cuts.filter((c) => c > 0 && c < durationS), durationS]
  const lengths = edges.slice(1).map((e, i) => e - (edges[i] as number))
  const sorted = [...lengths].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
  const mean = durationS / lengths.length
  const cutsPerMinute = ((lengths.length - 1) / durationS) * 60
  const tempo = mean < 3.5 ? 'fast' : mean < 7 ? 'medium' : 'slow'
  return { durationS: r1(durationS), shots: lengths.length, meanS: r2(mean), medianS: r2(median), cutsPerMinute: r1(cutsPerMinute), tempo }
}

/** Words a minute from real word times: words over the speaking time, pauses longer than SPEECH_PAUSE_S left out. */
export function speechMeasure(words: readonly TimedWord[]): SpeechMeasure | null {
  const w = words.filter((x) => x.word.trim() && Number.isFinite(x.atS)).sort((a, b) => a.atS - b.atS)
  if (w.length < 20) return null
  let speaking = w[w.length - 1]!.atS - w[0]!.atS
  for (let i = 1; i < w.length; i++) {
    const gap = w[i]!.atS - w[i - 1]!.atS
    if (gap > SPEECH_PAUSE_S) speaking -= gap
  }
  if (!(speaking > 5)) return null
  return { words: w.length, speakingS: r1(speaking), wordsPerMinute: Math.round((w.length / speaking) * 60) }
}

/** The words of a YouTube `json3` caption file (auto captions carry a time for each word). */
export function wordsFromJson3(raw: string): TimedWord[] {
  let doc: { events?: { tStartMs?: number; segs?: { utf8?: string; tOffsetMs?: number }[] }[] }
  try {
    doc = JSON.parse(raw)
  } catch {
    return []
  }
  const out: TimedWord[] = []
  for (const ev of doc.events ?? []) {
    for (const seg of ev.segs ?? []) {
      const text = (seg.utf8 ?? '').trim()
      if (!text) continue
      const t0 = ((ev.tStartMs ?? 0) + (seg.tOffsetMs ?? 0)) / 1000
      const parts = text.split(/\s+/)
      parts.forEach((word, i) => out.push({ atS: t0 + (i * 0.3) / Math.max(1, parts.length), word }))
    }
  }
  return out
}

// ------------------------------------------------------------------------------------------------ the programs

/** ffmpeg arguments: the per-frame scene score of a 320 px, 24 fps copy, printed to stdout. */
export const sceneScoreArgs = (file: string): string[] => ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', "fps=24,scale=320:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=-", '-f', 'null', '-']

/** Cut times of a file by real scene detection. */
export async function detectCuts(file: string, run: RunFn, o: { signal?: AbortSignal; threshold?: number } = {}): Promise<number[]> {
  const { stdout } = await run('ffmpeg', sceneScoreArgs(file), { timeoutMs: 600_000, ...(o.signal ? { signal: o.signal } : {}) })
  return cutsFromScores(parseSceneScores(stdout), o.threshold)
}

/** Duration of a media file in seconds (ffprobe), null when it cannot be read. */
export async function probeDuration(file: string, run: RunFn): Promise<number | null> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeoutMs: 30_000 })
    const d = Number(stdout.trim())
    return Number.isFinite(d) && d > 0 ? d : null
  } catch {
    return null
  }
}

/** The python program that lists the words of an audio file with faster-whisper (word timestamps); it prints `[]` when the package
 *  is not installed, so the caller falls back to captions. */
export const WHISPER_SCRIPT = [
  'import sys, json',
  'try:',
  '    from faster_whisper import WhisperModel',
  'except Exception:',
  '    print("[]"); sys.exit(0)',
  'src = sys.argv[1]',
  // a 16 kHz mono wav is read with the standard library: recent PyAV releases broke faster-whisper's own decoder (seen 2026-11-03)
  'if src.lower().endswith(".wav"):',
  '    import wave, numpy',
  '    with wave.open(src, "rb") as f:',
  '        src = numpy.frombuffer(f.readframes(f.getnframes()), dtype=numpy.int16).astype(numpy.float32) / 32768.0',
  'm = WhisperModel(sys.argv[2] if len(sys.argv) > 2 else "base", device="cpu", compute_type="int8")',
  'segs, _ = m.transcribe(src, word_timestamps=True, vad_filter=True)',
  'print(json.dumps([[round(w.start, 2), w.word.strip()] for s in segs for w in (s.words or [])], ensure_ascii=True))'
].join('\n')

/** Words of an audio file by faster-whisper, or null when it is not installed (or fails). */
export async function whisperWords(audio: string, run: RunFn, o: { python?: string; model?: string; signal?: AbortSignal } = {}): Promise<TimedWord[] | null> {
  try {
    const { stdout } = await run(o.python ?? 'python', ['-I', '-c', WHISPER_SCRIPT, audio, o.model ?? 'base'], { timeoutMs: 1_200_000, ...(o.signal ? { signal: o.signal } : {}) })
    const rows = JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? '[]') as [number, string][]
    return rows.length > 0 ? rows.map(([atS, word]) => ({ atS, word })) : null
  } catch {
    return null
  }
}

export interface LocalMeasures {
  shots: ShotMeasure | null
  speech: SpeechMeasure | null
  /** Where the words came from. */
  wordsFrom: 'whisper' | 'captions' | null
}

/** Measures a local video: real cuts, and the speech rate from whisper on `audioFile` or, failing that, from `captionWords`. */
export async function measureFile(file: string, run: RunFn, o: { captionWords?: TimedWord[]; signal?: AbortSignal; audioFile?: string; python?: string } = {}): Promise<LocalMeasures> {
  const duration = await probeDuration(file, run)
  const cuts = duration ? await detectCuts(file, run, o) : []
  const shots = duration ? shotMeasure(cuts, duration) : null
  let words: TimedWord[] | null = null
  let wordsFrom: LocalMeasures['wordsFrom'] = null
  if (o.audioFile) {
    words = await whisperWords(o.audioFile, run, o)
    if (words) wordsFrom = 'whisper'
  }
  if (!words && o.captionWords && o.captionWords.length > 0) {
    words = o.captionWords
    wordsFrom = 'captions'
  }
  return { shots, speech: words ? speechMeasure(words) : null, wordsFrom }
}
