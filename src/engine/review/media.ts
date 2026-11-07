// The edit review's checks on the film and its sound (qualite-montage): what only the rendered frames and the voice show. Nothing moving
// on screen for seconds (a map that stops, a motion that freezes), a voice that breaks inside a word or clicks, music too loud in the
// pauses. The detectors are pure functions over ffmpeg's measures, so they are tested without a film.
import type { EditPlan, Shot } from '../formats/editplan'
import { FPS, type Word } from '../formats/timing'
import { energyEnvelope, ENERGY_FRAME_S } from '../media/probe'
import type { MediaService } from '../services'
import { fmtS, type Defect } from './types'

export interface Stretch {
  start: number
  end: number
}

/** Frozen stretches from `freezedetect` lines. */
export function parseFrozen(stderr: string, durationS: number): Stretch[] {
  const out: Stretch[] = []
  let open: number | null = null
  for (const m of stderr.matchAll(/freeze_(start|end):\s*([\d.]+)/g)) {
    const t = Number(m[2])
    if (m[1] === 'start') open = t
    else if (open !== null) {
      out.push({ start: open, end: t })
      open = null
    }
  }
  if (open !== null) out.push({ start: open, end: durationS })
  return out
}

/** Each frozen stretch at least `minS` long as a defect of the base shot it lies in (a held picture is fixed with a slow camera). */
export function frozenDefects(plan: EditPlan, frozen: readonly Stretch[], minS: number, movable: (s: Shot) => boolean): Defect[] {
  const byId = new Map(plan.shots.map((s) => [s.id, s]))
  const base = plan.tracks.base.map((id) => byId.get(id)).filter((s): s is Shot => s !== undefined)
  const out: Defect[] = []
  for (const f of frozen) {
    if (f.end - f.start < minS) continue
    const mid = (f.start + f.end) / 2
    const s = base.find((x) => x.startFrame / FPS <= mid && x.endFrame / FPS > mid)
    const fix = s && movable(s) && !s.motion ? { fix: { op: 'move' as const, shotId: s.id, zoom: 1.05 } } : {}
    out.push({
      kind: 'frozen',
      severity: 'fail',
      atS: Math.round(f.start * 100) / 100,
      endS: Math.round(f.end * 100) / 100,
      ...(s ? { shotId: s.id } : {}),
      detail: `Rien ne bouge à l’écran de ${fmtS(f.start)} à ${fmtS(f.end)} (${(f.end - f.start).toFixed(1)} s).`,
      ...fix
    })
  }
  return out
}

/** The film's frozen stretches (a low-resolution decode, 0.2–0.5× real time). */
export async function measureFrozen(media: MediaService, film: string, minS: number, durationS: number, signal: AbortSignal): Promise<Stretch[]> {
  const r = await media.run('ffmpeg', ['-v', 'info', '-i', film, '-an', '-vf', `scale=320:-2,freezedetect=n=0.0008:d=${minS}`, '-f', 'null', '-'], { signal })
  return parseFrozen(r.stderr, durationS)
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? -90 : (s[Math.floor(s.length / 2)] as number)
}

/** The longest pause between two words a voice keeps when its pipeline does not say (`voice.tts` `maxPauseS` stays under 0.6 s by
 *  default; avatar@1/@2 trim to 0.3, and the render's review passes the voice's own value). */
const PAUSE_MAX_S = 0.6
/** A trimmed pause measures a little longer than `maxPauseS` on the energy (the release's last frames under -50 dB count): 0.33 s at
 *  most for the 0.3 s of the three avatar voices. */
const PAUSE_EDGE_S = 0.04
/** How far a pause dips under the voice's room tone (its 10th percentile), measured on the three avatar voices: 5 to 11 dB. */
const PAUSE_DIP_DB = 12
/** Digital silence, as `energyEnvelope` measures zero samples (10·log10(1e-12) = -120): a hole this deep is never a pause. */
const DIGITAL_SILENCE_DB = -100
/** A release from speech to the pause, measured on the eleven pauses of the three avatar voices: it lasts 40 to 300 ms (4 frames at
 *  least), each 10 ms frame falls by 14 dB at most and never rises by more than 3 dB. A cut drops 48 dB or more in one frame. */
const RELEASE_MIN_FRAMES = 4
const RELEASE_STEP_DOWN_DB = 15
const RELEASE_STEP_UP_DB = 3
/** The release is the PREVIOUS word's: it leaves that word's level at most 10 frames into the recognised word (the recogniser's
 *  padding: 0 to 90 ms on the eleven pauses). What follows is judged by its shape: a word's own sound that stops (a plateau, then a
 *  cliff) is a cut wherever it is. Residual, by construction: a dropout whose sound DECAYS like a release (≤ 15 dB a frame) from the
 *  first 100 ms of a word that follows a clause end, as long as the voice's own pause and at its room tone, is taken for that pause. */
