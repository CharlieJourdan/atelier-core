// The channel voice as the app shows it (production-5, decisions 0025 and 0029). Contract: src/shared/api/channel-voices.ts.

/** What the person ticks before a clone (decision 0025). `own-channel` is required to clone from a channel's videos. */
export interface ConsentInput {
  granted: boolean
  statement: 'own-voice' | 'rights' | 'own-channel'
  /** Who ticks (the person's name); defaults to « propriétaire ». */
  by?: string
}

/** The stored consent: who, when, what. */
export interface Consent {
  by: string
  at: string
  statement: ConsentInput['statement'] | 'designed'
}

export interface ChannelVoiceClone {
  engine: string
  /** The provider's voice id on that engine. */
  voiceId: string
  demo: boolean
}

export interface ChannelVoiceView {
  id: number
  channelId: number
  name: string
  method: 'design' | 'clone' | 'import'
  source: '' | 'upload' | 'channel' | 'design' | 'provider'
  description: string
  language: string
  status: 'proposed' | 'active' | 'retired'
  isDefault: boolean
  /** The source sample is kept, so the voice can be cloned again on another engine. */
  hasSample: boolean
  consent: Consent | null
  clones: ChannelVoiceClone[]
}

export interface VoiceDesignPreview {
  generatedVoiceId: string
  /** The preview's file on this computer. */
  file: string
  durationS: number | null
}

export interface BlindTestResult {
  /** The folder holding A.*, B.*, … , `fiche.txt` and the key `cle.json`. */
  dir: string
  /** The letters in order (A, B, C…), each a file in `dir`. */
  files: string[]
  /** Demo clones speak in tones: the test only shows the flow, not the voices. */
  demo: boolean
}
