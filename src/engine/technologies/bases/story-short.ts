// The base pipeline « Histoire Reddit (short) » (`story-short@1`, clone-reddit-shorts, research note style-redditchroniques-2026-11 (old repository)):
// a first-person story read fast by a synthetic voice over a stream of short « satisfying » clips, one word at a time in the middle of
// the frame, the story's title shown as a forum post for its first sentence. Measured on eight shorts of a French story channel
// (9:16, 1:30–3:00): ≈ 310 words a minute, a cut every 2.3 s (median; 90th percentile 5 s), each clip seen once, captions one word
// at a time (Montserrat ExtraBold, a 0.1 s pop), a soft music bed well under the voice, no other picture. Nothing is generated:
// the pictures are the channel's own clip library (a folder, made once), so a video costs its voice (and the translation of an
// imported story when it is in another language).
import { RECIPE_SCHEMA, type RecipeDoc } from '../recipe'
import type { OptionDecl } from '../options'
import { avatarBase } from './avatar'
import type { BasePipeline } from './types'

/** What the references measure (§ « Mesures »): the settings below are these numbers, never a preset. */
export const STORY_SHORT_PROFILE = {
  wpm: 310,
  shotMedianS: 2.3,
  shotSpread: 2.2,
  shotMinS: 0.7,
  shotMaxS: 7,
  /** A word said faster than this is shown with the next one (« me disaient », « a dit »). */
  minWordS: 0.12,
  /** The post card stays this long after its title is said. */
  cardAfterS: 0.35,
  /** The footage's colours: the references measure saturation 14.5–15.7 and luma 121 (signalstats), a free library 10.6 and 107. */
  vivid: 0.8
} as const

/** The stories are the user's (a pasted text, in any language): import first, the agent's own writing one click away. */
const importFirst = (o: OptionDecl): OptionDecl => (o.id === 'script' && o.kind !== 'slider' ? { ...o, default: 'import' } : o)
const KEEP = new Set(['script'])

/**
 * The story short's settings a proposal may offer (Charlie's review of round 4, 02/11; offered by the generic proposal flow, never asked
 * here): the voice's pace, where the clips come from and their rhythm (a user's own clips are often slower than the reference's), the
 * picture of the post card, and the music (the user's own track, or the library).
 */
const STORY_OPTIONS: readonly OptionDecl[] = [
  {
    id: 'voicePace',
    labelKey: 'pipe.opt.voicePace',
    subject: 'sound',
    kind: 'slider',
    min: 160,
    max: 360,
    step: 10,
    default: STORY_SHORT_PROFILE.wpm,
    effects: [{ op: 'setSetting', brick: 'voice.tts', key: 'wpm', value: '$value' }]
  },
  {
    id: 'clipCadence',
    labelKey: 'pipe.opt.clipCadence',
    subject: 'clips',
    kind: 'slider',
    min: 1.2,
    max: 8,
    step: 0.1,
    default: STORY_SHORT_PROFILE.shotMedianS,
    effects: [{ op: 'setSetting', brick: 'background.clips', key: 'medianS', value: '$value' }]
  },
  {
    // where the background clips come from: the channel's library (filled once: found free clips — Wikimedia Commons, Pixabay — or the
    // owner's own, `channelClips.*`), or a folder given with each video
    id: 'clipSource',
    labelKey: 'pipe.opt.clipSource',
    subject: 'clips',
    kind: 'choice',
    default: 'channel',
    choices: [
      { value: 'channel', labelKey: 'pipe.opt.clipSource.channel', effects: [{ op: 'setInput', input: 'gameplay', source: 'channel' }] },
      { value: 'video', labelKey: 'pipe.opt.clipSource.video', effects: [{ op: 'setInput', input: 'gameplay', source: 'project' }] }
    ]
  },
  {
    id: 'cardPicture',
    labelKey: 'pipe.opt.cardPicture',
    subject: 'editing',
    kind: 'choice',
    default: 'channel',
    choices: [
      // the channel's own picture (« Nouvelle vidéo » › Fond vidéo), else its initial
      { value: 'channel', labelKey: 'pipe.opt.cardPicture.channel', effects: [] },
      { value: 'initial', labelKey: 'pipe.opt.cardPicture.initial', effects: [{ op: 'setSetting', brick: 'card.intro', key: 'avatarMode', value: 'initial' }] },
      { value: 'none', labelKey: 'pipe.opt.cardPicture.none', effects: [{ op: 'removeBrick', brick: 'card.intro' }] }
    ]
  },
  {
    id: 'music',
    labelKey: 'pipe.opt.music',
    subject: 'sound',
    kind: 'choice',
    default: 'auto',
    choices: [
      // the channel's own track when it has one (« Nouvelle vidéo » › Fond vidéo), else the library's, chosen by the story's turns
      { value: 'auto', labelKey: 'pipe.opt.music.auto', effects: [{ op: 'addBrick', tech: 'sound.music@1' }] },
      { value: 'library', labelKey: 'pipe.opt.music.library', effects: [{ op: 'addBrick', tech: 'sound.music@1' }, { op: 'setSetting', brick: 'sound.music', key: 'source', value: 'library' }] },
      { value: 'none', labelKey: 'pipe.opt.music.none', effects: [{ op: 'removeBrick', brick: 'sound.music' }] }
    ]
  }
]

