// `voice.tts@1` (docs/ENGINE-SPEC.md §19): the narration by a synthetic voice, with the time of every word.
// run: through Atelier Cloud (the resold voice provider, credits per character): the spoken text is cut into ~900
// character chunks, each one a Cloud job with its own idempotency key and a local per-chunk cache, so a failed run pays
// only the missing chunks (R19.1, R19.3). fake (demo, R1.6): the operating system's voice (macOS `say`, Windows SAPI),
// marked demo; without one, a tone per word at the target pace so timing stays realistic.
import { mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { EngineError } from '../errors'
import { probe } from '../media/probe'
import { spokenText } from '../media/word-timing'
import { defineNode, type RunCtx } from '../registry'
import { need, type TimedWord } from '../services'
import { parseScript } from '../text/script'
import { atomicCopy, atomicWrite, hashOf, metaNumber, progress, readText, scratch, throwIfAborted } from './common'
import { Pace, finishVoice, splitChunks } from './voice-common'
import { speakWithFallback, voiceChoices, VoiceEngineParams, type NarrationLock, type VoiceChoice } from './voice-engines'
import { toneVoice } from './voice-tone'
import { holesInTake } from '../review/voice-holes'
import { concatFlac, fakeSpeakers, makeGap, readPlan, speakerMeta, speakerPieces, SPEAKER_GAP_S, type SpeakerPiece } from './voice-speakers'

export const VoiceTtsParams = z.object({
  /** Platform voice id (Cloud catalogue), e.g. `demo-claire`. A style sets it through `$style.voice`. */
  voice: z.string().min(1).default('demo-claire'),
  language: z.string().min(2).default('fr'),
  /** 0.7–1.2, the provider's native speed (R19.4). */
  speed: z.number().min(0.7).max(1.2).default(1),
  pace: Pace.default('natural'),
  chunkChars: z.number().int().min(300).max(3000).default(900),
  parallel: z.number().int().min(1).max(8).default(4),
  /** Demo only: a system voice name to use instead of the one picked for the language. */
  systemVoice: z.string().optional(),
  /** Several voices (§19.5): character name (as in the script's `NAME:` lines) to voice id; the narrator and any character
   *  not listed use `voice`. Absent for a single-voice script, so its fingerprint does not change. */
  speakers: z.record(z.string().min(1).max(40), z.string().min(1).max(100)).optional(),
  ...VoiceEngineParams,
  /** `voice.trim`: pauses longer than this are shortened to it before timing (0.6 from the technology; absent: kept). */
  maxPauseS: z.number().min(0.2).max(3).optional(),
  /** The channel's measured pace in words a minute (a story short: about 310): the voice is stretched to it, pitch kept. */
  wpm: z.number().min(80).max(450).optional(),
  /** Takes asked again for a chunk whose voice breaks inside a word (controles-bloquants; absent: 1, so fingerprints do not change). */
  holeRetries: z.number().int().min(0).max(3).optional()
})
type Params = z.infer<typeof VoiceTtsParams>

/** Characters the provider will be billed for: the spoken text (estimate from the script's meta when known). */
function estimateChars(meta: Record<string, unknown> | undefined, minutes: number): number {
  const chars = meta?.chars
  if (typeof chars === 'number') return chars
  const words = meta?.words
  return Math.round((typeof words === 'number' ? words : minutes * 150) * 6.2)
}

interface ChunkResult {
  file: string
  durationS: number
  words: TimedWord[]
  demo: boolean
}

/** Runs `work` over `items` with at most `n` in flight, keeping the order of results. */
async function pool<T, R>(items: readonly T[], n: number, work: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await work(items[i] as T, i)
    }
  })
  await Promise.all(lanes)
  return out
}

