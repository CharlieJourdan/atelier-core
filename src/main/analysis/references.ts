// The three INVENTED reference channels of the analysis (PLAN-V2-PRODUCTION §7 P6): reading a real channel needs YouTube
// Data and video analysis through Atelier Cloud (features `youtube-research`, `video-analysis`, demo until the Cloud has
// the keys), so the analysis runs on these. Names, videos and figures are made up; scripts are described by a style card,
// never by a text. Each example video's timeline comes from one 600-second pattern per channel, so the time shares of
// the gauge are exact (see tests/unit/z1-analysis-gauge.test.ts for the hand computations).
import type { FormatProfile, ReferenceSummary, ReferenceVideo, ScriptStyleCard, StyleSheet, TimelineSegment } from '../../shared/analysis'
import type { ComponentId, InputId } from '../../shared/gauge'

export interface PatternSegment {
  component: ComponentId
  seconds: number
  note: string
}

export interface ReferenceChannel extends ReferenceSummary {
  uploadsPerWeek: number
  recentVideos: ReferenceVideo[]
  proposedExamples: [string, string, string]
  /** 600 s of the format, in order; every example video is this pattern scaled to its length (and rotated). */
  pattern: PatternSegment[]
  profile: Omit<FormatProfile, 'components'>
  scriptCard: ScriptStyleCard
  questions: InputId[]
  styleDraft: StyleSheet
  /** How the template is adapted: target minutes and cuts per minute. */
  template: { minutes: number; cutsPerMinute: number }
}

export const PATTERN_SECONDS = 600

const v = (id: string, title: string, views: number, durationS: number, publishedDaysAgo: number, outlier = false): ReferenceVideo => ({
  id,
  title,
  views,
  durationS,
  publishedDaysAgo,
  outlier
})

const baseStyle = (over: Partial<StyleSheet> & Pick<StyleSheet, 'identity' | 'script'>): StyleSheet => ({
  $schema: 'atelier.style/1',
  voice: { source: 'platform', voiceId: 'demo-claire', speed: 1, stability: 0.6 },
  visuals: { mix: { stock: 0.5, ai_image: 0.3, ai_video: 0.1, animation: 0.1, footage: 0, avatar: 0 }, palette: ['#1B1B1F', '#C9A86A', '#F2F1EE'], fonts: ['Inter'], grade: 'Contraste doux, tons chauds' },
  animation: { kit: 'titres-sobres', settings: 'Entrées en fondu, 0,4 s' },
  captions: { preset: 'highlight', position: 'bottom', wordsPerLine: 6, highlight: true },
  sound: { mood: 'Nappes calmes', volume: 0.25, duckDb: 12 },
  pace: { cutsPerMinute: 12, minShotS: 2, maxShotS: 7 },
  thumbnail: { layout: 'Objet central, titre court à gauche', textRules: '3 mots au plus, majuscules', colors: ['#C9A86A', '#0C0C0E'], face: false },
  packaging: { titleRules: 'Une question ou une promesse, 60 caractères au plus', descriptionTemplate: 'Résumé en deux phrases.\n\nChapitres :\n{chapitres}\n\nSources :\n{sources}' },
  budget: { mode: 'usage_max', capCredits: null },
  ...over
})

