// The technologies of the last three stages (Éléments, Montage, Contrôle et paquet), each one a manifest over the existing
// nodes with no change of behaviour: the wiring is the template pipeline's (simple-video.ts) and the editor drawing's
// (from-drawing.ts). A presenter or animated overlays also ask the director for their shots (`contributes`).
import { z } from 'zod'
import { CardStyle } from '../motion/styled'
import { PresenterRef } from '../presenter/talk'
import { PRESENTER_RESOLUTIONS } from '../../shared/presenter-engines'
import { HEADLINE_LAYOUTS } from '../media/headline'
import { CONTINUOUS_BRIDGE_S } from '../presenter/batch'
import { CAPTION_PRESETS } from '../text/captions'
import { defineTechnology } from './types'
import { MotionPlanParams } from '../nodes/director-motion'
import { MotionLook } from '../motion/look'

const tall = (short: boolean): Record<string, unknown> => (short ? { aspect: '9:16' } : {})

// the pictures bricks (`visuals.fulfil`, `clip.make`) live in catalog-visuals.ts (production-8)
export { clipMake, visualsFulfil } from './catalog-visuals'

/**
 * A talking presenter on the stretches the director marks: the brick `presenter.talk` of the spec (production-model §2.5), made
 * « once, then cut » (production-7, decision 0034) on the pipeline's presenter engine (the fake draws a silhouette).
 */