async function cloudVoice(
  ctx: RunCtx,
  script: string,
  p: Params,
  dir: string,
  choice: VoiceChoice,
  lock: NarrationLock
): Promise<{ raw: string; words: TimedWord[] | undefined; demo: boolean }> {
  const cloud = need(ctx, 'cloud')
  const media = need(ctx, 'media')
  const cacheDir = await need(ctx, 'workspace').cache('voice-chunks')
  const read = readPlan(script, p.language, p.speakers, choice.voice)
  // a single-voice script is cut exactly as before; a several-voices one is cut per speaker's turn (§19.5)
  const pieces: SpeakerPiece[] =
    read.plan.length > 0 ? speakerPieces(read.plan, p.chunkChars) : splitChunks(read.text, p.chunkChars).map((text) => ({ text, voice: choice.voice, gapBefore: false }))
  let billed = 0
  let done = 0
  const inflight = new Map<string, Promise<ChunkResult>>()
  // the engine is part of the key only when the pipeline names one (keys made before engines existed stay valid)
  const keyOf = (piece: SpeakerPiece): string =>
    hashOf({ v: 1, voice: piece.voice, speed: p.speed, language: p.language, text: piece.text, seed: ctx.seed, ...(choice.engine ? { engine: choice.engine } : {}) })
  const results = await pool(pieces, p.parallel, (piece, i): Promise<ChunkResult> => {
    // two identical chunks in one script share their key: made once (one job, one payment)
    const k = keyOf(piece)
    const known = inflight.get(k)
    if (known) return known
    const work = oneChunk(piece, i)
    inflight.set(k, work)
    return work
  })
  async function oneChunk(piece: SpeakerPiece, i: number): Promise<ChunkResult> {
    throwIfAborted(ctx)
    // the node seed is part of every chunk key (R33.2): "regenerate" never returns a cached chunk
    const key = keyOf(piece)
    const file = path.join(cacheDir, `${key}.flac`)
    const record = path.join(cacheDir, `${key}.json`)
    if (existsSync(file) && existsSync(record)) {
      // an unreadable record is a miss, never a failure (the chunk is simply made again)
      const r = (await readFile(record, 'utf8').then(JSON.parse).catch(() => null)) as Omit<ChunkResult, 'file'> | null
      // a demo chunk cached by an earlier run is asked again in a real run (solidite)
      if (r && typeof r.durationS === 'number' && Array.isArray(r.words) && !(r.demo && ctx.services.cloud?.realRun === true)) {
        lock.produced = true
        progress(ctx, ++done, pieces.length, `${done} blocs sur ${pieces.length}`)
        return { ...r, file }
      }
    }
    // a take whose voice breaks inside a word is asked again (a new job), and the take with the fewest breaks is kept
    let best: (Omit<ChunkResult, 'file'> & { tmp: string; holes: number }) | null = null
    const retries = p.holeRetries ?? 1
    for (let take = 0; take <= retries; take++) {
      const r = await oneTake(piece, i, key, take)
      if (!best || r.holes < best.holes) best = r
      if (r.holes === 0 || r.demo) break
      ctx.emit({ kind: 'log', level: 'warn', text: `voice chunk ${i + 1}: ${r.holes} break(s) inside words in take ${take + 1}${take < retries ? ': asked again' : ''}` })
    }
    const kept = best as NonNullable<typeof best>
    const result = { durationS: kept.durationS, words: kept.words, demo: kept.demo, ...(kept.holes > 0 ? { holes: kept.holes } : {}) }
    // audio first, record last, each atomically: a record always points at a complete file (R7.7)
    await atomicCopy(kept.tmp, file)
    await atomicWrite(record, JSON.stringify(result))
    progress(ctx, ++done, pieces.length, `${done} blocs sur ${pieces.length}`)
    return { ...result, file }
  }
  async function oneTake(piece: SpeakerPiece, i: number, key: string, take: number): Promise<Omit<ChunkResult, 'file'> & { tmp: string; holes: number }> {
    const chunk = piece.text
    const jobDir = path.join(dir, take === 0 ? `chunk-${i}` : `chunk-${i}-take-${take + 1}`)
    await mkdir(jobDir, { recursive: true })
    const res = await cloud
      .synthesize({ text: chunk, voiceId: piece.voice, wordTimings: true, ...(choice.engine ? { engine: choice.engine } : {}) }, { idempotencyKey: take === 0 ? `voice-${key}` : `voice-${key}-take-${take + 1}`, signal: ctx.signal, dir: jobDir })
      .catch((e: unknown) => {
        // a real engine refuses a demonstration voice (essais-utilisateur: a new channel's first real run stopped on « le fournisseur
        // a refusé ce contenu », ai33 answering 400 to `demo-claire`): said plainly, with what to do
        if (ctx.services.cloud?.realRun === true && piece.voice.startsWith('demo-') && !ctx.signal.aborted && e instanceof EngineError && e.code === 'refused' && !/démo/i.test(e.message)) {
          throw new EngineError('missing_input', 'La chaîne n’a qu’une voix de démonstration : donne-lui une vraie voix (Chaîne › Voix : cloner la tienne, importer une voix) avant une vraie fabrication.')
        }
        throw e
      })
    lock.produced = true
    billed += chunk.length
    const tmp = path.join(jobDir, 'chunk.flac')
    await media.run('ffmpeg', ['-v', 'error', '-y', '-i', res.audioFile, '-ac', '1', '-ar', '48000', '-c:a', 'flac', tmp], { signal: ctx.signal })
    const durationS = (await probe(media, tmp, ctx.signal)).durationS
    // join check (R19.3): provider times are kept only if they agree with the file's real length
    const trusted = res.durationS === undefined || Math.abs(res.durationS - durationS) <= 0.15
    const words = trusted ? res.words : []
    // the provider's word times, else the local recogniser's (free; ai33 sends none): without either the take cannot be checked here and
    // the render's review measures the whole voice on its aligned words
    const asr = ctx.services.asr
    const heard = words.length > 0 || res.demo || !asr ? words : await asr.transcribe({ audio: tmp, language: p.language }, ctx.signal).then((r) => r.words).catch(() => [])
    // a check that cannot run never loses the paid take: it stays unchecked here and the render's review measures it
    const holes = res.demo ? 0 : (await holesInTake(media, tmp, heard, ctx.signal).catch(() => [])).length
    return { durationS, words, demo: res.demo, tmp, holes }
  }
  ctx.reportCost({ units: [{ unit: 'chars', qty: billed }], provider: 'voice' })
  // join the chunks end to end (a silence between two speakers); provider times are offset by the chunks and gaps before them
  const raw = path.join(dir, 'raw.flac')
  const gap = pieces.some((x) => x.gapBefore) ? await makeGap(ctx, dir) : ''
  const order: string[] = []
  let offset = 0
  let complete = true
  const words: TimedWord[] = []
  for (const [i, r] of results.entries()) {
    if ((pieces[i] as SpeakerPiece).gapBefore) {
      order.push(gap)
      offset += SPEAKER_GAP_S
    }
    order.push(r.file)
    if (r.words.length === 0) complete = false
    for (const w of r.words) words.push({ word: w.word, start: w.start + offset, end: w.end + offset })
    offset += r.durationS
  }
  await concatFlac(ctx, order, dir, raw)
  return { raw, words: complete ? words : undefined, demo: results.some((r) => r.demo) }
}

