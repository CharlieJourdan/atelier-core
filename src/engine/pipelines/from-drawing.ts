// From a drawn pipeline (the editor's « dessin », src/shared/pipeline-drawing.ts) to an executable `atelier.pipeline/1`
// document. The engine has one chain of real nodes (research → script → voice → beats → director → visuals → captions →
// music → render → package); a drawing chooses which optional ones run (captions, music, thumbnails, package), where the run stops
// for the user (gates), and the visual mix (stock / generated images / generated video, from the drawn shares). A talking avatar step
// is `avatar.speak` (the presenter speaks the hook and the outro, full frame, or in picture-in-picture over a gameplay background).
// The
// faceless formats add their own: a gameplay step is the background made of the user's clips (`background.clips`, no
// generated pictures then), a card step the intro card (`card.intro`), a qc step the free quality check (`qc.check`), a
// translate step the translated script (`script.translate`), and a script given to a human is a script the run waits
// for: a required pipeline input wired to `script.write`'s pasted-script port. Steps with no engine node (animated graphics,
// custom code, video generation with no picture to start from) are left out and reported, and
// the nodes a video cannot do without are added and reported too. A drawing of a short (`format: 'short'`) compiles to a 9:16
// film: every node that draws the picture gets `aspect: '9:16'`, the director cuts faster and the captions are the shorts
// style (a few words at a time, the spoken one highlighted). Pure: no I/O.
import type { DrawingNote, DrawingStep, PipelineDrawing } from '../../shared/pipeline-drawing'
import type { Pipeline, PipelineNode } from '../pipeline-schema'

const ENGINE_LABEL: Record<string, string> = {
  research: 'Recherche',
  script: 'Script',
  voice: 'Voix',
  beats: 'Découpage',
  director: 'Réalisation',
  avatar: 'Présentateur',
  motion: 'Animations',
  visuals: 'Visuels',
  captions: 'Sous-titres',
  sound: 'Musique',
  render: 'Rendu',
  thumbnail: 'Miniature',
  package: 'Paquet YouTube'
}

/** A script the drawing gives to a person: the run waits for it instead of writing one. */
const isHumanScript = (s: DrawingStep): boolean => s.runner === 'human' && (s.kind === 'script' || (s.kind === 'human-input' && /script/i.test(s.label)))

/** The engine node a drawn step becomes (null: none yet). `s` is read with the whole drawing for the kinds that depend on it. */
function engineNodeOf(s: DrawingStep, steps: readonly DrawingStep[]): string | null {
  switch (s.kind) {
    case 'idea':
      return 'research'
    case 'script':
      return 'script'
    case 'human-input':
      return /script/i.test(s.label) ? 'script' : null
    case 'director':
      return 'director'
    case 'avatar':
      return 'avatar'
    case 'motion':
      return 'motion'
    case 'stock':
    case 'image-gen':
      // pictures are not made over a gameplay background: the user's clips are the picture track
      return steps.some((x) => x.kind === 'gameplay') ? null : 'visuals'
    case 'video-gen':
      // generated video starts from a picture: with no stock or image step to start from, it has nothing to animate
      return steps.some((x) => x.kind === 'stock' || x.kind === 'image-gen') && !steps.some((x) => x.kind === 'gameplay') ? 'visuals' : null
    case 'voice':
      return 'voice'
    case 'music':
      return 'sound'
    case 'captions':
      return 'captions'
    case 'edit':
      return 'render'
    case 'gameplay':
      return 'background'
    case 'card':
      return 'card'
    case 'qc':
      return 'qc'
    case 'translate':
      return 'translate'
    case 'thumbnail':
      return 'thumbnail'
    case 'publish':
      return 'package'
    // code (free code) has no engine node
    default:
      return null
  }
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))
const round2 = (n: number): number => Math.round(n * 100) / 100

