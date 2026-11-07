// What `voice.tts` and `voice.own` share (docs/ENGINE-SPEC.md §19): the narration's final file (trimmed, fitted,
// loudness-normalised to about −16 LUFS, 48 kHz mono FLAC) and the time of every script word (`json.words`).
import path from 'node:path'
import { z } from 'zod'
import type { OutputValue } from '../artefacts'
import { EngineError } from '../errors'
import type { WordsMeta } from '../formats/timing'
import { normaliseAudio } from '../media/audio'
import { energyEnvelope, probe, speechRegions } from '../media/probe'
import { timeWords } from '../media/word-timing'
import type { RunCtx } from '../registry'
import { need, type AsrService, type TimedWord } from '../services'
import type { Json } from '../types'
import { parseScript } from '../text/script'
import { mapWords, trimPauses } from './voice-trim'

/** Loudness of every voice artefact (the master is made in render.assemble, R28.5). */
export const VOICE_LUFS = -16

/** How the narration's length is handled: as spoken, or fitted to the target length (decision, see STATUS P4). */
export const Pace = z.enum(['natural', 'fit'])

/** Largest stretch the `fit` pace applies (pitch-preserving, R19.4 allows 0.8–1.25; we stay closer to natural). */
export const MAX_FIT = 0.15

/** The range a measured pace (`wpm`) may stretch a voice to: a story short reads up to about twice a natural voice. */
const MIN_TEMPO = 0.6
const MAX_TEMPO = 2.4

/**
 * Cuts a spoken text into synthesis chunks of about `max` characters at paragraph, then sentence boundaries; a tail
 * under `minTail` characters joins the previous chunk (R19.1).
 */
export function splitChunks(text: string, max = 900, minTail = 200): string[] {
  const pieces: string[] = []
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.trim()
    if (!p) continue
    if (p.length <= max) {
      pieces.push(p)
      continue
    }
    let cur = ''
    for (const s of p.split(/(?<=[.!?…])\s+/u)) {
      if (cur && cur.length + 1 + s.length > max) {
        pieces.push(cur)
        cur = s
      } else cur = cur ? `${cur} ${s}` : s
    }
    if (cur) pieces.push(cur)
  }
  const chunks: string[] = []
  for (const piece of pieces) {
    const last = chunks.at(-1)
    if (last !== undefined && last.length + 2 + piece.length <= max) chunks[chunks.length - 1] = `${last}\n\n${piece}`
    else chunks.push(piece)
  }
  const tail = chunks.at(-1)
  if (chunks.length > 1 && tail !== undefined && tail.length < minTail) {
    chunks.pop()
    chunks[chunks.length - 1] = `${chunks.at(-1) as string}\n\n${tail}`
  }
  return chunks
}

export interface FinishInput {
  raw: string
  script: string
  language: string
  dir: string
  /** Word times from the provider, on `raw`'s clock. */
  provider?: TimedWord[]
  /** A recogniser that times the words here (a person's own recording); a synthetic voice is heard by words.align instead. */
  asr?: AsrService
  /** Cut leading and trailing silence (system voices, own recordings), keeping a short margin. */
  trim: boolean
  pace: z.infer<typeof Pace>
  targetS: number
  minMatch: number
  /** `voice.trim`: pauses longer than this are shortened to it before timing (absent: pauses kept as spoken). */
  maxPauseS?: number
  /** The narration's measured pace in words a minute: the voice is sped up or slowed down to it (pitch kept). Absent: as spoken. */
  wpm?: number
  meta: Record<string, Json>
}

