// The base pipeline « Histoire POV (animation 2D) » (`pov@1`, clone-monde-pov, research note style-monde-pov-2026-11 (old repository)): a second-
// person « what if » story narrated fast over flat 2D motion design drawn by our engine — a stick-figure hero in vector places at dusk,
// his face in close-up when he reacts, every number said shown on a navy card that counts, ticks or strikes. Measured on six videos of
// a French channel (16:9, 9–15 min): ≈ 215 words a minute, a cut every ≈ 2.7 s (≈ 2.4 s in the hook), a face every ≈ 16 s, hard cuts
// with a rare blur-smear, a continuous music bed ≈ 15 dB under the voice, effects on graphic events, no captions, no presenter. Nothing
// is generated or found: every frame is drawn, so a video costs its voice and its director.
import type { OptionDecl } from '../options'
import { RECIPE_SCHEMA, type RecipeDoc } from '../recipe'
import { avatarBase } from './avatar'
import type { BasePipeline } from './types'

/** What the references measure (§ 4–7 of the study): the settings below are these numbers, never a preset. */
export const POV_PROFILE = {
  wpm: 215,
  shotS: 2.7,
  hookShotS: 2.4,
  faceEveryS: 13,
  maxStillS: 4.5,
  /** The longest pause kept in the voice (the reference never pauses over ≈ 0.5 s). */
  maxPauseS: 0.3
} as const

/** The references have a music bed under the voice all along. */
const musicOn = (o: OptionDecl): OptionDecl => (o.id === 'music' && o.kind !== 'slider' ? { ...o, default: 'library' } : o)
const KEEP = new Set(['music', 'script'])

const doc: RecipeDoc = {
  $schema: RECIPE_SCHEMA,
  name: 'Histoire POV (animation 2D)',
  base: null,
  videoType: 'autre',
  // the references run 9–15 min (median 14 for the four most viewed)
  format: { aspect: '16:9', minutes: 12 },
  language: null,
  // every frame is a drawn card
  mix: { motion: 1, curve: 'flat' },
  options: { music: 'library' },
  inputs: { voice: 'channel', style: 'channel' },
  // the voice (≈ 15 000 characters for 12 minutes) and the director's calls; nothing else is paid
  capCredits: 300,
  checkpoints: null,
  bricks: [
    { tech: 'idea.brief@1', settings: {}, engine: null, fallbacks: [], style: null },
    // the story in « tu », no chapters and no call to action said aloud (the references write it on the last frame only)
    { tech: 'script.write@2', settings: { ctaMode: 'none', numberedParts: 'no', chapters: 0, wpm: POV_PROFILE.wpm }, engine: null, fallbacks: [], style: null },
    // a designed narrator at the measured pace, its pauses cut short
    {
      tech: 'voice.tts@1',
      settings: { maxPauseS: POV_PROFILE.maxPauseS, wpm: POV_PROFILE.wpm },
      engine: 'voice:ai33',
      fallbacks: ['voice:minimax-28-hd'],
      style: null
    },
    {
      tech: 'director.pov@1',
      settings: { palette: 'dusk', shotS: POV_PROFILE.shotS, hookShotS: POV_PROFILE.hookShotS, faceEveryS: POV_PROFILE.faceEveryS, maxStillS: POV_PROFILE.maxStillS },
      engine: null,
      fallbacks: [],
      style: null
    },
    // draws every shot (opaque cards); no overlay found in the words
    { tech: 'motion.render@1', settings: { overlays: false, parallel: 4 }, engine: null, fallbacks: [], style: null },
    // the subtitles file for YouTube only: the references show no captions on screen
    { tech: 'captions.make@1', settings: { burn: false }, engine: null, fallbacks: [], style: null },
    // one bed all along, never lifted in the pauses (the reference's are under 0.5 s): ≈ 15 dB under the voice
    { tech: 'sound.music@1', settings: { mood: 'hopeful', liftDb: 0, bedDb: -15 }, engine: null, fallbacks: [], style: null },
    // the measured 2D kit: hard cuts, a rare whip, effects on the cards' events
    { tech: 'edit.fx@1', settings: { kit: 'pov2d' }, engine: null, fallbacks: [], style: null },
    { tech: 'render.assemble@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'qc.check@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'package.youtube@1', settings: {}, engine: null, fallbacks: [], style: null }
  ]
}

export const povBase: BasePipeline = {
  id: 'pov@1',
  labelKey: 'pipe.base.pov',
  doc,
  options: avatarBase.options.filter((o) => KEEP.has(o.id)).map(musicOn)
}
