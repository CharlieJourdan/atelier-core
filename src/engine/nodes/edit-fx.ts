// `edit.fx@1` (motion-montage, docs/ENGINE-SPEC.md §21.11, decision 0073): the style's editing kit applied to the director's plan, between
// `director.plan` (and `sound.music`) and `render.assemble`. It sets the transitions, the stills' camera moves and the punch-ins on the
// voice's accents (edit/grammar.ts), then makes the sound effects of the film (media/sfx.ts: the library's recordings; synthesised only with `sfxSynth`)
// and lays them into the music bed, so the render plays them with no change. Without a kit the node passes the plan and the music on.
// Free and local (no model, no provider); the same inputs and seed give the same edit.
import path from 'node:path'
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { applyEditKit, type KitReport } from '../edit/grammar'
import { repeatedPictures } from '../edit/inserts'
import { EDIT_KITS, EditKit, editKitOf, type EditKitName } from '../formats/edit-kit'
import { EditPlan, checkTimeline } from '../formats/editplan'
import { FPS, WordsValue, type Word } from '../formats/timing'
import { loadSfxLibrary, writeSfxStem, type SfxStemReport } from '../media/sfx'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { EngineError } from '../errors'
import { need } from '../services'
import type { Json } from '../types'
import { readValue, scratch } from './common'

export const EditFxParams = z.object({
  /** A measured kit by name, or a whole kit; absent: nothing changes. */
  kit: z.union([z.enum(Object.keys(EDIT_KITS) as [EditKitName, ...EditKitName[]]), EditKit]).optional(),
  /** Changes over a named kit, one level deep (`{ punches: { perMinute: 2 } }`). */
  changes: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  /** Read the voice's level on each word to find its accents (needs the voice; else the words alone). */
  energies: z.boolean().default(true),
  /** Synthesise an effect whose kind has no recording in the library (default false: such an event is dropped, with a warning). */
  sfxSynth: z.boolean().default(false)
})
type Params = z.infer<typeof EditFxParams>

/** The voice's RMS level on each word (16 kHz mono through ffmpeg). */
export async function wordEnergies(ctx: RunCtx, voice: string, words: readonly Word[]): Promise<number[]> {
  const rate = 16000
  const { stdout } = await need(ctx, 'media').run('ffmpeg', ['-v', 'error', '-i', voice, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { signal: ctx.signal })
  const pcm = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4))
  return words.map((w) => {
    const a = Math.max(0, Math.floor(w.start * rate))
    const b = Math.min(pcm.length, Math.max(a + 1, Math.floor(w.end * rate)))
    let sum = 0
    for (let i = a; i < b; i++) sum += (pcm[i] as number) ** 2
    return b > a ? Math.sqrt(sum / (b - a)) : 0
  })
}

async function run(ctx: RunCtx, inputs: ResolvedInputs, p: Params): Promise<NodeOutputs> {
  const plan = readValue(inputs.plan, EditPlan, 'the edit plan')
  const words = readValue(inputs.words, WordsValue, 'the words')
  const music = inputs.music?.files?.[0]
  // a shot that repeats the picture before it is an editing error: the render is refused, the plan is made again
  const repeats = repeatedPictures(plan.tracks.base.map((id) => plan.shots.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => s !== undefined))
  if (repeats.length) throw new EngineError('bad_input', `Le montage répète une image : ${repeats.slice(0, 3).join(' ; ')}`)
  const passOn: NodeOutputs = { plan: { value: plan as unknown as Json, meta: { kit: null } }, ...(inputs.music ? { music: inputs.music } : {}) }
  if (!p.kit) return passOn
  const kit = typeof p.kit === 'string' ? editKitOf(p.kit, (p.changes ?? {}) as never) : p.kit
  const voice = inputs.voice?.files?.[0]
  const energies = p.energies && voice ? await wordEnergies(ctx, voice, words).catch(() => undefined) : undefined
  const r = applyEditKit({ plan, words, kit, seed: ctx.seed, ...(energies ? { energies } : {}) })
  const known = new Set(plan.shots.map((s) => s.id))
  const again = repeatedPictures(r.plan.tracks.base.map((id) => r.plan.shots.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => s !== undefined), new Set(r.plan.shots.filter((s) => !known.has(s.id)).map((s) => s.id)))
  if (again.length) throw new EngineError('bad_input', `Le montage répète une image : ${again.slice(0, 3).join(' ; ')}`)
  const problems = checkTimeline(r.plan, plan.frames)
  if (problems.length) throw new Error(`edit.fx made a plan the checker refuses: ${problems.slice(0, 3).join('; ')}`)
  log(ctx, r.report)
  const durationS = plan.frames / FPS
  const dir = await scratch(ctx, 'edit-fx')
  const media = need(ctx, 'media')
  const stem = path.join(dir, 'sfx.wav')
  const library = await loadSfxLibrary(need(ctx, 'library').root)
  const sfxReport = await writeSfxStem({ events: r.sfx, durationS, seed: ctx.seed, library, media, signal: ctx.signal, levelDb: kit.sfx.levelDb, allowSynth: p.sfxSynth, out: stem })
  logDropped(ctx, sfxReport)
  // the effects go into the bed the render already plays (FLAC like `sound.music`'s); no bed: the effects are the bed
  const out = path.join(dir, 'music.flac')
  const args = music
    ? ['-i', music, '-i', stem, '-filter_complex', '[0:a]aresample=48000,aformat=channel_layouts=stereo[m];[1:a]aresample=48000,aformat=channel_layouts=stereo[s];[m][s]amix=inputs=2:normalize=0:duration=first[a]', '-map', '[a]']
    : ['-i', stem]
  await media.run('ffmpeg', ['-v', 'error', '-y', ...args, '-t', durationS.toFixed(3), '-c:a', 'flac', out], { signal: ctx.signal })
  return {
    plan: { value: r.plan as unknown as Json, meta: { kit: typeof p.kit === 'string' ? p.kit : 'custom', report: r.report as unknown as Json } },
    music: { files: [out], meta: { durationS, demo: false, sfx: r.sfx.length } },
    sfx: { files: [stem], value: r.sfx as unknown as Json, meta: { durationS, count: r.sfx.length, placed: sfxReport.placed.length, dropped: sfxReport.dropped.length } }
  }
}

/** Effects that did not sound: their kind has no recording in the library and synthesis is off. */
function logDropped(ctx: RunCtx, r: SfxStemReport): void {
  if (r.dropped.length === 0) return
  const kinds = [...new Set(r.dropped.map((d) => d.kind))].join(', ')
  ctx.emit({ kind: 'log', level: 'warn', text: `sound effects: ${r.dropped.length} dropped, no recording for ${kinds} (synthesis is off)` })
}

function log(ctx: RunCtx, r: KitReport): void {
  const tr = Object.entries(r.transitions)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ')
  ctx.emit({ kind: 'log', level: 'info', text: `edit kit: transitions ${tr || 'none'}; ${r.punches} punch-ins; ${r.sfx} sound effects; median shot ${r.rhythm.medianS.toFixed(1)} s` })
}

export const editFx = defineNode({
  type: 'edit.fx@1',
  inputs: {
    plan: { type: 'json.editplan', required: true },
    words: { type: 'json.words', required: true },
    voice: { type: 'audio.voice', required: false },
    music: { type: 'audio.music', required: false }
  },
  outputs: { plan: 'json.editplan', music: 'audio.music', sfx: 'audio.sfx' },
  params: EditFxParams,
  executors: ['local'],
  estimate: (ctx) => ({ units: [], durationS: 3 + ctx.minutes * 2 }),
  run,
  fake: run
})
