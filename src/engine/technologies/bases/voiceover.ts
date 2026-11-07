// The base pipeline « Voix off » (`voiceover@1`, production-15, docs/specs/production-model.md §6.6): no presenter on screen,
// a narrated voice over AI stills, AI clips made from them and found footage (stock), on the same bricks as `avatar@1`
// without the presenter's. The style agent picks it when the reference channels show no presenter. Its options are the
// avatar base's ones that do not speak of a presenter; the mix starts at 20 % clips / 80 % stills on a flat curve (the
// hook-heavy curve opens on the presenter), and the agent sets it from the references (stock included).
import { RECIPE_SCHEMA, type RecipeDoc } from '../recipe'
import { avatarBase } from './avatar'
import type { BasePipeline } from './types'

/** Options of `avatar@1` that need a presenter on screen: the presenter's own (its subject), and who appears beside it. */
const needsPresenter = (o: { id: string; subject: string }): boolean => o.subject === 'presenter' || o.id === 'presenterInBroll'

const doc: RecipeDoc = {
  $schema: RECIPE_SCHEMA,
  name: 'Voix off',
  base: null,
  // a channel picks one pipeline per video type: a voice-over video is « autre » until it has a type of its own
  videoType: 'autre',
  format: { aspect: '16:9', minutes: 12 },
  language: null,
  mix: { clipAi: 0.2, imageAi: 0.8, curve: 'flat' },
  options: {},
  inputs: { voice: 'channel', style: 'channel', sponsor: 'channel' },
  // the avatar base's cap without the presenter's share of it (the presenter is most of an avatar video's cost)
  capCredits: 900,
  checkpoints: null,
  bricks: avatarBase.doc.bricks.filter((b) => !b.tech.startsWith('avatar.speak@')).map((b) => structuredClone(b))
}

export const voiceoverBase: BasePipeline = {
  id: 'voiceover@1',
  labelKey: 'pipe.base.voiceover',
  doc,
  options: avatarBase.options.filter((o) => !needsPresenter(o))
}
