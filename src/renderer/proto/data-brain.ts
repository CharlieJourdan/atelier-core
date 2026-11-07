// Demo data of the Cerveau area: the competitors around each channel, the videos that outperform, the niche map, the
// idea board and what the research agents say. Invented values only (no real channel is described). Dates are offsets.
import type { ChannelId } from './types'

export type StyleId = 'narrated' | 'archives' | 'animated' | 'list' | 'reddit' | 'gameplay' | 'commentary' | 'explainer'

export interface Competitor {
  id: string
  channelId: ChannelId
  name: string
  handle: string
  subscribers: number
  views30d: number
  /** Outlier score as Nexlev-like tools show it: 0 = average of the niche, 3+ = exceptional. */
  outlier: number
  /** Estimated revenue per 1 000 views, in euros. */
  rpm: number
  /** 0–1: how close the channel is to ours (format, topics, audience). Drives the distance on the map. */
  similarity: number
  style: StyleId
  rising: boolean
  lastVideo: { title: string; daysAgo: number }
  /** What they do better than us, one line. */
  better: string
}

function c(
  channelId: ChannelId,
  n: number,
  name: string,
  handle: string,
  subscribers: number,
  views30d: number,
  outlier: number,
  rpm: number,
  similarity: number,
  style: StyleId,
  rising: boolean,
  lastTitle: string,
  lastDays: number,
  better: string
): Competitor {
  return {
    id: `cp-${channelId.replace('ch-', '')}-${n}`,
    channelId,
    name,
    handle,
    subscribers,
    views30d,
    outlier,
    rpm,
    similarity,
    style,
    rising,
    lastVideo: { title: lastTitle, daysAgo: lastDays },
    better
  }
}

