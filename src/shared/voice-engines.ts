// The voice engines Atelier can make and speak a channel voice with (production-5, decision 0029), shared by the Cloud
// (which adapter serves each) and the app (which engines may clone a voice, how long a sample each one takes). The ids are
// those of the engines registry (cloud/src/providers/engines.ts).
export const VOICE_ENGINES = ['voice:elevenlabs-v2', 'voice:minimax-28-hd', 'voice:fish-s2', 'voice:ai33'] as const
export type VoiceEngine = (typeof VOICE_ENGINES)[number]

export interface VoiceEngineCan {
  /** Clones a sample (instant clone). */
  clone: boolean
  /** Designs a voice from a description (previews, then keep one). */
  design: boolean
  /** Returns word or character times with the audio; otherwise the engine aligns the script itself (ENGINE-SPEC §19.3). */
  timings: boolean
  /** The sample length it takes to clone, in seconds [min, max] (the app cuts a longer sample to the max). */
  cloneSampleS: readonly [number, number]
}

/** From each provider's public docs (read 2026-10-24 and 2026-11-01; docs/PROVIDERS.md §6 lists what to confirm). */
export const VOICE_ENGINE_CAN: Record<VoiceEngine, VoiceEngineCan> = {
  'voice:elevenlabs-v2': { clone: true, design: true, timings: true, cloneSampleS: [10, 120] },
  'voice:minimax-28-hd': { clone: true, design: false, timings: true, cloneSampleS: [10, 300] },
  'voice:fish-s2': { clone: true, design: false, timings: false, cloneSampleS: [10, 120] },
  'voice:ai33': { clone: true, design: false, timings: false, cloneSampleS: [3, 30] }
}

export const isVoiceEngine = (v: unknown): v is VoiceEngine => typeof v === 'string' && (VOICE_ENGINES as readonly string[]).includes(v)
