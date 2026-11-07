// Proof of the blocking checks (controles-bloquants, decision 0102) on a REAL film already made: re-measures a run's artefacts with the
// checks a render now runs before delivering — the voice cut inside words, word times drifting, the music bed under the voice (on the
// stems), holes in the film's sound, black and repeated pictures, frozen stretches — then applies the render's own music repair (the
// bed lowered in the final mix) and measures again. Free: ffmpeg only, nothing is paid, nothing is written next to the inputs.
//   node --import ./scripts/ts-resolve.mjs scripts/blocking-proof.ts --artefacts <video-N/artefacts> [--chunks <cache/voice-chunks>] [--out <dir>]
// The run's last voice, words, edit plan, music and film are taken from the artefact folder (its newest node of each kind).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EditPlan } from '../src/engine/formats/editplan'
import { FPS, WordsValue, type Word } from '../src/engine/formats/timing'
import { energyEnvelope } from '../src/engine/media/probe'
import { systemMediaService } from '../src/engine/media/tools'
import { localWhisperService } from '../src/engine/media/whisper'
import { mixFilter } from '../src/engine/render/final'
import { blackDefects, filmThumbs, frameDuplicates, measureBlack } from '../src/engine/review/blocking-film'
import { musicGapDb, soundHoles, timingDrift, wordsCut, SOUND_LIMITS } from '../src/engine/review/blocking-sound'
import { frozenDefects, measureFrozen, voiceDefects } from '../src/engine/review/media'
import { holesInTake } from '../src/engine/review/voice-holes'
import { fmtS, type Defect } from '../src/engine/review/types'

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const say = (s: string): void => void process.stdout.write(s + '\n')
const media = systemMediaService({ platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' })
if (!media) throw new Error('ffmpeg and ffprobe are needed')
const signal = new AbortController().signal
// the local recogniser (free), cached beside the other proofs
const asr = localWhisperService({ platform: process.platform, cacheDir: path.join(os.tmpdir(), 'atelier-blocking-proof-asr') })
const artefacts = path.resolve(arg('artefacts') ?? '.')
const out = path.resolve(arg('out') ?? path.join(os.tmpdir(), 'atelier-blocking-proof'))
mkdirSync(out, { recursive: true })

interface Output { type: string; files?: string[]; value?: unknown; meta?: Record<string, unknown> }
/** The newest node run of the folder that has an output of `type`. */
function newest(type: string): { dir: string; o: Output } {
  const runs = readdirSync(artefacts)
    .map((d) => path.join(artefacts, d, 'run.json'))
    .filter((f) => existsSync(f))
    .map((f) => ({ f, t: statSync(f).mtimeMs, r: JSON.parse(readFileSync(f, 'utf8')) as { outputs: Record<string, Output> } }))
    .sort((a, b) => b.t - a.t)
  for (const x of runs) for (const o of Object.values(x.r.outputs)) if (o.type === type) return { dir: path.dirname(x.f), o }
  throw new Error(`no ${type} in ${artefacts}`)
}
const file = (x: { dir: string; o: Output }): string => path.join(x.dir, (x.o.files ?? [])[0] as string)

const voice = file(newest('audio.voice'))
const words: Word[] = WordsValue.parse(newest('json.words').o.value)
const filmNode = newest('video.final')
const film = file(filmNode)
const plan = EditPlan.parse((filmNode.o.meta?.reviewedPlan as unknown) ?? newest('json.editplan').o.value)
const musicNode = (() => { try { return file(newest('audio.music')) } catch { return null } })()
const filmS = plan.frames / FPS
const list = (ds: readonly Defect[]): string => (ds.length ? ds.map((d) => `${fmtS(d.atS)} ${d.said ? `« ${d.said} » ` : ''}`).join(', ') : 'aucune')
say(`Film ${path.basename(film)} — ${fmtS(filmS)}, ${words.length} mots, ${plan.tracks.base.length} plans`)

const venv = await energyEnvelope(media, voice, signal)
const dropouts = voiceDefects(venv, words).filter((d) => d.kind === 'audio_dropout')
say(`VOIX COUPÉE DANS UN MOT : ${dropouts.length} — ${list(dropouts)}  → bloquant`)
const drift = timingDrift(venv, words)
say(`MOTS DÉCALÉS : ${drift ? drift.detail : 'non'}`)
const cut = wordsCut(words, filmS)
say(`MOTS COUPÉS PAR LA FIN : ${cut ? cut.detail : 'non'}`)

const chunks = arg('chunks')
if (chunks) {
  // what voice.tts now does on every take it receives: the takes with breaks are asked again before anything is built on them
  let takes = 0
  let broken = 0
  for (const f of readdirSync(chunks).filter((x) => x.endsWith('.json'))) {
    const rec = JSON.parse(readFileSync(path.join(chunks, f), 'utf8')) as { words?: { word: string; start: number; end: number }[]; demo?: boolean }
    const audio = path.join(chunks, f.replace(/\.json$/, '.flac'))
    if (rec.demo || !existsSync(audio)) continue
    // the provider's times, else the local recogniser's (as voice.tts does)
    const heard = rec.words?.length ? rec.words : asr ? (await asr.transcribe({ audio, language: arg('language') ?? 'fr' }, signal)).words : []
    if (heard.length === 0) continue
    takes++
    const holes = await holesInTake(media, audio, heard, signal)
    if (holes.length) broken++
  }
  say(`MORCEAUX DE VOIX REÇUS : ${takes}, dont ${broken} troués → redemandés par voice.tts avant le rendu`)
}

if (musicNode) {
  const menv = await energyEnvelope(media, musicNode, signal)
  const gap = musicGapDb(venv, menv, words)
  const need = gap === null ? 0 : SOUND_LIMITS.musicUnderVoiceDb - gap
  say(`MUSIQUE SOUS LA VOIX (pistes séparées) : ${gap?.toFixed(1)} dB (au moins ${SOUND_LIMITS.musicUnderVoiceDb}) → ${need > 0 ? 'bloquant' : 'ok'}`)
  if (need > 0) {
    // the render's repair: the bed lowered in the final mix, then the same measure on the lowered bed
    const db = -(Math.round((need + 1) * 10) / 10)
    const lowered = path.join(out, 'music-lowered.flac')
    // the same music chain as the final mix's (`mixFilter`), taken alone
    const chain = /\[2:a\]([^[]+)\[mu\]/.exec(mixFilter(true, db))?.[1] ?? `volume=${db}dB`
    await media.run('ffmpeg', ['-v', 'error', '-y', '-i', musicNode, '-af', chain, lowered], { signal })
    const after = musicGapDb(venv, await energyEnvelope(media, lowered, signal), words)
    say(`  APRÈS RÉPARATION (musique ${db} dB dans le mixage final) : ${after?.toFixed(1)} dB → ${after !== null && after >= SOUND_LIMITS.musicUnderVoiceDb ? 'ok' : 'toujours bloquant'}`)
    rmSync(lowered, { force: true })
  }
}

const holes = soundHoles(await energyEnvelope(media, film, signal), filmS)
say(`TROUS DANS LE SON DU FILM : ${holes.length} — ${list(holes)}`)
const black = blackDefects(await measureBlack(media, film, 0.4, signal))
say(`IMAGES NOIRES : ${black.length} — ${list(black)}`)
const frozen = frozenDefects(plan, await measureFrozen(media, film, 5, filmS, signal), 5, () => false)
say(`IMAGE FIGÉE ≥ 5 s : ${frozen.length} — ${list(frozen)}`)
const dupes = frameDuplicates(plan, await filmThumbs(media, film, plan, out, signal))
say(`MÊME IMAGE REVUE (film) : ${dupes.length} — ${dupes.map((d) => d.detail).join(' ') || 'aucune'}`)
rmSync(out, { recursive: true, force: true })
