// The real adapters of the voice engines (decision 0029): one adapter per engine, whose id IS the engine id, so a job that
// names `engine: "voice:fish-s2"` reaches it through the registry (`resolveFor`). Each engine has a fixed model (the engine
// id names it); building them is free, nothing is called until a job runs behind the paidCalls guard, with the engine
// listed in config.json `realEngines` and its key in the vault. Without that, the usage's fake answers (demo).
import { ai33Adapter } from './ai33.ts'
import { elevenlabsAdapter } from './elevenlabs.ts'
import { elevenlabsVoiceMaking } from './elevenlabs-voices.ts'
import { fishAdapter } from './fish.ts'
import type { HttpOptions } from './http.ts'
import { minimaxAdapter } from './minimax.ts'
import type { ProviderAdapter } from './types.ts'
import { VOICE_ENGINES } from '../../../src/shared/voice-engines.ts'

/** The voice engines with a real adapter in this version (FAKE_ENGINES declares the same ids). */
export const REAL_VOICE_ENGINES = VOICE_ENGINES

export function voiceEngineAdapters(http: HttpOptions = {}): ProviderAdapter[] {
  return [
    { ...elevenlabsAdapter({ ...http, id: 'voice:elevenlabs-v2', model: 'eleven_multilingual_v2' }), ...elevenlabsVoiceMaking(http) },
    minimaxAdapter({ ...http, id: 'voice:minimax-28-hd', model: 'speech-2.8-hd' }),
    fishAdapter({ ...http, id: 'voice:fish-s2' }),
    ai33Adapter({ ...http, id: 'voice:ai33' })
  ]
}
