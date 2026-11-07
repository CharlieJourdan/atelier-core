// « How was it made, and how does Atelier remake it? » (chantier rea-video, decision 0110). Every shot of the analysis gets
// ONE production method (camera footage found or filmed, the presenter, an avatar, a generated picture or clip, a still with
// a camera move, a held still, coded motion design, a drawn 2D scene, a 3D render, a screen capture, gameplay, stop motion),
// and every method — plus the layers and the sound — is routed to the Atelier brick that remakes it, or to a human input
// (an import slot), or to « impossible » with the missing technology. The routes reuse P3's element rules (one source of
// truth for bricks, slots and missing technologies), so the recipe and the feasibility map never disagree.
// The idea of a per-shot method taxonomy with a remake route each comes from rea-video (Apache-2.0, © 2026 JuneYaooo,
// VENDOR.md); the method names, the mapping and the code are Atelier's. Pure.
import type { AnalysedShot, Brief, FeasibilityElement, HowMadeRow, VideoAnalysis } from '../../../../shared/clone'
import { ELEMENT_RULES } from './elements'
import { corpusEvidence, round3, screenSeconds } from './stats'

/** How the moving picture of a shot was made. */
export const PICTURE_METHODS = [
  'presenter-filmed', 'avatar', 'camera-found', 'camera-filmed', 'gameplay', 'ai-video', 'ai-image', 'still-move',
  'still-hold', 'coded-motion', 'drawn-2d', '3d-render', 'screen', 'stop-motion'
] as const
export type PictureMethod = (typeof PICTURE_METHODS)[number]

/** How a layer over the picture, or the sound, was made. */
export const LAYER_METHODS = ['burned-captions', 'kinetic-text', 'voice-human', 'voice-synthetic', 'music-bed', 'sound-effects'] as const
export type LayerMethod = (typeof LAYER_METHODS)[number]

type Route = Pick<FeasibilityElement, 'how' | 'brick' | 'slot' | 'missing'>

interface PictureRoute {
  /** P3's element that owns these shots (its rule gives the brick, slot or missing technology). */
  element: string
  /** What the brick needs from the analysis to remake it (the settings that carry over). */
  settings: readonly string[]
  /** One line: how Atelier remakes it. */
  remake: string
}

/** Each picture method → P3's element (hence its brick), the measured settings it carries, and the remake line. */
export const PICTURE_ROUTES: Record<PictureMethod, PictureRoute> = {
  'presenter-filmed': { element: 'presenter', settings: ['presenter.identity', 'presenter.angles', 'presenter.layoutCurve'], remake: 'the presenter filmed on camera: his own footage, or a look-alike placeholder of the same type until he supplies it' },
  avatar: { element: 'presenter', settings: ['presenter.identity', 'presenter.angles', 'presenter.layoutCurve', 'voice'], remake: 'an avatar of the same type speaks the script (avatar.speak)' },
  'camera-found': { element: 'found-footage', settings: ['editing.originShares', 'kinds', 'camera'], remake: 'found moving footage of the same kind (archives, news, stock) searched literally for each shot (visuals.fulfil)' },
  'camera-filmed': { element: 'filmed', settings: ['kinds', 'camera'], remake: 'the channel\'s own filmed footage: imported, found footage of the same kind stands in (never generated)' },
  gameplay: { element: 'gameplay', settings: ['kinds'], remake: 'gameplay clips under the voice (background.clips)' },
  'ai-video': { element: 'generated', settings: ['generatedLook', 'camera'], remake: 'a generated clip in the measured look (clip.make)' },
  'ai-image': { element: 'generated', settings: ['generatedLook', 'camera'], remake: 'a generated still in the measured look, with its camera move (clip.make / edit.fx)' },
  'still-move': { element: 'found-stills', settings: ['editing.stillShare', 'camera'], remake: 'a found photo or document with the measured camera move (visuals.fulfil, edit.fx stills\' moves)' },
  'still-hold': { element: 'found-stills', settings: ['editing.stillShare'], remake: 'a found photo or document held still (visuals.fulfil)' },
  'coded-motion': { element: 'motion-cards', settings: ['motion.elements', 'motion.palette', 'motion.fonts'], remake: 'motion design rebuilt from the text, layout, palette and timing (motion.render)' },
  'drawn-2d': { element: 'drawn', settings: ['figures', 'motion.palette'], remake: 'drawn 2D scenes and characters in the measured drawing (motion.render)' },
  '3d-render': { element: '3d', settings: ['kinds'], remake: 'not made by the engine: the user\'s own renders through the footage slot, or an alternative faithful to the channel' },
  screen: { element: 'screen', settings: ['kinds'], remake: 'a screen capture or web screenshot of the same page (visuals.fulfil)' },
  'stop-motion': { element: 'filmed', settings: ['kinds'], remake: 'stop motion is shot for real (a phone locked off, ≈ 12 frames a second): imported through the footage slot' }
}