const RELEASE_LATEST_FRAMES = 10
/** A release keeps falling while it is near the previous word's level: three frames that fall less than 3 dB in all, within 15 dB of
 *  that level, are a held sound (the word's own onset), not a release. The measured pauses hold only deeper (« auf, » at -32 under
 *  -14, « ciment, » at -55 under -11). */
const RELEASE_HOLD_DB = 15

/** A word the text ends with a pause: a comma, a semicolon, a colon, a full stop, a question or exclamation mark, an ellipsis —
 *  never an abbreviation (« M. », « z.B. », « Dr. », « etc. ») or an ordinal (« am 3. Mai »), where nobody pauses. */
const CLAUSE_END = /[,;:.!?…]["»”’)]*$/
const ABBREVIATION = /^(?:(?:\p{L}\.)+|\d+\.|(?:dr|mr|mrs|ms|st|mme|mlle|etc|bzw|bspw|ggf|vgl|ca|usw|evtl|nr|str|prof|hr|fr|jh|abs|art)\.)["»”’)]*$/iu
const endsClause = (word: string): boolean => CLAUSE_END.test(word) && !ABBREVIATION.test(word)

/**
 * Whether a hole at the start of a word is the pause after the PREVIOUS word, which the recogniser started this word inside: the speech
 * in the 50 ms strictly before the word's recognised start runs into the word with no new attack (never 3 dB above it), leaves that
 * level within RELEASE_LATEST_FRAMES of the start, then DECAYS like a release down to within 10 dB of the hole's floor: at least
 * RELEASE_MIN_FRAMES long, no frame falling by more than RELEASE_STEP_DOWN_DB or rising by more than RELEASE_STEP_UP_DB, and never held
 * (RELEASE_HOLD_DB) near the previous word's level.
 */
function previousRelease(env: Float32Array, start: number, runStart: number, holeEnd: number, holeFloor: number, low: number): boolean {
  if (runStart <= start) return false
  const before = Array.from(env.slice(Math.max(0, start - 5), start))
  if (before.length < 5 || Math.min(...before) < low) return false
  const level = Math.max(...before)
  if (Math.max(...Array.from(env.slice(start, runStart))) > level + 3) return false
  let lastHigh = -1
  for (let i = start - 5; i < runStart; i++) if ((env[i] as number) >= level - 6) lastHigh = i
  if (lastHigh < 0 || lastHigh - start > RELEASE_LATEST_FRAMES) return false
  let firstLow = -1
  for (let i = lastHigh; i <= holeEnd; i++) {
    if ((env[i] as number) <= holeFloor + 10) {
      firstLow = i
      break
    }
  }
  if (firstLow < 0 || firstLow - lastHigh < RELEASE_MIN_FRAMES) return false
  for (let i = lastHigh + 3; i <= firstLow; i++) {
    const held = (env[i - 3] as number) - (env[i] as number) < 3
    if (held && Math.max(env[i - 3] as number, env[i] as number) > level - RELEASE_HOLD_DB) return false
  }
  for (let i = lastHigh + 1; i <= firstLow; i++) {
    const step = (env[i] as number) - (env[i - 1] as number)
    if (step < -RELEASE_STEP_DOWN_DB || step > RELEASE_STEP_UP_DB) return false
  }
  return true
}

/**
 * The voice's breaks, on its energy (dB per 10 ms frame): a hole inside a word (≥ 0.12 s at least 35 dB under the word, with speech
 * on both sides of it in the word) that is a cut, not a breath: right after a burst of 0.15 s at most (the « None » of the Markets clone
 * at 1:52, 50 ms of the word, then a quarter second of nothing), or below the voice's own room tone (digital silence). A pause the word
 * times happen to straddle sits at the room tone after a whole phrase: not a break. Clicks: one frame 25 dB over the 50 ms around it.
 */
export function voiceDefects(env: Float32Array, words: readonly Word[], o: { pauseMaxS?: number } = {}): Defect[] {
  const out: Defect[] = []
  const F = ENERGY_FRAME_S
  const floor = Array.from(env).sort((x, y) => x - y)[Math.floor(env.length * 0.1)] ?? -90
  const at = (t: number): number => Math.max(0, Math.min(env.length - 1, Math.round(t / F)))
  for (const [k, w] of words.entries()) {
    if (w.end - w.start < 0.3) continue
    // the next word's start: sound that comes back at (or after) it is the next word after a pause, not this word resuming
    // (recognised times often stretch a word over the pause after it; controles-bloquants, measured on Le Monde en POV's takes)
    const nextStart = words[k + 1]?.start ?? Infinity
    const a = at(w.start + 0.03)
    const b = at(w.end - 0.03)
    const levels = Array.from(env.slice(a, b + 1))
    const top = Math.max(...levels)
    const low = top - 35
    let run = 0
    let runStart = 0
    for (let i = a; i <= b; i++) {
      if ((env[i] as number) < low && (env[i] as number) < -50) {
        if (run === 0) runStart = i
        run++
      } else {
        let burst = 0
        while (runStart - burst - 1 >= a && (env[runStart - burst - 1] as number) >= low) burst++
        const hole = Math.min(...Array.from(env.slice(runStart, i)))
        // a pause the TEXT has (« Un, | par », « fertig, | Sie »), which the recogniser started the next word inside (avatar-base-marcel:
        // 10 of the 11 « cuts » of the three refused avatar renders): the previous word ends a clause, the sound before the hole is that
        // word's release, the hole is a pause (at the room tone, no digital silence, no longer than the voice's own longest pause).
        // Mid-sentence, after a word's own attack, a fast fall, a deeper hole or a longer one: still judged as a cut below
        const pauseMax = (o.pauseMaxS ?? PAUSE_MAX_S) + PAUSE_EDGE_S
        const textPause = k > 0 && endsClause((words[k - 1] as Word).w.trim())
        if (run > 0 && textPause && hole > DIGITAL_SILENCE_DB && hole >= floor - PAUSE_DIP_DB && run * F <= pauseMax && previousRelease(env, at(w.start), runStart, i, hole, low)) {
          run = 0
          continue
        }
        const cut = burst * F <= 0.15 || hole < floor - 6
        const resumesInWord = i * F < nextStart - 0.1
        if (run * F >= 0.12 && runStart > a && burst > 0 && cut && resumesInWord && Math.max(...Array.from(env.slice(a, runStart))) > low + 20) {
          out.push({
            kind: 'audio_dropout',
            severity: 'fail',
            atS: Math.round(runStart * F * 100) / 100,
            endS: Math.round(i * F * 100) / 100,
            said: w.w,
            detail: `La voix se coupe dans « ${w.w} » à ${fmtS(runStart * F)} (${(run * F).toFixed(2)} s de trou).`
          })
        }
        run = 0
      }
    }
  }
  for (let i = 5; i < env.length - 5; i++) {
    const me = env[i] as number
    const around = Math.max(...Array.from(env.slice(i - 5, i)), ...Array.from(env.slice(i + 1, i + 6)))
    if (me > around + 25 && around < -45) {
      out.push({ kind: 'audio_click', severity: 'warn', atS: Math.round(i * F * 100) / 100, endS: Math.round((i + 1) * F * 100) / 100, detail: `Un clic dans la voix à ${fmtS(i * F)}.` })
      i += 5
    }
  }
  return median(Array.from(env)) < -85 ? [] : out
}

/** The music in the pauses against the voice under the words, on the final mix: the music alone louder than 14 dB under the voice. */
export function musicDefect(env: Float32Array, words: readonly Word[]): Defect | null {
  const F = ENERGY_FRAME_S
  const speech: number[] = []
  const pauses: number[] = []
  for (const [i, w] of words.entries()) {
    for (let t = w.start + 0.05; t < w.end - 0.05; t += F) speech.push(env[Math.round(t / F)] ?? -90)
    const next = words[i + 1]
    if (next && next.start - w.end >= 0.3) for (let t = w.end + 0.08; t < next.start - 0.08; t += F) pauses.push(env[Math.round(t / F)] ?? -90)
  }
  if (speech.length < 100 || pauses.length < 50) return null
  const gap = median(speech) - median(pauses)
  if (gap >= 14) return null
  return { kind: 'music_loud', severity: 'warn', atS: 0, endS: words.at(-1)?.end ?? 0, detail: `La musique n’est que ${gap.toFixed(0)} dB sous la voix (au moins 14 dB attendus).` }
}

/** The sound checks: the voice file for breaks and clicks, the film's mix for the music level. */
export async function reviewSound(media: MediaService, o: { voice: string; film: string; words: readonly Word[]; music: boolean }, signal: AbortSignal): Promise<Defect[]> {
  if (o.words.length === 0) return []
  const out = voiceDefects(await energyEnvelope(media, o.voice, signal), o.words)
  if (o.music) {
    const m = musicDefect(await energyEnvelope(media, o.film, signal), o.words)
    if (m) out.push(m)
  }
  return out
}