export const avatarSpeak = defineTechnology({
  id: 'avatar.speak@1',
  labelKey: 'tech.avatar.speak',
  stage: 'elements',
  kind: 'avatar',
  engineFamily: 'presenter',
  styleFamily: 'presenter',
  nodes: [{ id: 'avatar', type: 'avatar.speak@1', in: { genlist: '@genlist', voice: '@voice', words: '@words' } }],
  provides: { avatar: 'avatar.clips' },
  inputs: [
    {
      id: 'avatar',
      kind: 'text',
      suggested: true,
      label: 'Avatar (identifiant du portrait)',
      help: 'L’identifiant du portrait de ton présentateur. Sans lui, la démo dessine une silhouette.'
    }
  ],
  params: z.object({
    /** The channel's presenter; unset: the project's `avatar` input. */
    avatarId: z.string().min(1).max(100).optional(),
    layout: z.enum(['full', 'pip']).default('full'),
    segments: z.array(z.enum(['hook', 'outro'])).min(1).default(['hook', 'outro']),
    /** Option « Présentateur »: one framing, re-crops of the one generation, or the presenter's angles. */
    framing: z.enum(['single', 'recrops', 'multi']).default('single'),
    /** Audio kept on each side of a presenter stretch (pipeline-avatar §2.5 b). */
    handleS: z.number().min(0).max(0.5).default(0.2),
    /** `cut`: once, then cut (only the shots and their handles are generated); `continuous`: the presenter is also generated
     *  under the short cutaways between two of its shots (the base of the cost ladder, production-10). */
    generation: z.enum(['cut', 'continuous']).default('cut'),
    /** The resolution asked; unset: 1080p (avatar-qualite), each engine giving its best up to it at no more than its default
     *  price (`resolutionFor`: HeyGen and Kling 1080p, Hedra and Pruna 720p). */
    resolution: z.enum(PRESENTER_RESOLUTIONS).optional(),
    /** A short motion line from the presenter style, for the engines that take one. */
    motion: z.string().max(300).optional(),
    /** A cloned channel's presenter with its measured angles (decision 0099): the look-alike placeholder's pictures or the user's own;
     *  unset: the channel's presenter (`$style.presenter`). With `framing: 'multi'` the shots switch between these angles. */
    presenter: PresenterRef.optional(),
    /** A demo's stand-ins (decision 0109): `found` = the presenter's photograph (its own picture, else a free stock photo of
     *  `standInPerson`, the planned type) instead of the drawn silhouette (the free style gate sets them). */
    standIns: z.enum(['drawn', 'found']).optional(),
    standInPerson: z.string().min(1).max(200).optional()
  }),
  overridable: { recipe: ['layout', 'segments', 'framing', 'handleS', 'generation', 'resolution', 'motion', 'presenter', 'standIns', 'standInPerson'], channel: ['avatarId', 'layout', 'framing', 'resolution', 'motion'] },
  nodeParams: (p) => ({
    avatar: {
      avatarId: p.avatarId ?? '$inputs.avatar',
      ...(p.presenter ? { presenter: p.presenter } : {}),
      ...(p.standIns !== undefined ? { standIns: p.standIns } : {}),
      ...(p.standInPerson !== undefined ? { standInPerson: p.standInPerson } : {}),
      talk: {
        framing: p.framing,
        handleS: p.handleS,
        ...(p.generation === 'continuous' ? { bridgeS: CONTINUOUS_BRIDGE_S } : {}),
        resolution: p.resolution ?? '1080p',
        ...(p.motion ? { motion: p.motion } : {})
      }
    }
  }),
  // the presenter is a consistency class: its fallbacks make the WHOLE presenter, before the first generation only (R3.4)
  pinParams: (pin) => ({ avatar: { engine: pin.engine, ...(pin.fallbacks.length > 0 ? { fallbacks: [...pin.fallbacks] } : {}) } }),
  contributes: (p) => ({ plan: { params: { avatar: { segments: p.segments, layout: p.layout } } } }),
  cloudUsages: ['talkingAvatar'],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

/** Animated overlays from our templates (and the channel's validated custom bricks, ENGINE-SPEC §25.2). */
export const motionRender = defineTechnology({
  id: 'motion.render@1',
  labelKey: 'tech.motion.render',
  stage: 'elements',
  kind: 'motion',
  // the pictures too: a documentary card (style-markets) frames a found or made picture
  nodes: [{ id: 'motion', type: 'motion.render@1', in: { plan: '@plan', images: '@images?', clips: '@clips?' } }],
  provides: { motion: 'motion.graphics' },
  params: z.object({
    /** The part of the film the overlays may cover (0..0.8); unset: the director's own choice. */
    share: z.number().min(0).max(0.8).optional(),
    /**
     * The animated overlays found in the words (figures, names, lists, places). Off: this brick only draws the documentary cards the
     * director placed (style-markets: the documentary references have no overlay over their pictures).
     */
    overlays: z.boolean().default(true),
    /** Graphics drawn at the same time (1–4); unset: the node's 2. */
    parallel: z.number().int().min(1).max(4).optional(),
    /** Coverage per section of the overlays (hook cap, later chunks' cap, gaps, slide, no template twice in a row). */
    coverage: MotionPlanParams.shape.coverage,
    /** The video's look for its graphics (motion/look.ts): `modern`, `period` (ink on paper), `newsprint`, or a preset with its own palette. */
    look: MotionLook.optional(),
    /** A cloned channel's measured card style (motion/styled.ts, decision 0099), computed from its Style Definition by the clone compiler. */
    style: CardStyle.optional()
  }),
  overridable: { recipe: ['share', 'overlays', 'parallel', 'coverage', 'look', 'style'], channel: ['share', 'overlays', 'coverage', 'look'] },
  // the video's language: the archive cards' captions are written in it (clonage-traduction)
  nodeParams: (p) => ({ motion: { language: '$style.language', ...(p.parallel !== undefined ? { parallel: p.parallel } : {}), ...(p.look !== undefined ? { look: p.look } : {}), ...(p.style !== undefined ? { style: p.style } : {}) } }),
  // the script too: its speakers are the turns of a message conversation
  contributes: (p) => (p.overlays ? { plan: { params: { motion: { ...(p.share !== undefined ? { share: p.share } : {}), ...(p.coverage !== undefined ? { coverage: p.coverage } : {}) } }, in: { script: '@script' } } } : {}),
  cloudUsages: [],
  agentTools: ['bricks.draft', 'bricks.preview', 'bricks.propose'],
  access: 'everyone',
  status: 'validated'
})

/** The user's own clips (gameplay…) as the picture track, cut to the length of the voice. */
export const backgroundClips = defineTechnology({
  id: 'background.clips@1',
  labelKey: 'tech.background.clips',
  stage: 'elements',
  kind: 'background',
  nodes: [{ id: 'background', type: 'background.clips@1', in: { voice: '@voice' } }],
  provides: { background: 'background.layer' },
  inputs: [
    {
      id: 'gameplay',
      kind: 'text',
      required: true,
      label: 'Dossier de clips',
      help: 'Le chemin complet du dossier où sont tes clips (mp4, mov, mkv, webm).'
    }
  ],
  params: z.object({
    minPieceS: z.number().min(0.5).max(60).default(4),
    maxPieceS: z.number().min(1).max(60).default(9),
    /** The measured shot length (median) and spread (90th percentile over the median); unset: an even draw between the bounds. */
    medianS: z.number().min(0.5).max(30).optional(),
    spread: z.number().min(1).max(5).optional(),
    /** Each clip once before any comes back. */
    fresh: z.boolean().optional(),
    /** Colours pushed towards vivid phone footage (0–1). */
    vivid: z.number().min(0).max(1).optional()
  }),
  overridable: { recipe: ['minPieceS', 'maxPieceS', 'medianS', 'spread', 'fresh', 'vivid'], channel: ['medianS', 'fresh', 'vivid'] },
  nodeParams: (p, ctx) => ({
    background: {
      folder: '$inputs.gameplay',
      minPieceS: p.minPieceS,
      maxPieceS: p.maxPieceS,
      ...(p.medianS !== undefined ? { medianS: p.medianS } : {}),
      ...(p.spread !== undefined ? { spread: p.spread } : {}),
      ...(p.fresh !== undefined ? { fresh: p.fresh } : {}),
      ...(p.vivid !== undefined ? { vivid: p.vivid } : {}),
      ...tall(ctx.short)
    }
  }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

export const cardIntro = defineTechnology({
  id: 'card.intro@1',
  labelKey: 'tech.card.intro',
  stage: 'elements',
  kind: 'card',
  nodes: [{ id: 'card', type: 'card.intro@1', in: { outline: '@outline', words: '@words', avatar: '$inputs.channelAvatar' } }],
  provides: { graphics: 'card.card' },
  inputs: [
    { id: 'channel', kind: 'text', suggested: true, label: 'Nom de la chaîne (carte d’intro)' },
    { id: 'channelAvatar', kind: 'image', required: false, label: 'Image de la chaîne (carte d’intro)', help: 'L’image ronde à côté du nom ; sans elle, l’initiale de la chaîne.' }
  ],
  params: z.object({
    subtitle: z.string().max(80).default('À l’instant'),
    /** `plain` (the drawn card) or `post` (a forum post that pops in and out: a story short). */
    look: z.enum(['plain', 'post']).default('plain'),
    likes: z.string().max(12).optional(),
    comments: z.string().max(12).optional(),
    awards: z.number().int().min(0).max(8).optional(),
    verified: z.boolean().optional(),
    /** `post`: seconds it stays after the title is said. */
    afterS: z.number().min(0).max(2).optional(),
    /** `post`: `initial` draws the channel's initial even when it has a picture. */
    avatarMode: z.enum(['picture', 'initial']).optional()
  }),
  overridable: { recipe: ['subtitle', 'look', 'likes', 'comments', 'awards', 'verified', 'afterS', 'avatarMode'], channel: ['subtitle', 'look', 'likes', 'comments', 'awards', 'verified'] },
  nodeParams: (p, ctx) => ({
    card: {
      channel: '$inputs.channel',
      subtitle: p.subtitle,
      ...(p.look === 'post'
        ? {
            look: 'post',
            ...(p.likes !== undefined ? { likes: p.likes } : {}),
            ...(p.comments !== undefined ? { comments: p.comments } : {}),
            ...(p.awards !== undefined ? { awards: p.awards } : {}),
            ...(p.verified !== undefined ? { verified: p.verified } : {}),
            ...(p.afterS !== undefined ? { afterS: p.afterS } : {}),
            ...(p.avatarMode !== undefined ? { avatarMode: p.avatarMode } : {})
          }
        : {}),
      ...tall(ctx.short)
    }
  }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

export const captionsMake = defineTechnology({
  id: 'captions.make@1',
  labelKey: 'tech.captions.make',
  stage: 'montage',
  kind: 'captions',
  styleFamily: 'edit',
  nodes: [{ id: 'captions', type: 'captions.make@1', in: { words: '@words', script: '@script', plan: '@plan' } }],
  provides: { subs: 'captions.subs' },
  params: z.object({
    /** Unset: the channel style's preset (`shorts` for a short). */
    preset: z.enum(CAPTION_PRESETS).optional(),
    /** Unset: the channel style's choice. */
    burn: z.boolean().optional(),
    /** Unset: the preset's own place (`word`: the middle of the frame). */
    position: z.enum(['bottom', 'middle', 'top']).optional(),
    /** `word`: a word spoken faster than this shares the next word's cue. */
    minWordS: z.number().min(0).max(0.5).optional(),
    /** No captions before this sentence of the voice (1: not over the title an intro card shows). */
    fromSentence: z.number().int().min(0).max(5).optional()
  }),
  overridable: { recipe: ['preset', 'burn', 'position', 'minWordS', 'fromSentence'], channel: ['preset', 'burn'] },
  nodeParams: (p, ctx) => {
    const preset = p.preset ?? (ctx.short ? 'shorts' : '$style.captions')
    const position = p.position ?? (preset === 'word' ? 'middle' : undefined)
    return {
      captions: {
        preset,
        burn: p.burn ?? '$style.burn',
        ...(position !== undefined ? { position } : {}),
        ...(p.minWordS !== undefined ? { minWordS: p.minWordS } : {}),
        ...(p.fromSentence !== undefined ? { fromSentence: p.fromSentence } : {})
      }
    }
  },
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

export const soundMusic = defineTechnology({
  id: 'sound.music@1',
  labelKey: 'tech.sound.music',
  stage: 'montage',
  kind: 'music',
  engineFamily: 'music',
  nodes: [{ id: 'sound', type: 'sound.music@1', in: { voice: '@voice', words: '@words', beats: '@beats', plan: '@plan', track: '$inputs.channelMusic' } }],
  provides: { music: 'sound.music' },
  inputs: [{ id: 'channelMusic', kind: 'audio', required: false, label: 'Musique de la chaîne', help: 'Ton morceau (mp3, m4a, wav) : il passe en boucle sous la voix, à la place de la bibliothèque.' }],
  params: z.object({
    mood: z.string().min(1).max(40).optional(),
    liftDb: z.number().min(0).max(12).default(6),
    /** `library`: the library even when the channel has its own track. */
    source: z.enum(['library']).optional(),
    /** The bed under the voice (dB, the reference's measure, e.g. −15 for pov@1); unset: the register's default. */
    bedDb: z.number().min(-40).max(0).optional(),
    /** A cue may change under the voice at a sentence's end when no pause holds its crossfade (a voice with short pauses). */
    fadeUnderVoice: z.boolean().optional()
  }),
  overridable: { recipe: ['mood', 'liftDb', 'source', 'bedDb', 'fadeUnderVoice'], channel: ['mood'] },
  nodeParams: (p) => ({ sound: { liftDb: p.liftDb, ...(p.mood ? { mood: p.mood } : {}), ...(p.source ? { source: p.source } : {}), ...(p.bedDb !== undefined ? { bedDb: p.bedDb } : {}), ...(p.fadeUnderVoice ? { fadeUnderVoice: true } : {}) } }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

export const renderAssemble = defineTechnology({
  id: 'render.assemble@1',
  labelKey: 'tech.render.assemble',
  stage: 'montage',
  kind: 'render',
  styleFamily: 'edit',
  nodes: [
    {
      id: 'render',
      type: 'render.assemble@1',
      in: {
        plan: '@plan',
        images: '@images?',
        clips: '@clips?',
        avatar: '@avatar?',
        graphics: '@graphics?',
        motion: '@motion?',
        background: '@background?',
        voice: '@voice',
        music: '@music?',
        subs: '@subs?',
        sponsor: '@sponsor?',
        chapters: '@chapters?',
        words: '@words?'
      }
    }
  ],
  provides: { video: 'render.video' },
  params: z.object({
    // production-17: the final pass is the only real compression (intermediates are near-lossless); 21 / veryfast gave
    // 2.8 Mbit/s at 1080p30 on the first real run, soft next to the reference's 6.9
    crf: z.number().int().min(14).max(30).default(18),
    encoderPreset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow']).default('medium'),
    /** The pictures' colour grade (render/segments.ts GRADES); `archive` is the documentary look (style-markets). Unset: none. */
    grade: z.enum(['none', 'warm', 'cool', 'film', 'archive', 'archive-film']).optional(),
    /** Black bars top and bottom: the picture's aspect between them, measured on the reference (moteur-briques). Unset: none. */
    letterbox: z.number().min(1).max(4).optional(),
    /** The reference's measured frame format (moteur-pov-2): the delivered film must have it (a blocking check, re-framed then refused). */
    aspect: z.enum(['16:9', '9:16']).optional(),
    /**
     * qualite-montage: every render is reviewed shot by shot against the words before anyone sees it (src/engine/review/), and fixes what it
     * can on its own plan, then renders again (`editReviewRounds` at most); `editReviewLook`: Claude looks at every picture (subscription, fast tier).
     */
    editReview: z.enum(['off', 'report', 'repair']).default('repair'),
    editReviewRounds: z.number().int().min(0).max(3).default(2),
    editReviewLook: z.boolean().default(true),
    /** controles-bloquants (decision 0102): a film with a real error left is refused (unset: refuse) or only reported (a test render). */
    editBlocking: z.enum(['refuse', 'report']).optional(),
    /** The « DÉMO » mark: `auto` (on when a demo provider made any part), or `off` for the clone gate's judge copy only. */
    watermark: z.enum(['auto', 'off']).optional()
  }),
  overridable: { recipe: ['crf', 'encoderPreset', 'grade', 'letterbox', 'aspect', 'editReview', 'editReviewRounds', 'editReviewLook', 'editBlocking', 'watermark'], channel: ['grade'] },
  nodeParams: (p) => ({ render: { crf: p.crf, preset: p.encoderPreset, ...(p.grade ? { grade: p.grade } : {}), ...(p.letterbox !== undefined ? { letterbox: p.letterbox } : {}), ...(p.aspect ? { aspect: p.aspect } : {}), review: p.editReview, reviewRounds: p.editReviewRounds, reviewLook: p.editReviewLook, ...(p.editBlocking ? { blocking: p.editBlocking } : {}), ...(p.watermark ? { watermark: p.watermark } : {}) } }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

export const qcCheck = defineTechnology({
  id: 'qc.check@1',
  labelKey: 'tech.qc.check',
  stage: 'controle',
  kind: 'qc',
  nodes: [{ id: 'qc', type: 'qc.check@1', in: { video: '@video', plan: '@plan?' } }],
  provides: { qc: 'qc.report' },
  params: z.object({ targetLufs: z.number().min(-30).max(-5).default(-14) }),
  overridable: { recipe: ['targetLufs'], channel: [] },
  nodeParams: (p) => ({ qc: { targetLufs: p.targetLufs } }),
  cloudUsages: [],
  agentTools: ['qc.check'],
  access: 'everyone',
  status: 'validated'
})

export const thumbnailMake = defineTechnology({
  id: 'thumbnail.make@1',
  labelKey: 'tech.thumbnail.make',
  stage: 'controle',
  kind: 'thumbnail',
  engineFamily: 'image',
  styleFamily: 'image',
  nodes: [{ id: 'thumbnails', type: 'thumbnail.make@1', in: { script: '@script', outline: '@outline' } }],
  provides: { thumbnails: 'thumbnails.thumbnails' },
  params: z.object({
    count: z.number().int().min(1).max(4).default(3),
    // unset: the channel's style profile (its thumbnails' traits), else the node's defaults
    layout: z.enum(HEADLINE_LAYOUTS).optional(),
    style: z.string().min(1).max(600).optional(),
    withFace: z.boolean().optional()
  }),
  overridable: { recipe: ['count', 'layout', 'style', 'withFace'], channel: ['layout', 'style', 'withFace'] },
  nodeParams: (p) => ({
    thumbnails: {
      language: '$style.language',
      count: p.count,
      ...(p.layout ? { layout: p.layout } : {}),
      ...(p.style ? { style: p.style } : {}),
      ...(p.withFace !== undefined ? { withFace: p.withFace } : {})
    }
  }),
  // the art on the brick's image engine, like the stills (production-17)
  pinParams: (pin) => ({ thumbnails: { engine: pin.engine, ...(pin.fallbacks.length > 0 ? { fallbacks: [...pin.fallbacks] } : {}) } }),
  cloudUsages: ['generateImage'],
  agentTools: ['thumbnail.brief'],
  access: 'everyone',
  status: 'validated'
})

export const packageYoutube = defineTechnology({
  id: 'package.youtube@1',
  labelKey: 'tech.package.youtube',
  stage: 'controle',
  kind: 'package',
  nodes: [
    {
      id: 'package',
      type: 'package.youtube@1',
      in: {
        video: '@video',
        script: '@script',
        outline: '@outline',
        words: '@words',
        subs: '@subs',
        plan: '@plan?',
        images: '@images?',
        thumbnails: '@thumbnails?',
        brief: '@brief?'
      }
    }
  ],
  provides: { package: 'package.package' },
  params: z.object({ footer: z.array(z.string().min(1).max(300)).max(10).default([]) }),
  overridable: { recipe: ['footer'], channel: ['footer'] },
  nodeParams: (p) => ({ package: { language: '$style.language', footer: p.footer } }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})
