// Several voices in one narration (docs/ENGINE-SPEC.md §19.5): a script with `NAME:` lines is cut into segments, one per
// run of lines said by the same character; each segment is voiced by that character's voice, and the pieces are laid end
// to end with a short silence at every change of speaker. The words keep the script's order, so captions and beats follow.
// A script without speaker tags never comes here: `voice.tts` runs exactly as before.
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { EngineError } from '../errors'
import { energyEnvelope, probe, speechRegions } from '../media/probe'
import { spokenText, timeWords } from '../media/word-timing'
import { need, type SpeechService, type TimedWord } from '../services'
import type { RunCtx } from '../registry'
import { parseScript, speakerKey, speakerSegments, type ParsedScript } from '../text/script'
import { hashOf, progress, throwIfAborted } from './common'
import { splitChunks } from './voice-common'
import { toneVoice } from './voice-tone'

/** Silence laid between two speakers' lines (seconds): a turn of a conversation, not a cut. */
export const SPEAKER_GAP_S = 0.25
/** Pitch step between two characters when only the tone voice is available (Hz). */
const TONE_STEP_HZ = 70

export interface SegmentPlan {
  /** Upper-case character name; absent = the narrator. */
  speaker?: string
  /** The voice that says it (the style's mapping, else the narrator's). */
  voice: string
  /** Index of its first and last token in the parsed script. */
  first: number
  last: number
  /** What is sent to the voice (spoken forms, paragraphs split by a blank line). */
  spoken: string
  /** The same words as written, to time them (the script's spelling, no tags). */
  written: string
}

/** The voice of every character: the mapping's key is matched in upper case; the others get the narrator's voice. */
export function voiceMap(speakers: Record<string, string> | undefined): Map<string, string> {
  return new Map(Object.entries(speakers ?? {}).map(([k, v]) => [speakerKey(k), v]))
}

/** Cuts a several-voices script into one segment per run of same-speaker paragraphs; empty for a single-voice script. */
export function planSegments(parsed: ParsedScript, forms: readonly string[], speakers: Record<string, string> | undefined, narrator: string): SegmentPlan[] {
  const map = voiceMap(speakers)
  return speakerSegments(parsed).map((seg) => {
    const spoken: string[][] = []
    const written: string[][] = []
    for (let i = seg.first; i <= seg.last; i++) {
      const t = parsed.tokens[i]
      if (!t) continue
      const k = t.paragraph - seg.paragraphs[0]
      ;(written[k] ??= []).push(t.w)
      const f = forms[i]
      if (f) (spoken[k] ??= []).push(f)
    }
    const join = (paras: string[][]): string => paras.filter((p) => p && p.length).map((p) => p.join(' ')).join('\n\n')
    return {
      ...(seg.speaker ? { speaker: seg.speaker } : {}),
      voice: (seg.speaker && map.get(seg.speaker)) || narrator,
      first: seg.first,
      last: seg.last,
      spoken: join(spoken),
      written: join(written)
    }
  })
}

export interface SpeakerPiece {
  text: string
  voice: string
  speaker?: string
  /** The first piece of a speaker's turn (after the first turn): a gap of silence goes before it. */
  gapBefore: boolean
}

/** The pieces to synthesise: each segment cut into chunks like a single narration, never merged across speakers. */
export function speakerPieces(plan: readonly SegmentPlan[], chunkChars: number): SpeakerPiece[] {
  return plan.flatMap((seg, i) =>
    splitChunks(seg.spoken, chunkChars).map((text, k) => ({ text, voice: seg.voice, ...(seg.speaker ? { speaker: seg.speaker } : {}), gapBefore: i > 0 && k === 0 }))
  )
}

/** The script's characters and the voice each one speaks with, for the artefact's meta. */
export function speakerMeta(plan: readonly SegmentPlan[]): { speakers: Record<string, string>; segments: number } {
  const speakers: Record<string, string> = {}
  for (const s of plan) speakers[s.speaker ?? 'NARRATEUR'] = s.voice
  return { speakers, segments: plan.length }
}

/** A silent FLAC of `SPEAKER_GAP_S` in the format of the voice chunks (48 kHz mono). */
export async function makeGap(ctx: RunCtx, dir: string): Promise<string> {
  const file = path.join(dir, 'gap.flac')
  await need(ctx, 'media').run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String(SPEAKER_GAP_S), '-c:a', 'flac', file], { signal: ctx.signal })
  return file
}

/** Joins audio files end to end (same codec and format) into `out`. */
export async function concatFlac(ctx: RunCtx, files: readonly string[], dir: string, out: string): Promise<void> {
  if (files.length === 1) {
    await copyFile(files[0] as string, out)
    return
  }
  const list = path.join(dir, 'join.txt')
  await writeFile(list, files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
  await need(ctx, 'media').run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'flac', out], { signal: ctx.signal })
}

/** Per distinct voice id, a system voice: the first by the usual pick, the next ones the next unused voices of the language. */
export function assignSystemVoices(
  ids: readonly string[],
  voices: readonly { id: string; name: string }[],
  first: string | undefined
): Map<string, { id: string; name: string }> {
  const out = new Map<string, { id: string; name: string }>()
  const used = new Set<number>()
  ids.forEach((id, n) => {
    if (voices.length === 0) return
    let at = n === 0 && first ? voices.findIndex((v) => v.id === first) : -1
    if (at < 0) at = parseInt(hashOf(id).slice(0, 6), 16) % voices.length
    for (let k = 0; k < voices.length && used.has(at); k++) at = (at + 1) % voices.length
    used.add(at)
    out.set(id, voices[at] as { id: string; name: string })
  })
  return out
}