export const voiceTts = defineNode({
  type: 'voice.tts@1',
  inputs: { script: { type: 'text.script', required: true } },
  outputs: { audio: 'audio.voice', words: 'json.words' },
  params: VoiceTtsParams,
  reads: ['minutes'],
  executors: ['cloud'],
  estimate: (ctx, p) => {
    const chars = estimateChars(ctx.inputs.script?.meta, ctx.minutes)
    return { units: [{ unit: 'chars', qty: chars }], provider: 'voice', durationS: 15 + Math.ceil(chars / p.chunkChars / p.parallel) * 20 }
  },
  async run(ctx, inputs, p) {
    const script = readText(inputs.script, 'the script')
    const dir = await scratch(ctx, 'voice')
    progress(ctx, 0, 1, 'Voix : envoi au Cloud')
    const { choices, skipped } = voiceChoices(p)
    const warn = (text: string): void => ctx.emit({ kind: 'log', level: 'warn', text })
    if (skipped.length > 0) warn(`voice fallbacks without a clone of the channel voice (skipped): ${skipped.join(', ')}`)
    const { result, choice } = await speakWithFallback(choices, (c, lock) => cloudVoice(ctx, script, p, dir, c, lock), warn)
    const { raw, words, demo } = result
    const multi = readPlan(script, p.language, p.speakers, choice.voice).plan
    return finishVoice(ctx, {
      raw,
      script,
      language: p.language,
      dir,
      ...(words ? { provider: words } : {}),
      trim: false,
      pace: p.pace,
      targetS: ctx.minutes * 60,
      minMatch: 0.9,
      ...(p.maxPauseS !== undefined ? { maxPauseS: p.maxPauseS } : {}),
      ...(p.wpm !== undefined ? { wpm: p.wpm } : {}),
      meta: {
        voice: choice.voice,
        demo,
        source: 'cloud',
        chars: metaNumber(inputs.script, 'chars') ?? script.length,
        ...(choice.engine ? { engine: choice.engine, fallback: choice.engine !== p.engine } : {}),
        ...(multi.length > 0 ? speakerMeta(multi) : {})
      }
    })
  },
  async fake(ctx, inputs, p) {
    const script = readText(inputs.script, 'the script')
    const dir = await scratch(ctx, 'voice')
    const read = readPlan(script, p.language, p.speakers, p.voice)
    if (read.plan.length > 0) {
      const f = await fakeSpeakers(ctx, { parsed: read.parsed, forms: read.forms, plan: read.plan, language: p.language, speed: p.speed, narrator: p.voice, dir, ...(p.systemVoice ? { systemVoice: p.systemVoice } : {}) })
      return finishVoice(ctx, {
        raw: f.raw,
        script,
        language: p.language,
        dir,
        provider: f.provider,
        trim: true,
        pace: p.pace,
        targetS: ctx.minutes * 60,
        minMatch: 0.9,
        ...(p.maxPauseS !== undefined ? { maxPauseS: p.maxPauseS } : {}),
      ...(p.wpm !== undefined ? { wpm: p.wpm } : {}),
        meta: { voice: p.voice, demo: true, source: f.source, systemVoice: [...new Set(f.segments.map((x) => x.systemVoice))].join(', '), ...speakerMeta(read.plan), segmentS: f.segments.map((x) => +x.durationS.toFixed(3)) }
      })
    }
    const raw = path.join(dir, 'raw.wav')
    const speech = ctx.services.speech
    let voiceName = 'tone'
    if (speech) {
      const voices = await speech.voices(ctx.signal)
      const sameLang = voices.filter((v) => v.language === p.language)
      const chosen = p.systemVoice ? voices.find((v) => v.id === p.systemVoice) : sameLang[parseInt(hashOf(p.voice).slice(0, 6), 16) % Math.max(1, sameLang.length)]
      if (chosen) {
        progress(ctx, 1, 10, `Voix système : ${chosen.name}`)
        const { text } = spokenText(parseScript(script), p.language)
        await speech.speak({ text, voiceId: chosen.id, rate: p.speed, out: raw }, ctx.signal)
        voiceName = chosen.name
      } else ctx.emit({ kind: 'log', level: 'warn', text: `no system voice for language "${p.language}": tone voice` })
    }
    if (voiceName === 'tone') await toneVoice(script, p.language, raw)
    if (!existsSync(raw)) throw new EngineError('internal', 'the system voice produced no file')
    return finishVoice(ctx, {
      raw,
      script,
      language: p.language,
      dir,
      trim: true,
      pace: p.pace,
      targetS: ctx.minutes * 60,
      minMatch: 0.9,
      ...(p.maxPauseS !== undefined ? { maxPauseS: p.maxPauseS } : {}),
      ...(p.wpm !== undefined ? { wpm: p.wpm } : {}),
      meta: { voice: p.voice, demo: true, source: voiceName === 'tone' ? 'tone' : 'system', systemVoice: voiceName, ...(p.engine ? { engine: p.engine } : {}) }
    })
  }
})