export const COMPETITORS: Competitor[] = [
  // Les Grandes Énigmes
  c(
    'ch-enigmes',
    1,
    'Chroniques Obscures',
    '@chroniquesobscures',
    412_000,
    5_100_000,
    2.4,
    3.1,
    0.93,
    'narrated',
    false,
    'Le vaisseau fantôme de la Baltique',
    3,
    'Pose l’énigme dans les 20 premières secondes, sans introduction.'
  ),
  c(
    'ch-enigmes',
    2,
    'Mystères d’Archives',
    '@mysteresdarchives',
    268_000,
    3_200_000,
    1.8,
    3.4,
    0.88,
    'archives',
    false,
    'Ce que cachait la crypte de Saint-Denis',
    5,
    'Montre les vrais documents à l’écran, avec la cote d’archive.'
  ),
  c(
    'ch-enigmes',
    3,
    'L’Œil du Passé',
    '@loeildupasse',
    520_000,
    6_800_000,
    2.9,
    3.6,
    0.84,
    'narrated',
    true,
    'Le dernier jour de Pompéi, minute par minute',
    2,
    'Une miniature par vidéo avec un seul visage et un seul mot.'
  ),
  c(
    'ch-enigmes',
    4,
    'Histoire Sombre',
    '@histoiresombre',
    189_000,
    2_100_000,
    1.2,
    2.9,
    0.81,
    'narrated',
    false,
    'Les enfants de Hamelin : la vérité',
    6,
    'Voix plus lente, silences assumés avant les révélations.'
  ),
  c(
    'ch-enigmes',
    5,
    'Les Trois Énigmes',
    '@lestroisenigmes',
    96_000,
    1_900_000,
    3.6,
    3.0,
    0.78,
    'list',
    true,
    '3 énigmes de l’Antiquité en 20 minutes',
    1,
    'Format « 3 énigmes en 20 min » : 4× sa moyenne de vues depuis un mois.'
  ),
  c(
    'ch-enigmes',
    6,
    'Atlas Perdu',
    '@atlasperdu',
    305_000,
    3_800_000,
    2.1,
    3.3,
    0.74,
    'animated',
    false,
    'Les cités englouties de la mer Noire',
    4,
    'Cartes animées qui situent chaque lieu en 3 secondes.'
  ),
  c(
    'ch-enigmes',
    7,
    'Dossier Zéro',
    '@dossierzero',
    142_000,
    1_600_000,
    1.4,
    2.8,
    0.71,
    'archives',
    false,
    'Affaire du Dahlia noir : les pièces oubliées',
    9,
    'Série en épisodes : 62 % de spectateurs reviennent.'
  ),
  c(
    'ch-enigmes',
    8,
    'Sous la Surface',
    '@souslasurface',
    78_000,
    1_100_000,
    2.6,
    3.2,
    0.69,
    'animated',
    true,
    'Antikythera : la machine qui n’aurait pas dû exister',
    3,
    'Animations 3D courtes sur chaque objet mystérieux.'
  ),
  c(
    'ch-enigmes',
    9,
    'Temps Mort',
    '@tempsmort',
    640_000,
    7_400_000,
    2.2,
    3.5,
    0.64,
    'list',
    false,
    '10 disparitions jamais expliquées',
    7,
    'Publie tous les jours à 18 h : audience installée.'
  ),
  c(
    'ch-enigmes',
    10,
    'Éclats d’Histoire',
    '@eclatsdhistoire',
    224_000,
    2_400_000,
    1.0,
    2.7,
    0.6,
    'archives',
    false,
    'Le trésor de Rennes-le-Château, enfin vérifié',
    11,
    'Sources citées en fin de vidéo, très commentées.'
  ),
  c(
    'ch-enigmes',
    11,
    'Le Cabinet Noir',
    '@lecabinetnoir',
    51_000,
    700_000,
    1.9,
    2.8,
    0.56,
    'animated',
    false,
    'Le code de la Bête du Gévaudan',
    8,
    'Univers visuel sombre et très reconnaissable.'
  ),
  c(
    'ch-enigmes',
    12,
    '10 Mystères',
    '@10mysteres',
    870_000,
    9_200_000,
    1.7,
    3.0,
    0.5,
    'list',
    false,
    '10 mystères de l’espace sans réponse',
    2,
    'Cadence de 5 vidéos par semaine sur des titres très larges.'
  ),

  // Histoires Vraies
  c(
    'ch-histoires',
    1,
    'Reddit à Voix Haute',
    '@redditavoixhaute',
    410_000,
    38_000_000,
    2.7,
    0.12,
    0.94,
    'reddit',
    false,
    'Mon colocataire a loué ma chambre en secret',
    0,
    'Hook de 2 secondes avec la phrase la plus choquante en premier.'
  ),
  c(
    'ch-histoires',
    2,
    'Récits Anonymes',
    '@recitsanonymes',
    188_000,
    21_000_000,
    1.9,
    0.11,
    0.89,
    'reddit',
    false,
    'Il a menti sur son âge pendant 6 mois',
    1,
    'Sous-titres mot à mot, très lisibles sans le son.'
  ),
  c(
    'ch-histoires',
    3,
    'Confessions FR',
    '@confessionsfr',
    296_000,
    29_000_000,
    3.1,
    0.13,
    0.85,
    'reddit',
    true,
    'Ma sœur a volé mon identité',
    0,
    'Voix masculine grave qui retient mieux sur 60 secondes.'
  ),
  c(
    'ch-histoires',
    4,
    'Minuit Reddit',
    '@minuitreddit',
    74_000,
    9_800_000,
    2.4,
    0.1,
    0.8,
    'gameplay',
    true,
    'Elle m’a quitté devant tout le monde',
    0,
    'Gameplay de parkour en fond : 71 % de rétention à la fin.'
  ),
  c(
    'ch-histoires',
    5,
    'Le Fil Reddit',
    '@lefilreddit',
    132_000,
    14_500_000,
    1.5,
    0.11,
    0.76,
    'gameplay',
    false,
    'Mon patron m’a fait signer en bas',
    1,
    'Trois publications par jour aux mêmes heures.'
  ),
  c(
    'ch-histoires',
    6,
    'Tranches de Vie',
    '@tranchesdevie',
    58_000,
    5_200_000,
    1.1,
    0.12,
    0.72,
    'commentary',
    false,
    'Le jour où mon père a tout avoué',
    2,
    'Ajoute une réaction en incrustation de 5 secondes à la fin.'
  ),
  c(
    'ch-histoires',
    7,
    'Voisins Terribles',
    '@voisinsterribles',
    41_000,
    4_700_000,
    2.8,
    0.1,
    0.68,
    'reddit',
    true,
    'Mon voisin a bloqué ma voiture 3 jours',
    0,
    'Série thématique : les voisins, un sujet qui revient chaque semaine.'
  ),
  c(
    'ch-histoires',
    8,
    'AITA en Français',
    '@aitafrancais',
    215_000,
    17_000_000,
    1.6,
    0.12,
    0.63,
    'commentary',
    false,
    'AITA d’avoir annulé le mariage ?',
    1,
    'Pose une question en fin de short : 3× plus de commentaires.'
  ),
  c(
    'ch-histoires',
    9,
    'Récit Express',
    '@recitexpress',
    33_000,
    2_600_000,
    0.9,
    0.09,
    0.58,
    'gameplay',
    false,
    'Il m’a laissé payer l’addition à 400 €',
    3,
    'Raccourcit à 35 secondes : meilleure diffusion sur Shorts.'
  ),
  c(
    'ch-histoires',
    10,
    'Pause Récit',
    '@pauserecit',
    520_000,
    33_000_000,
    1.4,
    0.11,
    0.52,
    'reddit',
    false,
    'Mon ex m’a invité à son mariage',
    0,
    'Audience installée, publie une compilation par semaine.'
  ),

  // Top Savoirs
  c(
    'ch-top',
    1,
    'Top10Zone',
    '@Top10Zone',
    530_000,
    6_100_000,
    2.5,
    3.0,
    0.9,
    'list',
    false,
    'Les 10 métiers qui disparaissent le plus vite',
    2,
    'Miniatures lisibles à 120 px : un chiffre, un objet.'
  ),
  c(
    'ch-top',
    2,
    'Le Classement',
    '@leclassement',
    247_000,
    2_900_000,
    1.7,
    2.9,
    0.86,
    'list',
    false,
    'Les 10 pays les plus visités',
    4,
    'Compte à rebours avec une carte qui se remplit.'
  ),
  c(
    'ch-top',
    3,
    'Savoir Plus',
    '@savoirplus',
    164_000,
    1_800_000,
    2.2,
    3.1,
    0.8,
    'explainer',
    true,
    'Pourquoi le ciel est bleu (vraiment)',
    1,
    'Explication en une phrase avant de développer.'
  ),
  c(
    'ch-top',
    4,
    'Podium Culture',
    '@podiumculture',
    92_000,
    1_200_000,
    1.3,
    2.7,
    0.76,
    'list',
    false,
    'Les 10 inventions françaises oubliées',
    5,
    'Fiche récap en fin de vidéo à capturer.'
  ),
  c(
    'ch-top',
    5,
    'Cinq Minutes Top',
    '@cinqminutestop',
    58_000,
    840_000,
    2.9,
    2.8,
    0.7,
    'explainer',
    true,
    '5 faits sur l’océan que personne ne t’a dit',
    0,
    'Format court de 5 minutes : rétention de 58 %.'
  ),
  c(
    'ch-top',
    6,
    'Top Curieux',
    '@topcurieux',
    118_000,
    1_400_000,
    1.1,
    2.6,
    0.66,
    'list',
    false,
    'Les 10 plus grands déserts du monde',
    6,
    'Voix chaleureuse et rythme plus lent.'
  ),
  c(
    'ch-top',
    7,
    'Culture Rapide',
    '@culturerapide',
    205_000,
    2_300_000,
    1.5,
    2.9,
    0.6,
    'animated',
    false,
    'L’Empire romain en 8 minutes',
    3,
    'Animations dessinées à la main, très partagées.'
  ),
  c(
    'ch-top',
    8,
    'Top Planète',
    '@topplanete',
    710_000,
    8_000_000,
    1.8,
    3.2,
    0.52,
    'list',
    false,
    'Les 10 animaux les plus dangereux',
    1,
    'Chaîne installée : publie en 4K avec images originales.'
  ),

  // Mystery Files (EN)
  c(
    'ch-mystery',
    1,
    'Cold Case Atlas',
    '@coldcaseatlas',
    468_000,
    5_900_000,
    2.3,
    9.8,
    0.91,
    'narrated',
    false,
    'The Last Flight of the Chelyabinsk',
    2,
    'Opens with the one detail that never made the news.'
  ),
  c(
    'ch-mystery',
    2,
    'The Unexplained Ledger',
    '@unexplainedledger',
    212_000,
    2_700_000,
    1.8,
    10.4,
    0.87,
    'archives',
    false,
    'The Case Files Nobody Reopened',
    4,
    'Scans of the original reports on screen.'
  ),
  c(
    'ch-mystery',
    3,
    'Hidden Archives',
    '@hiddenarchives',
    134_000,
    3_100_000,
    3.2,
    9.4,
    0.82,
    'archives',
    true,
    'Roswell: The Memo They Missed',
    1,
    'Short titles, six words or fewer.'
  ),
  c(
    'ch-mystery',
    4,
    'Mystery Hour',
    '@mysteryhour',
    590_000,
    7_200_000,
    1.9,
    11.2,
    0.75,
    'list',
    false,
    '5 Unsolved Disappearances in 60 Minutes',
    3,
    'Long watch-time format, one-hour compilations.'
  ),
  c(
    'ch-mystery',
    5,
    'Lost in Time',
    '@lostintimeyt',
    76_000,
    1_300_000,
    2.7,
    8.9,
    0.7,
    'animated',
    true,
    'The City That Vanished Overnight',
    0,
    'Animated maps for each location.'
  ),
  c(
    'ch-mystery',
    6,
    'Echoes of History',
    '@echoesofhistory',
    305_000,
    3_600_000,
    1.2,
    9.6,
    0.62,
    'narrated',
    false,
    'The Strange Death of a Tsar’s Doctor',
    6,
    'Deep-voice narrator with music built for retention.'
  ),
  c(
    'ch-mystery',
    7,
    'Strange Dossier',
    '@strangedossier',
    48_000,
    760_000,
    1.6,
    8.4,
    0.57,
    'animated',
    false,
    'The Voynich Code, Explained',
    9,
    'Cleaner thumbnails with one object in focus.'
  ),
  c(
    'ch-mystery',
    8,
    'Case Closed Daily',
    '@caseclosed',
    880_000,
    9_900_000,
    1.4,
    10.9,
    0.5,
    'list',
    false,
    'Top 10 Cases Solved by Accident',
    1,
    'Daily uploads, huge back catalogue.'
  )
]

