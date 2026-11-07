// What a user must never read in a pipeline view (pipeline-ui, Charlie 01/11: « on vend le présentateur, la voix… on ne dit
// pas nos modèles derrière »): the providers and models behind our engines, and the provider plan line. Shared by the unit
// render test and the e2e DOM check. « Claude » is not here: it is the user's own subscription, named on purpose.
export const PROVIDER_NAMES: readonly string[] = [
  'HeyGen',
  'Veo',
  'GPT Image',
  'gpt-image',
  'ai33',
  'MiniMax',
  'UnificAlly',
  'Grok',
  'ElevenLabs',
  'Kling',
  'Pruna',
  'Hedra',
  'InfiniteTalk',
  'Nano Banana',
  'nano-banana',
  'Kie',
  'fal',
  'Vertex',
  'Seedream',
  'SeeDance',
  'Hailuo',
  'FLUX',
  'OpenAI',
  'Gemini',
  'Anthropic',
  'Sonnet',
  'Haiku',
  'Runpod',
  'avatar4',
  'forfait'
]

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The provider names found in a text (whole words, any case). */
export function providerNamesIn(text: string): string[] {
  return PROVIDER_NAMES.filter((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(n)}(\\d|[^\\p{L}\\p{N}]|$)`, 'iu').test(text))
}