const doc: RecipeDoc = {
  $schema: RECIPE_SCHEMA,
  name: 'Histoire Reddit (short)',
  base: null,
  videoType: 'short',
  // the references run 1:30–3:00 (the Shorts limit), median 2:35
  format: { aspect: '9:16', minutes: 2.5 },
  language: null,
  // the picture is the channel's clip library and nothing else
  mix: { userFootage: 1, curve: 'flat' },
  options: { script: 'import' },
  inputs: { voice: 'channel', style: 'channel', gameplay: 'channel', channel: 'channel', channelAvatar: 'channel', channelMusic: 'channel' },
  // the voice (≈ 5 000 characters for 3 minutes) and the translation; nothing else is paid. The run reserves the voice at the Cloud's
  // generic voice price before capturing ai33's real one (≈ 68 credits held for 2 minutes, ≈ 2 spent): the cap leaves room for that hold
  capCredits: 150,
  // nothing to approve on the way: the story is the owner's own text, and a Short has no thumbnail to pick
  checkpoints: [],
  bricks: [
    // the video's title and brief (what the agent writes from when the story is not imported)
    { tech: 'idea.brief@1', settings: {}, engine: null, fallbacks: [], style: null },
    // the story as pasted, cut into beats here (no chapters in a Short: no model call)
    { tech: 'script.import@1', settings: { tagging: false }, engine: null, fallbacks: [], style: null },
    // a story pasted in English is told in the channel's language (passes through when it is already in it)
    { tech: 'script.translate@1', settings: {}, engine: null, fallbacks: [], style: null },
    // the channel's designed voice, sped up to the measured pace (pitch kept), its pauses cut short
    {
      tech: 'voice.tts@1',
      // the pace is the option « Vitesse de la voix » (its default is the measured 310 words a minute)
      settings: { maxPauseS: 0.2 },
      engine: 'voice:ai33',
      fallbacks: ['voice:minimax-28-hd'],
      style: null
    },
    // every word timed on the voice as heard (Whisper on this computer, free): the voice gives no word times, and estimated ones drift
    // up to 3 s at this pace (round 4, measured against what Whisper hears in the finished film)
    { tech: 'words.align@1', settings: {}, engine: null, fallbacks: [], style: null },
    // the edit plan only (the clips are the picture): no scene pass, no picture to make, no label
    { tech: 'director.plan@1', settings: { scenePass: false, stockShare: 1, labelsPerMin: 0 }, engine: null, fallbacks: [], style: null },
    {
      tech: 'background.clips@1',
      settings: {
        minPieceS: STORY_SHORT_PROFILE.shotMinS,
        maxPieceS: STORY_SHORT_PROFILE.shotMaxS,
        // the median is the option « Rythme des clips » (its default is the measured 2.3 s)
        spread: STORY_SHORT_PROFILE.shotSpread,
        fresh: true,
        vivid: STORY_SHORT_PROFILE.vivid
      },
      engine: null,
      fallbacks: [],
      style: null
    },
    { tech: 'card.intro@1', settings: { look: 'post', afterS: STORY_SHORT_PROFILE.cardAfterS }, engine: null, fallbacks: [], style: null },
    { tech: 'captions.make@1', settings: { preset: 'word', burn: true, minWordS: STORY_SHORT_PROFILE.minWordS, fromSentence: 1 }, engine: null, fallbacks: [], style: null },
    { tech: 'sound.music@1', settings: { mood: 'reflective' }, engine: null, fallbacks: [], style: null },
    { tech: 'render.assemble@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'qc.check@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'package.youtube@1', settings: {}, engine: null, fallbacks: [], style: null }
  ]
}

export const storyShortBase: BasePipeline = {
  id: 'story-short@1',
  labelKey: 'pipe.base.storyShort',
  doc,
  options: [...avatarBase.options.filter((o) => KEEP.has(o.id)).map(importFirst), ...STORY_OPTIONS]
}
