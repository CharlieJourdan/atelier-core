// The base pipeline « Documentaire d'archives (v2) » (`documentary@2`, chantier documentary-2, research note documentary-2-2026-11 (old repository)):
// a long history explainer narrated over REAL archives only — archive films in an old-TV frame, prints boards in varied layouts, tilted
// satellite maps, bar cards, documents underlined on their words, dates / figures / names / red bars over the films — sequenced like the
// current format of a history archive channel measured on five whole videos (≈ 150 min, 1 808 shots). Nothing is generated (a missing
// archive is a flagged gap); no sound effect, no subtitle, no border the reference does not have. `documentary@1` stays as it was.
import type { OptionDecl } from '../options'
import { RECIPE_SCHEMA, type RecipeDoc } from '../recipe'
import { avatarBase } from './avatar'
import { DOCUMENTARY_PROFILE, type DocumentaryProfile } from './documentary-profile'
import type { BasePipeline } from './types'

/** What the five videos measure, in the general profile's terms (the full catalogue is src/engine/nodes/doc2-profile.ts). */
export const DOCUMENTARY2_PROFILE: DocumentaryProfile = {
  ...DOCUMENTARY_PROFILE,
  source:
    'Five whole videos of the public channel Markets of the Past in its current format (Switzerland, Spain, Yamamoto, Britain’s coal, ' +
    'America and Latin America), every shot classed on contact sheets, measured 2026-11-02 (documentary-2)',
  // a change every 4.6–5.6 s (median shot 4.75 s), the hook a little faster
  shotMedianS: 4.75,
  hookShotMedianS: 4.0,
  // hard cuts; a cross-fade only into and out of a map, a chart or a document
  dissolveShare: 0.05,
  // maps, charts and documents ≈ 22 % of the screen time; films and prints the rest
  cardShare: 0.22,
  archiveShare: 0.78,
  labelsPerMinute: 0,
  repeatWindowS: 30
}

/** How the reference's hooks go (research note documentary-2-2026-11 (old repository) § 4), as a writing guide: the facts still come from the brief. */
const HOOK_PATTERN = 'paradox, dense scene with figures, contempt, usual story dismissed, real reason'

/**
 * Music: the reference's kind or none (Charlie's second review, qualite-montage: « random, irritating music »). The library holds no track
 * measured to be the reference's kind, so the faithful clone has none; the library stays one click away (`music: 'library'`).
 */
/** The proposals a user may pick (clone-markets-2 « dossier », documentary-2): never the default of the faithful clone. */
const SKIN: OptionDecl = {
  id: 'docSkin',
  labelKey: 'pipe.opt.docSkin',
  subject: 'editing',
  kind: 'choice',
  default: 'reference',
  choices: [
    { value: 'reference', labelKey: 'pipe.opt.docSkin.reference', effects: [{ op: 'setSetting', brick: 'director.plan', key: 'docSkin', value: 'reference' }] },
    { value: 'dossier', labelKey: 'pipe.opt.docSkin.dossier', effects: [{ op: 'setSetting', brick: 'director.plan', key: 'docSkin', value: 'dossier' }] }
  ]
}
const MAP_LOOK: OptionDecl = {
  id: 'docMapLook',
  labelKey: 'pipe.opt.docMapLook',
  subject: 'editing',
  kind: 'choice',
  default: 'satellite',
  choices: [
    { value: 'satellite', labelKey: 'pipe.opt.docMapLook.satellite', effects: [{ op: 'setSetting', brick: 'director.plan', key: 'docMapLook', value: 'satellite' }] },
    { value: 'parchment', labelKey: 'pipe.opt.docMapLook.parchment', effects: [{ op: 'setSetting', brick: 'director.plan', key: 'docMapLook', value: 'parchment' }] }
  ]
}

/** Options of `avatar@1` a documentary has no use for (the presenter's, the clip ladder): the same as `documentary@1`. */
const KEEP = new Set(['editing', 'chapters', 'captions', 'music', 'brands', 'sponsor', 'factcheck', 'script', 'quality.images'])

const doc: RecipeDoc = {
  $schema: RECIPE_SCHEMA,
  name: 'Documentaire d’archives (v2)',
  base: null,
  videoType: 'documentaire',
  // long form (the references run 28–31 min)
  format: { aspect: '16:9', minutes: 20 },
  language: null,
  // found media only: archive films and photographs ≈ 78 %, drawn cards (maps, charts, documents) ≈ 22 %; nothing generated
  mix: { archive: 0.78, motion: 0.22, curve: 'flat', shotLengthS: { archive: DOCUMENTARY2_PROFILE.shotMedianS } },
  options: { music: 'none' },
  inputs: { voice: 'channel', style: 'channel', sponsor: 'channel' },
  // archives are free: the voice, the director's text and the thumbnail are the cost
  capCredits: 400,
  checkpoints: null,
  bricks: [
    { tech: 'idea.brief@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'idea.support@1', settings: {}, engine: null, fallbacks: [], style: null },
    // the reference's hook (five videos): a paradox, a dense scene with figures, contempt quoted, the usual story dismissed, the real reason promised
    { tech: 'script.write@2', settings: { hookPattern: HOOK_PATTERN, hookSeconds: 100 }, engine: null, fallbacks: [], style: null },
    { tech: 'script.sponsor@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'voice.tts@1', settings: { maxPauseS: 0.45 }, engine: 'voice:ai33', fallbacks: ['voice:minimax-28-hd'], style: null },
    // the measured, varied sequence (doc2-profile.ts, doc2-sequence.ts); every on-screen text checked against the words
    { tech: 'director.plan@1', settings: { grammar: 'documentary-2', textCheck: 'rules', labelsPerMin: 0, cutLeadS: 0.1 }, engine: null, fallbacks: [], style: null },
    // archive films and photographs from the public archives (free, on this computer); nothing found = a gap, never a generated picture
    { tech: 'visuals.fulfil@1', settings: { archives: true, archivePick: 'look', people: 'anyone' }, engine: 'image:gpt-image-25-low', fallbacks: ['image:gpt-image-25-fal-low'], style: 'archive-real' },
    // draws the boards, maps, charts, documents and the texts over the films the director placed
    { tech: 'motion.render@1', settings: { overlays: false, parallel: 4 }, engine: null, fallbacks: [], style: null },
    { tech: 'captions.make@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'edit.sponsor@1', settings: {}, engine: null, fallbacks: [], style: null },
    // archive film black and white with its levels stretched, 4:3 in the old-TV frame (the cards keep their own colours)
    { tech: 'render.assemble@1', settings: { grade: 'archive-film' }, engine: null, fallbacks: [], style: null },
    { tech: 'qc.check@1', settings: {}, engine: null, fallbacks: [], style: null },
    { tech: 'thumbnail.make@1', settings: {}, engine: 'image:gpt-image-25-low', fallbacks: ['image:gpt-image-25-fal-low'], style: null },
    { tech: 'package.youtube@1', settings: {}, engine: null, fallbacks: [], style: null }
  ]
}

export const documentary2Base: BasePipeline = {
  id: 'documentary@2',
  labelKey: 'pipe.base.documentary2',
  doc,
  options: [...avatarBase.options.filter((o) => KEEP.has(o.id)), SKIN, MAP_LOOK],
  profile: DOCUMENTARY2_PROFILE
}