export interface FakeSpeakersResult {
  raw: string
  provider: TimedWord[]
  /** What each segment sounded like, for the log and the proof. */
  segments: { speaker?: string; voice: string; systemVoice: string; durationS: number }[]
  source: 'system' | 'tone'
}

/**
 * The demo version: every segment spoken by the machine's voices (a different system voice per distinct voice id when
 * the machine has enough of them, else a tone at a different pitch), trimmed of its own silences, timed on its own audio,
 * then laid end to end with a gap. Word times are exact at the seams because each segment is timed alone.
 */
export async function fakeSpeakers(
  ctx: RunCtx,
  o: { parsed: ParsedScript; forms: readonly string[]; plan: readonly SegmentPlan[]; language: string; speed: number; systemVoice?: string; narrator: string; dir: string }
): Promise<FakeSpeakersResult> {
  const media = need(ctx, 'media')
  const speech: SpeechService | undefined = ctx.services.speech
  const all = speech ? await speech.voices(ctx.signal) : []
  const sameLang = all.filter((v) => v.language === o.language)
  const distinct = [...new Set(o.plan.map((s) => s.voice))]
  const picks = assignSystemVoices(distinct, sameLang, o.systemVoice && o.plan[0]?.voice === o.narrator ? o.systemVoice : undefined)
  if (sameLang.length > 0 && sameLang.length < distinct.length) ctx.emit({ kind: 'log', level: 'warn', text: `only ${sameLang.length} system voice(s) for "${o.language}": some characters share a voice` })
  if (!speech || sameLang.length === 0) ctx.emit({ kind: 'log', level: 'warn', text: `no system voice for language "${o.language}": tone voices` })
  const files: string[] = []
  const provider: TimedWord[] = []
  const segments: FakeSpeakersResult['segments'] = []
  const gap = o.plan.length > 1 ? await makeGap(ctx, o.dir) : ''
  let offset = 0
  for (const [i, seg] of o.plan.entries()) {
    throwIfAborted(ctx)
    const dir = path.join(o.dir, `segment-${i}`)
    await mkdir(dir, { recursive: true })
    const wav = path.join(dir, 'raw.wav')
    const chosen = picks.get(seg.voice)
    const label = chosen ? chosen.name : 'tone'
    progress(ctx, i, o.plan.length, `Voix ${seg.speaker ?? 'narrateur'} : ${label}`)
    if (speech && chosen) await speech.speak({ text: seg.spoken, voiceId: chosen.id, rate: o.speed, out: wav }, ctx.signal)
    else await toneVoice(seg.written, o.language, wav, Math.max(0, distinct.indexOf(seg.voice)) * TONE_STEP_HZ)
    if (!existsSync(wav)) throw new EngineError('internal', 'the system voice produced no file')
    // trim the segment's own silences (a short margin stays), then it can be laid against the next one
    const regions = speechRegions(await energyEnvelope(media, wav, ctx.signal))
    if (regions.length === 0) throw new EngineError('bad_input', 'La voix est silencieuse : aucun mot n’a été entendu.')
    const rawLen = (await probe(media, wav, ctx.signal)).durationS
    const from = Math.max(0, (regions[0] as { start: number }).start - 0.1)
    const to = Math.min(rawLen, (regions.at(-1) as { end: number }).end + 0.15)
    const flac = path.join(dir, 'segment.flac')
    await media.run(
      'ffmpeg',
      ['-v', 'error', '-y', '-i', wav, '-af', `atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)},asetpts=PTS-STARTPTS`, '-ac', '1', '-ar', '48000', '-c:a', 'flac', flac],
      { signal: ctx.signal }
    )
    const durationS = (await probe(media, flac, ctx.signal)).durationS
    const timed = await timeWords({
      script: seg.written,
      language: o.language,
      audio: flac,
      durationS,
      media,
      signal: ctx.signal,
      // the speech recogniser hears the whole voice in words.align (record 0059)
      minMatch: 0.9
    })
    const n = seg.last - seg.first + 1
    if (timed.words.length !== n) throw new EngineError('internal', `segment ${i}: ${timed.words.length} timed words for ${n} script words`)
    if (i > 0) {
      files.push(gap)
      offset += SPEAKER_GAP_S
    }
    // the node's word-timing step matches spoken words: give it each token's spoken words inside the token's time span
    timed.words.forEach((w, k) => {
      const parts = (o.forms[seg.first + k] ?? '').split(/\s+/).filter(Boolean)
      parts.forEach((word, m) => {
        const step = (w.end - w.start) / parts.length
        provider.push({ word, start: offset + w.start + step * m, end: offset + w.start + step * (m + 1) })
      })
    })
    files.push(flac)
    offset += durationS
    segments.push({ ...(seg.speaker ? { speaker: seg.speaker } : {}), voice: seg.voice, systemVoice: label, durationS })
  }
  const raw = path.join(o.dir, 'raw.flac')
  await concatFlac(ctx, files, o.dir, raw)
  return { raw, provider, segments, source: speech && picks.size > 0 ? 'system' : 'tone' }
}

/** Parses a script once for the speaker paths: the tokens, their spoken forms and the plan (empty when single-voice). */
export function readPlan(script: string, language: string, speakers: Record<string, string> | undefined, narrator: string): { parsed: ParsedScript; text: string; forms: string[]; plan: SegmentPlan[] } {
  const parsed = parseScript(script)
  const { text, forms } = spokenText(parsed, language)
  return { parsed, text, forms, plan: planSegments(parsed, forms, speakers, narrator) }
}