/** Visual mix from the drawn shares: stock vs generated images for the base track, the share upgraded to video. */
export function visualMix(steps: readonly DrawingStep[]): { mix: { stock: number; image: number }; videoShare: number } {
  const share = (kind: DrawingStep['kind']) => steps.filter((s) => s.kind === kind).reduce((n, s) => n + (s.share ?? 0), 0)
  const stock = share('stock')
  const image = share('image-gen')
  const video = share('video-gen')
  const base = stock + image
  const mix = base > 0 ? { stock: round2(stock / base), image: round2(1 - round2(stock / base)) } : { stock: 0.6, image: 0.4 }
  // generated video replaces generated images (it starts from one), so its share is taken on the images
  const videoShare = video > 0 ? round2(clamp01(video / Math.max(1, image + video))) : 0
  return { mix, videoShare }
}

export interface CompiledDrawing {
  pipeline: Pipeline
  mapping: Record<string, string | null>
  notes: DrawingNote[]
}

/** Where the script a node reads comes from: the translation when the drawing has one, else the script itself. */
const scriptRef = (translated: boolean): string => (translated ? 'translate' : 'script')

export function pipelineFromDrawing(drawing: PipelineDrawing, opts: { id?: string; minutes?: number } = {}): CompiledDrawing {
  const minutes = opts.minutes ?? 8
  const steps = drawing.steps
  const mapping: Record<string, string | null> = {}
  const notes: DrawingNote[] = []
  const gated = new Set<string>()
  const wanted = new Set<string>()
  const humanScript = steps.some(isHumanScript)
  const short = drawing.format === 'short'
  // what a vertical film adds to the nodes that draw or cut the picture; nothing for long-form, so its documents stay as they were
  const tall = short ? { aspect: '9:16' } : {}

  for (const s of steps) {
    const node = engineNodeOf(s, steps)
    mapping[s.id] = node
    if (!node) {
      notes.push({ stepId: s.id, label: s.label, code: 'not_executable' })
      continue
    }
    wanted.add(node)
    if (s.gate) gated.add(node)
    // a human script is waited for (see `humanScript`); a human voice is still made by the engine
    if (s.runner === 'human' && node === 'voice') notes.push({ stepId: s.id, label: s.label, code: 'engine_does_it' })
  }
  // What any video needs; the package needs captions (its subtitles file).
  // Over a gameplay background the base track is the user's clips: no pictures are generated.
  const required = ['research', 'script', 'voice', 'beats', 'director', ...(wanted.has('background') ? [] : ['visuals']), 'render']
  // a thumbnail lands in the package folder (`thumbnail.png`), so it brings the package, and the package needs the captions
  if (wanted.has('thumbnail')) required.push('package')
  if (wanted.has('package') || wanted.has('thumbnail')) required.push('captions')
  for (const node of required) {
    if (wanted.has(node)) continue
    wanted.add(node)
    if (node !== 'beats') notes.push({ stepId: node, label: ENGINE_LABEL[node] ?? node, code: 'added' })
  }

  const gate = (node: string): PipelineNode['gate'] => (node === 'package' || node === 'thumbnail' ? 'owner' : gated.has(node) ? 'review' : 'none')
  const { mix, videoShare } = visualMix(steps)
  // the translation, when there is one, is THE script from then on: voice, beats, captions and package read it
  const from = scriptRef(wanted.has('translate'))
  // a presenter over a gameplay background is a small picture over it (the background IS the picture track); otherwise it takes the frame
  const avatarParams = wanted.has('avatar') ? { avatar: { segments: ['hook', 'outro'], layout: wanted.has('background') ? 'pip' : 'full' } } : {}
  // the animated overlays: the director chooses them (the drawn share is the part of the film they may cover), `motion.render` draws them
  const motionShare = steps.filter((x) => x.kind === 'motion').reduce((n, x) => n + (x.share ?? 0), 0)
  const motionParams = wanted.has('motion') ? { motion: motionShare > 0 ? { share: round2(Math.min(0.8, motionShare / 100)) } : {} } : {}
  const text = `${from}.text`
  const outline = `${from}.outline`
  const nodes: PipelineNode[] = [
    { id: 'research', type: 'research.topic@1', in: { topic: '$inputs.topic' }, params: { language: '$style.language' }, gate: gate('research') },
    {
      id: 'script',
      type: 'script.write@1',
      in: { brief: 'research.brief', ...(humanScript ? { pasted: '$inputs.script' } : {}) },
      params: { language: '$style.language' },
      gate: gate('script')
    },
    ...(wanted.has('translate')
      ? [{ id: 'translate', type: 'script.translate@1', in: { script: 'script.text', outline: 'script.outline' }, params: { language: '$style.language' }, gate: gate('translate') } satisfies PipelineNode]
      : []),
    { id: 'voice', type: 'voice.tts@1', in: { script: text }, params: { voice: '$style.voice', language: '$style.language', pace: '$style.pace' }, gate: gate('voice') },
    { id: 'beats', type: 'beats.split@1', in: { script: text, words: 'voice.words', outline } },
    {
      id: 'director',
      type: 'director.plan@1',
      // the script, when there are animated overlays: its speakers are the turns of a message conversation
      in: { beats: 'beats.beats', words: 'voice.words', outline, brief: 'research.brief', ...(wanted.has('motion') ? { script: text } : {}) },
      params: { captionsPreset: short ? 'shorts' : '$style.captions', mix, ...tall, ...(short ? { cpm: 24, maxShotS: 5 } : {}), ...avatarParams, ...motionParams },
      gate: gate('director'),
      modes: {
        qualite_max: { videoShare: videoShare > 0 ? videoShare : 0.4, maxVideoClips: 12 },
        usage_max: { videoShare: 0 }
      }
    },
    ...(wanted.has('visuals') ? [{ id: 'visuals', type: 'visuals.fulfil@1', in: { list: 'director.genlist', voice: 'voice.audio' }, gate: gate('visuals') } satisfies PipelineNode] : []),
    // the presenter's clips for the stretches the director marked (the avatar is `$inputs.avatar`, else the node's default)
    ...(wanted.has('avatar')
      ? [{ id: 'avatar', type: 'avatar.speak@1', in: { genlist: 'director.genlist', voice: 'voice.audio', words: 'voice.words' }, params: { avatarId: '$inputs.avatar', talk: {} }, gate: gate('avatar') } satisfies PipelineNode]
      : []),
    // the animated overlays of the plan, drawn from our templates (a browser draws them: the host's)
    ...(wanted.has('motion') ? [{ id: 'motion', type: 'motion.render@1', in: { plan: 'director.plan' }, gate: gate('motion') } satisfies PipelineNode] : []),
    // the user's own clips, as long as the voice (a folder the run is given, `inputs.gameplay`)
    ...(wanted.has('background')
      ? [{ id: 'background', type: 'background.clips@1', in: { voice: 'voice.audio' }, params: { folder: '$inputs.gameplay', ...tall }, gate: gate('background') } satisfies PipelineNode]
      : []),
    ...(wanted.has('card')
      ? [{ id: 'card', type: 'card.intro@1', in: { outline, words: 'voice.words' }, params: { channel: '$inputs.channel', ...tall }, gate: gate('card') } satisfies PipelineNode]
      : [])
  ]
  if (wanted.has('captions')) {
    nodes.push({ id: 'captions', type: 'captions.make@1', in: { words: 'voice.words', script: text, plan: 'director.plan' }, params: { preset: short ? 'shorts' : '$style.captions', burn: '$style.burn' }, gate: gate('captions') })
  }
  if (wanted.has('sound')) {
    nodes.push({ id: 'sound', type: 'sound.music@1', in: { voice: 'voice.audio', words: 'voice.words', beats: 'beats.beats', plan: 'director.plan' }, gate: gate('sound') })
  }
  nodes.push({
    id: 'render',
    type: 'render.assemble@1',
    in: {
      plan: 'director.plan',
      ...(wanted.has('background') ? { background: 'background.layer' } : { images: 'visuals.images', clips: 'visuals.clips' }),
      voice: 'voice.audio',
      ...(wanted.has('avatar') ? { avatar: 'avatar.clips' } : {}),
      ...(wanted.has('sound') ? { music: 'sound.music' } : {}),
      ...(wanted.has('captions') ? { subs: 'captions.subs' } : {}),
      ...(wanted.has('card') ? { graphics: 'card.card' } : {}),
      ...(wanted.has('motion') ? { motion: 'motion.graphics' } : {}),
      // qualite-montage: the edit review reads the words under each shot
      words: 'voice.words'
    },
    params: { review: 'repair' },
    gate: gate('render'),
    modes: { qualite_max: { crf: 18, preset: 'slow' }, usage_max: { crf: 21, preset: 'veryfast' } }
  })
  // free checks on the finished film; a failing one stops the run at a review gate by itself
  if (wanted.has('qc')) nodes.push({ id: 'qc', type: 'qc.check@1', in: { video: 'render.video', plan: 'director.plan' }, gate: gate('qc') })
  // the thumbnails: the owner picks one (the first one is the pick); the package folder gets it as thumbnail.png
  if (wanted.has('thumbnail')) {
    nodes.push({ id: 'thumbnails', type: 'thumbnail.make@1', in: { script: text, outline }, params: { language: '$style.language' }, gate: 'owner' })
  }
  if (wanted.has('package')) {
    nodes.push({
      id: 'package',
      type: 'package.youtube@1',
      in: {
        video: 'render.video',
        script: text,
        outline,
        words: 'voice.words',
        subs: 'captions.subs',
        plan: 'director.plan',
        ...(wanted.has('visuals') ? { images: 'visuals.images' } : {}),
        ...(wanted.has('thumbnail') ? { thumbnails: 'thumbnails.thumbnails' } : {}),
        brief: 'research.brief'
      },
      params: { language: '$style.language' },
      gate: 'owner'
    })
  }
  // `none` gates are the schema's default: leave them out so the document stays as the template writes it.
  for (const n of nodes) if (n.gate === 'none') delete n.gate

  return {
    pipeline: {
      $schema: 'atelier.pipeline/1',
      id: opts.id ?? 'drawing',
      version: 1,
      name: drawing.name.trim().slice(0, 120) || 'Pipeline dessinée',
      format: short
        ? { kind: 'youtube_short', aspect: '9:16', minutes: { default: minutes, min: Math.min(0.1, minutes), max: Math.max(3, minutes) } }
        : { kind: 'youtube_long', aspect: '16:9', minutes: { default: minutes, min: Math.min(0.5, minutes), max: Math.max(30, minutes) } },
      inputs: [
        { id: 'topic', kind: 'text', required: true, label: 'Sujet ou titre' },
        // what a person gives the run, for the steps the drawing keeps in their hands
        ...(humanScript ? [{ id: 'script', kind: 'text' as const, required: true, label: 'Script', help: 'Ton texte : la production attend ton script au lieu d’en écrire un.' }] : []),
        ...(wanted.has('background')
          ? [{ id: 'gameplay', kind: 'text' as const, required: true, label: 'Dossier de clips', help: 'Le chemin complet du dossier où sont tes clips de gameplay (mp4, mov, mkv, webm).' }]
          : []),
        ...(wanted.has('card') ? [{ id: 'channel', kind: 'text' as const, suggested: true, label: 'Nom de la chaîne (carte d’intro)' }] : []),
        ...(wanted.has('avatar')
          ? [{ id: 'avatar', kind: 'text' as const, suggested: true, label: 'Avatar (identifiant du portrait)', help: 'L’identifiant du portrait de ton présentateur chez Hedra. Sans lui, la démo dessine une silhouette.' }]
          : [])
      ],
      budget: { default: 'usage_max' },
      nodes
    },
    mapping,
    notes
  }
}