/** Each layer / sound method → the brick that makes it (or the human input). */
export const LAYER_ROUTES: Record<LayerMethod, { route: (brief: Brief) => Route; settings: readonly string[]; remake: string }> = {
  'burned-captions': { route: () => brick('captions.make'), settings: ['captions.burnedInShare'], remake: 'captions burnt in on the words (captions.make)' },
  'kinetic-text': { route: () => brick('motion.render'), settings: ['motion.elements', 'motion.fonts'], remake: 'kinetic type landing on its word (motion.render)' },
  'voice-human': {
    route: (b) => (b.ownChannel || b.humanInputs.voice ? brick('voice.own') : brick('voice.tts')),
    settings: ['voice.timbre', 'voice.wordsPerMinute', 'voice.pauses'],
    remake: 'his own recorded voice (voice.own) when he supplies it, else a synthetic voice of the same kind, pace and energy (voice.tts)'
  },
  'voice-synthetic': { route: () => brick('voice.tts'), settings: ['voice.timbre', 'voice.wordsPerMinute'], remake: 'a synthetic voice of the same kind (voice.tts)' },
  'music-bed': { route: () => brick('sound.music'), settings: ['sound.music.levelUnderVoiceDb', 'sound.music.genre', 'sound.music.changesAtS'], remake: 'a library music bed at the measured level under the voice, changing where the reference changes (sound.music)' },
  'sound-effects': { route: () => brick('edit.fx'), settings: ['sound.sfx'], remake: 'sound effects on the graphic events and transitions (edit.fx)' }
}

const brick = (node: string): Route => ({ how: 'brick', brick: node, slot: null, missing: null })

/** The production method of one analysed shot, from its measured origin, kind and camera move. Pure. */
export function methodOfShot(s: AnalysedShot, presenterKind: VideoAnalysis['presenter']['kind'] | string): PictureMethod {
  switch (s.origin) {
    case 'presenter': return presenterKind === 'avatar' ? 'avatar' : 'presenter-filmed'
    case 'filmed': return 'camera-filmed'
    case 'generated': return s.camera === 'still' || s.kind === 'illustration' || s.kind === 'archive-photo' ? 'ai-image' : 'ai-video'
    case 'drawn': return 'drawn-2d'
    case '3d': return '3d-render'
    case 'motion': return 'coded-motion'
    case 'screen': return 'screen'
    case 'found':
      if (s.kind === 'gameplay') return 'gameplay'
      if (s.kind === 'screen-capture') return 'screen'
      if (s.kind === 'archive-photo' || s.kind === 'document') return s.camera === 'still' ? 'still-hold' : 'still-move'
      return 'camera-found'
  }
  return 'camera-found'
}

/** The recipe of a corpus: every picture method with its measured screen share and its route, then the layers and the sound
 *  the analyses measured. Picture shares sum to 1 (every shot has exactly one method). Pure. */
