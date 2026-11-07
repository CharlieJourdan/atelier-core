// IPC contract, module "channelVoices" (production-5, decisions 0025 and 0029): the voice of a channel, made once
// (`design` from a description, `clone` of a sample, `import` of a provider voice id), cloned on one or several voice
// engines, with the consent of decision 0025 before any clone. A voice cloned from the channel's own videos on import is
// proposed until the owner accepts it. Every method added here must also be listed in CHANNEL_VOICES_METHODS
// (tests/unit/ipc.test.ts compares the list with main). Change topic: 'production' after every write. Errors are thrown
// with a French message.
import type { BlindTestResult, ChannelVoiceView, ConsentInput, VoiceDesignPreview } from '../channel-voices'

export type * from '../channel-voices'

export interface ChannelVoicesContract {
  /** The channel's voices (active and proposed first, the default one on top), with their clones per engine. */
  'channelVoices.list': { args: [channelId: number]; result: ChannelVoiceView[] }
  /** Previews of a voice described in words (`voice:elevenlabs-v2` by default), to listen to before keeping one. */
  'channelVoices.design': {
    args: [input: { channelId: number; description: string; text?: string; language?: string; engine?: string }]
    result: { previews: VoiceDesignPreview[]; demo: boolean }
  }
  /** Keeps one preview of a design as the channel's voice (on the design's engine). */
  'channelVoices.keepDesign': {
    args: [input: { channelId: number; description: string; generatedVoiceId: string; name: string; previewFile?: string; language?: string; engine?: string }]
    result: ChannelVoiceView
  }
  /** Clones a recording (10 s to 5 min) on the given engines; refused without the consent tick. */
  'channelVoices.clone': {
    args: [input: { channelId: number; name: string; language?: string; fileName: string; bytes: Uint8Array; consent: ConsentInput; engines?: string[] }]
    result: ChannelVoiceView
  }
  /** On channel import: isolates 30–60 s of speech from one of the channel's own video files and clones it; the voice is
   *  PROPOSED until accepted. Refused unless the consent says the person owns the channel. */
  'channelVoices.fromChannelVideo': {
    args: [input: { channelId: number; name: string; videoFile: string; language?: string; consent: ConsentInput; engines?: string[] }]
    result: ChannelVoiceView
  }
  /** Clones a voice the channel already has on one more engine, from its kept sample (a designed voice: a sample is spoken first). */
  'channelVoices.cloneOn': { args: [voiceId: number, engine: string]; result: ChannelVoiceView }
  /** A voice that already exists at a provider (its own voice id on that engine). */
  'channelVoices.import': { args: [input: { channelId: number; name: string; engine: string; providerVoiceId: string; language?: string }]; result: ChannelVoiceView }
  /** Accepts a proposed voice: it becomes active and the channel's default. */
  'channelVoices.accept': { args: [voiceId: number]; result: ChannelVoiceView }
  /** Makes an active voice the one the channel's videos speak with. */
  'channelVoices.setDefault': { args: [voiceId: number]; result: ChannelVoiceView }
  /** Retires a voice (kept for the videos already made, never used again). */
  'channelVoices.retire': { args: [voiceId: number]; result: ChannelVoiceView }
  /** The blind listening test: the same 30-second French text by the voice on each of its engines, files named A, B, C…
   *  in a shuffled order; the key is written apart (`cle.json`). Demo clones give tones. */
  /** The same text on each engine the voice is cloned on (`text`: the channel's own, else a 30 s French text). */
  'channelVoices.blindTest': { args: [voiceId: number, text?: string]; result: BlindTestResult }
}

export const CHANNEL_VOICES_METHODS = [
  'channelVoices.list',
  'channelVoices.design',
  'channelVoices.keepDesign',
  'channelVoices.clone',
  'channelVoices.fromChannelVideo',
  'channelVoices.cloneOn',
  'channelVoices.import',
  'channelVoices.accept',
  'channelVoices.setDefault',
  'channelVoices.retire',
  'channelVoices.blindTest'
] as const satisfies readonly (keyof ChannelVoicesContract)[]
