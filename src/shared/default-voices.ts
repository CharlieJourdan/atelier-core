// The default REAL voice of a brand-new channel, per language (issue #95, #115): a natural, neutral narrator taken from the ai33 Pro
// catalogue (standing order of 2026-11-02: ai33 Pro only, no other provider, no voice-quality work). The Cloud lists them in its
// voice catalogue (`default: true`, `demo: false`); the creation agent puts the one of the channel's language as the placeholder
// voice and says so; a demonstration voice (`demo-*`) is never sent to a real provider: the Cloud swaps it for the default voice
// of its language (cloud/src/jobs.ts).
//
// Why these two: ai33 resells ElevenLabs' multilingual v2 model, whose premade voices speak every language of the table below.
//   - Brian: a deep, resonant, comforting narrator (premade). Neutral and steady, no character acting: the safest default for an
//     explainer or documentary read in English, and for the languages with no voice of their own in the table.
//   - George: a warm, middle-aged storyteller (premade): natural pace, a gentler register than Brian: the default for French and the
//     Romance languages, where a deep voice sounds heavy.
// The ids are the premade ids ElevenLabs publishes, spelled the way ai33's v3 API speaks a library voice: `elevenlabs_<id>`
// (essais-marcel, first real call: a bare id got HTTP 400 « voice_id must start with elevenlabs_, minimax_, clone_, edge… »).
export interface DefaultVoice {
  id: string
  name: string
  language: string
}

const BRIAN = { id: 'elevenlabs_nPczCjzI2devNBz1zQrb', name: 'Brian (narrateur)' } as const
const GEORGE = { id: 'elevenlabs_JBFqnCBsd6RMkjVDRZzb', name: 'George (narrateur)' } as const

/** The default of each language; every other language gets the English one (the model speaks it). */
export const DEFAULT_REAL_VOICES: readonly DefaultVoice[] = [
  { ...GEORGE, language: 'fr' },
  { ...BRIAN, language: 'en' },
  { ...GEORGE, language: 'es' },
  { ...GEORGE, language: 'it' },
  { ...GEORGE, language: 'pt' },
  { ...BRIAN, language: 'de' }
]

/** The distinct voices (the catalogue lists each once, under the first language it is the default of). */
export const DEFAULT_REAL_VOICE_LIST: readonly DefaultVoice[] = DEFAULT_REAL_VOICES.filter((v, i, all) => all.findIndex((x) => x.id === v.id) === i)

const baseLanguage = (language: string): string => language.toLowerCase().split(/[-_]/)[0] ?? 'en'

/** The default real voice of a language (`fr`, `fr-FR`…); English when the language has none of its own. */
export function defaultVoiceFor(language: string): DefaultVoice {
  const l = baseLanguage(language)
  return DEFAULT_REAL_VOICES.find((v) => v.language === l) ?? (DEFAULT_REAL_VOICES.find((v) => v.language === 'en') as DefaultVoice)
}

/**
 * How ai33 speaks a voice id: its v3 API wants `<provider>_<id>`; a bare ElevenLabs library id (20 letters and digits, as a channel
 * got it before essais-marcel) is `elevenlabs_<id>`. Anything else is left as it is.
 */
export const ai33VoiceId = (id: string): string => (/^[A-Za-z0-9]{20}$/.test(id) ? `elevenlabs_${id}` : id)

/** A demonstration voice of the Cloud's fakes (`demo-claire`…): no real provider knows it. */
export const isDemoVoiceId = (id: string): boolean => id.startsWith('demo-')