export function competitorsOf(channelId: ChannelId): Competitor[] {
  return COMPETITORS.filter((x) => x.channelId === channelId)
}

export interface Outperformer {
  id: string
  competitorId: string
  title: string
  views: number
  /** Times the channel's usual views. */
  multiple: number
  daysAgo: number
  hue: number
  format: 'long' | 'short'
}

export const OUTPERFORMERS: Record<ChannelId, Outperformer[]> = {
  'ch-enigmes': [
    {
      id: 'op-e1',
      competitorId: 'cp-enigmes-5',
      title: '3 énigmes de l’Antiquité en 20 minutes',
      views: 410_000,
      multiple: 4.1,
      daysAgo: 1,
      hue: 38,
      format: 'long'
    },
    {
      id: 'op-e2',
      competitorId: 'cp-enigmes-3',
      title: 'Le dernier jour de Pompéi, minute par minute',
      views: 1_240_000,
      multiple: 3.2,
      daysAgo: 2,
      hue: 12,
      format: 'long'
    },
    {
      id: 'op-e3',
      competitorId: 'cp-enigmes-8',
      title: 'Antikythera : la machine qui n’aurait pas dû exister',
      views: 286_000,
      multiple: 3.6,
      daysAgo: 3,
      hue: 210,
      format: 'long'
    },
    {
      id: 'op-e4',
      competitorId: 'cp-enigmes-1',
      title: 'Le vaisseau fantôme de la Baltique',
      views: 702_000,
      multiple: 2.3,
      daysAgo: 3,
      hue: 190,
      format: 'long'
    },
    {
      id: 'op-e5',
      competitorId: 'cp-enigmes-6',
      title: 'Les cités englouties de la mer Noire',
      views: 551_000,
      multiple: 2.1,
      daysAgo: 4,
      hue: 170,
      format: 'long'
    }
  ],
  'ch-histoires': [
    {
      id: 'op-h1',
      competitorId: 'cp-histoires-3',
      title: 'Ma sœur a volé mon identité',
      views: 4_200_000,
      multiple: 5.2,
      daysAgo: 0,
      hue: 340,
      format: 'short'
    },
    {
      id: 'op-h2',
      competitorId: 'cp-histoires-7',
      title: 'Mon voisin a bloqué ma voiture 3 jours',
      views: 1_450_000,
      multiple: 4.4,
      daysAgo: 0,
      hue: 28,
      format: 'short'
    },
    {
      id: 'op-h3',
      competitorId: 'cp-histoires-4',
      title: 'Elle m’a quitté devant tout le monde',
      views: 2_100_000,
      multiple: 3.6,
      daysAgo: 0,
      hue: 260,
      format: 'short'
    },
    {
      id: 'op-h4',
      competitorId: 'cp-histoires-1',
      title: 'Mon colocataire a loué ma chambre en secret',
      views: 5_800_000,
      multiple: 2.8,
      daysAgo: 1,
      hue: 12,
      format: 'short'
    },
    {
      id: 'op-h5',
      competitorId: 'cp-histoires-8',
      title: 'AITA d’avoir annulé le mariage ?',
      views: 2_600_000,
      multiple: 2.2,
      daysAgo: 1,
      hue: 90,
      format: 'short'
    }
  ],
  'ch-top': [
    {
      id: 'op-t1',
      competitorId: 'cp-top-5',
      title: '5 faits sur l’océan que personne ne t’a dit',
      views: 340_000,
      multiple: 4.8,
      daysAgo: 0,
      hue: 200,
      format: 'long'
    },
    {
      id: 'op-t2',
      competitorId: 'cp-top-3',
      title: 'Pourquoi le ciel est bleu (vraiment)',
      views: 520_000,
      multiple: 3.4,
      daysAgo: 1,
      hue: 220,
      format: 'long'
    },
    {
      id: 'op-t3',
      competitorId: 'cp-top-1',
      title: 'Les 10 métiers qui disparaissent le plus vite',
      views: 910_000,
      multiple: 2.6,
      daysAgo: 2,
      hue: 40,
      format: 'long'
    },
    { id: 'op-t4', competitorId: 'cp-top-7', title: 'L’Empire romain en 8 minutes', views: 480_000, multiple: 2.2, daysAgo: 3, hue: 20, format: 'long' }
  ],
  'ch-mystery': [
    { id: 'op-m1', competitorId: 'cp-mystery-3', title: 'Roswell: The Memo They Missed', views: 540_000, multiple: 5.4, daysAgo: 1, hue: 120, format: 'long' },
    {
      id: 'op-m2',
      competitorId: 'cp-mystery-5',
      title: 'The City That Vanished Overnight',
      views: 220_000,
      multiple: 4.0,
      daysAgo: 0,
      hue: 200,
      format: 'long'
    },
    {
      id: 'op-m3',
      competitorId: 'cp-mystery-1',
      title: 'The Last Flight of the Chelyabinsk',
      views: 810_000,
      multiple: 2.5,
      daysAgo: 2,
      hue: 240,
      format: 'long'
    },
    {
      id: 'op-m4',
      competitorId: 'cp-mystery-4',
      title: '5 Unsolved Disappearances in 60 Minutes',
      views: 1_300_000,
      multiple: 2.1,
      daysAgo: 3,
      hue: 30,
      format: 'long'
    }
  ]
}

