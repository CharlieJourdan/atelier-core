// The base pipeline « Avatar » (`avatar@1`, docs/specs/pipeline-avatar.md §3–§4): an AI presenter explains something
// useful, with pictures that illustrate each sentence. Built from the technologies that exist today (the idea and its support videos,
// the presenter's script with its sponsor mentions, voice, director, pictures, clips made from them, presenter (once, then cut), captions,
// the sponsor on screen with its QR code, music, the simple montage (render), check, thumbnails, package); its options are those of
// §3, and the ones whose bricks are not built yet are declared with the chantier that brings them (`soon`). Defaults:
// the Headcast-like mix 26 / 21 / 53 on the `hook-heavy` curve (§4), the « eco » engines while the presenter engine is
// the whole difference in cost (§6), the base styles `phone-real` (pictures) and `presenter-studio` (presenter), no music (the
// reference has none: the music brick stays in the document and the option « Musique » brings it back).
import type { OptionDecl } from '../options'
import { RECIPE_SCHEMA, type RecipeDoc } from '../recipe'
import type { BasePipeline } from './types'
import { settingsFromProfile } from '../reference-profile'
import { AVATAR_PROFILE } from './avatar-profile'

/** This pipeline's requirements, derived from its measured profile (record 0055): its settings, never the engine's limits. */
const REQUIRED = settingsFromProfile(AVATAR_PROFILE)
/** The director's measured settings without the allowed layouts: those are the option « Mises en page du présentateur »
 *  (avatar-reglages-voix; its default « all » allows the three the profile measures). */
const { layouts: _measuredLayouts, ...DIRECTOR_REQUIRED } = REQUIRED['director.plan']

