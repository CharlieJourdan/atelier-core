// The technologies of the first four stages (Idée, Script, Voix, Réalisateur), each one a manifest over the existing
// nodes with no change of behaviour: the wiring is the template pipeline's (simple-video.ts) and the editor drawing's
// (from-drawing.ts). Settings left unset read the channel style (`$style.x`), as the template does.
import { z } from 'zod'
import { POV_DEPTHS, POV_PALETTES, PovFigures, PovHeld, PovType } from '../formats/pov'
import { ILLUSTRATION_PRESETS } from '../nodes/director-grammars'
import { STYLE_BRANDS, STYLE_PEOPLE } from '../../shared/brick-styles'
import { LAYOUTS } from '../formats/directives'
import { PaceRows, SHOT_LENGTHS } from '../nodes/director-screen'
import { PresenterLayouts } from '../nodes/director-layouts'
import { Locale, ObjectNotes } from '../text/locale'
import type { Mix } from './mix'
import { defineTechnology } from './types'
import { TEXT_CHECKS } from '../nodes/director-textcheck'

export const ideaResearch = defineTechnology({
  id: 'idea.research@1',
  labelKey: 'tech.idea.research',
  stage: 'idee',
  kind: 'research',
  engineFamily: 'llm',
  nodes: [{ id: 'research', type: 'research.topic@1', in: { topic: '$inputs.topic' } }],
  provides: { brief: 'research.brief' },
  inputs: [{ id: 'topic', kind: 'text', required: true, label: 'Sujet ou titre' }],
  params: z.object({
    maxSearches: z.number().int().min(0).max(12).default(8),
    requireSources: z.boolean().default(true)
  }),
  overridable: { recipe: ['maxSearches', 'requireSources'], channel: [] },
  nodeParams: (p) => ({ research: { language: '$style.language', maxSearches: p.maxSearches, requireSources: p.requireSources } }),
  cloudUsages: [],
  agentTools: ['channel.outliers', 'ideas.list'],
  access: 'everyone',
  status: 'validated'
})

export const scriptWrite = defineTechnology({
  id: 'script.write@1',
  labelKey: 'tech.script.write',
  stage: 'script',
  kind: 'script',
  engineFamily: 'llm',
  styleFamily: 'script',
  nodes: [{ id: 'script', type: 'script.write@1', in: { brief: '@brief' } }],
  provides: { script: 'script.text', outline: 'script.outline' },
  params: z.object({
    revise: z.boolean().default(true),
    /** Unset: the channel's style profile, else the end of the video. */
    ctaMode: z.enum(['none', 'end', 'mid_end']).optional()
  }),
  overridable: { recipe: ['revise', 'ctaMode'], channel: ['ctaMode'] },
  nodeParams: (p) => ({ script: { language: '$style.language', revise: p.revise, ...(p.ctaMode ? { ctaMode: p.ctaMode } : {}) } }),
  cloudUsages: [],
  agentTools: ['script.brief', 'script.save'],
  access: 'everyone',
  status: 'validated'
})

/** The person's own script: the run waits for it (a required input) instead of writing one. */
export const scriptPasted = defineTechnology({
  id: 'script.pasted@1',
  labelKey: 'tech.script.pasted',
  stage: 'script',
  kind: 'script',
  nodes: [{ id: 'script', type: 'script.write@1', in: { brief: '@brief', pasted: '$inputs.script' } }],
  provides: { script: 'script.text', outline: 'script.outline' },
  inputs: [{ id: 'script', kind: 'text', required: true, label: 'Script', help: 'Ton texte : la production attend ton script au lieu d’en écrire un.' }],
  params: z.object({}),
  overridable: { recipe: [], channel: [] },
  nodeParams: () => ({ script: { language: '$style.language' } }),
  cloudUsages: [],
  agentTools: ['script.save'],
  access: 'everyone',
  status: 'validated'
})

