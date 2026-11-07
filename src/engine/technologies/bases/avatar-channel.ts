// The base pipeline « Chaîne avatar » (`avatar@2`, chantier avatar-base-marcel, 2026-11-04): Marcel's style, cloned by hand from
// Charlie's own channel (research note avatar-layouts-2026-11 (old repository) rounds 1–3, avatar-budget-2026-11.md), made THE avatar base.
// What it keeps from that hand-made clone, exactly (its recipe « structure mesurée v3 »):
//  - the presenter's layouts measured per part on reference 2 (full frame in the hook until 77 s, then 78 % split / 22 % inset,
//    the presenter on the LEFT of every split, the inset bottom left at 37.1 % of the width with a white border, two insets at
//    least 50 s apart, the last 45 s half split / half inset, « who I am » opens on a split);
//  - the measured screen-time curve per part (presenter 36 / 18 / 32 / 24 / 24 / 22 %, clips from 64 % in the hook to 3 % at the
//    end) with the mix set to the rows' own average and the option « clipShare » at that average, so `curveRows` hands the
//    director the measured rows unscaled (round 2's lesson);
//  - shot rules (presenter runs ≤ 7 s, the word 0.1 s after the cut, no picture twice within 20 s, no labels, literal pictures, the
//    presenter on the talk sentences), no music;
//  - clips served two shots by one generation ONLY on one continuous action (« auto »): the hand-made clone's « half » paired any
//    two neighbours, and the blocking checks (record 0102) refused its first real renders for it (« La même image revient »:
//    « filters drying » then « hand closing the cover » from one clip) — a real error, not a likeness detail;
//  - the budget as a setting of the mix (`mix.budget`, record 0075): absent = the measured curve exactly (≈ 0.51 $ a finished
//    minute on a 13-minute video); a lower budget gives up clips, then presenter, from the end backwards.
// What it does NOT keep: Marcel himself. The CHARACTER (the presenter's portrait and its HeyGen look), the VOICE (its clone, its
// engine, its pace) and the SET (what the portrait shows behind him) are settings of the base, given per channel by a variant
// (`avatar-variants.ts`), as are the channel's world (locale, objects) and anything its own videos measure differently.
import { RECIPE_SCHEMA, type RecipeDoc } from '../recipe'
import type { OptionDecl } from '../options'
import type { ReferenceProfile } from '../reference-profile'
import type { BasePipeline } from './types'
import { avatarOptions } from './avatar'

/** Reference 2 (« Faites ces 5 choses avant les gelées », Marcel's own video, 217 hand-classed shots) as measured by
 *  avatar-layouts: the presenter's layouts and shot rules this base runs with. */
export const AVATAR_CHANNEL_PROFILE: ReferenceProfile = {
  source:
    'marcel artisan, reference 2 (« Faites ces 5 choses avant les gelées », 13:14, 217 shots), measured shot by shot 2026-11-02 ' +
    '(avatar-layouts, docs/research/avatar-layouts-2026-11.md); made the avatar base 2026-11-04 (avatar-base-marcel)',
  presenterRunMaxS: 7,
  presenterRunMedianS: 3.4,
  cutLeadS: 0.1,
  literalShare: 0.95,
  labelsPerMinute: 0,
  repeatWindowS: 20,
  light: 'overcast',
  camera: 'steady',
  illustrationBar: 8,
  alikeWindowS: 20,
  presenterLayouts: {
    fromS: 77,
    full: 0,
    split: 0.78,
    pip: 0.22,
    presenterSide: 'left',
    inset: { corner: 'bottom-left', widthFrac: 0.371, marginXFrac: 0.011, marginYFrac: 0.036, borderFrac: 0.003 },
    insetGapS: 50,
    outro: { lastS: 45, full: 0, split: 0.5, pip: 0.5 },
    triggers: { intro: { split: 1 } }
  }
}

/** The measured curve per part (reference 2's shot table, avatar-layouts round 3): the rows the director follows. */
export const AVATAR_CHANNEL_CURVE = [
  { fromS: 0, shares: { presenter: 0.36, clipAi: 0.64, imageAi: 0 } },
  { fromS: 51, shares: { presenter: 0.18, clipAi: 0.6833, imageAi: 0.1367 } },
  { fromS: 92, shares: { presenter: 0.32, clipAi: 0.5667, imageAi: 0.1133 } },
  { fromS: 150, shares: { presenter: 0.24, clipAi: 0.3547, imageAi: 0.4053 } },
  { fromS: 300, shares: { presenter: 0.24, clipAi: 0.1438, imageAi: 0.6162 } },
  { fromS: 600, shares: { presenter: 0.22, clipAi: 0.0308, imageAi: 0.7492 } }
]

