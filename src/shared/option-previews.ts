// What a user sees of a pipeline's options (pipeline-ui, Charlie 01/11). Data shared by the screens, the preview seed and the
// tests: which options are shown on the main path, which under « Avancé », which are ours only (internal choices of our
// technologies — « génération du présentateur : une fois puis coupée / continue », the clip pairs… — kept in code and in the
// founder console, never shown to a user: « on vend le présentateur, la voix… on ne dit pas nos modèles derrière »), and the
// before / after previews of the visible ones (`npm run previews:options`, made by the engine on the fakes, shown free).

/** Shown first: what changes how the video looks or reads (avatar-reglages-voix: Charlie's list of 02/11, by group). */
export const MAIN_OPTIONS = ['presenterShots', 'presenterLayouts', 'presenterInBroll', 'quality.voice', 'voicePace', 'sponsor', 'offerPlace', 'editing', 'captions', 'chapters', 'music', 'clipSource', 'clipCadence', 'cardPicture', 'script'] as const

/** The groups the main options are shown in, in order (the character, the voice, the offer, the editing, the script). */
export const OPTION_GROUPS: readonly { id: string; options: readonly string[] }[] = [
  { id: 'character', options: ['presenterShots', 'presenterLayouts', 'presenterInBroll'] },
  { id: 'voice', options: ['quality.voice', 'voicePace'] },
  { id: 'offer', options: ['sponsor', 'offerPlace'] },
  { id: 'editing', options: ['editing', 'captions', 'chapters', 'music', 'clipSource', 'clipCadence', 'cardPicture'] },
  { id: 'script', options: ['script'] }
]

/** Shown under « Avancé »: what a user may still change (quality and price, what the pictures show). */
export const ADVANCED_OPTIONS = ['quality.presenter', 'quality.images', 'quality.clips', 'clipShare', 'brands', 'factcheck'] as const

/** Ours only: how our technologies make the video. Never shown to a user (the editor's « Développeur » block behind the dev
 *  flag shows them, decision 0051); the pipeline keeps their values. */
export const INTERNAL_OPTIONS = ['presenterGeneration', 'clipPairs', 'motionShots', 'shortClips'] as const

export type OptionPlace = 'main' | 'advanced' | 'internal'

/** Where an option of a base pipeline is shown; an option not listed is « Avancé » (a new option is never on the main path). */
export function optionPlace(id: string): OptionPlace {
  if ((MAIN_OPTIONS as readonly string[]).includes(id)) return 'main'
  if ((INTERNAL_OPTIONS as readonly string[]).includes(id)) return 'internal'
  return 'advanced'
}

export interface OptionPreviewSpec {
  option: string
  /** The value shown as « avant » and the one shown as « après ». */
  before: string | boolean
  after: string | boolean
  /** The loop keeps its sound (music). */
  sound: boolean
  /** Cut from our real videos (Marcel, Atelier-made; the invented presenter Kenji): the fakes cannot show it; the seed keeps it. */
  real?: true
}

/** The options a user can see before / after (the visible options that change the picture or the sound). */
export const OPTION_PREVIEWS: readonly OptionPreviewSpec[] = [
  { option: 'chapters', before: false, after: true, sound: false },
  { option: 'captions', before: false, after: true, sound: false },
  { option: 'presenterShots', before: 'single', after: 'recrops', sound: false },
  { option: 'sponsor', before: 'off', after: 'auto', sound: false },
  { option: 'music', before: 'none', after: 'library', sound: true },
  // avatar-reglages-voix: the presenter's layouts, the presenter acting in the pictures, the editing's pace
  { option: 'presenterLayouts', before: 'full', after: 'all', sound: false, real: true },
  { option: 'presenterInBroll', before: 'not-presenter', after: 'presenter-as-actor', sound: false, real: true },
  { option: 'editing', before: 'simple', after: 'dynamic', sound: false, real: true }
]

/** The saved preview's key of one option value (`option:chapters:true`). */
export const optionPreviewKey = (option: string, value: string | boolean): string => `option:${option.toLowerCase()}:${String(value)}`