/** A second brick of the Script stage: from then on every brick reads the translation. */
export const scriptTranslate = defineTechnology({
  id: 'script.translate@1',
  labelKey: 'tech.script.translate',
  stage: 'script',
  kind: 'translate',
  engineFamily: 'llm',
  nodes: [{ id: 'translate', type: 'script.translate@1', in: { script: '@script', outline: '@outline' } }],
  provides: { script: 'translate.text', outline: 'translate.outline' },
  params: z.object({ chunkWords: z.number().int().min(150).max(1500).default(500) }),
  overridable: { recipe: ['chunkWords'], channel: [] },
  nodeParams: (p) => ({ translate: { language: '$style.language', chunkWords: p.chunkWords } }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

export const voiceTts = defineTechnology({
  id: 'voice.tts@1',
  labelKey: 'tech.voice.tts',
  stage: 'voix',
  kind: 'voice',
  engineFamily: 'voice',
  nodes: [{ id: 'voice', type: 'voice.tts@1', in: { script: '@script' } }],
  provides: { voice: 'voice.audio', words: 'voice.words' },
  params: z.object({
    /** A voice id of Atelier Cloud; unset: the channel style's voice. */
    voice: z.string().min(1).max(100).optional(),
    speed: z.number().min(0.7).max(1.2).default(1),
    /** `voice.trim`: longer pauses are shortened to this (pipeline-avatar §2.3: one breath kept, dead air removed). */
    maxPauseS: z.number().min(0.2).max(3).default(0.6),
    /** The channel's measured pace in words a minute; unset: the voice as it speaks. */
    wpm: z.number().min(80).max(450).optional()
  }),
  overridable: { recipe: ['voice', 'speed', 'maxPauseS', 'wpm'], channel: ['voice', 'speed', 'maxPauseS', 'wpm'] },
  nodeParams: (p) => ({ voice: { voice: p.voice ?? '$style.voice', language: '$style.language', pace: '$style.pace', speed: p.speed, maxPauseS: p.maxPauseS, ...(p.wpm !== undefined ? { wpm: p.wpm } : {}) } }),
  // the voice is a consistency class: its fallbacks serve a whole narration, never a piece of one (voice-engines.ts)
  pinParams: (pin) => ({ voice: { engine: pin.engine, ...(pin.fallbacks.length > 0 ? { fallbacks: [...pin.fallbacks] } : {}) } }),
  cloudUsages: ['synthesize'],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

/** The person's own recording, cut to the word (`voice.own`). Draft: the app cannot hand a run a recording yet. */
export const voiceOwn = defineTechnology({
  id: 'voice.own@1',
  labelKey: 'tech.voice.own',
  stage: 'voix',
  kind: 'voice',
  nodes: [{ id: 'voice', type: 'voice.own@1', in: { recording: '$inputs.recording', script: '@script?' } }],
  provides: { voice: 'voice.audio', words: 'voice.words' },
  inputs: [{ id: 'recording', kind: 'audio', required: true, label: 'Ton enregistrement' }],
  params: z.object({}),
  overridable: { recipe: [], channel: [] },
  nodeParams: () => ({ voice: { language: '$style.language', pace: '$style.pace' } }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'draft'
})

/**
 * « Minutage des mots » (record 0059): the voice we ship heard again by Whisper on this computer, every script word on the time
 * it is really said; every later brick reads `@words` from it. Free; without a recogniser the voice's own times are kept.
 */
export const wordsAlign = defineTechnology({
  id: 'words.align@1',
  labelKey: 'tech.words.align',
  stage: 'voix',
  kind: 'timing',
  nodes: [{ id: 'timing', type: 'words.align@1', in: { voice: '@voice', words: '@words', script: '@script' } }],
  provides: { words: 'timing.words' },
  params: z.object({
    /** Under this share of the script's words heard, the voice's own times are kept. */
    minMatch: z.number().min(0.3).max(1).default(0.8)
  }),
  overridable: { recipe: ['minMatch'], channel: [] },
  nodeParams: (p) => ({ timing: { language: '$style.language', minMatch: p.minMatch } }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

/** A mix the director follows: it names the presenter, a curve or shot lengths (a version 1 pipeline's only splits the pictures). */
export const followsMix = (m: Mix): boolean => (m.presenter ?? 0) > 0 || m.curve !== 'flat' || m.shotLengthS !== undefined

/** The edit plan: the beats of the narration, then what goes where (`beats.split` + `director.plan`). */
export const directorPlan = defineTechnology({
  id: 'director.plan@1',
  labelKey: 'tech.director.plan',
  stage: 'realisateur',
  kind: 'director',
  engineFamily: 'llm',
  styleFamily: 'director',
  nodes: [
    { id: 'beats', type: 'beats.split@1', in: { script: '@script', words: '@words', outline: '@outline' } },
    { id: 'director', type: 'director.plan@1', in: { beats: 'beats.beats', words: '@words', outline: '@outline', brief: '@brief?' } }
  ],
  provides: { beats: 'beats.beats', plan: 'director.plan', genlist: 'director.genlist' },
  // unset settings are left to the channel's style profile (it fills what the recipe leaves open), else the node's defaults
  params: z.object({
    /** Cuts per minute; unset: the profile's, else 12 (24 for a short). */
    cpm: z.number().min(4).max(40).optional(),
    /** Share of stock footage among the pictures (the rest is generated images). */
    stockShare: z.number().min(0).max(1).optional(),
    /** Share of the pictures upgraded to generated video. */
    videoShare: z.number().min(0).max(1).optional(),
    maxVideoClips: z.number().int().min(0).max(40).optional(),
    /** Presenter placement (pipeline-avatar §2.4): `short` (a shot per sentence or two) or `stretches` (longer, `presenterStretchS`). */
    placement: z.enum(['short', 'stretches']).optional(),
    /** The channel's measured presenter stretch, in seconds (never a preset number). */
    presenterStretchS: z.number().min(4).max(60).optional(),
    /** The presenter layouts the director may use. */
    layouts: z.array(z.enum(LAYOUTS)).min(1).optional(),
    /** Who may appear in the pictures, and real brands or none (options « Qui apparaît », « Marques »). */
    people: z.enum(STYLE_PEOPLE).optional(),
    brands: z.enum(STYLE_BRANDS).optional(),
    /** On-screen text labels a minute (a figure, a name); 0: none (avatar@1, like its reference videos). Unset: the node's 4. */
    labelsPerMin: z.number().min(0).max(10).optional(),
    /** The editing's pace: the mix's shot lengths times this (avatar-reglages-voix, « Montage dynamique »: 0.75). */
    pace: z.number().min(0.5).max(1.5).optional(),
    /** The measured cadence along the video (the mean shot length part by part): shot lengths times each row's factor from its `fromS`. */
    paceRows: PaceRows.optional(),
    // the pipeline's measured requirements (record 0055): unset, the director has no such limit
    /** The longest run of presenter shots back to back, in seconds. */
    presenterRunMaxS: z.number().min(3).max(120).optional(),
    /** The presenter on the sentences that speak to the viewer, the pictures on what is named. */
    presenterOnTalk: z.boolean().optional(),
    /** A picture is cut this long before the word that names it. */
    cutLeadS: z.number().min(0).max(0.5).optional(),
    /** No subject twice within this many seconds. */
    repeatWindowS: z.number().min(0).max(120).optional(),
    /** The presenter's layouts as the references measure them: full frame before `fromS`, then split / inset / full shares. */
    presenterLayouts: PresenterLayouts.optional(),
    /** Where the video's world is (`fr-FR`): its homes, equipment, brands, money and units, in the directives. */
    locale: Locale.optional(),
    /** Object-accuracy notes (« condensate pipe: a thin 16 mm flexible white PVC tube »). */
    objectNotes: ObjectNotes.optional(),
    /** The illustration preset measured on the pipeline's references. */
    illustration: z.enum(ILLUSTRATION_PRESETS).optional(),
    /** Documentary cards (style-markets): maps, data cards, timelines and framed archives, the mix's motion share as their budget. */
    cards: z.boolean().optional(),
    /** Where the soft transitions go: `paragraph` (default) or `sentence` (the documentary references). */
    transitions: z.enum(['paragraph', 'sentence']).optional(),
    /** The documentary cards' style: `dark` (the reference's) or `light` (« parchemin »). */
    cardTheme: z.enum(['dark', 'light']).optional(),
    /**
     * The on-screen text check (director text check): `rules` (every number, name and quotation written on screen is in the script; free),
     * `evidence` (the rules, then Claude must quote the script for each text; stricter). Unset: the labels' word check only.
     */
    textCheck: z.enum(TEXT_CHECKS).optional(),
    /** On-screen labels a minute over the hook, counted apart from the rest (director text check). Unset: one quota for the whole film. */
    labelsHookPerMin: z.number().min(0).max(20).optional(),
    /** False: no scene pass by the model (a pipeline whose picture is the user's clips needs only the plan's timing). */
    scenePass: z.boolean().optional(),
    /** A director grammar of its own: `documentary-2` (the archive documentary's measured, varied sequence, director-doc2.ts). */
    grammar: z.enum(['documentary-2']).optional(),
    /** documentary-2 proposals: the boards on a kraft file folder with red stamps (`dossier`), the maps as old parchment. */
    docSkin: z.enum(['reference', 'dossier']).optional(),
    docMapLook: z.enum(['satellite', 'parchment']).optional()
  }),
  overridable: {
    recipe: ['cpm', 'stockShare', 'videoShare', 'maxVideoClips', 'placement', 'presenterStretchS', 'layouts', 'people', 'brands', 'labelsPerMin', 'presenterRunMaxS', 'presenterOnTalk', 'cutLeadS', 'repeatWindowS', 'illustration', 'cards', 'transitions', 'presenterLayouts', 'locale', 'objectNotes', 'cardTheme', 'pace', 'paceRows', 'textCheck', 'labelsHookPerMin', 'scenePass', 'grammar', 'docSkin', 'docMapLook'],
    channel: ['cpm', 'placement', 'presenterStretchS', 'layouts', 'people', 'brands', 'labelsPerMin', 'presenterRunMaxS', 'presenterOnTalk', 'cutLeadS', 'repeatWindowS', 'illustration', 'cards', 'transitions', 'presenterLayouts', 'locale', 'objectNotes', 'cardTheme', 'pace', 'docSkin', 'docMapLook']
  },
  // the pipeline's mix (decision 0022): the generated video's share among the pictures, and stock's (archives count as
  // found footage) among the stills; the presenter, motion and the user's footage are not pictures the director fills
  fromMix: (m) => {
    const pictures = (m.clipAi ?? 0) + (m.imageAi ?? 0) + (m.stock ?? 0) + (m.archive ?? 0)
    if (pictures <= 0) return {}
    const found = (m.stock ?? 0) + (m.archive ?? 0)
    const stills = found + (m.imageAi ?? 0)
    const r = (x: number): number => Math.round(x * 100) / 100
    return { videoShare: r((m.clipAi ?? 0) / pictures), ...(stills > 0 ? { stockShare: r(found / stills) } : {}) }
  },
  nodeParams: (p, ctx) => ({
    director: {
      captionsPreset: ctx.short ? 'shorts' : '$style.captions',
      ...(p.stockShare !== undefined ? { mix: { stock: p.stockShare, image: Math.round((1 - p.stockShare) * 100) / 100 } } : {}),
      ...(p.videoShare !== undefined ? { videoShare: p.videoShare } : {}),
      ...(p.maxVideoClips !== undefined ? { maxVideoClips: p.maxVideoClips } : {}),
      ...(p.cpm !== undefined ? { cpm: p.cpm } : ctx.short ? { cpm: 24 } : {}),
      ...(p.scenePass !== undefined ? { scenePass: p.scenePass } : {}),
      ...(p.labelsPerMin !== undefined ? { labelsPerMin: p.labelsPerMin } : {}),
      ...(p.labelsHookPerMin !== undefined ? { labelsHookPerMin: p.labelsHookPerMin } : {}),
      ...(p.textCheck !== undefined ? { textCheck: p.textCheck } : {}),
      ...(p.paceRows !== undefined ? { paceRows: p.paceRows } : {}),
      ...(p.grammar !== undefined ? { grammar: p.grammar } : {}),
      ...(p.docSkin !== undefined ? { docSkin: p.docSkin } : {}),
      ...(p.docMapLook !== undefined ? { docMapLook: p.docMapLook } : {}),
      ...(ctx.short ? { aspect: '9:16', maxShotS: 5 } : {}),
      // the pipeline's mix and curve: the director follows them (production-6); a mix that only splits the pictures (a version 1
      // pipeline's) keeps the rhythm director
      ...(ctx.mix && followsMix(ctx.mix)
        ? {
            screen: {
              mix: paced(ctx.mix, p.pace),
              ...(p.placement !== undefined ? { placement: p.placement } : {}),
              ...(p.presenterStretchS !== undefined ? { presenterStretchS: p.presenterStretchS } : {}),
              ...(p.layouts !== undefined ? { layouts: p.layouts } : {}),
              ...(p.people !== undefined ? { people: p.people } : {}),
              ...(p.brands !== undefined ? { brands: p.brands } : {}),
              ...(p.presenterRunMaxS !== undefined ? { presenterRunMaxS: p.presenterRunMaxS } : {}),
              ...(p.presenterOnTalk !== undefined ? { presenterOnTalk: p.presenterOnTalk } : {}),
              ...(p.cutLeadS !== undefined ? { cutLeadS: p.cutLeadS } : {}),
              ...(p.repeatWindowS !== undefined ? { repeatWindowS: p.repeatWindowS } : {}),
              ...(p.illustration !== undefined ? { illustration: p.illustration } : {}),
              ...(p.presenterLayouts !== undefined ? { presenterLayouts: p.presenterLayouts } : {}),
              ...(p.locale !== undefined ? { locale: p.locale } : {}),
              ...(p.objectNotes !== undefined ? { objectNotes: p.objectNotes } : {}),
              ...(p.cards !== undefined ? { cards: p.cards } : {}),
              ...(p.transitions !== undefined ? { transitions: p.transitions } : {}),
              ...(p.cardTheme !== undefined ? { cardTheme: p.cardTheme } : {})
            }
          }
        : {})
    }
  }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

/** The mix with its shot lengths times `pace` (unset or 1: as it is); a length the mix leaves open is the director's default. */
export function paced(mix: Mix, pace: number | undefined): Mix {
  if (pace === undefined || pace === 1) return mix
  const len = { ...SHOT_LENGTHS, ...(mix.shotLengthS ?? {}) } as Record<string, number>
  const kinds = ['presenter', 'clipAi', 'imageAi', 'stock', 'archive'] as const
  return { ...mix, shotLengthS: Object.fromEntries(kinds.map((k) => [k, Math.round((len[k] as number) * pace * 100) / 100])) as Mix['shotLengthS'] }
}

/**
 * The edit plan of a 2D motion-design « what if » story (clone-monde-pov, research note style-monde-pov-2026-11 (old repository)): the beats, then
 * the POV director, whose every shot is a drawn `pov` card (a set with its cast and props, a face close-up, a data or UI card). Nothing
 * to generate: the plan's generation list is empty.
 */
export const directorPov = defineTechnology({
  id: 'director.pov@1',
  labelKey: 'tech.director.pov',
  stage: 'realisateur',
  kind: 'director',
  engineFamily: 'llm',
  nodes: [
    { id: 'beats', type: 'beats.split@1', in: { script: '@script', words: '@words', outline: '@outline' } },
    { id: 'director', type: 'director.pov@1', in: { beats: 'beats.beats', words: '@words', outline: '@outline', brief: '@brief?' } }
  ],
  provides: { beats: 'beats.beats', plan: 'director.plan', genlist: 'director.genlist' },
  params: z.object({
    /** The video's palette (the references: dusk, night, blue, day). */
    palette: z.enum(POV_PALETTES).default('dusk'),
    /** Seconds between two cuts (median) and in the hook; unset: the measured 2.7 s and 2.4 s. */
    shotS: z.number().min(1).max(10).optional(),
    hookShotS: z.number().min(1).max(10).optional(),
    /** A face close-up about every this many seconds. */
    faceEveryS: z.number().min(5).max(120).optional(),
    /** The longest a scene or a face stays before a reaction cuts it. */
    maxStillS: z.number().min(3).max(20).optional(),
    /** moteur-briques: the places shot with depth of field (`deep`), the first-person hand shots' share, the cards' measured type. */
    depth: z.enum(POV_DEPTHS).optional(),
    handShare: z.number().min(0).max(0.8).optional(),
    type: PovType.optional(),
    /** moteur-pov-2: the cast's measured drawing, the things held up in first person, the first-person share of the opening. */
    figures: PovFigures.optional(),
    held: z.array(PovHeld).max(6).optional(),
    opening: z.object({ s: z.number().min(0).max(600), handShare: z.number().min(0).max(0.9) }).optional(),
    /** The measured screen-time mix of the drawn shots (places, faces, data, phone), the first-person ones apart. */
    shares: z.object({ scene: z.number().min(0).max(1), face: z.number().min(0).max(1), data: z.number().min(0).max(1), ui: z.number().min(0).max(1) }).optional()
  }),
  overridable: { recipe: ['palette', 'shotS', 'hookShotS', 'faceEveryS', 'maxStillS', 'depth', 'handShare', 'type', 'figures', 'held', 'opening', 'shares'], channel: ['palette'] },
  nodeParams: (p, ctx) => ({
    director: {
      palette: p.palette,
      ...(ctx.short ? { aspect: '9:16' } : {}),
      ...(p.shotS !== undefined ? { shotS: p.shotS } : {}),
      ...(p.hookShotS !== undefined ? { hookShotS: p.hookShotS } : {}),
      ...(p.faceEveryS !== undefined ? { faceEveryS: p.faceEveryS } : {}),
      ...(p.maxStillS !== undefined ? { maxStillS: p.maxStillS } : {}),
      ...(p.depth !== undefined ? { depth: p.depth } : {}),
      ...(p.handShare !== undefined ? { handShare: p.handShare } : {}),
      ...(p.type !== undefined ? { type: p.type } : {}),
      ...(p.figures !== undefined ? { figures: p.figures } : {}),
      ...(p.held !== undefined ? { held: p.held } : {}),
      ...(p.opening !== undefined ? { openingS: p.opening.s, openingHandShare: p.opening.handShare } : {}),
      ...(p.shares !== undefined ? { shares: p.shares } : {})
    }
  }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})