/** The clips' motion of the hand-made clone: a phone held steady, only what is in the picture moves, no hands enter. */
export const AVATAR_CHANNEL_CLIP_MOTION =
  'Real phone video held steady at eye level, close to the subject: the camera barely moves; only what is already in the picture ' +
  'moves (the hands when they are in it, else the object, the water or the light), slowly and naturally, doing what the scene says; ' +
  'nobody and nothing enters the frame, no hands appear, the scene stays the same'

/** The rows' own time-weighted average (round 2): the mix AND the option « clipShare », or `curveRows` rescales the rows. */
export const AVATAR_CHANNEL_CLIP_SHARE = 0.27

const p = AVATAR_CHANNEL_PROFILE

const doc: RecipeDoc = {
  $schema: RECIPE_SCHEMA,
  name: 'Chaîne avatar',
  base: null,
  videoType: 'avatar-long',
  format: { aspect: '16:9', minutes: 12 },
  language: null,
  mix: { presenter: 0.2482, clipAi: AVATAR_CHANNEL_CLIP_SHARE, imageAi: 0.4818, curve: AVATAR_CHANNEL_CURVE },
  options: { music: 'none', clipPairs: 'auto', clipShare: AVATAR_CHANNEL_CLIP_SHARE },
  // the character, the voice and the set come from the channel (its default presenter and voice) unless a variant fixes them
  inputs: { presenter: 'channel', voice: 'channel', style: 'channel', sponsor: 'channel' },
  // avatar@1's cap (the estimator's max, record 0093): the same bricks, the same engines
  capCredits: 5400,
  checkpoints: null,
  bricks: [
    { tech: 'idea.brief@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'idea.support@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'script.write@2', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'script.sponsor@1', settings: {}, engine: null, fallbacks: [], style: null },
    // the voice's engine is the option « Qualité de la voix » (ai33 while we test, the MiniMax HD clone once the channel has it)
    { tech: 'voice.tts@1', settings: { maxPauseS: 0.3 }, engine: null, fallbacks: [], style: null },
    { tech: 'words.align@1', settings: {}, engine: null, fallbacks: [], style: null },
    {
      tech: 'director.plan@1',
      settings: {
        presenterRunMaxS: p.presenterRunMaxS,
        cutLeadS: p.cutLeadS,
        repeatWindowS: p.repeatWindowS,
        labelsPerMin: 0,
        illustration: 'reference-literal',
        presenterOnTalk: true,
        presenterLayouts: p.presenterLayouts,
        layouts: ['full', 'split', 'pip']
      },
      engine: null,
      fallbacks: [],
      style: null
    },
    { tech: 'visuals.fulfil@1', settings: { illustrationBar: p.illustrationBar, alikeWindowS: p.alikeWindowS }, engine: null, fallbacks: [], style: 'phone-real' },
    { tech: 'clip.make@1', settings: { clipMotion: AVATAR_CHANNEL_CLIP_MOTION }, engine: null, fallbacks: [], style: null },
    { tech: 'avatar.speak@1', settings: {}, engine: null, fallbacks: [], style: 'presenter-studio' },
    { tech: 'captions.make@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'edit.sponsor@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'sound.music@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'render.assemble@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'qc.check@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'thumbnail.make@1', settings: {}, engine: 'image:gpt-image-25-low', fallbacks: ['image:gpt-image-25-fal-low'], style: null },
    { tech: 'package.youtube@1', settings: {}, engine: null, fallbacks: [], style: null }
  ]
}

/** avatar@1's options with the hand-made clone's clip share (the curve's average); clips paired on one action only (« auto »). */
const DEFAULTS: Record<string, string | number | boolean> = { clipPairs: 'auto', clipShare: AVATAR_CHANNEL_CLIP_SHARE }
const options: OptionDecl[] = avatarOptions.map((o) => (o.id in DEFAULTS ? ({ ...o, default: DEFAULTS[o.id] } as OptionDecl) : o))

export const avatarChannelBase: BasePipeline = {
  id: 'avatar@2',
  labelKey: 'pipe.base.avatarChannel',
  doc,
  options,
  profile: AVATAR_CHANNEL_PROFILE
}