export const REFERENCES: readonly ReferenceChannel[] = [
  {
    id: 'archives-silencieuses',
    name: 'Archives Silencieuses',
    niche: 'Histoire et faits divers anciens',
    format: 'Documentaire raconté, sans visage',
    subscribers: 184_000,
    uploadsPerWeek: 1,
    recentVideos: [
      v('as-1', 'Le phare qui s’est éteint trois nuits de suite', 412_000, 734, 5, true),
      v('as-2', 'La ville qui a disparu des cartes en 1911', 96_000, 812, 12),
      v('as-3', 'Le procès d’un orage (vraiment)', 1_250_000, 690, 19, true),
      v('as-4', 'Pourquoi ce village n’a plus de cloches', 88_000, 655, 26),
      v('as-5', 'Le journal de bord retrouvé dans un mur', 140_000, 760, 33),
      v('as-6', 'Une horloge pour toute une vallée', 72_000, 598, 40),
      v('as-7', 'Le train qui n’est jamais arrivé', 655_000, 801, 47, true),
      v('as-8', 'La dernière lettre du gardien de musée', 101_000, 720, 54)
    ],
    proposedExamples: ['as-3', 'as-7', 'as-1'],
    pattern: [
      { component: 'ai_video', seconds: 20, note: 'Ouverture animée : vidéo IA en Qualité max, image animée en Usage max.' },
      { component: 'stock', seconds: 60, note: 'Paysages et lieux : banque d’images, refaisable tel quel.' },
      { component: 'text_anim', seconds: 30, note: 'Titre de chapitre et dates animées : notre kit d’animation.' },
      { component: 'ai_image', seconds: 75, note: 'Gravures et portraits d’époque : images IA dans un style d’archive.' },
      { component: 'clip', seconds: 30, note: 'Archive télé : impossible à refaire, remplacée par une image IA d’époque.' },
      { component: 'stock', seconds: 120, note: 'Rues, intérieurs, objets : banque d’images.' },
      { component: 'ai_video', seconds: 40, note: 'Reconstitution animée : vidéo IA, la partie la plus chère.' },
      { component: 'ai_image', seconds: 75, note: 'Documents et scènes reconstituées : images IA.' },
      { component: 'text_anim', seconds: 30, note: 'Citation à l’écran : notre kit d’animation.' },
      { component: 'stock', seconds: 120, note: 'Plans d’ambiance de la fin : banque d’images.' }
    ],
    profile: {
      summary: 'Récit documentaire posé, voix de synthèse grave, images d’archives et gravures, aucun visage à l’écran.',
      cutsPerMinute: 11,
      onScreenText: 'Dates et lieux en surimpression, une citation par chapitre',
      subtitles: 'Sous-titres bas, deux lignes, mot surligné',
      voice: { kind: 'synthetic', gender: 'masculine', energy: 'calme', wpm: 145 },
      music: 'Nappes de piano et cordes, très basses sous la voix',
      thumbnail: 'Un objet ancien au centre, titre de 3 mots, fond sombre',
      notes: {
        voice: 0.95,
        script: 0.9,
        edit: 0.85,
        voiceWhy: 'Voix de synthèse : nos voix de plateforme la refont.',
        scriptWhy: 'Récit documentaire sourcé : notre rédacteur et ses skills le couvrent.',
        editWhy: 'Rythme posé, mais quelques transitions sonores plus fines que notre rendu.'
      },
      analystConfidence: 'high'
    },
    scriptCard: {
      structure: ['Accroche par une énigme', 'Contexte', 'Trois révélations', 'Fausse piste', 'Dénouement', 'Appel à l’action discret'],
      hook: 'Un fait étrange daté, posé en une phrase, puis une question',
      tone: 'Posé, grave, un peu de mystère',
      wpm: 145,
      lengthMin: 12,
      vocabulary: 'Soutenu, concret, peu d’adjectifs',
      shape: 'documentaire raconté',
      skills: ['hook', 'retention', 'rehooks', 'factcheck', 'cta']
    },
    questions: [],
    styleDraft: baseStyle({
      identity: { name: 'Archives Silencieuses (style)', niche: 'Histoire et faits divers anciens', language: 'fr', audience: 'Curieux d’histoire, 25-55 ans' },
      script: {
        structure: ['Accroche par une énigme', 'Contexte', 'Trois révélations', 'Dénouement'],
        hook: 'Un fait étrange daté, puis une question',
        tone: 'Posé, grave, mystérieux',
        wpm: 145,
        lengthMin: 12,
        forbidden: ['incroyable', 'choquant'],
        skills: ['hook', 'retention', 'rehooks', 'factcheck', 'cta']
      },
      pace: { cutsPerMinute: 11, minShotS: 2.5, maxShotS: 8 }
    }),
    template: { minutes: 12, cutsPerMinute: 11 }
  },
  {
    id: 'recits-manette',
    name: 'Récits Manette',
    niche: 'Histoires vécues racontées sur du jeu vidéo',
    format: 'Histoires texte sur gameplay',
    subscribers: 512_000,
    uploadsPerWeek: 5,
    recentVideos: [
      v('rm-1', 'Mon colocataire a vendu mon canapé pendant mes vacances', 2_300_000, 612, 1, true),
      v('rm-2', 'Elle a réservé le mariage sans prévenir personne', 480_000, 580, 2),
      v('rm-3', 'Le voisin qui tondait à minuit', 390_000, 655, 4),
      v('rm-4', 'J’ai découvert que mon patron était mon cousin', 3_100_000, 701, 6, true),
      v('rm-5', 'Le chien qui a choisi son propriétaire', 520_000, 590, 8),
      v('rm-6', 'Ma sœur a copié tout mon mariage', 1_900_000, 640, 9, true),
      v('rm-7', 'Le colis livré à la mauvaise porte', 410_000, 560, 11),
      v('rm-8', 'Le groupe de discussion de l’immeuble a déraillé', 450_000, 620, 13)
    ],
    proposedExamples: ['rm-4', 'rm-1', 'rm-6'],
    pattern: [
      { component: 'text_anim', seconds: 15, note: 'Titre de l’histoire en bulle : notre kit d’animation.' },
      { component: 'cartoon', seconds: 60, note: 'Personnage dessiné qui réagit : le dessin animé reste faible chez nous (0,2 en Usage max).' },
      { component: 'gameplay', seconds: 165, note: 'Partie de jeu en fond : il faut ton gameplay (0 sans, 0,95 avec).' },
      { component: 'cartoon', seconds: 60, note: 'Réaction dessinée au rebondissement.' },
      { component: 'gameplay', seconds: 165, note: 'Partie de jeu en fond : impossible sans tes propres captures.' },
      { component: 'cartoon', seconds: 120, note: 'Scène dessinée du dénouement.' },
      { component: 'text_anim', seconds: 15, note: 'Question finale aux abonnés : notre kit d’animation.' }
    ],
    profile: {
      summary: 'Histoire vécue à la première personne lue par une voix de synthèse, sur une partie de jeu en continu, avec des réactions dessinées.',
      cutsPerMinute: 24,
      onScreenText: 'Messages en bulles, gros mots-clés au centre',
      subtitles: 'Gros sous-titres centrés, un à trois mots, couleur vive',
      voice: { kind: 'synthetic', gender: 'féminine', energy: 'vive', wpm: 175 },
      music: 'Boucle légère et bruitages à chaque message',
      thumbnail: 'Capture de jeu, émoji géant, phrase choc en 4 mots',
      notes: {
        voice: 0.95,
        script: 0.55,
        edit: 0.28,
        voiceWhy: 'Voix de synthèse : nos voix de plateforme la refont.',
        scriptWhy: 'Récits à la première personne avec rebondissements serrés : nos skills de script couvrent mal ce ton.',
        editWhy: 'Bulles qui sautent au rythme de la voix et un bruitage par message : au-delà de notre rendu actuel.'
      },
      analystConfidence: 'high'
    },
    scriptCard: {
      structure: ['Situation en une phrase', 'Montée de tension', 'Rebondissement', 'Deuxième rebondissement', 'Chute', 'Question aux abonnés'],
      hook: 'La conséquence d’abord, la cause ensuite',
      tone: 'Familier, vif, un peu indigné',
      wpm: 175,
      lengthMin: 10,
      vocabulary: 'Oral, phrases courtes, présent de narration',
      shape: 'récit à la première personne',
      skills: ['hook', 'retention', 'rehooks', 'cta']
    },
    questions: ['gameplay'],
    styleDraft: baseStyle({
      identity: { name: 'Récits Manette (style)', niche: 'Histoires vécues sur du jeu vidéo', language: 'fr', audience: '15-30 ans, mobile' },
      voice: { source: 'platform', voiceId: 'demo-claire', speed: 1.15, stability: 0.45 },
      script: {
        structure: ['Situation', 'Tension', 'Rebondissement', 'Chute', 'Question'],
        hook: 'La conséquence d’abord',
        tone: 'Familier et vif',
        wpm: 175,
        lengthMin: 10,
        forbidden: [],
        skills: ['hook', 'retention', 'rehooks', 'cta']
      },
      visuals: { mix: { stock: 0, ai_image: 0.1, ai_video: 0, animation: 0.35, footage: 0.55, avatar: 0 }, palette: ['#FFD23F', '#1B1B1F', '#FFFFFF'], fonts: ['Inter'], grade: 'Couleurs saturées' },
      captions: { preset: 'bold-center', position: 'middle', wordsPerLine: 3, highlight: true },
      pace: { cutsPerMinute: 24, minShotS: 1, maxShotS: 4 },
      thumbnail: { layout: 'Capture de jeu et émoji géant', textRules: '4 mots, majuscules', colors: ['#FFD23F', '#E5484D'], face: false }
    }),
    template: { minutes: 10, cutsPerMinute: 24 }
  },
  {
    id: 'top-dix-anime',
    name: 'Top Dix Animé',
    niche: 'Classements de culture générale',
    format: 'Top 10 en animations',
    subscribers: 96_000,
    uploadsPerWeek: 2,
    recentVideos: [
      v('td-1', '10 objets du quotidien inventés par erreur', 210_000, 615, 3),
      v('td-2', '10 animaux plus intelligents qu’on le croit', 890_000, 640, 7, true),
      v('td-3', '10 monuments qui ont failli ne jamais exister', 150_000, 598, 10),
      v('td-4', '10 records du monde absurdes', 610_000, 575, 14, true),
      v('td-5', '10 plats nés dans une crise', 120_000, 630, 17),
      v('td-6', '10 métiers qui ont disparu', 180_000, 602, 21),
      v('td-7', '10 villes construites sur l’eau', 140_000, 588, 24),
      v('td-8', '10 inventions qui ont changé la nuit', 330_000, 650, 28, true)
    ],
    proposedExamples: ['td-2', 'td-4', 'td-8'],
    pattern: [
      { component: 'text_anim', seconds: 20, note: 'Compte à rebours animé : notre kit d’animation.' },
      { component: 'ai_video', seconds: 30, note: 'Plan d’ouverture spectaculaire : vidéo IA (0,4 en Usage max, 0,75 en Qualité max).' },
      { component: 'stock', seconds: 60, note: 'Illustrations de l’entrée : banque d’images.' },
      { component: 'text_anim', seconds: 60, note: 'Numéro et fiche de l’entrée : notre kit d’animation.' },
      { component: 'ai_image', seconds: 75, note: 'Scènes illustrées : images IA.' },
      { component: 'cartoon', seconds: 45, note: 'Mascotte dessinée qui commente : dessin animé, encore faible chez nous.' },
      { component: 'stock', seconds: 60, note: 'Plans d’illustration : banque d’images.' },
      { component: 'text_anim', seconds: 100, note: 'Chiffres et comparaisons animés : notre kit d’animation.' },
      { component: 'ai_image', seconds: 75, note: 'Scènes illustrées : images IA.' },
      { component: 'cartoon', seconds: 45, note: 'Mascotte dessinée du numéro 1.' },
      { component: 'ai_video', seconds: 30, note: 'Plan final animé : vidéo IA.' }
    ],
    profile: {
      summary: 'Classement en dix entrées, rythme rapide, beaucoup d’animations de texte et de chiffres, une mascotte dessinée.',
      cutsPerMinute: 30,
      onScreenText: 'Numéro de l’entrée en grand, chiffres animés',
      subtitles: 'Sous-titres bas, mot surligné',
      voice: { kind: 'synthetic', gender: 'masculine', energy: 'enjouée', wpm: 165 },
      music: 'Musique entraînante, bruitages de transition',
      thumbnail: 'Trois vignettes et un grand chiffre « 10 »',
      notes: {
        voice: 0.95,
        script: 0.9,
        edit: 0.7,
        voiceWhy: 'Voix de synthèse : nos voix de plateforme la refont.',
        scriptWhy: 'Top 10 classique : notre rédacteur le couvre.',
        editWhy: '30 coupes par minute et des bruitages de transition : à la limite de notre rendu.'
      },
      analystConfidence: 'medium'
    },
    scriptCard: {
      structure: ['Promesse du classement', 'Entrées 10 à 4', 'Relance avant le podium', 'Podium', 'Numéro 1', 'Appel à l’action'],
      hook: 'Le numéro 1 annoncé comme surprenant, sans le dire',
      tone: 'Enjoué, rapide, pédagogique',
      wpm: 165,
      lengthMin: 10,
      vocabulary: 'Courant, un chiffre par entrée',
      shape: 'top 10',
      skills: ['hook', 'retention', 'rehooks', 'factcheck', 'cta']
    },
    questions: [],
    styleDraft: baseStyle({
      identity: { name: 'Top Dix Animé (style)', niche: 'Classements de culture générale', language: 'fr', audience: 'Tous publics, 12-40 ans' },
      voice: { source: 'platform', voiceId: 'demo-claire', speed: 1.1, stability: 0.5 },
      script: {
        structure: ['Promesse', 'Entrées 10 à 4', 'Relance', 'Podium', 'Numéro 1'],
        hook: 'Le numéro 1 annoncé comme surprenant',
        tone: 'Enjoué et pédagogique',
        wpm: 165,
        lengthMin: 10,
        forbidden: [],
        skills: ['hook', 'retention', 'rehooks', 'factcheck', 'cta']
      },
      visuals: { mix: { stock: 0.2, ai_image: 0.25, ai_video: 0.1, animation: 0.45, footage: 0, avatar: 0 }, palette: ['#6AA4FF', '#FFD23F', '#0C0C0E'], fonts: ['Inter'], grade: 'Couleurs vives' },
      animation: { kit: 'compte-a-rebours', settings: 'Chiffres qui roulent, 0,3 s' },
      pace: { cutsPerMinute: 30, minShotS: 1, maxShotS: 4 }
    }),
    template: { minutes: 10, cutsPerMinute: 30 }
  }
]