/** The final voice file and its word times, as the two outputs `audio` and `words`. */
export async function finishVoice(ctx: RunCtx, o: FinishInput): Promise<{ audio: OutputValue; words: OutputValue }> {
  const media = need(ctx, 'media')
  // voice.trim comes first: every time taken afterwards (provider words, alignment) is on the trimmed clock
  let raw = o.raw
  let providerWords = o.provider
  let trimmedS = 0
  if (o.maxPauseS !== undefined) {
    ctx.emit({ kind: 'progress', frac: 0.6, text: 'Raccourcissement des silences' })
    const t = await trimPauses(media, o.raw, o.dir, o.maxPauseS, ctx.signal)
    raw = t.file
    trimmedS = t.removedS
    if (providerWords) providerWords = mapWords(providerWords, t.cuts)
  }
  const rawInfo = await probe(media, raw, ctx.signal)
  let from = 0
  let to = rawInfo.durationS
  if (o.trim) {
    const regions = speechRegions(await energyEnvelope(media, raw, ctx.signal))
    if (regions.length === 0) throw new EngineError('bad_input', 'La voix est silencieuse : aucun mot n’a été entendu.')
    from = Math.max(0, (regions[0] as { start: number }).start - 0.15)
    to = Math.min(rawInfo.durationS, (regions.at(-1) as { end: number }).end + 0.3)
  }
  let factor = 1
  if (o.wpm !== undefined) {
    // a channel's measured pace (a story short reads at about 1.8× a natural voice): the whole stretch, pitch kept
    const count = parseScript(o.script).tokens.length
    const spoken = to - from
    if (count > 0 && spoken > 0) factor = Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, o.wpm / ((count / spoken) * 60)))
    if (Math.abs(factor - 1) < 0.002) factor = 1
  } else if (o.pace === 'fit' && o.targetS > 0) {
    const want = (to - from) / o.targetS
    factor = Math.max(1 - MAX_FIT, Math.min(1 + MAX_FIT, want))
    if (Math.abs(factor - 1) < 0.002) factor = 1
    if (factor !== want) ctx.emit({ kind: 'log', level: 'warn', text: `pace fit limited to ×${factor.toFixed(3)} (needed ×${want.toFixed(3)})` })
  }
  const filters: string[] = []
  if (from > 0 || to < rawInfo.durationS) filters.push(`atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)}`, 'asetpts=PTS-STARTPTS')
  if (factor !== 1) filters.push(`atempo=${factor.toFixed(5)}`)
  const out = path.join(o.dir, 'voice.flac')
  ctx.emit({ kind: 'progress', frac: 0.7, text: 'Réglage du volume de la voix' })
  await normaliseAudio(
    media,
    raw,
    out,
    { targetLufs: VOICE_LUFS, ceilingDbtp: -1.5, codec: ['-c:a', 'flac'], sampleRate: 48_000, channels: 1, filterPrefix: filters.join(',') || undefined },
    ctx.signal
  )
  const durationS = (await probe(media, out, ctx.signal)).durationS
  // provider times follow the same cut and stretch as the audio
  const provider = providerWords?.map((w) => ({ word: w.word, start: (w.start - from) / factor, end: (w.end - from) / factor }))
  ctx.emit({ kind: 'progress', frac: 0.85, text: 'Calage des mots sur la voix' })
  // solidite (story-short at 310 wpm drifted): a sped-up voice keeps its 0.2 s pauses only as 0.2 / factor, below what
  // the energy aligner can hear (0.12 s), so it lost its sentence anchors and the captions drifted further each sentence.
  // Without provider times or a recogniser, the words are timed on the same cut at natural speed, then follow the stretch.
  const natural = factor !== 1 && !provider && !o.asr
  const timedOn = natural ? path.join(o.dir, 'voice-natural.flac') : out
  if (natural) {
    const cut = filters.filter((f) => !f.startsWith('atempo='))
    await normaliseAudio(media, raw, timedOn, { targetLufs: VOICE_LUFS, ceilingDbtp: -1.5, codec: ['-c:a', 'flac'], sampleRate: 48_000, channels: 1, filterPrefix: cut.join(',') || undefined }, ctx.signal)
  }
  const timed = await timeWords({
    script: o.script,
    language: o.language,
    audio: timedOn,
    durationS: natural ? (await probe(media, timedOn, ctx.signal)).durationS : durationS,
    media,
    signal: ctx.signal,
    ...(provider ? { provider } : {}),
    // a synthetic voice is heard by the speech recogniser in its own brick, words.align (record 0059)
    ...(o.asr ? { asr: o.asr } : {}),
    minMatch: o.minMatch
  })
  const t = natural ? { ...timed, words: timed.words.map((w) => ({ ...w, start: Math.min(durationS, w.start / factor), end: Math.min(durationS, w.end / factor) })) } : timed
  if (t.alignment === 'weak' || t.alignment === 'estimated') {
    ctx.emit({ kind: 'log', level: 'warn', text: `word timing ${t.alignment}: ${Math.round(t.matched * 100)} % of sentence ends matched` })
  }
  const wordsMeta: WordsMeta = { durationS, alignment: t.alignment, matched: t.matched, language: o.language }
  return {
    audio: { files: [out], meta: { ...o.meta, durationS, lufs: VOICE_LUFS, sampleRate: 48_000, fit: factor, language: o.language, ...(o.maxPauseS !== undefined ? { maxPauseS: o.maxPauseS, trimmedS } : {}) } },
    words: { value: t.words as unknown as Json, meta: { ...wordsMeta, demo: o.meta.demo ?? false } }
  }
}
