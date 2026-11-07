// Which voice engine speaks a narration (decision 0021, production-model R3.4, ENGINE-SPEC R19.7). The voice is a
// consistency class: ONE engine speaks the whole narration. The pipeline's fallbacks are tried in order only while no piece
// of this narration exists yet (fresh or from the chunk cache); once one does, the narration is locked to that engine and
// a failure is reported (« Réessayer » / « Changer de voix »), never answered by another voice in the middle.
import { z } from 'zod'
import { EngineError } from '../errors'

/** `voice:<provider>-<model>` (src/shared/cloud-engines.ts). */
export const VoiceEngineId = z.string().regex(/^voice:[a-z0-9][a-z0-9.-]{0,60}$/)

/** The engine params of `voice.tts` (absent: the Cloud's default voice provider, as before engines existed). */
export const VoiceEngineParams = {
  /** The engine the pipeline picked for this brick (its pin). */
  engine: VoiceEngineId.optional(),
  /** Engines that may speak the WHOLE narration instead, in order, if the first one fails before any piece exists. */
  fallbacks: z.array(VoiceEngineId).max(4).optional(),
  /** The channel voice's id on each engine (one voice, several clones). `voice` serves the main engine when absent. */
  voices: z.record(VoiceEngineId, z.string().min(1).max(100)).optional()
}

export interface VoiceChoice {
  engine?: string
  voice: string
}

/** The engines that may speak this narration, in order, each with the channel voice's id on it; and the ones skipped. */
export function voiceChoices(p: { voice: string; engine?: string | undefined; fallbacks?: readonly string[] | undefined; voices?: Record<string, string> | undefined; speakers?: unknown }): {
  choices: VoiceChoice[]
  skipped: string[]
} {
  if (!p.engine) return { choices: [{ voice: p.voice }], skipped: [] }
  // the channel voice has no clone on the main engine but has one on a fallback (a voice cloned on ai33 before MiniMax led,
  // avatar-reglages-voix): that fallback leads, the main engine never gets another engine's voice id
  const cloned = (e: string): boolean => p.voices?.[e] !== undefined
  const lead = p.voices && Object.keys(p.voices).length > 0 && !cloned(p.engine) && p.speakers === undefined ? (p.fallbacks ?? []).find(cloned) : undefined
  const choices: VoiceChoice[] = lead ? [] : [{ engine: p.engine, voice: p.voices?.[p.engine] ?? p.voice }]
  const skipped: string[] = lead ? [p.engine] : []
  for (const e of p.fallbacks ?? []) {
    if (choices.some((c) => c.engine === e)) continue
    const voice = p.voices?.[e]
    // a fallback speaks only with a clone of the channel voice on it, and never for a several-voices script (its
    // characters' voice ids belong to the main engine)
    if (!voice || p.speakers !== undefined) skipped.push(e)
    else choices.push({ engine: e, voice })
  }
  return { choices, skipped }
}

/** Set as soon as one piece of the narration exists on the engine speaking it. */
export interface NarrationLock {
  produced: boolean
}

/** Errors after which the next engine may take the whole narration: the provider is down or failed (not money, not auth). */
const fallsBack = (e: unknown): boolean => e instanceof EngineError && (e.code === 'transient' || e.code === 'refused')

/**
 * Speaks the narration with the first engine that works, the whole narration on one engine. `speak` gets a fresh lock
 * per engine and must set `produced` as soon as a piece exists.
 */
export async function speakWithFallback<R>(
  choices: readonly VoiceChoice[],
  speak: (choice: VoiceChoice, lock: NarrationLock) => Promise<R>,
  log: (text: string) => void
): Promise<{ result: R; choice: VoiceChoice }> {
  for (const [i, choice] of choices.entries()) {
    const lock: NarrationLock = { produced: false }
    try {
      return { result: await speak(choice, lock), choice }
    } catch (e) {
      const next = choices[i + 1]
      if (!next || !fallsBack(e)) throw e
      if (lock.produced) {
        // R3.4 / R19.7: the voice never changes in the middle of a narration
        const err = e as EngineError
        throw new EngineError(
          err.code,
          `La voix (${choice.engine ?? 'par défaut'}) a échoué au milieu de la narration : ${err.message} Réessaie, ou change de voix pour toute la vidéo.`,
          err.permanent
        )
      }
      log(`voice engine ${choice.engine ?? 'default'} failed before the narration started (${(e as Error).message}): the whole narration goes to ${next.engine ?? 'default'}`)
    }
  }
  throw new EngineError('internal', 'no voice engine to speak with')
}