/* ---------- niches ---------- */

export type Lang = 'fr' | 'en' | 'es'
export type NicheFormat = 'long' | 'short'

export interface Niche {
  id: string
  /** x: competition, 0 (low) – 100 (high). y: demand and growth, 0–100. Values are for French, long videos. */
  x: number
  y: number
  /** Estimated revenue per 1 000 views, long format, French. */
  rpm: number
  growth30: number
  channels: number
  faceless: boolean
  formats: readonly NicheFormat[]
  top: { name: string; subs: number }[]
  videos: { title: string; views: number }[]
  /** How well our pipelines replicate the niche. */
  replic: { model: string; pct: number }
}

export const NICHES: Niche[] = [
  {
    id: 'history',
    x: 62,
    y: 74,
    rpm: 3.4,
    growth30: 12,
    channels: 1840,
    faceless: true,
    formats: ['long', 'short'],
    top: [
      { name: 'L’Œil du Passé', subs: 520_000 },
      { name: 'Chroniques Obscures', subs: 412_000 },
      { name: 'Atlas Perdu', subs: 305_000 }
    ],
    videos: [
      { title: 'Le dernier jour de Pompéi, minute par minute', views: 1_240_000 },
      { title: 'Le vaisseau fantôme de la Baltique', views: 702_000 },
      { title: 'Les cités englouties de la mer Noire', views: 551_000 }
    ],
    replic: { model: 'Documentaire narré', pct: 88 }
  },
  {
    id: 'reddit',
    x: 74,
    y: 82,
    rpm: 1.2,
    growth30: 31,
    channels: 3210,
    faceless: true,
    formats: ['long', 'short'],
    top: [
      { name: 'Pause Récit', subs: 520_000 },
      { name: 'Reddit à Voix Haute', subs: 410_000 },
      { name: 'Confessions FR', subs: 296_000 }
    ],
    videos: [
      { title: 'Ma sœur a volé mon identité', views: 4_200_000 },
      { title: 'Mon colocataire a loué ma chambre en secret', views: 5_800_000 },
      { title: 'AITA d’avoir annulé le mariage ?', views: 2_600_000 }
    ],
    replic: { model: 'Reddit + gameplay', pct: 92 }
  },
  {
    id: 'truecrime',
    x: 70,
    y: 66,
    rpm: 5.2,
    growth30: 9,
    channels: 960,
    faceless: true,
    formats: ['long'],
    top: [
      { name: 'Dossier Zéro', subs: 142_000 },
      { name: 'Affaires Classées', subs: 398_000 },
      { name: 'Scène de Crime', subs: 276_000 }
    ],
    videos: [
      { title: 'L’affaire qui a bouleversé un village entier', views: 980_000 },
      { title: 'Les dernières heures de la victime', views: 740_000 },
      { title: 'Le suspect n°1 était innocent', views: 610_000 }
    ],
    replic: { model: 'Documentaire narré', pct: 74 }
  },
  {
    id: 'finance',
    x: 82,
    y: 70,
    rpm: 12.5,
    growth30: 6,
    channels: 1480,
    faceless: true,
    formats: ['long'],
    top: [
      { name: 'Budget Zen', subs: 610_000 },
      { name: 'Épargne Simple', subs: 340_000 },
      { name: 'Patrimoine & Co', subs: 215_000 }
    ],
    videos: [
      { title: 'Comment j’ai placé 10 000 € en 2026', views: 1_100_000 },
      { title: 'Le piège du livret A', views: 760_000 },
      { title: '5 erreurs de débutant en bourse', views: 690_000 }
    ],
    replic: { model: 'Avatar IA', pct: 52 }
  },
  {
    id: 'ai',
    x: 58,
    y: 88,
    rpm: 9.8,
    growth30: 44,
    channels: 770,
    faceless: true,
    formats: ['long', 'short'],
    top: [
      { name: 'IA Quotidien', subs: 380_000 },
      { name: 'Prompt Lab', subs: 245_000 },
      { name: 'Tech en 5 min', subs: 520_000 }
    ],
    videos: [
      { title: 'J’ai remplacé mon équipe par des agents', views: 1_900_000 },
      { title: 'Les 7 outils d’IA qui changent tout', views: 1_300_000 },
      { title: 'Cet agent fait mon montage seul', views: 880_000 }
    ],
    replic: { model: 'Commentaire / écran', pct: 61 }
  },
  {
    id: 'wellness',
    x: 55,
    y: 52,
    rpm: 4.1,
    growth30: 5,
    channels: 1120,
    faceless: false,
    formats: ['long', 'short'],
    top: [
      { name: 'Respire', subs: 450_000 },
      { name: 'Matin Calme', subs: 280_000 },
      { name: 'Soi & Sens', subs: 190_000 }
    ],
    videos: [
      { title: 'Ma routine du matin en 10 minutes', views: 940_000 },
      { title: 'Pourquoi tu dors mal', views: 620_000 },
      { title: 'Méditer sans y arriver', views: 410_000 }
    ],
    replic: { model: 'Avatar IA', pct: 44 }
  },
  {
    id: 'science',
    x: 48,
    y: 61,
    rpm: 5.8,
    growth30: 14,
    channels: 690,
    faceless: true,
    formats: ['long'],
    top: [
      { name: 'Savoir Plus', subs: 164_000 },
      { name: 'Éclair de Science', subs: 355_000 },
      { name: 'Cosmos FR', subs: 421_000 }
    ],
    videos: [
      { title: 'Pourquoi le temps ne s’écoule pas partout pareil', views: 1_050_000 },
      { title: 'Le vide n’existe pas', views: 780_000 },
      { title: 'Ce que Webb a vu en 2026', views: 640_000 }
    ],
    replic: { model: 'Documentaire narré', pct: 83 }
  },
  {
    id: 'sports',
    x: 30,
    y: 68,
    rpm: 1.8,
    growth30: 27,
    channels: 310,
    faceless: true,
    formats: ['long', 'short'],
    top: [
      { name: 'Sport Étrange', subs: 118_000 },
      { name: 'Record Fou', subs: 205_000 },
      { name: 'Finale Perdue', subs: 87_000 }
    ],
    videos: [
      { title: 'Le sport le plus dangereux du monde', views: 1_450_000 },
      { title: '10 records absurdes validés par le Guinness', views: 910_000 },
      { title: 'Le match qui a duré 3 jours', views: 760_000 }
    ],
    replic: { model: 'Top 10 illustré', pct: 85 }
  },
  {
    id: 'luxury',
    x: 36,
    y: 76,
    rpm: 7.4,
    growth30: 33,
    channels: 280,
    faceless: true,
    formats: ['long'],
    top: [
      { name: 'Fortunes', subs: 232_000 },
      { name: 'Haut de Gamme', subs: 144_000 },
      { name: 'Milliardaire Mode d’Emploi', subs: 96_000 }
    ],
    videos: [
      { title: 'Le yacht qui vaut plus qu’une ville', views: 2_300_000 },
      { title: 'Comment vivent les 10 plus riches', views: 1_700_000 },
      { title: 'La maison la plus chère de Monaco', views: 1_100_000 }
    ],
    replic: { model: 'Top 10 illustré', pct: 79 }
  },
  {
    id: 'animals',
    x: 66,
    y: 46,
    rpm: 1.6,
    growth30: 4,
    channels: 2050,
    faceless: true,
    formats: ['long', 'short'],
    top: [
      { name: 'Top Planète', subs: 710_000 },
      { name: 'Bêtes Rares', subs: 330_000 },
      { name: 'Faune Express', subs: 240_000 }
    ],
    videos: [
      { title: 'Les 10 animaux les plus dangereux', views: 1_300_000 },
      { title: 'Ce poisson qui marche', views: 640_000 },
      { title: 'L’animal le plus rapide de la mer', views: 520_000 }
    ],
    replic: { model: 'Top 10 illustré', pct: 90 }
  },
  {
    id: 'survival',
    x: 26,
    y: 59,
    rpm: 4.6,
    growth30: 21,
    channels: 190,
    faceless: true,
    formats: ['long'],
    top: [
      { name: 'Seul en Forêt', subs: 175_000 },
      { name: 'Kit de Survie', subs: 92_000 },
      { name: 'Zéro Réseau', subs: 61_000 }
    ],
    videos: [
      { title: '72 heures sans rien : ce qui tue vraiment', views: 1_200_000 },
      { title: 'Les erreurs qui coûtent la vie en montagne', views: 830_000 },
      { title: 'Survivre à un naufrage', views: 590_000 }
    ],
    replic: { model: 'Documentaire narré', pct: 71 }
  },
  {
    id: 'psychology',
    x: 52,
    y: 72,
    rpm: 6.2,
    growth30: 18,
    channels: 640,
    faceless: true,
    formats: ['long', 'short'],
    top: [
      { name: 'Esprit Clair', subs: 370_000 },
      { name: 'Psycho en Bref', subs: 215_000 },
      { name: 'Comprendre l’Autre', subs: 133_000 }
    ],
    videos: [
      { title: 'Pourquoi tu procrastines (et comment arrêter)', views: 1_600_000 },
      { title: 'Les 7 signes d’une personne manipulatrice', views: 1_150_000 },
      { title: 'Ce que ton sommeil dit de toi', views: 700_000 }
    ],
    replic: { model: 'Avatar IA', pct: 68 }
  },
  {
    id: 'geo',
    x: 34,
    y: 64,
    rpm: 6.9,
    growth30: 24,
    channels: 150,
    faceless: true,
    formats: ['long'],
    top: [
      { name: 'Cartes sur Table', subs: 288_000 },
      { name: 'Monde en Cartes', subs: 164_000 },
      { name: 'Frontières', subs: 71_000 }
    ],
    videos: [
      { title: 'Pourquoi ce détroit peut bloquer l’économie mondiale', views: 1_800_000 },
      { title: 'La carte qui explique tout', views: 1_050_000 },
      { title: 'Les 10 frontières les plus absurdes', views: 780_000 }
    ],
    replic: { model: 'Documentaire narré', pct: 77 }
  },
  {
    id: 'lore',
    x: 42,
    y: 70,
    rpm: 3.2,
    growth30: 19,
    channels: 230,
    faceless: true,
    formats: ['long', 'short'],
    top: [
      { name: 'Lore Complet', subs: 310_000 },
      { name: 'Histoire du Jeu', subs: 188_000 },
      { name: 'Mythes Pixel', subs: 99_000 }
    ],
    videos: [
      { title: 'Toute l’histoire de la série en 40 minutes', views: 2_100_000 },
      { title: 'La théorie qui change la fin', views: 1_350_000 },
      { title: 'Ce que le jeu ne t’a jamais expliqué', views: 970_000 }
    ],
    replic: { model: 'Documentaire narré', pct: 86 }
  }
]

