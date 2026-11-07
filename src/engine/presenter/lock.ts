// Which presenter engine speaks a video (decision 0021, production-model R3.4, pipeline-avatar §2.5 b). The presenter is a
// consistency class: a face made on one engine looks different on another, so ONE engine makes the whole video. The
// pipeline's fallbacks are tried in order only while no generation of this video exists yet (fresh or from the cache); once
// one does, the video is locked to that engine and a failure is reported (the run waits), never answered by another engine
// in the middle: the presenter's face never changes mid-video.
import { EngineError } from '../errors'

/** Set as soon as one generation of the video exists on the engine making it. */
export interface PresenterLock {
  produced: boolean
}

/** Errors after which the next engine may take the whole video: the provider is down or refused (not money, not auth). */
const fallsBack = (e: unknown): boolean => e instanceof EngineError && (e.code === 'transient' || e.code === 'refused')

/**
 * Makes the video's presenter with the first engine that works, the whole video on one engine. `talk` gets a fresh lock per
 * engine and must set `produced` as soon as one generation exists. `engines` = [the pin, ...fallbacks]; `[undefined]` = the
 * Cloud's default provider.
 */
export async function talkWithFallback<R>(
  engines: readonly (string | undefined)[],
  talk: (engine: string | undefined, lock: PresenterLock) => Promise<R>,
  log: (text: string) => void
): Promise<{ result: R; engine: string | undefined }> {
  const list = engines.length > 0 ? engines : [undefined]
  for (const [i, engine] of list.entries()) {
    const lock: PresenterLock = { produced: false }
    try {
      return { result: await talk(engine, lock), engine }
    } catch (e) {
      const next = list[i + 1]
      if (lock.produced) {
        // R3.4: the presenter never changes engine in the middle of a video
        if (!(e instanceof EngineError)) throw e
        throw new EngineError(
          e.code,
          `Le présentateur (${engine ?? 'moteur par défaut'}) a échoué au milieu de la vidéo : ${e.message} Réessaie : un autre moteur ne prend jamais la suite au milieu (le visage changerait) ; pour changer de moteur, il refait tout le présentateur.`,
          e.permanent
        )
      }
      if (i + 1 >= list.length || !fallsBack(e)) throw e
      log(`presenter engine ${engine ?? 'default'} failed before the video's first generation (${(e as Error).message}): the whole presenter goes to ${next ?? 'default'}`)
    }
  }
  throw new EngineError('internal', 'no presenter engine to try')
}