const doc: RecipeDoc = {
  $schema: RECIPE_SCHEMA,
  name: 'Avatar',
  base: null,
  videoType: 'avatar-long',
  format: { aspect: '16:9', minutes: 12 },
  language: null,
  mix: { presenter: 0.26, clipAi: 0.21, imageAi: 0.53, curve: 'hook-heavy' },
  // the music brick stays in the document (shown dashed in the graph); this stored choice removes it at compile (avatar-qualite)
  options: { music: 'none' },
  inputs: { presenter: 'channel', voice: 'channel', style: 'channel', sponsor: 'channel' },
  // the cap of a 12-minute video: the estimator's max for it (the dearest engine of each brick, 15 % regenerations, rounded up to
  // 50 on the Cloud's default grid; production-10's chains put HeyGen's API and Kie.ai in the max); a project of another length gets
  // it pro rata (capForMinutes, recipe.ts). vrais-tests: the dearest minute of the lengths 3 to 30 min (a short video is all hook:
  // more clips a minute) times 12, so the pro rata cap covers every length; pairs only on one action leave more clips.
  // production-17: a short video is the first minutes of a long one (CURVE_FIT_S): the dearest minute is now 30 s, 2 950 -> 4 600
  // avatar-reglages-voix: the still beside a half-screen or inset presenter is now priced, 4 600 -> 4 900
  // quote-calibration (#108): clips and pictures billed as measured on the real runs, 4 900 -> 5 400
  capCredits: 5400,
  checkpoints: null,
  bricks: [
    { tech: 'idea.brief@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'idea.support@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'script.write@2', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'script.sponsor@1', settings: {}, engine: null, fallbacks: [], style: null },
    // the voice is a consistency class: its fallback serves the whole narration (pipeline-avatar §2.3)
    // pauses cut to 0.3 s (vrais-tests: the cloned voice read 5 % slower than the reference with 0.6 s); MiniMax first since
    // Charlie's blind ranking (02/11: real > MiniMax > ai33, « la voix de AI33 Pro est horrible »), ai33 in reserve
    // the engine is the option « Qualité de la voix » (standard: ai33, then MiniMax HD)
    { tech: 'voice.tts@1', settings: { maxPauseS: 0.3 }, engine: null, fallbacks: [], style: null },
    // « Minutage des mots » (record 0059): every word timed on the voice we ship, by Whisper on this computer; every later brick reads it
    { tech: 'words.align@1', settings: {}, engine: null, fallbacks: [], style: null },
    // the measured requirements (avatar-profile.ts): presenter runs, cuts on the named word, no repeat within 20 s, no labels,
    // the references' literal grammar with the presenter on the talk sentences
    { tech: 'director.plan@1', settings: { ...DIRECTOR_REQUIRED }, engine: null, fallbacks: [], style: null },
    { tech: 'visuals.fulfil@1', settings: { ...REQUIRED['visuals.fulfil'] }, engine: null, fallbacks: [], style: 'phone-real' },
    // clips from the stills (production-8): the option « Qualité des clips » picks the engine and the shots per generation
    { tech: 'clip.make@1', settings: { ...REQUIRED['clip.make'] }, engine: null, fallbacks: [], style: null },
    { tech: 'avatar.speak@1', settings: {}, engine: null, fallbacks: [], style: 'presenter-studio' },
    { tech: 'captions.make@1', settings: {}, engine: null, fallbacks: [], style: null },
    // production-9: the sponsor's card or clip and its QR code on the mentions' sentences (option « Sponsor + QR »)
    { tech: 'edit.sponsor@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'sound.music@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'render.assemble@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'qc.check@1', settings: {}, engine: null, fallbacks: [], style: null },
    // thumbnails: GPT Image on OpenAI, then on fal (production-10); Kie.ai's dearer 1K picture stays out of this one-off
    { tech: 'thumbnail.make@1', settings: {}, engine: 'image:gpt-image-25-low', fallbacks: ['image:gpt-image-25-fal-low'], style: null },
    { tech: 'package.youtube@1', settings: {}, engine: null, fallbacks: [], style: null }
  ]
}

const L = (id: string): string => `pipe.opt.${id}`
const C = (id: string, value: string | boolean): string => `pipe.opt.${id}.${String(value)}`
const engines = (brick: string, engine: string, fallbacks: string[]) =>
  [
    { op: 'setEngine', brick, engine },
    { op: 'setFallbacks', brick, fallbacks }
  ] as const

// the director writes the rule into the scene pass and every prompt (production-6); the pictures brick enforces it on the
// prompt it sends and, for « joue l'action », sends the presenter's portrait with the shots where someone acts (production-8)
const people = (value: string) =>
  [
    { op: 'setSetting', brick: 'director.plan', key: 'people', value },
    { op: 'setSetting', brick: 'visuals.fulfil', key: 'people', value }
  ] as const
const brands = (value: string) =>
  [
    { op: 'setSetting', brick: 'director.plan', key: 'brands', value },
    { op: 'setSetting', brick: 'visuals.fulfil', key: 'brands', value }
  ] as const
/** The clip brick, its engine and fallbacks, and the shots one generation serves (2 in eco: wide then a tight crop, only on one
 *  continuous action: a cut to a new subject keeps its own clip, vrais-tests). */
const clips = (engine: string, fallbacks: string[], shotsPerGeneration: 1 | 2) =>
  [
    { op: 'addBrick', tech: 'clip.make@1' },
    ...engines('clip.make', engine, fallbacks),
    { op: 'setSetting', brick: 'clip.make', key: 'shotsPerGeneration', value: shotsPerGeneration }
  ] as const
/** Pairs on one continuous action only (« selon la qualité ») or forced on any two neighbours (« la moitié », « tous »: cheaper, a cut
 *  to a new subject then shows the previous scene). */
const sameAction = (value: boolean) => ({ op: 'setSetting', brick: 'clip.make', key: 'pairSameAction', value }) as const
/** The short single shots' engine: Grok Imagine 1.5 Lite, billed per second at the exact length (vrais-tests benchmark). */
const SHORT_CLIP_ENGINE = 'clip:grok-imagine-15-lite'
/** The share of the clip shots served two by two (production-10 ladder: half or all). */
const pairs = (value: number) => ({ op: 'setSetting', brick: 'clip.make', key: 'pairShare', value }) as const
/** The presenter chain of production-10 after HeyGen's plan: its API, WaveSpeed, Kie.ai, InfiniteTalk on our rented GPU. */
const PRESENTER_FALLBACKS = ['presenter:heygen-avatar4', 'presenter:pruna-avatar', 'presenter:kling-avatar-kie', 'presenter:infinitetalk-gpu']
const framing = (value: string) => ({ op: 'setSetting', brick: 'avatar.speak', key: 'framing', value }) as const

export const avatarOptions: readonly OptionDecl[] = [
  {
    id: 'editing',
    labelKey: L('editing'),
    subject: 'editing',
    kind: 'choice',
    default: 'simple',
    choices: [
      { value: 'simple', labelKey: C('editing', 'simple'), effects: [{ op: 'setSetting', brick: 'director.plan', key: 'pace', value: null }] },
      // avatar-reglages-voix: shorter shots (x 0.75), more pictures a minute; the overlay agent (production-model §2.6) stays in the backlog
      { value: 'dynamic', labelKey: C('editing', 'dynamic'), effects: [{ op: 'setSetting', brick: 'director.plan', key: 'pace', value: 0.75 }] },
      { value: 'advanced', labelKey: C('editing', 'advanced'), effects: [], soon: 'montage-avance' }
    ]
  },
  {
    id: 'chapters',
    labelKey: L('chapters'),
    subject: 'editing',
    kind: 'switch',
    default: false,
    choices: [
      { value: false, labelKey: C('chapters', false), effects: [{ op: 'removeBrick', brick: 'edit.chapters' }] },
      { value: true, labelKey: C('chapters', true), effects: [{ op: 'addBrick', tech: 'edit.chapters@1' }] }
    ]
  },
  {
    id: 'captions',
    labelKey: L('captions'),
    subject: 'editing',
    kind: 'switch',
    default: false,
    choices: [
      { value: false, labelKey: C('captions', false), effects: [{ op: 'setSetting', brick: 'captions.make', key: 'burn', value: false }] },
      { value: true, labelKey: C('captions', true), effects: [{ op: 'setSetting', brick: 'captions.make', key: 'burn', value: true }] }
    ]
  },
  {
    id: 'music',
    labelKey: L('music'),
    subject: 'sound',
    kind: 'choice',
    // avatar-qualite (Charlie 01/11: « la musique derrière : non »): the reference has none; the library is one click away
    default: 'none',
    choices: [
      { value: 'library', labelKey: C('music', 'library'), effects: [{ op: 'addBrick', tech: 'sound.music@1' }] },
      { value: 'none', labelKey: C('music', 'none'), effects: [{ op: 'removeBrick', brick: 'sound.music' }] },
      // generated music is a paid provider (ElevenLabs Music): it comes with the first real keys
      { value: 'generated', labelKey: C('music', 'generated'), effects: [], soon: 'production-10' }
    ]
  },
  {
    id: 'presenterShots',
    labelKey: L('presenterShots'),
    subject: 'presenter',
    kind: 'choice',
    default: 'single',
    choices: [
      // production-7: re-crops of the one generation (1080p), or the presenter's angles (made once with the presenter)
      { value: 'single', labelKey: C('presenterShots', 'single'), effects: [framing('single')] },
      { value: 'recrops', labelKey: C('presenterShots', 'recrops'), effects: [framing('recrops')] },
      { value: 'multi', labelKey: C('presenterShots', 'multi'), effects: [framing('multi')] }
    ]
  },
  {
    // avatar-reglages-voix: the presenter's layouts (Charlie: « plein écran, moitié d'écran, incrusté »); half-screen and inset
    // show a picture beside him, which the estimator prices
    id: 'presenterLayouts',
    labelKey: L('presenterLayouts'),
    subject: 'presenter',
    kind: 'choice',
    default: 'all',
    choices: [
      { value: 'all', labelKey: C('presenterLayouts', 'all'), effects: [{ op: 'setSetting', brick: 'director.plan', key: 'layouts', value: ['full', 'split', 'pip'] }] },
      { value: 'split', labelKey: C('presenterLayouts', 'split'), effects: [{ op: 'setSetting', brick: 'director.plan', key: 'layouts', value: ['full', 'split'] }] },
      { value: 'full', labelKey: C('presenterLayouts', 'full'), effects: [{ op: 'setSetting', brick: 'director.plan', key: 'layouts', value: ['full'] }] }
    ]
  },
  {
    id: 'presenterInBroll',
    labelKey: L('presenterInBroll'),
    subject: 'images',
    kind: 'choice',
    default: 'not-presenter',
    choices: [
      { value: 'not-presenter', labelKey: C('presenterInBroll', 'not-presenter'), effects: people('not-presenter') },
      { value: 'presenter-as-actor', labelKey: C('presenterInBroll', 'presenter-as-actor'), effects: people('presenter-as-actor') },
      { value: 'nobody', labelKey: C('presenterInBroll', 'nobody'), effects: people('nobody') },
      { value: 'anyone', labelKey: C('presenterInBroll', 'anyone'), effects: people('anyone') }
    ]
  },
  {
    id: 'brands',
    labelKey: L('brands'),
    subject: 'images',
    kind: 'choice',
    default: 'real',
    choices: [
      { value: 'real', labelKey: C('brands', 'real'), effects: brands('real') },
      { value: 'none', labelKey: C('brands', 'none'), effects: brands('none') }
    ]
  },
  {
    id: 'sponsor',
    labelKey: L('sponsor'),
    subject: 'sponsor',
    kind: 'choice',
    default: 'auto',
    choices: [
      {
        value: 'auto',
        labelKey: C('sponsor', 'auto'),
        effects: [
          { op: 'addBrick', tech: 'script.sponsor@1' },
          { op: 'addBrick', tech: 'edit.sponsor@1' }
        ]
      },
      {
        value: 'off',
        labelKey: C('sponsor', 'off'),
        effects: [
          { op: 'removeBrick', brick: 'script.sponsor' },
          { op: 'removeBrick', brick: 'edit.sponsor' }
        ]
      }
    ]
  },
  {
    // avatar-reglages-voix: where the channel's own offer goes in this pipeline's videos (the channel's sheet says it otherwise)
    id: 'offerPlace',
    labelKey: L('offerPlace'),
    subject: 'sponsor',
    kind: 'choice',
    default: 'channel',
    choices: [
      { value: 'channel', labelKey: C('offerPlace', 'channel'), effects: [{ op: 'setSetting', brick: 'script.sponsor', key: 'place', value: null }] },
      { value: 'after_hook', labelKey: C('offerPlace', 'after_hook'), effects: [{ op: 'setSetting', brick: 'script.sponsor', key: 'place', value: 'after_hook' }] },
      { value: 'mention', labelKey: C('offerPlace', 'mention'), effects: [{ op: 'setSetting', brick: 'script.sponsor', key: 'place', value: 'mention' }] },
      { value: 'end', labelKey: C('offerPlace', 'end'), effects: [{ op: 'setSetting', brick: 'script.sponsor', key: 'place', value: 'end' }] },
      { value: 'none', labelKey: C('offerPlace', 'none'), effects: [{ op: 'setSetting', brick: 'script.sponsor', key: 'place', value: 'none' }] }
    ]
  },
  {
    id: 'factcheck',
    labelKey: L('factcheck'),
    subject: 'script',
    kind: 'switch',
    default: false,
    choices: [
      { value: false, labelKey: C('factcheck', false), effects: [{ op: 'removeBrick', brick: 'script.factcheck' }] },
      { value: true, labelKey: C('factcheck', true), effects: [{ op: 'addBrick', tech: 'script.factcheck@1' }] }
    ]
  },
  {
    id: 'script',
    labelKey: L('script'),
    subject: 'script',
    kind: 'choice',
    default: 'agent',
    choices: [
      // written by the agent, without or with the owner's validation (the gate « script », default off), or imported (no gate)
      {
        value: 'agent',
        labelKey: C('script', 'agent'),
        effects: [
          { op: 'removeBrick', brick: 'script.import' },
          { op: 'addBrick', tech: 'script.write@2' }
        ]
      },
      {
        value: 'agent-review',
        labelKey: C('script', 'agent-review'),
        effects: [
          { op: 'removeBrick', brick: 'script.import' },
          { op: 'addBrick', tech: 'script.write@2' },
          { op: 'setSetting', brick: 'script.write', key: 'review', value: true }
        ]
      },
      {
        value: 'import',
        labelKey: C('script', 'import'),
        effects: [
          { op: 'removeBrick', brick: 'script.write' },
          { op: 'addBrick', tech: 'script.import@1' }
        ]
      }
    ]
  },
  {
    id: 'clipShare',
    labelKey: L('clipShare'),
    subject: 'clips',
    kind: 'slider',
    min: 0,
    max: 0.5,
    step: 0.01,
    default: 0.21,
    effects: [{ op: 'setMix', kind: 'clipAi', share: '$value' }]
  },
  {
    id: 'quality.images',
    labelKey: L('quality.images'),
    subject: 'images',
    kind: 'choice',
    default: 'eco',
    choices: [
      // production-10 (Charlie's providers of 11-01): OpenAI direct, then the same model on fal, then on Kie.ai
      { value: 'eco', labelKey: C('quality', 'eco'), effects: engines('visuals.fulfil', 'image:gpt-image-25-low', ['image:gpt-image-25-fal-low', 'image:gpt-image-25-kie']) },
      { value: 'standard', labelKey: C('quality', 'standard'), effects: engines('visuals.fulfil', 'image:gpt-image-25-medium', ['image:gpt-image-25-fal-medium', 'image:gpt-image-25-kie']) },
      { value: 'premium', labelKey: C('quality', 'premium'), effects: engines('visuals.fulfil', 'image:nano-banana-2', ['image:gpt-image-25-medium']) }
    ]
  },
  {
    id: 'quality.clips',
    labelKey: L('quality.clips'),
    subject: 'clips',
    kind: 'choice',
    default: 'eco',
    // pipeline-avatar §2.7 and §6: Veo 3.1 Lite on the reseller's slow queue with two shots per clip; its fast queue; Veo 3.1 Fast.
    // vrais-tests (01/11): Grok Imagine 1.5 Lite is the first fallback (as good per usable shot, twice as fast)
    choices: [
      { value: 'eco', labelKey: C('quality', 'eco'), effects: clips('clip:veo31-lite-relaxed', ['clip:grok-imagine-15-lite', 'clip:veo31-lite-vertex', 'clip:veo31-lite-kie'], 2) },
      { value: 'standard', labelKey: C('quality', 'standard'), effects: clips('clip:veo31-lite', ['clip:grok-imagine-15-lite', 'clip:veo31-lite-vertex', 'clip:veo31-lite-kie'], 1) },
      { value: 'premium', labelKey: C('quality', 'premium'), effects: clips('clip:veo31-fast', ['clip:veo31-lite', 'clip:veo31-lite-vertex'], 1) }
    ]
  },
  {
    // the cost ladder of production-10: half or all of the clips give two shots (« auto »: what « Qualité des clips » says)
    id: 'clipPairs',
    labelKey: L('clipPairs'),
    subject: 'clips',
    kind: 'choice',
    default: 'auto',
    choices: [
      { value: 'auto', labelKey: C('clipPairs', 'auto'), effects: [sameAction(true)] },
      { value: 'none', labelKey: C('clipPairs', 'none'), effects: [pairs(0)] },
      { value: 'half', labelKey: C('clipPairs', 'half'), effects: [pairs(0.5), sameAction(false)] },
      { value: 'all', labelKey: C('clipPairs', 'all'), effects: [pairs(1), sameAction(false)] }
    ]
  },
  {
    // vrais-tests Part C (research note reference-video-2026-11 (old repository)): a clip is paid only where something moves (hands, people, water);
    // a place or an object is a still with a slow camera move, free. « Partout » keeps every clip shot of the mix a clip.
    id: 'motionShots',
    labelKey: L('motionShots'),
    subject: 'clips',
    kind: 'choice',
    default: 'needed',
    choices: [
      { value: 'needed', labelKey: C('motionShots', 'needed'), effects: [{ op: 'setSetting', brick: 'clip.make', key: 'motionOnly', value: true }] },
      { value: 'all', labelKey: C('motionShots', 'all'), effects: [{ op: 'setSetting', brick: 'clip.make', key: 'motionOnly', value: false }] }
    ]
  },
  {
    // short single shots (3 s or less, no face) on a per-second engine at their exact length, with the drift check
    id: 'shortClips',
    labelKey: L('shortClips'),
    subject: 'clips',
    kind: 'choice',
    default: 'per-second',
    choices: [
      { value: 'per-second', labelKey: C('shortClips', 'per-second'), effects: [{ op: 'setSetting', brick: 'clip.make', key: 'shortEngine', value: SHORT_CLIP_ENGINE }] },
      { value: 'same', labelKey: C('shortClips', 'same'), effects: [{ op: 'setSetting', brick: 'clip.make', key: 'shortEngine', value: 'none' }] }
    ]
  },
  {
    // « continuous » (the presenter also generated under its short cutaways) is the base of the ladder; « cut » is the default
    id: 'presenterGeneration',
    labelKey: L('presenterGeneration'),
    subject: 'presenter',
    kind: 'choice',
    default: 'cut',
    choices: [
      { value: 'cut', labelKey: C('presenterGeneration', 'cut'), effects: [{ op: 'setSetting', brick: 'avatar.speak', key: 'generation', value: 'cut' }] },
      { value: 'continuous', labelKey: C('presenterGeneration', 'continuous'), effects: [{ op: 'setSetting', brick: 'avatar.speak', key: 'generation', value: 'continuous' }] }
    ]
  },
  {
    // avatar-reglages-voix: ai33 stays the default while we test (Charlie 02/11: « pas MiniMax par défaut, surtout pas pour les
    // tests ; c'est plutôt quand on sortira des vidéos »); MiniMax HD is « Haute qualité », his blind ranking's better voice
    id: 'quality.voice',
    labelKey: L('quality.voice'),
    subject: 'sound',
    kind: 'choice',
    default: 'standard',
    choices: [
      { value: 'standard', labelKey: C('quality', 'standard'), effects: engines('voice.tts', 'voice:ai33', ['voice:minimax-28-hd']) },
      { value: 'high', labelKey: C('quality.voice', 'high'), effects: engines('voice.tts', 'voice:minimax-28-hd', ['voice:ai33']) },
      // ElevenLabs direct: its key is not in the vault yet (research note voice-quality-2026-11 (old repository))
      { value: 'premium', labelKey: C('quality', 'premium'), effects: engines('voice.tts', 'voice:elevenlabs-v2', ['voice:minimax-28-hd']), soon: 'cle-elevenlabs' }
    ]
  },
  {
    id: 'quality.presenter',
    labelKey: L('quality.presenter'),
    subject: 'presenter',
    kind: 'choice',
    default: 'eco',
    choices: [
      // production-10: HeyGen Avatar IV on the HeyGen plan (its MCP server), then its API, WaveSpeed, Kie.ai, our own GPU
      { value: 'eco', labelKey: C('quality', 'eco'), effects: engines('avatar.speak', 'presenter:heygen-mcp', PRESENTER_FALLBACKS) },
      { value: 'standard', labelKey: C('quality', 'standard'), effects: engines('avatar.speak', 'presenter:heygen-avatar4', ['presenter:heygen-mcp', 'presenter:pruna-avatar', 'presenter:kling-avatar-kie']) },
      { value: 'premium', labelKey: C('quality', 'premium'), effects: engines('avatar.speak', 'presenter:hedra-c3', ['presenter:heygen-avatar4']) }
    ]
  }
]

export const avatarBase: BasePipeline = {
  id: 'avatar@1',
  labelKey: 'pipe.base.avatar',
  doc,
  options: avatarOptions,
  profile: AVATAR_PROFILE
}