/** Base seeds (sparkline) for the "Ça monte" list. */
export function nicheById(id: string): Niche | undefined {
  return NICHES.find((n) => n.id === id)
}

/* ---------- ideas ---------- */

export type IdeaSource = 'competitor' | 'trend' | 'comment' | 'atlas' | 'manual'
export type IdeaColumn = 'proposed' | 'validated' | 'production'

export interface Idea {
  id: string
  channelId: ChannelId
  title: string
  angle: string
  source: IdeaSource
  /** 0–100. */
  potential: number
  /** 0 = no estimate (an idea typed by hand in real mode). */
  estViews: number
  column: IdeaColumn
  /** Real mode: the id of the row in the database (`ideas.*`). */
  liveId?: number
  /** Real mode: nobody scored this idea yet (typed by hand): the potential is not shown. */
  unscored?: boolean
}

type IdeaSeed = Omit<Idea, 'id' | 'column'>

export const IDEA_BOARD: Idea[] = [
  {
    id: 'id-e1',
    channelId: 'ch-enigmes',
    title: '3 énigmes de l’Antiquité en 20 minutes',
    angle: 'Le format qui monte chez Les Trois Énigmes, avec nos propres sources.',
    source: 'competitor',
    potential: 91,
    estViews: 320_000,
    column: 'proposed'
  },
  {
    id: 'id-e2',
    channelId: 'ch-enigmes',
    title: 'Pompéi : ce que les fouilles de 2026 ont changé',
    angle: 'Une actualité récente sur un sujet que ta chaîne n’a pas encore traité.',
    source: 'trend',
    potential: 84,
    estViews: 410_000,
    column: 'proposed'
  },
  {
    id: 'id-e3',
    channelId: 'ch-enigmes',
    title: 'Le Voynich, la version des commentaires',
    angle: 'Tes abonnés demandent les hypothèses écartées : 214 mentions en 30 jours.',
    source: 'comment',
    potential: 76,
    estViews: 190_000,
    column: 'proposed'
  },
  {
    id: 'id-e4',
    channelId: 'ch-enigmes',
    title: 'Atlantide : ce que Platon a vraiment écrit',
    angle: 'Retour au texte du Critias, sans la légende.',
    source: 'atlas',
    potential: 82,
    estViews: 250_000,
    column: 'validated'
  },
  {
    id: 'id-e5',
    channelId: 'ch-enigmes',
    title: 'La Mary Celeste, navire fantôme',
    angle: 'Reconstitution du journal de bord, jour par jour.',
    source: 'atlas',
    potential: 73,
    estViews: 170_000,
    column: 'production'
  },
  {
    id: 'id-h1',
    channelId: 'ch-histoires',
    title: 'Mon voisin a bloqué ma voiture 3 jours',
    angle: 'Voisins : un thème qui revient et que Voisins Terribles domine à 4×.',
    source: 'competitor',
    potential: 88,
    estViews: 1_200_000,
    column: 'proposed'
  },
  {
    id: 'id-h2',
    channelId: 'ch-histoires',
    title: 'Elle a découvert le compte secret de son mari',
    angle: 'Hook choc en 2 secondes, fin ouverte pour les commentaires.',
    source: 'trend',
    potential: 79,
    estViews: 780_000,
    column: 'proposed'
  },
  {
    id: 'id-h3',
    channelId: 'ch-histoires',
    title: 'Le colocataire fantôme qui ne payait jamais',
    angle: 'Ton public réclame plus d’histoires de colocation.',
    source: 'comment',
    potential: 72,
    estViews: 520_000,
    column: 'validated'
  },
  {
    id: 'id-h4',
    channelId: 'ch-histoires',
    title: 'Ma belle-mère a lu mon journal au repas de Noël',
    angle: 'Saisonnier : Noël approche, les histoires de famille doublent.',
    source: 'atlas',
    potential: 81,
    estViews: 640_000,
    column: 'production'
  },
  {
    id: 'id-t1',
    channelId: 'ch-top',
    title: 'Les 10 animaux les plus rapides du monde',
    angle: 'Du guépard au faucon pèlerin, avec le classement mer, terre, air.',
    source: 'atlas',
    potential: 74,
    estViews: 140_000,
    column: 'production'
  },
  {
    id: 'id-t2',
    channelId: 'ch-top',
    title: '5 faits sur l’océan que personne ne t’a dit',
    angle: 'Format de 5 minutes qui fait 4,8× chez Cinq Minutes Top.',
    source: 'competitor',
    potential: 86,
    estViews: 210_000,
    column: 'proposed'
  },
  {
    id: 'id-t3',
    channelId: 'ch-top',
    title: 'Les 10 métiers qui disparaissent le plus vite',
    angle: 'Un top que Top10Zone vient de sortir : 910 000 vues en 2 jours.',
    source: 'trend',
    potential: 78,
    estViews: 180_000,
    column: 'validated'
  },
  {
    id: 'id-m1',
    channelId: 'ch-mystery',
    title: 'The Memo They Missed: Roswell Reconsidered',
    angle: 'Hidden Archives fait 5× avec un titre court et un document à l’écran.',
    source: 'competitor',
    potential: 83,
    estViews: 95_000,
    column: 'proposed'
  },
  {
    id: 'id-m2',
    channelId: 'ch-mystery',
    title: 'The Doctor Who Vanished in 1931',
    angle: 'Une traduction directe d’un épisode des Grandes Énigmes.',
    source: 'atlas',
    potential: 70,
    estViews: 60_000,
    column: 'validated'
  }
]

