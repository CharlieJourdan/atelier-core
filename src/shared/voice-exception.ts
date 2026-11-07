// THE one exception to « voices: ai33 Pro only » (decision 0101, chantier voix-minimax, authorised by Charlie on 2026-11-04):
// the voices of HIS OWN three avatar channels may be cloned and spoken on MiniMax, nothing else. The rule is enforced by the
// Cloud (routes-user quote and jobs.create call `minimaxRefusal`): a REAL MiniMax adapter (engine `voice:minimax-28-hd`, or
// the usage's configured provider `minimax`) serves a voice job only when this list allows it; every other MiniMax clone,
// design or synthesis is refused with a French message. Adding a channel or a clone id here is a decision of Charlie's,
// recorded in docs/decisions/ (never a chantier's own choice). Pure: shared by the Cloud and the app.

/** The adapter ids that call MiniMax (the engine id of the voice registry and the plain provider id). */
export const MINIMAX_ADAPTER_IDS: readonly string[] = ['voice:minimax-28-hd', 'minimax']
export const isMinimaxAdapter = (adapterId: string): boolean => MINIMAX_ADAPTER_IDS.includes(adapterId)

export interface MinimaxExceptionChannel {
  /** YouTube handle of Charlie's own channel (the voice is his own, or the avatar's he owns). */
  handle: string
  /** The only voice NAME a clone job may carry for this channel (the app stores it as the voice's name). */
  cloneName: string
  /** The MiniMax voice ids cloned for this channel and validated to be spoken: the only ones a synthesis may name. */
  voiceIds: readonly string[]
}

export const MINIMAX_EXCEPTION: readonly MinimaxExceptionChannel[] = [
  { handle: '@exemple-chauffage', cloneName: 'minimax-exemple-chauffage', voiceIds: ['clone-0000000000000001'] },
  { handle: '@exemple-kundendienst', cloneName: 'minimax-exemple-kundendienst', voiceIds: ['clone-0000000000000002'] },
  { handle: '@exemple-compagnon', cloneName: 'minimax-aimelecompagnon', voiceIds: [] }
]

export const MINIMAX_EXCEPTION_CLONE_NAMES: readonly string[] = MINIMAX_EXCEPTION.map((c) => c.cloneName)
export const MINIMAX_EXCEPTION_VOICE_IDS: readonly string[] = MINIMAX_EXCEPTION.flatMap((c) => [...c.voiceIds])

const REFUSED =
  'MiniMax n’est autorisé que pour les voix des trois chaînes avatar de Charlie (exception du 2026-11-04, décision 0101) : toutes les autres voix passent par ai33 Pro.'

/**
 * Why a job a REAL MiniMax adapter would serve is refused, or null when it may go. `usage` is the job's usage; `input` its
 * validated input (`name` for a clone, `voiceId` for a synthesis).
 */
export function minimaxRefusal(usage: string, input: unknown): string | null {
  const i = (typeof input === 'object' && input !== null ? input : {}) as { name?: unknown; voiceId?: unknown }
  if (usage === 'cloneVoice') return typeof i.name === 'string' && MINIMAX_EXCEPTION_CLONE_NAMES.includes(i.name.trim()) ? null : REFUSED
  if (usage === 'synthesize') return typeof i.voiceId === 'string' && MINIMAX_EXCEPTION_VOICE_IDS.includes(i.voiceId) ? null : REFUSED
  return REFUSED
}