export function findReference(id: string): ReferenceChannel | undefined {
  return REFERENCES.find((r) => r.id === id)
}

export function referenceSummary(r: ReferenceChannel): ReferenceSummary {
  return { id: r.id, name: r.name, niche: r.niche, format: r.format, subscribers: r.subscribers }
}

/** Time shares of the format (exact: seconds of the 600-second pattern ÷ 600). */
export function patternShares(r: ReferenceChannel): { component: ComponentId; share: number }[] {
  const total = r.pattern.reduce((s, p) => s + p.seconds, 0)
  const by = new Map<ComponentId, number>()
  for (const p of r.pattern) by.set(p.component, (by.get(p.component) ?? 0) + p.seconds)
  return [...by].map(([component, seconds]) => ({ component, share: seconds / total }))
}

/** The timeline of one example video: the pattern rotated (each video starts elsewhere) and scaled to its length. */
export function timelineFor(r: ReferenceChannel, videoId: string): TimelineSegment[] {
  const video = r.recentVideos.find((x) => x.id === videoId)
  if (!video) return []
  const rot = Math.max(0, r.proposedExamples.indexOf(videoId)) * 2
  const segs = [...r.pattern.slice(rot), ...r.pattern.slice(0, rot)]
  const total = segs.reduce((s, p) => s + p.seconds, 0)
  const k = video.durationS / total
  const out: TimelineSegment[] = []
  let t = 0
  for (const p of segs) {
    const startS = Math.round(t * k)
    t += p.seconds
    out.push({ startS, endS: Math.round(t * k), component: p.component, note: p.note })
  }
  return out
}