/** What « Demander 5 idées » can add, per channel (taken in order; the cards are new each time until the pool runs out). */
export const IDEA_POOL: Record<ChannelId, IdeaSeed[]> = {
  'ch-enigmes': [
    {
      channelId: 'ch-enigmes',
      title: 'Les 3 disparitions de l’Antarctique',
      angle: 'Trois dossiers courts, une seule thèse commune.',
      source: 'trend',
      potential: 85,
      estViews: 280_000
    },
    {
      channelId: 'ch-enigmes',
      title: 'Antikythera : la machine qui n’aurait pas dû exister',
      angle: 'Sous la Surface fait 3,6× sur le sujet ; on propose la version documentée.',
      source: 'competitor',
      potential: 89,
      estViews: 340_000
    },
    {
      channelId: 'ch-enigmes',
      title: 'Le trésor de Rennes-le-Château, ce qui reste',
      angle: 'Tes abonnés l’ont demandé 96 fois.',
      source: 'comment',
      potential: 71,
      estViews: 160_000
    },
    {
      channelId: 'ch-enigmes',
      title: 'Les cités englouties de la mer Noire',
      angle: 'Atlas Perdu domine ; on y répond avec les cartes de 2026.',
      source: 'competitor',
      potential: 80,
      estViews: 300_000
    },
    {
      channelId: 'ch-enigmes',
      title: 'La Bête du Gévaudan, les archives d’époque',
      angle: 'Un classique qui revient dans les recherches depuis 3 semaines.',
      source: 'trend',
      potential: 77,
      estViews: 210_000
    },
    {
      channelId: 'ch-enigmes',
      title: 'Les mystères de l’Atlantique Nord',
      angle: 'Une série en trois épisodes pour fidéliser.',
      source: 'atlas',
      potential: 74,
      estViews: 230_000
    },
    {
      channelId: 'ch-enigmes',
      title: 'Le Dahlia noir : les pièces oubliées',
      angle: 'Dossier Zéro garde 62 % de retour d’audience sur ce format.',
      source: 'competitor',
      potential: 79,
      estViews: 190_000
    }
  ],
  'ch-histoires': [
    {
      channelId: 'ch-histoires',
      title: 'Mon patron m’a fait signer en bas',
      angle: 'Le Fil Reddit tourne trois fois par jour sur ce thème.',
      source: 'competitor',
      potential: 77,
      estViews: 560_000
    },
    {
      channelId: 'ch-histoires',
      title: 'J’ai perdu mon mariage à cause d’un SMS',
      angle: 'Hook en 2 secondes, chute à 50 secondes.',
      source: 'trend',
      potential: 82,
      estViews: 710_000
    },
    {
      channelId: 'ch-histoires',
      title: 'Le déménagement qui a tout révélé',
      angle: 'Sujet de saison : les déménagements d’automne.',
      source: 'trend',
      potential: 69,
      estViews: 420_000
    },
    {
      channelId: 'ch-histoires',
      title: 'Mon frère a vendu l’héritage sans me le dire',
      angle: 'Ton public réclame les histoires d’héritage.',
      source: 'comment',
      potential: 84,
      estViews: 830_000
    },
    {
      channelId: 'ch-histoires',
      title: 'Mon ex m’a invité à son mariage',
      angle: 'Un sujet qui monte chez Pause Récit.',
      source: 'competitor',
      potential: 75,
      estViews: 530_000
    },
    {
      channelId: 'ch-histoires',
      title: 'Le colis qui n’était pas pour moi',
      angle: 'Format énigme courte, bon pour la rétention.',
      source: 'atlas',
      potential: 68,
      estViews: 390_000
    },
    {
      channelId: 'ch-histoires',
      title: 'Elle a menti sur son âge pendant 6 mois',
      angle: 'Récits Anonymes fait 1,9× avec ce thème.',
      source: 'competitor',
      potential: 73,
      estViews: 480_000
    }
  ],
  'ch-top': [
    {
      channelId: 'ch-top',
      title: 'Les 10 plus grands déserts du monde',
      angle: 'Une idée facile à illustrer, peu de concurrence récente.',
      source: 'atlas',
      potential: 72,
      estViews: 130_000
    },
    {
      channelId: 'ch-top',
      title: 'L’Empire romain en 8 minutes',
      angle: 'Culture Rapide fait 2,2× avec ce format animé.',
      source: 'competitor',
      potential: 80,
      estViews: 190_000
    },
    {
      channelId: 'ch-top',
      title: '10 inventions françaises oubliées',
      angle: 'Un thème patrimoine qui monte avant les fêtes.',
      source: 'trend',
      potential: 76,
      estViews: 150_000
    },
    {
      channelId: 'ch-top',
      title: 'Pourquoi le ciel est bleu (vraiment)',
      angle: 'Explication en une phrase avant de développer.',
      source: 'competitor',
      potential: 83,
      estViews: 220_000
    },
    {
      channelId: 'ch-top',
      title: 'Les 10 pays les plus visités en 2026',
      angle: 'Tes abonnés demandent des tops voyage.',
      source: 'comment',
      potential: 70,
      estViews: 120_000
    },
    {
      channelId: 'ch-top',
      title: 'Les 10 records de vitesse les plus fous',
      angle: 'Suite directe de « Les 10 animaux les plus rapides ».',
      source: 'atlas',
      potential: 74,
      estViews: 140_000
    }
  ],
  'ch-mystery': [
    {
      channelId: 'ch-mystery',
      title: 'The City That Vanished Overnight',
      angle: 'Lost in Time fait 4× avec des cartes animées.',
      source: 'competitor',
      potential: 82,
      estViews: 85_000
    },
    {
      channelId: 'ch-mystery',
      title: 'Five Cases the Police Never Reopened',
      angle: 'Compilation de 40 minutes, bon temps de visionnage.',
      source: 'trend',
      potential: 77,
      estViews: 70_000
    },
    {
      channelId: 'ch-mystery',
      title: 'The Real Story of the Tunguska Blast',
      angle: 'Traduction d’une vidéo FR à 410 000 vues.',
      source: 'atlas',
      potential: 79,
      estViews: 75_000
    },
    {
      channelId: 'ch-mystery',
      title: 'The Code Nobody Cracked',
      angle: 'Titre de moins de six mots, comme Hidden Archives.',
      source: 'competitor',
      potential: 74,
      estViews: 58_000
    },
    {
      channelId: 'ch-mystery',
      title: 'Ghost Ships of the Baltic',
      angle: 'Chroniques Obscures (FR) fait 2,3× sur le même sujet.',
      source: 'atlas',
      potential: 72,
      estViews: 62_000
    },
    {
      channelId: 'ch-mystery',
      title: 'The Last Day of Pompeii, Hour by Hour',
      angle: 'Le sujet monte en anglais aussi.',
      source: 'trend',
      potential: 81,
      estViews: 90_000
    }
  ]
}