export function howMadeOf(analyses: readonly VideoAnalysis[], brief: Brief): HowMadeRow[] {
  const total = screenSeconds(analyses)
  if (total <= 0) return []
  const rows: HowMadeRow[] = []
  for (const method of PICTURE_METHODS) {
    const mine = (s: AnalysedShot, a: VideoAnalysis): boolean => methodOfShot(s, a.presenter.kind) === method
    const seconds = analyses.reduce((t, a) => t + a.shots.filter((s) => mine(s, a)).reduce((x, s) => x + s.lengthS, 0), 0)
    if (seconds <= 0) continue
    const r = PICTURE_ROUTES[method]
    const rule = ELEMENT_RULES.find((e) => e.id === r.element)!
    const presenterKind = analyses.find((a) => a.presenter.kind !== 'none')?.presenter.kind ?? 'none'
    let route = rule.make({ brief, presenterKind })
    if (method === 'avatar') route = brick('avatar.speak')
    if (method === 'stop-motion') route = { how: 'human-input', brick: null, slot: { kind: 'footage', what: 'stop-motion footage shot for real', userSupplies: brief.humanInputs.footage }, missing: null }
    const byShot = new Map<AnalysedShot, VideoAnalysis>()
    for (const a of analyses) for (const s of a.shots) byShot.set(s, a)
    rows.push({ method, share: round3(seconds / total), evidence: corpusEvidence(analyses, (s) => mine(s, byShot.get(s)!)), remake: r.remake, settings: [...r.settings], route })
  }
  const first = analyses[0]!
  const layer = (method: LayerMethod, share: number, note: string): void => {
    const l = LAYER_ROUTES[method]
    rows.push({ method, share: round3(share), evidence: [{ video: first.videoId, frames: [], note }], remake: l.remake, settings: [...l.settings], route: l.route(brief) })
  }
  const mean = (f: (a: VideoAnalysis) => number): number => analyses.reduce((t, a) => t + f(a), 0) / analyses.length
  const captions = mean((a) => a.captions?.burnedInShare.value ?? 0)
  if (captions > 0.2) layer('burned-captions', captions, 'share of spoken shots whose on-screen text repeats the words')
  const kinetic = mean((a) => (a.motion.elements.some((e) => e.type === 'kinetic-type') ? 1 : 0))
  if (kinetic > 0) layer('kinetic-text', kinetic, 'share of the corpus videos with kinetic type')
  const real = analyses.filter((a) => a.voice.kind === 'real').length
  const synthetic = analyses.filter((a) => a.voice.kind === 'synthetic').length
  if (real) layer('voice-human', real / analyses.length, 'share of the corpus videos with a human voice')
  if (synthetic) layer('voice-synthetic', synthetic / analyses.length, 'share of the corpus videos with a synthetic voice')
  const music = analyses.filter((a) => a.sound.music.present).length
  if (music) layer('music-bed', music / analyses.length, 'share of the corpus videos with a music bed')
  const sfx = analyses.filter((a) => a.sound.sfx.length > 0).length
  if (sfx) layer('sound-effects', sfx / analyses.length, 'share of the corpus videos where sound effects were measured')
  return rows
}

/** Plain French lines of the recipe for the report (« 42 % motion design → motion.render »). Pure. */
export function howMadeLines(rows: readonly HowMadeRow[]): string[] {
  return rows.map((r) => {
    const pct = `${Math.round(r.share * 100)} %`
    const to = r.route.how === 'brick' ? r.route.brick : r.route.how === 'human-input' ? `apport humain (${r.route.slot?.what ?? ''})` : `pas possible (${r.route.missing?.technology ?? ''})`
    return `${METHOD_FR[r.method as PictureMethod | LayerMethod] ?? r.method} — ${pct} → ${to}`
  })
}

export const METHOD_FR: Record<PictureMethod | LayerMethod, string> = {
  'presenter-filmed': 'présentateur filmé',
  avatar: 'avatar',
  'camera-found': 'images filmées trouvées (archives, actu, banque)',
  'camera-filmed': 'images filmées par la chaîne',
  gameplay: 'gameplay',
  'ai-video': 'clip généré par IA',
  'ai-image': 'image générée par IA',
  'still-move': 'photo ou document avec mouvement de caméra',
  'still-hold': 'photo ou document fixe',
  'coded-motion': 'motion design (cartes, graphiques, textes)',
  'drawn-2d': 'scène dessinée 2D',
  '3d-render': 'rendu 3D',
  screen: 'capture d\'écran',
  'stop-motion': 'stop motion',
  'burned-captions': 'sous-titres incrustés',
  'kinetic-text': 'texte animé',
  'voice-human': 'voix humaine',
  'voice-synthetic': 'voix de synthèse',
  'music-bed': 'musique de fond',
  'sound-effects': 'effets sonores'
}