/* ---------- agent chat ---------- */

/** Messages the chat opens with, per scope ('all' is the main agent). Times are minutes ago. */
export const CHAT_SEEDS: Record<string, { text: string; minutesAgo: number }[]> = {
  all: [
    {
      text: 'J’ai passé 62 chaînes en revue cette nuit. Trois niches montent depuis 30 jours : Luxe et milliardaires (+33 %), Sport insolite (+27 %) et Géopolitique en cartes (+24 %). Aucune n’a plus de 310 chaînes.',
      minutesAgo: 14
    },
    { text: 'La plus simple à lancer est Sport insolite : notre pipeline « Top 10 illustré » la réplique à 85 %. Je te prépare un devis ?', minutesAgo: 13 }
  ],
  'ch-enigmes': [
    {
      text: 'J’ai repéré 3 chaînes qui montent autour des Grandes Énigmes depuis 30 jours : L’Œil du Passé, Les Trois Énigmes et Sous la Surface.',
      minutesAgo: 22
    },
    { text: 'Les Trois Énigmes sort un format « 3 énigmes en 20 min » à 4× sa moyenne. Je l’ai mis en tête de tes idées.', minutesAgo: 21 }
  ],
  'ch-histoires': [
    { text: 'Confessions FR et Voisins Terribles prennent des parts depuis 30 jours. Les histoires de voisinage passent à 4,4× la moyenne.', minutesAgo: 18 },
    { text: 'J’ai ajouté deux idées « voisins » à ton tableau. Elles se réalisent avec ton pipeline actuel, sans nouvelle brique.', minutesAgo: 17 }
  ],
  'ch-top': [
    { text: 'Cinq Minutes Top fait 4,8× avec des vidéos de 5 minutes. Tes tops font 11 minutes en moyenne : on peut tester un format court.', minutesAgo: 30 },
    { text: 'Top10Zone améliore ses miniatures depuis 3 semaines. Clara peut en proposer 3 versions à comparer.', minutesAgo: 29 }
  ],
  'ch-mystery': [
    { text: 'Hidden Archives passe à 5× avec des titres de six mots ou moins. Tes titres traduits en font neuf en moyenne.', minutesAgo: 25 },
    { text: 'Je te propose de raccourcir les trois prochains titres et de comparer sur 14 jours.', minutesAgo: 24 }
  ]
}
